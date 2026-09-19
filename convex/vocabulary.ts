// The fixed vocabulary a brief and a capability record are written in. The
// interface carries the same lists; the server needs them to constrain what a
// model may say about a place or an operator, so nothing outside them is stored.

export const EXPERIENCES = [
  "wellness", "yoga", "meditation", "spa", "fitness", "hiking", "adventure",
  "light_adventure", "beach", "nature", "wildlife", "culture", "history",
  "healthy_food", "cooking", "wine", "golf", "luxury", "family_travel",
  "multigenerational_travel", "religious_travel", "educational_travel",
  "retreats", "corporate_groups", "private_group_experiences",
];

export const OPERATIONS = [
  "private_transportation", "shared_transportation", "airport_transfers",
  "private_guides", "shared_guides", "multilingual_guides",
  "accessible_transportation", "low_mobility_options", "private_activities",
  "shared_activities", "luggage_handling", "meet_and_greet", "on_trip_support",
  "emergency_support", "custom_itinerary_building",
  // The brief's operating requirements, which an operator can also claim.
  "low_physical_difficulty", "mostly_private_experiences", "few_hotel_changes",
  "strong_wellness_focus", "strong_food_focus", "strong_cultural_focus",
];

export const TRAVELER_TYPES = [
  "adult_groups", "families", "multigenerational", "private_groups", "retreats",
  "corporate_groups", "educational_groups", "religious_groups",
];

export const HOTEL_TYPES = [
  "3-star", "4-star", "5-star_luxury", "luxury", "boutique_hotels",
  "private_villas", "resorts", "wellness_retreats", "eco_lodges",
  "specialty_accommodations",
];

export const CLIMATES = ["warm", "tropical", "mild", "cool"];

export const slugify = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
