/// <reference types="vite/client" />
// What the numbered requirements are for, pinned end to end on the backend: an
// operator answers them through its link, an emailed answer only stands on the
// operator's own words, and the operator never learns what the client pays.
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { cleanAnswers, figuresIn, validateDraft } from "./proposals";
import schema from "./schema";
import { demoBrief as brief } from "./fixtures.test";

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
};

async function withShortlist() {
  const t = convexTest(schema, modules).withIdentity({ subject: "advisor" });
  const { briefId } = await t.mutation(api.briefs.create, {
    brief,
    selectedDestinationSlugs: ["bali", "thailand"],
  });
  await t.mutation(api.briefs.setShortlist, {
    briefId,
    operators: [
      { operatorSlug: "p1", operatorName: "Island Wellbeing Indonesia", capabilityToken: token("a") },
    ],
  });
  return { t, briefId };
}

test("the operator's copy of the brief carries the net to quote, never the client's price", async () => {
  const { t } = await withShortlist();
  const seen = await t.query(api.briefs.forOperatorToken, { token: token("a") });
  expect(seen).not.toBeNull();
  expect(seen!.targetNetPerPerson).toBe(2625);
  expect(JSON.stringify(seen)).not.toContain("3500");
  expect("targetRetailPricePerPerson" in seen!).toBe(false);
  // The places the agency approved travel with the request, in order.
  expect(seen!.approvedDestinations.map((item) => item.slug)).toEqual(["bali", "thailand"]);
});

test("an operator's requirement answers are stored and read back through its link", async () => {
  const { t, briefId } = await withShortlist();
  await t.mutation(api.proposals.submitByToken, {
    token: token("a"),
    proposal: {
      ...proposal,
      requirementAnswers: [
        { key: "budget", answer: "yes", note: "Inside the net." },
        { key: "rooms", answer: "partly", note: "Two singles on request." },
        { key: "rooms", answer: "no", note: "Changed my mind." },
      ],
    },
  });
  const own = await t.query(api.proposals.byOperatorToken, { token: token("a") });
  // One answer per requirement: the last one given stands.
  expect(own!.requirementAnswers).toEqual([
    { key: "budget", answer: "yes", note: "Inside the net." },
    { key: "rooms", answer: "no", note: "Changed my mind." },
  ]);
  const bundle = await t.query(api.briefs.get, { briefId });
  expect(bundle!.proposals[0].requirementAnswers).toHaveLength(2);
});

test("reading a proposal back still works once its arrival has been announced", async () => {
  const { t } = await withShortlist();
  const { proposalId } = await t.mutation(api.proposals.submitByToken, {
    token: token("a"),
    proposal,
  });
  // The alert sweep stamps this; the operator's read must not trip over it.
  await t.run(async (ctx) => {
    await ctx.db.patch("proposals", proposalId, { announcedAt: Date.now() });
  });
  const own = await t.query(api.proposals.byOperatorToken, { token: token("a") });
  expect(own!.programName).toBe("Ubud Quiet Week");
  expect("announcedAt" in own!).toBe(false);
});

test("an emailed proposal without a start date is refused with a reason, not recorded blank", async () => {
  const { t, briefId } = await withShortlist();
  await expect(
    t.mutation(api.proposals.recordEmailed, {
      briefId,
      operatorSlug: "p1",
      sourceText: "We can do it for 2,300 per person.",
      standardised: true,
      proposal: { ...proposal, startDate: "" },
    }),
  ).rejects.toThrow("start date");
});

test("a drafted requirement answer stands only on a quote that is really in the reply", () => {
  const reply =
    "We can host 16 guests. Net is 2,380 USD per person, land only. We cannot hold two singles in October.";
  const requirements = [
    { key: "travelerCount", id: "R3", label: "Group size", statement: "16 travellers" },
    { key: "budget", id: "R1", label: "Budget", statement: "A net of $2,625" },
    { key: "rooms", id: "R6", label: "Rooms and occupancy", statement: "8 twins, 2 singles" },
    { key: "ages", id: "R5", label: "Ages", statement: "48 to 67" },
  ];
  const raw = {
    draft: {
      programName: "Chiang Mai Week",
      startDate: "2027-10-16",
      requirementAnswers: [
        { key: "travelerCount", answer: "yes", note: "", quote: "We can host 16 guests." },
        { key: "budget", answer: "yes", note: "", quote: "Net is 2,380 USD per person, land only." },
        // Invented: the operator never wrote this.
        { key: "rooms", answer: "yes", note: "", quote: "Singles are no problem." },
        // Not addressed in the reply: never an answer.
        { key: "ages", answer: "not_stated", note: "", quote: "" },
      ],
    },
    evidence: [{ field: "netPricePerPerson", quote: "Net is 2,380 USD per person" }],
    caveats: [],
  };
  const result = validateDraft(raw, reply, brief, [{ slug: "thailand", name: "Thailand" }], {
    requirements,
  });
  expect(result.draft.requirementAnswers.map((item) => item.key)).toEqual([
    "travelerCount",
    "budget",
  ]);
  expect(result.droppedEvidence).toContain("R6 Rooms and occupancy");
  expect(result.droppedEvidence).not.toContain("R5 Ages");
});

