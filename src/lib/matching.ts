import type { Destination, OperatorMatch, OperatorProfile, OperatorProposal, Partner, Proposal, ReadyMadeTrip, TimingAssessment, TripMatch, TripRequest, WorkbackItem } from "./types";

function roundHalfToEven(value: number) {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (Math.abs(fraction - 0.5) < 1e-9) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(value);
}

const toUtcDate = (value: string) => new Date(`${value}T00:00:00Z`);
const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.floor((toUtcDate(to).getTime() - toUtcDate(from).getTime()) / 86400000);
const addDays = (value: string, days: number) => {
  const date = toUtcDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
};
const percent = (matched: number, total: number) => total ? Math.round((matched / total) * 100) : 100;

// The agency quotes its client a retail price and asks operators for a net a
// quarter below it. On the operator's side only the net is known, and it is used
// as given.
export const calculateTargetNet = (request: TripRequest) =>
  request.targetNetPerPerson && request.targetNetPerPerson > 0
    ? request.targetNetPerPerson
    : request.targetRetailPricePerPerson * 0.75;

export function getMatchedExperiences(request: TripRequest, trip: ReadyMadeTrip) {
  return request.desiredExperiences.filter((item) => trip.experiences.includes(item));
}

export function getMissingExperiences(request: TripRequest, trip: ReadyMadeTrip) {
  return request.desiredExperiences.filter((item) => !trip.experiences.includes(item));
}

export function getHardMismatchFlags(request: TripRequest, trip: ReadyMadeTrip) {
  const flags: string[] = [];
  const targetNet = calculateTargetNet(request);
  if (request.travelerCount < trip.minGroupSize || request.travelerCount > trip.maxGroupSize) flags.push(`Group size supports ${trip.minGroupSize}–${trip.maxGroupSize} travelers`);
  if (trip.netPricePerPerson > targetNet * 1.2) flags.push("Net price is more than 20% above target net");
  if (trip.experienceLevel < request.experienceLevel) flags.push("Experience level is below request");
  if (request.importantRequirements.includes("low_physical_difficulty") && trip.pace === "active") flags.push("Active pace conflicts with low physical difficulty");
  if (Math.abs(trip.nights - request.nights) > 2) flags.push("Trip length differs by more than 2 nights");
  return flags;
}

export function calculateTripMatch(request: TripRequest, trip: ReadyMadeTrip): TripMatch {
  const matchedExperiences = getMatchedExperiences(request, trip);
  const missingExperiences = getMissingExperiences(request, trip);
  const matchedRequirements = request.importantRequirements.filter((item) => trip.requirementsSupported.includes(item));
  const missingRequirements = request.importantRequirements.filter((item) => !trip.requirementsSupported.includes(item));
  let score = request.desiredExperiences.length ? matchedExperiences.length * (60 / request.desiredExperiences.length) : 0;
  score += request.importantRequirements.length ? matchedRequirements.length * (20 / request.importantRequirements.length) : 0;
  const targetNet = calculateTargetNet(request);
  if (trip.netPricePerPerson <= targetNet) score += 10;
  else if (trip.netPricePerPerson <= targetNet * 1.1) score += 5;
  if (request.travelerCount >= trip.minGroupSize && request.travelerCount <= trip.maxGroupSize) score += 5;
  if (trip.experienceLevel >= request.experienceLevel) score += 5;
  return { score: roundHalfToEven(Math.min(100, Math.max(0, score))), matchedExperiences, missingExperiences, matchedRequirements, missingRequirements, hardMismatchFlags: getHardMismatchFlags(request, trip) };
}

export function calculateDestinationMatch(request: TripRequest, destination: Destination) {
  if (!request.desiredExperiences.length) return 0;
  const points = request.desiredExperiences.reduce((sum, item) => sum + (destination.experienceStrengths[item] ?? 0), 0);
  let score = (points / (request.desiredExperiences.length * 5)) * 100;
  if (request.climates.some((climate) => destination.climates.includes(climate))) score += 5;
  return Math.round(Math.min(100, score));
}

function isBlackout(date: string, profile: OperatorProfile) {
  return profile.timing.blackoutPeriods.some((period) => date >= period.start && date <= period.end);
}

function operatesOn(date: string, profile: OperatorProfile) {
  const month = toUtcDate(date).getUTCMonth() + 1;
  const monthWorks = profile.timing.yearRound || profile.timing.operatingMonths.includes(month) || profile.serviceAreas.some((area) => area.operatingMonths.includes(month));
  return monthWorks && !isBlackout(date, profile);
}

function findOperatingDate(request: TripRequest, profile: OperatorProfile) {
  if (operatesOn(request.preferredDepartureDate, profile)) return request.preferredDepartureDate;
  if (!request.flexibleDates) return request.preferredDepartureDate;
  const span = Math.max(0, Math.min(370, daysBetween(request.earliestDepartureDate, request.latestDepartureDate)));
  for (let offset = 0; offset <= span; offset += 1) {
    const candidate = addDays(request.earliestDepartureDate, offset);
    if (operatesOn(candidate, profile)) return candidate;
  }
  return request.preferredDepartureDate;
}

