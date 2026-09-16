/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, test } from "vitest";
import schema from "./schema";
import type * as invites from "./invites";
import type { FunctionArgs, FunctionReturnType, ApiFromModules } from "convex/server";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type InviteApi = ApiFromModules<{ invites: typeof invites }>["invites"];
// Typed references avoid depending on generated files before the local push.
function mutationRef<
  N extends
    | "create"
    | "revoke"
    | "submitByToken"
    | "createUploadUrl"
    | "createFromPartner"
    | "setEmail",
>(name: N) {
  return makeFunctionReference<"mutation", FunctionArgs<InviteApi[N]>, FunctionReturnType<InviteApi[N]>>(`invites:${name}`);
}
function queryRef<N extends "list" | "getByToken">(name: N) {
  return makeFunctionReference<"query", FunctionArgs<InviteApi[N]>, FunctionReturnType<InviteApi[N]>>(`invites:${name}`);
}
const token = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
const brief = { title: "Team retreat", destination: "Lisbon", startDate: "2026-11-10", endDate: "2026-11-12", travelers: 12, brief: "PRIVATE internal budget and contact notes", requirements: ["Step-free rooms", "Transfer"] };
const proposal = { token, sourceText: "Step-free rooms available.", amount: 1200, currency: "eur", priceBasis: "total" as const, assessments: [{ requirementNumber: 1, status: "yes" as const, evidence: "Step-free rooms available." }, { requirementNumber: 2, status: "unknown" as const, evidence: "" }] };
async function setup() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ subject: "owner|session" });
  const other = t.withIdentity({ subject: "other|session" });
  const tripId = await owner.mutation(api.trips.create, brief);
  const inviteId = await owner.mutation(mutationRef("create"), { tripId, supplierName: "Fictional Supplier", token });
  return { t, owner, other, tripId, inviteId };
}
test("capability reveals only supplier brief and anonymous response reaches the owner exactly once", async () => {
  const { t, owner, tripId } = await setup();
  const view = await t.query(queryRef("getByToken"), { token });
  expect(Object.keys(view!).sort()).toEqual(["supplierName", "title", "destination", "startDate", "endDate", "travelers", "requirements"].sort());
  expect(JSON.stringify(view)).not.toContain("PRIVATE");
  await t.mutation(mutationRef("submitByToken"), proposal);
  const { trip, offers } = await owner.query(api.trips.get, { tripId });
  expect(offers).toHaveLength(1);
  expect(offers[0]).toMatchObject({ owner: "owner", supplierName: "Fictional Supplier", currency: "EUR", assessments: proposal.assessments });
  expect(trip.status).toBe("comparing");
  expect(trip.selectedOfferId).toBeUndefined();
  expect((await owner.query(queryRef("list"), { tripId }))[0]).toMatchObject({ status: "submitted", offerId: offers[0]._id });
  expect(await t.query(queryRef("getByToken"), { token })).toBeNull();
  await expect(t.mutation(mutationRef("submitByToken"), proposal)).rejects.toThrow("unavailable");
});
test("foreign users cannot create, list or revoke and revoked/invalid links cannot submit", async () => {
  const { t, owner, other, tripId, inviteId } = await setup();
  await expect(other.mutation(mutationRef("create"), { tripId, supplierName: "Intruder", token })).rejects.toThrow("not found");
  await expect(other.query(queryRef("list"), { tripId })).rejects.toThrow("not found");
  await expect(other.mutation(mutationRef("revoke"), { inviteId })).rejects.toThrow("not found");
  await expect(t.query(queryRef("list"), { tripId })).rejects.toThrow("sign in");
  await owner.mutation(mutationRef("revoke"), { inviteId });
  expect(await t.query(queryRef("getByToken"), { token })).toBeNull();
  expect(await t.query(queryRef("getByToken"), { token: "guess" })).toBeNull();
  await expect(t.mutation(mutationRef("submitByToken"), proposal)).rejects.toThrow("unavailable");
  await expect(owner.mutation(mutationRef("create"), { tripId, supplierName: "Supplier", token: "short" })).rejects.toThrow("secure");
  await expect(owner.mutation(mutationRef("create"), { tripId, supplierName: "Supplier", token })).rejects.toThrow("already used");
});
test("invalid proposal leaves invitation open and no offer; closed trips reject supplier writes", async () => {
  const { t, owner, tripId } = await setup();
  await expect(t.mutation(mutationRef("submitByToken"), { ...proposal, amount: -1 })).rejects.toThrow("price");
  await expect(t.mutation(mutationRef("submitByToken"), { ...proposal, assessments: [{ requirementNumber: 99, status: "yes", evidence: "Anything" }] })).rejects.toThrow("not part of this brief");
  expect((await owner.query(api.trips.get, { tripId })).offers).toHaveLength(0);
  expect((await owner.query(queryRef("list"), { tripId }))[0].status).toBe("open");
  await t.run(async ctx => { await ctx.db.patch("trips", tripId, { status: "selected" }); });
  expect(await t.query(queryRef("getByToken"), { token })).toBeNull();
  await expect(t.mutation(mutationRef("submitByToken"), proposal)).rejects.toThrow("closed");
});

