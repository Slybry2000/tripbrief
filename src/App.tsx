import { useEffect, useState } from "react";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import destinationSeed from "./data/destinations.json";
import requestSeed from "./data/demo-request.json";
import programSeed from "./data/programs.json";
import { buildWorkbackSchedule, calculateDestinationMatch, calculateOperatorMatch, calculateProposalMargin, calculateTargetNet, calculateTripMatch, servesSelectedDestinations } from "./lib/matching";
import type { Destination, OperatorMatch, OperatorProfile, OperatorProposal, Partner, ReadyMadeTrip, TripRequest } from "./lib/types";
import { newCapabilityToken, readResponseToken, responseLink } from "./capability";
import { buildRequirements, hardNoList, missingMusts, TIER_LABEL } from "./lib/requirements";

const destinations = destinationSeed as Destination[];
const defaultRequest = requestSeed as TripRequest;

// Ready-made programs and destinations are reference data: they never change
// while the app runs, and the matching engine reads them synchronously. The
// operator network is different — an operator edits its own capability record —
// so it is a live Convex read, cached here under the names the demo's engine
// already uses.
type StoredProgram = {
  id: string;
  operatorSlug: string;
  destinationSlug: string;
  name: string;
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
const trips = (programSeed as StoredProgram[]).map((program) => ({
  ...program,
  partnerId: program.operatorSlug,
  destinationId: program.destinationSlug,
})) as ReadyMadeTrip[];

type StoredOperator = {
  slug: string;
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
  source: "seed" | "researched" | "manual";
  contactEmail?: string;
  website?: string;
};
// What the network query returns for one operator's capability record. It names
// the destination the way the stored record does; the engine below expects the
// demo's own field name, so the mapping happens here and nowhere else.
type StoredServiceArea = {
  destinationSlug: string;
  country: string;
  regions: string[];
  cities: string[];
  areas: string[];
  coverage: "nationwide" | "regional" | "local";
  operatingMonths: number[];
};
type StoredCapability = Omit<
  OperatorProfile,
  "partnerId" | "serviceAreas"
> & {
  operatorSlug: string;
  serviceAreas: StoredServiceArea[];
  updatedAt: number;
};
export type NetworkRow = {
  operator: StoredOperator;
  capability: StoredCapability;
};

let partners: Partner[] = [];
let operatorProfiles: OperatorProfile[] = [];
let demoOperator: Partner = partners[0];
let demoProfile: OperatorProfile = operatorProfiles[0];
let networkBySlug = new Map<string, StoredOperator>();

// The network is a live query at the root, so the cache is refreshed before any
// view that ranks operators renders.
function cacheNetwork(rows: NetworkRow[]) {
  partners = rows.map(({ operator }) => ({
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
    contactEmail: operator.contactEmail,
  }));
  operatorProfiles = rows.map(({ capability }) => ({
    ...toProfile(capability),
  }));
  demoOperator = partners[0];
  demoProfile = operatorProfiles[0];
  networkBySlug = new Map(rows.map(({ operator }) => [operator.slug, operator]));
}

const operatorWebsite = (slug: string) => networkBySlug.get(slug)?.website ?? "";
const operatorContactEmail = (slug: string) =>
  networkBySlug.get(slug)?.contactEmail ?? "";

// The stored record and the engine's record differ by one field name and one
// added key, so the conversion lives in exactly two functions.
function toProfile(capability: StoredCapability): OperatorProfile {
  return {
    partnerId: capability.operatorSlug,
    locations: capability.locations,
    serviceAreas: capability.serviceAreas.map((area) => ({
      destinationId: area.destinationSlug,
      country: area.country,
      regions: area.regions,
      cities: area.cities,
      areas: area.areas,
      coverage: area.coverage,
      operatingMonths: area.operatingMonths,
    })),
    minGroupSize: capability.minGroupSize,
    maxGroupSize: capability.maxGroupSize,
    idealGroupSize: capability.idealGroupSize,
    supportsFIT: capability.supportsFIT,
    groupTypes: capability.groupTypes,
    travelerTypes: capability.travelerTypes,
    hotelTypes: capability.hotelTypes,
    services: capability.services,
    features: capability.features,
    operations: capability.operations,
    canBuildBespoke: capability.canBuildBespoke,
    customizationLevel: capability.customizationLevel,
    quoteTurnaroundDays: capability.quoteTurnaroundDays,
    languages: capability.languages,
    commercial: capability.commercial,
    timing: capability.timing,
  };
}

function toStoredCapability(profile: OperatorProfile) {
  return {
    locations: profile.locations,
    serviceAreas: profile.serviceAreas.map((area) => ({
      destinationSlug: area.destinationId,
      country: area.country,
      regions: area.regions,
      cities: area.cities,
      areas: area.areas,
      coverage: area.coverage,
      operatingMonths: area.operatingMonths,
    })),
    minGroupSize: profile.minGroupSize,
    maxGroupSize: profile.maxGroupSize,
    idealGroupSize: profile.idealGroupSize,
    supportsFIT: profile.supportsFIT,
    groupTypes: profile.groupTypes,
    travelerTypes: profile.travelerTypes,
    hotelTypes: profile.hotelTypes,
    services: profile.services,
    features: profile.features,
    operations: profile.operations,
    canBuildBespoke: profile.canBuildBespoke,
    customizationLevel: profile.customizationLevel,
    quoteTurnaroundDays: profile.quoteTurnaroundDays,
    languages: profile.languages,
    commercial: profile.commercial,
    timing: profile.timing,
  };
}

// On an operator's own link, "the operator" is that operator: the portal's
// workspace and intake are written around one record, and this points them at the
// one the link belongs to rather than at the demo's first row.
function focusOperator(slug: string) {
  const partner = partners.find((item) => item.id === slug);
  const capability = operatorProfiles.find((item) => item.partnerId === slug);
  if (partner) demoOperator = partner;
  if (capability) demoProfile = capability;
}

const experiences = ["wellness", "yoga", "meditation", "spa", "fitness", "hiking", "adventure", "light_adventure", "beach", "nature", "wildlife", "culture", "history", "healthy_food", "cooking", "wine", "golf", "luxury", "family_travel", "multigenerational_travel", "religious_travel", "educational_travel", "retreats", "corporate_groups", "private_group_experiences"];
const operations = ["private_transportation", "shared_transportation", "airport_transfers", "private_guides", "shared_guides", "multilingual_guides", "accessible_transportation", "low_mobility_options", "private_activities", "shared_activities", "luggage_handling", "meet_and_greet", "on_trip_support", "emergency_support", "custom_itinerary_building"];
const requirements = ["low_physical_difficulty", "mostly_private_experiences", "few_hotel_changes", "strong_wellness_focus", "strong_food_focus", "strong_cultural_focus"];
const travelerTypes = ["adult_groups", "families", "multigenerational", "private_groups", "retreats", "corporate_groups", "educational_groups", "religious_groups"];
const hotelTypes = ["3-star", "4-star", "5-star_luxury", "luxury", "boutique_hotels", "private_villas", "resorts", "wellness_retreats", "eco_lodges", "specialty_accommodations"];
// What a group commonly expects to be inside the price. Named the way an operator
// names it, because it becomes a requirement they answer.
const inclusionOptions = ["airport_transfers", "private_transportation", "shared_transportation", "breakfast_daily", "half_board", "two_group_dinners", "entrance_fees", "private_guide", "english_speaking_guide", "yoga_and_spa_sessions", "one_activity_daily", "insurance_guidance", "tips_and_gratuities"];
const workflowSteps = ["Client Needs", "Destinations", "ITO Matches", "Choose Partners", "Trip Request", "Responses", "Compare Trips", "Selection & Workback"];
const orderedViews: AppView[] = ["brief", "destinations", "operators", "choose", "request", "responses", "compare", "selected"];

const titleCase = (value: string) => value.replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
const formatDate = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
const destinationName = (id: string) => destinations.find((item) => item.id === id)?.name ?? titleCase(id);
const levelLabel = (level: number) => level === 1 ? "3-star" : level === 2 ? "4-star" : "5-star / Luxury";
const fitLabel = (score: number) => score >= 90 ? "Excellent" : score >= 75 ? "Strong" : score >= 55 ? "Partial" : "Limited";

type AppView = "dashboard" | "brief" | "destinations" | "operators" | "choose" | "request" | "responses" | "compare" | "selected" | "directory" | "portal";
type OperatorView = "login" | "workspace" | "profile" | "request" | "quote" | "submitted";
type RankedOperator = { partner: Partner; profile: OperatorProfile; match: OperatorMatch; bestTrip: ReadyMadeTrip | null; bestTripScore: number };

function operatorRanking(request: TripRequest, profileOverride?: OperatorProfile, selectedLocationsOnly = false): RankedOperator[] {
  return partners.map((partner) => {
    const profile = partner.id === "p1" && profileOverride ? profileOverride : operatorProfiles.find((item) => item.partnerId === partner.id)!;
    const match = calculateOperatorMatch(request, partner, profile, destinations);
    const best = trips.filter((trip) => trip.partnerId === partner.id).map((trip) => ({ trip, score: calculateTripMatch(request, trip).score })).sort((a, b) => b.score - a.score)[0];
    return { partner, profile, match, bestTrip: best?.trip ?? null, bestTripScore: best?.score ?? 0 };
  }).filter((item) => !selectedLocationsOnly || servesSelectedDestinations(request, item.profile)).sort((a, b) => b.match.score - a.match.score || a.partner.name.localeCompare(b.partner.name));
}

type Account = { email: string; isTrial: boolean; canSend: boolean; reason: string };

function BrandHeader({ activeView, setActiveView, reset, signOut, account }: { activeView: AppView; setActiveView: (value: AppView) => void; reset: () => void; signOut: () => void; account: Account | null | undefined }) {
  return <header className="topbar operator-topbar">
    <button className="brand-home" onClick={() => setActiveView("dashboard")} aria-label="TripBrief operator finder dashboard"><span className="brand-mark">TB</span><span><strong>TripBrief</strong><small>Incoming Operator Finder</small></span></button>
    <div className="side-switch" aria-label="Choose workspace"><button className={activeView !== "portal" ? "active" : ""} onClick={() => setActiveView("dashboard")}>TripBrief</button><button className={activeView === "portal" ? "active" : ""} onClick={() => setActiveView("portal")}>Operator Links</button></div>
    <nav aria-label="TripBrief navigation"><button className={activeView === "dashboard" ? "nav-active" : ""} onClick={() => setActiveView("dashboard")}>Dashboard</button><button className={activeView === "brief" ? "nav-active" : ""} onClick={() => setActiveView("brief")}>New Client Brief</button><button className={activeView === "directory" ? "nav-active" : ""} onClick={() => setActiveView("directory")}>ITO Network</button></nav>
    <div className="topbar-actions">{account && <span className="who">{account.isTrial ? "Trial workspace" : account.email}</span>}<button className="reset-button" onClick={reset}>Home</button><button className="reset-button" onClick={signOut}>Sign out</button></div>
  </header>;
}

// The app really sends mail and really stores briefs, so the notice says what is
// true rather than what is convenient: the network it ships with is invented.
// A reply that arrived from an address no request went to is not guessed onto a
// brief: it is kept, and shown, because a person can tell what it is.
function UnfiledMail() {
  const messages = useQuery(api.replies.unfiled) ?? [];
  if (!messages.length) return null;
  return <section className="resume-briefs"><div className="section-heading"><p className="eyebrow">MAIL</p><h2>Mail that could not be filed</h2><p>These arrived in one of the workspace's mail inboxes from an address no request on file was sent to, so they are held here rather than attached to a guess.</p></div><div className="inbox-list">{messages.map((message) => <article key={message._id}><div><small>{new Date(message.receivedAt).toLocaleString()} · {message.fromEmail}</small><h3>{message.subject || "(no subject)"}</h3><p>{message.text.slice(0, 240)}{message.text.length > 240 ? "…" : ""}</p></div></article>)}</div></section>;
}

function DemoNotice() {
  return <aside className="demo-notice"><span>i</span>This workspace starts with a fictional operator network, for evaluation. Replace it with your own operators before you send anything to a real supplier. Sending is always one deliberate click on one named operator.</aside>;
}

function WorkflowProgress({ view, go }: { view: AppView; go: (value: AppView) => void }) {
  const current = orderedViews.indexOf(view);
  if (current < 0) return null;
  return <div className="progress-wrap eight-steps" aria-label={`Step ${current + 1} of 8`}><div className="progress-line" />{workflowSteps.map((step, index) => <button key={step} className={`${index === current ? "current" : ""} ${index < current ? "done" : ""}`} disabled={index > current} onClick={() => index <= current && go(orderedViews[index])}><span>{index < current ? "✓" : index + 1}</span><small>{step}</small></button>)}</div>;
}

// The advisor's own view of what the operator will read: the same numbering the
// packet uses, and the must-haves nobody has answered yet.
function RequirementSummary({ request }: { request: TripRequest }) {
  const requirements = buildRequirements(request);
  const missing = missingMusts(request);
  return <div className={missing.length ? "inline-warning" : "inline-success"}><strong>{requirements.length} requirements · R1–R{requirements.length}</strong>{missing.length ? <><span>An operator cannot price around these yet:</span>{missing.map((item) => <span key={item.key}>· {item.label}</span>)}</> : <span>Every must-have is answered, so this can be priced without a phone call.</span>}</div>;
}

function Choice({ item, checked, onChange }: { item: string; checked: boolean; onChange: () => void }) {
  return <label className={`choice ${checked ? "checked" : ""}`}><input type="checkbox" checked={checked} onChange={onChange} /><span>{checked ? "✓" : ""}</span>{titleCase(item)}</label>;
}

function TagList({ title, values, tone = "match" }: { title: string; values: string[]; tone?: "match" | "missing" | "neutral" }) {
  return <div className="tag-section"><strong>{title}</strong><div className="tags">{values.length ? values.map((item) => <span className={`tag ${tone}`} key={item}>{tone === "match" ? "✓ " : tone === "missing" ? "− " : ""}{titleCase(item)}</span>) : <span className="quiet">None</span>}</div></div>;
}

function Score({ value, caption = "Capability Match" }: { value: number; caption?: string }) {
  return <div className="score"><strong>{value}</strong><span>%</span><small>{caption}</small></div>;
}

// The counter never counts anything the network does not hold: it is read from
// the same live query the matcher uses, so adding a researched operator or a
// destination changes it.
function Dashboard({ start, portal, briefs, open }: { start: () => void; portal: () => void; briefs: { _id: Id<"briefs">; name: string; status: string; travelerCount: number; nights: number; selectedDestinations: string[] }[]; open: (id: Id<"briefs">, status: string) => void }) {
  return <><section className="dashboard-hero operator-hero v2-hero"><div><p className="eyebrow">TRIPBRIEF · ITO SOURCING &amp; OPERATIONS</p><h1>From client needs to the right local operator—and a trip that can actually operate.</h1><p className="hero-copy">Discover suitable destinations, qualify incoming operators by their profile capabilities, then ask shortlisted operators to confirm dates, availability, and the trip they would actually provide.</p><div className="hero-actions"><button className="primary" onClick={start}>Start With Client Needs <span>→</span></button><button className="secondary" onClick={portal}>Operator links &amp; capability records</button></div></div><div className="hero-model"><div><small>1</small><strong>Client needs</strong><span>Destination can stay open</span></div><b>→</b><div><small>2</small><strong>Capable ITO shortlist</strong><span>Profile match only</span></div><b>→</b><div><small>3</small><strong>Confirmed proposals</strong><span>Dates and availability come from the ITO</span></div><b>→</b><div><small>4</small><strong>Workback plan</strong><span>Deadlines tied to departure</span></div></div></section><section className="metrics"><article className="metric-card"><span className="metric-value">{partners.length}</span><h2>ITO profiles in the network</h2><p>Structured supplier-product data</p></article><article className="metric-card"><span className="metric-value">{destinations.length}</span><h2>Destination knowledge sets</h2><p>Discovery before operator selection</p></article><article className="metric-card"><span className="metric-value">6</span><h2>Visible match dimensions</h2><p>Timing confirmed after request</p></article><article className="metric-card"><span className="metric-value">8</span><h2>Connected workflow steps</h2><p>Needs through workback schedule</p></article></section>{briefs.length > 0 && <section className="resume-briefs"><div className="section-heading"><p className="eyebrow">YOUR BRIEFS</p><h2>Continue where the request stopped</h2><p>Every brief, its shortlist, its private operator links and every proposal that has come back are stored. Open one to pick the workflow up at the step it reached.</p></div><div className="link-list">{briefs.map((item) => <article key={item._id}><div><h2>{item.name}</h2><p>{item.status === "selected" ? "Trip and operator selected" : item.status === "comparing" ? "Proposals received — ready to compare" : item.status === "sent" ? "Requests sent — waiting for proposals" : "Draft brief"} · {item.travelerCount} travellers · {item.nights} nights{item.selectedDestinations.length ? ` · ${item.selectedDestinations.map(destinationName).join(", ")}` : ""}</p></div><button className="primary" onClick={() => open(item._id, item.status)}>Open this brief →</button></article>)}</div></section>}<UnfiledMail /><DemoNotice /></>;
}

function BriefForm({ request, setRequest, next }: { request: TripRequest; setRequest: (value: TripRequest) => void; next: () => void }) {
  const [errors, setErrors] = useState<string[]>([]);
  const update = <K extends keyof TripRequest>(key: K, value: TripRequest[K]) => setRequest({ ...request, [key]: value });
  const toggle = (key: "climates" | "desiredExperiences" | "importantRequirements" | "travelerTypes" | "transportationNeeds" | "accessibilityNeeds" | "inclusionsExpected", item: string) => update(key, request[key].includes(item) ? request[key].filter((value) => value !== item) : [...request[key], item]);
  const validate = () => {
    const nextErrors: string[] = [];
    if (request.minimumViableTravelers > request.travelerCount) nextErrors.push("Minimum viable travelers cannot exceed target group size.");
    if (request.earliestDepartureDate > request.latestDepartureDate) nextErrors.push("Earliest departure must be before latest departure.");
    if (request.preferredDepartureDate < request.earliestDepartureDate || request.preferredDepartureDate > request.latestDepartureDate) nextErrors.push("Preferred departure must fall inside the travel window.");
    if (!request.desiredExperiences.length) nextErrors.push("Choose at least one experience.");
    setErrors(nextErrors);
    if (!nextErrors.length) next();
  };
  return <section className="workflow-section request-form"><div className="section-heading"><p className="eyebrow">STEP 1 · CLIENT NEEDS</p><h1>Describe the trip without choosing the destination first.</h1><p>The dates, group economics, experiences, operating needs, and accessibility requirements will all travel with this brief.</p></div>{errors.length > 0 && <div className="inline-warning"><strong>Review the brief</strong>{errors.map((error) => <span key={error}>{error}</span>)}</div>}
    <div className="form-card"><h2>Group and viability</h2><div className="form-grid three"><label className="wide">Brief name<input value={request.name} onChange={(event) => update("name", event.target.value)} /></label><label>Target group size<input type="number" value={request.travelerCount} onChange={(event) => update("travelerCount", Number(event.target.value))} /></label><label>Minimum viable travelers<input type="number" value={request.minimumViableTravelers} onChange={(event) => update("minimumViableTravelers", Number(event.target.value))} /></label><label>Nights<input type="number" value={request.nights} onChange={(event) => update("nights", Number(event.target.value))} /></label><label>Hotel level<select value={request.experienceLevel} onChange={(event) => update("experienceLevel", Number(event.target.value))}><option value="1">3-star</option><option value="2">4-star</option><option value="3">5-star / Luxury</option></select></label><label>Pace<select value={request.pace} onChange={(event) => update("pace", event.target.value)}><option value="relaxed">Relaxed</option><option value="balanced">Balanced</option><option value="active">Active</option></select></label><label>Target retail / person<div className="money-input"><span>$</span><input type="number" value={request.targetRetailPricePerPerson} onChange={(event) => update("targetRetailPricePerPerson", Number(event.target.value))} /></div></label></div><fieldset><legend>Who is traveling?</legend><div className="choice-grid">{travelerTypes.map((item) => <Choice key={item} item={item} checked={request.travelerTypes.includes(item)} onChange={() => toggle("travelerTypes", item)} />)}</div></fieldset></div>
    <div className="form-card date-card"><h2>Departure window and decision timing</h2><p className="form-help">These dates become questions in the trip request. Each shortlisted ITO must review them and confirm what it can actually operate.</p><div className="form-grid three"><label>Earliest departure<input type="date" value={request.earliestDepartureDate} onChange={(event) => update("earliestDepartureDate", event.target.value)} /></label><label>Preferred departure<input type="date" value={request.preferredDepartureDate} onChange={(event) => update("preferredDepartureDate", event.target.value)} /></label><label>Latest departure<input type="date" value={request.latestDepartureDate} onChange={(event) => update("latestDepartureDate", event.target.value)} /></label><label>Proposal decision deadline<input type="date" value={request.proposalDecisionDate} onChange={(event) => update("proposalDecisionDate", event.target.value)} /></label><label className="inline-check"><input type="checkbox" checked={request.flexibleDates} onChange={(event) => update("flexibleDates", event.target.checked)} />Flexible dates within this window</label></div></div>
    <div className="form-card"><fieldset><legend>Preferred climate</legend><div className="choice-grid compact">{["warm", "tropical", "mild", "cool"].map((item) => <Choice key={item} item={item} checked={request.climates.includes(item)} onChange={() => toggle("climates", item)} />)}</div></fieldset><fieldset><legend>Experiences and trip types</legend><div className="choice-grid">{experiences.map((item) => <Choice key={item} item={item} checked={request.desiredExperiences.includes(item)} onChange={() => toggle("desiredExperiences", item)} />)}</div></fieldset></div>
    <div className="form-card"><fieldset><legend>Transportation and operating needs</legend><div className="choice-grid">{operations.slice(0, 10).map((item) => <Choice key={item} item={item} checked={request.transportationNeeds.includes(item)} onChange={() => toggle("transportationNeeds", item)} />)}</div></fieldset><fieldset><legend>Accessibility and trip requirements</legend><div className="choice-grid">{[...requirements, "accessible_transportation", "low_mobility_options"].map((item) => { const key = item.includes("mobility") || item.includes("accessible") ? "accessibilityNeeds" : "importantRequirements"; return <Choice key={item} item={item} checked={request[key].includes(item)} onChange={() => toggle(key, item)} />; })}</div></fieldset><label>Additional context<textarea rows={4} value={request.notes} onChange={(event) => update("notes", event.target.value)} /></label></div>
    <div className="form-card"><h2>What an operator needs in order to quote</h2><p className="form-help">A brief without this comes back as a phone call. These answers become numbered requirements R1, R2, R3 and so on, and the operator answers them one by one.</p><div className="form-grid three">
      <label className="wide">The group, in the operator&rsquo;s terms<textarea rows={3} value={request.groupDescription} onChange={(event) => update("groupDescription", event.target.value)} placeholder="A friendship group of returning clients who book together once a year…" /></label>
      <label>Ages<input value={request.ages} onChange={(event) => update("ages", event.target.value)} placeholder="48 to 67" /></label>
      <label>How firm are the dates?<input value={request.dateFirmness} onChange={(event) => update("dateFirmness", event.target.value)} placeholder="Fixed to the second week of October, movable by three days" /></label>
      <label className="wide">Rooms and occupancy<textarea rows={3} value={request.rooms} onChange={(event) => update("rooms", event.target.value)} placeholder="8 twin rooms, 2 singles, one couple in a double, no triples" /></label>
      <label className="wide">Dietary, mobility and medical needs<textarea rows={3} value={request.dietaryAndMedical} onChange={(event) => update("dietaryAndMedical", event.target.value)} placeholder="Two gluten-free, one who cannot manage stairs…" /></label>
      <label className="wide">The budget covers<input value={request.budgetBasis} onChange={(event) => update("budgetBasis", event.target.value)} placeholder="land only, per person, excluding international flights" /></label>
      <label className="wide">Where the group travels from<textarea rows={2} value={request.guestOrigin} onChange={(event) => update("guestOrigin", event.target.value)} placeholder="Seattle and Vancouver, arriving on different flights…" /></label>
      <label className="wide">What a good day looks like<textarea rows={3} value={request.dayShape} onChange={(event) => update("dayShape", event.target.value)} placeholder="One main activity, a long lunch, the late afternoon free…" /></label>
    </div><fieldset><legend>Must be included in the price</legend><div className="choice-grid">{inclusionOptions.map((item) => <Choice key={item} item={item} checked={request.inclusionsExpected.includes(item)} onChange={() => toggle("inclusionsExpected", item)} />)}</div></fieldset>
    <label>Hard no&rsquo;s, one per line<textarea rows={3} value={request.hardNos.join("\n")} onChange={(event) => update("hardNos", event.target.value.split("\n").map((line) => line.trim()).filter(Boolean))} placeholder={"no start before 9am\nno bus days over three hours"} /></label>
    <RequirementSummary request={request} /></div>
    <div className="sticky-action"><span>Target operator net: <strong>{money(calculateTargetNet(request))}</strong> per person</span><button className="primary" onClick={validate}>Discover Destinations <span>→</span></button></div>
  </section>;
}

function DestinationDiscovery({ request, setRequest, next }: { request: TripRequest; setRequest: (value: TripRequest) => void; next: () => void }) {
  const ranked = destinations.map((destination) => ({ destination, score: calculateDestinationMatch(request, destination) })).sort((a, b) => b.score - a.score);
  const toggleDestination = (destinationId: string) => {
    const selectedDestinationIds = request.selectedDestinationIds.includes(destinationId) ? request.selectedDestinationIds.filter((id) => id !== destinationId) : [...request.selectedDestinationIds, destinationId];
    setRequest({ ...request, selectedDestinationIds, selectedPartnerIds: [], selectedProposalId: null });
  };
  const selectedNames = request.selectedDestinationIds.map(destinationName);
  return <section className="workflow-section"><div className="section-heading"><p className="eyebrow">STEP 2 · DESTINATION DISCOVERY & SELECTION</p><h1>Which locations is the customer interested in?</h1><p>Use the discovery scores as guidance, then select one or more locations the customer wants the agency to pursue. Only ITOs serving those locations will be considered next.</p></div><div className="destination-discovery-grid selectable-destinations">{ranked.map(({ destination, score }, index) => { const strengths = request.desiredExperiences.filter((item) => (destination.experienceStrengths[item] ?? 0) >= 4); const selected = request.selectedDestinationIds.includes(destination.id); return <article className={`destination-discovery-card ${selected ? "selected" : ""}`} key={destination.id}><span className="destination-rank">#{index + 1}</span><label className={`destination-select ${selected ? "checked" : ""}`}><input type="checkbox" checked={selected} onChange={() => toggleDestination(destination.id)} /><span>{selected ? "✓ Selected" : "+ Select location"}</span></label><div><p>{destination.country}</p><h2>{destination.name}</h2><span>{destination.description}</span></div><Score value={score} caption="Destination Fit" /><TagList title="Strong for this brief" values={strengths} /><div className="watchouts"><strong>Planning notes</strong>{destination.watchOuts.map((note) => <span key={note}>• {note}</span>)}</div></article>; })}</div><div className="method-note"><strong>Nothing is requested automatically.</strong><span>This selection only narrows the ITO shortlist. The advisor chooses the operators separately and review the request before sending it.</span></div><div className="sticky-action"><span>{selectedNames.length ? <><strong>{selectedNames.length}</strong> selected: {selectedNames.join(", ")}</> : "Select at least one customer-approved location."}</span><button className="primary" disabled={!selectedNames.length} onClick={next}>Find ITOs in Selected Locations <span>→</span></button></div></section>;
}

function CapabilityBreakdown({ match }: { match: OperatorMatch }) {
  const rows = [["Destination Fit", match.destinationFit], ["Experience Fit", match.experienceFit], ["Operational Fit", match.operationalFit], ["Group Fit", match.groupFit], ["Accommodation Fit", match.accommodationFit], ["Commercial Fit", match.commercialFit]] as [string, number][];
  return <div className="capability-breakdown">{rows.map(([label, value]) => <div key={label}><span>{label}<b>{fitLabel(value)}</b></span><div><i style={{ width: `${value}%` }} /></div><strong>{value}%</strong></div>)}</div>;
}

function TimingConfirmationPanel({ item }: { item: RankedOperator }) {
  return <div className="timing-panel awaiting-confirmation"><div className="timing-head"><div><small>REQUEST TIMING</small><strong>Awaiting operator confirmation</strong></div><span>Not yet submitted</span></div><p>This operator has not been asked to review the requested window yet. Its profile can provide planning context, but it cannot confirm this trip&apos;s dates or live space.</p><ul><li>Profile minimum lead time: {item.profile.timing.minimumLeadTimeDays} days</li><li>Typical proposal turnaround: {item.profile.timing.averageProposalTurnaroundDays}–{item.profile.timing.maximumProposalTurnaroundDays} business days</li><li>{item.profile.timing.seasonalNotes}</li></ul></div>;
}

function OperatorResultCard({ item, rank }: { item: RankedOperator; rank: number }) {
  const missing = [...item.match.missingServices, ...item.match.missingOperations];
  return <article className="operator-result-card"><span className="operator-rank">#{rank}</span><div className="operator-result-head"><div><p>{item.profile.serviceAreas.map((area) => `${area.country} · ${area.regions.join(", ")}`).join(" | ")}</p><h2>{item.partner.name}</h2><span>Fictional approved incoming tour operator</span></div><Score value={item.match.score} /></div><CapabilityBreakdown match={item.match} /><TimingConfirmationPanel item={item} /><div className="result-detail-grid"><TagList title="Strong match" values={[...item.match.matchedServices, ...item.match.matchedOperations].slice(0, 10)} /><TagList title="Missing or needs confirmation" values={missing.slice(0, 8)} tone={missing.length ? "missing" : "match"} /></div>{item.bestTrip ? <div className="supporting-program"><div><small>OPTIONAL EXISTING PROGRAM</small><strong>{item.bestTrip.name}</strong><span>{item.bestTripScore}% trip similarity · useful context only</span></div><b>Does not affect capability rank</b></div> : <div className="supporting-program custom"><div><small>CUSTOM / À LA CARTE</small><strong>No ready-made program listed</strong><span>Operator can recommend a program from scratch.</span></div><b>Equal matching treatment</b></div>}</article>;
}

function OperatorResults({ request, profile, next }: { request: TripRequest; profile: OperatorProfile; next: () => void }) {
  const ranked = operatorRanking(request, profile, true);
  return <section className="workflow-section wide-section"><div className="section-heading"><p className="eyebrow">STEP 3 · MATCHING INCOMING TOUR OPERATORS</p><h1>Which ITO profiles are capable enough to ask?</h1><p>Showing only operators that serve the customer-selected locations: <strong>{request.selectedDestinationIds.map(destinationName).join(", ")}</strong>. Capability Match ranks those operators using information already in their profiles; requested dates and live availability remain unconfirmed.</p></div><div className="scoring-contract"><strong>Capability Match</strong><span>35% experiences</span><span>20% operations</span><span>15% destination</span><span>10% group</span><span>10% accommodation</span><span>10% commercial</span><em>Request timing awaits ITO response</em></div><div className="result-section-title"><div><span className="status-dot viable" /><div><h2>Capability-ranked ITOs for selected locations</h2><p>{ranked.length} operators serve at least one selected location. Shortlist the ones whose profile capabilities justify preparing a request.</p></div></div></div><div className="operator-results">{ranked.map((item, index) => <OperatorResultCard key={item.partner.id} item={item} rank={index + 1} />)}</div><div className="sticky-action"><span><strong>{ranked.length}</strong> matching profiles · no request has been prepared or sent</span><button className="primary" onClick={next}>Choose Partners <span>→</span></button></div></section>;
}

function ChoosePartners({ request, profile, setRequest, next }: { request: TripRequest; profile: OperatorProfile; setRequest: (value: TripRequest) => void; next: () => void }) {
  const ranked = operatorRanking(request, profile, true);
  const toggle = (id: string) => setRequest({ ...request, selectedPartnerIds: request.selectedPartnerIds.includes(id) ? request.selectedPartnerIds.filter((item) => item !== id) : request.selectedPartnerIds.length < 5 ? [...request.selectedPartnerIds, id] : request.selectedPartnerIds });
  return <section className="workflow-section"><div className="section-heading split-heading"><div><p className="eyebrow">STEP 4 · CHOOSE PARTNERS</p><h1>Select up to five ITOs because their capabilities fit.</h1><p>Selection creates the shortlist to contact. No operator is treated as date-viable until it reviews the brief and replies.</p></div><div className="selected-counter"><strong>{request.selectedPartnerIds.length}/5</strong><span>selected</span></div></div><div className="choose-list">{ranked.map((item) => { const selected = request.selectedPartnerIds.includes(item.partner.id); return <article className={selected ? "selected" : ""} key={item.partner.id}><div><span className="timing-chip awaiting-confirmation">Timing unconfirmed</span><h2>{item.partner.name}</h2><p>{item.profile.locations.map(destinationName).join(", ")} · {item.match.score}% capability</p></div><div className="choose-facts"><span>{fitLabel(item.match.experienceFit)} experience fit</span><span>{item.match.groupSizeFit ? "Profile supports group size" : "Ask about group size"}</span><span>{fitLabel(item.match.commercialFit)} commercial fit</span></div><label className={`include-toggle ${selected ? "checked" : ""}`}><input type="checkbox" checked={selected} onChange={() => toggle(item.partner.id)} /><span>{selected ? "✓" : "+"}</span>{selected ? "Included" : "Select ITO"}</label></article>; })}</div><div className="sticky-action"><span>{request.selectedPartnerIds.length ? `${request.selectedPartnerIds.length} ITOs will receive the core brief and confirm timing.` : "Select at least one capable ITO to contact."}</span><button className="primary" disabled={!request.selectedPartnerIds.length} onClick={next}>Prepare Trip Request <span>→</span></button></div></section>;
}

function requestItems(request: TripRequest, item: RankedOperator) {
  const items = [...item.match.missingServices, ...item.match.missingOperations];
  if (!item.match.groupSizeFit) items.push(`confirm capacity for ${request.travelerCount} travelers`);
  if (!item.match.hotelFit) items.push(`source ${levelLabel(request.experienceLevel)} accommodations`);
  items.push(`review the full ${formatDate(request.earliestDepartureDate)}–${formatDate(request.latestDepartureDate)} window and propose dates you can actually operate`);
  items.push("confirm live hotel, guide, transport, and activity availability in your response");
  items.push(`quote at or near ${money(calculateTargetNet(request))} net per person`);
  return items;
}

function TripRequestReview({ request, profile, send }: { request: TripRequest; profile: OperatorProfile; send: () => void }) {
  const selected = operatorRanking(request, profile, true).filter((item) => request.selectedPartnerIds.includes(item.partner.id));
  return <section className="workflow-section"><div className="section-heading"><p className="eyebrow">STEP 5 · SEND TRIP REQUEST</p><h1>One core brief, with operator-specific questions.</h1><p>This is the first time each ITO is asked to judge the requested timing. Existing programs may be referenced as context, but every operator must reply with dates and availability it can stand behind.</p></div><div className="brief-strip v2"><div><strong>{request.name}</strong><span>{request.travelerCount} target · {request.minimumViableTravelers} minimum viable · {request.nights} nights</span></div><div><small>TRAVEL WINDOW TO CONFIRM</small><strong>{formatDate(request.earliestDepartureDate)}–{formatDate(request.latestDepartureDate)}</strong></div><div><small>TARGET OPERATOR NET</small><strong>{money(calculateTargetNet(request))}</strong></div></div><div className="bespoke-request-list">{selected.map((item) => <article key={item.partner.id}><div className="request-recipient"><span>TO</span><div><h2>{item.partner.name}</h2><p>{item.profile.locations.map(destinationName).join(", ")}</p></div><Score value={item.match.score} /></div><TagList title="Profile already supports" values={[...item.match.matchedServices, ...item.match.matchedOperations].slice(0, 10)} /><TagList title="Please answer in the proposal" values={requestItems(request, item)} tone="missing" />{item.bestTrip ? <p className="reference-trip"><strong>Optional reference:</strong> {item.bestTrip.name} appears {item.bestTripScore}% similar. Confirm what changes, availability, and pricing are required.</p> : <p className="reference-trip"><strong>Custom request:</strong> No existing program is required. Recommend the trip you would actually operate.</p>}</article>)}</div><div className="send-box"><div><strong>Send to {selected.length} fictional ITOs</strong><p>No real messages are sent in this demo.</p></div><button className="primary" onClick={send}>Send Trip Requests <span>→</span></button></div></section>;
}

function OperatorResponses({ request, proposals, next }: { request: TripRequest; proposals: OperatorProposal[]; next: () => void }) {
  const selectedPartners = partners.filter((partner) => request.selectedPartnerIds.includes(partner.id));
  const received = proposals.filter((proposal) => request.selectedPartnerIds.includes(proposal.partnerId));
  return <section className="workflow-section"><div className="section-heading split-heading"><div><p className="eyebrow">STEP 6 · OPERATOR RESPONSES</p><h1>Each ITO returns the trip it would actually provide.</h1><p>The response covers availability, inclusions, gaps, price assumptions, and operating deadlines—not merely a headline quote.</p></div><button className="primary" disabled={!received.length} onClick={next}>Compare {received.length} Proposed Trips →</button></div><div className="success-banner"><span>✓</span><div><strong>Trip Request sent to {selectedPartners.length} demo ITOs.</strong><p>{received.length} structured proposals are ready for review.</p></div></div><div className="proposal-response-grid">{selectedPartners.map((partner) => { const proposal = proposals.find((item) => item.partnerId === partner.id); return <article key={partner.id} className={proposal ? "received" : "waiting"}>{proposal ? <><div className="proposal-status"><span>Proposal Received</span><b>{proposal.availability}</b></div><p>{destinationName(proposal.destinationId)}</p><h2>{proposal.programName}</h2><div className="proposal-quick-facts"><span><small>DATES</small><strong>{formatDate(proposal.startDate)}</strong></span><span><small>FINAL FIT</small><strong>{proposal.finalFit}%</strong></span><span><small>NET / PERSON</small><strong>{money(proposal.netPricePerPerson)}</strong></span><span><small>PROGRAM TYPE</small><strong>{proposal.basedOnExistingProgram ? "Adapted existing" : "Custom build"}</strong></span></div><TagList title="Included" values={proposal.experiencesIncluded.slice(0, 8)} /><TagList title="Changes or additions" values={proposal.changesOrAdditions} tone="neutral" />{proposal.cannotProvide.length > 0 && <TagList title="Cannot provide" values={proposal.cannotProvide} tone="missing" />}<p className="proposal-note">“{proposal.operatorNotes}”</p></> : <><div className="proposal-status"><span>Awaiting Response</span></div><p>Selected ITO</p><h2>{partner.name}</h2><span className="quiet">No structured proposal has been submitted yet.</span></>}</article>; })}</div></section>;
}

function CompareProposals({ request, proposals, select }: { request: TripRequest; proposals: OperatorProposal[]; select: (id: string) => void }) {
  const received = proposals.filter((proposal) => request.selectedPartnerIds.includes(proposal.partnerId));
  const bestFit = Math.max(...received.map((proposal) => proposal.finalFit));
  return <section className="workflow-section wide-section"><div className="section-heading"><p className="eyebrow">STEP 7 · COMPARE PROPOSED TRIPS</p><h1>Now compare the offers—not the operator profiles.</h1><p>Each column is a real proposed trip with final requirement coverage, price, hotels, transportation, remaining gaps, deposits, and deadlines.</p></div><div className="proposal-compare-table"><div className="compare-labels"><span>Proposal</span><span>Fit & availability</span><span>Commercial</span><span>Hotels & transport</span><span>Remaining gaps</span><span>Commitments</span></div>{received.map((proposal) => { const partner = partners.find((item) => item.id === proposal.partnerId)!; const margin = calculateProposalMargin(request, proposal)!; return <article className={proposal.finalFit === bestFit ? "recommended" : ""} key={proposal.id}>{proposal.finalFit === bestFit && <em>★ Strongest final fit</em>}<div><p>{destinationName(proposal.destinationId)}</p><h2>{proposal.programName}</h2><small>{partner.name}</small><b>{proposal.basedOnExistingProgram ? "Adapted existing program" : "Built from scratch"}</b></div><div><strong>{proposal.finalFit}% final fit</strong><span className="availability-pill">{proposal.availability}</span><small>{formatDate(proposal.startDate)} · {proposal.nights} nights</small></div><div><strong>{money(proposal.netPricePerPerson)}</strong><span>{(margin.margin * 100).toFixed(1)}% est. margin</span><small>{proposal.depositPercent}% deposit · {proposal.currency}</small></div><div><strong>{titleCase(proposal.hotelLevel)}</strong><span>{proposal.hotelNotes}</span><small>{proposal.transportation.map(titleCase).join(", ")}</small></div><div>{proposal.cannotProvide.length ? proposal.cannotProvide.map((item) => <span className="gap-line" key={item}>! {item}</span>) : <span className="clear-line">✓ No unresolved gaps</span>}<small>{proposal.changesOrAdditions.length} documented changes</small></div><div><strong>Deposit: {proposal.depositDueDaysBefore} days prior</strong><span>Final payment: {proposal.finalPaymentDaysBefore} days prior</span><small>Room release: {proposal.roomReleaseDaysBefore} days prior</small><button className="primary" onClick={() => select(proposal.id)}>Select Trip & ITO →</button></div></article>; })}</div></section>;
}

function SelectedAndWorkback({ request, proposal, reset }: { request: TripRequest; proposal: OperatorProposal; reset: () => void }) {
  const partner = partners.find((item) => item.id === proposal.partnerId)!;
  const margin = calculateProposalMargin(request, proposal)!;
  const schedule = buildWorkbackSchedule(request, proposal);
  return <section className="workflow-section selected-workback"><div className="selection-confirm"><div className="selected-icon">✓</div><div><p className="eyebrow">STEP 8 · SELECTED TRIP & OPERATING PARTNER</p><h1>{proposal.programName}</h1><p>Your agency will sell this proposed trip. <strong>{partner.name}</strong> is the behind-the-scenes operating partner.</p></div><div className="selection-commercial"><span><small>NET / PERSON</small><strong>{money(proposal.netPricePerPerson)}</strong></span><span><small>EST. MARGIN</small><strong>{(margin.margin * 100).toFixed(1)}%</strong></span><span><small>LIVE AVAILABILITY</small><strong>{proposal.availability}</strong></span></div></div><div className="workback-heading"><div><p className="eyebrow">INITIAL WORKBACK SCHEDULE</p><h2>Work backward from {formatDate(proposal.startDate)}</h2><p>Contractual deadlines come from the selected proposal. Sales and viability checkpoints remain the agency's decisions.</p></div><div className="traveler-progress"><strong>{request.confirmedTravelers} confirmed</strong><span>{request.minimumViableTravelers} minimum viable · {request.travelerCount} target</span><div><i style={{ width: `${Math.min(100, request.confirmedTravelers / request.travelerCount * 100)}%` }} /></div></div></div><div className="go-no-go-warning"><span>!</span><div><strong>Go / No-Go Decision Required if the minimum is missed</strong><p>The demo does not automatically cancel. The agency can continue, cancel, renegotiate, change price, reduce commitments, or choose another operator.</p></div></div><div className="workback-timeline">{schedule.map((item) => <article className={`${item.category} ${item.warning ? "warning" : ""}`} key={`${item.date}-${item.label}`}><div className="timeline-date"><strong>{formatDate(item.date)}</strong><span>{item.daysBefore ? `${item.daysBefore} days before` : "Departure"}</span></div><i /><div className="timeline-content"><span>{item.owner}</span><h3>{item.label}</h3><p>{item.detail}</p></div></article>)}</div><div className="handoff-box"><strong>Matching is complete; operations now begin.</strong><p>The capability engine answered who could deliver. This schedule answers what must happen next so the selected trip does not drift toward costly deadlines.</p></div><button className="primary" onClick={reset}>Start Another ITO Search</button></section>;
}

// The network page: who is in this workspace's operator network, how to reach
// each operator's own capability record, and how to bring another one in. It is a
// management surface rather than a ranking — the brief decides what matters for a
// particular request.
function OperatorDirectory({ request, briefId }: { request: TripRequest; briefId: Id<"briefs"> | null }) {
  const links = useQuery(api.network.capabilityLinks) ?? [];
  const createLink = useMutation(api.network.createCapabilityLink);
  const removeOperator = useMutation(api.network.removeOperator);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busySlug, setBusySlug] = useState("");
  const linkFor = (slug: string) => links.find((row) => row.operatorSlug === slug);
  const openIntake = async (slug: string) => {
    setError(""); setNotice(""); setBusySlug(slug);
    try {
      await createLink({ operatorSlug: slug, token: newCapabilityToken() });
      setNotice(`A capability intake link is ready for ${partners.find((item) => item.id === slug)?.name ?? slug}. Open it, or send it to the operator.`);
    } catch (cause) { setError(errorText(cause, "Could not create that link.")); }
    finally { setBusySlug(""); }
  };
  const remove = async (slug: string, name: string) => {
    setError(""); setNotice("");
    if (!window.confirm(`Remove ${name} from the operator network? Its capability record and its intake link go with it. This cannot be undone.`)) return;
    try { await removeOperator({ operatorSlug: slug }); setNotice(`${name} was removed from the network.`); }
    catch (cause) { setError(errorText(cause, "Could not remove that operator.")); }
  };
  return <section className="workflow-section"><div className="section-heading"><p className="eyebrow">THE OPERATOR NETWORK</p><h1>Who this workspace can ask to operate a trip.</h1><p>Every record here is capability data: what, where, who, how, cost and timing. It is what the matcher reads, and it is the operator's own to keep current through its private intake link.</p></div>
    {error && <div className="inline-warning"><strong>Network</strong><span>{error}</span></div>}
    {notice && <div className="inline-success"><strong>Done</strong><span>{notice}</span></div>}
    <div className="directory-grid">{partners.map((partner) => {
      const capability = operatorProfiles.find((item) => item.partnerId === partner.id);
      const link = linkFor(partner.id);
      const pending = partner.approvalStatus === "capability_intake_pending";
      return <article key={partner.id}><span className={`status-badge ${pending ? "pending" : ""}`}>{pending ? "Capability intake pending" : "Capability on file"}</span><h2>{partner.name}</h2><p>{capability?.serviceAreas.flatMap((area) => [area.country, ...area.regions]).join(" · ") || capability?.locations.map(destinationName).join(" · ")}</p><div className="mini-facts"><span>{capability?.minGroupSize}–{capability?.maxGroupSize} travellers</span><span>{capability?.timing.minimumLeadTimeDays ?? 0}-day minimum lead time</span><span>{capability?.services.length ?? 0} experiences</span></div><TagList title="Experiences" values={(capability?.services ?? []).slice(0, 7)} tone="neutral" />{operatorWebsite(partner.id) && <a className="source-link" href={operatorWebsite(partner.id)} target="_blank" rel="noreferrer">Source website</a>}
        <div className="operator-actions">{link ? <><a className="primary" href={responseLink(link.token)} target="_blank" rel="noreferrer">Open its intake link →</a><button className="secondary" onClick={() => void navigator.clipboard?.writeText(responseLink(link.token)).then(() => setNotice(`Link for ${partner.name} copied.`))}>Copy link</button></> : <button className="primary" disabled={busySlug === partner.id} onClick={() => void openIntake(partner.id)}>{busySlug === partner.id ? "Creating…" : "Create its intake link"}</button>}<button className="secondary" onClick={() => void remove(partner.id, partner.name)}>Remove</button></div>
        <OperatorContact slug={partner.id} contactEmail={partner.contactEmail} />
        {link?.lastOpenedAt && <small className="quiet">Last opened {new Date(link.lastOpenedAt).toLocaleDateString()}</small>}
      </article>;
    })}</div>
    <AddOperator />
    <NetworkResearch request={request} briefId={briefId} />
  </section>;
}

// An operator an advisor already knows, typed in by hand. Both this and a
// researched candidate start with an empty capability record, because neither the
// advisor nor a search result can claim what an operator can deliver.
function AddOperator() {
  const addOperator = useMutation(api.network.addOperator);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [destinationSlugs, setDestinationSlugs] = useState<string[]>([]);
  const [minGroupSize, setMinGroupSize] = useState(8);
  const [maxGroupSize, setMaxGroupSize] = useState(30);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const save = async () => {
    setError(""); setNotice("");
    try {
      const result = await addOperator({ name, country, destinationSlugs, minGroupSize, maxGroupSize, contactEmail });
      setNotice(`${name} was added. Create its intake link below and send it, and it can fill in what it can actually deliver.`);
      setName(""); setCountry(""); setContactEmail(""); setDestinationSlugs([]); setOpen(false);
      void result;
    } catch (cause) { setError(errorText(cause, "Could not add that operator.")); }
  };
  return <div className="network-research"><div className="section-heading split-heading"><div><p className="eyebrow">ADD BY HAND</p><h2>Bring in an operator you already work with</h2><p>A name and a footprint are enough. Capability, commercial terms and timing all arrive from the operator's own intake, not from here.</p></div><button className="secondary" onClick={() => setOpen(!open)}>{open ? "Close" : "Add an operator"}</button></div>
    {error && <div className="inline-warning"><strong>Add</strong><span>{error}</span></div>}
    {notice && <div className="inline-success"><strong>Added</strong><span>{notice}</span></div>}
    {open && <div className="form-card"><div className="form-grid three"><label className="wide">Operator name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Coast & Valley Travel" /></label><label>Country<input value={country} onChange={(event) => setCountry(event.target.value)} /></label><label className="wide">Contact email<input type="email" inputMode="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} placeholder="name@operator.example" /></label><label>Minimum group<input type="number" value={minGroupSize} onChange={(event) => setMinGroupSize(Number(event.target.value))} /></label><label>Maximum group<input type="number" value={maxGroupSize} onChange={(event) => setMaxGroupSize(Number(event.target.value))} /></label></div><fieldset><legend>Destinations it operates</legend><div className="choice-grid compact">{destinations.map((item) => <Choice key={item.id} item={item.id} checked={destinationSlugs.includes(item.id)} onChange={() => setDestinationSlugs(destinationSlugs.includes(item.id) ? destinationSlugs.filter((slug) => slug !== item.id) : [...destinationSlugs, item.id])} />)}</div></fieldset><div className="sticky-action"><span>It starts with an empty capability record, so it only matches what it confirms itself.</span><button className="primary" disabled={name.trim().length < 3} onClick={() => void save()}>Add to the network</button></div></div>}
  </div>;
}

// Looking for an operator the network does not have yet. Firecrawl returns
// published pages; each one keeps the query that surfaced it, and nothing joins
// the network until an advisor adds it.
function NetworkResearch({ request, briefId }: { request: TripRequest; briefId: Id<"briefs"> | null }) {
  const [destinationSlug, setDestinationSlug] = useState(request.selectedDestinationIds[0] ?? destinations[0].id);
  const [queries, setQueries] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const runSearch = useAction(api.research.search);
  const addOperator = useMutation(api.network.addOperator);
  const dismiss = useMutation(api.research.dismiss);
  const found = useQuery(api.research.list, { destinationSlug });
  const destination = destinations.find((item) => item.id === destinationSlug) ?? destinations[0];
  const search = async () => {
    if (!briefId) { setError("Open a brief first — research is spent against one brief."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await runSearch({ briefId, destinationSlug, destinationName: destination.name, focus: request.desiredExperiences });
      setQueries(result.queries);
    } catch (cause) { setError(cause instanceof Error ? cause.message.replace(/^\[.*?\]\s*/, "") : "The search failed."); }
    finally { setBusy(false); }
  };
  // A researched page is evidence, not a member: it becomes an operator only
  // when an advisor adds it, and it carries the page it came from.
  const add = async (candidateId: Id<"candidates">, title: string) => {
    setError("");
    try {
      const result = await addOperator({ candidateId, name: title, destinationSlugs: [destinationSlug], country: destination.country, minGroupSize: request.minimumViableTravelers || 8, maxGroupSize: Math.max(request.travelerCount, 10), website: (found ?? []).find((item) => item._id === candidateId)?.url });
      setNotice(`${title} was added to the network as ${result.slug}. Create its intake link above and send it, and it can be matched.`);
    } catch (cause) { setError(errorText(cause, "Could not add that operator.")); }
  };
  return <section className="network-research"><div className="section-heading split-heading"><div><p className="eyebrow">GROW THE NETWORK</p><h2>Find incoming operators that are not in the network yet</h2><p>Firecrawl searches published websites for operators serving one destination. A result is evidence, not a network member: it becomes an operator only when you add it, and it matches nothing until it has filled in a capability record.</p></div><label>Destination<select value={destinationSlug} onChange={(event) => { setDestinationSlug(event.target.value); setQueries([]); setNotice(""); }}>{destinations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
    {error && <div className="inline-warning"><strong>Research</strong><span>{error}</span></div>}
    {notice && <div className="inline-success"><strong>Added</strong><span>{notice}</span></div>}
    <div className="research-actions"><button className="primary" disabled={busy} onClick={() => void search()}>{busy ? "Searching published websites…" : `Search published operators in ${destination.name}`} <span>→</span></button>{queries.length > 0 && <p className="quiet">Searched for: {queries.map((item) => `"${item}"`).join(" · ")}</p>}</div>
    <div className="candidate-list">{(found ?? []).map((item) => <article key={item._id}><div><small>{item.query}</small><h3>{item.title}</h3><span>{item.description}</span><a href={item.url} target="_blank" rel="noreferrer">{item.url}</a></div>{item.addedOperatorSlug ? <span className="status-badge">In the network as {item.addedOperatorSlug}</span> : <div className="candidate-actions"><button className="primary" onClick={() => void add(item._id, item.title)}>Add to the network</button><button className="secondary" onClick={() => void dismiss({ candidateId: item._id })}>Dismiss</button></div>}</article>)}{found && found.length === 0 && <p className="quiet">Nothing found yet for {destination.name}. Run the search, or choose another destination.</p>}</div></section>;
}

function PartnerWorkspace({ profile, request, go }: { profile: OperatorProfile; request: TripRequest; go: (value: OperatorView) => void }) {
  const match = calculateOperatorMatch(request, demoOperator, profile, destinations);
  return <section className="workflow-section partner-workspace"><div className="portal-identity"><div><span className="portal-logo">IW</span><div><p className="eyebrow">SIGNED IN AS</p><h1>{demoOperator.name}</h1><span>{profile.serviceAreas.flatMap((area) => [area.country, ...area.regions]).join(" · ")}</span></div></div><button className="primary" onClick={() => go("profile")}>Open Capability Intake</button></div><div className="portal-metrics"><article><span>{profile.serviceAreas.length}</span><strong>Operating area</strong><p>With regional detail</p></article><article><span>{profile.services.length}</span><strong>Experiences</strong><p>Searchable capabilities</p></article><article><span>{profile.operations.length}</span><strong>Operating services</strong><p>How trips are delivered</p></article><article><span>{profile.timing.minimumLeadTimeDays}</span><strong>Day minimum lead</strong><p>Profile planning context</p></article></div><div className="portal-columns"><section><div className="portal-section-title"><div><p className="eyebrow">INCOMING REQUEST</p><h2>{request.name}</h2></div><span className="needs-response-badge">Needs Response</span></div><div className="request-overview"><span><small>GROUP</small><strong>{request.travelerCount}</strong></span><span><small>DEPARTURE</small><strong>{formatDate(request.preferredDepartureDate)}</strong></span><span><small>WINDOW</small><strong>{request.flexibleDates ? "Flexible" : "Fixed"}</strong></span><span><small>TARGET NET</small><strong>{money(calculateTargetNet(request))}</strong></span></div><TagList title="Client needs" values={request.desiredExperiences.slice(0, 8)} tone="neutral" /><button className="primary" onClick={() => go("request")}>Review Trip Request →</button></section><aside><p className="eyebrow">PROFILE-BASED QUALIFICATION</p><Score value={match.score} /><CapabilityBreakdown match={match} /><TimingConfirmationPanel item={{ partner: demoOperator, profile, match, bestTrip: trips[0], bestTripScore: 92 }} /></aside></div></section>;
}

function IntakeSection({ number, title, description, children }: { number: string; title: string; description: string; children: React.ReactNode }) {
  return <div className="intake-section form-card"><div className="intake-title"><span>{number}</span><div><h2>{title}</h2><p>{description}</p></div></div>{children}</div>;
}

function ProfileEditor({ profile, setProfile, save }: { profile: OperatorProfile; setProfile: (value: OperatorProfile) => void; save: () => void }) {
  const toggle = (key: "locations" | "hotelTypes" | "services" | "features" | "operations" | "travelerTypes" | "groupTypes", value: string) => setProfile({ ...profile, [key]: profile[key].includes(value) ? profile[key].filter((item) => item !== value) : [...profile[key], value] });
  const commercial = profile.commercial;
  const timing = profile.timing;
  return <section className="workflow-section intake-page"><div className="section-heading split-heading"><div><p className="eyebrow">ITO CAPABILITY INTAKE</p><h1>Describe what, where, who, how, cost, and when you can deliver.</h1><p>This is supplier-product data used for matching. Ready-made programs are optional records at the end.</p></div><span className="status-badge">Approved Demo ITO</span></div><div className="intake-index"><span>01 Footprint</span><span>02 Experiences</span><span>03 Operations</span><span>04 Groups & Hotels</span><span>05 Commercial</span><span>06 Timing</span><span>07 Programs</span></div>
    <IntakeSection number="01" title="Operating footprint" description="Be specific: nationwide coverage and regional expertise are not the same."><div className="form-grid three"><label className="wide">Company name<input value={demoOperator.name} readOnly /></label><label>Country<input value={profile.serviceAreas[0].country} readOnly /></label><label>Coverage<select value={profile.serviceAreas[0].coverage} onChange={(event) => setProfile({ ...profile, serviceAreas: [{ ...profile.serviceAreas[0], coverage: event.target.value as "nationwide" | "regional" | "local" }] })}><option value="nationwide">Nationwide</option><option value="regional">Regional</option><option value="local">Local</option></select></label><label className="wide">Regions<input value={profile.serviceAreas[0].regions.join(", ")} onChange={(event) => setProfile({ ...profile, serviceAreas: [{ ...profile.serviceAreas[0], regions: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) }] })} /></label><label className="wide">Cities<input value={profile.serviceAreas[0].cities.join(", ")} onChange={(event) => setProfile({ ...profile, serviceAreas: [{ ...profile.serviceAreas[0], cities: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) }] })} /></label><label className="wide">Islands / areas<input value={profile.serviceAreas[0].areas.join(", ")} onChange={(event) => setProfile({ ...profile, serviceAreas: [{ ...profile.serviceAreas[0], areas: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) }] })} /></label></div><fieldset><legend>Destination knowledge sets</legend><div className="choice-grid compact">{destinations.map((item) => <Choice key={item.id} item={item.id} checked={profile.locations.includes(item.id)} onChange={() => toggle("locations", item.id)} />)}</div></fieldset></IntakeSection>
    <IntakeSection number="02" title="Experiences and traveler types" description="Everything your team can reliably arrange, with room to add categories later."><fieldset><legend>Experiences and trip types</legend><div className="choice-grid">{experiences.map((item) => <Choice key={item} item={item} checked={profile.services.includes(item)} onChange={() => toggle("services", item)} />)}</div></fieldset><fieldset><legend>Traveler types served</legend><div className="choice-grid">{travelerTypes.map((item) => <Choice key={item} item={item} checked={profile.travelerTypes.includes(item)} onChange={() => toggle("travelerTypes", item)} />)}</div></fieldset></IntakeSection>
    <IntakeSection number="03" title="Operational capabilities" description="How your company moves, guides, supports, and protects travelers on the ground."><div className="choice-grid">{operations.map((item) => <Choice key={item} item={item} checked={profile.operations.includes(item)} onChange={() => toggle("operations", item)} />)}</div><label className="intake-select">Customization supported<select value={profile.customizationLevel} onChange={(event) => setProfile({ ...profile, customizationLevel: event.target.value as OperatorProfile["customizationLevel"] })}><option value="limited">Limited changes</option><option value="moderate">Moderate</option><option value="high">High</option><option value="fully_bespoke">Fully bespoke</option></select></label></IntakeSection>
    <IntakeSection number="04" title="Groups and accommodations" description="Who fits your operating model and what accommodation supply you normally contract."><div className="form-grid three"><label>Minimum group<input type="number" value={profile.minGroupSize} onChange={(event) => setProfile({ ...profile, minGroupSize: Number(event.target.value) })} /></label><label>Ideal group<input type="number" value={profile.idealGroupSize} onChange={(event) => setProfile({ ...profile, idealGroupSize: Number(event.target.value) })} /></label><label>Maximum group<input type="number" value={profile.maxGroupSize} onChange={(event) => setProfile({ ...profile, maxGroupSize: Number(event.target.value) })} /></label><label className="inline-check"><input type="checkbox" checked={profile.supportsFIT} onChange={(event) => setProfile({ ...profile, supportsFIT: event.target.checked })} />FIT / individual travelers</label></div><fieldset><legend>Group formats</legend><div className="choice-grid compact">{["fit", "small_groups", "medium_groups", "large_groups", "private_groups", "retreats"].map((item) => <Choice key={item} item={item} checked={profile.groupTypes.includes(item)} onChange={() => toggle("groupTypes", item)} />)}</div></fieldset><fieldset><legend>Accommodation types</legend><div className="choice-grid">{hotelTypes.map((item) => <Choice key={item} item={item} checked={profile.hotelTypes.includes(item)} onChange={() => toggle("hotelTypes", item)} />)}</div></fieldset></IntakeSection>
    <IntakeSection number="05" title="Budget and commercial fit" description="Demo values are normalized to USD; the currency field remains part of the model."><div className="form-grid three"><label>Typical net minimum<input type="number" value={commercial.typicalNetMin} onChange={(event) => setProfile({ ...profile, commercial: { ...commercial, typicalNetMin: Number(event.target.value) } })} /></label><label>Typical net maximum<input type="number" value={commercial.typicalNetMax} onChange={(event) => setProfile({ ...profile, commercial: { ...commercial, typicalNetMax: Number(event.target.value) } })} /></label><label>Currency<select value={commercial.currency} onChange={(event) => setProfile({ ...profile, commercial: { ...commercial, currency: event.target.value } })}><option>USD</option><option>EUR</option><option>IDR</option></select></label><label>Minimum trip value<input type="number" value={commercial.minimumTripValue} onChange={(event) => setProfile({ ...profile, commercial: { ...commercial, minimumTripValue: Number(event.target.value) } })} /></label><label>Typical trip value<input type="number" value={commercial.typicalTripValue} onChange={(event) => setProfile({ ...profile, commercial: { ...commercial, typicalTripValue: Number(event.target.value) } })} /></label><label>Preferred group value<input type="number" value={commercial.preferredGroupValue} onChange={(event) => setProfile({ ...profile, commercial: { ...commercial, preferredGroupValue: Number(event.target.value) } })} /></label><label className="inline-check"><input type="checkbox" checked={commercial.pricingVariesByGroupSize} onChange={(event) => setProfile({ ...profile, commercial: { ...commercial, pricingVariesByGroupSize: event.target.checked } })} />Pricing changes by group size</label></div></IntakeSection>
    <IntakeSection number="06" title="Availability, lead times, and deadlines" description="Operating availability and known exceptions inform matching. Live space remains unconfirmed until you respond."><div className="availability-layers"><article><small>LAYER 1</small><strong>Operating availability</strong><span>{timing.yearRound ? "Year-round" : timing.operatingMonths.map((month) => new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2027, month - 1, 1))).replace(" ", "")).join(", ")}</span></article><article><small>LAYER 2</small><strong>Known exceptions</strong><span>{timing.blackoutPeriods.length ? timing.blackoutPeriods.map((period) => `${formatDate(period.start)}–${formatDate(period.end)}`).join(", ") : "No blackouts listed"}</span></article><article><small>LAYER 3</small><strong>Live availability</strong><span>Confirmed only in a proposal</span></article></div><div className="form-grid three"><label className="inline-check"><input type="checkbox" checked={timing.yearRound} onChange={(event) => setProfile({ ...profile, timing: { ...timing, yearRound: event.target.checked } })} />Operate year-round</label><label>Shortest accepted lead<input type="number" value={timing.shortestLeadTimeDays} onChange={(event) => setProfile({ ...profile, timing: { ...timing, shortestLeadTimeDays: Number(event.target.value) } })} /></label><label>Normal minimum lead<input type="number" value={timing.minimumLeadTimeDays} onChange={(event) => setProfile({ ...profile, timing: { ...timing, minimumLeadTimeDays: Number(event.target.value) } })} /></label><label>Ideal lead time<input type="number" value={timing.idealLeadTimeDays} onChange={(event) => setProfile({ ...profile, timing: { ...timing, idealLeadTimeDays: Number(event.target.value) } })} /></label><label>Average proposal turnaround<input type="number" value={timing.averageProposalTurnaroundDays} onChange={(event) => setProfile({ ...profile, timing: { ...timing, averageProposalTurnaroundDays: Number(event.target.value) } })} /></label><label>Maximum proposal turnaround<input type="number" value={timing.maximumProposalTurnaroundDays} onChange={(event) => setProfile({ ...profile, timing: { ...timing, maximumProposalTurnaroundDays: Number(event.target.value) } })} /></label><label>Space hold (days)<input type="number" value={timing.spaceHoldDays} onChange={(event) => setProfile({ ...profile, timing: { ...timing, spaceHoldDays: Number(event.target.value) } })} /></label><label>Deposit due (days before)<input type="number" value={timing.depositDueDaysBefore} onChange={(event) => setProfile({ ...profile, timing: { ...timing, depositDueDaysBefore: Number(event.target.value) } })} /></label><label>Final payment (days before)<input type="number" value={timing.finalPaymentDaysBefore} onChange={(event) => setProfile({ ...profile, timing: { ...timing, finalPaymentDaysBefore: Number(event.target.value) } })} /></label><label>Final headcount (days before)<input type="number" value={timing.finalHeadcountDaysBefore} onChange={(event) => setProfile({ ...profile, timing: { ...timing, finalHeadcountDaysBefore: Number(event.target.value) } })} /></label><label>Traveler names (days before)<input type="number" value={timing.travelerNamesDaysBefore} onChange={(event) => setProfile({ ...profile, timing: { ...timing, travelerNamesDaysBefore: Number(event.target.value) } })} /></label><label>Room release (days before)<input type="number" value={timing.roomReleaseDaysBefore} onChange={(event) => setProfile({ ...profile, timing: { ...timing, roomReleaseDaysBefore: Number(event.target.value) } })} /></label></div><label>Seasonal notes<textarea rows={3} value={timing.seasonalNotes} onChange={(event) => setProfile({ ...profile, timing: { ...timing, seasonalNotes: event.target.value } })} /></label><div className="deadline-list"><strong>Cancellation deadlines</strong>{timing.cancellationDeadlines.map((deadline) => <span key={deadline.daysBefore}>{deadline.daysBefore} days before · {deadline.penalty} penalty</span>)}</div></IntakeSection>
    <IntakeSection number="07" title="Optional ready-made programs" description="Useful context after qualification. Programs never increase or reduce Capability Match.">{trips.filter((trip) => trip.partnerId === profile.partnerId).map((trip) => <div className="profile-trip" key={trip.id}><div><strong>{trip.name}</strong><span>{trip.nights} nights · {money(trip.netPricePerPerson)} starting net</span></div><span>Supporting information only</span></div>)}{trips.filter((trip) => trip.partnerId === profile.partnerId).length === 0 && <p className="quiet">No ready-made programs listed. Matching never depends on having one.</p>}</IntakeSection><div className="sticky-action"><span>Saving updates the matching immediately.</span><button className="primary" onClick={save}>Save Capability Record</button></div></section>;
}

