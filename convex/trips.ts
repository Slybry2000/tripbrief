import { ConvexError, v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import schema, { assessment, priceBasis, tripProfile } from "./schema";
import { checkAssessments, checkAttachments, attachmentsValidator } from "./offerRules";
import { offerDetails } from "./schema";
import { getAuthUserId } from "@convex-dev/auth/server";

async function identity(ctx: Pick<QueryCtx, "auth">) {
  // Convex Auth subjects include the session ID. Its verified user ID remains
  // stable across sign-ins; tokenIdentifier would orphan trips on sign-out.
  const user = await getAuthUserId(ctx);
  if (!user) throw new ConvexError("Please sign in to use your workspace.");
  return user;
}
async function ownedTrip(ctx: QueryCtx, tripId: Id<"trips">) {
  const owner = await identity(ctx);
  const trip = await ctx.db.get("trips", tripId);
  if (!trip || trip.owner !== owner) throw new ConvexError("Trip not found.");
  return trip;
}
function text(value: string, label: string, maximum = 200) {
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maximum) throw new ConvexError(`${label} must contain 1–${maximum} characters.`);
  return cleaned;
}
function validDate(value: string) {
  const date = new Date(value + "T00:00:00Z");
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
// The intake collects chips, so every stored value is bounded: at most 12
// entries of at most 80 characters each, with no duplicates.
function validChips(values: string[] | undefined) {
  if (!values) return true;
  if (values.length > 12) return false;
  const cleaned = values.map((value) => value.trim());
  return (
    cleaned.every((value) => value.length > 0 && value.length <= 80) &&
    new Set(cleaned).size === cleaned.length
  );
}
function validProfile(profile: {
  lane?: string;
  groupStory?: string;
  goodDay?: string;
  boundaries?: string;
  guardrails?: string[];
  groupType?: string;
  ages?: string;
  rooms?: string;
  needs?: string[];
  interests?: string[];
  pace?: string;
  setting?: string;
  styles?: string[];
  mustDo?: string;
  dateFlexibility?: string;
  budgetBand?: string;
  budgetCurrency?: string;
  budgetCovers?: string[];
  assumptions?: string[];
  assumptionsAccepted?: boolean;
} | undefined) {
  if (!profile) return true;
  const singles = [
    profile.lane,
    profile.groupType,
    profile.ages,
    profile.rooms,
    profile.pace,
    profile.setting,
    profile.dateFlexibility,
    profile.budgetBand,
    profile.budgetCurrency,
  ];
  if (singles.some((value) => value !== undefined && (value.trim().length === 0 || value.length > 120)))
    return false;
  if (profile.mustDo !== undefined && profile.mustDo.length > 2000) return false;
  const prose = [profile.groupStory, profile.goodDay, profile.boundaries];
  if (prose.some((value) => value !== undefined && value.length > 4000))
    return false;
  if (
    profile.assumptions &&
    (profile.assumptions.length > 12 ||
      profile.assumptions.some((item) => item.length === 0 || item.length > 300))
  )
    return false;
  return (
    validChips(profile.needs) &&
    validChips(profile.interests) &&
    validChips(profile.styles) &&
    validChips(profile.budgetCovers) &&
    validChips(profile.guardrails)
  );
}

export const create = mutation({
  args: { title: v.string(), destination: v.string(), startDate: v.string(), endDate: v.string(), travelers: v.number(), brief: v.string(), requirements: v.array(v.string()), profile: v.optional(tripProfile) },
  returns: v.id("trips"),
  handler: async (ctx, args) => {
    const owner = await identity(ctx);
    if (!validDate(args.startDate) || !validDate(args.endDate) || args.endDate < args.startDate) throw new ConvexError("Choose valid dates with departure before return.");
    if (!Number.isInteger(args.travelers) || args.travelers < 1 || args.travelers > 1000) throw new ConvexError("Travelers must be a whole number from 1 to 1,000.");
    if (args.requirements.length < 1 || args.requirements.length > 30) throw new ConvexError("Include 1–30 requirements.");
    if (!validProfile(args.profile)) throw new ConvexError("The group details are outside the allowed range.");
    return await ctx.db.insert("trips", {
      owner, title: text(args.title, "Title"), destination: text(args.destination, "Destination"),
      startDate: args.startDate, endDate: args.endDate, travelers: args.travelers,
      profile: args.profile,
      brief: text(args.brief, "Brief", 8000),
      requirements: args.requirements.map((item, i) => ({ number: i + 1, text: text(item, "Requirement", 500) })),
      status: "draft", updatedAt: Date.now(),
    });
  },
});
export const list = query({
  args: {}, returns: v.array(schema.doc("trips")),
  handler: async (ctx) => {
    const owner = await identity(ctx);
    return await ctx.db.query("trips").withIndex("by_owner", q => q.eq("owner", owner)).order("desc").take(100);
  },
});
export const get = query({
  args: { tripId: v.id("trips") },
  returns: v.object({ trip: schema.doc("trips"), offers: v.array(schema.doc("offers")) }),
  handler: async (ctx, args) => {
    const trip = await ownedTrip(ctx, args.tripId);
    const offers = await ctx.db.query("offers").withIndex("by_tripId", q => q.eq("tripId", args.tripId)).take(20);
    return { trip, offers };
  },
});
export const addOffer = mutation({
  args: {
    tripId: v.id("trips"),
    supplierName: v.string(),
    sourceText: v.string(),
    amount: v.number(),
    currency: v.string(),
    priceBasis,
    assessments: v.array(assessment),
    // An emailed response usually arrives with the supplier's own document.
    details: v.optional(offerDetails),
    attachments: v.optional(attachmentsValidator),
  },
  returns: v.id("offers"),
  handler: async (ctx, args) => {
    const trip = await ownedTrip(ctx, args.tripId);
    if (trip.status === "selected") throw new ConvexError("The decision is recorded. Offers are locked.");
    const existing = await ctx.db.query("offers").withIndex("by_tripId", q => q.eq("tripId", args.tripId)).take(20);
    if (existing.length >= 20) throw new ConvexError("A trip can hold up to 20 offers.");
    if (!Number.isFinite(args.amount) || args.amount < 0 || args.amount > 1e9) throw new ConvexError("Enter a valid non-negative price.");
    const currency = args.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency) || !Intl.supportedValuesOf("currency").includes(currency)) throw new ConvexError("Enter a recognized three-letter currency code.");
    const sourceText = text(args.sourceText, "Original proposal", 20000);
    const assessments = checkAssessments(args.assessments, trip.requirements, sourceText, {
      complete: true,
      requireEvidence: true,
      evidenceMustAppearInSource: true,
    });
    await checkAttachments(ctx, args.attachments);
    const offerId = await ctx.db.insert("offers", {
      owner: trip.owner,
      tripId: trip._id,
      supplierName: text(args.supplierName, "Supplier"),
      sourceText,
      amount: args.amount,
      currency,
      priceBasis: args.priceBasis,
      assessments,
      details: args.details,
      attachments: args.attachments,
    });
    await ctx.db.patch("trips", trip._id, { status: "comparing", updatedAt: Date.now() });
    return offerId;
  },
});
export const selectOffer = mutation({
  args: { tripId: v.id("trips"), offerId: v.id("offers"), reason: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const trip = await ownedTrip(ctx, args.tripId);
    const offer = await ctx.db.get("offers", args.offerId);
    if (!offer || offer.tripId !== trip._id || offer.owner !== trip.owner) throw new ConvexError("Offer not found for this trip.");
    await ctx.db.patch("trips", trip._id, { status: "selected", selectedOfferId: offer._id, selectionReason: text(args.reason, "Decision reason", 2000), updatedAt: Date.now() });
    return null;
  },
});

