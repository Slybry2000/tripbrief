import { action, env, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v, type Infer } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { webOperator } from "./schema";
import { structuredResponse } from "./openai";
import { bestEmail, domainOf, emailsIn, looksLikeDirectory, readPage, searchWithContent, type WebPage } from "./web";
import { EXPERIENCES, HOTEL_TYPES, OPERATIONS, TRAVELER_TYPES } from "./vocabulary";
import { buildOperatorQueries } from "./research";

type WebOperator = Infer<typeof webOperator>;

const MODEL = "gpt-4.1-mini";
const FRESH_FOR = 30 * 24 * 60 * 60 * 1000;
// Enough real operators to rank and shortlist from, few enough to read carefully.
const WANTED = 8;

// Real incoming tour operators and destination management companies for one
// place, found on the web and read from their own sites. The first workspace to
// ask pays for the search; everyone after reuses what it found.
export const findForDestination = action({
  args: { destinationSlug: v.string(), destinationName: v.string(), focus: v.array(v.string()) },
  returns: v.object({ added: v.number(), found: v.number(), fromCache: v.boolean() }),
  handler: async (ctx, args): Promise<{ added: number; found: number; fromCache: boolean }> => {
    const owner = await getAuthUserId(ctx);
    if (!owner) throw new ConvexError("Please sign in.");
    const slug = args.destinationSlug.trim().slice(0, 60);
    const place = args.destinationName.trim().slice(0, 60);
    if (!slug || !place) throw new ConvexError("Choose a location first.");

    const cached: WebOperator[] = await ctx.runQuery(internal.webOperators.forDestination, { destinationSlug: slug });
    const fresh = cached.filter((item) => Date.now() - item.foundAt < FRESH_FOR);
    if (fresh.length >= 3) {
      const added: number = await ctx.runMutation(internal.webOperators.importToWorkspace, { owner, operators: fresh });
      return { added, found: fresh.length, fromCache: true };
    }

    const firecrawl = env.FIRECRAWL_API_KEY?.trim();
    const openai = env.OPENAI_API_KEY?.trim();
    if (!firecrawl || !openai) throw new ConvexError("Operator research has not been configured.");
    await ctx.runMutation(internal.integrationLimits.consumeForOwner, { owner, kind: "research" });
    const operators = await discover(slug, place, args.focus, cached.map((item) => item.domain));
    await ctx.runMutation(internal.webOperators.store, { operators });
    const all = [...fresh, ...operators];
    const added: number = await ctx.runMutation(internal.webOperators.importToWorkspace, { owner, operators: all });
    return { added, found: all.length, fromCache: false };
  },
});