// The brief as the operator reads it. A row with no answer is left out rather
// than shown blank — the gap list says what is missing, once, at the end.
function PacketSection({ title, rows }: { title: string; rows: [string, string][] }) {
  const filled = rows.filter(([, value]) => value && value.replace(/[,\s]/g, "").length > 0);
  if (!filled.length) return null;
  return <section className="packet-section"><h2>{title}</h2><dl>{filled.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>;
}

// The numbered list is the point of the exercise: several operators answering the
// same numbers is a comparison, several operators answering in prose is not.
function RequirementTable({ request }: { request: TripRequest }) {
  const requirements = buildRequirements(request);
  if (!requirements.length) return null;
  return <section className="packet-section"><h2>What you must answer</h2><p className="form-help">Numbered, so your reply lines up with every other operator's. Answer each one: a clear no is useful, a blank is not.</p><ol className="requirement-list">{requirements.map((requirement) => <li key={requirement.id}><div className="requirement-head"><span className="requirement-id">{requirement.id}</span><strong>{requirement.label}</strong><span className={`tier ${requirement.tier}`}>{TIER_LABEL[requirement.tier]}</span></div><p>{requirement.statement}</p><p className="requirement-ask">{requirement.ask}</p></li>)}</ol></section>;
}

function HardNos({ request }: { request: TripRequest }) {
  const nos = hardNoList(request);
  if (!nos.length) return null;
  return <section className="packet-section hard-nos"><h2>Hard no&rsquo;s</h2><p className="form-help">These are not preferences. If your itinerary breaks one, say so and propose what you would do instead.</p><ul>{nos.map((no) => <li key={no}>{no}</li>)}</ul></section>;
}

function GapNotice({ request }: { request: TripRequest }) {
  const missing = missingMusts(request);
  if (!missing.length) return null;
  return <section className="packet-section"><h2>What we do not have yet</h2><p className="form-help">The agency has not answered these. Ask, or price against a stated assumption and say what the assumption is.</p><ul>{missing.map((item) => <li key={item.key}>{item.label}</li>)}</ul></section>;
}

function PartnerRequest({ request, profile, quote }: { request: TripRequest; profile: OperatorProfile; quote: () => void }) {
  const ranked = operatorRanking(request, profile);
  const item = ranked.find((row) => row.partner.id === profile.partnerId) ?? ranked[0];
  return <section className="workflow-section"><div className="section-heading split-heading"><div><p className="eyebrow">TRIP REQUEST FROM THE AGENCY</p><h1>{request.name}</h1><p>Review the requested window, recommend the actual trip you would operate, and confirm dates, availability, fit, pricing assumptions, and deadlines.</p></div><span className="needs-response-badge">Needs Response</span></div><div className="brief-strip v2"><div><strong>{request.travelerCount} travelers · {request.minimumViableTravelers} minimum</strong><span>{request.nights} nights · {levelLabel(request.experienceLevel)} · {titleCase(request.pace)} pace</span></div><div><small>TRAVEL WINDOW TO REVIEW</small><strong>{formatDate(request.earliestDepartureDate)}–{formatDate(request.latestDepartureDate)}</strong></div><div><small>TARGET NET</small><strong>{money(calculateTargetNet(request))}</strong></div></div><div className="portal-columns request-detail"><section><div className="packet">
      <PacketSection title="The group" rows={[["Who they are", request.groupDescription], ["Ages", request.ages], ["Travellers", `${request.travelerCount} to price, ${request.minimumViableTravelers} minimum viable, ${request.confirmedTravelers} confirmed`], ["Travelling from", request.guestOrigin]]} />
      <PacketSection title="Dates" rows={[["Window", `${request.earliestDepartureDate} to ${request.latestDepartureDate}`], ["Preferred departure", request.preferredDepartureDate], ["Length", `${request.nights} nights`], ["How firm", request.dateFirmness]]} />
      <PacketSection title="Rooms, meals and needs" rows={[["Rooms and occupancy", request.rooms], ["Dietary, mobility and medical", request.dietaryAndMedical], ["Accessibility", request.accessibilityNeeds.map(titleCase).join(", ")], ["Hotel level", levelLabel(request.experienceLevel)]]} />
      <PacketSection title="Money" rows={[["Budget", `${money(request.targetRetailPricePerPerson)} per person, ${request.budgetBasis || "land only"}`], ["Your net target", `${money(calculateTargetNet(request))} per person`]]} />
      <PacketSection title="What a good day looks like" rows={[["The shape of a day", request.dayShape], ["Pace", titleCase(request.pace)], ["Built around", request.desiredExperiences.map(titleCase).join(", ")], ["Must be included", request.inclusionsExpected.map(titleCase).join(", ")], ["Transport and support", request.transportationNeeds.map(titleCase).join(", ")]]} />
    </div>
    <RequirementTable request={request} />
    <HardNos request={request} />
    <GapNotice request={request} />
    <section><h2>What we are asking you to return</h2><p className="form-help">A complete proposal, not a headline price: the program you would actually operate, the dates you can hold, what is included and what is not, the net price and its assumptions, your deposit and cancellation terms, and an answer to every requirement above.</p><div className="notes"><strong>Agency notes</strong><p>{request.notes}</p></div></section></section><section><p className="eyebrow">YOUR PROFILE MATCH</p><Score value={item.match.score} /><TimingConfirmationPanel item={item} /><TagList title="Proposal must address" values={requestItems(request, item)} tone="missing" /><div className="starting-trip"><div><span>OPTIONAL STARTING POINT</span><strong>Bali Reset</strong><p>Use it if helpful, but return a complete proposal against the brief.</p></div><strong>92%</strong></div><button className="primary full" onClick={quote}>Build Full Proposal →</button></section></div></section>;
}

// An operator should not have to retype the trip it already sells. It can hand
// over the page on its own site, or the document it sends agencies, and the form
// comes back filled in — to be checked, never trusted. A page we fetched can be
// quote-checked against its own text; a document we only passed to the model
// cannot, and the panel says which of the two it is holding.
type ImportedDraft = {
  draft: Record<string, unknown>;
  evidence: { field: string; quote: string }[];
  droppedEvidence: string[];
  quoteCheck: boolean;
  caveats: string[];
};

// A draft is a starting point, not an overwrite: a field the model left empty
// keeps whatever the operator had already typed.
function mergeImportedDraft(draft: Record<string, unknown>, current: OperatorProposal): OperatorProposal {
  const filled = <T,>(value: T | null | undefined, fallback: T): T =>
    value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0) ? fallback : value;
  const figure = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
  return {
    ...current,
    programName: filled(draft.programName as string, current.programName),
    destinationId: filled(draft.destinationSlug as string, current.destinationId),
    startDate: filled(draft.startDate as string, current.startDate),
    endDate: filled(draft.endDate as string, current.endDate),
    nights: figure(draft.nights, current.nights),
    availability: filled(draft.availability as OperatorProposal["availability"], current.availability),
    groupSizeAccepted: figure(draft.groupSizeAccepted, current.groupSizeAccepted),
    hotelLevel: filled(draft.hotelLevel as string, current.hotelLevel),
    hotelNotes: filled(draft.hotelNotes as string, current.hotelNotes),
    transportation: filled(draft.transportation as string[], current.transportation),
    experiencesIncluded: filled(draft.experiencesIncluded as string[], current.experiencesIncluded),
    requirementsMet: filled(draft.requirementsMet as string[], current.requirementsMet),
    changesOrAdditions: filled(draft.changesOrAdditions as string[], current.changesOrAdditions),
    cannotProvide: filled(draft.cannotProvide as string[], current.cannotProvide),
    finalFit: figure(draft.finalFit, current.finalFit),
    netPricePerPerson: figure(draft.netPricePerPerson, current.netPricePerPerson),
    currency: filled(draft.currency as string, current.currency),
    pricingAssumptions: filled(draft.pricingAssumptions as string, current.pricingAssumptions),
    depositPercent: figure(draft.depositPercent, current.depositPercent),
    depositDueDaysBefore: figure(draft.depositDueDaysBefore, current.depositDueDaysBefore),
    finalHeadcountDaysBefore: figure(draft.finalHeadcountDaysBefore, current.finalHeadcountDaysBefore),
    finalPaymentDaysBefore: figure(draft.finalPaymentDaysBefore, current.finalPaymentDaysBefore),
    travelerNamesDaysBefore: figure(draft.travelerNamesDaysBefore, current.travelerNamesDaysBefore),
    roomReleaseDaysBefore: figure(draft.roomReleaseDaysBefore, current.roomReleaseDaysBefore),
    operatorNotes: filled(draft.operatorNotes as string, current.operatorNotes),
  };
}

