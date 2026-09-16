import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { ConvexError, v, type Infer } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { operatorCapability, operatorRecord } from "./schema";
import { seedOperatorProfiles, seedOperators } from "./seedData";

// ---------------------------------------------------------------------------
// Bounds. Everything an operator types reaches the shared network record, so it
// is capped at the size of the vocabulary it is drawn from before it is written.
// ---------------------------------------------------------------------------
const LIMIT = 64;
const SHORT = 120;
const LONG = 2_000;

const text = (value: string, max = SHORT) =>
  value.replace(/\s+/g, " ").trim().slice(0, max);
const cleanList = (values: string[], max = LIMIT) =>
  [...new Set(values.map((item) => text(item)))].filter(Boolean).slice(0, max);
const days = (value: number) => Math.max(0, Math.min(3_650, Math.round(value)));
const money = (value: number) => Math.max(0, Math.min(10_000_000, value));
const months = (values: number[]) =>
  [...new Set(values.map((value) => Math.round(value)))]
    .filter((value) => value >= 1 && value <= 12)
    .slice(0, 12);
const isoDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";

export type CapabilityInput = Omit<
  Infer<typeof operatorCapability>,
  "operatorSlug" | "updatedAt"
>;

// The single normaliser for an operator-supplied capability record. The operator
// slug is deliberately not part of the input: it comes from the row the token
// belongs to, never from the browser.
export function cleanCapability(input: CapabilityInput): CapabilityInput {
  return {
    locations: cleanList(input.locations),
    serviceAreas: input.serviceAreas.slice(0, 12).map((area) => ({
      destinationSlug: text(area.destinationSlug),
      country: text(area.country),
      regions: cleanList(area.regions),
      cities: cleanList(area.cities),
      areas: cleanList(area.areas),
      coverage: area.coverage,
      operatingMonths: months(area.operatingMonths),
    })),
    minGroupSize: Math.max(1, Math.round(input.minGroupSize)),
    maxGroupSize: Math.max(1, Math.round(input.maxGroupSize)),
    idealGroupSize: Math.max(1, Math.round(input.idealGroupSize)),
    supportsFIT: input.supportsFIT,
    groupTypes: cleanList(input.groupTypes),
    travelerTypes: cleanList(input.travelerTypes),
    hotelTypes: cleanList(input.hotelTypes),
    services: cleanList(input.services),
    features: cleanList(input.features),
    operations: cleanList(input.operations),
    canBuildBespoke: input.canBuildBespoke,
    customizationLevel: input.customizationLevel,
    quoteTurnaroundDays: days(input.quoteTurnaroundDays),
    languages: cleanList(input.languages),
    commercial: {
      typicalNetMin: money(input.commercial.typicalNetMin),
      typicalNetMax: money(input.commercial.typicalNetMax),
      minimumTripValue: money(input.commercial.minimumTripValue),
      typicalTripValue: money(input.commercial.typicalTripValue),
      preferredGroupValue: money(input.commercial.preferredGroupValue),
      pricingModels: cleanList(input.commercial.pricingModels, 8),
      currency: text(input.commercial.currency, 8),
      pricingVariesByGroupSize: input.commercial.pricingVariesByGroupSize,
    },
    timing: {
      yearRound: input.timing.yearRound,
      operatingMonths: months(input.timing.operatingMonths),
      seasonalNotes: text(input.timing.seasonalNotes, LONG),
      blackoutPeriods: input.timing.blackoutPeriods.slice(0, 12).map((period) => ({
        start: isoDate(period.start),
        end: isoDate(period.end),
        label: text(period.label),
      })),
      shortestLeadTimeDays: days(input.timing.shortestLeadTimeDays),
      minimumLeadTimeDays: days(input.timing.minimumLeadTimeDays),
      idealLeadTimeDays: days(input.timing.idealLeadTimeDays),
      averageProposalTurnaroundDays: days(
        input.timing.averageProposalTurnaroundDays,
      ),
      maximumProposalTurnaroundDays: days(
        input.timing.maximumProposalTurnaroundDays,
      ),
      spaceHoldDays: days(input.timing.spaceHoldDays),
      depositDueDaysBefore: days(input.timing.depositDueDaysBefore),
      finalPaymentDaysBefore: days(input.timing.finalPaymentDaysBefore),
      finalHeadcountDaysBefore: days(input.timing.finalHeadcountDaysBefore),
      travelerNamesDaysBefore: days(input.timing.travelerNamesDaysBefore),
      latestGroupChangeDaysBefore: days(
        input.timing.latestGroupChangeDaysBefore,
      ),
      roomReleaseDaysBefore: days(input.timing.roomReleaseDaysBefore),
      cancellationDeadlines: input.timing.cancellationDeadlines
        .slice(0, 12)
        .map((deadline) => ({
          daysBefore: days(deadline.daysBefore),
          penalty: text(deadline.penalty, 40),
        })),
    },
  };
}

