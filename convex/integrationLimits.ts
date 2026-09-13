import { RateLimiter, HOUR, DAY, WEEK } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

const limiter = new RateLimiter(components.rateLimiter, {
  analysisUser: { kind: "fixed window", rate: 5, period: HOUR },
  analysisGlobal: { kind: "fixed window", rate: 50, period: DAY },
  inboxUser: { kind: "fixed window", rate: 1, period: WEEK },
  // AgentMail's free plan has three inboxes. One is retained for the local demo,
  // leaving at most two production creations during the judging window.
  inboxGlobal: { kind: "fixed window", rate: 2, period: WEEK },
});

async function requireOwnedTrip(
  ctx: MutationCtx,
  tripId: Id<"trips">,
) {
  const owner = await getAuthUserId(ctx);
  if (!owner) throw new ConvexError("Please sign in.");
  const trip = await ctx.db.get("trips", tripId);
  if (!trip || trip.owner !== owner) throw new ConvexError("Trip not found.");
  return owner;
}

export const consumeAnalysis = internalMutation({
  args: { tripId: v.id("trips") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const owner = await requireOwnedTrip(ctx, args.tripId);
    for (const name of ["analysisUser", "analysisGlobal"] as const) {
      const result = await limiter.limit(
        ctx,
        name,
        name === "analysisGlobal" ? {} : { key: owner },
      );
      if (!result.ok)
        throw new ConvexError(
          "AI review limit reached. Please try again later.",
        );
    }
    return null;
  },
});

export const consumeInbox = internalMutation({
  args: { tripId: v.id("trips") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const owner = await requireOwnedTrip(ctx, args.tripId);
    for (const name of ["inboxUser", "inboxGlobal"] as const) {
      const result = await limiter.limit(
        ctx,
        name,
        name === "inboxGlobal" ? {} : { key: owner },
      );
      if (!result.ok)
        throw new ConvexError(
          "Demo inbox limit reached. The recorded demo remains available.",
        );
    }
    return null;
  },
});
