/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { seedOperators } from "./seedData";

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

test("a workspace starts with its own network, and a second workspace gets its own copy", async () => {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice" });
  const bob = t.withIdentity({ subject: "bob" });
  expect(await t.query(api.network.list, {})).toEqual([]);

  const first = await alice.mutation(api.network.ensureWorkspace, {});
  expect(first.added).toBe(seedOperators.length);
  // Idempotent: a second call on an established workspace adds nothing.
  expect((await alice.mutation(api.network.ensureWorkspace, {})).added).toBe(0);
  expect((await alice.query(api.network.list, {})).length).toBe(
    seedOperators.length,
  );

  // Bob's network is his own. The seeded slugs repeat by design — each workspace
  // is seeded from the same fictional network — so the isolation is what matters:
  // what Bob changes never reaches Alice's records.
  expect(await bob.query(api.network.list, {})).toEqual([]);
  await bob.mutation(api.network.ensureWorkspace, {});
  const aliceOperator = (await alice.query(api.network.list, {})).find(
    (row) => row.operator.slug === "p1",
  )!.operator;
  const { token: aliceToken } = await alice.mutation(
    api.network.createCapabilityLink,
    { operatorSlug: aliceOperator.slug, token: token("a") },
  );
  const opened = await alice.query(api.network.forToken, { token: aliceToken });
  const {
    operatorSlug: _slug,
    owner: _owner,
    updatedAt: _updatedAt,
    ...capability
  } = opened!.capability!;
  await alice.mutation(api.network.saveCapability, {
    token: aliceToken,
    capability: { ...capability, services: ["yoga"] },
  });

  await bob.mutation(api.network.removeOperator, { operatorSlug: "p1" });
  expect((await bob.query(api.network.list, {})).length).toBe(
    seedOperators.length - 1,
  );
  const aliceAfter = await alice.query(api.network.list, {});
  expect(aliceAfter.length).toBe(seedOperators.length);
  expect(
    aliceAfter.find((row) => row.operator.slug === "p1")!.capability.services,
  ).toEqual(["yoga"]);
  // Alice cannot remove an operator she does not have.
  await expect(
    alice.mutation(api.network.removeOperator, { operatorSlug: "not-mine" }),
  ).rejects.toThrow("Operator not found");
});

test("an operator keeps its own record current through a standing link, with no brief involved", async () => {
  const t = convexTest(schema, modules).withIdentity({ subject: "advisor" });
  await t.mutation(api.network.ensureWorkspace, {});
  const slug = (await t.query(api.network.list, {}))[0].operator.slug;
  const { token: linkToken } = await t.mutation(api.network.createCapabilityLink, {
    operatorSlug: slug,
    token: token("a"),
  });
  expect(linkToken).toBe(token("a"));
  // Asking twice returns the same link rather than minting a second.
  const again = await t.mutation(api.network.createCapabilityLink, {
    operatorSlug: slug,
    token: token("b"),
  });
  expect(again.token).toBe(token("a"));

  const opened = await t.query(api.network.forToken, { token: token("a") });
  expect(opened).toMatchObject({ kind: "capability", operatorSlug: slug });
  expect(opened!.capability!.services.length).toBeGreaterThan(0);

  const { operatorSlug: _slug, owner: _owner, updatedAt: _updatedAt, ...capability } =
    opened!.capability!;
  await t.mutation(api.network.saveCapability, {
    token: token("a"),
    capability: { ...capability, services: ["yoga"], languages: ["English"] },
  });
  const after = await t.query(api.network.forToken, { token: token("a") });
  expect(after!.capability!.services).toEqual(["yoga"]);
  // Saving through a standing link marks the operator's record as on file.
  const listed = (await t.query(api.network.list, {})).find(
    (row) => row.operator.slug === slug,
  );
  expect(listed!.operator.approvalStatus).toBe("capability_on_file");
  await expect(
    t.mutation(api.network.saveCapability, {
      token: token("zz"),
      capability,
    }),
  ).rejects.toThrow("no longer active");
});

test("a request link and a standing link both work, and neither reaches the other's data", async () => {
  const t = convexTest(schema, modules).withIdentity({ subject: "advisor" });
  await t.mutation(api.network.ensureWorkspace, {});
  const { briefId } = await t.mutation(api.briefs.create, {
    brief,
    selectedDestinationSlugs: ["bali"],
  });
  await t.mutation(api.briefs.setShortlist, {
    briefId,
    operators: [
      {
        operatorSlug: "p1",
        operatorName: "Island Wellbeing Indonesia",
        capabilityToken: token("r"),
      },
    ],
  });
  const request = await t.query(api.network.forToken, { token: token("r") });
  expect(request!.kind).toBe("request");
  // A request link carries the brief it belongs to; a standing one carries none.
  expect(await t.query(api.briefs.forOperatorToken, { token: token("r") })).not.toBeNull();
  const { token: standingToken } = await t.mutation(api.network.createCapabilityLink, {
    operatorSlug: "p1",
    token: token("s"),
  });
  expect(
    await t.query(api.briefs.forOperatorToken, { token: standingToken }),
  ).toBeNull();
  expect(
    await t.query(api.proposals.byOperatorToken, { token: standingToken }),
  ).toBeNull();
});

