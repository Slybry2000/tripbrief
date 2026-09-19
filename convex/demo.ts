import { env } from "./_generated/server";

// Demo mode is the default: it is on unless DEMO_MODE is exactly "off". In demo
// mode no request reaches a real operator. It is sent from a shared agency inbox
// to a stand-in inbox, and a model answers as the operator. The real operator's
// published address is shown, and never written to.
export function demoMode() {
  const flag = (env.DEMO_MODE ?? "").trim().toLowerCase();
  return {
    on: flag !== "off",
    agencyInbox: (env.DEMO_AGENCY_INBOX ?? "").trim().toLowerCase(),
    operatorInbox: (env.DEMO_OPERATOR_INBOX ?? "").trim().toLowerCase(),
  };
}

// Deterministic "random": the same operator on the same brief always gets the
// same story, so a demo can be re-run and explained.
export function seeded(text: string) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return () => {
    hash = Math.imul(hash ^ (hash >>> 15), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    return ((hash ^= hash >>> 16) >>> 0) / 4294967296;
  };
}

// The ways a real operator's answer commonly differs from a brief. A "close"
// operator gets one or two of these, and only for requirements the brief has.
export const DEVIATIONS: { key: string; instruction: string }[] = [
  { key: "dates", instruction: "You cannot hold the preferred departure; offer dates two to four days later, still inside or just outside the window, and say why (a festival, hotel availability)." },
  { key: "rooms", instruction: "You can hold the twin rooms but singles are limited: offer one single, or both at a supplement, and say so plainly." },
  { key: "budget", instruction: "Your net comes in 8 to 14 percent above the agency's target net because of peak-season hotel rates; say what could be removed to meet it." },
  { key: "inclusionsExpected", instruction: "One of the expected inclusions (pick a realistic one, such as a group dinner or entrance fees) is not in your price and is quoted as an extra." },
  { key: "experienceLevel", instruction: "One night of the trip has to be at a lower hotel standard than requested because of the location; say which and why." },
  { key: "accessibilityNeeds", instruction: "Part of one day involves stairs or uneven ground that you cannot fully avoid; offer the alternative you would arrange." },
  { key: "dayShape", instruction: "Two days need an early start (before the preferred time) because of transfer times; say which days and why." },
];

export function pickDeviations(seed: string, keys: string[], count: number) {
  const random = seeded(seed);
  const pool = DEVIATIONS.filter((item) => keys.includes(item.key));
  const chosen: typeof DEVIATIONS = [];
  while (chosen.length < count && pool.length) {
    chosen.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  }
  return chosen;
}
