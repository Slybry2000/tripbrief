/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { displayName, parseInbox } from "./inboxes";

const modules = import.meta.glob("./**/*.ts");
const token = (letter: string) => letter.repeat(43);

test("an inbox display name survives whatever a brief is called", () => {
  // The mail provider rejects brackets, so a brief named with them must not be
  // able to make sending impossible.
  expect(displayName("Lisbon wellness week (live test)")).toBe(
    "Operator requests - Lisbon wellness week live test",
  );
  expect(displayName("Kyoto · family group — Dec 2026–Jan 2027")).toBe(
    "Operator requests - Kyoto family group Dec 2026 Jan 2027",
  );
  expect(displayName("   ")).toBe("Operator requests - Untitled brief");
  expect(displayName("x".repeat(300)).length).toBeLessThanOrEqual(120);
  expect(displayName("A&B <C>")).not.toMatch(/[&<>()·—]/);
});

test("an inbox reply is only accepted in the documented shape", () => {
  expect(
    parseInbox({ inbox_id: "abc@inbox.example", email: "abc@inbox.example" }),
  ).toEqual({ inboxId: "abc@inbox.example", email: "abc@inbox.example" });
  expect(
    parseInbox({ inboxId: "xyz@inbox.example", email: "xyz@inbox.example" }),
  ).toEqual({ inboxId: "xyz@inbox.example", email: "xyz@inbox.example" });
  expect(() => parseInbox(null)).toThrow("unexpected response");
  expect(() => parseInbox({ inbox_id: "", email: "" })).toThrow("invalid inbox");
  expect(() =>
    parseInbox({ inbox_id: "abc", email: "not-an-address" }),
  ).toThrow("invalid inbox");
});

test("a capability token identifies exactly one row", async () => {
  const t = convexTest(schema, modules).withIdentity({ subject: "advisor" });
  await t.mutation(api.network.ensureWorkspace, {});
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
    desiredExperiences: ["yoga"],
    importantRequirements: ["strong_wellness_focus"],
    travelerTypes: ["private_groups"],
    transportationNeeds: ["private_transportation"],
    accessibilityNeeds: [],
    notes: "",
  };
  const first = await t.mutation(api.briefs.create, {
    brief,
    selectedDestinationSlugs: ["bali"],
  });
  await t.mutation(api.briefs.setShortlist, {
    briefId: first.briefId,
    operators: [
      { operatorSlug: "p1", operatorName: "Island Wellbeing Indonesia", capabilityToken: token("a") },
    ],
  });
  // A second brief cannot claim a link that is already spoken for: a token that
  // resolved to two rows could open someone else's request.
  const second = await t.mutation(api.briefs.create, {
    brief: { ...brief, name: "Second" },
    selectedDestinationSlugs: ["bali"],
  });
  await expect(
    t.mutation(api.briefs.setShortlist, {
      briefId: second.briefId,
      operators: [
        { operatorSlug: "p2", operatorName: "Pura Vida Retreats", capabilityToken: token("a") },
      ],
    }),
  ).rejects.toThrow("already in use");
  // The first brief is untouched by the refusal.
  const bundle = await t.query(api.briefs.get, { briefId: first.briefId });
  expect(bundle!.shortlist).toHaveLength(1);
  expect(
    await t.query(api.network.forToken, { token: token("a") }),
  ).toMatchObject({ kind: "request", operatorSlug: "p1" });
});
