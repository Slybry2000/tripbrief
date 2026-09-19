import { mutation, query } from "./_generated/server";
import { ConvexError, v, type Infer } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import schema, { briefFields, briefStatus, proposalRecord, requirementAnswer } from "./schema";
import type { Doc } from "./_generated/dataModel";

export const MAX_SHORTLIST = 5;
const TOKEN = /^[A-Za-z0-9_-]{40,80}$/;

// Convex object validators are strict, so a returned brief is picked field by
// field rather than spread. It also means a column added to the table later can
// never start leaking through an existing read by accident.
function pickBrief(brief: Doc<"briefs">): Infer<typeof briefFields> {
  return {
    name: brief.name,
    evaluationDate: brief.evaluationDate,
    travelMonth: brief.travelMonth,
    travelerCount: brief.travelerCount,
    minimumViableTravelers: brief.minimumViableTravelers,
    confirmedTravelers: brief.confirmedTravelers,
    nights: brief.nights,
    earliestDepartureDate: brief.earliestDepartureDate,
    preferredDepartureDate: brief.preferredDepartureDate,
    latestDepartureDate: brief.latestDepartureDate,
    flexibleDates: brief.flexibleDates,
    proposalDecisionDate: brief.proposalDecisionDate,
    targetRetailPricePerPerson: brief.targetRetailPricePerPerson,
    flightsIncluded: brief.flightsIncluded,
    experienceLevel: brief.experienceLevel,
    pace: brief.pace,
    climates: brief.climates,
    desiredExperiences: brief.desiredExperiences,
    importantRequirements: brief.importantRequirements,
    travelerTypes: brief.travelerTypes,
    transportationNeeds: brief.transportationNeeds,
    accessibilityNeeds: brief.accessibilityNeeds,
    notes: brief.notes,
    groupDescription: brief.groupDescription ?? "",
    ages: brief.ages ?? "",
    rooms: brief.rooms ?? "",
    dietaryAndMedical: brief.dietaryAndMedical ?? "",
    dateFirmness: brief.dateFirmness ?? "",
    budgetBasis: brief.budgetBasis ?? "",
    guestOrigin: brief.guestOrigin ?? "",
    dayShape: brief.dayShape ?? "",
    inclusionsExpected: brief.inclusionsExpected ?? [],
    hardNos: brief.hardNos ?? [],
  };
}

async function requireOwner(
  ctx: Parameters<typeof getAuthUserId>[0],
): Promise<string> {
  const owner = await getAuthUserId(ctx);
  if (!owner) throw new ConvexError("Please sign in to use your workspace.");
  return owner;
}

// Every field is bounded here rather than by the schema, so one long paste in one
// box can never fail an otherwise valid save.
function cleanBrief(brief: Infer<typeof briefFields>) {
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, Math.round(value || 0)));
  const iso = (value: string) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "");
  const shortList = (values: string[], max: number) =>
    [...new Set(values.map((item) => item.slice(0, 80)))].slice(0, max);
  return {
    name: brief.name.replace(/\s+/g, " ").trim().slice(0, 160) || "Untitled brief",
    evaluationDate: iso(brief.evaluationDate),
    travelMonth: brief.travelMonth.slice(0, 60),
    travelerCount: clamp(brief.travelerCount, 0, 500),
    minimumViableTravelers: clamp(brief.minimumViableTravelers, 0, 500),
    confirmedTravelers: clamp(brief.confirmedTravelers, 0, 500),
    nights: clamp(brief.nights, 0, 120),
    earliestDepartureDate: iso(brief.earliestDepartureDate),
    preferredDepartureDate: iso(brief.preferredDepartureDate),
    latestDepartureDate: iso(brief.latestDepartureDate),
    flexibleDates: brief.flexibleDates,
    proposalDecisionDate: iso(brief.proposalDecisionDate),
    targetRetailPricePerPerson: Math.max(
      0,
      Math.min(1_000_000, Math.round(brief.targetRetailPricePerPerson || 0)),
    ),
    flightsIncluded: brief.flightsIncluded,
    experienceLevel: clamp(brief.experienceLevel, 1, 3),
    pace: brief.pace.slice(0, 40),
    climates: shortList(brief.climates, 12),
    desiredExperiences: shortList(brief.desiredExperiences, 40),
    importantRequirements: shortList(brief.importantRequirements, 20),
    travelerTypes: shortList(brief.travelerTypes, 20),
    transportationNeeds: shortList(brief.transportationNeeds, 30),
    accessibilityNeeds: shortList(brief.accessibilityNeeds, 20),
    notes: brief.notes.slice(0, 4_000),
    groupDescription: (brief.groupDescription ?? "").slice(0, 2_000),
    ages: (brief.ages ?? "").slice(0, 200),
    rooms: (brief.rooms ?? "").slice(0, 600),
    dietaryAndMedical: (brief.dietaryAndMedical ?? "").slice(0, 2_000),
    dateFirmness: (brief.dateFirmness ?? "").slice(0, 200),
    budgetBasis: (brief.budgetBasis ?? "").slice(0, 200),
    guestOrigin: (brief.guestOrigin ?? "").slice(0, 600),
    dayShape: (brief.dayShape ?? "").slice(0, 2_000),
    inclusionsExpected: shortList(brief.inclusionsExpected ?? [], 30),
    hardNos: shortList(brief.hardNos ?? [], 20),
  };
}