// Search, read each company's own site, keep real operators with the address
// their pages publish. Shared by the advisor's action and the ops warm-up.
async function discover(slug: string, place: string, focus: string[], known: string[]): Promise<WebOperator[]> {
    const firecrawl = env.FIRECRAWL_API_KEY?.trim();
    const openai = env.OPENAI_API_KEY?.trim();
    if (!firecrawl || !openai) throw new ConvexError("Operator research has not been configured.");

    // Company sites only: directories, marketplaces and review sites are dropped,
    // and one page per company is enough.
    const pages: WebPage[] = [];
    const domains = new Set(known);
    const queries = [
      ...buildOperatorQueries({ destinationName: place, focus: focus }),
      `${place} DMC B2B travel agents groups`,
      `${place} ground handler private group tours`,
    ];
    for (const query of queries) {
      // One slow or refused search must not sink the others: it is skipped, and
      // only a place where every search failed is reported as a failure.
      let results: WebPage[] = [];
      try { results = await searchWithContent(firecrawl, query, 6, true); } catch { continue; }
      for (const page of results) {
        const domain = domainOf(page.url);
        if (looksLikeDirectory(domain) || domains.has(domain) || page.markdown.length < 300) continue;
        domains.add(domain);
        pages.push(page);
      }
      if (pages.length >= 14) break;
    }
    if (!pages.length) throw new ConvexError(`No operator websites were found for ${place}. Try again later.`);

    const raw = await structuredResponse({
      apiKey: openai,
      model: MODEL,
      developer:
        "You read company websites for a travel agency looking for incoming tour operators (ITOs) and destination management companies (DMCs): local companies that run ground arrangements for groups in the destination. For each page say whether it is such a company's own website. Blogs, directories, hotels, airlines, international mass-market tour brands and booking sites are not. For a real operator, describe only what its own page shows: name, where it operates, what experiences and services it offers, the group types it serves. Never invent an email address, a certification or a price.",
      user: [`DESTINATION: ${place}`, "", ...pages.map((page, index) => `PAGE ${index} (${page.url})\n${page.markdown.slice(0, 4_000)}`)].join("\n\n"),
      schemaName: "operator_pages",
      schema: operatorSchema(pages.length),
      timeoutMs: 90_000,
    });

    const operators: WebOperator[] = [];
    for (const item of readOperators(raw, pages)) {
      if (operators.length >= WANTED) break;
      const page = pages[item.pageIndex];
      const domain = domainOf(page.url);
      // The address comes from the operator's own pages, never from the model:
      // first the page we already have, then its contact page.
      let email = bestEmail(emailsIn(page.markdown), domain);
      if (!email) {
        const origin = new URL(page.url).origin;
        for (const path of ["/contact", "/contact-us", "/contacts"]) {
          const contact = await readPage(firecrawl, `${origin}${path}`);
          email = contact ? bestEmail(emailsIn(contact.markdown), domain) : "";
          if (email) break;
        }
      }
      operators.push({
        destinationSlug: slug,
        domain,
        name: item.name,
        country: item.country,
        regions: item.regions,
        website: new URL(page.url).origin,
        email,
        summary: item.summary,
        services: item.services,
        operations: item.operations,
        travelerTypes: item.travelerTypes,
        hotelTypes: item.hotelTypes,
        languages: item.languages,
        minGroupSize: item.minGroupSize,
        maxGroupSize: item.maxGroupSize,
        sourceUrl: page.url,
        foundAt: Date.now(),
      });
    }
    if (!operators.length) throw new ConvexError(`The pages found for ${place} were not operators' own sites. Try again later.`);
    return operators;
}

// Ops only, from the CLI: fill the shared cache for a place before a demo, so
// the first advisor to choose it gets real operators instantly.
//   npx convex run --prod webOperators:prewarm '{"destinationSlug":"bali","destinationName":"Bali"}'
export const prewarm = internalAction({
  args: { destinationSlug: v.string(), destinationName: v.string() },
  returns: v.object({ found: v.number(), withEmail: v.number() }),
  handler: async (ctx, args): Promise<{ found: number; withEmail: number }> => {
    const cached: WebOperator[] = await ctx.runQuery(internal.webOperators.forDestination, { destinationSlug: args.destinationSlug });
    const operators = await discover(args.destinationSlug, args.destinationName, ["wellness", "culture"], cached.map((item) => item.domain));
    await ctx.runMutation(internal.webOperators.store, { operators });
    const all = [...cached, ...operators];
    return { found: all.length, withEmail: all.filter((item) => item.email).length };
  },
});

export function operatorSchema(pageCount: number) {
  const list = (values: string[]) => ({ type: "array", items: { type: "string", enum: values } });
  return {
    type: "object",
    additionalProperties: false,
    required: ["pages"],
    properties: {
      pages: {
        type: "array",
        maxItems: pageCount,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["pageIndex", "isLocalOperator", "name", "country", "regions", "summary", "services", "operations", "travelerTypes", "hotelTypes", "languages", "minGroupSize", "maxGroupSize"],
          properties: {
            pageIndex: { type: "integer", enum: Array.from({ length: pageCount }, (_, index) => index) },
            isLocalOperator: { type: "boolean" },
            name: { type: "string" },
            country: { type: "string" },
            regions: { type: "array", maxItems: 6, items: { type: "string" } },
            summary: { type: "string" },
            services: list(EXPERIENCES),
            operations: list(OPERATIONS),
            travelerTypes: list(TRAVELER_TYPES),
            hotelTypes: list(HOTEL_TYPES),
            languages: { type: "array", maxItems: 6, items: { type: "string" } },
            minGroupSize: { type: "integer" },
            maxGroupSize: { type: "integer" },
          },
        },
      },
    },
  };
}