function ImportPanel({ token, request, proposal, setProposal }: { token: string; request: TripRequest; proposal: OperatorProposal; setProposal: (value: OperatorProposal) => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [evidence, setEvidence] = useState<{ field: string; quote: string }[]>([]);
  const [dropped, setDropped] = useState<string[]>([]);
  const readPage = useAction(api.operatorImport.draftFromUrl);
  const readDocument = useAction(api.operatorImport.draftFromDocument);
  const askForUpload = useMutation(api.operatorImport.uploadUrl);
  // The model may only choose a destination the agency actually asked about.
  const options = (request.selectedDestinationIds.length ? request.selectedDestinationIds : destinations.map((item) => item.id))
    .map((id) => ({ slug: id, name: destinationName(id) }));

  const apply = (result: ImportedDraft, source: string) => {
    setProposal(mergeImportedDraft(result.draft ?? {}, proposal));
    setEvidence(result.evidence ?? []);
    setDropped(result.droppedEvidence ?? []);
    setNote(
      result.quoteCheck
        ? `Filled in from ${source}. The quotes it rests on are below, copied out of your own material — check them, then correct anything wrong or missing before you submit.`
        : `Filled in from ${source}. We could not check this one against its source, so treat every field as unchecked: correct anything wrong or missing before you submit.`,
    );
  };

  const readPageNow = async () => {
    setBusy("page"); setError(""); setNote(""); setEvidence([]); setDropped([]);
    try {
      apply(await readPage({ token, url: url.trim(), destinations: options }), "your page");
    } catch (cause) {
      setError(errorText(cause, "That page could not be read. Nothing below was changed."));
    } finally { setBusy(""); }
  };

  const readFile = async (file: File) => {
    setBusy("document"); setError(""); setNote(""); setEvidence([]); setDropped([]);
    try {
      const target = await askForUpload({ token });
      const uploaded = await fetch(target, { method: "POST", body: file });
      if (!uploaded.ok) throw new Error("That document could not be uploaded.");
      const { storageId } = await uploaded.json();
      apply(await readDocument({ token, storageId, filename: file.name, destinations: options }), "your document");
    } catch (cause) {
      setError(errorText(cause, "That document could not be read. Nothing below was changed."));
    } finally { setBusy(""); }
  };

  return <div className="form-card">
    <h2>Already have this trip written down?</h2>
    <p className="form-help">Point us at the page on your own site, or upload the document you already send agencies, and this form fills itself in. It is a starting point, not a submission: nothing below is sent until you press the button at the bottom, and everything stays yours to correct.</p>
    {error && <div className="inline-warning"><strong>That did not work</strong><span>{error}</span></div>}
    {note && <div className="inline-success"><strong>Filled in</strong><span>{note}</span></div>}
    {dropped.length > 0 && <div className="inline-warning"><strong>Check these by hand</strong><span>The draft named these and then quoted something that is not in your material, so those quotes were dropped:</span>{dropped.map((field) => <span key={field}>· {field}</span>)}</div>}
    {evidence.length > 0 && <div className="evidence-list"><strong>Quoted from your material</strong>{evidence.map((item) => <blockquote key={`${item.field}-${item.quote}`}><span>{item.field}</span>“{item.quote}”</blockquote>)}</div>}
    <div className="form-grid three">
      <label className="wide">A page on your own site<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://youragency.com/trips/…" /></label>
      <label className="wide">The document you send agencies<input type="file" accept=".pdf,.txt,.md,application/pdf,text/plain" disabled={Boolean(busy)} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void readFile(file); }} /></label>
    </div>
    <div className="sticky-action"><span>{busy === "page" ? "Reading your page…" : busy === "document" ? "Reading your document…" : "A full https address for the trip itself, or a PDF or text file up to 12 MB."}</span><button className="primary" disabled={Boolean(busy) || !url.trim().startsWith("https://")} onClick={() => void readPageNow()}>Read my page →</button></div>
  </div>;
}

