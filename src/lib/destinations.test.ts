import { expect, test } from "vitest";
import type { Destination, TripRequest } from "./types";
import {
  mergeDestinations,
  rankDestinations,
  type DestinationListing,
} from "./destinations";
import requestSeed from "../data/demo-request.json";

const demo = requestSeed as TripRequest;

const catalog: Destination[] = [
  {
    id: "bali",
    name: "Bali",
    country: "Indonesia",
    climates: ["warm"],
    experienceStrengths: { yoga: 5, beach: 5 },
    description: "Wellness and beach.",
    watchOuts: [],
  },
];

const request: TripRequest = { ...demo, desiredExperiences: ["yoga"] };

test("a place the network covers keeps what the catalog knows about it", () => {
  const listed: DestinationListing[] = [
    {
      slug: "bali",
      name: "bali",
      country: "",
      source: "network",
      strengths: [],
      operatorCount: 2,
    },
  ];
  const [entry] = mergeDestinations(catalog, listed);
  expect(entry.name).toBe("Bali");
  expect(entry.operatorCount).toBe(2);
  expect(entry.fromNetwork).toBe(true);
  expect(entry.experienceStrengths).toMatchObject({ yoga: 5 });
});

test("a place nobody has assessed is ranked below one that scores, not scored zero", () => {
  const listed: DestinationListing[] = [
    {
      slug: "vietnam",
      name: "Vietnam",
      country: "Vietnam",
      source: "network",
      strengths: [],
      operatorCount: 1,
    },
  ];
  const ranked = rankDestinations(request, mergeDestinations(catalog, listed));
  expect(ranked.map((row) => row.destination.name)).toEqual([
    "Bali",
    "Vietnam",
  ]);
  expect(ranked[0].score).toBeGreaterThan(0);
});

test("an advisor's own assessment makes a place they added scoreable", () => {
  const listed: DestinationListing[] = [
    {
      slug: "vietnam",
      name: "Vietnam",
      country: "Vietnam",
      source: "added",
      strengths: ["yoga", "beach"],
      operatorCount: 0,
    },
  ];
  const ranked = rankDestinations(request, mergeDestinations(catalog, listed));
  const vietnam = ranked.find((row) => row.destination.name === "Vietnam")!;
  expect(vietnam.destination.addedByYou).toBe(true);
  expect(vietnam.score).toBeGreaterThan(0);
});