// A stored document minus its system fields, which is exactly what the shared
// validators describe and what a client is allowed to receive.
function plain(
  profile: Doc<"operatorCapability">,
): Infer<typeof operatorCapability> {
  const { _id, _creationTime, ...rest } = profile;
  void _id;
  void _creationTime;
  return rest;
}

async function operatorBySlug(ctx: MutationCtx, slug: string) {
  return await ctx.db
    .query("operators")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
}

// The advisor's matcher reads the whole network. It is small by design: an
// approved operator network is curated, not crawled.
export const list = query({
  args: {},
  returns: v.array(
    v.object({ operator: operatorRecord, capability: operatorCapability }),
  ),
  handler: async (ctx) => {
    const operators = await ctx.db.query("operators").take(200);
    const profiles = await ctx.db.query("operatorCapability").take(200);
    const bySlug = new Map(
      profiles.map((profile) => [profile.operatorSlug, profile]),
    );
    const rows: {
      operator: Infer<typeof operatorRecord>;
      capability: Infer<typeof operatorCapability>;
    }[] = [];
    for (const operator of operators) {
      const profile = bySlug.get(operator.slug);
      if (!profile) continue;
      const { _id, _creationTime, ...operatorRecordFields } = operator;
      void _id;
      void _creationTime;
      rows.push({ operator: operatorRecordFields, capability: plain(profile) });
    }
    return rows.sort((a, b) => a.operator.slug.localeCompare(b.operator.slug));
  },
});

// The operator's own view, read through its private response link. It returns
// that operator's capability and the request it was sent, and never another
// operator's record.
export const forToken = query({
  args: { token: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      briefOperatorId: v.id("briefOperators"),
      operatorSlug: v.string(),
      operatorName: v.string(),
      status: v.string(),
      capability: v.union(v.null(), operatorCapability),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("briefOperators")
      .withIndex("by_capabilityToken", (q) =>
        q.eq("capabilityToken", args.token),
      )
      .unique();
    if (!row) return null;
    const profile = await ctx.db
      .query("operatorCapability")
      .withIndex("by_operatorSlug", (q) => q.eq("operatorSlug", row.operatorSlug))
      .unique();
    return {
      briefOperatorId: row._id,
      operatorSlug: row.operatorSlug,
      operatorName: row.operatorName,
      status: row.status,
      capability: profile ? plain(profile) : null,
    };
  },
});

// An operator maintains its own capability record through its response link.
// Saving it changes what the advisor's matcher sees on the very next match run.
export const saveCapability = mutation({
  args: {
    token: v.string(),
    capability: operatorCapability.omit("operatorSlug", "updatedAt"),
  },
  returns: v.object({ operatorSlug: v.string() }),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("briefOperators")
      .withIndex("by_capabilityToken", (q) =>
        q.eq("capabilityToken", args.token),
      )
      .unique();
    if (!row) throw new ConvexError("This link is no longer active.");
    const existing = await ctx.db
      .query("operatorCapability")
      .withIndex("by_operatorSlug", (q) => q.eq("operatorSlug", row.operatorSlug))
      .unique();
    const now = Date.now();
    const clean = cleanCapability(args.capability);
    if (existing)
      await ctx.db.patch("operatorCapability", existing._id, {
        ...clean,
        updatedAt: now,
      });
    else
      await ctx.db.insert("operatorCapability", {
        ...clean,
        operatorSlug: row.operatorSlug,
        updatedAt: now,
      });
    await ctx.db.patch("briefOperators", row._id, { updatedAt: now });
    return { operatorSlug: row.operatorSlug };
  },
});

