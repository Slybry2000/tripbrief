// Pure intake logic. This is the judgment from the group-trip intake that was
// built and blind-tested for the private client work earlier in this project,
// carried over without any of its branding, copy or pricing:
//   - a fit check before anything is collected,
//   - short prose prompts instead of a long taxonomy of chips,
//   - whatever the advisor left vague becomes an explicit, visible assumption
//     rather than another question,
//   - editing any source answer invalidates the accepted assumptions.
// Kept out of the component so all of it can be tested on its own.

export const WHO_TRAVELS = [
  { value: "community", label: "A community or club group", help: "Members who travel together and someone who leads them." },
  { value: "organization", label: "A company, school or organization", help: "A team, a class, an alumni or staff group." },
  { value: "family", label: "A family group", help: "One family or several travelling together." },
  { value: "individual", label: "One or two travellers", help: "No group and no requirement list." },
] as const;

export type Lane = "community" | "organization" | "family" | "individual" | "";

export const GUARDRAILS = [
  "Steep paths or stair-heavy days",
  "Very early starts",
  "Long coach drives",
  "A packed schedule",
  "Adventure or extreme sports",
  "Nightlife-led evenings",
  "Changing hotels often",
  "Alcohol-led days",
  "Heat or high altitude",
  "Long walks on uneven ground",
] as const;

export type Profile = {
  lane?: Lane;
  groupStory?: string;
  goodDay?: string;
  placeStory?: string;
  boundaries?: string;
  guardrails: string[];
  groupType?: string;
  ages?: string;
  rooms?: string;
  needs: string[];
  interests: string[];
  pace?: string;
  setting?: string;
  styles: string[];
  dateFlexibility?: string;
  budgetBand?: string;
  budgetCurrency?: string;
  budgetCovers: string[];
  assumptions?: string[];
  assumptionsAccepted?: boolean;
};

export function emptyProfile(): Profile {
  return { guardrails: [], needs: [], interests: [], styles: [], budgetCovers: [] };
}

// Answers arrive as prose in some places and as chosen chips in others, so the
// same test has to read either.
const has = (value: string | string[] | undefined, pattern: string | RegExp) => {
  const text = (
    Array.isArray(value) ? value.join(" ") : (value ?? "")
  ).toLowerCase();
  return typeof pattern === "string" ? text.includes(pattern) : pattern.test(text);
};

// What the engine will assume, because the advisor did not say it. Each one is
// shown before saving, and every one is a line a supplier prices against.
export function pricingAssumptions(profile: Profile, travellers: number) {
  const assumptions: string[] = [];
  if (!profile.dateFlexibility || profile.dateFlexibility === "Still deciding")
    assumptions.push(
      "Hold the dates shown as the working dates and price a one-day move either side.",
    );
  if (!profile.rooms || profile.rooms === "Not decided yet")
    assumptions.push(
      "Price shared twin rooms per person and quote the single supplement separately. Exact room counts stay open until booking.",
    );
  if (!profile.budgetBand || profile.budgetBand === "Prefer not to say yet")
    assumptions.push(
      "No budget band was given, so ask for the operator's indicative price before any inclusions are added.",
    );
  else if (profile.budgetBand === "Under 1,500 per person")
    assumptions.push(
      "Treat the stated band as a real ceiling rather than a target, and expect the operator to say so if it cannot be met.",
    );
  if (!profile.budgetCovers.length)
    assumptions.push(
      "Quote land only with one shared transfer window, and price private transfers separately.",
    );
  else if (profile.budgetCovers.includes("Flights"))
    assumptions.push(
      "The operator prices land only; the air portion is separated from the group's total budget.",
    );
  else if (!profile.budgetCovers.includes("Transfers"))
    assumptions.push(
      "Include one shared transfer window from the operator's recommended arrival point and price private transfers separately.",
    );
  if (profile.needs.some((need) => /step-free|accessible|limited walking/i.test(need)))
    assumptions.push(
      "Price step-free accommodation without a supplement where it exists; flag any hotel that cannot provide it rather than substituting silently.",
    );
  if (profile.needs.some((need) => /dietary/i.test(need)))
    assumptions.push(
      "Price vegetarian, vegan and gluten-aware meals without a supplement where feasible and flag every exception. The exact roster follows before booking.",
    );
  if (travellers > 0)
    assumptions.push(
      `Price the group twice: at ${travellers} travellers and at the group's realistic maximum, so a change in numbers does not break the quote.`,
    );
  assumptions.push(
    "The proposal must state deposit, release and cancellation deadlines. The group's own decision date stays open until then.",
  );
  return assumptions;
}

