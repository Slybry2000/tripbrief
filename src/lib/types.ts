export type TripRequest = {
  id: string;
  name: string;
  evaluationDate: string;
  travelerCount: number;
  minimumViableTravelers: number;
  nights: number;
  travelMonth: string;
  earliestDepartureDate: string;
  latestDepartureDate: string;
  preferredDepartureDate: string;
  flexibleDates: boolean;
  proposalDecisionDate: string;
  targetRetailPricePerPerson: number;
  flightsIncluded: boolean;
  experienceLevel: number;
  pace: string;
  climates: string[];
  desiredExperiences: string[];
  importantRequirements: string[];
  travelerTypes: string[];
  transportationNeeds: string[];
  accessibilityNeeds: string[];
  notes: string;
  status: "Draft" | "Sent" | "Comparing" | "Selected";
  selectedDestinationIds: string[];
  selectedPartnerIds: string[];
  timingOverridePartnerIds: string[];
  selectedProposalId: string | null;
  confirmedTravelers: number;
};

export type Destination = {
  id: string;
  name: string;
  country: string;
  climates: string[];
  experienceStrengths: Record<string, number>;
  description: string;
  watchOuts: string[];
};

export type Partner = {
  id: string;
  name: string;
  country: string;
  destinations: string[];
  specialties: string[];
  minGroupSize: number;
  maxGroupSize: number;
  experienceLevels: number[];
  typicalNetPriceMin: number;
  typicalNetPriceMax: number;
  approvalStatus: string;
};

export type ServiceArea = {
  destinationId: string;
  country: string;
  regions: string[];
  cities: string[];
  areas: string[];
  coverage: "nationwide" | "regional" | "local";
  operatingMonths: number[];
};

export type BlackoutPeriod = {
  start: string;
  end: string;
  label: string;
};

export type OperatorCommercial = {
  typicalNetMin: number;
  typicalNetMax: number;
  minimumTripValue: number;
  typicalTripValue: number;
  preferredGroupValue: number;
  pricingModels: string[];
  currency: string;
  pricingVariesByGroupSize: boolean;
};

export type OperatorTiming = {
  yearRound: boolean;
  operatingMonths: number[];
  seasonalNotes: string;
  blackoutPeriods: BlackoutPeriod[];
  shortestLeadTimeDays: number;
  minimumLeadTimeDays: number;
  idealLeadTimeDays: number;
  averageProposalTurnaroundDays: number;
  maximumProposalTurnaroundDays: number;
  spaceHoldDays: number;
  depositDueDaysBefore: number;
  finalPaymentDaysBefore: number;
  finalHeadcountDaysBefore: number;
  travelerNamesDaysBefore: number;
  latestGroupChangeDaysBefore: number;
  roomReleaseDaysBefore: number;
  cancellationDeadlines: { daysBefore: number; penalty: string }[];
};

export type OperatorProfile = {
  partnerId: string;
  locations: string[];
  serviceAreas: ServiceArea[];
  minGroupSize: number;
  maxGroupSize: number;
  idealGroupSize: number;
  supportsFIT: boolean;
  groupTypes: string[];
  travelerTypes: string[];
  hotelTypes: string[];
  services: string[];
  features: string[];
  operations: string[];
  canBuildBespoke: boolean;
  customizationLevel: "limited" | "moderate" | "high" | "fully_bespoke";
  quoteTurnaroundDays: number;
  languages: string[];
  commercial: OperatorCommercial;
  timing: OperatorTiming;
};

export type TimingStatus = "Works" | "At Risk" | "Conflict";
export type LiveAvailability = "Confirmation Required" | "Available" | "On Request" | "Held" | "Unavailable";

export type TimingAssessment = {
  status: TimingStatus;
  liveAvailability: LiveAvailability;
  evaluatedDepartureDate: string;
  daysRemaining: number;
  operatesForDates: boolean;
  leadTimeWorks: boolean;
  proposalDeadlineWorks: boolean;
  reasons: string[];
  warnings: string[];
};

export type OperatorMatch = {
  score: number;
  destinationFit: number;
  experienceFit: number;
  operationalFit: number;
  groupFit: number;
  accommodationFit: number;
  commercialFit: number;
  matchedServices: string[];
  missingServices: string[];
  matchedOperations: string[];
  missingOperations: string[];
  matchedFeatures: string[];
  missingFeatures: string[];
  groupSizeFit: boolean;
  hotelFit: boolean;
  locationScore: number;
  timing: TimingAssessment;
};

export type ReadyMadeTrip = {
  id: string;
  partnerId: string;
  name: string;
  destinationId: string;
  nights: number;
  minGroupSize: number;
  maxGroupSize: number;
  netPricePerPerson: number;
  experienceLevel: number;
  pace: string;
  experiences: string[];
  requirementsSupported: string[];
  itinerary: string[];
};

export type Proposal = {
  id: string;
  tripRequestId: string;
  partnerId: string;
  readyMadeTripId: string;
  status: "Proposal Received" | "Needs Changes" | "Declined" | "Awaiting Response";
  revisedNetPricePerPerson: number | null;
  canModify: string[];
  cannotModify: string[];
  partnerNotes: string;
};

export type OperatorProposal = {
  id: string;
  partnerId: string;
  programName: string;
  basedOnExistingProgram: boolean;
  readyMadeTripId: string | null;
  destinationId: string;
  startDate: string;
  endDate: string;
  nights: number;
  availability: LiveAvailability;
  groupSizeAccepted: number;
  hotelLevel: string;
  hotelNotes: string;
  transportation: string[];
  experiencesIncluded: string[];
  requirementsMet: string[];
  changesOrAdditions: string[];
  cannotProvide: string[];
  finalFit: number;
  netPricePerPerson: number;
  currency: string;
  pricingAssumptions: string;
  depositPercent: number;
  depositDueDaysBefore: number;
  finalHeadcountDaysBefore: number;
  finalPaymentDaysBefore: number;
  travelerNamesDaysBefore: number;
  roomReleaseDaysBefore: number;
  cancellationTerms: { daysBefore: number; penalty: string }[];
  operatorNotes: string;
};

export type WorkbackItem = {
  date: string;
  daysBefore: number;
  label: string;
  owner: "Agency" | "Operator" | "Shared";
  category: "departure" | "operator" | "sales" | "decision";
  detail: string;
  warning: boolean;
};

export type TripMatch = {
  score: number;
  matchedExperiences: string[];
  missingExperiences: string[];
  matchedRequirements: string[];
  missingRequirements: string[];
  hardMismatchFlags: string[];
};
