import { action, env, internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc } from "./_generated/dataModel";

const inboxResult = v.object({ email: v.string(), inboxId: v.string() });

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
        display_name: `Operator requests · ${brief.name}`.slice(0, 120),
        metadata: { brief_id: brief._id },
      }),
      signal: AbortSignal.timeout(30_000),
    }).catch(() => {
      throw new ConvexError(
        "The inbox service could not connect. Please try again later.",
      );
    });
    if (!response.ok)
      throw new ConvexError(
        "The inbox service is unavailable. Please try again later.",
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
