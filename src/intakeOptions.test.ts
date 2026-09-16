import { expect, test } from "vitest";
import {
  autoTripName,
  bookingOpenItems,
  emptyProfile,
  invalidatesAssumptions,
  setAnswer,
  setProfileAnswer,
  isIndividualLane,
  pricingAssumptions,
  suggestRequirements,
  supplierMustReturn,
  validateIntake,
  type Profile,
  } from "./intakeOptions";

test("accepting the assumptions is not itself an answer that withdraws them", () => {
  expect(invalidatesAssumptions("assumptionsAccepted")).toBe(false);
  expect(invalidatesAssumptions("assumptions")).toBe(false);
  expect(invalidatesAssumptions("title")).toBe(false);
  for (const source of [
    "destination",
    "startDate",
    "endDate",
    "travellers",
    "groupStory",
    "goodDay",
    "needs",
    "budgetBand",
    "budgetCovers",
    "guardrails",
    "dateFlexibility",
  ])
    expect(invalidatesAssumptions(source)).toBe(true);
});

test("the accept box can be ticked and stays ticked", () => {
  const base = {
    title: "",
    destination: "Northern Portugal",
    startDate: "2026-11-10",
    endDate: "2026-11-16",
    travellers: 16,
    brief: "A walking club.",
    requirements: "Step-free rooms",
    profile: { ...filled, assumptionsAccepted: false },
  };
  // Ticking the box.
  const accepted = setProfileAnswer(base, "assumptionsAccepted", true);
  expect(accepted.profile.assumptionsAccepted).toBe(true);
  // Continuing past the step records the assumptions and must not withdraw it.
  const withAssumptions = setProfileAnswer(accepted, "assumptions", [
    "Price the group twice.",
  ]);
  expect(withAssumptions.profile.assumptionsAccepted).toBe(true);
  expect(withAssumptions.profile.assumptions).toEqual(["Price the group twice."]);
  // Naming the trip at the review step is not an answer behind the assumptions.
  expect(setAnswer(withAssumptions, "title", "Lisbon 2026").profile.assumptionsAccepted).toBe(
    true,
  );
});

test("changing a real answer withdraws the approval so nothing stale is priced", () => {
  const accepted = setProfileAnswer(
    {
      title: "",
      destination: "Northern Portugal",
      startDate: "2026-11-10",
      endDate: "2026-11-16",
      travellers: 16,
      brief: "A walking club.",
      requirements: "Step-free rooms",
      profile: { ...filled, assumptionsAccepted: true },
    },
    "budgetBand",
    "Under 1,500 per person",
  );
  expect(accepted.profile.assumptionsAccepted).toBe(false);
  expect(
    setAnswer(accepted, "destination", "Kyoto").profile.assumptionsAccepted,
  ).toBe(false);
});

test("the trip names itself from the finished answers", () => {
  expect(
    autoTripName({
      destination: "Northern Portugal",
      startDate: "2026-11-10",
      endDate: "2026-11-16",
      lane: "community",
    }),
  ).toBe("Northern Portugal · community group · Nov 2026");
  expect(
    autoTripName({
      destination: "Lisbon",
      startDate: "2026-11-28",
      endDate: "2026-12-02",
      lane: "organization",
    }),
  ).toBe("Lisbon · company group · Nov-Dec 2026");
  expect(
    autoTripName({
      destination: "  Kyoto  ",
      startDate: "2026-12-28",
      endDate: "2027-01-04",
      lane: "family",
    }),
  ).toBe("Kyoto · family group · Dec 2026-Jan 2027");
});

test("an unnamed trip still gets a usable name, and never an empty one", () => {
  expect(
    autoTripName({
      destination: "",
      startDate: "2026-11-10",
      endDate: "2026-11-12",
    }),
  ).toBe("Open destination · Nov 2026");
  // Before any dates are chosen the name is still something, not a blank.
  expect(
    autoTripName({ destination: "Lisbon", startDate: "", endDate: "" }),
  ).toBe("Lisbon");
});

const filled: Profile = {
  ...emptyProfile(),
  lane: "community",
  groupStory: "A walking club of sixteen members, led by their chair.",
  goodDay: "A short walk, one local stop, and a long table in the evening.",
  dateFlexibility: "Flexible by a few days",
  rooms: "Twin rooms",
  budgetBand: "2,500 to 4,000 per person",
  budgetCurrency: "USD",
  budgetCovers: ["Accommodation", "Meals", "Transfers"],
  assumptionsAccepted: true,
};