function ProposalBuilder({ request, proposal, setProposal, token, submit }: { request: TripRequest; proposal: OperatorProposal; setProposal: (value: OperatorProposal) => void; token: string; submit: () => void }) {
  const toggle = (key: "transportation" | "experiencesIncluded" | "requirementsMet", item: string) => setProposal({ ...proposal, [key]: proposal[key].includes(item) ? proposal[key].filter((value) => value !== item) : [...proposal[key], item] });
  return <section className="workflow-section"><div className="section-heading"><p className="eyebrow">STRUCTURED OPERATOR PROPOSAL</p><h1>Tell the agency exactly what you will provide.</h1><p>This becomes the offer your agency compares and the source for operational deadlines after selection.</p></div><ImportPanel token={token} request={request} proposal={proposal} setProposal={setProposal} /><div className="form-card"><h2>What are you proposing?</h2><div className="form-grid three"><label className="wide">Program name<input value={proposal.programName} onChange={(event) => setProposal({ ...proposal, programName: event.target.value })} /></label><label>Destination<select value={proposal.destinationId} onChange={(event) => setProposal({ ...proposal, destinationId: event.target.value })}>{destinations.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Start date<input type="date" value={proposal.startDate} onChange={(event) => setProposal({ ...proposal, startDate: event.target.value })} /></label><label>End date<input type="date" value={proposal.endDate} onChange={(event) => setProposal({ ...proposal, endDate: event.target.value })} /></label><label>Nights<input type="number" value={proposal.nights} onChange={(event) => setProposal({ ...proposal, nights: Number(event.target.value) })} /></label><label className="inline-check"><input type="checkbox" checked={proposal.basedOnExistingProgram} onChange={(event) => setProposal({ ...proposal, basedOnExistingProgram: event.target.checked })} />Based on an existing program</label></div></div><div className="form-card"><h2>Can you actually do it?</h2><div className="form-grid three"><label>Live availability<select value={proposal.availability} onChange={(event) => setProposal({ ...proposal, availability: event.target.value as OperatorProposal["availability"] })}>{["Confirmation Required", "Available", "On Request", "Held", "Unavailable"].map((item) => <option key={item}>{item}</option>)}</select></label><label>Group size accepted<input type="number" value={proposal.groupSizeAccepted} onChange={(event) => setProposal({ ...proposal, groupSizeAccepted: Number(event.target.value) })} /></label><label>Hotel level<select value={proposal.hotelLevel} onChange={(event) => setProposal({ ...proposal, hotelLevel: event.target.value })}>{hotelTypes.map((item) => <option key={item}>{item}</option>)}</select></label><label className="wide">Hotel notes<input value={proposal.hotelNotes} onChange={(event) => setProposal({ ...proposal, hotelNotes: event.target.value })} /></label></div><fieldset><legend>Transportation included</legend><div className="choice-grid">{operations.slice(0, 8).map((item) => <Choice key={item} item={item} checked={proposal.transportation.includes(item)} onChange={() => toggle("transportation", item)} />)}</div></fieldset><fieldset><legend>Experiences included</legend><div className="choice-grid">{request.desiredExperiences.map((item) => <Choice key={item} item={item} checked={proposal.experiencesIncluded.includes(item)} onChange={() => toggle("experiencesIncluded", item)} />)}</div></fieldset></div><div className="form-card"><h2>Fit, changes, and gaps</h2><div className="form-grid three"><label>Final proposed fit<input type="number" min="0" max="100" value={proposal.finalFit} onChange={(event) => setProposal({ ...proposal, finalFit: Number(event.target.value) })} /></label><label className="wide">Changes or additions<textarea rows={3} value={proposal.changesOrAdditions.join("\n")} onChange={(event) => setProposal({ ...proposal, changesOrAdditions: event.target.value.split("\n").filter(Boolean) })} /></label><label className="wide">Cannot provide<textarea rows={3} value={proposal.cannotProvide.join("\n")} onChange={(event) => setProposal({ ...proposal, cannotProvide: event.target.value.split("\n").filter(Boolean) })} /></label></div></div><div className="form-card"><h2>Price and assumptions</h2><div className="form-grid three"><label>Net price / person<input type="number" value={proposal.netPricePerPerson} onChange={(event) => setProposal({ ...proposal, netPricePerPerson: Number(event.target.value) })} /></label><label>Currency<select value={proposal.currency} onChange={(event) => setProposal({ ...proposal, currency: event.target.value })}><option>USD</option><option>EUR</option><option>IDR</option></select></label><label>Deposit %<input type="number" value={proposal.depositPercent} onChange={(event) => setProposal({ ...proposal, depositPercent: Number(event.target.value) })} /></label><label className="wide">Pricing assumptions<textarea rows={3} value={proposal.pricingAssumptions} onChange={(event) => setProposal({ ...proposal, pricingAssumptions: event.target.value })} /></label></div></div><div className="form-card"><h2>Deadlines that will drive the workback schedule</h2><div className="form-grid three"><label>Deposit due · days before<input type="number" value={proposal.depositDueDaysBefore} onChange={(event) => setProposal({ ...proposal, depositDueDaysBefore: Number(event.target.value) })} /></label><label>Final headcount · days before<input type="number" value={proposal.finalHeadcountDaysBefore} onChange={(event) => setProposal({ ...proposal, finalHeadcountDaysBefore: Number(event.target.value) })} /></label><label>Final payment · days before<input type="number" value={proposal.finalPaymentDaysBefore} onChange={(event) => setProposal({ ...proposal, finalPaymentDaysBefore: Number(event.target.value) })} /></label><label>Traveler names · days before<input type="number" value={proposal.travelerNamesDaysBefore} onChange={(event) => setProposal({ ...proposal, travelerNamesDaysBefore: Number(event.target.value) })} /></label><label>Room release · days before<input type="number" value={proposal.roomReleaseDaysBefore} onChange={(event) => setProposal({ ...proposal, roomReleaseDaysBefore: Number(event.target.value) })} /></label></div><div className="deadline-list"><strong>Cancellation terms</strong>{proposal.cancellationTerms.map((item) => <span key={item.daysBefore}>{item.daysBefore} days before · {item.penalty} penalty</span>)}</div></div><div className="quote-summary"><div><small>PROPOSED NET</small><strong>{money(proposal.netPricePerPerson)}</strong></div><div><small>TARGET RETAIL</small><strong>{money(request.targetRetailPricePerPerson)}</strong></div><div><small>EST. MARGIN</small><strong>{(((request.targetRetailPricePerPerson - proposal.netPricePerPerson) / request.targetRetailPricePerPerson) * 100).toFixed(1)}%</strong></div><button className="primary" onClick={submit}>Submit Full Proposal →</button></div></section>;
}

function Submitted({ goBack, label = "Back to the request →" }: { goBack: () => void; label?: string }) {
  return <section className="portal-submitted"><div className="selected-icon">✓</div><p className="eyebrow">PROPOSAL SUBMITTED</p><h1>The agency received the complete operating proposal.</h1><p>Availability, fit, price, assumptions, deposits, deadlines, and cancellation terms are now available for comparison. The proposal is attached to the request you opened, and the agency's workspace updates the moment you submit.</p><button className="primary" onClick={goBack}>{label}</button></section>;
}

// ---------------------------------------------------------------------------
// The application root. An operator's private link opens the portal; everything
// else is the agency's own workspace, which is where the work starts.
// ---------------------------------------------------------------------------

export default function App() {
  const [token] = useState(() => readResponseToken());
  return token ? <OperatorApp token={token} /> : <AdvisorApp />;
}

function Splash({ label }: { label: string }) {
  return <main className="app-shell"><div className="splash"><span className="brand-mark">TB</span><p>{label}</p></div></main>;
}

// Convex prefixes a thrown message; the sentence after the prefix is ours.
function errorText(cause: unknown, fallback: string) {
  if (!(cause instanceof Error)) return fallback;
  const text = cause.message.replace(/^\[.*?\]\s*/, "").replace(/^Uncaught Error:\s*/, "");
  return text || fallback;
}

function AdvisorApp() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn } = useAuthActions();
  // One small state machine for the four things that need an address: create an
  // account, prove it, sign in, or get back in after forgetting the password.
  const [mode, setMode] = useState<"signUp" | "signIn" | "verify" | "reset" | "resetCode">("signUp");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const plainError = (cause: unknown) => {
    const raw = cause instanceof Error ? cause.message : "";
    if (/InvalidSecret|invalid secret/i.test(raw)) return "That password does not match. Try again, or use the reset link below.";
    if (/InvalidAccountId|not found/i.test(raw)) return "There is no account with that email yet.";
    if (/InvalidCode|invalid code/i.test(raw)) return "That code is not right, or it has expired. Ask for a new one.";
    if (/TooManyFailedAttempts/i.test(raw)) return "Too many attempts. Wait a minute and try again.";
    if (/already exists|already registered|AccountAlreadyExists/i.test(raw)) return "That email already has an account — sign in instead.";
    if (/password/i.test(raw) && /short|length|8/i.test(raw)) return "Please use at least 8 characters for the password.";
    return "That did not work. Check the address and try again.";
  };

  const submit = async () => {
    setError(""); setNotice(""); setBusy(true);
    const address = email.trim().toLowerCase();
    try {
      if (mode === "signUp") {
        await signIn("password", { email: address, password, flow: "signUp" });
        // Verification is required, so the account is not usable until the code
        // comes back. Saying so is the difference between a wait and a bug.
        setMode("verify"); setCode("");
        setNotice(`We sent a code to ${address}. It expires in fifteen minutes.`);
      } else if (mode === "verify") {
        await signIn("password", { email: address, code: code.trim(), flow: "email-verification" });
      } else if (mode === "signIn") {
        await signIn("password", { email: address, password, flow: "signIn" });
      } else if (mode === "reset") {
        await signIn("password", { email: address, flow: "reset" });
        setMode("resetCode"); setCode(""); setPassword("");
        setNotice(`If ${address} has an account, a reset code is on its way.`);
      } else {
        await signIn("password", { email: address, code: code.trim(), newPassword: password, flow: "reset-verification" });
      }
    } catch (cause) { setError(plainError(cause)); }
    finally { setBusy(false); }
  };

  const go = (next: typeof mode) => { setMode(next); setError(""); setNotice(""); setCode(""); };

  if (isLoading) return <Splash label="Opening the workspace…" />;
  if (!isAuthenticated)
    return <main className="app-shell"><section className="portal-login"><div className="portal-login-card"><span className="portal-logo">TB</span><p className="eyebrow">TRIPBRIEF · ITO SOURCING</p><h1>Incoming operator finder</h1><p>Start with what the client wants. Discover the destinations that fit, qualify incoming operators by their own capability records, and ask the shortlist to confirm what they would actually operate.</p>
      {(mode === "verify" || mode === "resetCode") && <label>{mode === "verify" ? "The code we emailed you" : "The reset code" }<input autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submit(); }} placeholder="paste the code from the email" /></label>}
      {(mode === "resetCode") && <label>New password<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>}
      {(mode === "signUp" || mode === "signIn") && <label>Email<input type="email" inputMode="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@agency.example" /></label>}
      {(mode === "signUp" || mode === "signIn" || mode === "reset") && <label>Password<input type="password" autoComplete={mode === "signUp" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submit(); }} /></label>}
      {notice && <p className="login-notice">{notice}</p>}
      {error && <p role="alert" className="login-error">{error}</p>}
      <button className="primary full" disabled={busy || !email.includes("@") || ((mode === "signUp" || mode === "signIn" || mode === "resetCode") && password.length < 8) || ((mode === "verify" || mode === "resetCode") && code.trim().length < 4)} onClick={() => void submit()}>{busy ? "Working…" : mode === "signUp" ? "Create account →" : mode === "verify" ? "Confirm the code →" : mode === "signIn" ? "Sign in →" : mode === "reset" ? "Send a reset code →" : "Set the new password →"}</button>
      {mode === "signIn" && <button className="login-switch" onClick={() => go("reset")}>Forgot your password?</button>}
      {(mode === "signUp" || mode === "signIn") && <button className="login-switch" onClick={() => go(mode === "signUp" ? "signIn" : "signUp")}>{mode === "signUp" ? "I already have an account" : "Create an account instead"}</button>}
      {(mode === "verify" || mode === "reset" || mode === "resetCode") && <button className="login-switch" onClick={() => go("signIn")}>Back to signing in</button>}
      <div className="login-divider"><span>or</span></div>
      <button className="secondary full" onClick={() => { void signIn("anonymous").catch(() => setError("Could not open the workspace. Please try again.")); }}>Explore with a trial workspace</button>
      <small>A trial workspace belongs to this browser and keeps everything except sending: it can build a brief, rank operators, hand out links and compare proposals. An account keeps your work, and proving your address is what lets TripBrief send a request in your name.</small>
    </div></section></main>;
  return <Workspace />;
}