// The advisor reads a supplier's attachment through a short-lived URL, and only
// for an offer on their own brief. Nothing here is publicly addressable.
export const attachmentUrl = query({
  args: { offerId: v.id("offers"), storageId: v.id("_storage") },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    const offer = await ctx.db.get("offers", args.offerId);
    if (!offer) throw new ConvexError("Offer not found.");
    await ownedTrip(ctx, offer.tripId);
    return await ctx.storage.getUrl(args.storageId);
  },
});

// Deleting a brief removes everything that belongs to it, in one transaction:
// the brief, its requirements and group details, its shortlist, its suppliers
// and their response links, its offers, and the files suppliers attached.
// A brief is always deletable, including one whose decision is recorded.
export const remove = mutation({
  args: { tripId: v.id("trips") },
  returns: v.object({
    offers: v.number(),
    suppliers: v.number(),
    partners: v.number(),
    attachments: v.number(),
  }),
  handler: async (ctx, args) => {
    const trip = await ownedTrip(ctx, args.tripId);
    const offers = await ctx.db
      .query("offers")
      .withIndex("by_tripId", (q) => q.eq("tripId", trip._id))
      .take(20);
    const invites = await ctx.db
      .query("supplierInvites")
      .withIndex("by_tripId", (q) => q.eq("tripId", trip._id))
      .take(50);
    const partners = await ctx.db
      .query("partners")
      .withIndex("by_tripId", (q) => q.eq("tripId", trip._id))
      .take(20);
    let attachments = 0;
    for (const offer of offers) {
      for (const file of offer.attachments ?? []) {
        // The stored file is the supplier's document: it goes with the brief and
        // is not left orphaned in storage.
        await ctx.storage.delete(file.storageId);
        attachments += 1;
      }
      await ctx.db.delete("offers", offer._id);
    }
    for (const invite of invites) await ctx.db.delete("supplierInvites", invite._id);
    for (const partner of partners) await ctx.db.delete("partners", partner._id);
    await ctx.db.delete("trips", trip._id);
    return {
      offers: offers.length,
      suppliers: invites.length,
      partners: partners.length,
      attachments,
    };
  },
});
