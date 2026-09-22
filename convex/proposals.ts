import { action, env, mutation, query, type MutationCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { ConvexError, v, type Infer } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { briefFields, proposalRecord, requirementAnswer } from "./schema";
import { structuredResponse } from "./openai";

const MODEL = "gpt-4.1-mini";
const SHORT = 160;
const LONG = 4_000;

type ProposalInput = Infer<typeof proposalRecord>;
type BriefFields = Infer<typeof briefFields>;

const text = (value: string, max = SHORT) =>
  value.replace(/\s+/g, " ").trim().slice(0, max);
const lines = (values: string[], max = 30) =>
  [...new Set(values.map((item) => text(item, LONG)))]
    .filter(Boolean)
    .slice(0, max);
const days = (value: number) =>
  Math.max(0, Math.min(3_650, Math.round(value || 0)));
const money = (value: number) =>
  Math.max(0, Math.min(10_000_000, Math.round(value || 0)));
// A date must look right and also exist: "2027-13-01" matches the pattern.
const iso = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : "";
};

// Quotes are compared after normalising the things a model changes without
// changing a single word: runs of whitespace, and the curly punctuation that
// email clients and PDFs introduce. The point of the rule is that the operator
// really wrote it — not that they typed it with the same apostrophe.
export function normaliseQuote(value: string) {
  return value
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function quoteIsPresent(quote: string, source: string) {
  const needle = normaliseQuote(quote);
  return needle.length > 0 && normaliseQuote(source).includes(needle);
}

// Every number written in a piece of text, with thousands separators read as
// such: "2,380", "2.380" and "2 380" are all 2380, and "12.5" stays 12.5.
export function figuresIn(value: string): number[] {
  const joined = normaliseQuote(value).replace(/(\d)[,. ](?=\d{3}(?!\d))/g, "$1");
  return (joined.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

// A quote that is really in the reply can still sit beside a number the
// operator never wrote: "We can host 16 guests" does not support a price of
// 2,600. So a figure only counts as the operator's when it is inside the words
// quoted for it.
export function figureIsQuoted(figure: number, quote: string) {
  if (!figure) return true;
  return figuresIn(quote).some((found) => Math.abs(found - figure) < 0.5);
}

// The figures a sentence of the model's own asserts that its quote does not.
// Single digits are left alone, because "day 2" or "one of 3" is ordinal
// talk rather than a claim about a price, a group size or a deadline.
export function unquotedFigures(note: string, quote: string) {
  const quoted = figuresIn(quote);
  return figuresIn(note).filter(
    (figure) => figure >= 10 && !quoted.some((found) => Math.abs(found - figure) < 0.5),
  );
}

// Every field the operator or the advisor supplies is normalised here. Optional
// columns are always written with a neutral value rather than omitted, so a
// revision can clear an earlier claim without a partial-update ambiguity.
export function cleanProposal(proposal: ProposalInput): ProposalInput {
  return {
    programName: text(proposal.programName) || "Untitled program",
    basedOnExistingProgram: proposal.basedOnExistingProgram,
    basedOnProgramSlug: text(proposal.basedOnProgramSlug ?? "", 60),
    destinationSlug: text(proposal.destinationSlug, 60),
    startDate: iso(proposal.startDate),
    endDate: iso(proposal.endDate),
    nights: days(proposal.nights),
    availability: proposal.availability,
    groupSizeAccepted: days(proposal.groupSizeAccepted),
    hotelLevel: text(proposal.hotelLevel, 60),
    hotelNotes: text(proposal.hotelNotes, LONG),
    transportation: lines(proposal.transportation),
    experiencesIncluded: lines(proposal.experiencesIncluded),
    requirementsMet: lines(proposal.requirementsMet),
    changesOrAdditions: lines(proposal.changesOrAdditions),
    cannotProvide: lines(proposal.cannotProvide),
    finalFit: Math.max(0, Math.min(100, Math.round(proposal.finalFit || 0))),
    netPricePerPerson: money(proposal.netPricePerPerson),
    currency: text(proposal.currency, 8) || "USD",
    pricingAssumptions: text(proposal.pricingAssumptions, LONG),
    depositPercent: Math.max(
      0,
      Math.min(100, Math.round(proposal.depositPercent || 0)),
    ),
    depositDueDaysBefore: days(proposal.depositDueDaysBefore),
    finalHeadcountDaysBefore: days(proposal.finalHeadcountDaysBefore),
    finalPaymentDaysBefore: days(proposal.finalPaymentDaysBefore),
    travelerNamesDaysBefore: days(proposal.travelerNamesDaysBefore),
    roomReleaseDaysBefore: days(proposal.roomReleaseDaysBefore),
    cancellationTerms: proposal.cancellationTerms.slice(0, 12).map((term) => ({
      daysBefore: days(term.daysBefore),
      penalty: text(term.penalty, 40),
    })),
    operatorNotes: text(proposal.operatorNotes, LONG),
    requirementAnswers: cleanAnswers(proposal.requirementAnswers ?? []),
  };
}

type AnswerInput = NonNullable<ProposalInput["requirementAnswers"]>[number];

// One answer per requirement, the last one given winning. A brief has at most a
// few dozen requirements, so anything past that is noise, not an answer.
export function cleanAnswers(answers: AnswerInput[]): AnswerInput[] {
  const byKey = new Map<string, AnswerInput>();
  for (const item of answers) {
    const key = text(item.key, 40);
    if (!key) continue;
    const quote = item.quote ? text(item.quote, 600) : "";
    byKey.set(key, {
      key,
      answer: item.answer,
      note: text(item.note, 600),
      ...(quote ? { quote } : {}),
    });
  }
  return [...byKey.values()].slice(0, 40);
}

async function rowForToken(ctx: MutationCtx, token: string) {
  const row = await ctx.db
    .query("briefOperators")
    .withIndex("by_capabilityToken", (q) => q.eq("capabilityToken", token))
    .unique();
  if (!row) throw new ConvexError("This response link is no longer active.");
  return row;
}

// The operator's own proposal, read back through its link so a revision starts
// from what it already said rather than a blank form.
export const byOperatorToken = query({
  args: { token: v.string() },
  returns: v.union(v.null(), proposalRecord),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("briefOperators")
      .withIndex("by_capabilityToken", (q) =>
        q.eq("capabilityToken", args.token),
      )
      .unique();
    if (!row?.proposalId) return null;
    const proposal = await ctx.db.get("proposals", row.proposalId);
    if (!proposal) return null;
    // An explicit projection: bookkeeping the operator must not see (and that the
    // return validator does not know, such as when the arrival was announced)
    // never leaves the server.
    return projectProposal(proposal);
  },
});

export function projectProposal(proposal: ProposalInput): ProposalInput {
  return {
    programName: proposal.programName,
    basedOnExistingProgram: proposal.basedOnExistingProgram,
    ...(proposal.basedOnProgramSlug !== undefined
      ? { basedOnProgramSlug: proposal.basedOnProgramSlug }
      : {}),
    destinationSlug: proposal.destinationSlug,
    startDate: proposal.startDate,
    endDate: proposal.endDate,
    nights: proposal.nights,
    availability: proposal.availability,
    groupSizeAccepted: proposal.groupSizeAccepted,
    hotelLevel: proposal.hotelLevel,
    hotelNotes: proposal.hotelNotes,
    transportation: proposal.transportation,
    experiencesIncluded: proposal.experiencesIncluded,
    requirementsMet: proposal.requirementsMet,
    changesOrAdditions: proposal.changesOrAdditions,
    cannotProvide: proposal.cannotProvide,
    finalFit: proposal.finalFit,
    netPricePerPerson: proposal.netPricePerPerson,
    currency: proposal.currency,
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
  };
}

// The operator submits through its own link. A resubmission replaces its own
// earlier answer and can never touch another operator's.
export const submitByToken = mutation({
  args: { token: v.string(), proposal: proposalRecord },
  returns: v.object({ proposalId: v.id("proposals") }),
  handler: async (ctx, args) => {
    const row = await rowForToken(ctx, args.token);
    const brief = await ctx.db.get("briefs", row.briefId);
    if (!brief) throw new ConvexError("This request is no longer available.");
    const clean = cleanProposal(args.proposal);
    if (!clean.programName || !clean.startDate || clean.netPricePerPerson <= 0)
      throw new ConvexError(
        "A proposal needs a program name, a start date and a net price.",
      );
    const now = Date.now();
    const existing = await ctx.db
      .query("proposals")
      .withIndex("by_briefId_and_operatorSlug", (q) =>
        q.eq("briefId", brief._id).eq("operatorSlug", row.operatorSlug),
      )
      .unique();
    const fields = {
      ...clean,
      submittedVia: "portal" as const,
      submittedAt: now,
      standardisedAt: 0,
      standardisedBy: "",
      sourceText: "",
    };
    let proposalId;
    if (existing) {
      await ctx.db.patch("proposals", existing._id, fields);
      proposalId = existing._id;
    } else {
      proposalId = await ctx.db.insert("proposals", {
        briefId: brief._id,
        owner: row.owner,
        operatorSlug: row.operatorSlug,
        ...fields,
      });
    }
    await ctx.db.patch("briefOperators", row._id, {
      status: "submitted",
      proposalId,
      updatedAt: now,
    });
    // Tell the advisor, without waiting for them to be looking at the page.
    await ctx.scheduler.runAfter(0, internal.alerting.sweep, {
      owner: row.owner,
    });
    if (brief.status !== "selected")
      await ctx.db.patch("briefs", brief._id, {
        status: "comparing",
        updatedAt: now,
      });
    return { proposalId };
  },
});

// A proposal that arrived as an email is recorded by the advisor. The operator's
// own words are kept beside the structured version, so every comparison row can
// be traced back to what was actually written.
export const recordEmailed = mutation({
  args: {
    briefId: v.id("briefs"),
    operatorSlug: v.string(),
    proposal: proposalRecord,
    sourceText: v.string(),
    standardised: v.boolean(),
  },
  returns: v.object({ proposalId: v.id("proposals") }),
  handler: async (ctx, args) => {
    const owner = await getAuthUserId(ctx);
    if (!owner) throw new ConvexError("Please sign in.");
    const brief = await ctx.db.get("briefs", args.briefId);
    if (!brief || brief.owner !== owner) throw new ConvexError("Brief not found.");
    const shortlisted = await ctx.db
      .query("briefOperators")
      .withIndex("by_briefId", (q) => q.eq("briefId", brief._id))
      .take(20);
    const row = shortlisted.find(
      (item) => item.operatorSlug === args.operatorSlug,
    );
    if (!row)
      throw new ConvexError("That operator is not on this brief's shortlist.");
    const clean = cleanProposal(args.proposal);
    // Every later step is dated from the start date, so a proposal without one
    // cannot be compared or scheduled. Say so here rather than record a blank.
    if (!clean.startDate)
      throw new ConvexError(
        "Add the start date the operator proposed before recording this proposal.",
      );
    const now = Date.now();
    const existing = await ctx.db
      .query("proposals")
      .withIndex("by_briefId_and_operatorSlug", (q) =>
        q.eq("briefId", brief._id).eq("operatorSlug", args.operatorSlug),
      )
      .unique();
    const fields = {
      ...clean,
      submittedVia: "email_import" as const,
      submittedAt: now,
      standardisedAt: args.standardised ? now : 0,
      standardisedBy: args.standardised ? MODEL : "",
      sourceText: args.sourceText.trim().slice(0, 20_000),
    };
    let proposalId;
    if (existing) {
      await ctx.db.patch("proposals", existing._id, fields);
      proposalId = existing._id;
    } else {
      proposalId = await ctx.db.insert("proposals", {
        briefId: brief._id,
        owner,
        operatorSlug: args.operatorSlug,
        ...fields,
      });
    }
    await ctx.db.patch("briefOperators", row._id, {
      status: "submitted",
      proposalId,
      updatedAt: now,
    });
    if (brief.status !== "selected")
      await ctx.db.patch("briefs", brief._id, {
        status: "comparing",
        updatedAt: now,
      });
    return { proposalId };
  },
});

const draftFields = {
  programName: v.string(),
  destinationSlug: v.string(),
  startDate: v.string(),
  endDate: v.string(),
  nights: v.number(),
  availability: v.string(),
  groupSizeAccepted: v.number(),
  hotelLevel: v.string(),
  hotelNotes: v.string(),
  transportation: v.array(v.string()),
  experiencesIncluded: v.array(v.string()),
  requirementsMet: v.array(v.string()),
  changesOrAdditions: v.array(v.string()),
  cannotProvide: v.array(v.string()),
  finalFit: v.number(),
  netPricePerPerson: v.number(),
  currency: v.string(),
  pricingAssumptions: v.string(),
  depositPercent: v.number(),
  depositDueDaysBefore: v.number(),
  finalHeadcountDaysBefore: v.number(),
  finalPaymentDaysBefore: v.number(),
  travelerNamesDaysBefore: v.number(),
  roomReleaseDaysBefore: v.number(),
  operatorNotes: v.string(),
  requirementAnswers: v.array(requirementAnswer),
};

const draftValidator = v.object(draftFields);

// What the model is told about each numbered requirement. The advisor's browser
// builds the list from the brief, the same list the operator's packet shows.
const requirementBrief = v.object({
  key: v.string(),
  id: v.string(),
  label: v.string(),
  statement: v.string(),
});
type RequirementBrief = Infer<typeof requirementBrief>;
type DraftFields = Infer<typeof draftValidator>;
type DraftReply = {
  draft: DraftFields;
  evidence: { field: string; quote: string }[];
  droppedEvidence: string[];
  quoteCheck: boolean;
  caveats: string[];
};

// A model reads an emailed reply and drafts the structured proposal. It never
// writes: the draft goes back to the advisor, every quote in it must appear
// verbatim in the reply, and the advisor records the result.
export const draftFromReply = action({
  args: {
    briefId: v.id("briefs"),
    sourceText: v.string(),
    destinations: v.array(v.object({ slug: v.string(), name: v.string() })),
    requirements: v.optional(v.array(requirementBrief)),
  },
  returns: v.object({
    draft: draftValidator,
    evidence: v.array(v.object({ field: v.string(), quote: v.string() })),
    // Fields whose quote could not be found in the reply. The draft is still
    // useful, but the advisor knows exactly which parts to check by hand — the
    // rule from the RFP work: anything unsupported is dropped and named.
    droppedEvidence: v.array(v.string()),
    // False when the draft came from a document we could not quote-check, so the
    // interface can say so rather than implying a guarantee it cannot make.
    quoteCheck: v.boolean(),
    caveats: v.array(v.string()),
  }),
  // The return type is written out because this action calls `api` and
  // `internal`, whose types import this module: without it, TypeScript reports a
  // circular inference instead of a type error it can explain.
  handler: async (ctx, args): Promise<DraftReply> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Please sign in.");
    const brief: BriefFields | null = await ctx.runQuery(
      api.briefs.draftSource,
      { briefId: args.briefId },
    );
    if (!brief) throw new ConvexError("Brief not found.");
    const sourceText = args.sourceText.trim();
    if (!sourceText || sourceText.length > 20_000)
      throw new ConvexError(
        "The reply must be between 1 and 20,000 characters.",
      );
    const key = env.OPENAI_API_KEY?.trim();
    if (!key) throw new ConvexError("AI drafting has not been configured.");
    await ctx.runMutation(internal.integrationLimits.consumeAnalysis, {
      briefId: args.briefId,
    });
    const allowedDestinations = args.destinations.slice(0, 40);
    const requirements = (args.requirements ?? []).slice(0, 40).map((item) => ({
      key: text(item.key, 40),
      id: text(item.id, 8),
      label: text(item.label, 120),
      statement: text(item.statement, 400),
    }));
    const raw = await structuredResponse({
      apiKey: key,
      model: MODEL,
      developer:
        "You read an incoming tour operator's emailed reply to a travel agency and fill in a structured proposal. Use only what the reply states. Never invent a price, a date, an inclusion or a deadline: use an empty string, 0 or an empty list when the reply does not say. Dates are YYYY-MM-DD; when the reply gives a day and month without a year, use the year of the travel window. Every item in evidence, and every requirement answer's quote, must be copied character for character out of the reply, exactly as written: do not paraphrase, shorten, tidy, correct or join two sentences. Give netPricePerPerson, groupSizeAccepted and depositPercent each an evidence item whose field is exactly that name, quoting the words that state the figure; a figure without one is cleared. A requirement answer's note must not state a number its quote does not contain. Answer a numbered requirement with yes, partly or no only when the reply addresses it, quoting the words that show it; answer not_stated otherwise. This is a review draft for a human, never a recommendation.",
      user: [
        "THE REQUEST",
        `Destination options the operator could propose: ${allowedDestinations
          .map((item) => `${item.slug} (${item.name})`)
          .join(", ")}`,
        `Travel window: ${brief.earliestDepartureDate} to ${brief.latestDepartureDate}, preferred departure ${brief.preferredDepartureDate}`,
        `Nights requested: ${brief.nights}`,
        `Travelers: ${brief.travelerCount} (minimum viable ${brief.minimumViableTravelers})`,
        `Experiences requested: ${brief.desiredExperiences.join(", ")}`,
        `Operating needs: ${[
          ...brief.transportationNeeds,
          ...brief.accessibilityNeeds,
          ...brief.importantRequirements,
        ].join(", ")}`,
        `Target net per person: ${Math.round(brief.targetRetailPricePerPerson * 0.75)} USD`,
        "",
        "THE NUMBERED REQUIREMENTS THE OPERATOR WAS ASKED TO ANSWER",
        ...(requirements.length
          ? requirements.map(
              (item) => `${item.id} [${item.key}] ${item.label}: ${item.statement}`,
            )
          : ["(none)"]),
        "",
        "THE OPERATOR'S REPLY",
        sourceText,
      ].join("\n"),
      schemaName: "operator_proposal_draft",
      schema: draftSchema(
        brief,
        allowedDestinations.map((item) => item.slug),
        requirements,
      ),
    });
    return validateDraft(raw, sourceText, brief, allowedDestinations, {
      requirements,
    });
  },
});

export function draftSchema(
  brief: Pick<
    BriefFields,
    | "nights"
    | "travelerCount"
    | "minimumViableTravelers"
    | "desiredExperiences"
    | "importantRequirements"
    | "transportationNeeds"
    | "accessibilityNeeds"
  >,
  destinationSlugs: string[],
  requirements: RequirementBrief[] = [],
) {
  const destination = destinationSlugs.length
    ? { type: "string", enum: destinationSlugs }
    : { type: "string" };
  const operations = [
    ...new Set([
      ...brief.transportationNeeds,
      ...brief.accessibilityNeeds,
      "private_transportation",
      "shared_transportation",
      "airport_transfers",
      "private_guides",
      "shared_guides",
      "multilingual_guides",
      "accessible_transportation",
      "low_mobility_options",
      "private_activities",
      "shared_activities",
      "luggage_handling",
      "meet_and_greet",
      "on_trip_support",
      "emergency_support",
      "custom_itinerary_building",
    ]),
  ];
  // Requirement answers are only asked for when there are requirements to answer:
  // an empty enum is not a valid schema.
  const answers = requirements.length
    ? {
        requirementAnswers: {
          type: "array",
          maxItems: requirements.length,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["key", "answer", "note", "quote"],
            properties: {
              key: { type: "string", enum: requirements.map((item) => item.key) },
              answer: { type: "string", enum: ["yes", "partly", "no", "not_stated"] },
              note: { type: "string" },
              quote: { type: "string" },
            },
          },
        },
      }
    : {};
  return {
    type: "object",
    additionalProperties: false,
    required: ["draft", "evidence", "caveats"],
    properties: {
      draft: {
        type: "object",
        additionalProperties: false,
        required: Object.keys(draftFields).filter(
          (field) => field !== "requirementAnswers" || requirements.length > 0,
        ),
        properties: {
          ...answers,
          programName: { type: "string" },
          destinationSlug: destination,
          startDate: { type: "string" },
          endDate: { type: "string" },
          nights: { type: "integer" },
          availability: {
            type: "string",
            enum: [
              "Confirmation Required",
              "Available",
              "On Request",
              "Held",
              "Unavailable",
            ],
          },
          groupSizeAccepted: { type: "integer" },
          hotelLevel: { type: "string" },
          hotelNotes: { type: "string" },
          transportation: {
            type: "array",
            items: { type: "string", enum: operations },
          },
          experiencesIncluded: {
            type: "array",
            items: {
              type: "string",
              enum: brief.desiredExperiences.length
                ? brief.desiredExperiences
                : ["none"],
            },
          },
          requirementsMet: {
            type: "array",
            items: {
              type: "string",
              enum: brief.importantRequirements.length
                ? brief.importantRequirements
                : ["none"],
            },
          },
          changesOrAdditions: { type: "array", items: { type: "string" } },
          cannotProvide: { type: "array", items: { type: "string" } },
          finalFit: { type: "integer" },
          netPricePerPerson: { type: "number" },
          currency: { type: "string", enum: ["USD", "EUR", "IDR"] },
          pricingAssumptions: { type: "string" },
          depositPercent: { type: "integer" },
          depositDueDaysBefore: { type: "integer" },
          finalHeadcountDaysBefore: { type: "integer" },
          finalPaymentDaysBefore: { type: "integer" },
          travelerNamesDaysBefore: { type: "integer" },
          roomReleaseDaysBefore: { type: "integer" },
          operatorNotes: { type: "string" },
        },
      },
      evidence: {
        type: "array",
        maxItems: 12,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["field", "quote"],
          properties: {
            field: { type: "string" },
            quote: { type: "string" },
          },
        },
      },
      caveats: { type: "array", maxItems: 5, items: { type: "string" } },
    },
  };
}

