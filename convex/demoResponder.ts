import { env, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, type Infer } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { availability, proposalRecord } from "./schema";
import { structuredResponse } from "./openai";
import { cleanProposal } from "./proposals";
import { demoMode, pickDeviations, seeded } from "./demo";
import { HOTEL_TYPES } from "./vocabulary";
import { buildRequirements, type Requirement } from "../src/lib/requirements";
import type { TripRequest } from "../src/lib/types";

const MODEL = "gpt-4.1-mini";
const CURRENCIES = ["USD", "EUR", "GBP", "THB", "IDR", "MXN", "CRC", "INR", "VND", "MAD", "LKR", "JPY"];
const AVAILABILITY = ["Available", "Held", "On Request", "Confirmation Required"];

type Answer = "yes" | "partly" | "no";

// The brief as the requirement builder reads it. Only fields the numbered
// requirements use matter; the rest are neutral.
export function requestFromBrief(brief: Doc<"briefs">): TripRequest {
  return {
    id: brief._id,
    name: brief.name,
    evaluationDate: brief.evaluationDate,
    travelerCount: brief.travelerCount,
    minimumViableTravelers: brief.minimumViableTravelers,
    nights: brief.nights,
    travelMonth: brief.travelMonth,
    earliestDepartureDate: brief.earliestDepartureDate,
    latestDepartureDate: brief.latestDepartureDate,
    preferredDepartureDate: brief.preferredDepartureDate,
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
    status: "Sent",
    selectedDestinationIds: brief.selectedDestinationSlugs,
    selectedPartnerIds: [],
    timingOverridePartnerIds: [],
    selectedProposalId: null,
    confirmedTravelers: brief.confirmedTravelers,
  };
}

export const context = internalQuery({
  args: { briefOperatorId: v.id("briefOperators") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("briefOperators", args.briefOperatorId);
    if (!row) return null;
    const brief = await ctx.db.get("briefs", row.briefId);
    if (!brief) return null;
    const operator = (await ctx.db
      .query("operators")
      .withIndex("by_owner_and_slug", (q) => q.eq("owner", row.owner).eq("slug", row.operatorSlug))
      .first());
    const capability = await ctx.db
      .query("operatorCapability")
      .withIndex("by_owner_and_operatorSlug", (q) => q.eq("owner", row.owner).eq("operatorSlug", row.operatorSlug))
      .first();
    const shortlist = await ctx.db
      .query("briefOperators")
      .withIndex("by_briefId", (q) => q.eq("briefId", brief._id))
      .take(20);
    // The strongest match is the one perfect answer. Rank 1 when the advisor's
    // browser supplied a ranking; otherwise the first operator shortlisted.
    const ranked = [...shortlist].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || a.createdAt - b.createdAt);
    return {
      row,
      brief,
      perfect: ranked[0]?._id === row._id,
      operator: {
        name: operator?.name ?? row.operatorName,
        country: operator?.country ?? "",
        website: operator?.website ?? "",
        regions: capability?.serviceAreas.flatMap((area) => area.regions) ?? [],
        summary: capability?.timing.seasonalNotes ?? "",
        services: capability?.services ?? [],
        // The approved place this operator actually serves, for the proposal's label.
        destination:
          brief.selectedDestinationSlugs.find((slug) => operator?.destinations.includes(slug) || capability?.locations.includes(slug)) ??
          brief.selectedDestinationSlugs[0] ??
          "",
      },
    };
  },
});

