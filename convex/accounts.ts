import { env, internalQuery, query, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import { demoMode } from "./demo";

// Who a workspace is, and what it is allowed to do.

export type Permission = {
  allowed: boolean;
  reason: string;
  email: string;
  isTrial: boolean;
};

// The workspaces that may send real email. Empty means none: a public app whose
// sending is open to anyone who signs up would spend the owner's mail account and
// send from their name, so the list has to be filled in deliberately.
export function allowedSenders() {
  return (env.SEND_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

// Pure, so the rule can be read and tested in one place.
export function evaluate(
  account: { email: string; isAnonymous: boolean },
  allowlist: string[],
): Permission {
  if (account.isAnonymous)
    return {
      allowed: false,
      reason:
        "This is a trial workspace, so it cannot send email. Everything else works: the matching, the operator links, the proposals and the comparison. Create an account to send for real.",
      email: account.email,
      isTrial: true,
    };
  if (!allowlist.length)
    return {
      allowed: false,
      reason:
        "Sending has not been enabled on this deployment yet. The operator who runs it has to add this address to its send list.",
      email: account.email,
      isTrial: false,
    };
  if (!allowlist.includes(account.email))
    return {
      allowed: false,
      reason: `${account.email} is not on this deployment's send list, so it cannot send email.`,
      email: account.email,
      isTrial: false,
    };
  return { allowed: true, reason: "", email: account.email, isTrial: false };
}

// The account behind a session. The identity carries the email and is what marks a
// trial; the users row carries the flag the auth library sets. Either may be
// missing, and a session with no email is a trial — which is exactly what the
// anonymous provider produces.
async function accountOf(ctx: QueryCtx, owner: string) {
  const identity = await ctx.auth.getUserIdentity();
  const user = await ctx.db
    .get("users", owner as Id<"users">)
    // An owner that is not a row in this table cannot happen in production, where
    // the id comes from the session; treating it as "no account" is what keeps a
    // stray session from being granted anything.
    .catch(() => null);
  const email = (user?.email ?? identity?.email ?? "").trim().toLowerCase();
  return { email, isAnonymous: user?.isAnonymous === true || !email };
}

// The permission itself, for the send path to consult.
export const permissionFor = internalQuery({
  args: { owner: v.string() },
  returns: v.object({
    allowed: v.boolean(),
    reason: v.string(),
    email: v.string(),
    isTrial: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const account = await accountOf(ctx, args.owner);
    // In demo mode nothing reaches a real operator, so anyone may send.
    if (demoMode().on) return { allowed: true, reason: "", email: account.email, isTrial: account.isAnonymous };
    return evaluate(account, allowedSenders());
  },
});

// What the interface shows about the signed-in workspace.
export const me = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      email: v.string(),
      isTrial: v.boolean(),
      canSend: v.boolean(),
      reason: v.string(),
      // Demo mode: every request goes to a stand-in inbox and a model answers as
      // the operator. The interface says so wherever a send happens.
      demo: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const owner = await getAuthUserId(ctx);
    if (!owner) return null;
    const account = await accountOf(ctx, owner);
    const demo = demoMode().on;
    const permission = evaluate(account, allowedSenders());
    return {
      email: account.email,
      isTrial: account.isAnonymous,
      canSend: demo || permission.allowed,
      reason: demo ? "" : permission.reason,
      demo,
    };
  },
});
