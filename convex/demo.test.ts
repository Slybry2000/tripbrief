/// <reference types="vite/client" />
// Demo mode, pinned: real operators found on the web become a workspace's own,
// nobody outside the product can be written to, exactly one operator on a brief
// answers everything with a yes, and every other one differs on one or two things.
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { demoBrief as brief } from "./fixtures.test";
import { pickDeviations } from "./demo";
import { shapeReply } from "./demoResponder";
import { readOperators } from "./webOperators";
import { bestEmail, emailsIn, looksLikeDirectory } from "./web";
import { buildRequirements } from "../src/lib/requirements";
import type { Doc } from "./_generated/dataModel";
import type { TripRequest } from "../src/lib/types";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.unstubAllEnvs());

const found = {
  destinationSlug: "bali",
  domain: "explera.id",
  name: "Explera DMC Indonesia",
  country: "Indonesia",
  regions: ["Ubud", "Sanur"],
  website: "https://www.explera.id",
  email: "b2b@explera.id",
  summary: "Destination management for groups across Bali.",
  services: ["yoga", "spa", "culture"],
  operations: ["private_transportation", "airport_transfers"],
  travelerTypes: ["private_groups"],
  hotelTypes: ["4-star", "boutique_hotels"],
  languages: ["English"],
  minGroupSize: 2,
  maxGroupSize: 50,
  sourceUrl: "https://www.explera.id/",
  foundAt: Date.now(),
};

test("in demo mode anyone may send, a trial included, and no fictional network is loaded", async () => {
  vi.stubEnv("DEMO_MODE", "on");
  const t = convexTest(schema, modules).withIdentity({ subject: "advisor" });
  const me = await t.query(api.accounts.me, {});
  expect(me!.demo).toBe(true);
  expect(me!.canSend).toBe(true);
  await t.mutation(api.network.ensureWorkspace, {});
  expect(await t.query(api.network.list, {})).toHaveLength(0);
});

test("a real operator found on the web joins a workspace once, address and all", async () => {
  const t = convexTest(schema, modules);
  expect(await t.mutation(internal.webOperators.importToWorkspace, { owner: "a", operators: [found] })).toBe(1);
  // Found again, or found again for a second place, it is not duplicated.
  expect(await t.mutation(internal.webOperators.importToWorkspace, { owner: "a", operators: [found, { ...found, destinationSlug: "lombok" }] })).toBe(0);
  const network = await t.withIdentity({ subject: "a" }).query(api.network.list, {});
  expect(network).toHaveLength(1);
  expect(network[0].operator.contactEmail).toBe("b2b@explera.id");
  expect(network[0].operator.source).toBe("researched");
  expect(network[0].operator.destinations).toEqual(["bali", "lombok"]);
  expect(network[0].capability.services).toEqual(["yoga", "spa", "culture"]);
  // Another workspace gets its own copy, or none until it asks.
  expect(await t.withIdentity({ subject: "b" }).query(api.network.list, {})).toHaveLength(0);
});

test("only a company's own site counts, and an address comes from the page, never the model", () => {
  expect(looksLikeDirectory("tripadvisor.com")).toBe(true);
  expect(looksLikeDirectory("explera.id")).toBe(false);
  const page = "Write to b2b@explera.id or bookings@explera.id. Logo: logo@2x.png, gmail helper@gmail.com";
  expect(bestEmail(emailsIn(page), "explera.id")).toBe("bookings@explera.id");
  const pages = [{ url: "https://explera.id", title: "Explera", markdown: page }, { url: "https://blog.example", title: "Blog", markdown: "x" }];
  const read = readOperators({ pages: [
    { pageIndex: 0, isLocalOperator: true, name: "Explera DMC", country: "Indonesia", regions: [], summary: "", services: ["yoga", "invented"], operations: [], travelerTypes: [], hotelTypes: [], languages: [], minGroupSize: 0, maxGroupSize: 0 },
    { pageIndex: 1, isLocalOperator: false, name: "A blog", country: "", regions: [], summary: "", services: [], operations: [], travelerTypes: [], hotelTypes: [], languages: [], minGroupSize: 0, maxGroupSize: 0 },
  ] }, pages);
  expect(read.map((item) => item.name)).toEqual(["Explera DMC"]);
  // Anything outside the brief's vocabulary is dropped.
  expect(read[0].services).toEqual(["yoga"]);
});