// A model answers the request as the operator would, in demo mode only. Exactly
// one operator on a brief (the strongest match) meets every requirement; every
// other one meets most of them and differs on one or two, the way real answers do.
// The reply is sent as a real email from the stand-in inbox to the agency's, and
// filed on the request it answers directly, because every demo operator shares
// one stand-in address and an address cannot tell them apart.
export const reply = internalAction({
  args: { briefOperatorId: v.id("briefOperators") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const demo = demoMode();
    const key = env.OPENAI_API_KEY?.trim();
    if (!demo.on || !key) return null;
    const found = await ctx.runQuery(internal.demoResponder.context, args);
    if (!found || found.row.proposalId) return null;
    const { row, brief, perfect, operator } = found;
    const request = requestFromBrief(brief);
    const requirements = buildRequirements(request);
    const count = seeded(`${row._id}-count`)() < 0.5 ? 1 : 2;
    const deviations = perfect ? [] : pickDeviations(row._id, requirements.map((item) => item.key), count);
    const targetNet = Math.round(brief.targetRetailPricePerPerson * 0.75);

    try {
      await ctx.runMutation(internal.integrationLimits.consumeForOwner, { owner: row.owner, kind: "analysis" });
      const raw = await structuredResponse({
        apiKey: key,
        model: MODEL,
        developer: [
          `You are the group sales manager at ${operator.name}, an incoming tour operator in ${operator.country || "the destination"}${operator.regions.length ? ` (${operator.regions.join(", ")})` : ""}. You are answering a travel agency's request for a private group trip. Write as a real, experienced local operator: specific, warm and practical, naming real places, real kinds of hotels and real activities in your area. Do not invent awards, certifications or named partners.`,
          operator.summary ? `What your company does: ${operator.summary}` : "",
          "Answer every numbered requirement with one plain sentence that stands on its own.",
          perfect
            ? "Your company can meet every requirement in full. Quote at or slightly under the agency's target net, on the preferred departure date."
            : `Your company meets the brief well, with exactly these differences, which you must state honestly in the matching requirement's answer (partly or no): ${deviations.map((item) => `[${item.key}] ${item.instruction}`).join(" ")} Every other requirement is a yes.`,
        ].filter(Boolean).join("\n"),
        user: [
          `REQUEST: ${brief.name}`,
          `Window ${brief.earliestDepartureDate} to ${brief.latestDepartureDate}, preferred departure ${brief.preferredDepartureDate}, ${brief.nights} nights, ${brief.travelerCount} travellers.`,
          `Agency's target net: ${targetNet} USD per person, ${brief.budgetBasis || "land only"}.`,
          brief.hardNos?.length ? `Hard no's: ${brief.hardNos.join("; ")}` : "",
          "",
          "NUMBERED REQUIREMENTS",
          ...requirements.map((item) => `${item.id} [${item.key}] ${item.label}: ${item.statement}`),
        ].join("\n"),
        schemaName: "operator_reply",
        schema: replySchema(requirements),
        timeoutMs: 90_000,
      });
      const shaped = shapeReply(raw, { brief, requirements, perfect, deviationKeys: deviations.map((item) => item.key), targetNet, operatorName: operator.name, destinationSlug: operator.destination });
      const subject = `Re: Trip request: ${brief.name}`;
      await sendAsOperator(demo, subject, shaped.text, `demo-reply-${row._id}`, operator.name);
      await ctx.runMutation(internal.demoResponder.record, {
        briefOperatorId: row._id,
        subject,
        text: shaped.text,
        fromName: operator.name,
        proposal: shaped.proposal,
      });
    } catch (cause) {
      await ctx.runMutation(internal.outbound.markFailed, {
        briefOperatorId: row._id,
        error: `The simulated reply could not be produced: ${String(cause instanceof Error ? cause.message : cause).slice(0, 160)}`,
      });
    }
    return null;
  },
});

async function sendAsOperator(
  demo: ReturnType<typeof demoMode>,
  subject: string,
  text: string,
  idempotency: string,
  operatorName: string,
) {
  const key = env.AGENTMAIL_API_KEY?.trim();
  if (!key || !demo.operatorInbox || !demo.agencyInbox) return;
  // A real email, so the agency's inbox holds the reply the comparison was built
  // from. Its failure does not stop the reply being filed: the words are the same.
  await fetch(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(demo.operatorInbox)}/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": idempotency },
    body: JSON.stringify({ to: [demo.agencyInbox], subject: `${subject} (${operatorName.slice(0, 60)})`, text, labels: ["demo-operator-reply"] }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
}

export function replySchema(requirements: Requirement[]) {
  const days = { type: "integer" };
  return {
    type: "object",
    additionalProperties: false,
    required: ["greeting", "programName", "startDate", "endDate", "nights", "netPricePerPerson", "currency", "availability", "hotelLevel", "hotelNotes", "depositPercent", "depositDueDaysBefore", "finalPaymentDaysBefore", "finalHeadcountDaysBefore", "travelerNamesDaysBefore", "roomReleaseDaysBefore", "cancellation", "answers", "cannotProvide", "changes", "closing"],
    properties: {
      greeting: { type: "string" },
      programName: { type: "string" },
      startDate: { type: "string" },
      endDate: { type: "string" },
      nights: { type: "integer" },
      netPricePerPerson: { type: "integer" },
      currency: { type: "string", enum: CURRENCIES },
      availability: { type: "string", enum: AVAILABILITY },
      hotelLevel: { type: "string", enum: HOTEL_TYPES },
      hotelNotes: { type: "string" },
      depositPercent: { type: "integer" },
      depositDueDaysBefore: days,
      finalPaymentDaysBefore: days,
      finalHeadcountDaysBefore: days,
      travelerNamesDaysBefore: days,
      roomReleaseDaysBefore: days,
      cancellation: {
        type: "array",
        maxItems: 4,
        items: { type: "object", additionalProperties: false, required: ["daysBefore", "penalty"], properties: { daysBefore: days, penalty: { type: "string" } } },
      },
      answers: {
        type: "array",
        maxItems: requirements.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["key", "answer", "line"],
          properties: {
            key: { type: "string", enum: requirements.map((item) => item.key) },
            answer: { type: "string", enum: ["yes", "partly", "no"] },
            line: { type: "string" },
          },
        },
      },
      cannotProvide: { type: "array", maxItems: 3, items: { type: "string" } },
      changes: { type: "array", maxItems: 3, items: { type: "string" } },
      closing: { type: "string" },
    },
  };
}

