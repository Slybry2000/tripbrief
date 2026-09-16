import { env, internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc } from "./_generated/dataModel";

// How many mailboxes this workspace may hold open at the provider. The free plan
// allows three, and the design has to fit inside that: see the note on the pool
// below. Raise it only in step with the plan.
export const MAILBOX_LIMIT = 3;

// The mail provider accepts only a limited character set in an inbox's display
// name, and this one is built from a brief's name. A brief called "Wellness week
// (October)" would otherwise make sending impossible, so anything outside the
// accepted set is folded away rather than passed on.
export function displayName(name: string) {
  const safe = name
    .replace(/[^A-Za-z0-9 ._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `TripBrief - ${safe || "workspace"}`.slice(0, 120);
}

export function parseInbox(body: unknown): { inboxId: string; email: string } {
  if (!body || typeof body !== "object")
    throw new ConvexError("The mail service returned an unexpected response.");
  const inboxId =
    "inbox_id" in body && typeof body.inbox_id === "string"
      ? body.inbox_id
      : "inboxId" in body && typeof body.inboxId === "string"
        ? body.inboxId
        : "";
  const email =
    "email" in body && typeof body.email === "string" ? body.email : "";
  if (!inboxId || inboxId.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new ConvexError("The mail service returned an invalid inbox.");
  return { inboxId, email };
}

// One mailbox serves many briefs. A reply is attributed by its thread, not by the
// mailbox it landed in, so sharing costs nothing except a little tidiness in the
// mail account.

// The workspace's pool, least recently used first, so the next send takes the
// quietest mailbox.
export const pool = internalQuery({
  args: { owner: v.string() },
  returns: v.array(
    v.object({
      _id: v.id("mailboxes"),
      inboxId: v.string(),
      address: v.string(),
      displayName: v.string(),
      lastUsedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("mailboxes")
      .withIndex("by_owner", (q) => q.eq("owner", args.owner))
      .take(20);
    return rows
      .map((row) => ({
        _id: row._id,
        inboxId: row.inboxId,
        address: row.address,
        displayName: row.displayName,
        lastUsedAt: row.lastUsedAt,
      }))
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  },
});

export const record = internalMutation({
  args: {
    owner: v.string(),
    inboxId: v.string(),
    address: v.string(),
    displayName: v.string(),
  },
  returns: v.object({ mailboxId: v.id("mailboxes") }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const mailboxId = await ctx.db.insert("mailboxes", {
      owner: args.owner,
      inboxId: args.inboxId,
      address: args.address,
      displayName: args.displayName,
      lastUsedAt: now,
      createdAt: now,
    });
    return { mailboxId };
  },
});

export const markUsed = internalMutation({
  args: { mailboxId: v.id("mailboxes") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const mailbox = await ctx.db.get("mailboxes", args.mailboxId);
    if (mailbox) await ctx.db.patch("mailboxes", mailbox._id, { lastUsedAt: Date.now() });
    return null;
  },
});

export const byInboxId = internalQuery({
  args: { inboxId: v.string() },
  returns: v.union(
    v.null(),
    v.object({ _id: v.id("mailboxes"), owner: v.string(), address: v.string() }),
  ),
  handler: async (ctx, args) => {
    const mailbox = await ctx.db
      .query("mailboxes")
      .withIndex("by_inboxId", (q) => q.eq("inboxId", args.inboxId))
      .unique();
    if (!mailbox) return null;
    return { _id: mailbox._id, owner: mailbox.owner, address: mailbox.address };
  },
});

// What the workspace has open, for the surface that has to be honest about the
// three-inbox ceiling.
export const list = query({
  args: {},
  returns: v.object({
    limit: v.number(),
    mailboxes: v.array(
      v.object({ address: v.string(), lastUsedAt: v.number() }),
    ),
  }),
  handler: async (ctx) => {
    const owner = await getAuthUserId(ctx);
    if (!owner) return { limit: MAILBOX_LIMIT, mailboxes: [] };
    const rows = await ctx.db
      .query("mailboxes")
      .withIndex("by_owner", (q) => q.eq("owner", owner))
      .take(20);
    return {
      limit: MAILBOX_LIMIT,
      mailboxes: rows
        .map((row) => ({ address: row.address, lastUsedAt: row.lastUsedAt }))
        .sort((a, b) => b.lastUsedAt - a.lastUsedAt),
    };
  },
});

// The provider's own view of the account, for working out where the ceiling is:
//
//   npx convex run mailboxes:checkProvider
export const checkProvider = internalAction({
  args: {},
  returns: v.object({
    configured: v.boolean(),
    status: v.number(),
    inboxCount: v.union(v.null(), v.number()),
    detail: v.string(),
  }),
  handler: async () => {
    const key = env.AGENTMAIL_API_KEY?.trim();
    if (!key)
      return {
        configured: false,
        status: 0,
        inboxCount: null,
        detail: "AGENTMAIL_API_KEY is not set on this deployment.",
      };
    try {
      const response = await fetch("https://api.agentmail.to/v0/inboxes", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(20_000),
      });
      const text = await response.text().catch(() => "");
      let inboxCount: number | null = null;
      try {
        const body: unknown = JSON.parse(text);
        const list =
          body && typeof body === "object" && "inboxes" in body
            ? body.inboxes
            : null;
        if (Array.isArray(list)) inboxCount = list.length;
      } catch {
        // A non-JSON body is reported as-is below; it is still useful.
      }
      return {
        configured: true,
        status: response.status,
        inboxCount,
        detail: text.slice(0, 300),
      };
    } catch (cause) {
      return {
        configured: true,
        status: 0,
        inboxCount: null,
        detail: `fetch failed: ${String(cause).slice(0, 200)}`,
      };
    }
  },
});

export type Mailboxes = {
  pool: Doc<"mailboxes">[];
};
