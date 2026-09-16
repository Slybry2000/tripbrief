import {
  internalQuery,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { ConvexError, v, type Infer } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc } from "./_generated/dataModel";
import { operatorCapability, operatorRecord } from "./schema";
import { seedOperatorProfiles, seedOperators } from "./seedData";

// ---------------------------------------------------------------------------
// Bounds. Everything an operator types reaches the shared capability record, so
// it is capped at the size of the vocabulary it is drawn from before it is
// written.
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

// An address an operator can be reached at. Empty is allowed — an operator can sit
// in the network with only its own link — but a non-empty value has to be one we
// could actually send to.
export function cleanEmail(value: string | undefined) {
  const email = (value ?? "").trim().toLowerCase();
  if (!email) return "";
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new ConvexError("That does not look like an email address.");
  return email;
}

export type CapabilityInput = Omit<
  Infer<typeof operatorCapability>,
  "owner" | "operatorSlug" | "updatedAt"
>;

// The single normaliser for an operator-supplied capability record. The owner and
// the slug are deliberately absent: they come from the link the write arrived
// through, never from the browser.
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
      blackoutPeriods: input.timing.blackoutPeriods
        .slice(0, 12)
        .map((period) => ({
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

const TOKEN = /^[A-Za-z0-9_-]{40,80}$/;

async function requireUser(ctx: QueryCtx | MutationCtx) {
  const owner = await getAuthUserId(ctx);
  if (!owner) throw new ConvexError("Please sign in to use your workspace.");
  return owner;
}

async function operatorFor(ctx: QueryCtx | MutationCtx, owner: string, slug: string) {
  return await ctx.db
    .query("operators")
    .withIndex("by_owner_and_slug", (q) =>
      q.eq("owner", owner).eq("slug", slug),
    )
    .unique();
}

async function capabilityFor(
  ctx: QueryCtx | MutationCtx,
  owner: string,
  slug: string,
) {
  return await ctx.db
    .query("operatorCapability")
    .withIndex("by_owner_and_operatorSlug", (q) =>
      q.eq("owner", owner).eq("operatorSlug", slug),
    )
    .unique();
}

// Either half of the operator's side of the product resolves through one token:
// a standing capability link, or a request link that belongs to one brief.
type ResolvedLink = {
  kind: "capability" | "request";
  owner: string;
  operatorSlug: string;
  operatorName: string;
  briefOperatorId?: Doc<"briefOperators">["_id"];
};

async function resolve(ctx: QueryCtx, token: string): Promise<ResolvedLink | null> {
  const standing = await ctx.db
    .query("operatorLinks")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
  if (standing && !standing.revokedAt) {
    const operator = await operatorFor(ctx, standing.owner, standing.operatorSlug);
    if (!operator) return null;
    return {
      kind: "capability",
      owner: standing.owner,
      operatorSlug: standing.operatorSlug,
      operatorName: operator.name,
    };
  }
  const request = await ctx.db
    .query("briefOperators")
    .withIndex("by_capabilityToken", (q) => q.eq("capabilityToken", token))
    .unique();
  if (!request) return null;
  return {
    kind: "request",
    owner: request.owner,
    operatorSlug: request.operatorSlug,
    operatorName: request.operatorName,
    briefOperatorId: request._id,
  };
}

// ---------------------------------------------------------------------------
// The advisor's side
// ---------------------------------------------------------------------------

// A workspace's own network. It starts as the fictional studio network the app
// ships with, and every change after that belongs to that workspace alone.
export const list = query({
  args: {},
  returns: v.array(
    v.object({ operator: operatorRecord, capability: operatorCapability }),
  ),
  handler: async (ctx) => {
    const owner = await getAuthUserId(ctx);
    if (!owner) return [];
    const operators = await ctx.db
      .query("operators")
      .withIndex("by_owner_and_slug", (q) => q.eq("owner", owner))
      .take(200);
    const profiles = await ctx.db
      .query("operatorCapability")
      .withIndex("by_owner_and_operatorSlug", (q) => q.eq("owner", owner))
      .take(200);
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
      const { _id, _creationTime, ...operatorFields } = operator;
      void _id;
      void _creationTime;
      rows.push({ operator: operatorFields, capability: plain(profile) });
    }
    return rows.sort((a, b) => a.operator.name.localeCompare(b.operator.name));
  },
});

// The standing link an operator keeps: it is what lets an operator maintain its
// own capability record without waiting for a brief to be sent to it.
export const capabilityLink = query({
  args: { operatorSlug: v.string() },
  returns: v.union(
    v.null(),
    v.object({ token: v.string(), sentTo: v.optional(v.string()) }),
  ),
  handler: async (ctx, args) => {
    const owner = await getAuthUserId(ctx);
    if (!owner) return null;
    const link = await ctx.db
      .query("operatorLinks")
      .withIndex("by_owner_and_operatorSlug", (q) =>
        q.eq("owner", owner).eq("operatorSlug", args.operatorSlug),
      )
      .unique();
    if (!link || link.revokedAt) return null;
    return { token: link.token, sentTo: link.sentTo };
  },
});

// Every operator's standing link in one read, so the network page can show which
// operators can still be asked to update themselves.
export const capabilityLinks = query({
  args: {},
  returns: v.array(
    v.object({
      operatorSlug: v.string(),
      token: v.string(),
      sentTo: v.optional(v.string()),
      lastOpenedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx) => {
    const owner = await getAuthUserId(ctx);
    if (!owner) return [];
    const links = await ctx.db
      .query("operatorLinks")
      .withIndex("by_owner_and_operatorSlug", (q) => q.eq("owner", owner))
      .take(200);
    return links
      .filter((link) => !link.revokedAt)
      .map((link) => ({
        operatorSlug: link.operatorSlug,
        token: link.token,
        sentTo: link.sentTo,
        lastOpenedAt: link.lastOpenedAt,
      }));
  },
});

// The operator's own view, through either kind of link.
export const forToken = query({
  args: { token: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      kind: v.union(v.literal("capability"), v.literal("request")),
      operatorSlug: v.string(),
      operatorName: v.string(),
      capability: v.union(v.null(), operatorCapability),
    }),
  ),
  handler: async (ctx, args) => {
    if (!TOKEN.test(args.token)) return null;
    const link = await resolve(ctx, args.token);
    if (!link) return null;
    const profile = await capabilityFor(ctx, link.owner, link.operatorSlug);
    return {
      kind: link.kind,
      operatorSlug: link.operatorSlug,
      operatorName: link.operatorName,
      capability: profile ? plain(profile) : null,
    };
  },
});

// An operator maintains its own capability record. The owner and the slug come
// from the link, so one operator can never write another's record.
export const saveCapability = mutation({
  args: {
    token: v.string(),
    capability: operatorCapability.omit("owner", "operatorSlug", "updatedAt"),
  },
  returns: v.object({ operatorSlug: v.string() }),
  handler: async (ctx, args) => {
    if (!TOKEN.test(args.token))
      throw new ConvexError("This link is no longer active.");
    const link = await resolve(ctx, args.token);
    if (!link) throw new ConvexError("This link is no longer active.");
    const existing = await capabilityFor(ctx, link.owner, link.operatorSlug);
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
        owner: link.owner,
        operatorSlug: link.operatorSlug,
        updatedAt: now,
      });
    if (link.kind === "capability") {
      const standing = await ctx.db
        .query("operatorLinks")
        .withIndex("by_token", (q) => q.eq("token", args.token))
        .unique();
      if (standing) {
        // The record now exists, so the operator is no longer pending.
        await ctx.db.patch("operatorLinks", standing._id, {
          lastOpenedAt: standing.lastOpenedAt ?? now,
          updatedAt: now,
        });
        const operator = await operatorFor(ctx, link.owner, link.operatorSlug);
        if (operator && operator.approvalStatus === "capability_intake_pending")
          await ctx.db.patch("operators", operator._id, {
            approvalStatus: "capability_on_file",
            updatedAt: now,
          });
      }
    } else if (link.briefOperatorId) {
      await ctx.db.patch("briefOperators", link.briefOperatorId, {
        updatedAt: now,
      });
    }
    return { operatorSlug: link.operatorSlug };
  },
});

