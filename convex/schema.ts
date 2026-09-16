import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export const assessment = v.object({
  requirementNumber: v.number(),
  status: v.union(
    v.literal("yes"),
    v.literal("partial"),
    v.literal("no"),
    v.literal("unknown"),
  ),
  evidence: v.string(),
});
export const priceBasis = v.union(
  v.literal("total"),
  v.literal("per_person"),
  v.literal("per_night"),
);

// A supplier may attach the documents they already work with — a quote PDF, a
// past itinerary, a completed trip — instead of retyping everything.
export const attachment = v.object({
  storageId: v.id("_storage"),
  name: v.string(),
  size: v.number(),
  contentType: v.optional(v.string()),
});

// The parts of a supplier's answer that are not per-requirement. All optional:
// a supplier who only writes prose and attaches a quote is a valid response.
export const offerDetails = v.object({
  inclusions: v.optional(v.array(v.string())),
  exclusions: v.optional(v.string()),
  itinerary: v.optional(v.string()),
  rooms: v.optional(v.string()),
  meals: v.optional(v.array(v.string())),
  transfers: v.optional(v.array(v.string())),
  terms: v.optional(v.string()),
});

// What the advisor gathers before any supplier is contacted. Every field is
// optional so a brief can still be created quickly; the arrays are bounded in
// trips.create. Budget stays with the advisor and is never shown to a supplier.
export const tripProfile = v.object({
  lane: v.optional(v.string()),
  groupStory: v.optional(v.string()),
  goodDay: v.optional(v.string()),
  boundaries: v.optional(v.string()),
  guardrails: v.optional(v.array(v.string())),
  groupType: v.optional(v.string()),
  ages: v.optional(v.string()),
  rooms: v.optional(v.string()),
  needs: v.optional(v.array(v.string())),
  interests: v.optional(v.array(v.string())),
  pace: v.optional(v.string()),
  setting: v.optional(v.string()),
  styles: v.optional(v.array(v.string())),
  mustDo: v.optional(v.string()),
  dateFlexibility: v.optional(v.string()),
  budgetBand: v.optional(v.string()),
  budgetCurrency: v.optional(v.string()),
  budgetCovers: v.optional(v.array(v.string())),
  // The assumptions the advisor accepted, recorded with the brief so the basis
  // of a later quote is not a matter of memory.
  assumptions: v.optional(v.array(v.string())),
  assumptionsAccepted: v.optional(v.boolean()),
});

export default defineSchema({
  ...authTables,
  supplierInvites: defineTable({
    token: v.string(), tripId: v.id("trips"), owner: v.string(), supplierName: v.string(),
    status: v.union(v.literal("open"), v.literal("submitted"), v.literal("revoked")),
    // A supplier on the roster either comes from the researched shortlist or is
    // added by hand; the email is what the trip inbox sends the link to.
    partnerId: v.optional(v.id("partners")),
    email: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    providerMessageId: v.optional(v.string()),
    sendError: v.optional(v.string()),
    offerId: v.optional(v.id("offers")), createdAt: v.number(), updatedAt: v.number(),
  }).index("by_token", ["token"]).index("by_tripId", ["tripId"]),
  partners: defineTable({
    tripId: v.id("trips"),
    owner: v.string(),
    title: v.string(),
    url: v.string(),
    description: v.string(),
  }).index("by_tripId", ["tripId"]),
  // A supplier's emailed reply, stored as it arrived. It is the raw material the
  // engine standardises, and it is never overwritten by an offer.
  supplierReplies: defineTable({
    tripId: v.id("trips"),
    owner: v.string(),
    inviteId: v.optional(v.id("supplierInvites")),
    inboxId: v.string(),
    fromEmail: v.string(),
    fromName: v.optional(v.string()),
    subject: v.string(),
    text: v.string(),
    messageId: v.string(),
    receivedAt: v.number(),
  })
    .index("by_tripId", ["tripId"])
    .index("by_messageId", ["messageId"])
    .index("by_inboxId", ["inboxId"]),
  trips: defineTable({
    owner: v.string(),
    title: v.string(),
    destination: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    travelers: v.number(),
    brief: v.string(),
    profile: v.optional(tripProfile),
    // Bounded at 30 in create; requirement numbers never change after offers arrive.
    requirements: v.array(v.object({ number: v.number(), text: v.string() })),
    status: v.union(
      v.literal("draft"),
      v.literal("comparing"),
      v.literal("selected"),
    ),
    selectedOfferId: v.optional(v.id("offers")),
    selectionReason: v.optional(v.string()),
    agentMailInboxId: v.optional(v.string()),
    agentMailInboxEmail: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_owner", ["owner"])
    // Inbound mail is matched to its brief by the inbox it arrived in.
    .index("by_agentMailInboxId", ["agentMailInboxId"]),
  offers: defineTable({
    owner: v.string(),
    tripId: v.id("trips"),
    supplierName: v.string(),
    sourceText: v.string(),
    amount: v.number(),
    currency: v.string(),
    priceBasis,
    assessments: v.array(assessment),
    details: v.optional(offerDetails),
    attachments: v.optional(v.array(attachment)),
    // Set when the engine has read this response against the requirements.
    standardisedAt: v.optional(v.number()),
    standardisedBy: v.optional(v.string()),
  }).index("by_tripId", ["tripId"]),
});
