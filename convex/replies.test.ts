/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { readInboundEvent } from "./replies";

const modules = import.meta.glob("./**/*.ts");
const token = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
const brief = {
  title: "Coastal retreat",
  destination: "Portugal",
  startDate: "2026-11-10",
  endDate: "2026-11-14",
  travelers: 12,
  brief: "A fictional company retreat.",
  requirements: ["Step-free rooms", "Airport transfer"],
};
const inboxId = "inbox_fictional_123";

async function setup() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ subject: "owner|session" });
  const tripId = await owner.mutation(api.trips.create, brief);
  await t.run(async (ctx) => {
    await ctx.db.patch("trips", tripId, {
      agentMailInboxId: inboxId,
      agentMailInboxEmail: "trip-fictional@agentmail.to",
    });
  });
  const inviteId = await owner.mutation(api.invites.create, {
    tripId,
    supplierName: "Fictional Harbor House",
    token,
    email: "quotes@fictional-harbor.example",
  });
  return { t, owner, tripId, inviteId };
}

async function deliver(
  t: ReturnType<typeof convexTest>,
  overrides: Record<string, unknown> = {},
) {
  return await t.mutation(internal.replies.record, {
    inboxId,
    fromEmail: "quotes@fictional-harbor.example",
    fromName: "Harbor House",
    subject: "Our quote",
    text: "We can offer twin rooms and a group transfer.",
    messageId: "msg_1",
    receivedAt: Date.now(),
    ...overrides,
  });
}

test("a reply that lands in a brief's inbox appears on that brief, matched to its supplier", async () => {
  const { t, owner, tripId, inviteId } = await setup();
  expect(await deliver(t)).toBe("recorded");
  const replies = await owner.query(api.replies.list, { tripId });
  expect(replies).toHaveLength(1);
  expect(replies[0]).toMatchObject({
    inviteId,
    supplierName: "Fictional Harbor House",
    fromEmail: "quotes@fictional-harbor.example",
    subject: "Our quote",
  });
  expect(replies[0].text).toContain("twin rooms");
});

test("the same message is never recorded twice", async () => {
  const { t, owner, tripId } = await setup();
  expect(await deliver(t)).toBe("recorded");
  expect(await deliver(t)).toBe("duplicate");
  expect(await owner.query(api.replies.list, { tripId })).toHaveLength(1);
});

test("mail for an inbox no brief owns is dropped, not guessed at", async () => {
  const { t } = await setup();
  expect(
    await deliver(t, { inboxId: "inbox_someone_else", messageId: "msg_2" }),
  ).toBe("unmatched");
});

test("a reply from an address we never invited is still kept, without a supplier", async () => {
  const { t, owner, tripId } = await setup();
  expect(
    await deliver(t, {
      fromEmail: "stranger@example.com",
      messageId: "msg_3",
    }),
  ).toBe("recorded");
  const replies = await owner.query(api.replies.list, { tripId });
  expect(replies[0].inviteId).toBeUndefined();
  expect(replies[0].fromEmail).toBe("stranger@example.com");
});

test("only the brief's owner can read its incoming mail", async () => {
  const { t, tripId } = await setup();
  const other = t.withIdentity({ subject: "other|session" });
  await deliver(t);
  await expect(other.query(api.replies.list, { tripId })).rejects.toThrow(
    "not found",
  );
  await expect(t.query(api.replies.list, { tripId })).rejects.toThrow("sign in");
});

test("the webhook reader takes only what it needs from a real event", () => {
  const event = readInboundEvent({
    event_type: "message.received",
    message: {
      inbox_id: inboxId,
      from: "quotes@fictional-harbor.example",
      from_name: "Harbor House",
      subject: "Our quote",
      text: "Twin rooms available.",
      message_id: "msg_9",
    },
  });
  expect(event).toMatchObject({
    inboxId,
    fromEmail: "quotes@fictional-harbor.example",
    fromName: "Harbor House",
    subject: "Our quote",
    text: "Twin rooms available.",
    messageId: "msg_9",
  });
  // Anything that is not a received message is ignored rather than recorded.
  expect(readInboundEvent({ event_type: "message.sent", message: {} })).toBeNull();
  expect(() => readInboundEvent({ event_type: "message.received" })).toThrow(
    "no message",
  );
  expect(() =>
    readInboundEvent({
      event_type: "message.received",
      message: { from: "someone@example.com" },
    }),
  ).toThrow("no inbox");
});
