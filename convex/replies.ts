import { internalAction, internalMutation, query, env } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

const clean = (value: unknown, limit: number) =>
  typeof value === "string" ? value.slice(0, limit) : "";

// The advisor sees every reply that arrived for their own brief, newest first.
export const list = query({
  args: { tripId: v.id("trips") },
  returns: v.array(
    v.object({
      _id: v.id("supplierReplies"),
      inviteId: v.optional(v.id("supplierInvites")),
      supplierName: v.optional(v.string()),
      fromEmail: v.string(),
      subject: v.string(),
      text: v.string(),
      receivedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const owner = await getAuthUserId(ctx);
    if (!owner) throw new ConvexError("Please sign in.");
    const trip = await ctx.db.get("trips", args.tripId);
    if (!trip || trip.owner !== owner) throw new ConvexError("Trip not found.");
    const replies = await ctx.db
      .query("supplierReplies")
      .withIndex("by_tripId", (q) => q.eq("tripId", args.tripId))
      .order("desc")
      .take(50);
    const named = [];
    for (const reply of replies) {
      const invite = reply.inviteId
        ? await ctx.db.get("supplierInvites", reply.inviteId)
        : null;
      named.push({
        _id: reply._id,
        inviteId: reply.inviteId,
        supplierName: invite?.supplierName,
        fromEmail: reply.fromEmail,
        subject: reply.subject,
        text: reply.text,
        receivedAt: reply.receivedAt,
      });
    }
    return named;
  },
});

// Called by the HTTP route, never by a browser. It matches the mail to a brief by
// the inbox it landed in, and to a supplier by the address we sent the
// invitation to — never by trusting anything in the message body.
export const record = internalMutation({
  args: {
    inboxId: v.string(),
    fromEmail: v.string(),
    fromName: v.optional(v.string()),
    subject: v.string(),
    text: v.string(),
    messageId: v.string(),
    receivedAt: v.number(),
  },
  returns: v.union(v.literal("recorded"), v.literal("duplicate"), v.literal("unmatched")),
  handler: async (ctx, args) => {
    if (args.messageId) {
      const existing = await ctx.db
        .query("supplierReplies")
        .withIndex("by_messageId", (q) => q.eq("messageId", args.messageId))
        .unique();
      if (existing) return "duplicate";
    }
    const trip = await ctx.db
      .query("trips")
      .withIndex("by_agentMailInboxId", (q) =>
        q.eq("agentMailInboxId", args.inboxId),
      )
      .unique();
    if (!trip) return "unmatched";
    const invites = await ctx.db
      .query("supplierInvites")
      .withIndex("by_tripId", (q) => q.eq("tripId", trip._id))
      .take(50);
    const from = args.fromEmail.trim().toLowerCase();
    const invite = invites.find(
      (item) => item.email?.trim().toLowerCase() === from,
    );
    await ctx.db.insert("supplierReplies", {
      tripId: trip._id,
      owner: trip.owner,
      inviteId: invite?._id,
      inboxId: args.inboxId,
      fromEmail: args.fromEmail.slice(0, 320),
      fromName: args.fromName?.slice(0, 200),
      subject: args.subject.slice(0, 300),
      text: args.text.slice(0, 20000),
      messageId: args.messageId.slice(0, 300),
      receivedAt: args.receivedAt,
    });
    await ctx.db.patch("trips", trip._id, { updatedAt: Date.now() });
    return "recorded";
  },
});

// One account-level webhook covers every brief's inbox, so a new trip needs no
// setup. Run once per deployment:
//   npx convex run --prod replies:registerWebhook
export const registerWebhook = internalAction({
  args: {},
  returns: v.object({ registered: v.boolean(), detail: v.string() }),
  handler: async () => {
    const key = env.AGENTMAIL_API_KEY?.trim();
    if (!key)
      return { registered: false, detail: "AGENTMAIL_API_KEY is not set." };
    const secret = env.AGENTMAIL_WEBHOOK_SECRET?.trim() ?? "";
    const url = `${env.CONVEX_SITE_URL}/incoming/agentmail`;
    const existing = await fetch("https://api.agentmail.to/v0/webhooks", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    if (existing?.ok) {
      const body: unknown = await existing.json().catch(() => null);
      const list = body && typeof body === "object" && "webhooks" in body ? body.webhooks : null;
      if (Array.isArray(list) && list.some((item) => JSON.stringify(item).includes(url)))
        return { registered: true, detail: "A webhook for this deployment already exists." };
    }
    const response = await fetch("https://api.agentmail.to/v0/webhooks", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        event_types: ["message.received"],
        ...(secret ? { headers: { "x-tripbrief-secret": secret } } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    if (!response)
      return { registered: false, detail: "The email provider could not be reached." };
    if (!response.ok)
      return {
        registered: false,
        detail: `Webhook registration failed (${response.status}): ${(await response.text().catch(() => "")).slice(0, 200)}`,
      };
    return { registered: true, detail: `Listening at ${url}` };
  },
});

export function readInboundEvent(body: unknown) {
  if (!body || typeof body !== "object" || !("event_type" in body))
    throw new ConvexError("Unrecognised event.");
  const eventType = clean(body.event_type, 60);
  if (eventType !== "message.received") return null;
  if (!("message" in body) || !body.message || typeof body.message !== "object")
    throw new ConvexError("The event carried no message.");
  const message = body.message as Record<string, unknown>;
  const inboxId = clean(message.inbox_id, 200);
  if (!inboxId) throw new ConvexError("The message carried no inbox.");
  const from =
    typeof message.from === "string"
      ? message.from
      : typeof message.from_ === "string"
        ? message.from_
        : "";
  return {
    inboxId,
    fromEmail: clean(from, 320),
    fromName: typeof message.from_name === "string" ? message.from_name : undefined,
    subject: clean(message.subject, 300),
    text: clean(
      typeof message.text === "string" ? message.text : message.extracted_text,
      20000,
    ),
    messageId: clean(typeof message.message_id === "string" ? message.message_id : message.messageId, 300),
    receivedAt: Date.now(),
  };
}