// Creating the standing link is one click on the network page, and it is
// idempotent: asking twice returns the same link rather than minting a second.
// The token is generated in the advisor's browser, so the server never has to
// mint or guess a secret, and it is checked for collisions on the way in.
export const createCapabilityLink = mutation({
  args: { operatorSlug: v.string(), token: v.string() },
  returns: v.object({ token: v.string() }),
  handler: async (ctx, args) => {
    const owner = await requireUser(ctx);
    if (!TOKEN.test(args.token))
      throw new ConvexError("That link could not be generated. Please retry.");
    const operator = await operatorFor(ctx, owner, args.operatorSlug);
    if (!operator) throw new ConvexError("Operator not found.");
    const existing = await ctx.db
      .query("operatorLinks")
      .withIndex("by_owner_and_operatorSlug", (q) =>
        q.eq("owner", owner).eq("operatorSlug", args.operatorSlug),
      )
      .unique();
    const now = Date.now();
    if (existing) {
      if (!existing.revokedAt) return { token: existing.token };
      throw new ConvexError(
        "That operator's link was revoked. Ask the operator for a current one.",
      );
    }
    const clash = await ctx.db
      .query("operatorLinks")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (clash) throw new ConvexError("That link could not be generated. Please retry.");
    await ctx.db.insert("operatorLinks", {
      owner,
      operatorSlug: args.operatorSlug,
      token: args.token,
      createdAt: now,
      updatedAt: now,
    });
    return { token: args.token };
  },
});

