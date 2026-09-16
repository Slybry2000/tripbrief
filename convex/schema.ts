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
    sentAt: v.optional(v.number()),
    providerMessageId: v.optional(v.string()),
    // The thread this request started. A reply carries it back, which is how a
    // reply is attributed to one request even when a mailbox serves many briefs.
    providerThreadId: v.optional(v.string()),
    mailboxId: v.optional(v.id("mailboxes")),
    sendError: v.optional(v.string()),
    openedAt: v.optional(v.number()),
    proposalId: v.optional(v.id("proposals")),
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