// Deliberately not pricing blockers: a supplier can quote without these, and
// saying so keeps the brief honest about what is known.
export function bookingOpenItems(profile: Profile) {
  const items = ["Final headcount and the room split by name"];
  if (has(profile.boundaries, /diet|allerg|food/)) items.push("Dietary and allergy roster");
  if (has(profile.groupStory, /wheel|mobility|limited walking|step.free/))
    items.push("Which travellers need step-free access, confirmed with them");
  items.push("Arrival times, and the group's own sign-off date");
  return items;
}

// What every supplier is asked to return, so two quotes are comparable without
// a second round of email.
export function supplierMustReturn(travellers: number) {
  return [
    `A price for ${travellers || "the stated"} travellers, and for the group's realistic maximum.`,
    "Inclusions, exclusions, taxes, the single supplement and any group-leader policy.",
    "The arrival point and transfer basis used.",
    "Each requirement marked met, partly met, or unavailable, in the supplier's own words.",
    "Deposit, room-release, payment and cancellation terms.",
    "Anything the supplier thinks is tiring, impractical or seasonally weak, said plainly.",
  ];
}

export function isIndividualLane(lane: Lane) {
  return lane === "individual";
}

export function laneProblem(profile: Profile) {
  if (!profile.lane) return "Choose who is travelling.";
  if (isIndividualLane(profile.lane))
    return "This is a group tool. One or two travellers have no requirement list for suppliers to quote against.";
  return "";
}

// The requirements a supplier answers, built from the answers above.
export function suggestRequirements(profile: Profile, travellers: number) {
  const list: string[] = [];
  if (has(profile.needs, "step-free")) list.push("Step-free or accessible guest rooms");
  if (has(profile.needs, "dietary")) list.push("Meals that meet the group's dietary requirements");
  if (has(profile.needs, "quiet")) list.push("Rooms away from bars, lifts or roads");
  if (has(profile.needs, "late arrivals")) list.push("A late arrival the first evening");
  if (has(profile.needs, "limited walking")) list.push("Walking kept short, with transport available");
  if (travellers > 0) list.push(`Rooming for ${travellers} people as one group`);
  if (profile.interests.includes("Food and wine")) list.push("One group meal built around local food");
  if (profile.interests.includes("History")) list.push("A guided history element");
  if (profile.interests.includes("Wellness and spa")) list.push("Access to a pool, spa or similar");
  if (has(profile.interests, "walking")) list.push("At least one walk or outdoor day");
  if (profile.styles.includes("Private transfers")) list.push("A private group transfer from the arrival point");
  if (profile.pace === "Relaxed") list.push("No more than one fixed activity per day");
  for (const guardrail of profile.guardrails)
    list.push(`Avoid: ${guardrail.toLowerCase()}`);
  if (profile.budgetCovers.includes("Accommodation")) list.push("Accommodation priced as part of the quote");
  if (profile.budgetCovers.includes("Meals")) list.push("Breakfast included, and state what else is");
  if (!list.length) list.push("A written quote covering the dates and the group size");
  return list.join("\n");
}

// Answers that are too thin to price against are caught here rather than in a
// phone call later.
export function validateIntake(
  draft: {
    destination: string;
    startDate: string;
    endDate: string;
    travellers: number;
    profile: Profile;
  },
) {
  const errors: string[] = [];
  const lane = laneProblem(draft.profile);
  if (lane) errors.push(lane);
  if (!draft.destination.trim()) errors.push("Say where the group is going, or that the destination is open.");
  if (!draft.startDate || !draft.endDate)
    errors.push("Pick the arrival and departure days on the calendar.");
  if (!Number.isInteger(draft.travellers) || draft.travellers < 3)
    errors.push("Give the group size. This tool starts at three travellers.");
  if ((draft.profile.groupStory ?? "").trim().length < 20)
    errors.push("Describe the group in a sentence or two: who they are, roughly how many, and who leads them.");
  if ((draft.profile.goodDay ?? "").trim().length < 20)
    errors.push("Describe what a good day on this trip looks like.");
  if (draft.profile.assumptionsAccepted !== true)
    errors.push("Accept the visible pricing assumptions, or go back and replace them with real detail.");
  return errors;
}
