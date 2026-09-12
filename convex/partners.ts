import { mutation, query, type QueryCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

async function owned(ctx: QueryCtx, tripId: Id<"trips">) {
  const owner = await getAuthUserId(ctx);
  if (!owner) throw new ConvexError("Please sign in.");
  const trip = await ctx.db.get("trips", tripId);
  if (!trip || trip.owner !== owner) throw new ConvexError("Trip not found.");
  return trip;
}

export const list = query({
  args: { tripId: v.id("trips") },
  returns: v.array(schema.doc("partners")),
  handler: async (ctx, args) => {
    await owned(ctx, args.tripId);
    return await ctx.db
      .query("partners")
      .withIndex("by_tripId", (q) => q.eq("tripId", args.tripId))
      .take(20);
  },
});

export const save = mutation({
  args: {
    tripId: v.id("trips"),
    title: v.string(),
    url: v.string(),
    description: v.string(),
  },
  returns: v.id("partners"),
  handler: async (ctx, args) => {
    const trip = await owned(ctx, args.tripId);
    if (trip.status === "selected")
      throw new ConvexError("This trip's decision is already recorded.");
    let url: URL;
    try {
      url = new URL(args.url);
    } catch {
      throw new ConvexError("Enter a valid website URL.");
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.href.length > 2000
    )
      throw new ConvexError("Use an HTTPS website without credentials.");
    const title = args.title.trim();
    if (!title || title.length > 300 || args.description.length > 2000)
      throw new ConvexError("Partner details exceed the allowed length.");
    const partners = await ctx.db
      .query("partners")
      .withIndex("by_tripId", (q) => q.eq("tripId", args.tripId))
      .take(20);
    const existing = partners.find((p) => p.url === url.href);
    if (existing) return existing._id;
    if (partners.length >= 20)
      throw new ConvexError("A trip can shortlist up to 20 partners.");
    return await ctx.db.insert("partners", {
      ...args,
      title,
      url: url.href,
      owner: trip.owner,
    });
  },
});
