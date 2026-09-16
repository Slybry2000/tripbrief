import { expect, test } from "vitest";
import { suggestRequirements, type Profile } from "./intakeOptions";

const empty: Profile = { needs: [], interests: [], styles: [], budgetCovers: [] };

test("every answer the group gives becomes a requirement a supplier can answer", () => {
  const suggestions = suggestRequirements(
    {
      ...empty,
      needs: ["Step-free access", "Dietary requirements"],
      interests: ["History", "Food and wine"],
      styles: ["Private transfers"],
      pace: "Relaxed",
      budgetCovers: ["Accommodation", "Meals"],
    },
    14,
  ).split("\n");
  expect(suggestions).toContain("Step-free or accessible guest rooms");
  expect(suggestions).toContain("Meals that meet the group's dietary requirements");
  expect(suggestions).toContain("A private group transfer from the arrival point");
  expect(suggestions).toContain("Rooming for 14 people as one group");
  expect(suggestions).toContain("No more than one fixed activity per day");
  expect(suggestions).not.toContain("Access to a pool, spa or similar");
});

test("an empty intake still produces one honest requirement", () => {
  expect(suggestRequirements(empty, 0)).toBe(
    "A written quote covering the dates and the group size",
  );
});

test("the budget is never turned into a requirement a supplier sees", () => {
  const suggestions = suggestRequirements(
    { ...empty, budgetBand: "Under 1,500 per person", budgetCurrency: "USD" },
    8,
  );
  expect(suggestions.toLowerCase()).not.toContain("1,500");
  expect(suggestions.toLowerCase()).not.toContain("budget");
});
