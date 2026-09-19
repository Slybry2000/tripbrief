// The requirements list is the contract between a brief and every proposal that
// comes back against it, so the things that make it worth having are pinned here:
// the numbering, the tiers, and the two rules that are easy to get wrong (a
// constraint is not a preference, and a blank is a gap).
import { expect, test } from "vitest";
import requestSeed from "../data/demo-request.json";
import { buildRequirements, hardNoList, missingMusts, requirementCoverage, SPEC } from "./requirements";
import type { TripRequest } from "./types";

const demo = requestSeed as TripRequest;
const empty = { ...demo, desiredExperiences: [], climates: [], notes: "" } as TripRequest;

test("a full brief produces a numbered list in a fixed order", () => {
  const requirements = buildRequirements(demo);
  expect(requirements.length).toBeGreaterThan(10);
  expect(requirements.map((requirement) => requirement.id)).toEqual(
    requirements.map((_, index) => `R${index + 1}`),
  );
  // The same brief always yields the same numbers: that is what makes two
  // operators' answers comparable.
  expect(buildRequirements(demo).map((requirement) => requirement.id)).toEqual(
    requirements.map((requirement) => requirement.id),
  );
  for (const requirement of requirements) expect(requirement.statement.trim()).not.toBe("");
});

test("an operator cannot quote without these, so they are musts", () => {
  const musts = SPEC.filter((spec) => spec.tier === "must").map((spec) => spec.key);
  expect(musts).toContain("budget");
  expect(musts).toContain("dates");
  expect(musts).toContain("travelerCount");
  expect(musts).toContain("rooms");
  expect(musts).toContain("dietaryAndMedical");
  expect(musts).toContain("ages");
  expect(musts).toContain("groupDescription");
  expect(musts).toContain("accessibilityNeeds");
});

test("a constraint is never a numbered preference", () => {
  const requirements = buildRequirements(demo);
  const statements = requirements.map((requirement) => requirement.statement).join(" | ");
  for (const no of hardNoList(demo)) expect(statements).not.toContain(no);
  // It is reported, once, on its own.
  expect(hardNoList(demo)).toContain("no start before 9am");
});

test("what a brief does not answer is reported as a gap, not skipped", () => {
  const stripped: TripRequest = {
    ...empty,
    groupDescription: "",
    ages: "",
    rooms: "",
    dietaryAndMedical: "",
  };
  const missing = missingMusts(stripped).map((item) => item.key);
  expect(missing).toContain("groupDescription");
  expect(missing).toContain("rooms");
  expect(missing).toContain("dietaryAndMedical");
  // A complete brief has nothing missing, and that is the state an advisor is
  // trying to reach before sending anything.
  expect(missingMusts(demo)).toEqual([]);
  // Shoulds and nices are never reported: they shape the trip, they do not gate it.
  const withoutNice: TripRequest = { ...demo, climates: [], notes: "" };
  expect(missingMusts(withoutNice).map((item) => item.key)).not.toContain("climates");
  expect(missingMusts(withoutNice).map((item) => item.key)).not.toContain("notes");
});

test("every requirement carries the question the operator has to answer", () => {
  for (const requirement of buildRequirements(demo)) {
    expect(requirement.ask.length).toBeGreaterThan(10);
    expect(requirement.label.length).toBeGreaterThan(2);
  }
});

test("the packet names the net to quote and never the client's price", () => {
  const budget = buildRequirements(demo).find((requirement) => requirement.key === "budget")!;
  expect(budget.statement).toContain("$2,625");
  expect(budget.statement).not.toContain("3,500");
  // On the operator's side only the net is known, and it produces the same line.
  const operatorSide = { ...demo, targetRetailPricePerPerson: 0, targetNetPerPerson: 2625 } as TripRequest;
  const operatorBudget = buildRequirements(operatorSide).find((requirement) => requirement.key === "budget")!;
  expect(operatorBudget.statement).toBe(budget.statement);
  // And the numbering is identical on both sides, which is what makes answers comparable.
  expect(buildRequirements(operatorSide).map((item) => `${item.id}:${item.key}`)).toEqual(
    buildRequirements(demo).map((item) => `${item.id}:${item.key}`),
  );
});

test("coverage comes from the operator's answers, weighted by tier, and a blank earns nothing", () => {
  const requirements = buildRequirements(demo);
  expect(requirementCoverage(requirements, []).score).toBe(0);
  const all = requirements.map((item) => ({ key: item.key, answer: "yes" as const, note: "" }));
  expect(requirementCoverage(requirements, all).score).toBe(100);
  expect(requirementCoverage(requirements, all).mustsOpen).toEqual([]);
  const partly = all.map((item) => ({ ...item, answer: "partly" as const }));
  expect(requirementCoverage(requirements, partly).score).toBe(50);
  // A "no" on a must is a must left open, and it costs more than a "no" on a nice.
  const noOnMust = all.map((item) => (item.key === "budget" ? { ...item, answer: "no" as const } : item));
  const noOnNice = all.map((item) => (item.key === "notes" ? { ...item, answer: "no" as const } : item));
  expect(requirementCoverage(requirements, noOnMust).mustsOpen).toEqual(["R1"]);
  expect(requirementCoverage(requirements, noOnMust).score).toBeLessThan(
    requirementCoverage(requirements, noOnNice).score,
  );
});
