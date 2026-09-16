/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { seedOperatorProfiles, seedOperators } from "./seedData";

const modules = import.meta.glob("./**/*.ts");
const token = (letter: string) => letter.repeat(43);

const brief = {
  name: "Wellness Escape",
  evaluationDate: "2027-05-23",
  travelMonth: "October",
  travelerCount: 16,
  minimumViableTravelers: 12,
  confirmedTravelers: 8,
  nights: 7,
  earliestDepartureDate: "2027-10-10",
  preferredDepartureDate: "2027-10-15",
  latestDepartureDate: "2027-10-25",
  flexibleDates: true,
  proposalDecisionDate: "2027-06-10",
  targetRetailPricePerPerson: 3500,
  flightsIncluded: false,
  experienceLevel: 2,
  pace: "relaxed",
  climates: ["warm"],
  desiredExperiences: ["yoga", "meditation", "spa"],
  importantRequirements: [
    "low_physical_difficulty",
    "private_transportation",
    "strong_wellness_focus",
  ],
  travelerTypes: ["private_groups"],
  transportationNeeds: ["private_transportation", "airport_transfers"],
  accessibilityNeeds: ["low_mobility_options"],
  notes: "A fictional private wellness group.",
};

test("seeding the network is additive and never overwrites an operator's own record", async () => {
  const t = convexTest(schema, modules);
  const first = await t.mutation(internal.network.seed, {});
  expect(first.operators).toBe(seedOperators.length);
  expect(first.profiles).toBe(seedOperatorProfiles.length);

  // An operator narrows its own record, then a re-seed runs.
  const advisor = t.withIdentity({ subject: "advisor" });
  const { briefId } = await advisor.mutation(api.briefs.create, {
    brief,
    selectedDestinationSlugs: ["bali"],
  });
  await advisor.mutation(api.briefs.setShortlist, {
    briefId,
    operators: [
      { operatorSlug: "p1", operatorName: "Island Wellbeing Indonesia", capabilityToken: token("a") },
    ],
  });
  const before = await t.query(api.network.forToken, { token: token("a") });
  const {
    operatorSlug: _slug,
    updatedAt: _updatedAt,
    ...capability
  } = before!.capability!;
  await t.mutation(api.network.saveCapability, {
    token: token("a"),
    capability: { ...capability, services: ["yoga"] },
  });
  await t.mutation(internal.network.seed, {});
  const after = await t.query(api.network.forToken, { token: token("a") });
  expect(after!.capability!.services).toEqual(["yoga"]);
  expect(after!.capability!.locations).toEqual(["bali"]);
});

test("a response link reads and writes only the operator it belongs to", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.network.seed, {});
  const advisor = t.withIdentity({ subject: "advisor" });
  const { briefId } = await advisor.mutation(api.briefs.create, {
    brief,
    selectedDestinationSlugs: ["bali"],
  });
  await advisor.mutation(api.briefs.setShortlist, {
    briefId,
    operators: [
      { operatorSlug: "p1", operatorName: "Island Wellbeing Indonesia", capabilityToken: token("a") },
      { operatorSlug: "p2", operatorName: "Costa Verde Wellness", capabilityToken: token("b") },
    ],
  });

  const mine = await t.query(api.network.forToken, { token: token("a") });
  expect(mine!.operatorSlug).toBe("p1");
  const others = await t.query(api.network.forToken, { token: token("b") });
  expect(others!.operatorSlug).toBe("p2");
  const {
    operatorSlug: _otherSlug,
    updatedAt: _otherUpdatedAt,
    ...otherCapability
  } = others!.capability!;

  // Saving through p2's link cannot touch p1's record, even though the payload
  // names p1: the slug comes from the row, not from the request.
  await t.mutation(api.network.saveCapability, {
    token: token("b"),
    capability: {
      ...otherCapability,
      locations: ["costa-rica"],
      services: [],
    },
  });
  const p1 = await t.query(api.network.forToken, { token: token("a") });
  const p2 = await t.query(api.network.forToken, { token: token("b") });
  expect(p1!.capability!.locations).toEqual(["bali"]);
  expect(p1!.capability!.services.length).toBeGreaterThan(0);
  expect(p2!.capability!.locations).toEqual(["costa-rica"]);
  expect(p2!.capability!.services).toEqual([]);

  await expect(
    t.mutation(api.network.saveCapability, {
      token: token("z"),
      capability: otherCapability,
    }),
  ).rejects.toThrow("no longer active");
  expect(await t.query(api.network.forToken, { token: token("z") })).toBeNull();
});

test("a researched website becomes an operator only when a human adds it, and starts empty", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.network.seed, {});
  const advisor = t.withIdentity({ subject: "advisor" });
  const candidateId = await t.run(async (ctx) =>
    ctx.db.insert("candidates", {
      owner: "advisor",
      query: "bali incoming tour operator group travel",
      title: "Example Bali Operator",
      url: "https://example.com/bali",
      description: "A fictional published page.",
      destinationSlug: "bali",
      foundAt: Date.now(),
    }),
  );
  const { slug } = await advisor.mutation(api.network.addFromCandidate, {
    candidateId,
    name: "Example Bali Operator",
    destinationSlugs: ["bali"],
    country: "Indonesia",
    minGroupSize: 8,
    maxGroupSize: 20,
  });
  expect(slug).toBe("example-bali-operator");
  const network = await t.query(api.network.list, {});
  const added = network.find((row) => row.operator.slug === slug)!;
  expect(added.operator.source).toBe("researched");
  expect(added.operator.approvalStatus).toBe("capability_intake_pending");
  expect(added.operator.website).toBe("https://example.com/bali");
  // Nothing is claimed about what it can deliver until it fills the intake in.
  expect(added.capability.services).toEqual([]);
  expect(added.capability.features).toEqual([]);
  expect(added.capability.timing.minimumLeadTimeDays).toBe(0);
  // Adding the same candidate twice is a no-op rather than a duplicate operator.
  const again = await advisor.mutation(api.network.addFromCandidate, {
    candidateId,
    name: "Example Bali Operator",
    destinationSlugs: ["bali"],
    country: "Indonesia",
    minGroupSize: 8,
    maxGroupSize: 20,
  });
  expect(again.slug).toBe(slug);
  expect((await t.query(api.network.list, {})).length).toBe(network.length);
});
