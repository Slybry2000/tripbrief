import { expect, test } from "vitest";
import { buildQueries, queryPrompt } from "./searchQueries";
import type { Doc } from "./_generated/dataModel";

type TripForSearch = Pick<Doc<"trips">, "destination" | "travelers" | "profile">;

const profile = {
  groupType: "Club or society",
  interests: ["Walking and nature", "Food and wine", "History"],
  needs: ["Step-free access", "Dietary requirements"],
  setting: "Countryside",
  pace: "Relaxed",
  budgetBand: "2,500 to 4,000 per person",
  budgetCurrency: "USD",
};
const trip = {
  destination: "Northern Portugal",
  travelers: 16,
  profile,
} as TripForSearch;

test("the brief writes its own searches", () => {
  const queries = buildQueries(trip);
  expect(queries[0]).toBe("Northern Portugal group travel operator Club or society");
  // A hard need is searched for before a second interest.
  expect(queries.join(" ")).toContain("accessible group accommodation");
  expect(queries.length).toBeLessThanOrEqual(3);
  expect(queries.every((query) => query.length <= 300)).toBe(true);
});

test("what the group needs changes what is searched for", () => {
  const accessible = buildQueries({
    ...trip,
    profile: { ...profile, needs: ["Step-free access"] },
  });
  expect(accessible.join(" ")).toContain("accessible group accommodation");
  const dietary = buildQueries({
    ...trip,
    profile: { ...profile, needs: ["Dietary requirements"] },
  });
  expect(dietary.join(" ")).toContain("dietary requirements");
});

test("with no accessibility needs, the group's interests lead the search", () => {
  const queries = buildQueries({
    ...trip,
    profile: { ...profile, needs: [] },
  });
  expect(queries.join(" ")).toContain("walking and nature group tours");
  expect(queries.join(" ")).not.toContain("accessible");
});

test("a briefly-described trip still produces a usable search", () => {
  const bare = buildQueries({
    destination: "Lisbon",
    travelers: 12,
    profile: undefined,
  });
  expect(bare.length).toBeGreaterThan(0);
  expect(bare[0]).toContain("Lisbon");
});

test("no search ever carries the group's budget or a person", () => {
  for (const query of buildQueries(trip))
    expect(query.toLowerCase()).not.toMatch(/budget|2,500|4,000|usd|price/);
});

test("the model is told the same facts and the same limits", () => {
  const prompt = queryPrompt(trip);
  expect(prompt).toContain("Northern Portugal");
  expect(prompt).toContain("Walking and nature");
  expect(prompt).toContain("Step-free access");
  expect(prompt).toContain("Never include a budget");
  expect(prompt.toLowerCase()).not.toContain("2,500");
});