test("a supplier may answer in prose, attach their own documents, and skip the grid", async () => {
  const { t, owner, tripId } = await setup();
  const storageId = await t.run(
    async (ctx) => await ctx.storage.store(new Blob(["Fictional quote"])),
  );
  await t.mutation(mutationRef("submitByToken"), {
    token,
    sourceText:
      "We would run this as a relaxed week based in the old town, with breakfast each day.",
    amount: 2400,
    currency: "EUR",
    priceBasis: "per_person" as const,
    details: {
      inclusions: ["Accommodation", "Breakfast"],
      itinerary: "Day one arrival, day two walking.",
      rooms: "Twin rooms",
    },
    attachments: [
      {
        storageId,
        name: "fictional-quote.pdf",
        size: 14,
        contentType: "application/pdf",
      },
    ],
  });
  const { offers } = await owner.query(api.trips.get, { tripId });
  expect(offers).toHaveLength(1);
  // Nothing was answered requirement by requirement: the engine standardises it
  // from the prose and the attachment at the deadline.
  expect(offers[0].assessments).toEqual([]);
  expect(offers[0].standardisedAt).toBeUndefined();
  expect(offers[0].details?.inclusions).toEqual(["Accommodation", "Breakfast"]);
  expect(offers[0].attachments?.[0].name).toBe("fictional-quote.pdf");
  expect((await owner.query(queryRef("list"), { tripId }))[0].status).toBe(
    "submitted",
  );
});

test("attachments must be real uploads, are capped, and need an open invitation", async () => {
  const { t, owner, inviteId } = await setup();
  const { url } = await t.mutation(mutationRef("createUploadUrl"), { token });
  expect(url.startsWith("https://")).toBe(true);

  const gone = await t.run(
    async (ctx) => await ctx.storage.store(new Blob(["gone"])),
  );
  await t.run(async (ctx) => await ctx.storage.delete(gone));
  await expect(
    t.mutation(mutationRef("submitByToken"), {
      token,
      sourceText: "A short fictional quote.",
      amount: 100,
      currency: "USD",
      priceBasis: "total" as const,
      attachments: [{ storageId: gone, name: "gone.pdf", size: 4 }],
    }),
  ).rejects.toThrow("did not finish");

  const ids = await t.run(async (ctx) =>
    Promise.all(
      [1, 2, 3, 4, 5, 6].map(() => ctx.storage.store(new Blob(["file"]))),
    ),
  );
  await expect(
    t.mutation(mutationRef("submitByToken"), {
      token,
      sourceText: "A short fictional quote.",
      amount: 100,
      currency: "USD",
      priceBasis: "total" as const,
      attachments: ids.map((storageId, index) => ({
        storageId,
        name: `file-${index}.pdf`,
        size: 4,
      })),
    }),
  ).rejects.toThrow("at most 5 files");

  await owner.mutation(mutationRef("revoke"), { inviteId });
  await expect(
    t.mutation(mutationRef("createUploadUrl"), { token }),
  ).rejects.toThrow("unavailable");
});
