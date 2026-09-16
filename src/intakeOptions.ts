// Pure intake logic, kept out of the component file so it can be tested and
// imported without pulling React into the test environment.
export type Profile = {
  groupType?: string;
  ages?: string;
  rooms?: string;
  needs: string[];
  interests: string[];
  pace?: string;
  setting?: string;
  styles: string[];
  mustDo?: string;
  dateFlexibility?: string;
  budgetBand?: string;
  budgetCurrency?: string;
  budgetCovers: string[];
};

// Suggestions are built from the answers, so the advisor edits a starting point
// instead of an empty box. Every one is something a supplier can answer.
export function suggestRequirements(profile: Profile, travelers: number) {
  const list: string[] = [];
  const has = (values: string[], needle: string) =>
    values.some((value) => value.toLowerCase().includes(needle));
  if (has(profile.needs, "step-free")) list.push("Step-free or accessible guest rooms");
  if (has(profile.needs, "dietary")) list.push("Meals that meet the group's dietary requirements");
  if (has(profile.needs, "quiet")) list.push("Rooms away from bars, lifts or roads");
  if (has(profile.needs, "late arrivals")) list.push("A late arrival the first evening");
  if (has(profile.needs, "limited walking")) list.push("Walking kept short, with transport available");
  if (travelers > 0) list.push(`Rooming for ${travelers} people as one group`);
  if (profile.interests.includes("Food and wine")) list.push("One group meal built around local food");
  if (profile.interests.includes("History")) list.push("A guided history element");
  if (profile.interests.includes("Wellness and spa")) list.push("Access to a pool, spa or similar");
  if (has(profile.interests, "walking")) list.push("At least one walk or outdoor day");
  if (profile.styles.includes("Private transfers")) list.push("A private group transfer from the arrival point");
  if (profile.pace === "Relaxed") list.push("No more than one fixed activity per day");
  if (profile.budgetCovers.includes("Accommodation")) list.push("Accommodation priced as part of the quote");
  if (profile.budgetCovers.includes("Meals")) list.push("Breakfast included, and state what else is");
  if (!list.length) list.push("A written quote covering the dates and the group size");
  return list.join("\n");
}
