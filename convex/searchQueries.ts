import type { Doc } from "./_generated/dataModel";

type TripForSearch = Pick<Doc<"trips">, "destination" | "travelers" | "profile">;

// The search is the brief's, not the advisor's: these are built from what the
// intake already knows. Kept pure so the wording can be tested, and used as the
// fallback whenever the model is unavailable.
export function buildQueries(trip: TripForSearch) {
  const place = trip.destination.trim();
  const profile = trip.profile;
  const queries: string[] = [];
  const add = (value: string) => {
    const query = value.replace(/\s+/g, " ").trim().slice(0, 300);
    if (query.length >= 3 && !queries.includes(query)) queries.push(query);
  };

  add(`${place} group travel operator ${profile?.groupType ?? ""}`);

  // What a group *needs* is searched for before what they like: an accessible
  // hotel is a harder constraint than a second interest.
  const needs = (profile?.needs ?? []).join(" ").toLowerCase();
  if (/step-free|accessible|limited walking/.test(needs))
    add(`${place} accessible group accommodation step-free`);
  if (/dietary/.test(needs))
    add(`${place} group accommodation dietary requirements`);

  for (const interest of (profile?.interests ?? []).slice(0, 2))
    add(`${place} ${interest.toLowerCase()} group tours`);

  const setting = (profile?.setting ?? "").toLowerCase();
  if (setting && setting !== "a mix") add(`${place} ${setting} group itinerary`);

  if (queries.length < 2 && trip.travelers > 0)
    add(`${place} hotels for groups of ${trip.travelers}`);

  return queries.slice(0, 3);
}

// What the model is asked to improve on, in one place so the prompt and the
// fallback cannot drift apart.
export function queryPrompt(trip: TripForSearch) {
  const profile = trip.profile;
  const facts = [
    `Destination: ${trip.destination}`,
    profile?.groupType ? `Group: ${profile.groupType}` : "",
    profile?.ages ? `Ages: ${profile.ages}` : "",
    trip.travelers ? `Travellers: ${trip.travelers}` : "",
    profile?.interests?.length ? `Interests: ${profile.interests.join(", ")}` : "",
    profile?.needs?.length ? `Needs: ${profile.needs.join(", ")}` : "",
    profile?.pace ? `Pace: ${profile.pace}` : "",
    profile?.setting ? `Setting: ${profile.setting}` : "",
    profile?.styles?.length ? `How it should run: ${profile.styles.join(", ")}` : "",
    profile?.guardrails?.length ? `Must avoid: ${profile.guardrails.join(", ")}` : "",
  ].filter(Boolean);
  return [
    "Write web search queries that will find travel suppliers who can quote for this group trip.",
    "The searcher is looking for real operator, hotel and destination-management websites that publish group trips or group accommodation for this destination.",
    "Return between one and three queries. Each must be a short web search string, not a sentence.",
    "Name the destination, and use the group's interests and needs to make the query specific.",
    "Never include a budget, a price, a traveller's name or any personal detail.",
    "",
    ...facts,
  ].join("\n");
}
