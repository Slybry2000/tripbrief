import { action, env, internalAction, internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc } from "./_generated/dataModel";

const inboxResult = v.object({ email: v.string(), inboxId: v.string() });

// The mail provider accepts only a limited character set in an inbox's display
// name, and this one is built from a brief's name. A brief called "Wellness week
// (October)" would otherwise make sending impossible, so anything outside the
// accepted set is folded away rather than passed on.
export function displayName(briefName: string) {
  const safe = briefName
    .replace(/[^A-Za-z0-9 ._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `Operator requests - ${safe || "Untitled brief"}`.slice(0, 120);
}

// Every brief gets its own inbox. That is what lets a reply be matched to a
// brief without reading anything in the message, and it is why a new brief needs
// no setup: the inbox is created the first time the brief sends something.
export const provision = action({
  args: { briefId: v.id("briefs") },
  returns: inboxResult,
  handler: async (ctx, args): Promise<{ email: string; inboxId: string }> => {
    const owner = await getAuthUserId(ctx);
    if (!owner) throw new ConvexError("Please sign in.");
    const brief: Doc<"briefs"> | null = await ctx.runQuery(api.briefs.one, {
      briefId: args.briefId,
    });
    if (!brief || brief.owner !== owner) throw new ConvexError("Brief not found.");
    if (brief.agentMailInboxId && brief.agentMailInboxEmail)
      return { email: brief.agentMailInboxEmail, inboxId: brief.agentMailInboxId };
    if (!env.AGENTMAIL_API_KEY)
      throw new ConvexError("Brief inboxes have not been configured.");
    await ctx.runMutation(internal.integrationLimits.consumeInbox, {
      briefId: args.briefId,
      owner,
    });
    const response = await fetch("https://api.agentmail.to/v0/inboxes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.AGENTMAIL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        display_name: displayName(brief.name),
        metadata: { brief_id: brief._id },
      }),
      signal: AbortSignal.timeout(30_000),
    }).catch(() => {
      throw new ConvexError(
        "The inbox service could not connect. Please try again later.",
      );
    });
    if (!response.ok)
      // The provider's own words are safe to surface: no credential is echoed, and
      // "the service is unavailable" is useless when the real answer is a plan
      // limit or a rejected parameter.
      throw new ConvexError(
        `The inbox service refused a new inbox (status ${response.status}): ${(await response.text().catch(() => "")).slice(0, 200)}`,
      );
    const inbox = parseInbox(await response.json());
    await ctx.runMutation(internal.inboxes.attach, {
      briefId: args.briefId,
      owner,
      inboxId: inbox.inboxId,
      email: inbox.email,
    });
    return { email: inbox.email, inboxId: inbox.inboxId };
  },
});

// An ops probe: what the mail provider actually answers, without echoing the
// credential and without creating anything.
//
//   npx convex run inboxes:checkProvider
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

export const attach = internalMutation({
  args: {
    briefId: v.id("briefs"),
    owner: v.string(),
    inboxId: v.string(),
    email: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const brief = await ctx.db.get("briefs", args.briefId);
    if (!brief || brief.owner !== args.owner)
      throw new ConvexError("Brief not found.");
    // A repeat action never overwrites an inbox already attached to the brief.
    if (!brief.agentMailInboxId)
      await ctx.db.patch("briefs", brief._id, {
        agentMailInboxId: args.inboxId,
        agentMailInboxEmail: args.email,
        updatedAt: Date.now(),
      });
    return null;
  },
});

export function parseInbox(body: unknown): { inboxId: string; email: string } {
  if (!body || typeof body !== "object")
    throw new ConvexError("The inbox service returned an unexpected response.");
  const inboxId =
    "inbox_id" in body && typeof body.inbox_id === "string"
      ? body.inbox_id
      : "inboxId" in body && typeof body.inboxId === "string"
        ? body.inboxId
        : "";
  const email =
    "email" in body && typeof body.email === "string" ? body.email : "";
  if (!inboxId || inboxId.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new ConvexError("The inbox service returned an invalid inbox.");
  return { inboxId, email };
}
