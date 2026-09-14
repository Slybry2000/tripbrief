import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import schema, { assessment, priceBasis } from "./schema";

// The client generates 32 cryptographically random bytes, encoded as base64url.
// Format validation cannot prove randomness; never derive tokens from trip IDs.
const validToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);
async function ownedTrip(ctx: QueryCtx, tripId: Id<"trips">) {
  const owner = await getAuthUserId(ctx);
  if (!owner) throw new ConvexError("Please sign in.");
  const trip = await ctx.db.get("trips", tripId);
  if (!trip || trip.owner !== owner) throw new ConvexError("Trip not found.");
  return trip;
}
async function findInvite(ctx: QueryCtx, token: string) {
  if (!validToken(token)) return null;
  return await ctx.db.query("supplierInvites").withIndex("by_token", q => q.eq("token", token)).unique();
}
export const create = mutation({
  args: { tripId: v.id("trips"), supplierName: v.string(), token: v.string() },
  returns: v.id("supplierInvites"),
  handler: async (ctx, args) => {
    const trip = await ownedTrip(ctx, args.tripId);
    if (trip.status === "selected") throw new ConvexError("This trip is closed for proposals.");
    if (!validToken(args.token)) throw new ConvexError("Use a secure 32-byte invitation token.");
    const supplierName = args.supplierName.trim();
    if (!supplierName || supplierName.length > 200) throw new ConvexError("Supplier name must contain 1–200 characters.");
    if (await findInvite(ctx, args.token)) throw new ConvexError("Invitation token already used.");
    const invites = await ctx.db.query("supplierInvites").withIndex("by_tripId", q => q.eq("tripId", trip._id)).take(50);
    if (invites.length >= 50) throw new ConvexError("A trip can have at most 50 invitations.");
    const now = Date.now();
    return await ctx.db.insert("supplierInvites", { ...args, supplierName, owner: trip.owner, status: "open", createdAt: now, updatedAt: now });
  },
});
export const list = query({
  args: { tripId: v.id("trips") }, returns: v.array(schema.doc("supplierInvites")),
  handler: async (ctx, args) => {
    await ownedTrip(ctx, args.tripId);
    return await ctx.db.query("supplierInvites").withIndex("by_tripId", q => q.eq("tripId", args.tripId)).take(50);
  },
});
export const revoke = mutation({
  args: { inviteId: v.id("supplierInvites") }, returns: v.null(),
  handler: async (ctx, args) => {
    const invite = await ctx.db.get("supplierInvites", args.inviteId);
    if (!invite) throw new ConvexError("Invitation not found.");
    await ownedTrip(ctx, invite.tripId);
    if (invite.status !== "open") throw new ConvexError("Only open invitations can be revoked.");
    await ctx.db.patch("supplierInvites", invite._id, { status: "revoked", updatedAt: Date.now() });
    return null;
  },
});
export const getByToken = query({
  args: { token: v.string() },
  returns: v.union(v.null(), v.object({ supplierName: v.string(), title: v.string(), destination: v.string(), startDate: v.string(), endDate: v.string(), travelers: v.number(), requirements: v.array(v.object({ number: v.number(), text: v.string() })) })),
  handler: async (ctx, args) => {
    const invite = await findInvite(ctx, args.token);
    if (!invite || invite.status !== "open") return null;
    const trip = await ctx.db.get("trips", invite.tripId);
    if (!trip || trip.status === "selected") return null;
    const { title, destination, startDate, endDate, travelers, requirements } = trip;
    return { supplierName: invite.supplierName, title, destination, startDate, endDate, travelers, requirements };
  },
});
export const submitByToken = mutation({
  args: { token: v.string(), sourceText: v.string(), amount: v.number(), currency: v.string(), priceBasis, assessments: v.array(assessment) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const invite = await findInvite(ctx, args.token);
    if (!invite || invite.status !== "open") throw new ConvexError("This invitation is unavailable or already submitted.");
    const trip = await ctx.db.get("trips", invite.tripId);
    if (!trip || trip.status === "selected") throw new ConvexError("This trip is closed for proposals.");
    const offers = await ctx.db.query("offers").withIndex("by_tripId", q => q.eq("tripId", trip._id)).take(20);
    if (offers.length >= 20) throw new ConvexError("This trip has reached its proposal limit.");
    const sourceText = args.sourceText.trim();
    if (!sourceText || sourceText.length > 20000) throw new ConvexError("Proposal must contain 1–20,000 characters.");
    if (!Number.isFinite(args.amount) || args.amount < 0 || args.amount > 1e9) throw new ConvexError("Enter a valid non-negative price.");
    const currency = args.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency) || !Intl.supportedValuesOf("currency").includes(currency)) throw new ConvexError("Enter a recognized three-letter currency code.");
    const numbers = new Set(args.assessments.map(a => a.requirementNumber));
    if (args.assessments.length !== trip.requirements.length || numbers.size !== trip.requirements.length || trip.requirements.some(r => !numbers.has(r.number))) throw new ConvexError("Every requirement needs exactly one assessment.");
    const assessments = args.assessments.map(a => {
      const evidence = a.evidence.trim();
      if (evidence.length > 2000 || (a.status !== "unknown" && !evidence)) throw new ConvexError("Each assessed answer needs proposal evidence.");
      if (evidence && !sourceText.includes(evidence)) throw new ConvexError("Evidence must be an exact excerpt from the proposal.");
      return { ...a, evidence };
    });
    const offerId = await ctx.db.insert("offers", { owner: trip.owner, tripId: trip._id, supplierName: invite.supplierName, sourceText, amount: args.amount, currency, priceBasis: args.priceBasis, assessments });
    const now = Date.now();
    await ctx.db.patch("supplierInvites", invite._id, { status: "submitted", offerId, updatedAt: now });
    await ctx.db.patch("trips", trip._id, { status: "comparing", updatedAt: now });
    return null;
  },
});
