import { RateLimiter, MINUTE, HOUR } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

const limiter = new RateLimiter(components.rateLimiter, {
  researchBurst: { kind: "token bucket", rate: 3, period: MINUTE, capacity: 3 },
  researchUser: { kind: "fixed window", rate: 20, period: HOUR },
  researchGlobal: { kind: "fixed window", rate: 100, period: HOUR },
});

export const consume = internalMutation({
  args: { tripId: v.id("trips") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const owner = await getAuthUserId(ctx);
    if (!owner) throw new ConvexError("Please sign in.");
    const trip = await ctx.db.get("trips", args.tripId);
    if (!trip || trip.owner !== owner) throw new ConvexError("Trip not found.");
    // All quotas consume in one transaction. Failure rolls every quota back.
    for (const name of [
      "researchBurst",
      "researchUser",
      "researchGlobal",
    ] as const) {
      const result = await limiter.limit(
        ctx,
        name,
        name === "researchGlobal" ? {} : { key: owner },
      );
      if (!result.ok)
        throw new ConvexError(
          "Research limit reached. Please try again later.",
        );
    }
    return null;
  },
});