// Seeding is idempotent and additive: an operator already in a workspace keeps
// whatever it has since written about itself.
export const ensureWorkspace = mutation({
  args: {},
  returns: v.object({ added: v.number() }),
  handler: async (ctx) => {
    const owner = await requireUser(ctx);
    const existing = await ctx.db
      .query("operators")
      .withIndex("by_owner_and_slug", (q) => q.eq("owner", owner))
      .take(1);
    if (existing.length) return { added: 0 };
    await dropUnowned(ctx);
    const now = Date.now();
    for (const record of seedOperators) {
      await ctx.db.insert("operators", { ...record, owner, updatedAt: now });
    }
    for (const profile of seedOperatorProfiles) {
      await ctx.db.insert("operatorCapability", {
        ...profile,
        owner,
        updatedAt: now,
      });
    }
    return { added: seedOperators.length };
  },
});

// Seeding runs against a workspace on first sign-in. It is also available
// directly, so a fresh deployment can be set up from the CLI.
export const seed = internalMutation({
  args: { owner: v.string() },
  returns: v.object({ operators: v.number(), profiles: v.number() }),
  handler: async (ctx, args) => {
    const now = Date.now();
    let operators = 0;
    let profiles = 0;
    for (const record of seedOperators) {
      if (await operatorFor(ctx, args.owner, record.slug)) continue;
      await ctx.db.insert("operators", { ...record, owner: args.owner, updatedAt: now });
      operators += 1;
    }
    for (const profile of seedOperatorProfiles) {
      const existing = await capabilityFor(ctx, args.owner, profile.operatorSlug);
      if (existing) continue;
      await ctx.db.insert("operatorCapability", {
        ...profile,
        owner: args.owner,
        updatedAt: now,
      });
      profiles += 1;
    }
    return { operators, profiles };
  },
});

// Records written before the network became workspace-scoped have no owner, so
// they belong to nobody. They are removed rather than left to fail every read.
async function dropUnowned(ctx: MutationCtx) {
  const legacyOperators = await ctx.db.query("operators").take(200);
  for (const operator of legacyOperators)
    if (!operator.owner) await ctx.db.delete("operators", operator._id);
  const legacyProfiles = await ctx.db.query("operatorCapability").take(200);
  for (const profile of legacyProfiles)
    if (!profile.owner) await ctx.db.delete("operatorCapability", profile._id);
}

