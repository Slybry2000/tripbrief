import { RateLimiter, HOUR, DAY } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

// Quotas exist so one workspace, or one busy demo, cannot exhaust a shared
// provider credential. Every limit has a per-user entry and an app-wide backstop.
const limiter = new RateLimiter(components.rateLimiter, {
  analysisUser: { kind: "fixed window", rate: 5, period: HOUR },
  analysisGlobal: { kind: "fixed window", rate: 50, period: DAY },
  researchUser: { kind: "fixed window", rate: 5, period: HOUR },
  researchGlobal: { kind: "fixed window", rate: 40, period: DAY },
  sendUser: { kind: "fixed window", rate: 10, period: HOUR },
  sendGlobal: { kind: "fixed window", rate: 60, period: DAY },
  // A brief gets its own inbox, because that is what makes a reply
  // attributable to one brief without reading the message. Inboxes are therefore
  // the most expensive thing here and the limit has to match the mail plan: the
  // numbers below suit a paid plan, and they exist to stop a runaway loop rather
  // than to ration normal use.
  inboxUser: { kind: "fixed window", rate: 8, period: DAY },
  inboxGlobal: { kind: "fixed window", rate: 40, period: DAY },
});

async function requireOwnedBrief(ctx: MutationCtx, briefId: Id<"briefs">) {
  const owner = await getAuthUserId(ctx);
  if (!owner) throw new ConvexError("Please sign in.");
  const brief = await ctx.db.get("briefs", briefId);
  if (!brief || brief.owner !== owner) throw new ConvexError("Brief not found.");
  return owner;
}

type LimitName =
  | "analysisUser"
  | "analysisGlobal"
  | "researchUser"
  | "researchGlobal"
  | "sendUser"
  | "sendGlobal"
  | "inboxUser"
  | "inboxGlobal";

// A per-workspace limit and an app-wide backstop are spent together: reserving
// only one of them would let either a single workspace or a shared credential run
// away with the quota.
async function spend(
  ctx: MutationCtx,
  owner: string,
  user: LimitName,
  global: LimitName,
  message: string,
) {
  const perUser = await limiter.limit(ctx, user, { key: owner });
  if (!perUser.ok) throw new ConvexError(message);
  const appWide = await limiter.limit(ctx, global, {});
  if (!appWide.ok) throw new ConvexError(message);
}

export const consumeAnalysis = internalMutation({
  args: { briefId: v.id("briefs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const owner = await requireOwnedBrief(ctx, args.briefId);
    await spend(
      ctx,
      owner,
      "analysisUser",
      "analysisGlobal",
      "AI drafting limit reached. Please try again later.",
    );
    return null;
  },
});

export const consumeResearch = internalMutation({
  args: { briefId: v.id("briefs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const owner = await requireOwnedBrief(ctx, args.briefId);
    await spend(
      ctx,
      owner,
      "researchUser",
      "researchGlobal",
      "Operator research limit reached. Please try again later.",
    );
    return null;
  },
});

export const consumeSend = internalMutation({
  args: { briefId: v.id("briefs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const owner = await requireOwnedBrief(ctx, args.briefId);
    await spend(
      ctx,
      owner,
      "sendUser",
      "sendGlobal",
      "Sending limit reached. Please try again later.",
    );
    return null;
  },
});

export const consumeInbox = internalMutation({
  args: { briefId: v.id("briefs"), owner: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await spend(
      ctx,
      args.owner,
      "inboxUser",
      "inboxGlobal",
      "Demo inbox limit reached. The recorded demo remains available.",
    );
    return null;
  },
});
