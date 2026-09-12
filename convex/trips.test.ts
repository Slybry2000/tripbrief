/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const brief = { title: "Coastal retreat", destination: "Portugal", startDate: "2026-11-10", endDate: "2026-11-14", travelers: 12, brief: "A fictional company retreat.", requirements: ["Step-free rooms", "Airport transfer"] };
const proposal = { supplierName: "Example Coast", sourceText: "Step-free rooms available. Airport transfer included.", amount: 9500, currency: "EUR", priceBasis: "total" as const, assessments: [{ requirementNumber: 1, status: "yes" as const, evidence: "Step-free rooms available." }, { requirementNumber: 2, status: "yes" as const, evidence: "Airport transfer included." }] };

test("anonymous requests fail closed and separate identities cannot read or modify another workspace", async () => {
  const t = convexTest(schema, modules);
  await expect(t.query(api.trips.list, {})).rejects.toThrow("sign in");
  await expect(t.mutation(api.trips.create, brief)).rejects.toThrow("sign in");
  const alice = t.withIdentity({ subject: "alice|session1" });
  const bob = t.withIdentity({ subject: "bob|session1" });
  const tripId = await alice.mutation(api.trips.create, brief);
  expect(await bob.query(api.trips.list, {})).toEqual([]);
  await expect(bob.query(api.trips.get, { tripId })).rejects.toThrow("not found");
  await expect(bob.mutation(api.trips.addOffer, { tripId, ...proposal })).rejects.toThrow("not found");
  const aliceSignedInAgain = t.withIdentity({ subject: "alice|session2" });
  expect((await aliceSignedInAgain.query(api.trips.list, {}))[0]._id).toBe(tripId);
});
test("brief, evidence-backed offers and human decision round-trip without automatic selection", async () => {
  const t = convexTest(schema, modules).withIdentity({ subject: "advisor" });
  const tripId = await t.mutation(api.trips.create, brief);
  const offerId = await t.mutation(api.trips.addOffer, { tripId, ...proposal });
  let result = await t.query(api.trips.get, { tripId });
  expect(result.trip.requirements).toEqual([{ number: 1, text: "Step-free rooms" }, { number: 2, text: "Airport transfer" }]);
  expect(result.trip.status).toBe("comparing");
  expect(result.trip.selectedOfferId).toBeUndefined();
  expect(result.offers[0]).toMatchObject(proposal);
  await t.mutation(api.trips.selectOffer, { tripId, offerId, reason: "Reviewed accessibility evidence." });
  result = await t.query(api.trips.get, { tripId });
  expect(result.trip).toMatchObject({ status: "selected", selectedOfferId: offerId, selectionReason: "Reviewed accessibility evidence." });
  await expect(t.mutation(api.trips.addOffer, { tripId, ...proposal })).rejects.toThrow("locked");
});
test("fabricated evidence, missing or duplicate answers, invalid prices and dates are rejected", async () => {
  const t = convexTest(schema, modules).withIdentity({ subject: "advisor" });
  await expect(t.mutation(api.trips.create, { ...brief, startDate: "2026-02-30" })).rejects.toThrow("valid dates");
  const tripId = await t.mutation(api.trips.create, brief);
  await expect(t.mutation(api.trips.addOffer, { tripId, ...proposal, amount: NaN })).rejects.toThrow("valid non-negative");
  await expect(t.mutation(api.trips.addOffer, { tripId, ...proposal, assessments: [proposal.assessments[0], proposal.assessments[0]] })).rejects.toThrow("exactly one");
  await expect(t.mutation(api.trips.addOffer, { tripId, ...proposal, assessments: [{ ...proposal.assessments[0], evidence: "Invented evidence" }, proposal.assessments[1]] })).rejects.toThrow("exact excerpt");
  expect((await t.query(api.trips.get, { tripId })).offers).toHaveLength(0);
});
test("unknown answers remain unknown and selecting an offer from another trip fails", async () => {
  const t = convexTest(schema, modules).withIdentity({ subject: "advisor" });
  const tripId = await t.mutation(api.trips.create, brief);
  const secondId = await t.mutation(api.trips.create, brief);
  const offerId = await t.mutation(api.trips.addOffer, { tripId, ...proposal, assessments: [{ requirementNumber: 1, status: "unknown", evidence: "" }, proposal.assessments[1]] });
  expect((await t.query(api.trips.get, { tripId })).offers[0].assessments[0].status).toBe("unknown");
  await expect(t.mutation(api.trips.selectOffer, { tripId: secondId, offerId, reason: "Wrong trip" })).rejects.toThrow("not found");
});