// Seeding is idempotent and additive: an operator already in the network keeps
// whatever it has since written about itself.
export const seed = internalMutation({
  args: {},
  returns: v.object({ operators: v.number(), profiles: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    let operators = 0;
    let profiles = 0;
    for (const record of seedOperators) {
      if (await operatorBySlug(ctx, record.slug)) continue;
      await ctx.db.insert("operators", { ...record, updatedAt: now });
      operators += 1;
    }
    for (const profile of seedOperatorProfiles) {
      const existing = await ctx.db
        .query("operatorCapability")
        .withIndex("by_operatorSlug", (q) =>
          q.eq("operatorSlug", profile.operatorSlug),
        )
        .unique();
      if (existing) continue;
      await ctx.db.insert("operatorCapability", { ...profile, updatedAt: now });
      profiles += 1;
    }
    return { operators, profiles };
  },
});

// A researched website becomes an operator only when a human adds it. It starts
// with an empty capability record, and the advisor sends that operator the same
// intake the seeded network was built from.
export const addFromCandidate = mutation({
  args: {
    candidateId: v.id("candidates"),
    name: v.string(),
    destinationSlugs: v.array(v.string()),
    country: v.string(),
    minGroupSize: v.number(),
    maxGroupSize: v.number(),
  },
  returns: v.object({ slug: v.string() }),
  handler: async (ctx, args) => {
    const candidate = await ctx.db.get("candidates", args.candidateId);
    if (!candidate) throw new ConvexError("That result is no longer available.");
    if (candidate.addedOperatorSlug)
      return { slug: candidate.addedOperatorSlug };
    const name = text(args.name);
    if (name.length < 3) throw new ConvexError("Give the operator a name.");
    const destinations = cleanList(args.destinationSlugs, 12);
    const slug = await uniqueSlug(ctx, name);
    const now = Date.now();
    const min = Math.max(1, Math.round(args.minGroupSize));
    const max = Math.max(min, Math.round(args.maxGroupSize));
    await ctx.db.insert("operators", {
      slug,
      name,
      country: text(args.country),
      destinations,
      specialties: [],
      minGroupSize: min,
      maxGroupSize: max,
      experienceLevels: [1, 2, 3],
      typicalNetPriceMin: 0,
      typicalNetPriceMax: 0,
      approvalStatus: "capability_intake_pending",
      source: "researched",
      website: candidate.url.slice(0, 500),
      updatedAt: now,
    });
    // An empty capability record is what "we know this exists and nothing else"
    // looks like. It matches nothing until the operator fills it in.
    await ctx.db.insert("operatorCapability", {
      operatorSlug: slug,
      locations: destinations,
      serviceAreas: destinations.map((destinationSlug) => ({
        destinationSlug,
        country: text(args.country),
        regions: [],
        cities: [],
        areas: [],
        coverage: "regional" as const,
        operatingMonths: [],
      })),
      minGroupSize: min,
      maxGroupSize: max,
      idealGroupSize: Math.round((min + max) / 2),
      supportsFIT: false,
      groupTypes: [],
      travelerTypes: [],
      hotelTypes: [],
      services: [],
      features: [],
      operations: [],
      canBuildBespoke: false,
      customizationLevel: "limited" as const,
      quoteTurnaroundDays: 0,
      languages: [],
      commercial: {
        typicalNetMin: 0,
        typicalNetMax: 0,
        minimumTripValue: 0,
        typicalTripValue: 0,
        preferredGroupValue: 0,
        pricingModels: [],
        currency: "USD",
        pricingVariesByGroupSize: false,
      },
      timing: {
        yearRound: false,
        operatingMonths: [],
        seasonalNotes: "",
        blackoutPeriods: [],
        shortestLeadTimeDays: 0,
        minimumLeadTimeDays: 0,
        idealLeadTimeDays: 0,
        averageProposalTurnaroundDays: 0,
        maximumProposalTurnaroundDays: 0,
        spaceHoldDays: 0,
        depositDueDaysBefore: 0,
        finalPaymentDaysBefore: 0,
        finalHeadcountDaysBefore: 0,
        travelerNamesDaysBefore: 0,
        latestGroupChangeDaysBefore: 0,
        roomReleaseDaysBefore: 0,
        cancellationDeadlines: [],
      },
      updatedAt: now,
    });
    await ctx.db.patch("candidates", candidate._id, { addedOperatorSlug: slug });
    return { slug };
  },
});

async function uniqueSlug(ctx: MutationCtx, name: string) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "operator";
  for (let suffix = 1; suffix <= 50; suffix += 1) {
    const slug = suffix === 1 ? base : `${base}-${suffix}`;
    if (!(await operatorBySlug(ctx, slug))) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}
