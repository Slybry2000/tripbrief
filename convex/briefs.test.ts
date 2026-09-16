/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

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

const proposal = {
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
  hotelNotes: "One property, no hotel changes.",
  transportation: ["private_transportation", "airport_transfers"],
  experiencesIncluded: ["yoga", "meditation"],
  requirementsMet: ["strong_wellness_focus"],
  changesOrAdditions: ["Adds one cooking session"],
  cannotProvide: ["Spa on the final morning"],
  finalFit: 92,
  netPricePerPerson: 2150,
  currency: "USD",
  pricingAssumptions: "Based on 16 travellers in double rooms.",
  depositPercent: 25,
  depositDueDaysBefore: 120,
  finalHeadcountDaysBefore: 75,
  finalPaymentDaysBefore: 45,
  travelerNamesDaysBefore: 45,
  roomReleaseDaysBefore: 60,
  cancellationTerms: [{ daysBefore: 90, penalty: "25%" }],
  operatorNotes: "Dates to be confirmed on request.",
};

test("anonymous requests fail closed and separate workspaces cannot see each other", async () => {
  const t = convexTest(schema, modules);
  expect(await t.query(api.briefs.list, {})).toEqual([]);
  await expect(
    t.mutation(api.briefs.create, { brief, selectedDestinationSlugs: [] }),
  ).rejects.toThrow("sign in");

  const alice = t.withIdentity({ subject: "alice|session1" });
  const bob = t.withIdentity({ subject: "bob|session1" });
  const { briefId } = await alice.mutation(api.briefs.create, {
    brief,
    selectedDestinationSlugs: [],
  });
  expect(await bob.query(api.briefs.list, {})).toEqual([]);
  expect(await bob.query(api.briefs.get, { briefId })).toBeNull();
  await expect(
    bob.mutation(api.briefs.save, { briefId, brief }),
  ).rejects.toThrow("not found");
  expect((await alice.query(api.briefs.list, {}))[0]._id).toBe(briefId);
  // The same person in a new session still owns the brief.
  const aliceAgain = t.withIdentity({ subject: "alice|session2" });
  expect((await aliceAgain.query(api.briefs.list, {}))[0].name).toBe(
    "Wellness Escape",
  );
});

test("the brief round-trips, and changing the locations empties everything downstream", async () => {
  const t = convexTest(schema, modules).withIdentity({ subject: "advisor" });
  const { briefId } = await t.mutation(api.briefs.create, {
    brief,
    selectedDestinationSlugs: ["bali"],
  });
  await t.mutation(api.briefs.setShortlist, {
    briefId,
    operators: [
      { operatorSlug: "p1", operatorName: "Island Wellbeing Indonesia", capabilityToken: token("a") },
    ],
  });
  let bundle = await t.query(api.briefs.get, { briefId });
  expect(bundle!.brief.name).toBe("Wellness Escape");
  expect(bundle!.brief.selectedDestinationSlugs).toEqual(["bali"]);
  expect(bundle!.shortlist).toHaveLength(1);

  // Same locations again: nothing downstream is discarded.
  await t.mutation(api.briefs.setDestinations, {
    briefId,
    destinationSlugs: ["bali"],
  });
  bundle = await t.query(api.briefs.get, { briefId });
  expect(bundle!.shortlist).toHaveLength(1);

  // A different customer-approved location invalidates the shortlist.
  await t.mutation(api.briefs.setDestinations, {
    briefId,
    destinationSlugs: ["costa-rica"],
  });
  bundle = await t.query(api.briefs.get, { briefId });
  expect(bundle!.shortlist).toEqual([]);
  expect(bundle!.brief.selectedDestinationSlugs).toEqual(["costa-rica"]);
});

