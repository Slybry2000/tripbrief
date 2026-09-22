/// <reference types="vite/client" />
// A pick names the comparison it was made on, and the server refuses it when that
// comparison has moved underneath the agency.
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { demoBrief as brief } from "./fixtures.test";
import { comparisonFingerprint, STALE_PICK_MESSAGE } from "../src/lib/pickFingerprint";

const modules = import.meta.glob("./**/*.ts");
const token = (letter: string) => letter.repeat(43);

const proposal = {
  programName: "Ubud Quiet Week",
  basedOnExistingProgram: false,
  basedOnProgramSlug: "",
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
  requirementsMet: [],
  changesOrAdditions: [],
  cannotProvide: [],
  finalFit: 80,
  netPricePerPerson: 2450,
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
  requirementAnswers: [
    { key: "budget", answer: "yes" as const, note: "Inside the net." },
    { key: "rooms", answer: "partly" as const, note: "Two singles on request." },
  ],
};

// Two operators shortlisted and the first one answered: a comparison worth picking from.
async function comparing() {
  const t = convexTest(schema, modules).withIdentity({ subject: "advisor" });
  const { briefId } = await t.mutation(api.briefs.create, {
    brief,
    selectedDestinationSlugs: ["bali"],
  });
  await t.mutation(api.briefs.setShortlist, {
    briefId,
    operators: [
      { operatorSlug: "p1", operatorName: "Island Wellbeing Indonesia", capabilityToken: token("a") },
      { operatorSlug: "p2", operatorName: "Kawi Journeys", capabilityToken: token("b") },
    ],
  });
  const { proposalId } = await t.mutation(api.proposals.submitByToken, {
    token: token("a"),
    proposal,
  });
  return { t, briefId, proposalId };
}

type Tester = Awaited<ReturnType<typeof comparing>>["t"];

// Exactly what the page does: fingerprint the proposals the live query returned.
async function look(t: Tester, briefId: Id<"briefs">) {
  const bundle = await t.query(api.briefs.get, { briefId });
  return comparisonFingerprint(bundle!.proposals.map((row) => ({ ...row, id: row._id }))).overall;
}

async function status(t: Tester, briefId: Id<"briefs">) {
  return (await t.query(api.briefs.get, { briefId }))!.brief.status;
}

test("a pick made on the current comparison is recorded", async () => {
  const { t, briefId, proposalId } = await comparing();
  const seenFingerprint = await look(t, briefId);
  await t.mutation(api.briefs.recordDecision, { briefId, proposalId, seenFingerprint });
  const bundle = await t.query(api.briefs.get, { briefId });
  expect(bundle!.brief.status).toBe("selected");
  expect(bundle!.brief.selectedProposalId).toBe(proposalId);
});

test("a pick is refused when a new reply landed after the agency looked", async () => {
  const { t, briefId, proposalId } = await comparing();
  const seenFingerprint = await look(t, briefId);
  await t.mutation(api.proposals.submitByToken, {
    token: token("b"),
    proposal: { ...proposal, programName: "Lombok Slow Week", netPricePerPerson: 1990 },
  });
  await expect(
    t.mutation(api.briefs.recordDecision, { briefId, proposalId, seenFingerprint }),
  ).rejects.toThrow(STALE_PICK_MESSAGE);
  expect(await status(t, briefId)).not.toBe("selected");
  // A fresh look is all it takes.
  await t.mutation(api.briefs.recordDecision, {
    briefId,
    proposalId,
    seenFingerprint: await look(t, briefId),
  });
  expect(await status(t, briefId)).toBe("selected");
});

test("a pick is refused when an operator revised its price", async () => {
  const { t, briefId, proposalId } = await comparing();
  const seenFingerprint = await look(t, briefId);
  await t.mutation(api.proposals.submitByToken, {
    token: token("a"),
    proposal: { ...proposal, netPricePerPerson: 2650 },
  });
  await expect(
    t.mutation(api.briefs.recordDecision, { briefId, proposalId, seenFingerprint }),
  ).rejects.toThrow(STALE_PICK_MESSAGE);
  expect(await status(t, briefId)).not.toBe("selected");
});

test("a pick is refused when an operator revised one requirement answer", async () => {
  const { t, briefId, proposalId } = await comparing();
  const seenFingerprint = await look(t, briefId);
  await t.mutation(api.proposals.submitByToken, {
    token: token("a"),
    proposal: {
      ...proposal,
      requirementAnswers: [
        proposal.requirementAnswers[0],
        { key: "rooms", answer: "no" as const, note: "No singles after all." },
      ],
    },
  });
  await expect(
    t.mutation(api.briefs.recordDecision, { briefId, proposalId, seenFingerprint }),
  ).rejects.toThrow(STALE_PICK_MESSAGE);
});

test("bookkeeping that does not change the offer never invalidates a pick", async () => {
  const { t, briefId, proposalId } = await comparing();
  const seenFingerprint = await look(t, briefId);
  // The alert sweep announcing the arrival, and a standardisation stamp.
  await t.run(async (ctx) => {
    await ctx.db.patch("proposals", proposalId, {
      announcedAt: Date.now(),
      standardisedAt: Date.now(),
      standardisedBy: "advisor",
    });
  });
  // The operator pressing submit again on the same offer restamps submittedAt.
  await t.mutation(api.proposals.submitByToken, { token: token("a"), proposal });
  await t.mutation(api.briefs.recordDecision, { briefId, proposalId, seenFingerprint });
  expect(await status(t, briefId)).toBe("selected");
});

test("the server's fingerprint does not depend on the order proposals are read in", async () => {
  const { t, briefId, proposalId } = await comparing();
  await t.mutation(api.proposals.submitByToken, {
    token: token("b"),
    proposal: { ...proposal, programName: "Lombok Slow Week", netPricePerPerson: 1990 },
  });
  const bundle = await t.query(api.briefs.get, { briefId });
  const rows = bundle!.proposals.map((row) => ({ ...row, id: row._id }));
  // A page that sorted its columns differently still carries the same fingerprint.
  const seenFingerprint = comparisonFingerprint([...rows].reverse()).overall;
  expect(seenFingerprint).toBe(comparisonFingerprint(rows).overall);
  await t.mutation(api.briefs.recordDecision, { briefId, proposalId, seenFingerprint });
  expect(await status(t, briefId)).toBe("selected");
});