// A network grows two ways: an advisor types an operator in, or an advisor adds
// one that research found. Both start from nothing, and neither claims anything
// the operator has not confirmed.
export const addOperator = mutation({
  args: {
    name: v.string(),
    country: v.string(),
    destinationSlugs: v.array(v.string()),
    minGroupSize: v.number(),
    maxGroupSize: v.number(),
    contactEmail: v.optional(v.string()),
    website: v.optional(v.string()),
    candidateId: v.optional(v.id("candidates")),
  },
  returns: v.object({ slug: v.string(), created: v.boolean() }),
  handler: async (ctx, args) => {
    const owner = await requireUser(ctx);
    return await insertOperator(ctx, owner, args);
  },
});

type OperatorInput = {
  name: string;
  country: string;
  destinationSlugs: string[];
  minGroupSize: number;
  maxGroupSize: number;
  contactEmail?: string;
  website?: string;
  candidateId?: Doc<"candidates">["_id"];
};

// One creation path, used by the advisor's form and by the ops command below, so
// an operator created either way is identical.
async function insertOperator(
  ctx: MutationCtx,
  owner: string,
  args: OperatorInput,
) {
    const name = text(args.name);
    if (name.length < 3) throw new ConvexError("Give the operator a name.");
    const destinations = cleanList(args.destinationSlugs, 12);
    // Validated before anything is written, so a typo cannot reach a send.
    const contactEmail = cleanEmail(args.contactEmail);
    const slug = await uniqueSlug(ctx, owner, name);
    const now = Date.now();
    const min = Math.max(1, Math.round(args.minGroupSize));
    const max = Math.max(min, Math.round(args.maxGroupSize));
    let website = args.website?.slice(0, 500) ?? "";
    if (args.candidateId) {
      const candidate = await ctx.db.get("candidates", args.candidateId);
      if (!candidate || candidate.owner !== owner)
        throw new ConvexError("That result is no longer available.");
      if (candidate.addedOperatorSlug)
        return { slug: candidate.addedOperatorSlug, created: false };
      // The operator's record carries the page it was found on, so the evidence
      // for "this exists" stays with it.
      website = candidate.url.slice(0, 500);
    }
    await ctx.db.insert("operators", {
      owner,
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
      source: args.candidateId ? "researched" : "manual",
      ...(website ? { website } : {}),
      ...(contactEmail ? { contactEmail } : {}),
      updatedAt: now,
    });
    await ctx.db.insert("operatorCapability", {
      owner,
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
    if (args.candidateId)
      await ctx.db.patch("candidates", args.candidateId, {
        addedOperatorSlug: slug,
      });
    return { slug, created: true };
}

// Ops: which workspaces exist and how big each one's network and brief list is.
// Internal, so it is reachable from the CLI only, never from a browser.
export const workspaces = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      owner: v.string(),
      operators: v.number(),
      briefs: v.number(),
      lastUpdated: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const operators = await ctx.db.query("operators").take(1_000);
    const briefs = await ctx.db.query("briefs").take(1_000);
    const rows = new Map<
      string,
      { operators: number; briefs: number; lastUpdated: number }
    >();
    const bump = (owner: string, field: "operators" | "briefs", at: number) => {
      const row = rows.get(owner) ?? { operators: 0, briefs: 0, lastUpdated: 0 };
      row[field] += 1;
      row.lastUpdated = Math.max(row.lastUpdated, at);
      rows.set(owner, row);
    };
    for (const operator of operators)
      bump(operator.owner, "operators", operator.updatedAt);
    for (const brief of briefs) bump(brief.owner, "briefs", brief.updatedAt);
    return [...rows]
      .map(([owner, row]) => ({ owner, ...row }))
      .sort((a, b) => b.lastUpdated - a.lastUpdated);
  },
});