type BriefBundle = FunctionReturnType<typeof api.briefs.get>;
type ShortlistRow = NonNullable<BriefBundle>["shortlist"][number];
type DraftReply = FunctionReturnType<typeof api.proposals.draftFromReply>;

function Workspace() {
  const network = useQuery(api.network.list);
  const account = useQuery(api.accounts.me);
  const briefList = useQuery(api.briefs.list);
  // `null` means "open the newest brief"; "none" means the advisor explicitly
  // asked for a new one and nothing has been stored yet.
  const [briefChoice, setBriefId] = useState<Id<"briefs"> | "none" | null>(null);
  const briefId = briefChoice === "none" ? null : briefChoice ?? briefList?.[0]?._id ?? null;
  const bundle = useQuery(api.briefs.get, briefId ? { briefId } : "skip");
  const createBrief = useMutation(api.briefs.create);
  const saveBrief = useMutation(api.briefs.save);
  const writeDestinations = useMutation(api.briefs.setDestinations);
  const writeShortlist = useMutation(api.briefs.setShortlist);
  const decide = useMutation(api.briefs.recordDecision);
  const removeBrief = useMutation(api.briefs.remove);
  const sendRequest = useAction(api.outbound.sendRequest);
  const ensureWorkspace = useMutation(api.network.ensureWorkspace);
  const { signOut } = useAuthActions();
  const [activeView, setActiveView] = useState<AppView>("dashboard");
  const [request, setRequest] = useState<TripRequest>({ ...defaultRequest });
  const [hydrated, setHydrated] = useState<string | null>(null);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // The operator network is one live read at the root, cached under the names the demo's
  // matching engine already uses, so every ranking view sees the current records.
  if (network) cacheNetwork(network);

  // A workspace starts with the studio's fictional network. The mutation is
  // idempotent, so one call on load is enough and a later call costs nothing.
  useEffect(() => {
    void ensureWorkspace({}).catch(() => undefined);
  }, [ensureWorkspace]);

  // The brief is copied into working state once, so typing is never fighting a
  // live query. This is React's own "adjust state when an input changes" case:
  // the guard closes after one pass. Everything downstream of the brief — the
  // shortlist, the requests and every proposal — stays reactive.
  if (bundle?.brief && hydrated !== bundle.brief._id) {
    setHydrated(bundle.brief._id);
    setRequest(fromStoredBrief(bundle.brief, bundle.shortlist));
  }

  const goView = (view: AppView) => { setActiveView(view); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const report = (cause: unknown, fallback: string) => setError(errorText(cause, fallback));
  const proposals: OperatorProposal[] = (bundle?.proposals ?? []).map((proposal) => toDemoProposal({ ...proposal, id: proposal._id }));
  const shortlist = bundle?.shortlist ?? [];
  // The ranking engine takes an optional override for the one operator the demo
  // portal used to edit. The network is live now, so the override is simply that
  // operator's current record.
  const profile = operatorProfiles.find((item) => item.partnerId === "p1") ?? operatorProfiles[0] ?? demoProfile;

  const start = () => { setRequest({ ...defaultRequest }); setEmails({}); setError(""); setNotice(""); setHydrated(null); setBriefId("none"); goView("brief"); };
  const reset = () => { setRequest({ ...defaultRequest }); setEmails({}); setError(""); setNotice(""); setHydrated(null); if (briefList?.length) setBriefId(briefList[0]._id); goView("dashboard"); };

  // Step 1 stores the brief. That is what makes every later step a record rather
  // than a screen: the shortlist, the requests and the proposals hang off it.
  const saveBriefStep = async () => {
    setError("");
    try {
      if (briefId) {
        await saveBrief({ briefId, brief: briefPayload(request) });
      } else {
        const created = await createBrief({ brief: briefPayload(request), selectedDestinationSlugs: request.selectedDestinationIds });
        setBriefId(created.briefId);
        setHydrated(created.briefId);
      }
      goView("destinations");
    } catch (cause) { report(cause, "Could not save the brief."); }
  };

  const chooseDestinations = async () => {
    setError("");
    if (!briefId) { goView("destinations"); return; }
    try {
      await saveBrief({ briefId, brief: briefPayload(request) });
      await writeDestinations({ briefId, destinationSlugs: request.selectedDestinationIds });
      goView("operators");
    } catch (cause) { report(cause, "Could not save the customer-approved locations."); }
  };

  // Choosing partners is what mints each operator's private link.
  const choosePartners = async () => {
    setError("");
    if (!briefId) { setError("Save the brief first."); return; }
    try {
      await writeShortlist({
        briefId,
        operators: request.selectedPartnerIds.map((slug) => ({
          operatorSlug: slug,
          operatorName: partners.find((item) => item.id === slug)?.name ?? slug,
          capabilityToken: shortlist.find((row) => row.operatorSlug === slug)?.capabilityToken ?? newCapabilityToken(),
        })),
      });
      goView("request");
    } catch (cause) { report(cause, "Could not prepare the shortlist."); }
  };

  // Sending is one deliberate click, and it only ever reaches an address a human
  // typed. A row with no address keeps its private link as the other way in.
  const sendRequests = async () => {
    setError(""); setNotice(""); setSending(true);
    // The send path refuses this too; saying so here means the advisor is not left
    // wondering why nothing arrived.
    if (account && !account.canSend) {
      setSending(false);
      setNotice(account.reason);
      goView("responses");
      return;
    }
    let sent = 0;
    try {
      for (const row of shortlist) {
        const email = (emails[row._id] ?? row.email ?? operatorContactEmail(row.operatorSlug) ?? "").trim();
        if (!email || row.sentAt) continue;
        await sendRequest({ briefOperatorId: row._id, email });
        sent += 1;
      }
    } catch (cause) { report(cause, "The request was not sent."); }
    finally { setSending(false); }
    setNotice(sent ? `${sent} request${sent === 1 ? "" : "s"} sent from the workspace mail inbox.` : "No address was entered, so no email was sent. Each operator still has its own private link.");
    goView("responses");
  };

  const selectProposal = async (id: string) => {
    setRequest({ ...request, selectedProposalId: id, status: "Selected" });
    goView("selected");
    if (!briefId) return;
    setError("");
    try { await decide({ briefId, proposalId: id as Id<"proposals"> }); }
    catch (cause) { report(cause, "Could not record the decision."); }
  };

  // The demo operator's link, so the two-sided story can be shown end to end
  // without waiting for a real supplier to open anything.
  const addDemoLink = async () => {
    setError(""); setNotice("");
    if (!briefId) { setError("Create a brief first — an operator's link belongs to one request."); return; }
    const slugs = [...new Set([...shortlist.map((row) => row.operatorSlug), "p1"])].slice(0, 5);
    try {
      await writeShortlist({
        briefId,
        operators: slugs.map((slug) => ({
          operatorSlug: slug,
          operatorName: partners.find((item) => item.id === slug)?.name ?? slug,
          capabilityToken: shortlist.find((row) => row.operatorSlug === slug)?.capabilityToken ?? newCapabilityToken(),
        })),
      });
      setNotice("The demo operator now has a private link on this brief.");
    } catch (cause) { report(cause, "Could not create the operator's link."); }
  };

  const selectedProposal = proposals.find((proposal) => proposal.id === request.selectedProposalId) ?? proposals[0];

  // The operator panel sits outside the eight steps, so it needs to hand the
  // advisor back to wherever the brief actually is.
  const resumeView = (): AppView => {
    const status = bundle?.brief?.status;
    if (status === "selected") return "selected";
    if (status === "comparing") return "compare";
    if (status === "sent") return "request";
    return briefId ? "destinations" : "brief";
  };

  const openBrief = (id: Id<"briefs">, status: string) => {
    setBriefId(id);
    setHydrated(null);
    setError("");
    setNotice("");
    goView(status === "selected" ? "selected" : status === "comparing" ? "compare" : status === "sent" ? "request" : "destinations");
  };

  // Deleting is the one irreversible action in the product, so it is confirmed in
  // the panel and then again on the server's terms: everything the brief produced
  // goes, and the operators stay in the network.
  const deleteBrief = async () => {
    if (!briefId) return;
    setDeleting(true); setError(""); setNotice("");
    try {
      await removeBrief({ briefId });
      setBriefId("none");
      setHydrated(null);
      setRequest({ ...defaultRequest });
      setEmails({});
      setNotice("That brief and everything it produced were deleted.");
      goView("dashboard");
    } catch (cause) { setError(errorText(cause, "The brief could not be deleted.")); }
    finally { setDeleting(false); }
  };

  const viewContent = activeView === "dashboard" ? <Dashboard start={start} portal={() => goView("portal")} briefs={briefList ?? []} open={openBrief} />
    : activeView === "brief" ? <BriefForm request={request} setRequest={setRequest} next={() => void saveBriefStep()} />
    : activeView === "destinations" ? <DestinationDiscovery request={request} setRequest={setRequest} next={() => void chooseDestinations()} />
    : activeView === "operators" ? <OperatorResults request={request} profile={profile} next={() => goView("choose")} />
    : activeView === "choose" ? <ChoosePartners request={request} profile={profile} setRequest={setRequest} next={() => void choosePartners()} />
    : activeView === "request" ? <><SendPanel shortlist={shortlist} emails={emails} setEmails={setEmails} blocked={account && !account.canSend ? account.reason : ""} /><TripRequestReview request={request} profile={profile} send={() => void sendRequests()} />{sending && <div className="floating-success">Sending from the brief's own inbox…</div>}</>
    : activeView === "responses" ? <><OperatorResponses request={request} proposals={proposals} next={() => goView("compare")} />{briefId && <ReplyImport briefId={briefId} shortlist={shortlist} />}</>
    : activeView === "compare" ? <CompareProposals request={request} proposals={proposals} select={(id) => void selectProposal(id)} />
    : activeView === "selected" && selectedProposal ? <SelectedAndWorkback request={request} proposal={selectedProposal} reset={reset} />
    : activeView === "portal" ? <OperatorLinks shortlist={shortlist} briefName={request.name} createDemoLink={() => void addDemoLink()} resume={() => goView(resumeView())} deleting={deleting} onDelete={() => void deleteBrief()} />
    : <OperatorDirectory request={request} briefId={briefId} />;

  return <main className="app-shell"><BrandHeader activeView={activeView} setActiveView={goView} reset={reset} signOut={() => { void signOut(); }} account={account} /><WorkflowProgress view={activeView} go={goView} />{error && <div className="banner-error" role="alert">{error}</div>}{notice && <div className="banner-notice">{notice}</div>}{viewContent}</main>;
}

// The mail plan gives three inboxes and an agency has more briefs than that, so
// the workspace keeps a small pool and a brief takes the quietest one. Saying so
// on the surface that sends is part of being honest about the ceiling.
function MailPool() {
  const mail = useQuery(api.mailboxes.list);
  if (!mail || !mail.mailboxes.length) return null;
  return <div className="method-note mail-pool"><strong>Mail inboxes: {mail.mailboxes.length} of {mail.limit} in use</strong><span>Every request goes out from one of these. A reply is matched to the request it answers by the email thread it belongs to, so one inbox carries any number of briefs, and the quietest is reused once all {mail.limit} are open. Nothing is sent from anywhere else.</span>{mail.mailboxes.map((mailbox) => <span key={mailbox.address}>· {mailbox.address}</span>)}</div>;
}

// The operators a brief has been sent to, each with the private link it owns.
function OperatorLinks({ shortlist, briefName, createDemoLink, resume, onDelete, deleting }: { shortlist: ShortlistRow[]; briefName: string; createDemoLink: () => void; resume: () => void; onDelete: () => void; deleting: boolean }) {
  const [confirming, setConfirming] = useState(false);
  return <section className="workflow-section"><div className="section-heading split-heading"><div><p className="eyebrow">OPERATOR LINKS</p><h1>What the operator sees, through its own private link.</h1><p>Each row is one operator on one request. The link needs no account, carries no traveller detail, and can only ever read and answer that operator's own request. Open one in a new tab to drive the other side of the demo.</p></div><div className="heading-actions"><button className="secondary" onClick={createDemoLink}>Add the demo operator's link</button><button className="primary" onClick={resume}>Back to the brief's workflow →</button></div></div>{shortlist.length === 0 ? <div className="method-note"><strong>No operator links yet.</strong><span>Choose partners on {briefName || "a brief"} and each one gets its own link here.</span></div> : <div className="link-list">{shortlist.map((row) => <article key={row._id}><div><h2>{row.operatorName}</h2><p>{row.status === "submitted" ? "Proposal received" : row.sentAt ? `Request sent${row.email ? ` to ${row.email}` : ""}` : "Ready to send"}</p></div><a className="primary" href={responseLink(row.capabilityToken)} target="_blank" rel="noreferrer">Open the operator's link →</a></article>)}</div>}
    <MailPool />
    <div className="danger-zone"><div><strong>Delete this brief</strong><span>Removes the brief, its group detail, every operator on it, every response link, every proposal it received and the mail it received. It cannot be undone. The operators themselves stay in the network.</span></div>{confirming ? <div className="heading-actions"><button className="secondary" onClick={() => setConfirming(false)}>Keep it</button><button className="primary danger" disabled={deleting} onClick={onDelete}>{deleting ? "Deleting…" : "Yes, delete this brief"}</button></div> : <button className="secondary" onClick={() => setConfirming(true)}>Delete…</button>}</div>
  </section>;
}