test("one or two travellers are the wrong lane and nothing is collected", () => {
  expect(isIndividualLane("individual")).toBe(true);
  expect(isIndividualLane("community")).toBe(false);
  const errors = validateIntake({
    destination: "Lisbon",
    startDate: "2026-11-10",
    endDate: "2026-11-13",
    travellers: 12,
    profile: { ...filled, lane: "individual" },
  });
  expect(errors.join(" ")).toContain("group tool");
});

test("what the advisor left open becomes an assumption, not another question", () => {
  const sparse = pricingAssumptions({ ...emptyProfile(), lane: "community" }, 16);
  const text = sparse.join(" ");
  expect(text).toContain("working dates");
  expect(text).toContain("shared twin rooms");
  expect(text).toContain("indicative price");
  expect(text).toContain("land only");
  expect(text).toContain("16 travellers");
  // Never an interrogative: an assumption is a statement a supplier can price.
  expect(text).not.toContain("?");
});

test("answers that were given do not become assumptions", () => {
  const text = pricingAssumptions(filled, 16).join(" ");
  expect(text).not.toContain("shared twin rooms");
  expect(text).not.toContain("indicative price");
  expect(text).not.toContain("one-day move");
  expect(text).toContain("16 travellers");
});

test("accessibility and dietary needs turn into priced assumptions", () => {
  const text = pricingAssumptions(
    {
      ...filled,
      needs: ["Step-free access", "Dietary requirements"],
    },
    14,
  ).join(" ");
  expect(text).toContain("step-free accommodation without a supplement");
  expect(text).toContain("vegetarian, vegan and gluten-aware");
});

test("open items are separated from anything a supplier needs in order to price", () => {
  const items = bookingOpenItems({
    ...filled,
    boundaries: "The exact dietary list follows before booking.",
  });
  expect(items[0]).toContain("headcount");
  expect(items.join(" ")).toContain("Dietary and allergy roster");
  // Nothing here is a price blocker, and the brief says so.
  expect(bookingOpenItems(filled).length).toBeGreaterThanOrEqual(2);
});

test("guardrails become requirements so a supplier cannot quietly propose them", () => {
  const requirements = suggestRequirements(
    { ...filled, guardrails: ["Steep paths or stair-heavy days", "Very early starts"] },
    16,
  ).split("\n");
  expect(requirements).toContain("Avoid: steep paths or stair-heavy days");
  expect(requirements).toContain("Avoid: very early starts");
  expect(requirements).toContain("Rooming for 16 people as one group");
});

test("nothing named in the requirements may leak the budget", () => {
  const requirements = suggestRequirements(filled, 16);
  expect(requirements.toLowerCase()).not.toContain("4,000");
  expect(requirements.toLowerCase()).not.toContain("budget");
});

test("the brief tells every supplier exactly what to return", () => {
  const lines = supplierMustReturn(16);
  expect(lines[0]).toContain("16 travellers");
  expect(lines.join(" ")).toContain("Inclusions, exclusions");
  expect(lines.join(" ")).toContain("met, partly met, or unavailable");
  expect(lines.join(" ")).toContain("cancellation terms");
});

test("a thin answer is caught before it reaches a supplier", () => {
  const errors = validateIntake({
    destination: "Lisbon",
    startDate: "2026-11-10",
    endDate: "2026-11-13",
    travellers: 16,
    profile: { ...emptyProfile(), lane: "community" },
  });
  expect(errors.join(" ")).toContain("Describe the group");
  expect(errors.join(" ")).toContain("good day");
  expect(errors.join(" ")).toContain("pricing assumptions");
});

test("a complete brief passes with no errors", () => {
  expect(
    validateIntake({
      destination: "Northern Portugal",
      startDate: "2026-11-10",
      endDate: "2026-11-16",
      travellers: 16,
      profile: filled,
    }),
  ).toEqual([]);
});

test("a group smaller than three is refused", () => {
  const errors = validateIntake({
    destination: "Lisbon",
    startDate: "2026-11-10",
    endDate: "2026-11-13",
    travellers: 2,
    profile: filled,
  });
  expect(errors.join(" ")).toContain("starts at three");
});
