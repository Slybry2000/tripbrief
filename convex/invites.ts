import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import schema, { assessment, priceBasis } from "./schema";
import {
  assembleResponseText,
  attachmentsValidator,
  checkAssessments,
  checkAttachments,
} from "./offerRules";
import { offerDetails } from "./schema";

// The client generates 32 cryptographically random bytes, encoded as base64url.
// Format validation cannot prove randomness; never derive tokens from trip IDs.
const validToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);
// Deliberately simple: the value is checked here only so a typo cannot reach the
// email provider. Deliverability is the provider's problem, not a regex.
const validEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 254;
async function ownedPartner(ctx: QueryCtx, partnerId: Id<"partners">) {
  const partner = await ctx.db.get("partners", partnerId);
  if (!partner) throw new ConvexError("Shortlisted partner not found.");
  return partner;
}
async function insertInvite(
  ctx: MutationCtx,
  trip: Doc<"trips">,
  supplierName: string,
  token: string,
  email: string | undefined,
  partnerId: Id<"partners"> | undefined,
) {
  const existingTokens = await ctx.db
    .query("supplierInvites")
    .withIndex("by_tripId", (q) => q.eq("tripId", trip._id))
    .take(50);
  if (existingTokens.some((invite) => invite.token === token))
    throw new ConvexError("This invitation link was already created.");
  if (existingTokens.length >= 50)
    throw new ConvexError("A trip can have at most 50 suppliers.");
  if (partnerId && existingTokens.some((invite) => invite.partnerId === partnerId))
    throw new ConvexError(`${supplierName} already has a response link.`);
  const now = Date.now();
  return await ctx.db.insert("supplierInvites", {
    token,
    tripId: trip._id,
    owner: trip.owner,
    supplierName,
    status: "open",
    partnerId,
    email,
    createdAt: now,
    updatedAt: now,
  });
}
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
  args: {
    tripId: v.id("trips"),
    supplierName: v.string(),
    token: v.string(),
    email: v.optional(v.string()),
  },
  returns: v.id("supplierInvites"),
  handler: async (ctx, args) => {
    const trip = await ownedTrip(ctx, args.tripId);
    if (trip.status === "selected") throw new ConvexError("This trip is closed for proposals.");
    if (!validToken(args.token)) throw new ConvexError("Use a secure 32-byte invitation token.");
    const supplierName = args.supplierName.trim();
    if (!supplierName || supplierName.length > 200) throw new ConvexError("Supplier name must contain 1–200 characters.");
    if (args.email !== undefined && !validEmail(args.email.trim()))
      throw new ConvexError("Enter a valid email address, or leave it blank.");
    if (await findInvite(ctx, args.token)) throw new ConvexError("Invitation token already used.");
    return await insertInvite(
      ctx,
      trip,
      supplierName,
      args.token,
      args.email?.trim() || undefined,
      undefined,
    );
  },
});

// The roster is the researched shortlist: a response link is created from a
// partner the advisor already shortlisted, not from a name typed from scratch.
export const createFromPartner = mutation({
  args: {
    tripId: v.id("trips"),
    partnerId: v.id("partners"),
    token: v.string(),
    email: v.optional(v.string()),
  },
  returns: v.id("supplierInvites"),
  handler: async (ctx, args) => {
    const trip = await ownedTrip(ctx, args.tripId);
    if (trip.status === "selected")
      throw new ConvexError("This trip is closed for proposals.");
    if (!validToken(args.token))
      throw new ConvexError("Use a secure 32-byte invitation token.");
    const partner = await ownedPartner(ctx, args.partnerId);
    if (partner.tripId !== trip._id || partner.owner !== trip.owner)
      throw new ConvexError("That partner belongs to another brief.");
    if (args.email !== undefined && !validEmail(args.email.trim()))
      throw new ConvexError("Enter a valid email address, or leave it blank.");
    if (await findInvite(ctx, args.token)) throw new ConvexError("Invitation token already used.");
    return await insertInvite(
      ctx,
      trip,
      partner.title,
      args.token,
      args.email?.trim() || undefined,
      partner._id,
    );
  },
});