const shortlistStatus = v.union(
  v.literal("open"),
  v.literal("sent"),
  v.literal("submitted"),
  v.literal("declined"),
);

export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("briefs"),
      name: v.string(),
      status: briefStatus,
      travelerCount: v.number(),
      nights: v.number(),
      preferredDepartureDate: v.string(),
      selectedDestinations: v.array(v.string()),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const owner = await getAuthUserId(ctx);
    if (!owner) return [];
    const briefs = await ctx.db
      .query("briefs")
      .withIndex("by_owner", (q) => q.eq("owner", owner))
      .order("desc")
      .take(50);
    return briefs.map((brief) => ({
      _id: brief._id,
      name: brief.name,
      status: brief.status,
      travelerCount: brief.travelerCount,
      nights: brief.nights,
      preferredDepartureDate: brief.preferredDepartureDate,
      selectedDestinations: brief.selectedDestinationSlugs,
      updatedAt: brief.updatedAt,
    }));
  },
});

// Everything one brief's workflow needs in one reactive read: the brief, the
// operators it was sent to, and every proposal that has come back. A second tab
// sees a submitted proposal without a refresh.
export const get = query({
  args: { briefId: v.id("briefs") },
  returns: v.union(
    v.null(),
    v.object({
      brief: v.object({
        _id: v.id("briefs"),
        ...briefFields.fields,
        status: briefStatus,
        selectedDestinationSlugs: v.array(v.string()),
        selectedProposalId: v.union(v.null(), v.id("proposals")),
        updatedAt: v.number(),
      }),
      shortlist: v.array(
        v.object({
          _id: v.id("briefOperators"),
          operatorSlug: v.string(),
          operatorName: v.string(),
          // The advisor owns this row, and the token is the link they hand to
          // that operator, so it is theirs to read back.
          capabilityToken: v.string(),
          status: shortlistStatus,
          email: v.optional(v.string()),
          sentAt: v.optional(v.number()),
          sendError: v.optional(v.string()),
          proposalId: v.optional(v.id("proposals")),
          deliveredTo: v.optional(v.string()),
        }),
      ),
      proposals: v.array(
        v.object({
          _id: v.id("proposals"),
          operatorSlug: v.string(),
          programName: v.string(),
          destinationSlug: v.string(),
          startDate: v.string(),
          endDate: v.string(),
          nights: v.number(),
          availability: v.string(),
          finalFit: v.number(),
          netPricePerPerson: v.number(),
          currency: v.string(),
          basedOnExistingProgram: v.boolean(),
          submittedVia: v.string(),
          submittedAt: v.number(),
          hotelLevel: v.string(),
          hotelNotes: v.string(),
          transportation: v.array(v.string()),
          experiencesIncluded: v.array(v.string()),
          requirementsMet: v.array(v.string()),
          changesOrAdditions: v.array(v.string()),
          cannotProvide: v.array(v.string()),
          pricingAssumptions: v.string(),
          depositPercent: v.number(),
          depositDueDaysBefore: v.number(),
          finalHeadcountDaysBefore: v.number(),
          finalPaymentDaysBefore: v.number(),
          travelerNamesDaysBefore: v.number(),
          roomReleaseDaysBefore: v.number(),
          cancellationTerms: v.array(
            v.object({ daysBefore: v.number(), penalty: v.string() }),
          ),
          operatorNotes: v.string(),
          requirementAnswers: v.array(requirementAnswer),
          simulated: v.boolean(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const owner = await getAuthUserId(ctx);
    if (!owner) return null;
    const brief = await ctx.db.get("briefs", args.briefId);
    if (!brief || brief.owner !== owner) return null;
    const shortlist = await ctx.db
      .query("briefOperators")
      .withIndex("by_briefId", (q) => q.eq("briefId", brief._id))
      .take(20);
    const proposals = await ctx.db
      .query("proposals")
      .withIndex("by_briefId", (q) => q.eq("briefId", brief._id))
      .take(20);
    return {
      brief: {
        _id: brief._id,
        ...pickBrief(brief),
        status: brief.status,
        selectedDestinationSlugs: brief.selectedDestinationSlugs,
        selectedProposalId: brief.selectedProposalId ?? null,
        updatedAt: brief.updatedAt,
      },
      shortlist: shortlist.map((row) => ({
        _id: row._id,
        operatorSlug: row.operatorSlug,
        operatorName: row.operatorName,
        capabilityToken: row.capabilityToken,
        status: row.status,
        email: row.email,
        sentAt: row.sentAt,
        sendError: row.sendError,
        proposalId: row.proposalId,
        deliveredTo: row.deliveredTo,
      })),
      proposals: proposals.map((proposal) => ({
        _id: proposal._id,
        operatorSlug: proposal.operatorSlug,
        programName: proposal.programName,
        destinationSlug: proposal.destinationSlug,
        startDate: proposal.startDate,
        endDate: proposal.endDate,
        nights: proposal.nights,
        availability: proposal.availability,
        finalFit: proposal.finalFit,
        netPricePerPerson: proposal.netPricePerPerson,
        currency: proposal.currency,
        basedOnExistingProgram: proposal.basedOnExistingProgram,
        submittedVia: proposal.submittedVia,
        submittedAt: proposal.submittedAt,
        hotelLevel: proposal.hotelLevel,
        hotelNotes: proposal.hotelNotes,
        transportation: proposal.transportation,
        experiencesIncluded: proposal.experiencesIncluded,
        requirementsMet: proposal.requirementsMet,
        changesOrAdditions: proposal.changesOrAdditions,
        cannotProvide: proposal.cannotProvide,
        pricingAssumptions: proposal.pricingAssumptions,
        depositPercent: proposal.depositPercent,
        depositDueDaysBefore: proposal.depositDueDaysBefore,
        finalHeadcountDaysBefore: proposal.finalHeadcountDaysBefore,
        finalPaymentDaysBefore: proposal.finalPaymentDaysBefore,
        travelerNamesDaysBefore: proposal.travelerNamesDaysBefore,
        roomReleaseDaysBefore: proposal.roomReleaseDaysBefore,
        cancellationTerms: proposal.cancellationTerms,
        operatorNotes: proposal.operatorNotes,
        requirementAnswers: proposal.requirementAnswers ?? [],
        simulated: proposal.simulated === true,
      })),
    };
  },
});

export const proposalDetail = query({
  args: { proposalId: v.id("proposals") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("proposals"),
      briefId: v.id("briefs"),
      operatorSlug: v.string(),
      ...proposalRecord.fields,
      submittedVia: v.string(),
      submittedAt: v.number(),
      sourceText: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const owner = await getAuthUserId(ctx);
    if (!owner) return null;
    const proposal = await ctx.db.get("proposals", args.proposalId);
    if (!proposal || proposal.owner !== owner) return null;
    // announcedAt is bookkeeping the return validator does not carry; leaving it in
    // would fail the read the moment an arrival had been announced.
    const { _creationTime, owner: _owner, standardisedAt, standardisedBy, announcedAt, ...rest } =
      proposal;
    void _creationTime;
    void _owner;
    void standardisedAt;
    void standardisedBy;
    void announcedAt;
    return rest;
  },
});

// The brief's own fields, for the AI drafting action. It is a query rather than
// an internal function so the action inherits the caller's identity: a draft can
// only ever be produced for a brief the signed-in advisor owns.
// The whole brief document, for server-side callers that act on the advisor's
// behalf (provisioning its inbox, sending a request). Owner-scoped like every
// other read of a brief.
export const one = query({
  args: { briefId: v.id("briefs") },
  returns: v.union(v.null(), schema.doc("briefs")),
  handler: async (ctx, args) => {
    const owner = await getAuthUserId(ctx);
    if (!owner) return null;
    const brief = await ctx.db.get("briefs", args.briefId);
    if (!brief || brief.owner !== owner) return null;
    return brief;
  },
});

// The brief's own fields, for the AI drafting action. It is a query rather than
// an internal function so the action inherits the caller's identity: a draft can
// only ever be produced for a brief the signed-in advisor owns.
export const draftSource = query({
  args: { briefId: v.id("briefs") },
  returns: v.union(v.null(), briefFields),
  handler: async (ctx, args) => {
    const owner = await getAuthUserId(ctx);
    if (!owner) return null;
    const brief = await ctx.db.get("briefs", args.briefId);
    if (!brief || brief.owner !== owner) return null;
    return pickBrief(brief);
  },
});

export const create = mutation({
  args: { brief: briefFields, selectedDestinationSlugs: v.array(v.string()) },
  returns: v.object({ briefId: v.id("briefs") }),
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);
    const now = Date.now();
    const briefId = await ctx.db.insert("briefs", {
      owner,
      ...cleanBrief(args.brief),
      status: "draft",
      selectedDestinationSlugs: args.selectedDestinationSlugs.slice(0, 12),
      updatedAt: now,
    });
    return { briefId };
  },
});

// The advisor edits the brief as they work. Saving never changes who it was sent
// to, and it never reopens a decision that is already recorded.
export const save = mutation({
  args: { briefId: v.id("briefs"), brief: briefFields },
  returns: v.null(),
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);
    const brief = await ctx.db.get("briefs", args.briefId);
    if (!brief || brief.owner !== owner) throw new ConvexError("Brief not found.");
    if (brief.status === "selected")
      throw new ConvexError(
        "An operator has already been selected. Start a new brief instead.",
      );
    await ctx.db.patch("briefs", brief._id, {
      ...cleanBrief(args.brief),
      updatedAt: Date.now(),
    });
    return null;
  },
});

// Choosing the customer-approved locations empties everything downstream of it:
// a shortlist built for other locations is no longer a shortlist.
export const setDestinations = mutation({
  args: { briefId: v.id("briefs"), destinationSlugs: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);
    const brief = await ctx.db.get("briefs", args.briefId);
    if (!brief || brief.owner !== owner) throw new ConvexError("Brief not found.");
    if (brief.status === "selected")
      throw new ConvexError(
        "This brief's decision is already recorded, so its locations cannot change.",
      );
    const destinations = [...new Set(args.destinationSlugs)].slice(0, 12);
    const changed =
      destinations.length !== brief.selectedDestinationSlugs.length ||
      destinations.some(
        (slug) => !brief.selectedDestinationSlugs.includes(slug),
      );
    if (changed) {
      const rows = await ctx.db
        .query("briefOperators")
        .withIndex("by_briefId", (q) => q.eq("briefId", brief._id))
        .take(20);
      for (const row of rows) {
        if (row.status === "submitted")
          throw new ConvexError(
            `${row.operatorName} has already answered this brief. Start a new brief to change its locations.`,
          );
      }
      for (const row of rows) await ctx.db.delete("briefOperators", row._id);
    }
    await ctx.db.patch("briefs", brief._id, {
      selectedDestinationSlugs: destinations,
      status: "draft",
      updatedAt: Date.now(),
    });
    return null;
  },
});

// Shortlisting an operator is what creates its private response link. The token
// is generated in the advisor's browser, so the server never has to mint or
// guess one, and it never travels anywhere except inside that operator's link.
export const setShortlist = mutation({
  args: {
    briefId: v.id("briefs"),
    operators: v.array(
      v.object({
        operatorSlug: v.string(),
        operatorName: v.string(),
        capabilityToken: v.string(),
        // Position in the capability ranking, 1 being the strongest match.
        rank: v.optional(v.number()),
      }),
    ),
  },
  returns: v.object({ shortlisted: v.number() }),
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);
    const brief = await ctx.db.get("briefs", args.briefId);
    if (!brief || brief.owner !== owner) throw new ConvexError("Brief not found.");
    if (brief.status === "selected")
      throw new ConvexError("This brief's decision is already recorded.");
    if (args.operators.length > MAX_SHORTLIST)
      throw new ConvexError(`Select up to ${MAX_SHORTLIST} operators.`);
    const rows = await ctx.db
      .query("briefOperators")
      .withIndex("by_briefId", (q) => q.eq("briefId", brief._id))
      .take(20);
    const bySlug = new Map(rows.map((row) => [row.operatorSlug, row]));
    const keep = new Set<string>();
    const now = Date.now();
    for (const operator of args.operators) {
      if (!TOKEN.test(operator.capabilityToken))
        throw new ConvexError("That response link is malformed.");
      keep.add(operator.operatorSlug);
      const existing = bySlug.get(operator.operatorSlug);
      // A token is a capability: it has to identify exactly one row, or a link
      // could resolve to someone else's request. Tokens are 32 random bytes, so a
      // clash means a retry, not a decision to make here.
      const clash = await ctx.db
        .query("briefOperators")
        .withIndex("by_capabilityToken", (q) =>
          q.eq("capabilityToken", operator.capabilityToken),
        )
        .unique();
      if (clash && clash._id !== existing?._id)
        throw new ConvexError(
          "That response link is already in use. Please try again.",
        );
      if (!existing) {
        await ctx.db.insert("briefOperators", {
          briefId: brief._id,
          owner,
          operatorSlug: operator.operatorSlug,
          operatorName: operator.operatorName.slice(0, 160),
          capabilityToken: operator.capabilityToken,
          status: "open",
          ...(operator.rank !== undefined ? { rank: Math.max(1, Math.round(operator.rank)) } : {}),
          createdAt: now,
          updatedAt: now,
        });
        continue;
      }
      // An operator that has already answered keeps its row — and its answer.
      await ctx.db.patch("briefOperators", existing._id, {
        ...(operator.rank !== undefined ? { rank: Math.max(1, Math.round(operator.rank)) } : {}),
        operatorName: operator.operatorName.slice(0, 160),
        updatedAt: now,
      });
    }
    for (const row of rows) {
      if (keep.has(row.operatorSlug)) continue;
      if (row.status === "submitted")
        throw new ConvexError(
          `${row.operatorName} has already submitted a proposal.`,
        );
      await ctx.db.delete("briefOperators", row._id);
    }
    await ctx.db.patch("briefs", brief._id, { updatedAt: now });
    return { shortlisted: args.operators.length };
  },
});