export function assessOperatorTiming(request: TripRequest, profile: OperatorProfile): TimingAssessment {
  const evaluatedDepartureDate = findOperatingDate(request, profile);
  const operatesForDates = operatesOn(evaluatedDepartureDate, profile);
  const daysRemaining = daysBetween(request.evaluationDate, evaluatedDepartureDate);
  const leadTimeWorks = daysRemaining >= profile.timing.minimumLeadTimeDays;
  const exceptionalLeadTimeWorks = daysRemaining >= profile.timing.shortestLeadTimeDays;
  const proposalReadyDate = addDays(request.evaluationDate, profile.timing.maximumProposalTurnaroundDays);
  const proposalDeadlineWorks = proposalReadyDate <= request.proposalDecisionDate;
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (!operatesForDates) reasons.push("Does not operate during the requested dates or a blackout overlaps the full window.");
  if (!exceptionalLeadTimeWorks) reasons.push(`Requires at least ${profile.timing.shortestLeadTimeDays} days even by exception; only ${daysRemaining} remain.`);
  else if (!leadTimeWorks) warnings.push(`Below the normal ${profile.timing.minimumLeadTimeDays}-day lead time; exception review required.`);
  if (!proposalDeadlineWorks) reasons.push(`Maximum ${profile.timing.maximumProposalTurnaroundDays}-day proposal turnaround would miss the agency's decision deadline.`);
  if (request.flexibleDates && evaluatedDepartureDate !== request.preferredDepartureDate && operatesForDates) warnings.push(`Preferred date conflicts, but ${evaluatedDepartureDate} works within the flexible window.`);

  const status = reasons.length ? "Conflict" : warnings.length ? "At Risk" : "Works";
  return { status, liveAvailability: "Confirmation Required", evaluatedDepartureDate, daysRemaining, operatesForDates, leadTimeWorks, proposalDeadlineWorks, reasons, warnings };
}

function commercialScore(request: TripRequest, profile: OperatorProfile) {
  const target = calculateTargetNet(request);
  const { typicalNetMin, typicalNetMax } = profile.commercial;
  if (target >= typicalNetMin && target <= typicalNetMax) return 100;
  const distance = target < typicalNetMin ? typicalNetMin - target : target - typicalNetMax;
  const ratio = distance / Math.max(target, 1);
  return ratio <= 0.1 ? 80 : ratio <= 0.2 ? 60 : ratio <= 0.35 ? 35 : 10;
}

export function calculateOperatorMatch(request: TripRequest, partner: Partner, profile: OperatorProfile, destinationList: Destination[]): OperatorMatch {
  const requestedOperations = [...new Set([...request.importantRequirements, ...request.transportationNeeds, ...request.accessibilityNeeds])];
  const supportedOperations = [...new Set([...profile.features, ...profile.operations])];
  const matchedServices = request.desiredExperiences.filter((item) => profile.services.includes(item));
  const missingServices = request.desiredExperiences.filter((item) => !profile.services.includes(item));
  const matchedOperations = requestedOperations.filter((item) => supportedOperations.includes(item));
  const missingOperations = requestedOperations.filter((item) => !supportedOperations.includes(item));
  const matchedFeatures = request.importantRequirements.filter((item) => supportedOperations.includes(item));
  const missingFeatures = request.importantRequirements.filter((item) => !supportedOperations.includes(item));
  const minGroupSize = profile.minGroupSize ?? partner.minGroupSize;
  const maxGroupSize = profile.maxGroupSize ?? partner.maxGroupSize;
  const groupSizeFit = request.travelerCount >= minGroupSize && request.travelerCount <= maxGroupSize;
  const requestedHotel = request.experienceLevel === 1 ? "3-star" : request.experienceLevel === 2 ? "4-star" : "5-star_luxury";
  const hotelFit = profile.hotelTypes.includes(requestedHotel);
  const locationsToScore = request.selectedDestinationIds.length ? profile.locations.filter((id) => request.selectedDestinationIds.includes(id)) : profile.locations;
  const locationScore = Math.max(0, ...locationsToScore.map((id) => {
    const destination = destinationList.find((item) => item.id === id);
    return destination ? calculateDestinationMatch(request, destination) : 0;
  }));
  const destinationFit = locationScore;
  const experienceFit = percent(matchedServices.length, request.desiredExperiences.length);
  const operationalFit = percent(matchedOperations.length, requestedOperations.length);
  const groupFit = groupSizeFit ? 100 : 0;
  const accommodationFit = hotelFit ? 100 : 0;
  const commercialFit = commercialScore(request, profile);
  const score = Math.round(destinationFit * 0.15 + experienceFit * 0.35 + operationalFit * 0.2 + groupFit * 0.1 + accommodationFit * 0.1 + commercialFit * 0.1);
  return { score, destinationFit, experienceFit, operationalFit, groupFit, accommodationFit, commercialFit, matchedServices, missingServices, matchedOperations, missingOperations, matchedFeatures, missingFeatures, groupSizeFit, hotelFit, locationScore, timing: assessOperatorTiming(request, profile) };
}