// One address per operator, captured by hand. Nothing is prefilled with a real
// supplier: the demo runs on the private links instead.
function SendPanel({ shortlist, emails, setEmails, blocked }: { shortlist: ShortlistRow[]; emails: Record<string, string>; setEmails: (value: Record<string, string>) => void; blocked: string }) {
  if (!shortlist.length) return null;
  return <section className="workflow-section send-panel"><div className="section-heading"><p className="eyebrow">DELIVERY</p><h2>Who receives it, and how</h2><p>Add an address to email an operator from the workspace mail inbox, or hand over the private link. Either way the request reaches one named operator, and nothing is sent automatically.</p></div>{blocked && <div className="inline-warning"><strong>Sending is off for this workspace</strong><span>{blocked}</span></div>}
    <div className="bespoke-request-list">{shortlist.map((row) => <article key={row._id}><div className="request-recipient"><span>TO</span><div><h2>{row.operatorName}</h2><p>{row.sentAt ? "Request already sent" : "Not sent yet"}{row.sendError ? ` · ${row.sendError}` : ""}</p></div></div><div className="send-row"><label>Operator email<input type="email" inputMode="email" placeholder="name@operator.example" value={emails[row._id] ?? row.email ?? operatorContactEmail(row.operatorSlug)} disabled={Boolean(row.sentAt)} onChange={(event) => setEmails({ ...emails, [row._id]: event.target.value })} /></label><a className="secondary" href={responseLink(row.capabilityToken)} target="_blank" rel="noreferrer">Open its link instead</a></div></article>)}</div></section>;
}

