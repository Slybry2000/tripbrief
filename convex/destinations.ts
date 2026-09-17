import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

// The locations an advisor can put in front of a client. Three sources, one list:
//
//  - the starter catalog, which is the agency's own reference knowledge and lives
//    in the interface
//  - the places its operators actually serve, read from the network, so growing
//    the network grows this list
//  - the places the advisor adds by hand, for a client who asks for somewhere the
//    network has not reached yet — which is a reason to go and find operators
//    there, not a dead end
//
// Nothing here ranks anything. Scoring a place against a brief is the interface's
// job, and a place nobody has assessed is reported as unassessed rather than as a
// poor fit.

export function slugify(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function readName(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const listedDestination = v.object({
  slug: v.string(),
  name: v.string(),
  country: v.string(),
  // "network" means an operator serves it; "added" means the advisor put it there.
  source: v.union(v.literal("network"), v.literal("added")),
  // The advisor's own assessment, when they made one. Empty means unassessed.
  strengths: v.array(v.string()),
  operatorCount: v.number(),
});

export const list = query({
  args: {},
  returns: v.array(listedDestination),
  handler: async (ctx) => {
    const owner = await getAuthUserId(ctx);
    if (!owner) return [];
    const operators = await ctx.db
      .query("operators")
      .withIndex("by_owner_and_slug", (q) => q.eq("owner", owner))
      .take(200);
    const capabilities = await ctx.db
      .query("operatorCapability")
      .withIndex("by_owner_and_operatorSlug", (q) => q.eq("owner", owner))
      .take(200);
    const added = await ctx.db
      .query("destinations")
      .withIndex("by_owner_and_slug", (q) => q.eq("owner", owner))
      .take(200);

    // Who serves where, counted from the operators themselves. The operator record
    // carries the country it is based in; its capability says which country it
    // covers for each destination, which is the better answer when it has one.
    const found = new Map<
      string,
      {
        slug: string;
        name: string;
        country: string;
        source: "network" | "added";
        strengths: string[];
        operatorCount: number;
      }
    >();
    const covering = new Map<string, Set<string>>();
    const countryOf = new Map<string, string>();
    for (const capability of capabilities)
      for (const area of capability.serviceAreas)
        if (area.destinationSlug && area.country)
          countryOf.set(area.destinationSlug, area.country);
    for (const operator of operators)
      for (const slug of operator.destinations) {
        const set = covering.get(slug) ?? new Set<string>();
        set.add(operator.slug);
        covering.set(slug, set);
      }
    for (const [slug, set] of covering)
      found.set(slug, {
        slug,
        name: readName(slug),
        country: countryOf.get(slug) ?? "",
        source: "network",
        strengths: [],
        operatorCount: set.size,
      });

    // A place the network serves and the advisor also added is one row: the
    // operators are the fact, the advisor's assessment is the detail on top.
    for (const row of added) {
      const known = found.get(row.slug);
      found.set(row.slug, {
        slug: row.slug,
        name: known?.name ?? row.name,
        country: known?.country || row.country,
        source: known ? "network" : "added",
        strengths: row.strengths,
        operatorCount: known?.operatorCount ?? 0,
      });
    }

    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
  },
});

// Adding a place is how an advisor answers "the client wants Vietnam" when the
// network has never been there. Which operators cover it is the next step's
// problem, and the page says so.
export const add = mutation({
  args: {
    name: v.string(),
    country: v.string(),
    strengths: v.array(v.string()),
  },
  returns: v.object({ slug: v.string(), name: v.string() }),
  handler: async (ctx, args) => {
    const owner = await getAuthUserId(ctx);
    if (!owner) throw new ConvexError("Please sign in.");
    const name = args.name.trim().replace(/\s+/g, " ").slice(0, 60);
    const slug = slugify(name);
    if (!slug) throw new ConvexError("Give the location a name.");
    const existing = await ctx.db
      .query("destinations")
      .withIndex("by_owner_and_slug", (q) =>
        q.eq("owner", owner).eq("slug", slug),
      )
      .unique();
    if (existing)
      throw new ConvexError(`${name} is already on your list.`);
    await ctx.db.insert("destinations", {
      owner,
      slug,
      name,
      country: args.country.trim().replace(/\s+/g, " ").slice(0, 60),
      // Only the vocabulary the brief knows about, so an assessment can actually
      // be scored later. An empty list is a valid answer.
      strengths: [...new Set(args.strengths.map((item) => item.trim()))]
        .filter(Boolean)
        .slice(0, 25),
      updatedAt: Date.now(),
    });
    return { slug, name };
  },
});

// Only a place the advisor added can be removed. One the network covers is not
// theirs to delete — it is a fact about their operators, and deleting it here
// would hide an operator from the matching that reads the same list.
export const remove = mutation({
  args: { slug: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const owner = await getAuthUserId(ctx);
    if (!owner) throw new ConvexError("Please sign in.");
    const row = await ctx.db
      .query("destinations")
      .withIndex("by_owner_and_slug", (q) =>
        q.eq("owner", owner).eq("slug", args.slug),
      )
      .unique();
    if (!row)
      throw new ConvexError(
        "Only a location you added can be removed. This one comes from your operator network.",
      );
    await ctx.db.delete("destinations", row._id);
    return null;
  },
});