export function readOperators(raw: unknown, pages: WebPage[]) {
  const list = raw && typeof raw === "object" && "pages" in raw && Array.isArray((raw).pages)
    ? ((raw as { pages: unknown[] }).pages)
    : [];
  const strings = (value: unknown, allowed?: string[], max = 30) =>
    Array.isArray(value)
      ? [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, 80)))]
          .filter((item) => item && (!allowed || allowed.includes(item)))
          .slice(0, max)
      : [];
  const seen = new Set<number>();
  const out = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const pageIndex = typeof item.pageIndex === "number" ? item.pageIndex : -1;
    if (!pages[pageIndex] || seen.has(pageIndex) || item.isLocalOperator !== true) continue;
    const name = typeof item.name === "string" ? item.name.replace(/\s+/g, " ").trim().slice(0, 120) : "";
    if (name.length < 3) continue;
    seen.add(pageIndex);
    const min = typeof item.minGroupSize === "number" && item.minGroupSize > 0 ? Math.round(item.minGroupSize) : 2;
    const max = typeof item.maxGroupSize === "number" && item.maxGroupSize >= min ? Math.round(item.maxGroupSize) : 40;
    out.push({
      pageIndex,
      name,
      country: typeof item.country === "string" ? item.country.slice(0, 60) : "",
      regions: strings(item.regions, undefined, 6),
      summary: typeof item.summary === "string" ? item.summary.replace(/\s+/g, " ").trim().slice(0, 400) : "",
      services: strings(item.services, EXPERIENCES),
      operations: strings(item.operations, OPERATIONS),
      travelerTypes: strings(item.travelerTypes, TRAVELER_TYPES),
      hotelTypes: strings(item.hotelTypes, HOTEL_TYPES),
      languages: strings(item.languages, undefined, 6),
      minGroupSize: Math.min(min, 500),
      maxGroupSize: Math.min(max, 500),
    });
  }
  return out;
}

export const forDestination = internalQuery({
  args: { destinationSlug: v.string() },
  returns: v.array(webOperator),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("webOperators")
      .withIndex("by_destinationSlug", (q) => q.eq("destinationSlug", args.destinationSlug))
      .take(30);
    return rows.map(({ _id, _creationTime, ...rest }) => { void _id; void _creationTime; return rest; });
  },
});

export const store = internalMutation({
  args: { operators: v.array(webOperator) },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const operator of args.operators) {
      const existing = (await ctx.db
        .query("webOperators")
        .withIndex("by_destinationSlug", (q) => q.eq("destinationSlug", operator.destinationSlug))
        .take(30)).find((row) => row.domain === operator.domain);
      if (existing) await ctx.db.replace("webOperators", existing._id, operator);
      else await ctx.db.insert("webOperators", operator);
    }
    return null;
  },
});