test("an operator can be added by hand or from a researched page, and starts empty", async () => {
  const t = convexTest(schema, modules).withIdentity({ subject: "advisor" });
  await t.mutation(api.network.ensureWorkspace, {});
  const added = await t.mutation(api.network.addOperator, {
    name: "Coast & Valley Travel",
    country: "Portugal",
    destinationSlugs: ["portugal"],
    minGroupSize: 8,
    maxGroupSize: 24,
  });
  expect(added.created).toBe(true);
  let listed = await t.query(api.network.list, {});
  const manual = listed.find((row) => row.operator.slug === added.slug)!;
  expect(manual.operator.source).toBe("manual");
  expect(manual.operator.approvalStatus).toBe("capability_intake_pending");
  expect(manual.capability.services).toEqual([]);
  expect(manual.capability.timing.minimumLeadTimeDays).toBe(0);

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
  const researched = await t.mutation(api.network.addOperator, {
    candidateId,
    name: "Example Bali Operator",
    country: "Indonesia",
    destinationSlugs: ["bali"],
    minGroupSize: 8,
    maxGroupSize: 20,
  });
  listed = await t.query(api.network.list, {});
  const fromResearch = listed.find(
    (row) => row.operator.slug === researched.slug,
  )!;
  expect(fromResearch.operator.source).toBe("researched");
  expect(fromResearch.operator.website).toBe("https://example.com/bali");
  // Adding the same candidate twice is a no-op, not a duplicate operator.
  const repeat = await t.mutation(api.network.addOperator, {
    candidateId,
    name: "Example Bali Operator",
    country: "Indonesia",
    destinationSlugs: ["bali"],
    minGroupSize: 8,
    maxGroupSize: 20,
  });
  expect(repeat).toEqual({ slug: researched.slug, created: false });
  expect((await t.query(api.network.list, {})).length).toBe(listed.length);
});

test("an operator that has never quoted can leave the network, and one that has cannot", async () => {
  const t = convexTest(schema, modules).withIdentity({ subject: "advisor" });
  await t.mutation(api.network.ensureWorkspace, {});
  const removable = await t.mutation(api.network.addOperator, {
    name: "Temporary Operator",
    country: "Portugal",
    destinationSlugs: ["portugal"],
    minGroupSize: 8,
    maxGroupSize: 20,
  });
  const before = (await t.query(api.network.list, {})).length;
  await t.mutation(api.network.removeOperator, { operatorSlug: removable.slug });
  expect((await t.query(api.network.list, {})).length).toBe(before - 1);

  const { briefId } = await t.mutation(api.briefs.create, {
    brief,
    selectedDestinationSlugs: ["bali"],
  });
  await t.mutation(api.briefs.setShortlist, {
    briefId,
    operators: [
      {
        operatorSlug: "p1",
        operatorName: "Island Wellbeing Indonesia",
        capabilityToken: token("r"),
      },
    ],
  });
  await t.mutation(api.proposals.submitByToken, {
    token: token("r"),
    proposal: {
      programName: "Bali Reset",
      basedOnExistingProgram: true,
      basedOnProgramSlug: "t1",
      destinationSlug: "bali",
      startDate: "2027-10-15",
      endDate: "2027-10-22",
      nights: 7,
      availability: "Confirmation Required" as const,
      groupSizeAccepted: 16,
      hotelLevel: "4-star",
      hotelNotes: "",
      transportation: ["private_transportation"],
      experiencesIncluded: ["yoga"],
      requirementsMet: ["strong_wellness_focus"],
      changesOrAdditions: [],
      cannotProvide: [],
      finalFit: 92,
      netPricePerPerson: 2150,
      currency: "USD",
      pricingAssumptions: "",
      depositPercent: 25,
      depositDueDaysBefore: 120,
      finalHeadcountDaysBefore: 75,
      finalPaymentDaysBefore: 45,
      travelerNamesDaysBefore: 45,
      roomReleaseDaysBefore: 60,
      cancellationTerms: [],
      operatorNotes: "",
    },
  });
  await expect(
    t.mutation(api.network.removeOperator, { operatorSlug: "p1" }),
  ).rejects.toThrow("has answered a brief");
});

test("the CLI seed writes into a named workspace without touching another", async () => {
  const t = convexTest(schema, modules);
  const result = await t.mutation(internal.network.seed, { owner: "ops" });
  expect(result.operators).toBe(seedOperators.length);
  const advisor = t.withIdentity({ subject: "advisor" });
  expect(await advisor.query(api.network.list, {})).toEqual([]);
  await advisor.mutation(api.network.ensureWorkspace, {});
  expect((await advisor.query(api.network.list, {})).length).toBe(
    seedOperators.length,
  );
});
