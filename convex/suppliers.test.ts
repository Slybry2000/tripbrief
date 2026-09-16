/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { invitationMessage, providerMessageId } from "./outbound";

const modules = import.meta.glob("./**/*.ts");
const token = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
const secondToken = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefg";
const brief = {
  title: "Team retreat",
  destination: "Lisbon",
  startDate: "2026-11-10",
  endDate: "2026-11-12",
  travelers: 12,
  brief: "Fictional group retreat.",
  requirements: ["Step-free rooms", "Group airport transfer"],
};
const partner = {
  title: "Fictional Harbor House",
  url: "https://example.com/harbor-house",
  description: "Fictional group hotel.",
};

async function setup() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ subject: "owner|session" });
  const tripId = await owner.mutation(api.trips.create, brief);
  const partnerId = await owner.mutation(api.partners.save, { tripId, ...partner });
  return { t, owner, tripId, partnerId };
}

test("a shortlisted partner becomes a supplier with its own response link", async () => {
  const { owner, tripId, partnerId } = await setup();
  await owner.mutation(api.invites.createFromPartner, { tripId, partnerId, token });
  const invites = await owner.query(api.invites.list, { tripId });
  expect(invites).toHaveLength(1);
  expect(invites[0]).toMatchObject({
    supplierName: partner.title,
    partnerId,
    status: "open",
  });
  await expect(
    owner.mutation(api.invites.createFromPartner, {
      tripId,
      partnerId,
      token: secondToken,
    }),
  ).rejects.toThrow("already has a response link");
});

test("a partner from another brief cannot be turned into a supplier", async () => {
  const { owner, tripId, partnerId } = await setup();
  const otherTrip = await owner.mutation(api.trips.create, {
    ...brief,
    title: "Different trip",
  });
  // The partner belongs to the first brief; a second brief cannot claim it.
  await expect(
    owner.mutation(api.invites.createFromPartner, {
      tripId: otherTrip,
      partnerId,
      token,
    }),
  ).rejects.toThrow("another brief");
  // The brief that owns the partner can still use it.
  await expect(
    owner.mutation(api.invites.createFromPartner, { tripId, partnerId, token }),
  ).resolves.toBeDefined();
});

test("the supplier's email is recorded, validated, and locked once the invitation is sent", async () => {
  const { t, owner, tripId, partnerId } = await setup();
  const inviteId = await owner.mutation(api.invites.createFromPartner, {
    tripId,
    partnerId,
    token,
  });
  await expect(
    owner.mutation(api.invites.setEmail, { inviteId, email: "not-an-address" }),
  ).rejects.toThrow("valid email");
  await owner.mutation(api.invites.setEmail, {
    inviteId,
    email: "  supplier@example.com ",
  });
  expect((await owner.query(api.invites.list, { tripId }))[0].email).toBe(
    "supplier@example.com",
  );
  await t.run(async (ctx) => {
    await ctx.db.patch("supplierInvites", inviteId, { sentAt: Date.now() });
  });
  await expect(
    owner.mutation(api.invites.setEmail, { inviteId, email: "other@example.com" }),
  ).rejects.toThrow("already been sent");
});

test("a hand-added supplier keeps its email and rejects a malformed one", async () => {
  const { owner, tripId } = await setup();
  await expect(
    owner.mutation(api.invites.create, {
      tripId,
      supplierName: "Fictional Direct Supplier",
      token,
      email: "broken@@example",
    }),
  ).rejects.toThrow("valid email");
  await owner.mutation(api.invites.create, {
    tripId,
    supplierName: "Fictional Direct Supplier",
    token,
    email: "direct@example.com",
  });
  const invites = await owner.query(api.invites.list, { tripId });
  expect(invites[0]).toMatchObject({
    supplierName: "Fictional Direct Supplier",
    email: "direct@example.com",
  });
  expect(invites[0].partnerId).toBeUndefined();
});

test("the invitation email carries the private link and no traveller detail", () => {
  const message = invitationMessage(
    brief,
    "Fictional Harbor House",
    "https://hip-minnow-543.convex.site/#respond=token",
  );
  expect(message.subject).toContain("Team retreat");
  for (const body of [message.text, message.html])
    expect(body).toContain("https://hip-minnow-543.convex.site/#respond=token");
  expect(message.text).toContain("Fictional Harbor House");
  expect(message.text).toContain("Lisbon");
  expect(message.text).not.toContain("Fictional group retreat.");
  expect(message.html).toContain("<a href=");
});

test("the provider message id is read without trusting the shape", () => {
  expect(providerMessageId({ message_id: "abc" })).toBe("abc");
  expect(providerMessageId({ messageId: "def" })).toBe("def");
  expect(providerMessageId({ id: "ghi" })).toBe("ghi");
  expect(providerMessageId({ nope: 1 })).toBe("");
  expect(providerMessageId(null)).toBe("");
  expect(providerMessageId("not an object")).toBe("");
});