const iso = (value: unknown) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : "";
};
const addDays = (value: string, days: number) => {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const clean = (value: unknown, max = 400) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
const int = (value: unknown, fallback: number, min = 0, max = 3650) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;

// The model writes the words; the rules of the demo are enforced here. The perfect
// operator answers yes to everything, inside the window, at or under the target.
// A close operator differs only where it was told to. Each answer's quote is the
// sentence exactly as it appears in the email, so the grid's quotes are checkable.
export function shapeReply(
  raw: unknown,
  input: { brief: Doc<"briefs">; requirements: Requirement[]; perfect: boolean; deviationKeys: string[]; targetNet: number; operatorName: string; destinationSlug?: string },
) {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const { brief, requirements, perfect, deviationKeys, targetNet } = input;
  const given = new Map<string, { answer: Answer; line: string }>();
  for (const entry of Array.isArray(value.answers) ? value.answers : []) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const answer = item.answer === "yes" || item.answer === "partly" || item.answer === "no" ? item.answer : null;
    const line = clean(item.line, 300);
    if (typeof item.key === "string" && answer && line) given.set(item.key, { answer, line });
  }
  const answers = requirements.map((requirement) => {
    const model = given.get(requirement.key);
    const deviates = !perfect && deviationKeys.includes(requirement.key);
    const answer: Answer = deviates ? (model && model.answer !== "yes" ? model.answer : "partly") : "yes";
    const line = model && model.answer === answer ? model.line : answer === "yes" ? `Yes, we can meet this: ${requirement.statement.slice(0, 160)}` : "Partly: we will confirm the detail with you.";
    return { requirement, answer, line };
  });

  const windowStart = brief.earliestDepartureDate;
  const windowEnd = brief.latestDepartureDate;
  let startDate = iso(value.startDate);
  const inWindow = startDate && startDate >= windowStart && startDate <= windowEnd;
  if (perfect || !startDate || (!inWindow && !deviationKeys.includes("dates"))) startDate = brief.preferredDepartureDate;
  const nights = int(value.nights, brief.nights, 1, 60);
  let net = int(value.netPricePerPerson, targetNet, 1, 1_000_000);
  if (perfect) net = Math.min(net, targetNet);
  else if (!deviationKeys.includes("budget")) net = Math.min(Math.max(net, Math.round(targetNet * 0.9)), targetNet);
  else net = Math.max(net, Math.round(targetNet * 1.08));
  const currency = "USD";
  const cancellation = (Array.isArray(value.cancellation) ? value.cancellation : [])
    .map((item) => item as Record<string, unknown>)
    .map((item) => ({ daysBefore: int(item.daysBefore, 0, 0, 365), penalty: clean(item.penalty, 20) }))
    .filter((item) => item.daysBefore > 0 && item.penalty)
    .slice(0, 4);
  const item = (entry: unknown) => clean(entry, 200).replace(/[.;,\s]+$/, "");
  const cannotProvide = perfect ? [] : (Array.isArray(value.cannotProvide) ? value.cannotProvide : []).map(item).filter(Boolean).slice(0, 3);
  const changes = (Array.isArray(value.changes) ? value.changes : []).map(item).filter(Boolean).slice(0, 3);
  const programName = clean(value.programName, 120) || `${brief.name} with ${input.operatorName}`;
  const hotelLevel = typeof value.hotelLevel === "string" && HOTEL_TYPES.includes(value.hotelLevel) ? value.hotelLevel : "4-star";
  const deposit = {
    percent: int(value.depositPercent, 30, 0, 100),
    due: int(value.depositDueDaysBefore, 90, 0, 365),
    final: int(value.finalPaymentDaysBefore, 45, 0, 365),
    headcount: int(value.finalHeadcountDaysBefore, 60, 0, 365),
    names: int(value.travelerNamesDaysBefore, 30, 0, 365),
    release: int(value.roomReleaseDaysBefore, 45, 0, 365),
  };
  const endDate = addDays(startDate, nights);

  const text = [
    clean(value.greeting, 600) || "Thank you for thinking of us for this group.",
    "",
    `Our proposal: ${programName}, ${startDate} to ${endDate} (${nights} nights), for ${brief.travelerCount} travellers.`,
    `Net price: ${net.toLocaleString("en-US")} ${currency} per person, ${brief.budgetBasis || "land only"}.`,
    `Hotels: ${clean(value.hotelNotes, 300) || hotelLevel}`,
    "",
    "Our answers to your numbered requirements:",
    ...answers.map(({ requirement, answer, line }) => `${requirement.id} ${requirement.label} (${answer}): ${line}`),
    "",
    `Payment terms: ${deposit.percent}% deposit due ${deposit.due} days before arrival; final payment ${deposit.final} days before; final headcount ${deposit.headcount} days before; traveller names ${deposit.names} days before; unused rooms released ${deposit.release} days before.`,
    cancellation.length ? `Cancellation: ${cancellation.map((item) => `${item.penalty} from ${item.daysBefore} days before`).join("; ")}.` : "",
    cannotProvide.length ? `What we cannot provide: ${cannotProvide.join("; ")}.` : "",
    changes.length ? `Changes we suggest: ${changes.join("; ")}.` : "",
    "",
    clean(value.closing, 400) || "We would be glad to hold space while you decide.",
    input.operatorName,
    "",
    "(Simulated reply, TripBrief demo mode: this operator was not contacted.)",
  ].filter((line, index, all) => line !== "" || all[index - 1] !== "").join("\n");

  const proposal: Infer<typeof proposalRecord> = {
    programName,
    basedOnExistingProgram: false,
    basedOnProgramSlug: "",
    destinationSlug: input.destinationSlug || brief.selectedDestinationSlugs[0] || "",
    startDate,
    endDate,
    nights,
    availability: (AVAILABILITY.includes(clean(value.availability)) ? clean(value.availability) : "Available") as Infer<typeof availability>,
    groupSizeAccepted: brief.travelerCount,
    hotelLevel,
    hotelNotes: clean(value.hotelNotes, 300),
    transportation: brief.transportationNeeds,
    experiencesIncluded: brief.desiredExperiences,
    requirementsMet: [],
    changesOrAdditions: changes,
    cannotProvide,
    finalFit: 0,
    netPricePerPerson: net,
    currency,
    pricingAssumptions: `Per person, twin share, ${brief.budgetBasis || "land only"}.`,
    depositPercent: deposit.percent,
    depositDueDaysBefore: deposit.due,
    finalHeadcountDaysBefore: deposit.headcount,
    finalPaymentDaysBefore: deposit.final,
    travelerNamesDaysBefore: deposit.names,
    roomReleaseDaysBefore: deposit.release,
    cancellationTerms: cancellation,
    operatorNotes: clean(value.closing, 400),
    requirementAnswers: answers.map(({ requirement, answer, line }) => ({ key: requirement.key, answer, note: "", quote: line })),
  };
  // The fit shown in alerts is the requirement coverage, as for any other reply.
  const weights = { must: 3, should: 2, nice: 1 } as const;
  let earned = 0;
  let possible = 0;
  for (const { requirement, answer } of answers) {
    possible += weights[requirement.tier];
    earned += answer === "yes" ? weights[requirement.tier] : answer === "partly" ? weights[requirement.tier] / 2 : 0;
  }
  proposal.finalFit = possible ? Math.round((earned / possible) * 100) : 0;
  return { text, proposal };
}