// Ops: onboard an operator into a named workspace from the CLI
//
//   npx convex run network:addOperatorForOwner '{"owner":"…","name":"…", …}'
//
// A roster that arrives by email should not have to be retyped one operator at a
// time through the browser. This is the same creation path the form uses, and it
// hands back the operator's own intake link so it can be sent straight away.
export const addOperatorForOwner = internalMutation({
  args: {
    owner: v.string(),
    name: v.string(),
    country: v.string(),
    destinationSlugs: v.array(v.string()),
    minGroupSize: v.number(),
    maxGroupSize: v.number(),
    contactEmail: v.optional(v.string()),
    website: v.optional(v.string()),
    // The link is a capability the caller mints, exactly as the browser does.
    capabilityToken: v.optional(v.string()),
  },
  returns: v.object({ slug: v.string(), capabilityToken: v.union(v.null(), v.string()) }),
  handler: async (ctx, args) => {
    const { owner, capabilityToken, ...input } = args;
    const result = await insertOperator(ctx, owner, input);
    if (!capabilityToken) return { slug: result.slug, capabilityToken: null };
    if (!TOKEN.test(capabilityToken))
      throw new ConvexError("That link could not be generated. Please retry.");
    const existing = await ctx.db
      .query("operatorLinks")
      .withIndex("by_owner_and_operatorSlug", (q) =>
        q.eq("owner", owner).eq("operatorSlug", result.slug),
      )
      .unique();
    const now = Date.now();
    if (existing) return { slug: result.slug, capabilityToken: existing.token };
    await ctx.db.insert("operatorLinks", {
      owner,
      operatorSlug: result.slug,
      token: capabilityToken,
      createdAt: now,
      updatedAt: now,
    });
    return { slug: result.slug, capabilityToken };
  },
});

// An operator leaves the network only when it has never quoted: once there is a
// proposal, the record is part of a decision and stays.
export const setContactEmail = mutation({
  args: { operatorSlug: v.string(), contactEmail: v.string() },
  returns: v.object({ contactEmail: v.string() }),
  handler: async (ctx, args) => {
    const owner = await requireUser(ctx);
    const operator = await operatorFor(ctx, owner, args.operatorSlug);
    if (!operator) throw new ConvexError("Operator not found.");
    const contactEmail = cleanEmail(args.contactEmail);
    await ctx.db.patch("operators", operator._id, {
      contactEmail,
      updatedAt: Date.now(),
    });
    return { contactEmail };
  },
});

export const removeOperator = mutation({
  args: { operatorSlug: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const owner = await requireUser(ctx);
    const operator = await operatorFor(ctx, owner, args.operatorSlug);
    if (!operator) throw new ConvexError("Operator not found.");
    const history = await ctx.db
      .query("briefOperators")
      .withIndex("by_operatorSlug", (q) =>
        q.eq("operatorSlug", args.operatorSlug),
      )
      .take(1);
    const mine = history.filter((row) => row.owner === owner);
    if (mine.some((row) => row.status === "submitted"))
      throw new ConvexError(
        "This operator has answered a brief, so its record stays in the network.",
      );
    const profile = await capabilityFor(ctx, owner, args.operatorSlug);
    if (profile) await ctx.db.delete("operatorCapability", profile._id);
    const links = await ctx.db
      .query("operatorLinks")
      .withIndex("by_owner_and_operatorSlug", (q) =>
        q.eq("owner", owner).eq("operatorSlug", args.operatorSlug),
      )
      .unique();
    if (links) await ctx.db.delete("operatorLinks", links._id);
    for (const row of mine) await ctx.db.delete("briefOperators", row._id);
    await ctx.db.delete("operators", operator._id);
    return null;
  },
});

async function uniqueSlug(ctx: MutationCtx, owner: string, name: string) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "operator";
  for (let suffix = 1; suffix <= 50; suffix += 1) {
    const slug = suffix === 1 ? base : `${base}-${suffix}`;
    if (!(await operatorFor(ctx, owner, slug))) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}