export const recordDecision = mutation({
  args: {
    briefId: v.id("briefs"),
    proposalId: v.id("proposals"),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);
    const brief = await ctx.db.get("briefs", args.briefId);
    if (!brief || brief.owner !== owner) throw new ConvexError("Brief not found.");
    const proposal = await ctx.db.get("proposals", args.proposalId);
    if (!proposal || proposal.briefId !== brief._id)
      throw new ConvexError("That proposal does not belong to this brief.");
    await ctx.db.patch("briefs", brief._id, {
      selectedProposalId: proposal._id,
      status: "selected",
      selectionReason: args.reason?.slice(0, 2_000),
      updatedAt: Date.now(),
    });
    return null;
  },
});

// Deleting a brief removes everything it produced rather than orphaning it: its
// proposals, its operators and their response links, and the mail it received.
export const remove = mutation({
  args: { briefId: v.id("briefs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);
    const brief = await ctx.db.get("briefs", args.briefId);
    if (!brief || brief.owner !== owner) throw new ConvexError("Brief not found.");
    const proposals = await ctx.db
      .query("proposals")
      .withIndex("by_briefId", (q) => q.eq("briefId", brief._id))
      .take(50);
    for (const proposal of proposals)
      await ctx.db.delete("proposals", proposal._id);
    const rows = await ctx.db
      .query("briefOperators")
      .withIndex("by_briefId", (q) => q.eq("briefId", brief._id))
      .take(50);
    for (const row of rows) await ctx.db.delete("briefOperators", row._id);
    const messages = await ctx.db
      .query("inboxMessages")
      .withIndex("by_briefId", (q) => q.eq("briefId", brief._id))
      .take(200);
    for (const message of messages)
      await ctx.db.delete("inboxMessages", message._id);
    await ctx.db.delete("briefs", brief._id);
    return null;
  },
});

// The operator's view of the brief it was asked to price. It is a projection,
// not the stored document: an operator sees what it needs to quote.
export const forOperatorToken = query({
  args: { token: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      briefId: v.id("briefs"),
      name: v.string(),
      travelMonth: v.string(),
      travelerCount: v.number(),
      minimumViableTravelers: v.number(),
      nights: v.number(),
      earliestDepartureDate: v.string(),
      preferredDepartureDate: v.string(),
      latestDepartureDate: v.string(),
      flexibleDates: v.boolean(),
      proposalDecisionDate: v.string(),
      // The net the agency wants quoted. The client's own price, and so the
      // agency's margin, never reaches the operator.
      targetNetPerPerson: v.number(),
      experienceLevel: v.number(),
      pace: v.string(),
      desiredExperiences: v.array(v.string()),
      importantRequirements: v.array(v.string()),
      transportationNeeds: v.array(v.string()),
      accessibilityNeeds: v.array(v.string()),
      notes: v.string(),
      // The customer-approved places, so the operator proposes one of them rather
      // than whichever place a form defaulted to.
      approvedDestinations: v.array(
        v.object({ slug: v.string(), name: v.string() }),
      ),
      // Both shape the numbered requirements, so the operator's R1..Rn line up
      // with the agency's.
      climates: v.array(v.string()),
      travelerTypes: v.array(v.string()),
      groupDescription: v.string(),
      ages: v.string(),
      rooms: v.string(),
      dietaryAndMedical: v.string(),
      dateFirmness: v.string(),
      budgetBasis: v.string(),
      guestOrigin: v.string(),
      dayShape: v.string(),
      inclusionsExpected: v.array(v.string()),
      hardNos: v.array(v.string()),
      status: briefStatus,
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
    const brief = await ctx.db.get("briefs", row.briefId);
    if (!brief) return null;
    // A place the advisor added has its name stored; a catalog place is named by
    // the interface, so an empty name here means "use the catalog's".
    const approvedDestinations = [];
    for (const slug of brief.selectedDestinationSlugs.slice(0, 12)) {
      const added = await ctx.db
        .query("destinations")
        .withIndex("by_owner_and_slug", (q) =>
          q.eq("owner", brief.owner).eq("slug", slug),
        )
        .first();
      approvedDestinations.push({ slug, name: added?.name ?? "" });
    }
    return {
      briefId: brief._id,
      name: brief.name,
      travelMonth: brief.travelMonth,
      travelerCount: brief.travelerCount,
      minimumViableTravelers: brief.minimumViableTravelers,
      nights: brief.nights,
      earliestDepartureDate: brief.earliestDepartureDate,
      preferredDepartureDate: brief.preferredDepartureDate,
      latestDepartureDate: brief.latestDepartureDate,
      flexibleDates: brief.flexibleDates,
      proposalDecisionDate: brief.proposalDecisionDate,
      targetNetPerPerson: Math.round(brief.targetRetailPricePerPerson * 0.75),
      experienceLevel: brief.experienceLevel,
      pace: brief.pace,
      desiredExperiences: brief.desiredExperiences,
      importantRequirements: brief.importantRequirements,
      transportationNeeds: brief.transportationNeeds,
      accessibilityNeeds: brief.accessibilityNeeds,
      notes: brief.notes,
      approvedDestinations,
      climates: brief.climates,
      travelerTypes: brief.travelerTypes,
      // Coerced rather than optional: a brief written before these existed still
      // has to render as a packet, and an empty answer is what the gap list reports.
      groupDescription: brief.groupDescription ?? "",
      ages: brief.ages ?? "",
      rooms: brief.rooms ?? "",
      dietaryAndMedical: brief.dietaryAndMedical ?? "",
      dateFirmness: brief.dateFirmness ?? "",
      budgetBasis: brief.budgetBasis ?? "",
      guestOrigin: brief.guestOrigin ?? "",
      dayShape: brief.dayShape ?? "",
      inclusionsExpected: brief.inclusionsExpected ?? [],
      hardNos: brief.hardNos ?? [],
      status: brief.status,
    };
  },
});
