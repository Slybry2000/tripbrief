import { action, env, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v, type Infer } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { placeProfile } from "./schema";
import { structuredResponse } from "./openai";
import { searchWithContent, type WebPage } from "./web";
import { CLIMATES, EXPERIENCES, slugify } from "./vocabulary";

type PlaceProfile = Infer<typeof placeProfile>;

// A researched place stays good for a season; after that it is looked up again.
const FRESH_FOR = 90 * 24 * 60 * 60 * 1000;
const MODEL = "gpt-4.1-mini";

// The advisor types a place and nothing else. What it is good for, its climate
// and what to plan around are read from published travel sources, and the sources
// travel with the answer so anyone can check them.
export const research = action({
  args: { name: v.string() },
  returns: v.object({ slug: v.string(), name: v.string(), fromCache: v.boolean() }),
  handler: async (ctx, args): Promise<{ slug: string; name: string; fromCache: boolean }> => {
    const owner = await getAuthUserId(ctx);
    if (!owner) throw new ConvexError("Please sign in.");
    const name = args.name.trim().replace(/\s+/g, " ").slice(0, 60);
    const slug = slugify(name);
    if (!slug) throw new ConvexError("Type the name of a country or place.");

    const cached: PlaceProfile | null = await ctx.runQuery(internal.places.cached, { slug });
    if (cached && Date.now() - cached.researchedAt < FRESH_FOR) {
      await ctx.runMutation(internal.places.saveForOwner, { owner, slug, profile: cached });
      return { slug, name: cached.name, fromCache: true };
    }

    const firecrawl = env.FIRECRAWL_API_KEY?.trim();
    const openai = env.OPENAI_API_KEY?.trim();
    if (!firecrawl || !openai) throw new ConvexError("Place research has not been configured.");
    await ctx.runMutation(internal.integrationLimits.consumeForOwner, { owner, kind: "research" });

    const pages: WebPage[] = [];
    for (const query of [
      `${name} travel guide best time to visit climate`,
      `${name} group travel wellness culture food highlights`,
    ]) {
      for (const page of await searchWithContent(firecrawl, query, 4))
        if (!pages.some((item) => item.url === page.url) && page.markdown.length > 200 && !/youtube\.|tiktok\.|facebook\.|instagram\.|reddit\./.test(page.url)) pages.push(page);
    }
    if (!pages.length) throw new ConvexError(`Nothing useful was published about ${name}. Check the spelling.`);
    const sources = pages.slice(0, 6);

    const raw = await structuredResponse({
      apiKey: openai,
      model: MODEL,
      developer:
        "You summarise what published travel sources say about a place, for a travel agency planning a private group trip. Use only the sources given. The description is two sentences and under 280 characters. Score each experience 0 to 5 for how genuinely strong the place is for it (5 = a reason people go, 0 = not offered). Be conservative: never score above 2 what the sources do not support. Watch-outs are practical planning cautions (seasons, distances, crowds), each under 120 characters.",
      user: [
        `PLACE: ${name}`,
        "",
        ...sources.map((page, index) => `SOURCE ${index} (${page.url})\n${page.markdown.slice(0, 5_000)}`),
      ].join("\n\n"),
      schemaName: "place_profile",
      schema: placeSchema(sources.length),
    });
    const profile = readProfile(raw, name, sources);
    await ctx.runMutation(internal.places.store, { slug, profile });
    await ctx.runMutation(internal.places.saveForOwner, { owner, slug, profile });
    return { slug, name: profile.name, fromCache: false };
  },
});