// The address the agency reaches this operator at. It lives on the network record
// so it is entered once and lands on every request, and it stays editable because
// an operator changes address.
function OperatorContact({ slug, contactEmail }: { slug: string; contactEmail?: string }) {
  const setContactEmail = useMutation(api.network.setContactEmail);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(contactEmail ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setError(""); setBusy(true);
    try {
      await setContactEmail({ operatorSlug: slug, contactEmail: value });
      setEditing(false);
    } catch (cause) { setError(errorText(cause, "That address was not saved.")); }
    finally { setBusy(false); }
  };
  if (!editing)
    return <div className="contact-row"><span className="contact-label">Contact</span>{contactEmail ? <><a href={`mailto:${contactEmail}`}>{contactEmail}</a><button className="link-button" onClick={() => { setValue(contactEmail); setEditing(true); }}>Change</button></> : <><em>No address yet</em><button className="link-button" onClick={() => { setValue(""); setEditing(true); }}>Add one</button></>}</div>;
  return <div className="contact-row"><label>Contact email<input type="email" inputMode="email" value={value} onChange={(event) => setValue(event.target.value)} placeholder="name@operator.example" /></label><button className="secondary" onClick={() => setEditing(false)}>Cancel</button><button className="primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button>{error && <small className="contact-error">{error}</small>}</div>;
}

// Not every operator answers through a link. Some reply by email, in their own
// words and their own format. This is where that reply is read: a model drafts
// the structured proposal, every claim in the draft carries an exact quote from
// the reply, and a person corrects and records it. The model never writes.
function ReplyImport({ briefId, shortlist }: { briefId: Id<"briefs">; shortlist: ShortlistRow[] }) {
  const replies = useQuery(api.replies.list, { briefId }) ?? [];
  const draftFromReply = useAction(api.proposals.draftFromReply);
  const recordEmailed = useMutation(api.proposals.recordEmailed);
  const [slug, setSlug] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<DraftReply | null>(null);
  const waiting = shortlist.filter((row) => row.status !== "submitted");
  if (!shortlist.length) return null;

  const draft = async (operatorSlug: string, source: string) => {
    setError(""); setNotice(""); setResult(null); setBusy(true);
    try {
      const response = await draftFromReply({
        briefId,
        sourceText: source,
        destinations: destinations.map((item) => ({ slug: item.id, name: item.name })),
      });
      setSlug(operatorSlug);
      setText(source);
      setResult(response);
    } catch (cause) { setError(errorText(cause, "The draft could not be produced.")); }
    finally { setBusy(false); }
  };

  const record = async () => {
    if (!result) return;
    setError(""); setNotice(""); setBusy(true);
    try {
      await recordEmailed({
        briefId,
        operatorSlug: slug,
        sourceText: text,
        standardised: true,
        proposal: {
          ...result.draft,
          availability: result.draft.availability as OperatorProposal["availability"],
          basedOnExistingProgram: false,
          basedOnProgramSlug: "",
          cancellationTerms: [],
        },
      });
      setNotice("The proposal was recorded against that operator, with the reply kept beside it.");
      setResult(null); setText(""); setSlug("");
    } catch (cause) { setError(errorText(cause, "The proposal could not be recorded.")); }
    finally { setBusy(false); }
  };

  return <section className="workflow-section reply-panel"><div className="section-heading"><p className="eyebrow">EMAILED REPLIES</p><h2>An operator can answer in its own words</h2><p>A reply that arrives in the workspace mail inbox is matched to the operator it came from, and to the request its thread belongs to. Paste it here and a model drafts the structured proposal, quoting the reply for every claim — then you correct it and record it. Nothing is recorded until you press the button.</p></div>
    {error && <div className="inline-warning"><strong>Reply</strong><span>{error}</span></div>}
    {notice && <div className="inline-success"><strong>Recorded</strong><span>{notice}</span></div>}
    {replies.length > 0 && <div className="inbox-list">{replies.map((message) => <article key={message._id}><div><small>{new Date(message.receivedAt).toLocaleString()} · {message.fromEmail}</small><h3>{message.subject || "(no subject)"}</h3><p>{message.text.slice(0, 240)}{message.text.length > 240 ? "…" : ""}</p></div><button className="primary" disabled={busy} onClick={() => void draft(message.operatorSlug ?? waiting[0]?.operatorSlug ?? "", message.text)}>Draft a proposal from this →</button></article>)}</div>}
    {waiting.map((row) => <article className="reply-compose" key={row._id}><div><h3>{row.operatorName}</h3><p>{row.sentAt ? `Request sent${row.email ? ` to ${row.email}` : ""}` : "No request sent yet — the link is the other way in."}</p></div><label>Paste the reply<input value={slug === row.operatorSlug ? text : ""} placeholder="Paste what the operator wrote…" onChange={(event) => { setSlug(row.operatorSlug); setText(event.target.value); setResult(null); }} /></label><button className="secondary" disabled={busy || (slug !== row.operatorSlug) || text.trim().length < 20} onClick={() => void draft(row.operatorSlug, text)}>{busy && slug === row.operatorSlug ? "Drafting…" : "Draft the proposal"}</button></article>)}
    {result && <div className="draft-review"><div className="section-heading split-heading"><div><p className="eyebrow">REVIEW DRAFT · {shortlist.find((row) => row.operatorSlug === slug)?.operatorName}</p><h2>{result.draft.programName || "Untitled program"}</h2><p>The model read the reply and filled this in. Every quote below is copied from the reply; anything the reply did not say is left at zero or empty. Correct it, then record it.</p></div><span className="status-badge">{result.draft.finalFit}% final fit · {money(result.draft.netPricePerPerson)} net</span></div><div className="form-grid three"><label>Program name<input value={result.draft.programName} onChange={(event) => setResult({ ...result, draft: { ...result.draft, programName: event.target.value } })} /></label><label>Net price / person<input type="number" value={result.draft.netPricePerPerson} onChange={(event) => setResult({ ...result, draft: { ...result.draft, netPricePerPerson: Number(event.target.value) } })} /></label><label>Final proposed fit<input type="number" min="0" max="100" value={result.draft.finalFit} onChange={(event) => setResult({ ...result, draft: { ...result.draft, finalFit: Number(event.target.value) } })} /></label><label className="wide">Operator notes<textarea rows={3} value={result.draft.operatorNotes} onChange={(event) => setResult({ ...result, draft: { ...result.draft, operatorNotes: event.target.value } })} /></label></div><div className="result-detail-grid"><TagList title="Experiences it says it includes" values={result.draft.experiencesIncluded} /><TagList title="Requirements it says it meets" values={result.draft.requirementsMet} /><TagList title="It says it cannot provide" values={result.draft.cannotProvide} tone="missing" /></div>{result.droppedEvidence.length > 0 && <div className="inline-warning"><strong>Check these by hand</strong><span>The model claimed these and then quoted something the operator did not write, so the quotes were dropped:</span>{result.droppedEvidence.map((field) => <span key={field}>· {field}</span>)}</div>}
        {result.evidence.length > 0 && <div className="evidence-list"><strong>Quoted from the reply</strong>{result.evidence.map((item) => <blockquote key={`${item.field}-${item.quote}`}><span>{item.field}</span>“{item.quote}”</blockquote>)}</div>}{result.caveats.length > 0 && <div className="method-note"><strong>The model flagged</strong>{result.caveats.map((caveat) => <span key={caveat}>{caveat}</span>)}</div>}<div className="sticky-action"><span>Recording attaches this proposal to {shortlist.find((row) => row.operatorSlug === slug)?.operatorName}, with the reply kept as its source.</span><button className="primary" disabled={busy} onClick={() => void record()}>Record this proposal</button></div></div>}
  </section>;
}

// ---------------------------------------------------------------------------
// The operator's side. A private link is the whole credential: it reads that
// operator's own capability record, the request it was sent, and its proposal.
// ---------------------------------------------------------------------------