test("the same operator on the same brief always gets the same one or two differences", () => {
  const keys = ["dates", "rooms", "budget", "ages"];
  expect(pickDeviations("row-1", keys, 2)).toEqual(pickDeviations("row-1", keys, 2));
  expect(pickDeviations("row-1", keys, 2)).toHaveLength(2);
  expect(pickDeviations("row-1", ["ages"], 2)).toHaveLength(0);
});

function stored(): Doc<"briefs"> {
  return { ...brief, _id: "b" as Doc<"briefs">["_id"], _creationTime: 0, owner: "a", status: "sent", selectedDestinationSlugs: ["bali"], updatedAt: 0 };
}

test("the strongest match answers every requirement with a yes, inside the window and the budget", () => {
  const requirements = buildRequirements({ ...brief, selectedDestinationIds: ["bali"] } as unknown as TripRequest);
  const raw = {
    greeting: "Thank you.", programName: "Ubud Quiet Week", startDate: "2027-12-01", endDate: "", nights: 7,
    netPricePerPerson: 3100, currency: "USD", availability: "Available", hotelLevel: "4-star", hotelNotes: "Two boutique resorts",
    depositPercent: 30, depositDueDaysBefore: 90, finalPaymentDaysBefore: 45, finalHeadcountDaysBefore: 60, travelerNamesDaysBefore: 30, roomReleaseDaysBefore: 45,
    cancellation: [{ daysBefore: 60, penalty: "50%" }],
    answers: requirements.map((item) => ({ key: item.key, answer: item.key === "rooms" ? "partly" : "yes", line: `We can do ${item.label.toLowerCase()}.` })),
    cannotProvide: ["a pool"], changes: [], closing: "Warmly",
  };
  const { text, proposal } = shapeReply(raw, { brief: stored(), requirements, perfect: true, deviationKeys: [], targetNet: 2625, operatorName: "Explera" });
  expect(proposal.requirementAnswers!.every((item) => item.answer === "yes")).toBe(true);
  expect(proposal.finalFit).toBe(100);
  expect(proposal.startDate).toBe(brief.preferredDepartureDate);
  expect(proposal.netPricePerPerson).toBeLessThanOrEqual(2625);
  expect(proposal.cannotProvide).toEqual([]);
  // Every answer's quote is in the email, word for word.
  for (const answer of proposal.requirementAnswers!) expect(text).toContain(answer.quote!);
  expect(text).toContain("Simulated reply");
});

test("a close match differs only where it was told to, and says so", () => {
  const requirements = buildRequirements({ ...brief, selectedDestinationIds: ["bali"] } as unknown as TripRequest);
  const raw = {
    greeting: "", programName: "", startDate: "2027-10-17", endDate: "", nights: 7, netPricePerPerson: 2000, currency: "USD", availability: "Held",
    hotelLevel: "4-star", hotelNotes: "", depositPercent: 25, depositDueDaysBefore: 120, finalPaymentDaysBefore: 45, finalHeadcountDaysBefore: 60,
    travelerNamesDaysBefore: 30, roomReleaseDaysBefore: 45, cancellation: [],
    answers: [{ key: "rooms", answer: "yes", line: "Singles are fine." }, { key: "ages", answer: "no", line: "Not for these ages." }],
    cannotProvide: [], changes: [], closing: "",
  };
  const { proposal } = shapeReply(raw, { brief: stored(), requirements, perfect: false, deviationKeys: ["rooms"], targetNet: 2625, operatorName: "Soulshine" });
  const answer = (key: string) => proposal.requirementAnswers!.find((item) => item.key === key)!.answer;
  expect(answer("rooms")).toBe("partly");
  expect(answer("ages")).toBe("yes");
  expect(proposal.finalFit).toBeLessThan(100);
  expect(proposal.finalFit).toBeGreaterThan(80);
  // Not told to differ on price, so it stays near the target.
  expect(proposal.netPricePerPerson).toBeGreaterThanOrEqual(Math.round(2625 * 0.9));
});
