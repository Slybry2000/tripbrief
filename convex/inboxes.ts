import { action, env, internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc } from "./_generated/dataModel";

const inboxResult = v.object({ email: v.string(), inboxId: v.string() });

export const provision = action({
  args: { tripId: v.id("trips") },
  returns: inboxResult,
  handler: async (ctx, args): Promise<{ email: string; inboxId: string }> => {
    const owner = await getAuthUserId(ctx);
    if (!owner) throw new ConvexError("Please sign in.");
    const { trip }: { trip: Doc<"trips">; offers: Doc<"offers">[] } =
      await ctx.runQuery(api.trips.get, { tripId: args.tripId });
    if (trip.agentMailInboxEmail && trip.agentMailInboxId)
      return { email: trip.agentMailInboxEmail, inboxId: trip.agentMailInboxId };
    if (!env.AGENTMAIL_API_KEY)
      throw new ConvexError("Trip inboxes have not been configured.");
    await ctx.runMutation(internal.integrationLimits.consumeInbox, {
      tripId: args.tripId,
    });
    const response = await fetch("https://api.agentmail.to/v0/inboxes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.AGENTMAIL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        display_name: `TripBrief · ${trip.title}`.slice(0, 120),
        metadata: { tripbrief_trip_id: trip._id },
      }),
      signal: AbortSignal.timeout(30_000),
    }).catch(() => {
      throw new ConvexError(
        "Inbox service could not connect. Please try again later.",
      );
    });
    if (!response.ok)
      throw new ConvexError(
        "Inbox service is unavailable. Please try again later.",
      );
    const inbox = parseInbox(await response.json());
    await ctx.runMutation(internal.inboxes.attach, {
      tripId: args.tripId,
      owner,
      inboxId: inbox.inboxId,
      email: inbox.email,
    });
    return { email: inbox.email, inboxId: inbox.inboxId };
  },
});

export const attach = internalMutation({
  args: {
    tripId: v.id("trips"),
    owner: v.string(),
    inboxId: v.string(),
    email: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const trip = await ctx.db.get("trips", args.tripId);
    if (!trip || trip.owner !== args.owner)
      throw new ConvexError("Trip not found.");
    // A repeat action never overwrites an inbox already attached to the brief.
    if (!trip.agentMailInboxId)
      await ctx.db.patch("trips", trip._id, {
        agentMailInboxId: args.inboxId,
        agentMailInboxEmail: args.email,
        updatedAt: Date.now(),
      });
    return null;
  },
});

export function parseInbox(body: unknown): { inboxId: string; email: string } {
  if (!body || typeof body !== "object")
    throw new ConvexError("Inbox service returned an unexpected response.");
  const inboxId =
    "inbox_id" in body && typeof body.inbox_id === "string"
      ? body.inbox_id
      : "inboxId" in body && typeof body.inboxId === "string"
        ? body.inboxId
        : "";
  const email =
    "email" in body && typeof body.email === "string" ? body.email : "";
  if (
    !inboxId ||
    inboxId.length > 200 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  )
    throw new ConvexError("Inbox service returned an invalid inbox.");
  return { inboxId, email };
}
