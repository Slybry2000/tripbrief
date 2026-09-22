import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

// ---------------------------------------------------------------------------
// The operator network
//
// The agency sells the trip; the incoming tour operator runs it. The network
// is what the advisor matches a client brief against, so it is stored rather
// than hard-coded: an operator maintains its own capability record, and every
// match run reads the current version of it.
// ---------------------------------------------------------------------------

export const operatorRecord = v.object({
  owner: v.string(),
  slug: v.string(),
  name: v.string(),
  country: v.string(),
  destinations: v.array(v.string()),
  specialties: v.array(v.string()),
  minGroupSize: v.number(),
  maxGroupSize: v.number(),
  experienceLevels: v.array(v.number()),
  typicalNetPriceMin: v.number(),
  typicalNetPriceMax: v.number(),
  approvalStatus: v.string(),
  // How the agency reaches this operator. It belongs to the network record, not
  // to one brief: an operator is contacted many times, and retyping the address
  // for every request is how a wrong one gets sent.
  contactEmail: v.optional(v.string()),
  // "seed" for the shipped fictional network, "researched" for an operator an
  // advisor added from a real published website.
  source: v.union(
    v.literal("seed"),
    v.literal("researched"),
    v.literal("manual"),
  ),
  website: v.optional(v.string()),
  updatedAt: v.number(),
});

export const serviceArea = v.object({
  destinationSlug: v.string(),
  country: v.string(),
  regions: v.array(v.string()),
  cities: v.array(v.string()),
  areas: v.array(v.string()),
  coverage: v.union(
    v.literal("nationwide"),
    v.literal("regional"),
    v.literal("local"),
  ),
  operatingMonths: v.array(v.number()),
});

export const operatingTiming = v.object({
  yearRound: v.boolean(),
  operatingMonths: v.array(v.number()),
  seasonalNotes: v.string(),
  blackoutPeriods: v.array(
    v.object({ start: v.string(), end: v.string(), label: v.string() }),
  ),
  shortestLeadTimeDays: v.number(),
  minimumLeadTimeDays: v.number(),
  idealLeadTimeDays: v.number(),
  averageProposalTurnaroundDays: v.number(),
  maximumProposalTurnaroundDays: v.number(),
  spaceHoldDays: v.number(),
  depositDueDaysBefore: v.number(),
  finalPaymentDaysBefore: v.number(),
  finalHeadcountDaysBefore: v.number(),
  travelerNamesDaysBefore: v.number(),
  latestGroupChangeDaysBefore: v.number(),
  roomReleaseDaysBefore: v.number(),
  cancellationDeadlines: v.array(
    v.object({ daysBefore: v.number(), penalty: v.string() }),
  ),
});

export const commercialTerms = v.object({
  typicalNetMin: v.number(),
  typicalNetMax: v.number(),
  minimumTripValue: v.number(),
  typicalTripValue: v.number(),
  preferredGroupValue: v.number(),
  pricingModels: v.array(v.string()),
  currency: v.string(),
  pricingVariesByGroupSize: v.boolean(),
});

// What an operator can actually deliver. Every list here is drawn from a fixed
// vocabulary (experiences, operations, requirement names, hotel levels), so the
// arrays are bounded by construction and never grow with use.
export const operatorCapability = v.object({
  owner: v.string(),
  operatorSlug: v.string(),
  locations: v.array(v.string()),
  serviceAreas: v.array(serviceArea),
  minGroupSize: v.number(),
  maxGroupSize: v.number(),
  idealGroupSize: v.number(),
  supportsFIT: v.boolean(),
  groupTypes: v.array(v.string()),
  travelerTypes: v.array(v.string()),
  hotelTypes: v.array(v.string()),
  services: v.array(v.string()),
  features: v.array(v.string()),
  operations: v.array(v.string()),
  canBuildBespoke: v.boolean(),
  customizationLevel: v.union(
    v.literal("limited"),
    v.literal("moderate"),
    v.literal("high"),
    v.literal("fully_bespoke"),
  ),
  quoteTurnaroundDays: v.number(),
  languages: v.array(v.string()),
  commercial: commercialTerms,
  timing: operatingTiming,
  updatedAt: v.number(),
});

// ---------------------------------------------------------------------------
// The client brief
// ---------------------------------------------------------------------------

export const briefStatus = v.union(
  v.literal("draft"),
  v.literal("sent"),
  v.literal("comparing"),
  v.literal("selected"),
);

