import { describe, expect, test } from "vitest";
import { comparisonFingerprint, type ComparedProposal } from "./pickFingerprint";

const bali: ComparedProposal = {
  id: "p-bali",
  netPricePerPerson: 2150,
  currency: "USD",
  startDate: "2027-10-15",
  endDate: "2027-10-22",
  nights: 7,
  availability: "Available",
  requirementAnswers: [
    { key: "budget", answer: "yes", note: "Inside the net." },
    { key: "rooms", answer: "partly", note: "Two singles on request.", quote: "two singles, on request" },
  ],
};
const lombok: ComparedProposal = { ...bali, id: "p-lombok", netPricePerPerson: 1980 };

describe("comparisonFingerprint", () => {
  test("does not depend on the order proposals or answers come back in", () => {
    const forward = comparisonFingerprint([bali, lombok]);
    const reversed = comparisonFingerprint([
      lombok,
      { ...bali, requirementAnswers: [...bali.requirementAnswers!].reverse() },
    ]);
    expect(reversed.overall).toBe(forward.overall);
    expect(reversed.each).toEqual(forward.each);
  });

  test("changes when a proposal is added, or a deciding field moves", () => {
    const base = comparisonFingerprint([bali]).overall;
    expect(comparisonFingerprint([bali, lombok]).overall).not.toBe(base);
    expect(comparisonFingerprint([{ ...bali, netPricePerPerson: 2151 }]).overall).not.toBe(base);
    expect(comparisonFingerprint([{ ...bali, currency: "EUR" }]).overall).not.toBe(base);
    expect(comparisonFingerprint([{ ...bali, startDate: "2027-10-16" }]).overall).not.toBe(base);
    expect(comparisonFingerprint([{ ...bali, availability: "Held" }]).overall).not.toBe(base);
    const revised = bali.requirementAnswers!.map((item) =>
      item.key === "rooms" ? { ...item, answer: "no" } : item,
    );
    expect(comparisonFingerprint([{ ...bali, requirementAnswers: revised }]).overall).not.toBe(base);
  });

  test("ignores how a reply was typed, and fields it does not weigh", () => {
    const base = comparisonFingerprint([bali]).overall;
    const retyped = {
      ...bali,
      currency: " usd ",
      requirementAnswers: bali.requirementAnswers!.map((item) => ({ ...item, note: `  ${item.note}  ` })),
      // Bookkeeping a stored row carries alongside the offer.
      announcedAt: 1_800_000_000_000,
      submittedAt: 1_700_000_000_000,
    };
    expect(comparisonFingerprint([retyped]).overall).toBe(base);
  });

  test("names each proposal, so the page can say which one moved", () => {
    const before = comparisonFingerprint([bali, lombok]);
    const after = comparisonFingerprint([bali, { ...lombok, netPricePerPerson: 2050 }]);
    expect(after.each["p-bali"]).toBe(before.each["p-bali"]);
    expect(after.each["p-lombok"]).not.toBe(before.each["p-lombok"]);
    expect(comparisonFingerprint([]).overall).toMatch(/^v1-0-[0-9a-f]{16}$/);
  });
});
