/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
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
  availability: "Available" as const,
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
  operatorNotes: "Dates held on request.",
};

async function withShortlist() {
  const base = convexTest(schema, modules);
  const t = base.withIdentity({ subject: "advisor" });
  const { briefId } = await t.mutation(api.briefs.create, {
    brief,
    selectedDestinationSlugs: ["bali", "costa-rica"],
  });
  await t.mutation(api.briefs.setShortlist, {
    briefId,
    operators: [
      { operatorSlug: "p1", operatorName: "Island Wellbeing Indonesia", capabilityToken: token("a") },
      { operatorSlug: "p2", operatorName: "Costa Verde Wellness", capabilityToken: token("b") },
    ],
  });
  return { t, base, briefId };
}

test("a proposal needs a live link, and a complete one moves the brief to comparing", async () => {
  const { t, briefId } = await withShortlist();
  await expect(
    t.mutation(api.proposals.submitByToken, {
      token: token("z"),
      proposal,
    }),
  ).rejects.toThrow("no longer active");
  await expect(
    t.mutation(api.proposals.submitByToken, {
      token: token("a"),
      proposal: { ...proposal, programName: "", netPricePerPerson: 0 },
    }),
  ).rejects.toThrow("program name");
  expect(await t.query(api.proposals.byOperatorToken, { token: token("a") })).toBeNull();

  await t.mutation(api.proposals.submitByToken, { token: token("a"), proposal });
  const bundle = await t.query(api.briefs.get, { briefId });
  expect(bundle!.brief.status).toBe("comparing");
  expect(bundle!.shortlist.find((row) => row.operatorSlug === "p1")!.status).toBe(
    "submitted",
  );
  expect(bundle!.proposals).toHaveLength(1);
  expect(bundle!.proposals[0]).toMatchObject({
    operatorSlug: "p1",
    programName: "Bali Reset",
    finalFit: 92,
    netPricePerPerson: 2150,
    availability: "Available",
  });
});

test("each operator's link writes only its own proposal, and a revision replaces it", async () => {
  const { t, briefId } = await withShortlist();
  await t.mutation(api.proposals.submitByToken, { token: token("a"), proposal });
  await t.mutation(api.proposals.submitByToken, {
    token: token("b"),
    proposal: {
      ...proposal,
      programName: "Costa Rica Wellness Week",
      destinationSlug: "costa-rica",
      netPricePerPerson: 2400,
      finalFit: 84,
    },
  });
  let bundle = await t.query(api.briefs.get, { briefId });
  expect(
    bundle!.proposals.map((row) => [row.operatorSlug, row.programName]).sort(),
  ).toEqual([
    ["p1", "Bali Reset"],
    ["p2", "Costa Rica Wellness Week"],
  ]);

  // p1 revises its own answer: one row per operator, never two.
  await t.mutation(api.proposals.submitByToken, {
    token: token("a"),
    proposal: { ...proposal, netPricePerPerson: 2050, programName: "Bali Reset (revised)" },
  });
  bundle = await t.query(api.briefs.get, { briefId });
  expect(bundle!.proposals).toHaveLength(2);
  const p1 = bundle!.proposals.find((row) => row.operatorSlug === "p1")!;
  expect(p1.programName).toBe("Bali Reset (revised)");
  expect(p1.netPricePerPerson).toBe(2050);
  const p2 = bundle!.proposals.find((row) => row.operatorSlug === "p2")!;
  expect(p2.programName).toBe("Costa Rica Wellness Week");
});

test("a proposal that came by email is recorded by the advisor, with the operator's own words kept", async () => {
  const { t, base, briefId } = await withShortlist();
  const sourceText =
    "We can operate 15-22 October. Net is USD 2,150 per person, 25% deposit 120 days out.";
  await t.mutation(api.proposals.recordEmailed, {
    briefId,
    operatorSlug: "p1",
    proposal,
    sourceText,
    standardised: true,
  });
  const bundle = await t.query(api.briefs.get, { briefId });
  expect(bundle!.proposals[0].submittedVia).toBe("email_import");
  const stored = await t.run(async (ctx) => ctx.db.query("proposals").take(1));
  expect(stored[0].sourceText).toBe(sourceText);
  expect(stored[0].standardisedAt).toBeGreaterThan(0);

  const other = base.withIdentity({ subject: "someone-else" });
  await expect(
    other.mutation(api.proposals.recordEmailed, {
      briefId,
      operatorSlug: "p1",
      proposal,
      sourceText,
      standardised: false,
    }),
  ).rejects.toThrow("not found");
});

test("AI drafting refuses to run without a configured key and never writes on its own", async () => {
  const { t, briefId } = await withShortlist();
  await expect(
    t.action(api.proposals.draftFromReply, {
      briefId,
      sourceText: "We can do it.",
      destinations: [{ slug: "bali", name: "Bali" }],
    }),
  ).rejects.toThrow("not been configured");
  expect((await t.query(api.briefs.get, { briefId }))!.proposals).toEqual([]);
});