export function validateDraft(
  raw: unknown,
  sourceText: string,
  brief: Pick<
    BriefFields,
    "desiredExperiences" | "importantRequirements"
  >,
  destinations: { slug: string; name: string }[],
  options: { verifiable?: boolean; requirements?: RequirementBrief[] } = {},
) {
  // A document the model read directly cannot have its quotes checked against
  // text we never extracted, so the draft is returned as unverified instead of
  // being refused. The interface says which of the two it is holding.
  const verifiable = options.verifiable !== false;
  const reject = (): never => {
    throw new ConvexError(
      "The AI draft did not match the operator's reply. Record the proposal by hand instead.",
    );
  };
  if (!raw || typeof raw !== "object" || !("draft" in raw)) return reject();
  const draft = raw.draft;
  const evidence = "evidence" in raw ? raw.evidence : undefined;
  const caveats = "caveats" in raw ? raw.caveats : undefined;
  if (!draft || typeof draft !== "object" || !Array.isArray(evidence))
    return reject();
  const values = draft as Record<string, unknown>;
  const str = (key: string) => {
    const value = values[key];
    return typeof value === "string" ? value : "";
  };
  const num = (key: string) => {
    const value = values[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };
  const arr = (key: string, allowed?: string[]) => {
    const value = values[key];
    if (!Array.isArray(value)) return [];
    const items = value.filter(
      (item): item is string => typeof item === "string",
    );
    return (allowed ? items.filter((item) => allowed.includes(item)) : items)
      .slice(0, 30);
  };
  const slugs = destinations.map((item) => item.slug);
  const availabilityOptions = [
    "Confirmation Required",
    "Available",
    "On Request",
    "Held",
    "Unavailable",
  ];
  const availability = availabilityOptions.includes(str("availability"))
    ? (str("availability") as ProposalInput["availability"])
    : ("Confirmation Required" as const);

  const cleanedEvidence: { field: string; quote: string }[] = [];
  const droppedEvidence: string[] = [];
  for (const item of evidence) {
    if (
      !item ||
      typeof item !== "object" ||
      !("field" in item) ||
      !("quote" in item) ||
      typeof item.field !== "string" ||
      typeof item.quote !== "string"
    )
      continue;
    const quote = item.quote.trim();
    if (!quote) continue;
    const field = text(item.field, 60);
    if (verifiable && !quoteIsPresent(quote, sourceText)) {
      // The model wrote something the operator did not. That quote is never shown
      // as evidence; the field is reported instead, so the advisor checks it.
      droppedEvidence.push(field || "an unnamed field");
      continue;
    }
    cleanedEvidence.push({ field, quote });
  }

  // A requirement answer stands only on the operator's own words. One without a
  // quote that is really in the reply is dropped and named, never shown as an
  // answer: "not answered" is a truer cell in the comparison than a guess.
  const known = new Map(
    (options.requirements ?? []).map((item) => [item.key, item]),
  );
  const requirementAnswers: AnswerInput[] = [];
  const rawAnswers = values.requirementAnswers;
  for (const item of Array.isArray(rawAnswers) ? rawAnswers : []) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const key = typeof entry.key === "string" ? entry.key : "";
    const answer = entry.answer;
    const spec = known.get(key);
    if (!spec || (answer !== "yes" && answer !== "partly" && answer !== "no"))
      continue;
    const quote = typeof entry.quote === "string" ? entry.quote.trim() : "";
    if (!quote || (verifiable && !quoteIsPresent(quote, sourceText))) {
      droppedEvidence.push(`${spec.id} ${spec.label}`);
      continue;
    }
    // The answer and its quote stand; a note that states a figure the quote
    // does not contain is the model speaking, not the operator, so it goes.
    let note = typeof entry.note === "string" ? text(entry.note, 600) : "";
    if (verifiable && unquotedFigures(note, quote).length > 0) {
      droppedEvidence.push(`${spec.id} ${spec.label}: a figure not in the quote`);
      note = "";
    }
    requirementAnswers.push({ key, answer, note, quote: text(quote, 600) });
  }

  // The figures a comparison is decided on must each be in the operator's own
  // words quoted for that field. The model names the field it is evidencing,
  // so a price is checked against the price quote, not against the reply as a
  // whole, where "16" or "2027" could turn up in some unrelated sentence. A
  // figure with no quote behind it is cleared, and named, rather than trusted.
  const quotesFor = (field: string) =>
    cleanedEvidence
      .filter((item) => item.field.toLowerCase() === field.toLowerCase())
      .map((item) => item.quote);
  const checkFigure = (field: string, label: string, value: number) => {
    if (!verifiable || !value) return value;
    if (quotesFor(field).some((quote) => figureIsQuoted(value, quote))) return value;
    droppedEvidence.push(`${label}: not in the operator's words`);
    return 0;
  };

  // If the model produced evidence and none of it can be found, it is inventing
  // wholesale and the draft must not be offered at all.
  if (verifiable && evidence.length > 0 && cleanedEvidence.length === 0)
    return reject();

  return {
    draft: {
      programName: text(str("programName")),
      destinationSlug: slugs.includes(str("destinationSlug"))
        ? str("destinationSlug")
        : (slugs[0] ?? ""),
      startDate: iso(str("startDate")),
      endDate: iso(str("endDate")),
      nights: Math.max(0, Math.min(120, Math.round(num("nights")))),
      availability,
      groupSizeAccepted: checkFigure(
        "groupSizeAccepted",
        "Group size accepted",
        Math.max(0, Math.round(num("groupSizeAccepted"))),
      ),
      hotelLevel: text(str("hotelLevel"), 60),
      hotelNotes: text(str("hotelNotes"), LONG),
      transportation: arr("transportation"),
      experiencesIncluded: arr(
        "experiencesIncluded",
        brief.desiredExperiences,
      ),
      requirementsMet: arr("requirementsMet", brief.importantRequirements),
      changesOrAdditions: arr("changesOrAdditions"),
      cannotProvide: arr("cannotProvide"),
      finalFit: Math.max(0, Math.min(100, Math.round(num("finalFit")))),
      netPricePerPerson: checkFigure(
        "netPricePerPerson",
        "Net price per person",
        money(num("netPricePerPerson")),
      ),
      currency: ["USD", "EUR", "IDR"].includes(str("currency"))
        ? str("currency")
        : "USD",
      pricingAssumptions: text(str("pricingAssumptions"), LONG),
      depositPercent: checkFigure(
        "depositPercent",
        "Deposit percent",
        Math.max(0, Math.min(100, Math.round(num("depositPercent")))),
      ),
      depositDueDaysBefore: days(num("depositDueDaysBefore")),
      finalHeadcountDaysBefore: days(num("finalHeadcountDaysBefore")),
      finalPaymentDaysBefore: days(num("finalPaymentDaysBefore")),
      travelerNamesDaysBefore: days(num("travelerNamesDaysBefore")),
      roomReleaseDaysBefore: days(num("roomReleaseDaysBefore")),
      operatorNotes: text(str("operatorNotes"), LONG),
      requirementAnswers: cleanAnswers(requirementAnswers),
    },
    evidence: cleanedEvidence.slice(0, 12),
    droppedEvidence: [...new Set(droppedEvidence)].slice(0, 40),
    quoteCheck: verifiable,
    caveats: Array.isArray(caveats)
      ? caveats
          .filter((item): item is string => typeof item === "string")
          .map((item) => text(item, LONG))
          .filter(Boolean)
          .slice(0, 5)
      : [],
  };
}