// A found operator becomes a member of this workspace's network, with a capability
// record built only from what its own site says. Terms nobody published (lead
// times, deposits, net rates) are left at zero, meaning "not stated", and the
// matching treats them as unknown rather than as a poor fit.
export const importToWorkspace = internalMutation({
  args: { owner: v.string(), operators: v.array(webOperator) },
  returns: v.number(),
  handler: async (ctx, args) => {
    const mine = await ctx.db
      .query("operators")
      .withIndex("by_owner_and_slug", (q) => q.eq("owner", args.owner))
      .take(300);
    const byWebsite = new Map(mine.filter((row) => row.website).map((row) => [domainOf(row.website!), row]));
    const slugs = new Set(mine.map((row) => row.slug));
    let added = 0;
    const now = Date.now();
    for (const operator of args.operators) {
      const known = byWebsite.get(operator.domain);
      if (known) {
        if (!known.destinations.includes(operator.destinationSlug))
          await ctx.db.patch("operators", known._id, { destinations: [...known.destinations, operator.destinationSlug].slice(0, 12), updatedAt: now });
        continue;
      }
      let slug = `web-${operator.domain.replace(/[^a-z0-9]+/g, "-")}`.slice(0, 60);
      for (let n = 2; slugs.has(slug); n += 1) slug = `${slug.slice(0, 56)}-${n}`;
      slugs.add(slug);
      const levels = [
        ...(operator.hotelTypes.includes("3-star") ? [1] : []),
        ...(operator.hotelTypes.includes("4-star") || operator.hotelTypes.includes("boutique_hotels") ? [2] : []),
        ...(operator.hotelTypes.some((type) => ["5-star_luxury", "luxury", "private_villas"].includes(type)) ? [3] : []),
      ];
      await ctx.db.insert("operators", {
        owner: args.owner,
        slug,
        name: operator.name,
        country: operator.country,
        destinations: [operator.destinationSlug],
        specialties: operator.services.slice(0, 12),
        minGroupSize: operator.minGroupSize,
        maxGroupSize: operator.maxGroupSize,
        experienceLevels: levels.length ? levels : [2],
        typicalNetPriceMin: 0,
        typicalNetPriceMax: 0,
        approvalStatus: "found_on_web",
        ...(operator.email ? { contactEmail: operator.email } : {}),
        source: "researched",
        website: operator.website,
        updatedAt: now,
      });
      await ctx.db.insert("operatorCapability", {
        owner: args.owner,
        operatorSlug: slug,
        locations: [operator.destinationSlug],
        serviceAreas: [{
          destinationSlug: operator.destinationSlug,
          country: operator.country,
          regions: operator.regions,
          cities: [],
          areas: [],
          coverage: operator.regions.length > 2 ? "nationwide" : "regional",
          operatingMonths: [],
        }],
        minGroupSize: operator.minGroupSize,
        maxGroupSize: operator.maxGroupSize,
        idealGroupSize: Math.max(operator.minGroupSize, Math.min(operator.maxGroupSize, 16)),
        supportsFIT: operator.minGroupSize <= 2,
        groupTypes: ["private_groups"],
        travelerTypes: operator.travelerTypes,
        hotelTypes: operator.hotelTypes,
        services: operator.services,
        features: operator.operations.filter((item) => item.startsWith("strong_") || item === "low_physical_difficulty" || item === "few_hotel_changes" || item === "mostly_private_experiences"),
        operations: operator.operations,
        canBuildBespoke: true,
        customizationLevel: "high",
        quoteTurnaroundDays: 0,
        languages: operator.languages,
        commercial: { typicalNetMin: 0, typicalNetMax: 0, minimumTripValue: 0, typicalTripValue: 0, preferredGroupValue: 0, pricingModels: [], currency: "USD", pricingVariesByGroupSize: false },
        timing: { yearRound: true, operatingMonths: [], seasonalNotes: operator.summary, blackoutPeriods: [], shortestLeadTimeDays: 0, minimumLeadTimeDays: 0, idealLeadTimeDays: 0, averageProposalTurnaroundDays: 0, maximumProposalTurnaroundDays: 0, spaceHoldDays: 0, depositDueDaysBefore: 0, finalPaymentDaysBefore: 0, finalHeadcountDaysBefore: 0, travelerNamesDaysBefore: 0, latestGroupChangeDaysBefore: 0, roomReleaseDaysBefore: 0, cancellationDeadlines: [] },
        updatedAt: now,
      });
      added += 1;
    }
    return added;
  },
});