// Everything the advisor knows before any operator is contacted. The destination
// is deliberately absent from this list: a brief is written before the
// destination is chosen, and the chosen locations are stored separately below.
export const briefFields = v.object({
  name: v.string(),
  evaluationDate: v.string(),
  travelMonth: v.string(),
  travelerCount: v.number(),
  minimumViableTravelers: v.number(),
  confirmedTravelers: v.number(),
  nights: v.number(),
  earliestDepartureDate: v.string(),
  preferredDepartureDate: v.string(),
  latestDepartureDate: v.string(),
  flexibleDates: v.boolean(),
  proposalDecisionDate: v.string(),
  targetRetailPricePerPerson: v.number(),
  flightsIncluded: v.boolean(),
  experienceLevel: v.number(),
  pace: v.string(),
  climates: v.array(v.string()),
  desiredExperiences: v.array(v.string()),
  importantRequirements: v.array(v.string()),
  travelerTypes: v.array(v.string()),
  transportationNeeds: v.array(v.string()),
  accessibilityNeeds: v.array(v.string()),
  notes: v.string(),
  // What an incoming operator needs in order to quote. Named in the operator's
  // terms rather than the form's, because it is read by them.
  groupDescription: v.string(),
  ages: v.string(),
  rooms: v.string(),
  dietaryAndMedical: v.string(),
  dateFirmness: v.string(),
  budgetBasis: v.string(),
  guestOrigin: v.string(),
  dayShape: v.string(),
  inclusionsExpected: v.array(v.string()),
  // Constraints, not preferences: shown to the operator on their own and never
  // folded into the numbered requirements.
  hardNos: v.array(v.string()),
});

export const availability = v.union(
  v.literal("Confirmation Required"),
  v.literal("Available"),
  v.literal("On Request"),
  v.literal("Held"),
  v.literal("Unavailable"),
);

// What published sources say about a place. The strengths use the same experience
// vocabulary as a brief, scored 0 to 5, so the destination ranking reads them
// exactly as it reads the starter catalog.
export const placeProfile = v.object({
  name: v.string(),
  country: v.string(),
  description: v.string(),
  climates: v.array(v.string()),
  experienceStrengths: v.record(v.string(), v.number()),
  watchOuts: v.array(v.string()),
  sources: v.array(v.object({ title: v.string(), url: v.string() })),
  researchedAt: v.number(),
});

// A real operator as its own website describes it.
export const webOperator = v.object({
  destinationSlug: v.string(),
  domain: v.string(),
  name: v.string(),
  country: v.string(),
  regions: v.array(v.string()),
  website: v.string(),
  // Only an address that appears on the operator's own pages. Empty when the site
  // publishes none.
  email: v.string(),
  summary: v.string(),
  services: v.array(v.string()),
  operations: v.array(v.string()),
  travelerTypes: v.array(v.string()),
  hotelTypes: v.array(v.string()),
  languages: v.array(v.string()),
  minGroupSize: v.number(),
  maxGroupSize: v.number(),
  sourceUrl: v.string(),
  foundAt: v.number(),
});

// One operator's answer to one numbered requirement (R1..Rn). Keyed by the
// requirement's stable key rather than its number, so an answer still lines up
// if the brief later gains or loses a requirement.
export const requirementAnswer = v.object({
  key: v.string(),
  answer: v.union(v.literal("yes"), v.literal("partly"), v.literal("no")),
  note: v.string(),
  // The operator's own words, when the answer was drafted from an emailed reply.
  // Always a verbatim quote of that reply, or absent.
  quote: v.optional(v.string()),
});

// The structured proposal an operator returns. This is the object the advisor
// compares, and after selection it is the source of every operational deadline.
export const proposalRecord = v.object({
  programName: v.string(),
  basedOnExistingProgram: v.boolean(),
  basedOnProgramSlug: v.optional(v.string()),
  destinationSlug: v.string(),
  startDate: v.string(),
  endDate: v.string(),
  nights: v.number(),
  availability,
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
  cancellationTerms: v.array(
    v.object({ daysBefore: v.number(), penalty: v.string() }),
  ),
  operatorNotes: v.string(),
  // Optional so proposals recorded before requirements were answerable stay valid;
  // the comparison shows those as "not answered" rather than guessing.
  requirementAnswers: v.optional(v.array(requirementAnswer)),
});

