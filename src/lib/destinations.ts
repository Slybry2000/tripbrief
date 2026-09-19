import type { Destination, TripRequest } from "./types";
import { calculateDestinationMatch } from "./matching";

// A row as Convex lists it: only what the workspace itself brings, because the
// starter catalog is reference data this file merges in.
export type DestinationListing = {
  slug: string;
  name: string;
  country: string;
  source: "network" | "added";
  strengths: string[];
  operatorCount: number;
  // What published sources say about a place the advisor looked up.
  profile?: {
    name: string;
    country: string;
    description: string;
    climates: string[];
    experienceStrengths: Record<string, number>;
    watchOuts: string[];
    sources: { title: string; url: string }[];
    researchedAt: number;
  };
};

export type DestinationEntry = Destination & {
  fromNetwork: boolean;
  addedByYou: boolean;
  operatorCount: number;
  // The published pages a looked-up place's profile was read from.
  sources?: { title: string; url: string }[];
};

// An assessment is what makes a place scoreable against a brief. Without one the
// page says so instead of printing 0% fit, which would read as a judgement
// nobody made.
export function isAssessed(entry: DestinationEntry) {
  return Object.keys(entry.experienceStrengths).length > 0;
}

export function mergeDestinations(
  catalog: Destination[],
  listed: DestinationListing[],
): DestinationEntry[] {
  const merged = new Map<string, DestinationEntry>();
  for (const item of catalog)
    merged.set(item.id, {
      ...item,
      fromNetwork: false,
      addedByYou: false,
      operatorCount: 0,
    });
  for (const row of listed) {
    const known = merged.get(row.slug);
    merged.set(row.slug, {
      id: row.slug,
      // The catalog knows a place better than its slug does.
      name: known?.name ?? row.name,
      country: known?.country ?? row.country,
      // A place the advisor looked up is described by the sources it was read
      // from, which the card names, so that profile wins over the catalog's. An
      // older addition carries only the advisor's own ticks, counted as strong.
      climates: row.profile?.climates ?? known?.climates ?? [],
      experienceStrengths:
        row.profile?.experienceStrengths ??
        known?.experienceStrengths ??
        Object.fromEntries(row.strengths.map((key) => [key, 5])),
      description: row.profile?.description ?? known?.description ?? "",
      watchOuts: row.profile?.watchOuts ?? known?.watchOuts ?? [],
      ...(row.profile ? { sources: row.profile.sources } : {}),
      fromNetwork: row.source === "network" || row.operatorCount > 0,
      addedByYou: row.source === "added",
      operatorCount: row.operatorCount,
    });
  }
  return [...merged.values()];
}

// Assessed places first, best fit down; then the ones nobody has assessed, with
// the places the network already covers above the rest.
export function rankDestinations(
  request: TripRequest,
  entries: DestinationEntry[],
) {
  return entries
    .map((destination) => ({
      destination,
      score: isAssessed(destination)
        ? calculateDestinationMatch(request, destination)
        : 0,
    }))
    .sort((a, b) => {
      const assessed =
        Number(isAssessed(b.destination)) - Number(isAssessed(a.destination));
      if (assessed !== 0) return assessed;
      if (b.score !== a.score) return b.score - a.score;
      if (b.destination.operatorCount !== a.destination.operatorCount)
        return b.destination.operatorCount - a.destination.operatorCount;
      return a.destination.name.localeCompare(b.destination.name);
    });
}