export const record = internalMutation({
  args: {
    briefOperatorId: v.id("briefOperators"),
    subject: v.string(),
    text: v.string(),
    fromName: v.string(),
    proposal: proposalRecord,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("briefOperators", args.briefOperatorId);
    if (!row || row.proposalId) return null;
    const brief = await ctx.db.get("briefs", row.briefId);
    if (!brief) return null;
    const now = Date.now();
    const demo = demoMode();
    await ctx.db.insert("inboxMessages", {
      briefId: brief._id,
      owner: row.owner,
      briefOperatorId: row._id,
      operatorSlug: row.operatorSlug,
      inboxId: demo.agencyInbox || "demo",
      matchedBy: "thread",
      fromEmail: demo.operatorInbox || "demo-operator",
      fromName: args.fromName.slice(0, 200),
      subject: args.subject.slice(0, 300),
      text: args.text.slice(0, 20_000),
      messageId: `demo-${row._id}`,
      receivedAt: now,
      // Announced here: the arrival is on screen, and a demo sends no alert email.
      announcedAt: now,
    });
    const proposalId = await ctx.db.insert("proposals", {
      briefId: brief._id,
      owner: row.owner,
      operatorSlug: row.operatorSlug,
      ...cleanProposal(args.proposal),
      submittedVia: "email_import",
      submittedAt: now,
      simulated: true,
      announcedAt: now,
      standardisedAt: now,
      standardisedBy: MODEL,
      sourceText: args.text.slice(0, 20_000),
    });
    await ctx.db.patch("briefOperators", row._id, { status: "submitted", proposalId, sendError: "", updatedAt: now });
    if (brief.status !== "selected") await ctx.db.patch("briefs", brief._id, { status: "comparing", updatedAt: now });
    return null;
  },
});