test("a shortlist holds at most five operators, and a submitted answer cannot be dropped", async () => {
  const t = convexTest(schema, modules).withIdentity({ subject: "advisor" });
  const { briefId } = await t.mutation(api.briefs.create, {
    brief,
    selectedDestinationSlugs: ["bali", "thailand"],
  });
  const six = ["p1", "p2", "p3", "p4", "p5", "p6"].map((slug, index) => ({
    operatorSlug: slug,
    operatorName: `Operator ${index + 1}`,
    capabilityToken: token("abcdefghij"[index]),
  }));
  await expect(
    t.mutation(api.briefs.setShortlist, { briefId, operators: six }),
  ).rejects.toThrow("up to 5");
  await expect(
    t.mutation(api.briefs.setShortlist, {
      briefId,
      operators: [{ ...six[0], capabilityToken: "too-short" }],
    }),
  ).rejects.toThrow("malformed");

  await t.mutation(api.briefs.setShortlist, { briefId, operators: six.slice(0, 5) });
  const submitted = await t.query(api.network.forToken, { token: token("a") });
  await t.mutation(api.proposals.submitByToken, {
    token: token("a"),
    proposal,
  });
  expect(submitted).not.toBeNull();
  await expect(
    t.mutation(api.briefs.setShortlist, { briefId, operators: six.slice(1, 5) }),
  ).rejects.toThrow("already submitted");
  // The answered operator is still on the brief after the refusal.
  const bundle = await t.query(api.briefs.get, { briefId });
  expect(bundle!.shortlist.map((row) => row.operatorSlug).sort()).toEqual([
    "p1",
    "p2",
    "p3",
    "p4",
    "p5",
  ]);
});

test("a decision can only name a proposal that belongs to the brief", async () => {
  const t = convexTest(schema, modules).withIdentity({ subject: "advisor" });
  const first = await t.mutation(api.briefs.create, {
    brief,
    selectedDestinationSlugs: ["bali"],
  });
  const second = await t.mutation(api.briefs.create, {
    brief: { ...brief, name: "Second brief" },
    selectedDestinationSlugs: ["bali"],
  });
  await t.mutation(api.briefs.setShortlist, {
    briefId: second.briefId,
    operators: [
      { operatorSlug: "p1", operatorName: "Island Wellbeing Indonesia", capabilityToken: token("a") },
    ],
  });
  const { proposalId } = await t.mutation(api.proposals.submitByToken, {
    token: token("a"),
    proposal,
  });
  await expect(
    t.mutation(api.briefs.recordDecision, {
      briefId: first.briefId,
      proposalId,
    }),
  ).rejects.toThrow("does not belong");
  await t.mutation(api.briefs.recordDecision, {
    briefId: second.briefId,
    proposalId,
    reason: "Strongest final fit, and the operator confirmed the window.",
  });
  const bundle = await t.query(api.briefs.get, { briefId: second.briefId });
  expect(bundle!.brief.status).toBe("selected");
  expect(bundle!.brief.selectedProposalId).toBe(proposalId);
  // A selected brief is closed to further edits.
  await expect(
    t.mutation(api.briefs.save, { briefId: second.briefId, brief }),
  ).rejects.toThrow("already been selected");
});

test("deleting a brief removes its proposals, its operators and the mail it received", async () => {
  const t = convexTest(schema, modules).withIdentity({ subject: "advisor" });
  const { briefId } = await t.mutation(api.briefs.create, {
    brief,
    selectedDestinationSlugs: ["bali"],
  });
  await t.mutation(api.briefs.setShortlist, {
    briefId,
    operators: [
      { operatorSlug: "p1", operatorName: "Island Wellbeing Indonesia", capabilityToken: token("a") },
    ],
  });
  await t.mutation(api.proposals.submitByToken, {
    token: token("a"),
    proposal,
  });
  const owner = (await t.query(api.briefs.one, { briefId }))!.owner;
  await t.mutation(internal.inboxes.attach, {
    briefId,
    owner,
    inboxId: "inbox-1",
    email: "requests@inbox.example",
  });
  await t.mutation(internal.replies.record, {
    inboxId: "inbox-1",
    fromEmail: "hello@operator.example",
    subject: "Re: Trip request",
    text: "We can operate these dates.",
    messageId: "m1",
    receivedAt: Date.now(),
  });
  expect((await t.query(api.replies.list, { briefId })).length).toBe(1);

  await t.mutation(api.briefs.remove, { briefId });
  expect(await t.query(api.briefs.get, { briefId })).toBeNull();
  const rows = await t.run(async (ctx) => ({
    proposals: await ctx.db.query("proposals").take(10),
    operators: await ctx.db.query("briefOperators").take(10),
    messages: await ctx.db.query("inboxMessages").take(10),
  }));
  expect(rows).toEqual({ proposals: [], operators: [], messages: [] });
});