export default defineSchema({
  ...authTables,

  operators: defineTable(operatorRecord)
    .index("by_owner_and_slug", ["owner", "slug"])
    .index("by_owner_and_source", ["owner", "source"]),

  // One capability record per operator. It is the only thing an operator can
  // write, and it is what the matcher reads.
  operatorCapability: defineTable(operatorCapability).index(
    "by_owner_and_operatorSlug",
    ["owner", "operatorSlug"],
  ),

  // A standing link that lets an operator keep its own capability record current.
  // It is not tied to a brief: a brief is deleted, an operator stays in the
  // network. A request link is separate, and lives on `briefOperators`.
  operatorLinks: defineTable({
    owner: v.string(),
    operatorSlug: v.string(),
    token: v.string(),
    sentTo: v.optional(v.string()),
    lastOpenedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_owner_and_operatorSlug", ["owner", "operatorSlug"]),

// The places an advisor put on the list themselves, for a client who asks for
// somewhere the network has not reached yet. The starter catalog is the agency's
// own reference knowledge and lives in the interface; the places the network
// covers are read from the operators, so only what a person added is stored here.
destinations: defineTable({
  owner: v.string(),
  slug: v.string(),
  name: v.string(),
  country: v.string(),
  // What the advisor says this place is genuinely strong for, in the same
  // vocabulary the brief uses. Empty is allowed: it means "not assessed yet",
  // which is a different statement from "a poor fit".
  strengths: v.array(v.string()),
  // Filled in from published travel sources when the place is added, so the
  // advisor types a name and nothing else. Optional: places added before this
  // carry only the advisor's own ticks.
  profile: v.optional(placeProfile),
  updatedAt: v.number(),
}).index("by_owner_and_slug", ["owner", "slug"]),

// What published travel sources say about a place, shared by every workspace so
// the same country is only researched once. It is reference knowledge about a
// country, not anybody's data.
placeProfiles: defineTable({
  slug: v.string(),
  ...placeProfile.fields,
}).index("by_slug", ["slug"]),

// Real incoming tour operators and destination management companies found on the
// web, with the contact address their own site publishes. Shared by every
// workspace as a cache: a workspace imports from here into its own network.
webOperators: defineTable(webOperator).index("by_destinationSlug", [
  "destinationSlug",
]),

briefs: defineTable({
    owner: v.string(),
    ...briefFields.fields,
    status: briefStatus,
    // The customer-approved locations. Only operators serving one of these is
    // considered, which is why this is stored on the brief rather than derived.
    selectedDestinationSlugs: v.array(v.string()),
    selectedProposalId: v.optional(v.id("proposals")),
    selectionReason: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_owner", ["owner"]),

  // A small pool of mailboxes per workspace, rather than one per brief: a free
  // mail account gives three inboxes and an agency has more briefs than that. A
  // reply is attributed to the exact request it answers by the thread it belongs
  // to, so one shared mailbox loses nothing.
  mailboxes: defineTable({
    owner: v.string(),
    inboxId: v.string(),
    address: v.string(),
    displayName: v.string(),
    lastUsedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_owner", ["owner"])
    .index("by_inboxId", ["inboxId"])
    .index("by_address", ["address"]),

  // One row per operator the advisor chose to contact. The row owns that
  // operator's private response link, so a link can be re-issued or revoked
  // without touching the brief itself.
  briefOperators: defineTable({
    briefId: v.id("briefs"),
    owner: v.string(),
    operatorSlug: v.string(),
    operatorName: v.string(),
    capabilityToken: v.string(),
    status: v.union(
      v.literal("open"),
      v.literal("sent"),
      v.literal("submitted"),
      v.literal("declined"),
    ),
    email: v.optional(v.string()),
    // The operator's position in the capability ranking when it was shortlisted:
    // 1 is the strongest match. Demo mode makes the strongest match the perfect one.
    rank: v.optional(v.number()),
    // Set when the request went to the demo stand-in inbox instead of the operator.
    deliveredTo: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    providerMessageId: v.optional(v.string()),
    // The thread this request started. A reply carries it back, which is how a
    // reply is attributed to one request even when a mailbox serves many briefs.
    providerThreadId: v.optional(v.string()),
    mailboxId: v.optional(v.id("mailboxes")),
    sendError: v.optional(v.string()),
    openedAt: v.optional(v.number()),
    proposalId: v.optional(v.id("proposals")),
    // The one nudge timer this request may ever have, and when it wakes. Set once,
    // when the request is first sent.
    nudgeWorkflowId: v.optional(v.string()),
    nudgeDueAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_briefId", ["briefId"])
    .index("by_capabilityToken", ["capabilityToken"])
    .index("by_providerThreadId", ["providerThreadId"])
    .index("by_email", ["email"])
    .index("by_operatorSlug", ["operatorSlug"]),

  proposals: defineTable({
    briefId: v.id("briefs"),
    owner: v.string(),
    operatorSlug: v.string(),
    ...proposalRecord.fields,
    // How it arrived. A portal submission is the operator's own words; an
    // emailed reply is recorded by the advisor, and a model draft is only ever a
    // review draft until a human accepts it.
    submittedVia: v.union(
      v.literal("portal"),
      v.literal("advisor_import"),
      v.literal("email_import"),
    ),
    submittedAt: v.number(),
    // Set once the arrival has been announced to the advisor, so a quote is never
    // announced twice and never silently missed.
    announcedAt: v.optional(v.number()),
    // True when a model wrote the reply as the operator, in demo mode.
    simulated: v.optional(v.boolean()),
    standardisedAt: v.optional(v.number()),
    standardisedBy: v.optional(v.string()),
    // The operator's own words, kept when a proposal arrived as an emailed reply
    // rather than through its response link. A model draft is checked against
    // this text, never against a paraphrase of it.
    sourceText: v.optional(v.string()),
  })
    .index("by_briefId", ["briefId"])
    .index("by_briefId_and_operatorSlug", ["briefId", "operatorSlug"]),

  // An emailed reply, stored exactly as it arrived. It is the raw material a
  // model draft is drawn from, and it is never overwritten by a proposal.
  inboxMessages: defineTable({
    // Null when a reply arrives from an address no request on file was sent to.
    // It is kept rather than dropped, and the advisor can see it.
    briefId: v.union(v.null(), v.id("briefs")),
    owner: v.string(),
    briefOperatorId: v.optional(v.id("briefOperators")),
    operatorSlug: v.optional(v.string()),
    mailboxId: v.optional(v.id("mailboxes")),
    inboxId: v.string(),
    threadId: v.optional(v.string()),
    // "thread" when the reply answered a request exactly; "address" when it could
    // only be placed by who sent it.
    matchedBy: v.optional(v.union(v.literal("thread"), v.literal("address"))),
    fromEmail: v.string(),
    fromName: v.optional(v.string()),
    subject: v.string(),
    text: v.string(),
    messageId: v.string(),
    receivedAt: v.number(),
    announcedAt: v.optional(v.number()),
  })
    .index("by_briefId", ["briefId"])
    .index("by_owner", ["owner"])
    .index("by_messageId", ["messageId"])
    .index("by_inboxId", ["inboxId"]),

  // A message the agency may send an operator after the request, in the same
  // thread: a nudge when it has gone quiet, or a question about the must-haves its
  // reply left open. It is a draft until a person approves its exact text, and the
  // approval is kept beside the text so any later edit is seen to void it.
  followUps: defineTable({
    briefId: v.id("briefs"),
    owner: v.string(),
    briefOperatorId: v.id("briefOperators"),
    operatorSlug: v.string(),
    kind: v.union(v.literal("nudge"), v.literal("gaps")),
    // "nudge:<request>" or "gaps:<brief>:<operator>". One row per key, ever, which
    // is what limits a request to one nudge and an operator to one gap question.
    dedupeKey: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("approved"),
      v.literal("sending"),
      v.literal("sent"),
      v.literal("failed"),
      v.literal("discarded"),
      v.literal("cancelled"),
    ),
    // The requirement keys a gap question asks about. Bounded by the brief's
    // requirement list, which is a few dozen at most.
    requirementKeys: v.array(v.string()),
    text: v.string(),
    // Exactly the text the agency approved. It must still equal `text` at the
    // moment of sending, or nothing is sent.
    approvedText: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    approvedBy: v.optional(v.string()),
    deliveredTo: v.optional(v.string()),
    providerMessageId: v.optional(v.string()),
    providerThreadId: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    sendError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_dedupeKey", ["dedupeKey"])
    .index("by_briefId", ["briefId"])
    .index("by_providerThreadId", ["providerThreadId"]),

  // Published websites an advisor found while looking for new operators. A
  // candidate is evidence, not a network member: it becomes an operator only
  // when a human adds it.
  candidates: defineTable({
    owner: v.string(),
    query: v.string(),
    title: v.string(),
    url: v.string(),
    description: v.string(),
    destinationSlug: v.string(),
    foundAt: v.number(),
    addedOperatorSlug: v.optional(v.string()),
    dismissedAt: v.optional(v.number()),
  })
    .index("by_owner", ["owner"])
    .index("by_url", ["url"]),
});
