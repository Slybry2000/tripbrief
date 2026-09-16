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

// What the advisor gathers before any supplier is contacted. Every field is
// optional so a brief can still be created quickly; the arrays are bounded in
// trips.create. Budget stays with the advisor and is never shown to a supplier.
export const tripProfile = v.object({
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
  }).index("by_owner", ["owner"]),
  offers: defineTable({
    owner: v.string(),
    tripId: v.id("trips"),
    supplierName: v.string(),
    sourceText: v.string(),
    amount: v.number(),
    currency: v.string(),
    priceBasis,
    assessments: v.array(assessment),
  }).index("by_tripId", ["tripId"]),
});
