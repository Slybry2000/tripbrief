import { env, internalAction, internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc } from "./_generated/dataModel";
import { attachmentMeta, noteAttachments, readAttachments } from "./replyAttachments";

const clean = (value: unknown, limit: number) =>
  typeof value === "string" ? value.slice(0, limit) : "";

// What the advisor sees for one brief. A reply is only listed here once it has
// been placed on a brief; anything that could not be placed is on the workspace
// list below rather than quietly binned.
export const list = query({
  args: { briefId: v.id("briefs") },
  returns: v.array(
    v.object({
      _id: v.id("inboxMessages"),
      operatorSlug: v.optional(v.string()),
      matchedBy: v.optional(v.union(v.literal("thread"), v.literal("address"))),
      fromEmail: v.string(),
      fromName: v.optional(v.string()),
      subject: v.string(),
      text: v.string(),
      receivedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const owner = await getAuthUserId(ctx);
    if (!owner) throw new ConvexError("Please sign in.");
    const brief = await ctx.db.get("briefs", args.briefId);
    if (!brief || brief.owner !== owner) throw new ConvexError("Brief not found.");
    const messages = await ctx.db
      .query("inboxMessages")
      .withIndex("by_briefId", (q) => q.eq("briefId", args.briefId))
      .order("desc")
      .take(50);
    return messages.map((message) => ({
      _id: message._id,
      operatorSlug: message.operatorSlug,
      matchedBy: message.matchedBy,
      fromEmail: message.fromEmail,
      fromName: message.fromName,
      subject: message.subject,
      text: message.text,
      receivedAt: message.receivedAt,
    }));
  },
});

// Mail the workspace received that belongs to no request on file. It is shown
// rather than dropped: an operator answering from a different address is a normal
// thing for a person to resolve, and a machine cannot.
export const unfiled = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("inboxMessages"),
      fromEmail: v.string(),
      fromName: v.optional(v.string()),
      subject: v.string(),
      text: v.string(),
      receivedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const owner = await getAuthUserId(ctx);
    if (!owner) return [];
    const messages = await ctx.db
      .query("inboxMessages")
      .withIndex("by_owner", (q) => q.eq("owner", owner))
      .order("desc")
      .take(50);
    return messages
      .filter((message) => message.briefId === null)
      .map((message) => ({
        _id: message._id,
        fromEmail: message.fromEmail,
        fromName: message.fromName,
        subject: message.subject,
        text: message.text,
        receivedAt: message.receivedAt,
      }));
  },
});

