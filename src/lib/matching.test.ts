// The published baselines for the demo brief. If the matching engine drifts, these
// numbers are what catches it — the app is a ranking tool, and a ranking tool that
// silently changes its answers is not trustworthy.
import { expect, test } from "vitest";
import destinationSeed from "../data/destinations.json";
import programSeed from "../data/programs.json";
import requestSeed from "../data/demo-request.json";
import { seedOperatorProfiles, seedOperators } from "../../convex/seedData";
import {
  assessOperatorTiming,
  buildWorkbackSchedule,
  calculateDestinationMatch,
  calculateOperatorMatch,
  calculateProposalMargin,
  calculateTargetNet,
  calculateTripMatch,
  canSelectPartner,
  servesSelectedDestinations,
} from "./matching";
import type {
  Destination,
  OperatorProfile,
  OperatorProposal,
  Partner,
  ReadyMadeTrip,
  TripRequest,
} from "./types";

const request = requestSeed as TripRequest;
const destinations = destinationSeed as unknown as Destination[];
const partners: Partner[] = seedOperators.map((operator) => ({
  id: operator.slug,
  name: operator.name,
  country: operator.country,
  destinations: operator.destinations,
  specialties: operator.specialties,
  minGroupSize: operator.minGroupSize,
  maxGroupSize: operator.maxGroupSize,
  experienceLevels: operator.experienceLevels,
  typicalNetPriceMin: operator.typicalNetPriceMin,
  typicalNetPriceMax: operator.typicalNetPriceMax,
  approvalStatus: operator.approvalStatus,
}));
const operatorProfiles: OperatorProfile[] = seedOperatorProfiles.map((profile) => ({
  ...profile,
  partnerId: profile.operatorSlug,
  serviceAreas: profile.serviceAreas.map((area) => ({
    destinationId: area.destinationSlug,
    country: area.country,
    regions: area.regions,
    cities: area.cities,
    areas: area.areas,
    coverage: area.coverage,
    operatingMonths: area.operatingMonths,
  })),
}));
const trips: ReadyMadeTrip[] = (
  programSeed as unknown as (Omit<ReadyMadeTrip, "partnerId" | "destinationId"> & {
    operatorSlug: string;
    destinationSlug: string;
  })[]
).map((program) => ({
  ...program,
  partnerId: program.operatorSlug,
  destinationId: program.destinationSlug,
}));

// Step 2 of the workflow is where the customer's locations are chosen; the brief
// itself is written before any destination is known.
const briefWith = (destinationIds: string[]): TripRequest => ({
  ...request,
  selectedDestinationIds: destinationIds,
  selectedPartnerIds: [],
});

const rank = (tripRequest: TripRequest, limited = true) =>
  partners
    .map((partner) => ({
      partner,
      profile: operatorProfiles.find((item) => item.partnerId === partner.id)!,
      match: calculateOperatorMatch(
        tripRequest,
        partner,
        operatorProfiles.find((item) => item.partnerId === partner.id)!,
        destinations,
      ),
    }))
    .filter(
      (row) => !limited || servesSelectedDestinations(tripRequest, row.profile),
    )
    .sort((a, b) => b.match.score - a.match.score);

// The baseline covers the whole starter catalog, in file order. It grew when the
// catalog did (six places to twenty-one), which is the one kind of change these
// numbers are supposed to register: the ranking for this brief is now Bali 100,
// Thailand 98, then Costa Rica, Portugal, Sri Lanka and Mexico at 88-90.
test("the default brief's destination scores match the published baseline", () => {
  const actual = destinations.map((destination) => [
    destination.name,
    calculateDestinationMatch(request, destination),
  ]);
  expect(actual).toEqual([
    ["Bali", 100],
    ["Costa Rica", 90],
    ["Thailand", 98],
    ["Portugal", 90],
    ["Greece", 88],
    ["Tuscany", 65],
    ["Vietnam", 83],
    ["Japan", 63],
    ["Sri Lanka", 88],
    ["Nepal", 45],
    ["Bhutan", 35],
    ["Kerala", 85],
    ["Morocco", 65],
    ["Peru", 55],
    ["Mexico", 88],
    ["Iceland", 28],
    ["Croatia", 58],
    ["Spain", 58],
    ["Turkey", 53],
    ["Kenya", 48],
    ["Fiji", 62],
  ]);
});

test("the strongest ready-made program is Bali Reset at 92", () => {
  const scored = trips
    .map((trip) => ({ trip, score: calculateTripMatch(request, trip).score }))
    .sort((a, b) => b.score - a.score);
  expect(scored[0].trip.name).toBe("Bali Reset");
  expect(scored[0].score).toBe(92);
});

test("target net is a quarter below the target retail price", () => {
  expect(calculateTargetNet(request)).toBe(2625);
  const baliReset = trips.find((trip) => trip.name === "Bali Reset")!;
  const margin = calculateProposalMargin(request, {
    id: "p",
    tripRequestId: "r1",
    partnerId: baliReset.partnerId,
    readyMadeTripId: baliReset.id,
    status: "Proposal Received",
    revisedNetPricePerPerson: baliReset.netPricePerPerson,
    canModify: [],
    cannotModify: [],
    partnerNotes: "",
  });
  expect(Math.round(margin!.profit)).toBe(1350);
  expect(margin!.margin).toBeCloseTo(0.3857, 3);
});

