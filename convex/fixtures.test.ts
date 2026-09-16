// Shared fixtures for the backend tests.
//
// Named `*.test.ts` on purpose: Convex ignores test files when it deploys, so a
// fixture that only tests use never becomes part of the running backend. The brief
// here is complete — every field the schema requires, filled as an advisor would
// fill it — because a fixture that leaves fields out would hide exactly the class
// of problem the requirements work is about.
export const demoBrief = {
  name: "Wellness Escape",
  evaluationDate: "2027-05-23",
  travelMonth: "October",
  travelerCount: 16,
  minimumViableTravelers: 12,
  confirmedTravelers: 8,
  nights: 7,
  earliestDepartureDate: "2027-10-10",
  preferredDepartureDate: "2027-10-15",
  latestDepartureDate: "2027-10-25",
  flexibleDates: true,
  proposalDecisionDate: "2027-06-10",
  targetRetailPricePerPerson: 3500,
  flightsIncluded: false,
  experienceLevel: 2,
  pace: "relaxed",
  climates: ["warm"],
  desiredExperiences: ["yoga", "meditation", "spa", "healthy_food", "beach", "culture"],
  importantRequirements: [
    "low_physical_difficulty",
    "private_transportation",
    "strong_wellness_focus",
  ],
  travelerTypes: ["private_groups"],
  transportationNeeds: ["private_transportation", "airport_transfers"],
  accessibilityNeeds: ["low_mobility_options"],
  notes: "A fictional private wellness group.",
  groupDescription: "A friendship group of returning clients who book together once a year.",
  ages: "48 to 67",
  rooms: "8 twin rooms, 2 singles, no triples.",
  dietaryAndMedical: "Two gluten-free, one who cannot manage stairs.",
  dateFirmness: "Fixed to the second week of October.",
  budgetBasis: "land only, per person, excluding international flights",
  guestOrigin: "Seattle and Vancouver, arriving on different flights.",
  dayShape: "One main activity a day, a long lunch, the late afternoon free.",
  inclusionsExpected: ["airport_transfers", "private_transportation", "breakfast_daily"],
  hardNos: ["no start before 9am", "no hotel without a pool"],
};
