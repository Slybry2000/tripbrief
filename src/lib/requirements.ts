// A brief becomes a numbered, tiered requirements list — the thing an operator
// actually answers.
//
// Two ideas do the work here:
//
// 1. **Numbering.** An operator answers R1..Rn, so several operators answering the
//    same brief produce comparable columns instead of three PDFs. The order is
//    fixed, so the same brief always produces the same numbers.
// 2. **Tiers.** `must` is what an operator cannot quote without: miss it and the
//    trip cannot be priced at all. `should` shapes the itinerary. `nice` is colour
//    and never a penalty. The gap list is the musts nobody answered, because an
//    operator quoting around a blank is guessing.
//
// A constraint that must never be violated is deliberately NOT a numbered
// requirement. It is shown on its own as a hard no: burying "no early starts"
// inside a list of preferences is how a group ends up with a 6am departure.
import type { TripRequest } from "./types";
import { calculateTargetNet } from "./matching";

export type RequirementTier = "must" | "should" | "nice";

export type Requirement = {
  id: string;
  key: string;
  tier: RequirementTier;
  label: string;
  statement: string;
  ask: string;
};

const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);

const titleCase = (value: string) =>
  value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const list = (values: string[] | undefined) =>
  (values ?? []).map(titleCase).join(", ");

const text = (value: string | undefined) => (value ?? "").trim();

const level = (value: number) =>
  value === 1 ? "3-star" : value === 2 ? "4-star" : "5-star / luxury";

type Spec = {
  key: string;
  tier: RequirementTier;
  label: string;
  ask: string;
  // Empty means the brief does not answer it. That is what the gap list reports
  // for a must, and it is why every statement is built rather than copied.
  statement: (request: TripRequest) => string;
};

// The whole contract between a brief and every proposal that comes back against
// it. Keep it in one list: the operator's packet, the advisor's review and the
// comparison all read this.
export const SPEC: Spec[] = [
  {
    key: "budget",
    tier: "must",
    label: "Budget",
    ask: "Can you build this trip inside that band, and say exactly what it covers?",
    statement: (request) =>
      request.targetRetailPricePerPerson
        ? `${money(request.targetRetailPricePerPerson)} per person is what the group will pay, ${text(request.budgetBasis) || "land only"}. The operator's net is ${money(calculateTargetNet(request))}.`
        : "",
  },
  {
    key: "dates",
    tier: "must",
    label: "Travel window",
    ask: "Do you have availability in this window, and what would have to move if you do not?",
    statement: (request) =>
      request.earliestDepartureDate && request.latestDepartureDate
        ? `${request.earliestDepartureDate} to ${request.latestDepartureDate}, ${request.nights} nights, preferred departure ${request.preferredDepartureDate}. ${
            text(request.dateFirmness) ||
            (request.flexibleDates ? "Flexible inside that window." : "The dates are fixed.")
          }`
        : "",
  },
  {
    key: "travelerCount",
    tier: "must",
    label: "Group size",
    ask: "Can you host a group this size at once, and at what size does the price change?",
    statement: (request) =>
      request.travelerCount
        ? `${request.travelerCount} travellers to price, ${request.minimumViableTravelers} minimum viable, ${request.confirmedTravelers} confirmed so far. ${list(
            request.travelerTypes,
          )}`
        : "",
  },
  {
    key: "groupDescription",
    tier: "must",
    label: "The group",
    ask: "Have you worked with a group like this before?",
    statement: (request) => text(request.groupDescription),
  },
  {
    key: "ages",
    tier: "must",
    label: "Ages",
    ask: "Do your hotel, your insurance and your activities suit these ages?",
    statement: (request) => (text(request.ages) ? `Ages: ${text(request.ages)}` : ""),
  },
  {
    key: "rooms",
    tier: "must",
    label: "Rooms and occupancy",
    ask: "Can you hold this room split, and what does a single cost?",
    statement: (request) => text(request.rooms),
  },
  {
    key: "dietaryAndMedical",
    tier: "must",
    label: "Dietary, mobility and medical needs",
    ask: "Confirm you can accommodate every one of these, and say plainly if you cannot.",
    statement: (request) => text(request.dietaryAndMedical),
  },
  {
    key: "desiredExperiences",
    tier: "must",
    label: "What the trip is built around",
    ask: "Have you run a trip built around this before?",
    statement: (request) => list(request.desiredExperiences),
  },
  {
    key: "accessibilityNeeds",
    tier: "must",
    label: "Accessibility",
    ask: "Confirm what you can physically deliver, not what you can arrange.",
    statement: (request) => list(request.accessibilityNeeds),
  },
  {
    key: "guestOrigin",
    tier: "should",
    label: "Where the group travels from",
    ask: "Which airport do you meet them at, and are the transfers in your price?",
    statement: (request) => text(request.guestOrigin),
  },
  {
    key: "dayShape",
    tier: "should",
    label: "What a good day looks like",
    ask: "Does the day you would build match this shape?",
    statement: (request) => text(request.dayShape),
  },
  {
    key: "inclusionsExpected",
    tier: "should",
    label: "What must be included",
    ask: "Which of these are inside your price, and which are extra?",
    statement: (request) => list(request.inclusionsExpected),
  },
  {
    key: "experienceLevel",
    tier: "should",
    label: "Accommodation level",
    ask: "Can you hold rooms at this level for this group?",
    statement: (request) =>
      request.experienceLevel ? `${level(request.experienceLevel)} accommodation.` : "",
  },
  {
    key: "pace",
    tier: "should",
    label: "Pace",
    ask: "Does your usual day shape match this pace?",
    statement: (request) => (request.pace ? `${titleCase(request.pace)} pace.` : ""),
  },
  {
    key: "importantRequirements",
    tier: "should",
    label: "Operating requirements",
    ask: "Can you meet these, and how?",
    statement: (request) => list(request.importantRequirements),
  },
  {
    key: "transportationNeeds",
    tier: "should",
    label: "Transport and on-trip support",
    ask: "Which of these are inside your price?",
    statement: (request) => list(request.transportationNeeds),
  },
  {
    key: "climates",
    tier: "nice",
    label: "Climate",
    ask: "Does this match your season?",
    statement: (request) => list(request.climates),
  },
  {
    key: "notes",
    tier: "nice",
    label: "In their words",
    ask: "Is there anything here you would design against?",
    statement: (request) => text(request.notes),
  },
];

export function buildRequirements(request: TripRequest): Requirement[] {
  const out: Requirement[] = [];
  for (const spec of SPEC) {
    const statement = spec.statement(request).trim();
    if (!statement) continue;
    out.push({
      id: `R${out.length + 1}`,
      key: spec.key,
      tier: spec.tier,
      label: spec.label,
      statement,
      ask: spec.ask,
    });
  }
  return out;
}

// The constraints. Never numbered and never scored: shown on their own, once.
export function hardNoList(request: TripRequest): string[] {
  return (request.hardNos ?? [])
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 1);
}

// The musts the brief does not answer. An operator cannot price around a blank,
// so this is what the advisor has to fill in before sending.
export function missingMusts(request: TripRequest): { key: string; label: string }[] {
  return SPEC.filter(
    (spec) => spec.tier === "must" && spec.statement(request).trim().length < 3,
  ).map((spec) => ({ key: spec.key, label: spec.label }));
}

export const TIER_LABEL: Record<RequirementTier, string> = {
  must: "Must have",
  should: "Should have",
  nice: "Nice to have",
};