function OperatorApp({ token }: { token: string }) {
  const network = useQuery(api.network.list);
  const link = useQuery(api.network.forToken, { token });
  const brief = useQuery(api.briefs.forOperatorToken, { token });
  const stored = useQuery(api.proposals.byOperatorToken, { token });
  const saveCapability = useMutation(api.network.saveCapability);
  const submit = useMutation(api.proposals.submitByToken);
  const [view, setView] = useState<OperatorView>("workspace");
  const [profile, setProfile] = useState<OperatorProfile | null>(null);
  const [draft, setDraft] = useState<OperatorProposal | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  if (network) cacheNetwork(network);
  // On an operator's own link, the portal's fixed "this operator" reference has
  // to be the operator the link belongs to.
  if (link?.operatorSlug) focusOperator(link.operatorSlug);

  // Both of these are React's "adjust state when an input changes" case: the
  // guard closes after one pass, and the operator's edits are never overwritten.
  if (link?.capability && !profile) setProfile(toProfile(link.capability));
  if (brief && !draft) {
    const startingPoint = fromOperatorBrief(brief);
    setDraft(
      stored
        ? toDemoProposal({
            ...stored,
            id: "own-proposal",
            operatorSlug: link?.operatorSlug ?? "p1",
          })
        : blankProposal(startingPoint, link?.operatorSlug ?? "p1"),
    );
  }

  if (link === undefined) return <Splash label="Opening your request…" />;
  if (link === null)
    return <main className="app-shell"><section className="portal-submitted"><div className="selected-icon">!</div><p className="eyebrow">LINK NOT ACTIVE</p><h1>This response link is no longer active.</h1><p>Ask your agency for a current link. Nothing was read, changed or submitted.</p></section></main>;
  if (!profile) return <Splash label="Reading your capability record…" />;

  // A standing capability link carries no request: the operator is here to keep
  // its own record current. A request link carries one brief and one proposal.
  const request = brief ? fromOperatorBrief(brief) : null;
  if (request && !draft) return <Splash label="Reading the request…" />;
  const go = (next: OperatorView) => { setNotice(""); setError(""); setView(next); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const save = async () => {
    setError(""); setSaving(true);
    try {
      await saveCapability({ token, capability: toStoredCapability(profile) });
      setNotice("Capability record saved. The agency's matching uses it from this point on.");
      setView("workspace");
    } catch (cause) { setError(errorText(cause, "Could not save the capability record.")); }
    finally { setSaving(false); }
  };
  const send = async () => {
    setError(""); setSaving(true);
    try {
      if (!draft) return;
      await submit({ token, proposal: toStoredProposal(draft) });
      setView("submitted");
    } catch (cause) { setError(errorText(cause, "Could not submit the proposal.")); }
    finally { setSaving(false); }
  };

  const content = view === "workspace" ? (request ? <PartnerWorkspace profile={profile} request={request} go={go} /> : <CapabilityWorkspace profile={profile} go={() => go("profile")} />)
    : view === "profile" ? <ProfileEditor profile={profile} setProfile={setProfile} save={() => void save()} />
    : view === "request" && request ? <PartnerRequest request={request} profile={profile} quote={() => go("quote")} />
    : view === "quote" && request && draft ? <ProposalBuilder request={request} proposal={draft} setProposal={setDraft} token={token} submit={() => void send()} />
    : view === "submitted" ? <Submitted goBack={() => go("workspace")} label="Back to the request →" />
    : request ? <PartnerWorkspace profile={profile} request={request} go={go} /> : <CapabilityWorkspace profile={profile} go={() => go("profile")} />;

  return <main className="app-shell"><header className="topbar operator-topbar"><span className="brand-home"><span className="brand-mark">TB</span><span><strong>{link.operatorName}</strong><small>TripBrief operator link{request ? ` · ${request.name}` : " · capability record"}</small></span></span><nav aria-label="Operator navigation"><button className={view === "workspace" ? "nav-active" : ""} onClick={() => go("workspace")}>Workspace</button><button className={view === "profile" ? "nav-active" : ""} onClick={() => go("profile")}>Capability Record</button>{request && <button className={view === "request" || view === "quote" ? "nav-active" : ""} onClick={() => go("request")}>The Request</button>}</nav><span className="link-badge">Private link</span></header>{content}{error && <div className="banner-error" role="alert">{error}</div>}{notice && <div className="banner-notice">{notice}</div>}{saving && <div className="floating-success">Saving…</div>}</main>;
}

// What an operator sees when it opens its standing link and there is no request
// waiting: the record that decides whether it is ever matched, and nothing else.
function CapabilityWorkspace({ profile, go }: { profile: OperatorProfile; go: () => void }) {
  return <section className="workflow-section partner-workspace"><div className="portal-identity"><div><span className="portal-logo">TB</span><div><p className="eyebrow">YOUR CAPABILITY RECORD</p><h1>Keep this current, and you are matched on it</h1><span>{profile.serviceAreas.flatMap((area) => [area.country, ...area.regions]).join(" · ") || profile.locations.map(destinationName).join(" · ")}</span></div></div><button className="primary" onClick={go}>Open the capability record</button></div><div className="portal-metrics"><article><span>{profile.serviceAreas.length}</span><strong>Operating area</strong><p>With regional detail</p></article><article><span>{profile.services.length}</span><strong>Experiences</strong><p>What you can arrange</p></article><article><span>{profile.operations.length}</span><strong>Operating services</strong><p>How trips are delivered</p></article><article><span>{profile.timing.minimumLeadTimeDays}</span><strong>Day minimum lead</strong><p>Planning context</p></article></div><div className="method-note"><strong>No request is waiting on this link.</strong><span>This link is yours to keep: it is how the agency knows what you can deliver, and it is how a request reaches you when a group fits. A trip request always arrives as its own separate link.</span></div></section>;
}

// ---------------------------------------------------------------------------
// Mapping between the stored records and the shapes the ported engine uses.
// ---------------------------------------------------------------------------

type StoredBrief = {
  _id: Id<"briefs">;
  name: string;
  evaluationDate: string;
  travelMonth: string;
  travelerCount: number;
  minimumViableTravelers: number;
  confirmedTravelers: number;
  nights: number;
  earliestDepartureDate: string;
  preferredDepartureDate: string;
  latestDepartureDate: string;
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
  groupDescription?: string;
  ages?: string;
  rooms?: string;
  dietaryAndMedical?: string;
  dateFirmness?: string;
  budgetBasis?: string;
  guestOrigin?: string;
  dayShape?: string;
  inclusionsExpected?: string[];
  hardNos?: string[];
  status: string;
  selectedDestinationSlugs: string[];
  selectedProposalId: Id<"proposals"> | null;
};

function fromStoredBrief(stored: StoredBrief, shortlist: { operatorSlug: string }[]): TripRequest {
  return {
    id: stored._id,
    name: stored.name,
    evaluationDate: stored.evaluationDate,
    travelMonth: stored.travelMonth,
    travelerCount: stored.travelerCount,
    minimumViableTravelers: stored.minimumViableTravelers,
    confirmedTravelers: stored.confirmedTravelers,
    nights: stored.nights,
    earliestDepartureDate: stored.earliestDepartureDate,
    preferredDepartureDate: stored.preferredDepartureDate,
    latestDepartureDate: stored.latestDepartureDate,
    flexibleDates: stored.flexibleDates,
    proposalDecisionDate: stored.proposalDecisionDate,
    targetRetailPricePerPerson: stored.targetRetailPricePerPerson,
    flightsIncluded: stored.flightsIncluded,
    experienceLevel: stored.experienceLevel,
    pace: stored.pace,
    climates: stored.climates,
    desiredExperiences: stored.desiredExperiences,
    importantRequirements: stored.importantRequirements,
    travelerTypes: stored.travelerTypes,
    transportationNeeds: stored.transportationNeeds,
    accessibilityNeeds: stored.accessibilityNeeds,
    notes: stored.notes,
    groupDescription: stored.groupDescription ?? "",
    ages: stored.ages ?? "",
    rooms: stored.rooms ?? "",
    dietaryAndMedical: stored.dietaryAndMedical ?? "",
    dateFirmness: stored.dateFirmness ?? "",
    budgetBasis: stored.budgetBasis ?? "",
    guestOrigin: stored.guestOrigin ?? "",
    dayShape: stored.dayShape ?? "",
    inclusionsExpected: stored.inclusionsExpected ?? [],
    hardNos: stored.hardNos ?? [],
    status: stored.status === "selected" ? "Selected" : stored.status === "comparing" ? "Comparing" : stored.status === "sent" ? "Sent" : "Draft",
    selectedDestinationIds: stored.selectedDestinationSlugs,
    selectedPartnerIds: shortlist.map((row) => row.operatorSlug),
    timingOverridePartnerIds: [],
    selectedProposalId: stored.selectedProposalId,
  };
}

type OperatorBrief = {
  name: string;
  travelMonth: string;
  travelerCount: number;
  minimumViableTravelers: number;
  nights: number;
  earliestDepartureDate: string;
  preferredDepartureDate: string;
  latestDepartureDate: string;
  flexibleDates: boolean;
  proposalDecisionDate: string;
  targetRetailPricePerPerson: number;
  experienceLevel: number;
  pace: string;
  desiredExperiences: string[];
  importantRequirements: string[];
  transportationNeeds: string[];
  accessibilityNeeds: string[];
  notes: string;
  groupDescription?: string;
  ages?: string;
  rooms?: string;
  dietaryAndMedical?: string;
  dateFirmness?: string;
  budgetBasis?: string;
  guestOrigin?: string;
  dayShape?: string;
  inclusionsExpected?: string[];
  hardNos?: string[];
};

function fromOperatorBrief(brief: OperatorBrief): TripRequest {
  return {
    ...defaultRequest,
    id: "operator-view",
    name: brief.name,
    travelMonth: brief.travelMonth,
    travelerCount: brief.travelerCount,
    minimumViableTravelers: brief.minimumViableTravelers,
    confirmedTravelers: brief.minimumViableTravelers,
    nights: brief.nights,
    earliestDepartureDate: brief.earliestDepartureDate,
    preferredDepartureDate: brief.preferredDepartureDate,
    latestDepartureDate: brief.latestDepartureDate,
    flexibleDates: brief.flexibleDates,
    proposalDecisionDate: brief.proposalDecisionDate,
    targetRetailPricePerPerson: brief.targetRetailPricePerPerson,
    experienceLevel: brief.experienceLevel,
    pace: brief.pace,
    desiredExperiences: brief.desiredExperiences,
    importantRequirements: brief.importantRequirements,
    transportationNeeds: brief.transportationNeeds,
    accessibilityNeeds: brief.accessibilityNeeds,
    notes: brief.notes,
    groupDescription: brief.groupDescription ?? "",
    ages: brief.ages ?? "",
    rooms: brief.rooms ?? "",
    dietaryAndMedical: brief.dietaryAndMedical ?? "",
    dateFirmness: brief.dateFirmness ?? "",
    budgetBasis: brief.budgetBasis ?? "",
    guestOrigin: brief.guestOrigin ?? "",
    dayShape: brief.dayShape ?? "",
    inclusionsExpected: brief.inclusionsExpected ?? [],
    hardNos: brief.hardNos ?? [],
    selectedDestinationIds: [],
    selectedPartnerIds: [],
    selectedProposalId: null,
    status: "Sent",
  };
}

function briefPayload(request: TripRequest) {
  return {
    name: request.name,
    evaluationDate: request.evaluationDate,
    travelMonth: request.travelMonth,
    travelerCount: request.travelerCount,
    minimumViableTravelers: request.minimumViableTravelers,
    confirmedTravelers: request.confirmedTravelers,
    nights: request.nights,
    earliestDepartureDate: request.earliestDepartureDate,
    preferredDepartureDate: request.preferredDepartureDate,
    latestDepartureDate: request.latestDepartureDate,
    flexibleDates: request.flexibleDates,
    proposalDecisionDate: request.proposalDecisionDate,
    targetRetailPricePerPerson: request.targetRetailPricePerPerson,
    flightsIncluded: request.flightsIncluded,
    experienceLevel: request.experienceLevel,
    pace: request.pace,
    climates: request.climates,
    desiredExperiences: request.desiredExperiences,
    importantRequirements: request.importantRequirements,
    travelerTypes: request.travelerTypes,
    transportationNeeds: request.transportationNeeds,
    accessibilityNeeds: request.accessibilityNeeds,
    notes: request.notes,
    groupDescription: request.groupDescription,
    ages: request.ages,
    rooms: request.rooms,
    dietaryAndMedical: request.dietaryAndMedical,
    dateFirmness: request.dateFirmness,
    budgetBasis: request.budgetBasis,
    guestOrigin: request.guestOrigin,
    dayShape: request.dayShape,
    inclusionsExpected: request.inclusionsExpected,
    hardNos: request.hardNos,
  };
}

type StoredProposal = {
  id: string;
  operatorSlug: string;
  programName: string;
  destinationSlug: string;
  startDate: string;
  endDate: string;
  nights: number;
  availability: string;
  groupSizeAccepted?: number;
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
  basedOnExistingProgram: boolean;
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

function toDemoProposal(proposal: StoredProposal): OperatorProposal {
  return {
    id: proposal.id,
    partnerId: proposal.operatorSlug,
    programName: proposal.programName,
    basedOnExistingProgram: proposal.basedOnExistingProgram,
    readyMadeTripId: null,
    destinationId: proposal.destinationSlug,
    startDate: proposal.startDate,
    endDate: proposal.endDate,
    nights: proposal.nights,
    availability: proposal.availability as OperatorProposal["availability"],
    groupSizeAccepted: proposal.groupSizeAccepted ?? 0,
    hotelLevel: proposal.hotelLevel,
    hotelNotes: proposal.hotelNotes,
    transportation: proposal.transportation,
    experiencesIncluded: proposal.experiencesIncluded,
    requirementsMet: proposal.requirementsMet,
    changesOrAdditions: proposal.changesOrAdditions,
    cannotProvide: proposal.cannotProvide,
    finalFit: proposal.finalFit,
    netPricePerPerson: proposal.netPricePerPerson,
    currency: proposal.currency,
    pricingAssumptions: proposal.pricingAssumptions,
    depositPercent: proposal.depositPercent,
    depositDueDaysBefore: proposal.depositDueDaysBefore,
    finalHeadcountDaysBefore: proposal.finalHeadcountDaysBefore,
    finalPaymentDaysBefore: proposal.finalPaymentDaysBefore,
    travelerNamesDaysBefore: proposal.travelerNamesDaysBefore,
    roomReleaseDaysBefore: proposal.roomReleaseDaysBefore,
    cancellationTerms: proposal.cancellationTerms,
    operatorNotes: proposal.operatorNotes,
  };
}

function toStoredProposal(proposal: OperatorProposal) {
  return {
    programName: proposal.programName,
    basedOnExistingProgram: proposal.basedOnExistingProgram,
    basedOnProgramSlug: proposal.readyMadeTripId ?? "",
    destinationSlug: proposal.destinationId,
    startDate: proposal.startDate,
    endDate: proposal.endDate,
    nights: proposal.nights,
    availability: proposal.availability,
    groupSizeAccepted: proposal.groupSizeAccepted,
    hotelLevel: proposal.hotelLevel,
    hotelNotes: proposal.hotelNotes,
    transportation: proposal.transportation,
    experiencesIncluded: proposal.experiencesIncluded,
    requirementsMet: proposal.requirementsMet,
    changesOrAdditions: proposal.changesOrAdditions,
    cannotProvide: proposal.cannotProvide,
    finalFit: proposal.finalFit,
    netPricePerPerson: proposal.netPricePerPerson,
    currency: proposal.currency,
    pricingAssumptions: proposal.pricingAssumptions,
    depositPercent: proposal.depositPercent,
    depositDueDaysBefore: proposal.depositDueDaysBefore,
    finalHeadcountDaysBefore: proposal.finalHeadcountDaysBefore,
    finalPaymentDaysBefore: proposal.finalPaymentDaysBefore,
    travelerNamesDaysBefore: proposal.travelerNamesDaysBefore,
    roomReleaseDaysBefore: proposal.roomReleaseDaysBefore,
    cancellationTerms: proposal.cancellationTerms,
    operatorNotes: proposal.operatorNotes,
  };
}

// A blank proposal is only a starting point: the operator still has to say what
// it would actually operate, and the submitted form will not accept a proposal
// without a program name, a start date and a net price. The payment terms are
// prefilled from the operator's own capability record, because those are the
// terms it already told the agency it works to.
function blankProposal(request: TripRequest, operatorSlug: string): OperatorProposal {
  const timing = operatorProfiles.find((item) => item.partnerId === operatorSlug)?.timing;
  return {
    id: "draft",
    partnerId: operatorSlug,
    programName: "",
    basedOnExistingProgram: false,
    readyMadeTripId: null,
    destinationId: request.selectedDestinationIds[0] ?? destinations[0].id,
    startDate: request.preferredDepartureDate,
    endDate: "",
    nights: request.nights,
    availability: "Confirmation Required",
    groupSizeAccepted: request.travelerCount,
    hotelLevel: "",
    hotelNotes: "",
    transportation: [],
    experiencesIncluded: [],
    requirementsMet: [],
    changesOrAdditions: [],
    cannotProvide: [],
    finalFit: 0,
    netPricePerPerson: Math.round(calculateTargetNet(request)),
    currency: "USD",
    pricingAssumptions: "",
    depositPercent: timing?.depositDueDaysBefore ? 25 : 0,
    depositDueDaysBefore: timing?.depositDueDaysBefore ?? 0,
    finalHeadcountDaysBefore: timing?.finalHeadcountDaysBefore ?? 0,
    finalPaymentDaysBefore: timing?.finalPaymentDaysBefore ?? 0,
    travelerNamesDaysBefore: timing?.travelerNamesDaysBefore ?? 0,
    roomReleaseDaysBefore: timing?.roomReleaseDaysBefore ?? 0,
    cancellationTerms: timing?.cancellationDeadlines ?? [],
    operatorNotes: "",
  };
}