// Recording the address is separate from creating the link so the advisor can
// shortlist and hand out links before the supplier's address is known.
export const setEmail = mutation({
  args: { inviteId: v.id("supplierInvites"), email: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const invite = await ctx.db.get("supplierInvites", args.inviteId);
    if (!invite) throw new ConvexError("Supplier not found.");
    await ownedTrip(ctx, invite.tripId);
    const email = args.email.trim();
    if (!validEmail(email))
      throw new ConvexError("Enter a valid email address.");
    if (invite.sentAt)
      throw new ConvexError("This invitation has already been sent.");
    await ctx.db.patch("supplierInvites", invite._id, { email, updatedAt: Date.now() });
    return null;
  },
});

// Actions have no database access, so the send path reads through this and
// writes back through markSent / markFailed.
export const forSend = internalQuery({
  args: { inviteId: v.id("supplierInvites") },
  returns: v.object({
    invite: schema.doc("supplierInvites"),
    trip: schema.doc("trips"),
  }),
  handler: async (ctx, args) => {
    const invite = await ctx.db.get("supplierInvites", args.inviteId);
    if (!invite) throw new ConvexError("Supplier not found.");
    const trip = await ctx.db.get("trips", invite.tripId);
    if (!trip) throw new ConvexError("Brief not found.");
    return { invite, trip };
  },
});

export const markSent = internalMutation({
  args: { inviteId: v.id("supplierInvites"), providerMessageId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("supplierInvites", args.inviteId, {
      sentAt: Date.now(),
      providerMessageId: args.providerMessageId.slice(0, 200),
      sendError: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const markFailed = internalMutation({
  args: { inviteId: v.id("supplierInvites"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("supplierInvites", args.inviteId, {
      sendError: args.error.slice(0, 300),
      updatedAt: Date.now(),
    });
    return null;
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
  args: {
    token: v.string(),
    sourceText: v.string(),
    amount: v.number(),
    currency: v.string(),
    priceBasis,
    // A supplier may answer every requirement, some of them, or none at all:
    // whatever they send is standardised against the requirements afterwards.
    assessments: v.optional(v.array(assessment)),
    details: v.optional(offerDetails),
    attachments: v.optional(attachmentsValidator),
  },
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
    // One document, assembled from everything the supplier gave, so the engine,
    // the evidence check and the advisor all read the same source.
    const responseText = assembleResponseText({
      quote: sourceText,
      inclusions: args.details?.inclusions,
      exclusions: args.details?.exclusions,
      itinerary: args.details?.itinerary,
      rooms: args.details?.rooms,
      meals: args.details?.meals,
      transfers: args.details?.transfers,
      terms: args.details?.terms,
      answers: (args.assessments ?? []).map((item) => ({
        requirementText:
          trip.requirements.find((r) => r.number === item.requirementNumber)
            ?.text ?? `Requirement ${item.requirementNumber}`,
        answer: item.evidence,
      })),
    });
    if (responseText.length > 20000)
      throw new ConvexError("Your response is too long to send. Trim it and try again.");
    await checkAttachments(ctx, args.attachments);
    const assessments = checkAssessments(
      args.assessments,
      trip.requirements,
      responseText,
      {
        complete: false,
        requireEvidence: false,
        evidenceMustAppearInSource: false,
      },
    );
    const details = args.details
      ? {
          ...args.details,
          exclusions: args.details.exclusions?.trim().slice(0, 2000),
          itinerary: args.details.itinerary?.trim().slice(0, 8000),
          terms: args.details.terms?.trim().slice(0, 4000),
          rooms: args.details.rooms?.trim().slice(0, 200),
        }
      : undefined;
    const offerId = await ctx.db.insert("offers", {
      owner: trip.owner,
      tripId: trip._id,
      supplierName: invite.supplierName,
      sourceText: responseText,
      amount: args.amount,
      currency,
      priceBasis: args.priceBasis,
      assessments,
      details,
      attachments: args.attachments,
    });
    const now = Date.now();
    await ctx.db.patch("supplierInvites", invite._id, { status: "submitted", offerId, updatedAt: now });
    await ctx.db.patch("trips", trip._id, { status: "comparing", updatedAt: now });
    return null;
  },
});

// The supplier has no account, so the upload URL is authorised by the same
// single-use invitation token that opened the portal, and only while it is open.
export const createUploadUrl = mutation({
  args: { token: v.string() },
  returns: v.object({ url: v.string() }),
  handler: async (ctx, args) => {
    const invite = await findInvite(ctx, args.token);
    if (!invite || invite.status !== "open")
      throw new ConvexError("This invitation is unavailable or already submitted.");
    return { url: await ctx.storage.generateUploadUrl() };
  },
});