export function placeSchema(sourceCount: number) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["name", "country", "description", "climates", "experienceStrengths", "watchOuts", "sourcesUsed"],
    properties: {
      name: { type: "string" },
      country: { type: "string" },
      description: { type: "string" },
      climates: { type: "array", items: { type: "string", enum: CLIMATES } },
      experienceStrengths: {
        type: "object",
        additionalProperties: false,
        required: EXPERIENCES,
        properties: Object.fromEntries(EXPERIENCES.map((key) => [key, { type: "integer" }])),
      },
      watchOuts: { type: "array", maxItems: 3, items: { type: "string" } },
      sourcesUsed: {
        type: "array",
        items: { type: "integer", enum: Array.from({ length: sourceCount }, (_, index) => index) },
      },
    },
  };
}

export function readProfile(raw: unknown, typed: string, sources: WebPage[]): PlaceProfile {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (key: string, max: number) =>
    typeof value[key] === "string" ? (value[key]).replace(/\s+/g, " ").trim().slice(0, max) : "";
  const scores = (value.experienceStrengths && typeof value.experienceStrengths === "object"
    ? value.experienceStrengths
    : {}) as Record<string, unknown>;
  const experienceStrengths: Record<string, number> = {};
  for (const key of EXPERIENCES) {
    const score = scores[key];
    if (typeof score === "number" && Number.isFinite(score))
      experienceStrengths[key] = Math.max(0, Math.min(5, Math.round(score)));
  }
  const used = Array.isArray(value.sourcesUsed)
    ? value.sourcesUsed.filter((item): item is number => typeof item === "number" && sources[item] !== undefined)
    : [];
  const cited = (used.length ? [...new Set(used)].map((index) => sources[index]) : sources).slice(0, 5);
  return {
    name: str("name", 60) || typed,
    country: str("country", 60) || typed,
    description: shorten(str("description", 2_000), 320),
    climates: Array.isArray(value.climates)
      ? [...new Set(value.climates.filter((item): item is string => typeof item === "string" && CLIMATES.includes(item)))]
      : [],
    experienceStrengths,
    watchOuts: Array.isArray(value.watchOuts)
      ? value.watchOuts.filter((item): item is string => typeof item === "string").map((item) => shorten(item, 160)).slice(0, 3)
      : [],
    sources: cited.map((page) => ({ title: page.title.slice(0, 200), url: page.url })),
    researchedAt: Date.now(),
  };
}

export function shorten(text: string, max: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const sentence = cut.lastIndexOf(". ");
  if (sentence > max * 0.5) return cut.slice(0, sentence + 1);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:]$/, "")}…`;
}

export const cached = internalQuery({
  args: { slug: v.string() },
  returns: v.union(v.null(), placeProfile),
  handler: async (ctx, args) => {
    const row = await ctx.db.query("placeProfiles").withIndex("by_slug", (q) => q.eq("slug", args.slug)).first();
    if (!row) return null;
    const { _id, _creationTime, slug, ...profile } = row;
    void _id; void _creationTime; void slug;
    return profile;
  },
});

export const store = internalMutation({
  args: { slug: v.string(), profile: placeProfile },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("placeProfiles").withIndex("by_slug", (q) => q.eq("slug", args.slug)).first();
    if (existing) await ctx.db.replace("placeProfiles", existing._id, { slug: args.slug, ...args.profile });
    else await ctx.db.insert("placeProfiles", { slug: args.slug, ...args.profile });
    return null;
  },
});

// The place goes on this workspace's list, profile and all.
export const saveForOwner = internalMutation({
  args: { owner: v.string(), slug: v.string(), profile: placeProfile },
  returns: v.null(),
  handler: async (ctx, args) => {
    const strengths = Object.entries(args.profile.experienceStrengths)
      .filter(([, score]) => score >= 4)
      .map(([key]) => key);
    const existing = await ctx.db
      .query("destinations")
      .withIndex("by_owner_and_slug", (q) => q.eq("owner", args.owner).eq("slug", args.slug))
      .first();
    const fields = {
      name: args.profile.name,
      country: args.profile.country,
      strengths,
      profile: args.profile,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.patch("destinations", existing._id, fields);
    else await ctx.db.insert("destinations", { owner: args.owner, slug: args.slug, ...fields });
    return null;
  },
});