test("answers are bounded and one per requirement", () => {
  const many = Array.from({ length: 60 }, (_, index) => ({
    key: `k${index}`,
    answer: "yes" as const,
    note: "x".repeat(2_000),
  }));
  const cleaned = cleanAnswers(many);
  expect(cleaned).toHaveLength(40);
  expect(cleaned[0].note.length).toBeLessThanOrEqual(600);
});

test("a figure is read the way an operator writes it", () => {
  expect(figuresIn("Net is 2,380 USD")).toEqual([2380]);
  expect(figuresIn("2.380 EUR por persona")).toEqual([2380]);
  expect(figuresIn("IDR 38 500 000 each")).toEqual([38500000]);
  expect(figuresIn("a 12.5% deposit, 16 guests")).toEqual([12.5, 16]);
  // A separator is punctuation or a space, never a digit or a letter: an
  // earlier build read the zeros in "10000" as separators and saw 1000.
  expect(figuresIn("a 10000 IDR fee in 2027")).toEqual([10000, 2027]);
  expect(figuresIn(`2${String.fromCharCode(160)}380 per person`)).toEqual([2380]);
});

// A real quote can still sit beside a number nobody wrote. These pin the rule
// that each figure the comparison is decided on must be inside its own quote.
const figureReply =
  "We can host 16 guests. Net is 2,380 USD per person, land only. A 30% deposit secures the dates.";
const figureDraft = (draft: Record<string, unknown>, evidence: { field: string; quote: string }[]) =>
  validateDraft(
    { draft: { programName: "Chiang Mai Week", startDate: "2027-10-16", ...draft }, evidence, caveats: [] },
    figureReply,
    brief,
    [{ slug: "thailand", name: "Thailand" }],
  );

test("a price stands only when the operator's quote for it states that price", () => {
  const kept = figureDraft({ netPricePerPerson: 2380 }, [
    { field: "netPricePerPerson", quote: "Net is 2,380 USD per person" },
  ]);
  expect(kept.draft.netPricePerPerson).toBe(2380);

  // The quote is genuine, but the price the model put beside it is not in it.
  const invented = figureDraft({ netPricePerPerson: 2600 }, [
    { field: "netPricePerPerson", quote: "Net is 2,380 USD per person" },
  ]);
  expect(invented.draft.netPricePerPerson).toBe(0);
  expect(invented.droppedEvidence).toContain("Net price per person: not in the operator's words");
});

test("a figure borrowed from a different sentence of the reply does not count", () => {
  // 16 is in the reply, but only the price was quoted: the group size has no
  // quote of its own, so it is cleared rather than trusted.
  const borrowed = figureDraft({ groupSizeAccepted: 16, depositPercent: 30 }, [
    { field: "netPricePerPerson", quote: "Net is 2,380 USD per person" },
    { field: "depositPercent", quote: "A 30% deposit secures the dates." },
  ]);
  expect(borrowed.draft.groupSizeAccepted).toBe(0);
  expect(borrowed.draft.depositPercent).toBe(30);
  expect(borrowed.droppedEvidence).toContain("Group size accepted: not in the operator's words");
});

test("an answer's note may not state a number its quote does not contain", () => {
  const result = validateDraft(
    {
      draft: {
        programName: "Chiang Mai Week",
        startDate: "2027-10-16",
        requirementAnswers: [
          // Real quote, invented figure in the note.
          { key: "budget", answer: "yes", note: "Comes in at 2,600 per person", quote: "Net is 2,380 USD per person, land only." },
          { key: "travelerCount", answer: "yes", note: "All 16 fit", quote: "We can host 16 guests." },
        ],
      },
      evidence: [{ field: "netPricePerPerson", quote: "Net is 2,380 USD per person" }],
      caveats: [],
    },
    figureReply,
    brief,
    [{ slug: "thailand", name: "Thailand" }],
    {
      requirements: [
        { key: "budget", id: "R1", label: "Budget", statement: "A net of $2,625" },
        { key: "travelerCount", id: "R3", label: "Group size", statement: "16 travellers" },
      ],
    },
  );
  const byKey = new Map(result.draft.requirementAnswers.map((item) => [item.key, item]));
  // The answer and the operator's words stay; only the unsupported note goes.
  expect(byKey.get("budget")?.answer).toBe("yes");
  expect(byKey.get("budget")?.quote).toBe("Net is 2,380 USD per person, land only.");
  expect(byKey.get("budget")?.note).toBe("");
  expect(byKey.get("travelerCount")?.note).toBe("All 16 fit");
  expect(result.droppedEvidence).toContain("R1 Budget: a figure not in the quote");
});