// Called by the HTTP route, never by a browser.
//
// The mailbox only says which workspace the mail belongs to. Which *request* it
// answers is decided by the thread it is part of: the send recorded the thread it
// started, and a reply carries it back. That is what lets three mailboxes serve
// any number of briefs without guessing.
//
// If there is no thread (the operator wrote a fresh message instead of replying),
// the sender's address is used, and the only honest answer there is "probably":
// the reply is placed on the most recent request sent to that address and marked
// as matched by address rather than exactly, so a person can check it. Nothing is
// placed when no request has ever gone to that address.
export const record = internalMutation({
  args: {
    inboxId: v.string(),
    threadId: v.optional(v.string()),
    fromEmail: v.string(),
    fromName: v.optional(v.string()),
    to: v.optional(v.string()),
    subject: v.string(),
    text: v.string(),
    messageId: v.string(),
    receivedAt: v.number(),
    // Only what the webhook says about each file; the bytes are fetched after.
    attachments: v.optional(v.array(attachmentMeta)),
  },
  returns: v.union(
    v.literal("recorded"),
    v.literal("filed"),
    v.literal("duplicate"),
    v.literal("unmatched"),
  ),
  handler: async (ctx, args) => {
    if (args.messageId) {
      const existing = await ctx.db
        .query("inboxMessages")
        .withIndex("by_messageId", (q) => q.eq("messageId", args.messageId))
        .unique();
      if (existing) return "duplicate";
    }
    const mailbox = await ctx.db
      .query("mailboxes")
      .withIndex("by_inboxId", (q) => q.eq("inboxId", args.inboxId))
      .unique();
    if (!mailbox) return "unmatched";

    let row: Doc<"briefOperators"> | null = null;
    let matchedBy: "thread" | "address" | undefined;
    if (args.threadId) {
      const byThread = await ctx.db
        .query("briefOperators")
        .withIndex("by_providerThreadId", (q) =>
          q.eq("providerThreadId", args.threadId),
        )
        .first();
      if (byThread && byThread.owner === mailbox.owner) {
        row = byThread;
        matchedBy = "thread";
      }
    }
    const from = args.fromEmail.trim().toLowerCase();
    if (!row && from) {
      const candidates = await ctx.db
        .query("briefOperators")
        .withIndex("by_email", (q) => q.eq("email", from))
        .take(20);
      const mine = candidates.filter(
        (candidate) => candidate.owner === mailbox.owner && candidate.sentAt,
      );
      if (mine.length) {
        row = mine.sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0))[0];
        matchedBy = "address";
      }
    }

    const now = Date.now();
    const inboxMessageId = await ctx.db.insert("inboxMessages", {
      briefId: row?.briefId ?? null,
      owner: mailbox.owner,
      briefOperatorId: row?._id,
      operatorSlug: row?.operatorSlug,
      mailboxId: mailbox._id,
      inboxId: args.inboxId,
      threadId: args.threadId,
      matchedBy,
      fromEmail: args.fromEmail.slice(0, 320),
      fromName: args.fromName?.slice(0, 200),
      subject: args.subject.slice(0, 300),
      text: args.text.slice(0, 20_000),
      messageId: args.messageId.slice(0, 300),
      receivedAt: args.receivedAt,
    });
    if (args.attachments?.length)
      await noteAttachments(
        ctx,
        { _id: inboxMessageId, briefId: row?.briefId ?? null, owner: mailbox.owner },
        args.attachments,
      );
    if (row) await ctx.db.patch("briefs", row.briefId, { updatedAt: now });
    // A reply that was filed is something the advisor needs to know about; mail
    // that could not be filed is already visible on the home view.
    if (row) await ctx.scheduler.runAfter(0, internal.alerting.sweep, { owner: mailbox.owner });
    return row ? "filed" : "recorded";
  },
});

// One account-level webhook covers every mailbox, so a new workspace needs no
// setup. Run once per deployment:
//   npx convex run replies:registerWebhook
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
      const list =
        body && typeof body === "object" && "webhooks" in body
          ? body.webhooks
          : null;
      if (
        Array.isArray(list) &&
        list.some((item) => JSON.stringify(item).includes(url))
      )
        return {
          registered: true,
          detail: "A webhook for this deployment already exists.",
        };
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
        ...(secret ? { headers: { "x-operator-inbox-secret": secret } } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    if (!response)
      return {
        registered: false,
        detail: "The mail provider could not be reached.",
      };
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
  if (clean(body.event_type, 60) !== "message.received") return null;
  if (!("message" in body) || !body.message || typeof body.message !== "object")
    throw new ConvexError("The event carried no message.");
  const message = body.message as Record<string, unknown>;
  const inboxId = clean(message.inbox_id, 200);
  if (!inboxId) throw new ConvexError("The message carried no inbox.");
  const attachments = readAttachments(message);
  const from =
    typeof message.from === "string"
      ? message.from
      : typeof message.from_ === "string"
        ? message.from_
        : "";
  return {
    inboxId,
    // The thread is the whole basis of attribution, so it is read carefully.
    threadId: clean(message.thread_id, 300) || undefined,
    fromEmail: clean(from, 320),
    fromName:
      typeof message.from_name === "string" ? message.from_name : undefined,
    subject: clean(message.subject, 300),
    text: clean(
      typeof message.text === "string" ? message.text : message.extracted_text,
      20_000,
    ),
    messageId: clean(
      typeof message.message_id === "string"
        ? message.message_id
        : message.messageId,
      300,
    ),
    receivedAt: Date.now(),
    // Left out entirely when there are none, so a plain reply is recorded
    // exactly as it always was.
    ...(attachments.length ? { attachments } : {}),
  };
}