export function servesSelectedDestinations(request: TripRequest, profile: OperatorProfile) {
  return request.selectedDestinationIds.length > 0 && request.selectedDestinationIds.some((destinationId) => profile.locations.includes(destinationId));
}

export function calculateProposalMargin(request: TripRequest, proposal: Proposal | OperatorProposal) {
  const net = "netPricePerPerson" in proposal ? proposal.netPricePerPerson : proposal.revisedNetPricePerPerson;
  if (net === null) return null;
  // A margin is only meaningful against a known retail price in the same currency.
  if (!request.targetRetailPricePerPerson) return null;
  if ("currency" in proposal && proposal.currency && proposal.currency !== "USD") return null;
  const profit = request.targetRetailPricePerPerson - net;
  const margin = profit / request.targetRetailPricePerPerson;
  return { profit, margin };
}

// The operator's own deadlines are contractual and always shown. The agency's
// sales checkpoints are suggestions, so one that has already passed is left out
// rather than shown as a date nobody can meet. A deadline the proposal did not
// state (zero days) is not invented either.
export function buildWorkbackSchedule(
  request: TripRequest,
  proposal: OperatorProposal,
  today: string = new Date().toISOString().slice(0, 10),
): WorkbackItem[] {
  const departure = proposal.startDate;
  // Every date below is counted back from departure. Without a real one there is
  // nothing honest to show, and an invalid date must never take the page down.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(departure) || Number.isNaN(toUtcDate(departure).getTime()) || isoDate(toUtcDate(departure)) !== departure) return [];
  const create = (daysBefore: number, label: string, owner: WorkbackItem["owner"], category: WorkbackItem["category"], detail: string, warning = false): WorkbackItem => ({
    date: addDays(departure, -daysBefore), daysBefore, label, owner, category, detail, warning,
  });
  const halfTarget = Math.max(1, Math.ceil(request.minimumViableTravelers / 2));
  const twoThirdsTarget = Math.max(1, Math.ceil(request.minimumViableTravelers * 2 / 3));
  const minimumWarning = request.confirmedTravelers < request.minimumViableTravelers;
  const contractual: WorkbackItem[] = [
    create(0, "Trip departs", "Shared", "departure", `${request.travelerCount} target travelers`),
  ];
  const deadline = (daysBefore: number, item: () => WorkbackItem) => { if (daysBefore > 0) contractual.push(item()); };
  deadline(proposal.depositDueDaysBefore, () => create(proposal.depositDueDaysBefore, `Deposit to operator${proposal.depositPercent ? ` (${proposal.depositPercent}%)` : ""}`, "Agency", "operator", `${proposal.currency} deposit due under the selected proposal.`));
  deadline(proposal.travelerNamesDaysBefore, () => create(proposal.travelerNamesDaysBefore, "Final traveler names due", "Agency", "operator", "Submit the final rooming and traveler-name list."));
  deadline(proposal.finalPaymentDaysBefore, () => create(proposal.finalPaymentDaysBefore, "Final payment to operator", "Agency", "operator", `${proposal.currency} payment deadline under the selected proposal.`));
  deadline(proposal.roomReleaseDaysBefore, () => create(proposal.roomReleaseDaysBefore, "Unused rooms released", "Operator", "operator", "Uncommitted room inventory can return to the supplier."));
  deadline(proposal.finalHeadcountDaysBefore, () => create(proposal.finalHeadcountDaysBefore, "Final group count committed", "Shared", "operator", `Operator commitment based on the final ${request.minimumViableTravelers}+ traveler plan.`));
  for (const term of proposal.cancellationTerms) {
    if (term.daysBefore > 0) contractual.push(create(term.daysBefore, `Cancellation penalty rises to ${term.penalty}`, "Agency", "operator", "From this date, cancelling costs this share of the trip under the selected proposal.", false));
  }
  const checkpoints = [
    create(60, `Minimum viable group: ${request.minimumViableTravelers}`, "Agency", "decision", `${request.confirmedTravelers} confirmed so far. Go / No-Go decision required if the minimum is not reached.`, minimumWarning),
    create(90, `Sales target: ${twoThirdsTarget} confirmed`, "Agency", "sales", "Review sales pace, pricing, and supplier commitments."),
    create(120, `Sales target: ${halfTarget} confirmed`, "Agency", "sales", "Early viability checkpoint."),
    create(150, "Trip actively selling", "Agency", "sales", "Launch sales materials and client outreach."),
    create(180, "Operator and itinerary locked", "Shared", "decision", "Approve the operating partner and final trip structure."),
  ].filter((item) => item.date >= today);
  return [...contractual, ...checkpoints].sort((a, b) => b.date.localeCompare(a.date) || a.label.localeCompare(b.label));
}

export function canSelectPartner(selectedPartnerIds: string[], partnerId: string, limit = 5) {
  return selectedPartnerIds.includes(partnerId) || selectedPartnerIds.length < limit;
}

export function createResetDemoState(defaultRequest: TripRequest) {
  return { request: JSON.parse(JSON.stringify(defaultRequest)) as TripRequest, view: "dashboard" as const, step: 1, maxStep: 1 };
}
