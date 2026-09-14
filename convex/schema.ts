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

export default defineSchema({
  ...authTables,
  supplierInvites: defineTable({
    token: v.string(), tripId: v.id("trips"), owner: v.string(), supplierName: v.string(),
    status: v.union(v.literal("open"), v.literal("submitted"), v.literal("revoked")),
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