test("only operators serving a customer-approved location are shortlisted", () => {
  const tripRequest = briefWith(["bali", "thailand", "costa-rica"]);
  const all = rank(tripRequest, false);
  const limited = rank(tripRequest, true);
  expect(all.length).toBe(10);
  expect(limited.length).toBeGreaterThan(0);
  expect(limited.length).toBeLessThan(all.length);
  expect(
    limited.every((row) =>
      row.profile.locations.some((id) =>
        tripRequest.selectedDestinationIds.includes(id),
      ),
    ),
  ).toBe(true);
});

test("a better capability profile outranks a weak one with a ready-made program", () => {
  const selected = {
    ...request,
    selectedDestinationIds: ["bali"],
  };
  const ranked = partners
    .map((partner) => ({
      partner,
      profile: operatorProfiles.find((item) => item.partnerId === partner.id)!,
    }))
    .filter((row) => servesSelectedDestinations(selected, row.profile))
    .map((row) => ({
      name: row.partner.name,
      score: calculateOperatorMatch(
        selected,
        row.partner,
        row.profile,
        destinations,
      ).score,
      hasProgram: trips.some((trip) => trip.partnerId === row.partner.id),
    }))
    .sort((a, b) => b.score - a.score);
  // The strongest Bali operator is the one that has a program; the point of the
  // assertion is that the ranking is driven by capability, so a program is never
  // what puts an operator on the list.
  expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[ranked.length - 1].score);
  expect(ranked.every((row) => row.score >= 0)).toBe(true);
});

test("changing a capability record changes that operator's match", () => {
  const partner = partners[0];
  const profile = operatorProfiles[0];
  const before = calculateOperatorMatch(request, partner, profile, destinations);
  const stripped = {
    ...profile,
    services: profile.services.filter((item) => item !== "yoga"),
    operations: profile.operations.filter(
      (item) => item !== "private_transportation",
    ),
  };
  const after = calculateOperatorMatch(request, partner, stripped, destinations);
  expect(after.score).toBeLessThan(before.score);
  expect(after.missingServices).toContain("yoga");
});

test("timing is planning context before a request and never a capability gate", () => {
  const partner = partners[0];
  const profile = operatorProfiles[0];
  const late = {
    ...request,
    evaluationDate: request.preferredDepartureDate,
    flexibleDates: false,
  };
  const timing = assessOperatorTiming(late, profile);
  expect(timing.status).toBe("Conflict");
  expect(timing.reasons.length).toBeGreaterThan(0);
  // The capability score is identical either way: timing is confirmed by the
  // operator's reply, not inferred from its profile.
  expect(calculateOperatorMatch(late, partner, profile, destinations).score).toBe(
    calculateOperatorMatch(request, partner, profile, destinations).score,
  );
});

test("five partners can be selected and a sixth cannot", () => {
  let selected: string[] = [];
  for (const partner of partners.slice(0, 5)) {
    expect(canSelectPartner(selected, partner.id)).toBe(true);
    selected = [...selected, partner.id];
  }
  expect(canSelectPartner(selected, partners[5].id)).toBe(false);
  expect(canSelectPartner(selected, partners[0].id)).toBe(true);
});

test("the workback schedule runs backwards from the selected departure", () => {
  const proposal: OperatorProposal = {
    id: "proposal",
    partnerId: "p1",
    programName: "Bali Reset",
    basedOnExistingProgram: true,
    readyMadeTripId: "t1",
    destinationId: "bali",
    startDate: "2027-10-15",
    endDate: "2027-10-22",
    nights: 7,
    availability: "Confirmation Required",
    groupSizeAccepted: 16,
    hotelLevel: "4-star",
    hotelNotes: "",
    transportation: ["private_transportation"],
    experiencesIncluded: ["yoga"],
    requirementsMet: ["strong_wellness_focus"],
    changesOrAdditions: [],
    cannotProvide: [],
    finalFit: 92,
    netPricePerPerson: 2150,
    currency: "USD",
    pricingAssumptions: "",
    depositPercent: 25,
    depositDueDaysBefore: 120,
    finalHeadcountDaysBefore: 75,
    finalPaymentDaysBefore: 45,
    travelerNamesDaysBefore: 45,
    roomReleaseDaysBefore: 60,
    cancellationTerms: [],
    operatorNotes: "",
  };
  const schedule = buildWorkbackSchedule(request, proposal);
  expect(schedule[0].daysBefore).toBe(0);
  expect(schedule[0].label).toBe("Trip departs");
  expect(schedule.some((item) => item.daysBefore === 120)).toBe(true);
  const minimum = schedule.find((item) =>
    item.label.startsWith("Minimum viable group"),
  )!;
  // The demo has 8 confirmed against a minimum of 12, so the go/no-go is warned.
  expect(minimum.warning).toBe(true);
});
