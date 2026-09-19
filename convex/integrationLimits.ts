import { RateLimiter, HOUR, DAY } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

// Quotas exist so one workspace, or one busy demo, cannot exhaust a shared
// provider credential. Every limit has a per-user entry and an app-wide backstop.
const limiter = new RateLimiter(components.rateLimiter, {
  // Sized for judging: one brief to five operators costs five sends and five
  // model replies in demo mode, and a judge may run it more than once.
  analysisUser: { kind: "fixed window", rate: 30, period: HOUR },
  analysisGlobal: { kind: "fixed window", rate: 400, period: DAY },
  researchUser: { kind: "fixed window", rate: 12, period: HOUR },
  researchGlobal: { kind: "fixed window", rate: 150, period: DAY },
  sendUser: { kind: "fixed window", rate: 20, period: HOUR },
  sendGlobal: { kind: "fixed window", rate: 200, period: DAY },
  // Mailboxes are not rationed here: the workspace keeps a small fixed pool
  // (`MAILBOX_LIMIT`), which is a hard ceiling rather than a rate, so a rate
  // limiter would only get in the way of reusing one.
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
  | "sendGlobal";

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

// The operator's own import runs without an account: the request link it was
// given is the credential. The quota still belongs to the brief's workspace,
// which is the account paying for the providers, so it is spent on that owner's
// behalf rather than skipped. Internal, so a client can only reach it through a
// call that has already checked the link.
export const consumeAnalysisForLink = internalMutation({
  args: { briefId: v.id("briefs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const brief = await ctx.db.get("briefs", args.briefId);
    if (!brief) throw new ConvexError("Brief not found.");
    await spend(
      ctx,
      brief.owner,
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

// The same quotas, charged to a workspace directly. Used where there is no brief
// yet (looking up a place, finding operators for it) and by work the server does
// on the workspace's behalf (a demo operator's reply).
export const consumeForOwner = internalMutation({
  args: {
    owner: v.string(),
    kind: v.union(v.literal("research"), v.literal("analysis"), v.literal("send")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.kind === "research")
      await spend(ctx, args.owner, "researchUser", "researchGlobal", "Web research limit reached. Please try again later.");
    else if (args.kind === "analysis")
      await spend(ctx, args.owner, "analysisUser", "analysisGlobal", "AI drafting limit reached. Please try again later.");
    else
      await spend(ctx, args.owner, "sendUser", "sendGlobal", "Sending limit reached. Please try again later.");
    return null;
  },
});
