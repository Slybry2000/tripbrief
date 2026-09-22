import { useEffect, useRef, useState } from "react";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import destinationSeed from "./data/destinations.json";
import requestSeed from "./data/demo-request.json";
import programSeed from "./data/programs.json";
import countryNames from "./data/countries.json";
import { buildWorkbackSchedule, calculateOperatorMatch, calculateProposalMargin, calculateTargetNet, calculateTripMatch, servesSelectedDestinations } from "./lib/matching";
import type { Destination, OperatorMatch, OperatorProfile, OperatorProposal, OperatorTiming, Partner, ReadyMadeTrip, RequirementAnswer, RequirementAnswerValue, ServiceArea, TripRequest } from "./lib/types";
import { newCapabilityToken, readResponseToken, responseLink } from "./capability";
import { buildRequirements, hardNoList, missingMusts, requirementCoverage, TIER_LABEL, type Requirement } from "./lib/requirements";
import { isAssessed, mergeDestinations, rankDestinations, type DestinationEntry, type DestinationListing } from "./lib/destinations";
import { comparisonFingerprint, type ComparisonFingerprint } from "./lib/pickFingerprint";
import { FollowUpPanel } from "./FollowUps";

// The catalog is JSON, so its per-entry strength tables infer as a union of
// shapes; through `unknown` because the file's own type is what we mean.
const destinationCatalog = destinationSeed as unknown as Destination[];

// The list an advisor chooses from is not a constant: it is the catalog above,
// plus the places this workspace's operators actually serve, plus the places the
// advisor added for a client who asked for somewhere the network has not reached.
// The matching engine reads it synchronously, so the live rows are merged in here
// the same way the operator network is.
let destinations: DestinationEntry[] = destinationCatalog.map((item) => ({ ...item, fromNetwork: false, addedByYou: false, operatorCount: 0 }));

function cacheDestinations(rows: DestinationListing[]) {
  destinations = mergeDestinations(destinationCatalog, rows);
}
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
// An operator quotes in its own currency, so a price is shown in the currency it
// was given in. An unknown code falls back to the number and the code.
const moneyIn = (value: number, currency = "USD") => {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: 0 }).format(value); }
  catch { return `${Math.round(value).toLocaleString("en-US")} ${currency}`; }
};
// A date an operator never gave is shown as missing. It must never take the page
// down with it: one emailed reply without a date used to blank three steps.
const formatDate = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date)
    : "Date not given";
};
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "TB";
const ANSWER_LABEL: Record<RequirementAnswerValue, string> = { yes: "Yes", partly: "Partly", no: "No" };
const ANSWER_MARK: Record<RequirementAnswerValue, string> = { yes: "✓", partly: "◐", no: "✕" };
// Field names from a model draft, in words an advisor reads.
const FIELD_LABEL: Record<string, string> = { programName: "Program name", destinationSlug: "Destination", startDate: "Start date", endDate: "End date", nights: "Nights", availability: "Availability", groupSizeAccepted: "Group size", hotelLevel: "Hotel level", hotelNotes: "Hotels", transportation: "Transport", experiencesIncluded: "Experiences", requirementsMet: "Operating requirements", changesOrAdditions: "Changes", cannotProvide: "Cannot provide", netPricePerPerson: "Net price", currency: "Currency", pricingAssumptions: "Pricing assumptions", depositPercent: "Deposit", depositDueDaysBefore: "Deposit due", finalHeadcountDaysBefore: "Final headcount", finalPaymentDaysBefore: "Final payment", travelerNamesDaysBefore: "Traveler names", roomReleaseDaysBefore: "Room release", operatorNotes: "Notes" };
const fieldLabel = (field: string) => FIELD_LABEL[field] ?? titleCase(field.replace(/([a-z])([A-Z])/g, "$1 $2"));
const operatorSourceLabel = (slug: string) => {
  const source = networkBySlug.get(slug)?.source;
  return source === "seed" ? "Sample operator · fictional" : source === "researched" ? "Real operator · found on the web" : "Added by you";
};
const partnerName = (slug: string) => partners.find((item) => item.id === slug)?.name ?? titleCase(slug);
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

type Account = { email: string; isTrial: boolean; canSend: boolean; reason: string; demo: boolean };

// Where a found operator's own site lives, for a link a person can check.
const domainOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

// One line per location being searched for real operators, shown on step 3 and
// on the network page. "working" while Firecrawl reads the sites.
type FindStatus = Record<string, { state: "working" | "done" | "failed"; message: string }>;

const VIEW_TITLE: Record<AppView, string> = { dashboard: "Briefs", brief: "Client needs", destinations: "Destinations", operators: "Operator matches", choose: "Choose partners", request: "Trip request", responses: "Responses", compare: "Compare trips", selected: "Selection", directory: "Operators", portal: "Operator links" };

// Small line icons for the tab bar, drawn in the text colour.
function TabIcon({ name }: { name: "briefs" | "new" | "operators" | "links" }) {
  const paths = {
    briefs: "M5 4h10l4 4v12H5z M15 4v4h4 M8 12h8 M8 16h6",
    new: "M12 5v14 M5 12h14",
    operators: "M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
    links: "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1 M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1",
  };
  return <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}

// The app's frame. A slim bar on top with where you are and who you are; on a
// phone the four places you go live in a tab bar at the thumb, and on a larger
// screen in the top bar.
function BrandHeader({ activeView, setActiveView, newBrief, reset, signOut, account }: { activeView: AppView; setActiveView: (value: AppView) => void; newBrief: () => void; reset: () => void; signOut: () => void; account: Account | null | undefined }) {
  const [menu, setMenu] = useState(false);
  const inWorkflow = orderedViews.includes(activeView);
  const tabs: { key: string; label: string; icon: "briefs" | "new" | "operators" | "links"; active: boolean; go: () => void }[] = [
    { key: "briefs", label: "Briefs", icon: "briefs", active: activeView === "dashboard" || (inWorkflow && activeView !== "brief"), go: reset },
    { key: "new", label: "New brief", icon: "new", active: activeView === "brief", go: newBrief },
    { key: "operators", label: "Operators", icon: "operators", active: activeView === "directory", go: () => setActiveView("directory") },
    { key: "links", label: "Links", icon: "links", active: activeView === "portal", go: () => setActiveView("portal") },
  ];
  const who = account ? (account.isTrial ? "Trial workspace" : account.email) : "";
  return <>
    <header className="topbar app-topbar">
      <button className="brand-home" onClick={reset} aria-label="TripBrief home"><span className="brand-mark">TB</span><span><strong>TripBrief</strong><small>Incoming operator finder</small></span></button>
      <span className="topbar-title">{VIEW_TITLE[activeView]}</span>
      <nav className="desktop-nav" aria-label="TripBrief">{tabs.map((tab) => <button key={tab.key} className={tab.active ? "nav-active" : ""} onClick={tab.go}>{tab.label}</button>)}</nav>
      <div className="account">
        <button className="account-button" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-haspopup="menu" aria-label="Account"><span className="account-avatar">{account?.isTrial ? "T" : initials(who)}</span><span className="account-label">{who}</span></button>
        {menu && <div className="account-menu" role="menu" onMouseLeave={() => setMenu(false)}><p><strong>{who}</strong><span>{account?.demo ? "Demo mode: no request reaches a real operator." : account?.isTrial ? "A trial belongs to this browser." : "Signed in."}</span></p><button role="menuitem" onClick={() => { setMenu(false); signOut(); }}>Sign out</button></div>}
      </div>
    </header>
    <nav className="tabbar" aria-label="TripBrief">{tabs.map((tab) => <button key={tab.key} className={`${tab.active ? "active" : ""} ${tab.key === "new" ? "tab-new" : ""}`} onClick={tab.go} aria-current={tab.active ? "page" : undefined}><TabIcon name={tab.icon} /><span>{tab.label}</span></button>)}</nav>
  </>;
}

function UnfiledMail() {
  const messages = useQuery(api.replies.unfiled) ?? [];
  if (!messages.length) return null;
  return <section className="resume-briefs"><div className="section-heading"><p className="eyebrow">MAIL</p><h2>Mail that could not be filed</h2><p>These arrived in one of the workspace's mail inboxes from an address no request on file was sent to, so they are held here rather than attached to a guess.</p></div><div className="inbox-list">{messages.map((message) => <article key={message._id}><div><small>{new Date(message.receivedAt).toLocaleString()} · {message.fromEmail}</small><h3>{message.subject || "(no subject)"}</h3><p>{message.text.slice(0, 240)}{message.text.length > 240 ? "…" : ""}</p></div></article>)}</div></section>;
}

function DemoNotice({ demo }: { demo: boolean }) {
  if (demo) return <aside className="demo-notice"><span>i</span>Demo mode is on. Destinations and operators are real, found on the web with the contact addresses their own sites publish. No request ever reaches them: every request goes to TripBrief's stand-in inbox, and an AI writes each operator's reply.</aside>;
  return <aside className="demo-notice"><span>i</span>Sending is always one deliberate click on one named operator, to the address on its record.</aside>;
}

function WorkflowProgress({ view, go }: { view: AppView; go: (value: AppView) => void }) {
  const current = orderedViews.indexOf(view);
  if (current < 0) return null;
  return <>
    <div className="progress-wrap eight-steps" aria-label={`Step ${current + 1} of 8`}><div className="progress-line" />{workflowSteps.map((step, index) => <button key={step} className={`${index === current ? "current" : ""} ${index < current ? "done" : ""}`} disabled={index > current} onClick={() => index <= current && go(orderedViews[index])}><span>{index < current ? "✓" : index + 1}</span><small>{step}</small></button>)}</div>
    <div className="progress-compact" aria-label={`Step ${current + 1} of 8, ${workflowSteps[current]}`}><button className="progress-back" disabled={current === 0} onClick={() => current > 0 && go(orderedViews[current - 1])} aria-label="Previous step">‹</button><div><small>Step {current + 1} of 8</small><strong>{workflowSteps[current]}</strong></div><span className="progress-track"><i style={{ width: `${((current + 1) / orderedViews.length) * 100}%` }} /></span></div>
  </>;
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

// One reply, read properly: a full-size panel over the page with the facts that
// matter on top, the operator's answers to R1..Rn as a colour-coded list, and the
// rest of the email as readable paragraphs. Previous and next step through every
// reply on the page; Esc or a click outside closes it. Reading changes nothing.
type ReaderItem = {
  id: string;
  operator: string;
  subject?: string;
  receivedAt?: number;
  text: string;
  simulated?: boolean;
  facts: [string, string][];
  action?: { label: string; run: () => void };
  attachments?: ReplyAttachment[];
};

type ReplyAttachment = FunctionReturnType<typeof api.replyAttachments.list>[number];

const fileSize = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

// What the operator attached, beside what it wrote. A kept PDF opens from our own
// storage; one we did not keep is named with the reason, so a person knows to
// look in the mailbox rather than assume there was nothing.
function ReplyAttachments({ items }: { items: ReplyAttachment[] }) {
  if (!items.length) return null;
  return <section className="reader-attachments"><h4>Attached to this reply</h4><ul>{items.map((item) => <li key={item._id} className={item.status}>{item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer">{item.filename}</a> : <strong>{item.filename}</strong>}<small>{item.status === "stored" ? `PDF · ${fileSize(item.size)} · read by the draft, but its quotes are not checked` : item.status === "pending" ? "Fetching from the mailbox…" : item.reason ?? "Not kept."}</small></li>)}</ul></section>;
}

const ANSWER_LINE = /^(R\d+)\s+(.+?)\s+\((yes|partly|no)\):\s*(.*)$/;

function ReplyBody({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let answers: { id: string; label: string; answer: RequirementAnswerValue; line: string }[] = [];
  const flushParagraph = () => {
    if (paragraph.length) blocks.push(<p key={`p${blocks.length}`}>{paragraph.join(" ")}</p>);
    paragraph = [];
  };
  const flushAnswers = () => {
    if (answers.length) blocks.push(<ol key={`a${blocks.length}`} className="reader-answers">{answers.map((item) => <li key={item.id} className={item.answer}><span className="reader-answer-id">{item.id}</span><div><strong>{item.label}</strong><p>{item.line}</p></div><span className={`reader-chip ${item.answer}`}>{ANSWER_MARK[item.answer]} {ANSWER_LABEL[item.answer]}</span></li>)}</ol>);
    answers = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const match = ANSWER_LINE.exec(line);
    if (match) { flushParagraph(); answers.push({ id: match[1], label: match[2], answer: match[3] as RequirementAnswerValue, line: match[4] }); continue; }
    flushAnswers();
    if (!line) { flushParagraph(); continue; }
    if (/:$/.test(line) && line.length < 80) { flushParagraph(); blocks.push(<h4 key={`h${blocks.length}`}>{line.replace(/:$/, "")}</h4>); continue; }
    if (/^\(Simulated reply/.test(line)) { flushParagraph(); blocks.push(<p key={`s${blocks.length}`} className="reader-simulated-note">{line}</p>); continue; }
    paragraph.push(line);
    // A line that ends a sentence ends its paragraph; a wrapped line continues it.
    if (/[.!?:)]$/.test(line)) flushParagraph();
  }
  flushParagraph();
  flushAnswers();
  return <>{blocks}</>;
}

function ReplyReader({ items, index, onIndex }: { items: ReaderItem[]; index: number | null; onIndex: (value: number | null) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const item = index === null ? null : items[index] ?? null;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (item && !dialog.open) dialog.showModal();
    if (!item && dialog.open) dialog.close();
  }, [item]);
  const step = (by: number) => { if (index !== null && items.length > 1) onIndex((index + by + items.length) % items.length); };
  const counts = item ? ["yes", "partly", "no"].map((answer) => [answer, (item.text.match(new RegExp(`^R\\d+ .+? \\(${answer}\\):`, "gm")) ?? []).length] as const).filter(([, count]) => count > 0) : [];
  // What an advisor reads first: the requirements this reply does not fully meet.
  const differs = item
    ? item.text.split("\n").map((line) => ANSWER_LINE.exec(line.trim())).filter((match): match is RegExpExecArray => match !== null && match[3] !== "yes")
    : [];
  const answered = counts.length > 0;
  return <dialog ref={ref} className="reply-reader" aria-label={item ? `Reply from ${item.operator}` : "Reply"} onClose={() => onIndex(null)} onKeyDown={(event) => { if (event.key === "ArrowRight") step(1); if (event.key === "ArrowLeft") step(-1); }} onClick={(event) => { if (event.target === event.currentTarget) onIndex(null); }}>
    {item && <div className="reader-shell">
      <header className="reader-head">
        <div><p className="eyebrow">REPLY {index! + 1} OF {items.length}{item.simulated ? " · SIMULATED IN DEMO MODE" : ""}</p><h2>{item.operator}</h2><small>{[item.subject, item.receivedAt ? new Date(item.receivedAt).toLocaleString() : ""].filter(Boolean).join(" · ")}</small></div>
        <div className="reader-nav">{items.length > 1 && <><button className="secondary" onClick={() => step(-1)} aria-label="Previous reply">‹ Prev</button><button className="secondary" onClick={() => step(1)} aria-label="Next reply">Next ›</button></>}<button className="secondary" onClick={() => onIndex(null)} aria-label="Close">Close</button></div>
      </header>
      {(item.facts.length > 0 || counts.some(([, count]) => count > 0)) && <div className="reader-facts">{item.facts.map(([label, value]) => <div key={label}><small>{label}</small><strong>{value}</strong></div>)}{counts.some(([, count]) => count > 0) && <div><small>Answers</small><strong className="reader-counts">{counts.map(([answer, count]) => <span key={answer} className={`reader-chip ${answer}`}>{count} {answer}</span>)}</strong></div>}</div>}
      <div className="reader-body">{differs.length > 0 && <section className="reader-differs"><h4>Where this reply differs from the brief</h4><ol className="reader-answers">{differs.map((match) => <li key={match[1]} className={match[3]}><span className="reader-answer-id">{match[1]}</span><div><strong>{match[2]}</strong><p>{match[4]}</p></div><span className={`reader-chip ${match[3]}`}>{ANSWER_MARK[match[3] as RequirementAnswerValue]} {ANSWER_LABEL[match[3] as RequirementAnswerValue]}</span></li>)}</ol></section>}{answered && differs.length === 0 && <p className="reader-all-met">✓ Every numbered requirement is met in full.</p>}<ReplyAttachments items={item.attachments ?? []} /><ReplyBody text={item.text} /></div>
      {item.action && <footer className="reader-foot"><button className="primary" onClick={() => { item.action!.run(); onIndex(null); }}>{item.action.label} →</button></footer>}
    </div>}
  </dialog>;
}

function PlainList({ title, values, tone = "neutral" }: { title: string; values: string[]; tone?: "neutral" | "missing" }) {
  if (!values.length) return null;
  return <div className="tag-section"><strong>{title}</strong><div className="tags">{values.map((item) => <span className={`tag ${tone}`} key={item}>{tone === "missing" ? "− " : ""}{item}</span>)}</div></div>;
}

function Score({ value, caption = "Capability Match" }: { value: number; caption?: string }) {
  return <div className="score"><strong>{value}</strong><span>%</span><small>{caption}</small></div>;
}

// The counter never counts anything the network does not hold: it is read from
// the same live query the matcher uses, so adding a researched operator or a
// destination changes it.
type BriefListing = { _id: Id<"briefs">; name: string; status: string; travelerCount: number; nights: number; selectedDestinations: string[] };

// One brief on the home list, with its own delete. Deleting asks once, in place,
// and names the brief, because it takes every proposal and reply with it.
function BriefRow({ item, open, remove }: { item: BriefListing; open: (id: Id<"briefs">, status: string) => void; remove: (id: Id<"briefs">) => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  return <article><div><h2>{item.name}</h2><p>{item.status === "selected" ? "Trip and operator selected" : item.status === "comparing" ? "Proposals received, ready to compare" : item.status === "sent" ? "Requests sent, waiting for proposals" : "Draft brief"} · {item.travelerCount} travellers · {item.nights} nights{item.selectedDestinations.length ? ` · ${item.selectedDestinations.map(destinationName).join(", ")}` : ""}</p>{confirming && <p className="delete-confirm">Delete “{item.name}” and every proposal and reply it received? This cannot be undone. Operators stay in your network.</p>}</div><div className="brief-actions">{confirming ? <><button className="secondary" disabled={busy} onClick={() => setConfirming(false)}>Keep it</button><button className="primary danger" disabled={busy} onClick={() => { setBusy(true); void remove(item._id).finally(() => { setBusy(false); setConfirming(false); }); }}>{busy ? "Deleting…" : "Yes, delete"}</button></> : <><button className="secondary" onClick={() => setConfirming(true)}>Delete</button><button className="primary" onClick={() => open(item._id, item.status)}>Open this brief →</button></>}</div></article>;
}

function Dashboard({ start, briefs, open, remove, demo }: { start: () => void; briefs: BriefListing[]; open: (id: Id<"briefs">, status: string) => void; remove: (id: Id<"briefs">) => Promise<void>; demo: boolean }) {
  return <section className="home">
    <header className="home-head"><div><p className="eyebrow">Your workspace</p><h1>{briefs.length ? "Briefs" : "Plan a group trip"}</h1><p>{briefs.length ? "Pick up any brief where it stopped, or start a new one." : "Describe the group, choose the places the client would accept, and real local operators answer with the trip they would run."}</p></div><button className="primary home-new" onClick={start}>New brief</button></header>
    {briefs.length > 0 ? <div className="link-list">{briefs.map((item) => <BriefRow key={item._id} item={item} open={open} remove={remove} />)}</div>
      : <ol className="how-it-works"><li><strong>Client needs</strong><span>The group, the dates, the budget. No destination yet.</span></li><li><strong>Places and operators</strong><span>Real destinations and real local operators, found on the web.</span></li><li><strong>Answers</strong><span>Each operator answers every requirement, side by side.</span></li><li><strong>Decision</strong><span>Pick the trip, and the schedule works back from departure.</span></li></ol>}
    <UnfiledMail />
    <DemoNotice demo={demo} />
  </section>;
}

function BriefForm({ request, setRequest, next }: { request: TripRequest; setRequest: (value: TripRequest) => void; next: () => void }) {
  const [errors, setErrors] = useState<string[]>([]);
  const update = <K extends keyof TripRequest>(key: K, value: TripRequest[K]) => setRequest({ ...request, [key]: value });
  const toggle = (key: "climates" | "desiredExperiences" | "importantRequirements" | "travelerTypes" | "transportationNeeds" | "accessibilityNeeds" | "inclusionsExpected", item: string) => update(key, request[key].includes(item) ? request[key].filter((value) => value !== item) : [...request[key], item]);
  const validate = () => {
    const nextErrors: string[] = [];
    if (request.minimumViableTravelers > request.travelerCount) nextErrors.push("Minimum viable travelers cannot exceed target group size.");
    if (request.confirmedTravelers < 0 || request.confirmedTravelers > request.travelerCount) nextErrors.push("Travelers confirmed so far must be between 0 and the target group size.");
    if (request.earliestDepartureDate > request.latestDepartureDate) nextErrors.push("Earliest departure must be before latest departure.");
    if (request.preferredDepartureDate < request.earliestDepartureDate || request.preferredDepartureDate > request.latestDepartureDate) nextErrors.push("Preferred departure must fall inside the travel window.");
    if (!request.desiredExperiences.length) nextErrors.push("Choose at least one experience.");
    setErrors(nextErrors);
    if (!nextErrors.length) next();
  };
  return <section className="workflow-section request-form"><div className="section-heading"><p className="eyebrow">STEP 1 · CLIENT NEEDS</p><h1>Describe the trip without choosing the destination first.</h1><p>The dates, group economics, experiences, operating needs, and accessibility requirements will all travel with this brief.</p></div>{errors.length > 0 && <div className="inline-warning"><strong>Review the brief</strong>{errors.map((error) => <span key={error}>{error}</span>)}</div>}
    <div className="form-card"><h2>Group and viability</h2><div className="form-grid three"><label className="wide">Brief name<input value={request.name} onChange={(event) => update("name", event.target.value)} /></label><label>Target group size<input type="number" value={request.travelerCount} onChange={(event) => update("travelerCount", Number(event.target.value))} /></label><label>Minimum viable travelers<input type="number" value={request.minimumViableTravelers} onChange={(event) => update("minimumViableTravelers", Number(event.target.value))} /></label><label>Travelers confirmed so far<input type="number" min="0" value={request.confirmedTravelers} onChange={(event) => update("confirmedTravelers", Number(event.target.value))} /></label><label>Nights<input type="number" value={request.nights} onChange={(event) => update("nights", Number(event.target.value))} /></label><label>Hotel level<select value={request.experienceLevel} onChange={(event) => update("experienceLevel", Number(event.target.value))}><option value="1">3-star</option><option value="2">4-star</option><option value="3">5-star / Luxury</option></select></label><label>Pace<select value={request.pace} onChange={(event) => update("pace", event.target.value)}><option value="relaxed">Relaxed</option><option value="balanced">Balanced</option><option value="active">Active</option></select></label><label>Target retail / person<div className="money-input"><span>$</span><input type="number" value={request.targetRetailPricePerPerson} onChange={(event) => update("targetRetailPricePerPerson", Number(event.target.value))} /></div></label></div><fieldset><legend>Who is traveling?</legend><div className="choice-grid">{travelerTypes.map((item) => <Choice key={item} item={item} checked={request.travelerTypes.includes(item)} onChange={() => toggle("travelerTypes", item)} />)}</div></fieldset></div>
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

// Where a place came from, in one line. The three sources behave differently:
// the catalog is given, the network is a fact about the operators on file, and
// an addition is a decision the advisor made.
function locationSource(entry: DestinationEntry) {
  const parts: string[] = [];
  if (entry.operatorCount > 0) parts.push(`${entry.operatorCount} operator${entry.operatorCount === 1 ? "" : "s"} in your network`);
  else if (entry.fromNetwork) parts.push("In your network, no operators on file yet");
  if (entry.addedByYou) parts.push(entry.sources?.length ? "looked up on the web" : "added by you");
  if (!parts.length) parts.push("starter catalog");
  return parts.join(", ");
}

function DestinationDiscovery({ request, setRequest, next }: { request: TripRequest; setRequest: (value: TripRequest) => void; next: () => void }) {
  const lookUp = useAction(api.places.research);
  const removeLocation = useMutation(api.destinations.remove);
  const [filter, setFilter] = useState("");
  const [picking, setPicking] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const ranked = rankDestinations(request, destinations);
  const needle = filter.trim().toLowerCase();
  const visible = needle
    ? ranked.filter(({ destination }) => `${destination.name} ${destination.country}`.toLowerCase().includes(needle))
    : ranked;
  const fromNetwork = destinations.filter((entry) => entry.operatorCount > 0).length;
  const added = destinations.filter((entry) => entry.addedByYou).length;

  const toggleDestination = (destinationId: string) => {
    // The brief carries twelve locations at most, and the rule is enforced when
    // it is saved. Saying so here is the difference between a refusal and a
    // selection that quietly disappears.
    if (!request.selectedDestinationIds.includes(destinationId) && request.selectedDestinationIds.length >= 12) {
      setError("A brief carries twelve locations at most. Deselect one before adding another.");
      return;
    }
    const selectedDestinationIds = request.selectedDestinationIds.includes(destinationId) ? request.selectedDestinationIds.filter((id) => id !== destinationId) : [...request.selectedDestinationIds, destinationId];
    setRequest({ ...request, selectedDestinationIds, selectedPartnerIds: [], selectedProposalId: null });
  };
  const selectedNames = request.selectedDestinationIds.map(destinationName);

  // The advisor types a place and nothing else. Firecrawl reads published travel
  // sources about it, and what it is good for, its climate and what to plan
  // around are filled in from them, sources attached.
  const add = async () => {
    setError(""); setNote("");
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const created = await lookUp({ name: trimmed });
      setNote(`${created.name} is on the list, filled in from published travel sources, and selected for this brief.`);
      setName(""); setPicking(false);
      if (!request.selectedDestinationIds.includes(created.slug)) toggleDestination(created.slug);
    } catch (cause) { setError(errorText(cause, "That location could not be looked up.")); }
    finally { setBusy(false); }
  };

  const drop = async (slug: string, label: string) => {
    setError(""); setNote("");
    try {
      await removeLocation({ slug });
      if (request.selectedDestinationIds.includes(slug)) toggleDestination(slug);
      setNote(`${label} is off your list.`);
    } catch (cause) { setError(errorText(cause, "That location could not be removed.")); }
  };

  return <section className="workflow-section">
    <div className="section-heading"><p className="eyebrow">STEP 2 · DESTINATION DISCOVERY & SELECTION</p><h1>Which locations is the customer interested in?</h1><p>Use the discovery scores as guidance, then select one or more locations the customer wants the agency to pursue. Only ITOs serving those locations will be considered next.</p></div>

    <div className="form-card">
      <h2>{destinations.length} locations to choose from</h2>
      <p className="form-help">{fromNetwork} of them have an operator in your network, {added} you added yourself, and the rest are the starter catalog. A location the network has never been to is still a location you can win: add it here, and step 3 finds real operators there.</p>
      {error && <div className="inline-warning"><strong>That did not work</strong><span>{error}</span></div>}
      {note && <div className="inline-success"><strong>On the list</strong><span>{note}</span></div>}
      <div className="form-grid three"><label className="wide">Find a location<input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Country or place name" /></label></div>
      <div className="sticky-action">
        <span>{picking ? "A name, its country, and what it is genuinely strong for." : "Every place the client might accept, scored against this brief wherever we can score it."}</span>
        <button className="secondary" onClick={() => { setPicking(!picking); setError(""); }}>{picking ? "Close" : "+ Add a location"}</button>
      </div>
      {picking && <div className="form-grid three"><label className="wide">Country or place<input list="country-names" value={name} autoFocus onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && name.trim()) void add(); }} placeholder="Start typing: Vietnam, Peru, Japan…" /></label><datalist id="country-names">{(countryNames).map((item) => <option key={item} value={item} />)}</datalist></div>}
      {picking && <div className="sticky-action"><span>{busy ? `Reading published travel sources about ${name.trim()}… about twenty seconds.` : "Pick a country from the list, or type any place. Nothing else to fill in: the web does the rest."}</span><button className="primary" disabled={busy || !name.trim()} onClick={() => void add()}>{busy ? "Looking it up…" : "Look it up and add"}</button></div>}
    </div>

    <div className="destination-discovery-grid selectable-destinations">
      {visible.map(({ destination, score }, index) => {
        const strengthsForBrief = request.desiredExperiences.filter((item) => (destination.experienceStrengths[item] ?? 0) >= 4);
        const selected = request.selectedDestinationIds.includes(destination.id);
        return <article className={`destination-discovery-card ${selected ? "selected" : ""}`} key={destination.id}>
          <span className="destination-rank">#{index + 1}</span>
          <label className={`destination-select ${selected ? "checked" : ""}`}><input type="checkbox" checked={selected} onChange={() => toggleDestination(destination.id)} /><span>{selected ? "Selected" : "+ Select location"}</span></label>
          <div>
            <p>{destination.country || "Country not recorded"}</p>
            <h2>{destination.name}</h2>
            {destination.description && <span>{destination.description}</span>}
            <small>{locationSource(destination)}</small>{destination.sources && destination.sources.length > 0 && <small className="source-line">From {destination.sources.slice(0, 3).map((item) => <a key={item.url} href={item.url} target="_blank" rel="noreferrer">{domainOf(item.url)}</a>).reduce<React.ReactNode[]>((all, link, index) => index ? [...all, ", ", link] : [link], [])}</small>}
            {destination.addedByYou && <button className="link-button" onClick={() => void drop(destination.id, destination.name)}>Remove from my list</button>}
          </div>
          {isAssessed(destination) ? <Score value={score} caption="Destination Fit" /> : <div className="score"><strong>&mdash;</strong><small>Not assessed yet</small></div>}
          <TagList title="Strong for this brief" values={strengthsForBrief} />
          <div className="watchouts"><strong>Planning notes</strong>{destination.watchOuts.length ? destination.watchOuts.map((item) => <span key={item}>{item}</span>) : <span>No planning notes yet</span>}</div>
        </article>;
      })}
    </div>
    {visible.length === 0 && <div className="method-note"><strong>{destinations.length} locations are on the list, none of them matching that search.</strong><span>Clear the box, or add what the client asked for as a new location.</span></div>}

    <div className="method-note"><strong>Nothing is requested automatically.</strong><span>This selection only narrows the ITO shortlist. The advisor chooses the operators separately and review the request before sending it.</span></div>
    <div className="sticky-action"><span>{selectedNames.length ? <><strong>{selectedNames.length}</strong> selected: {selectedNames.join(", ")}</> : "Select at least one customer-approved location."}</span><button className="primary" disabled={!selectedNames.length} onClick={next}>Find ITOs in Selected Locations <span>{"\u2192"}</span></button></div>
  </section>;
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
  return <article className="operator-result-card"><span className="operator-rank">#{rank}</span><div className="operator-result-head"><div><p>{item.profile.serviceAreas.map((area) => `${area.country} · ${area.regions.join(", ")}`).join(" | ")}</p><h2>{item.partner.name}</h2><span>{operatorSourceLabel(item.partner.id)}{operatorWebsite(item.partner.id) && <> · <a href={operatorWebsite(item.partner.id)} target="_blank" rel="noreferrer">{domainOf(operatorWebsite(item.partner.id))}</a></>}{item.partner.contactEmail && <> · {item.partner.contactEmail}</>}</span></div><Score value={item.match.score} /></div><CapabilityBreakdown match={item.match} /><TimingConfirmationPanel item={item} /><div className="result-detail-grid"><TagList title="Strong match" values={[...item.match.matchedServices, ...item.match.matchedOperations].slice(0, 10)} /><TagList title="Missing or needs confirmation" values={missing.slice(0, 8)} tone={missing.length ? "missing" : "match"} /></div>{item.bestTrip ? <div className="supporting-program"><div><small>OPTIONAL EXISTING PROGRAM</small><strong>{item.bestTrip.name}</strong><span>{item.bestTripScore}% trip similarity · useful context only</span></div><b>Does not affect capability rank</b></div> : <div className="supporting-program custom"><div><small>CUSTOM / À LA CARTE</small><strong>No ready-made program listed</strong><span>Operator can recommend a program from scratch.</span></div><b>Equal matching treatment</b></div>}</article>;
}

function FindRealOperators({ places, status, find }: { places: string[]; status: FindStatus; find: (slugs: string[]) => void }) {
  if (!places.length) return null;
  return <div className="find-real"><div><p className="eyebrow">REAL OPERATORS, FROM THE WEB</p><p>Firecrawl searches published websites for incoming tour operators and destination management companies, reads each company's own site, and keeps the contact address it publishes. The first search for a place takes about a minute; after that it is instant.</p></div><ul>{places.map((slug) => { const line = status[slug]; const serving = partners.filter((partner) => partner.destinations.includes(slug)).length; return <li key={slug} className={line?.state ?? ""}><strong>{destinationName(slug)}</strong><span>{line?.state === "working" ? "Searching the web and reading operator sites…" : line?.message || `${serving} operator${serving === 1 ? "" : "s"} in your network`}</span><button className="secondary" disabled={line?.state === "working"} onClick={() => find([slug])}>{line?.state === "working" ? "Searching…" : serving ? "Find more" : "Find operators"}</button></li>; })}</ul></div>;
}

function OperatorResults({ request, profile, next, findStatus, find }: { request: TripRequest; profile: OperatorProfile; next: () => void; findStatus: FindStatus; find: (slugs: string[]) => void }) {
  const ranked = operatorRanking(request, profile, true);
  const searching = request.selectedDestinationIds.some((slug) => findStatus[slug]?.state === "working");
  return <section className="workflow-section wide-section"><div className="section-heading"><p className="eyebrow">STEP 3 · MATCHING INCOMING TOUR OPERATORS</p><h1>Which ITO profiles are capable enough to ask?</h1><p>Showing only operators that serve the customer-selected locations: <strong>{request.selectedDestinationIds.map(destinationName).join(", ")}</strong>. Capability Match ranks those operators using what their own websites say; requested dates and live availability remain unconfirmed.</p></div><FindRealOperators places={request.selectedDestinationIds} status={findStatus} find={find} />{ranked.length === 0 && <div className="method-note"><strong>{searching ? "Finding real operators…" : "No operators here yet."}</strong><span>{searching ? "They appear below as each company's site is read." : "Use Find operators above to search the web for this location."}</span></div>}<div className="scoring-contract"><strong>Capability Match</strong><span>35% experiences</span><span>20% operations</span><span>15% destination</span><span>10% group</span><span>10% accommodation</span><span>10% commercial</span><em>Request timing awaits ITO response</em></div><div className="result-section-title"><div><span className="status-dot viable" /><div><h2>Capability-ranked ITOs for selected locations</h2><p>{ranked.length} operators serve at least one selected location. Shortlist the ones whose profile capabilities justify preparing a request.</p></div></div></div><div className="operator-results">{ranked.map((item, index) => <OperatorResultCard key={item.partner.id} item={item} rank={index + 1} />)}</div><div className="sticky-action"><span><strong>{ranked.length}</strong> matching profiles · no request has been prepared or sent</span><button className="primary" onClick={next}>Choose Partners <span>→</span></button></div></section>;
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

function TripRequestReview({ request, profile, send, canSend, demo }: { request: TripRequest; profile: OperatorProfile; send: () => void; canSend: boolean; demo: boolean }) {
  const selected = operatorRanking(request, profile, true).filter((item) => request.selectedPartnerIds.includes(item.partner.id));
  return <section className="workflow-section"><div className="section-heading"><p className="eyebrow">STEP 5 · SEND TRIP REQUEST</p><h1>One core brief, with operator-specific questions.</h1><p>This is the first time each ITO is asked to judge the requested timing. Existing programs may be referenced as context, but every operator must reply with dates and availability it can stand behind.</p></div><div className="brief-strip v2"><div><strong>{request.name}</strong><span>{request.travelerCount} target · {request.minimumViableTravelers} minimum viable · {request.nights} nights</span></div><div><small>TRAVEL WINDOW TO CONFIRM</small><strong>{formatDate(request.earliestDepartureDate)}–{formatDate(request.latestDepartureDate)}</strong></div><div><small>TARGET OPERATOR NET</small><strong>{money(calculateTargetNet(request))}</strong></div></div><div className="bespoke-request-list">{selected.map((item) => <article key={item.partner.id}><div className="request-recipient"><span>TO</span><div><h2>{item.partner.name}</h2><p>{item.profile.locations.map(destinationName).join(", ")}</p></div><Score value={item.match.score} /></div><TagList title="Profile already supports" values={[...item.match.matchedServices, ...item.match.matchedOperations].slice(0, 10)} /><TagList title="Please answer in the proposal" values={requestItems(request, item)} tone="missing" />{item.bestTrip ? <p className="reference-trip"><strong>Optional reference:</strong> {item.bestTrip.name} appears {item.bestTripScore}% similar. Confirm what changes, availability, and pricing are required.</p> : <p className="reference-trip"><strong>Custom request:</strong> No existing program is required. Recommend the trip you would actually operate.</p>}</article>)}</div><div className="send-box"><div><strong>{demo ? `Send to ${selected.length} operator${selected.length === 1 ? "" : "s"} (demo mode)` : canSend ? `Send to ${selected.length} operator${selected.length === 1 ? "" : "s"}` : `${selected.length} private operator link${selected.length === 1 ? "" : "s"} ready`}</strong><p>{demo ? "Each request is a real email, delivered to TripBrief's stand-in inbox instead of the operator. An AI answers as each operator within about a minute, and the answers fill the comparison on their own." : canSend ? "Each operator with an address above gets its own email from your workspace inbox. An operator without an address answers through its private link." : "This trial workspace does not send email. Open each operator's link above to answer as that operator, then come back to see the proposal arrive."}</p></div><button className="primary" onClick={send}>{canSend ? "Send Trip Requests" : "Continue to Responses"} <span>→</span></button></div></section>;
}

function OperatorResponses({ request, proposals, shortlist, next }: { request: TripRequest; proposals: OperatorProposal[]; shortlist: ShortlistRow[]; next: () => void }) {
  const selectedPartners = partners.filter((partner) => request.selectedPartnerIds.includes(partner.id));
  const received = proposals.filter((proposal) => request.selectedPartnerIds.includes(proposal.partnerId));
  const requirements = buildRequirements(request);
  const emailed = shortlist.filter((row) => row.sentAt).length;
  const demoSent = shortlist.some((row) => row.deliveredTo);
  const [reading, setReading] = useState<number | null>(null);
  const readable: ReaderItem[] = received.filter((proposal) => proposal.sourceText?.trim()).map((proposal) => ({
    id: proposal.id,
    operator: partnerName(proposal.partnerId),
    text: proposal.sourceText ?? "",
    simulated: proposal.simulated,
    facts: [["Dates", `${formatDate(proposal.startDate)} – ${formatDate(proposal.endDate)}`], ["Net / person", moneyIn(proposal.netPricePerPerson, proposal.currency)], ["Requirements", `${requirementCoverage(requirements, proposal.requirementAnswers).score}% covered`], ["Availability", proposal.availability]],
  }));
  return <section className="workflow-section"><div className="section-heading split-heading"><div><p className="eyebrow">STEP 6 · OPERATOR RESPONSES</p><h1>Each ITO returns the trip it would actually provide.</h1><p>The response covers availability, inclusions, gaps, price assumptions, and operating deadlines, not just a headline price.</p></div><button className="primary" disabled={!received.length} onClick={next}>Compare {received.length} Proposed Trips →</button></div><div className="success-banner"><span>{emailed ? "✓" : "i"}</span><div><strong>{demoSent ? `Trip request sent to ${emailed} of ${selectedPartners.length} operators through the demo stand-in inbox. Simulated replies arrive within about a minute, and this page updates on its own.` : emailed ? `Trip request emailed to ${emailed} of ${selectedPartners.length} operators.` : `No email has been sent. Each of the ${selectedPartners.length} operators has its own private link.`}</strong><p>{received.length} of {selectedPartners.length} proposals received.</p></div></div><div className="proposal-response-grid">{selectedPartners.map((partner) => { const proposal = proposals.find((item) => item.partnerId === partner.id); return <article key={partner.id} className={proposal ? "received" : "waiting"}>{proposal ? <><div className="proposal-status"><span>{proposal.simulated ? "Simulated reply received" : "Proposal Received"}</span><b>{proposal.availability}</b></div><p>{destinationName(proposal.destinationId)}</p><h2>{proposal.programName}</h2><div className="proposal-quick-facts"><span><small>DATES</small><strong>{formatDate(proposal.startDate)}</strong></span><span><small>REQUIREMENTS</small><strong>{requirementCoverage(requirements, proposal.requirementAnswers).score}% covered</strong></span><span><small>NET / PERSON</small><strong>{moneyIn(proposal.netPricePerPerson, proposal.currency)}</strong></span><span><small>PROGRAM TYPE</small><strong>{proposal.basedOnExistingProgram ? "Adapted existing" : "Custom build"}</strong></span></div><TagList title="Included" values={proposal.experiencesIncluded.slice(0, 8)} /><PlainList title="Changes or additions" values={proposal.changesOrAdditions} /><PlainList title="Cannot provide" values={proposal.cannotProvide} tone="missing" />{proposal.operatorNotes.trim() && <p className="proposal-note">“{proposal.operatorNotes}”</p>}{readable.some((item) => item.id === proposal.id) && <button className="secondary read-reply" onClick={() => setReading(readable.findIndex((item) => item.id === proposal.id))}>Read full reply</button>}</> : <><div className="proposal-status"><span>Awaiting Response</span></div><p>Selected ITO</p><h2>{partner.name}</h2><span className="quiet">{shortlist.find((row) => row.operatorSlug === partner.id)?.sendError || (shortlist.find((row) => row.operatorSlug === partner.id)?.deliveredTo ? "Request delivered to the stand-in inbox. The reply is being written…" : "No structured proposal has been submitted yet.")}</span></>}</article>; })}</div><ReplyReader items={readable} index={reading} onIndex={setReading} /></section>;
}

function CompareProposals({ request, proposals, live, select }: { request: TripRequest; proposals: OperatorProposal[]; live: ComparisonFingerprint | null; select: (id: string, seenFingerprint: string) => void }) {
  const received = proposals.filter((proposal) => request.selectedPartnerIds.includes(proposal.partnerId));
  // What the advisor has actually reviewed. It is taken once, when the comparison
  // first loads, and after that it only moves when they say they have looked at
  // an update. The live figures keep flowing in; a pick is made on this.
  const [reviewed, setReviewed] = useState<ComparisonFingerprint | null>(live);
  if (!reviewed && live) setReviewed(live);
  const changed = Boolean(reviewed && live && reviewed.overall !== live.overall);
  const moved = (id: string) => changed && live && reviewed ? (id in reviewed.each ? (reviewed.each[id] !== live.each[id] ? "Updated" : "") : "New reply") : "";
  const movedNames = received.filter((proposal) => moved(proposal.id)).map((proposal) => partnerName(proposal.partnerId));
  const requirements = buildRequirements(request);
  const coverageOf = (proposal: OperatorProposal) => requirementCoverage(requirements, proposal.requirementAnswers);
  const best = Math.max(0, ...received.map((proposal) => coverageOf(proposal).score));
  // A deadline the operator did not state is "not stated", never "0 days".
  const prior = (value: number) => value > 0 ? `${value} days prior` : "not stated";
  const [reading, setReading] = useState<number | null>(null);
  const readable: ReaderItem[] = received.filter((proposal) => proposal.sourceText?.trim()).map((proposal) => ({
    id: proposal.id,
    operator: partnerName(proposal.partnerId),
    text: proposal.sourceText ?? "",
    simulated: proposal.simulated,
    facts: [["Dates", `${formatDate(proposal.startDate)} – ${formatDate(proposal.endDate)}`], ["Net / person", moneyIn(proposal.netPricePerPerson, proposal.currency)], ["Requirements", `${coverageOf(proposal).score}% covered`], ["Availability", proposal.availability]],
  }));
  return <section className="workflow-section wide-section"><div className="section-heading"><p className="eyebrow">STEP 7 · COMPARE PROPOSED TRIPS</p><h1>Compare the trips, not the operator profiles.</h1><p>Each column is a proposed trip: how it answers every numbered requirement, then price, hotels, transport, remaining gaps, deposits and deadlines. Coverage is worked out from the operators' own answers, not from a score they gave themselves.</p></div>{changed && live && <div className="compare-changed" role="status"><div><strong>The comparison has updated since you started reviewing it.</strong><span>{movedNames.length ? `${movedNames.join(", ")} ${movedNames.length === 1 ? "has" : "have"} a new or revised proposal, marked below.` : "A proposal changed."} Everything shown is current. Look it over, then choose.</span></div><button className="secondary" onClick={() => setReviewed(live)}>I've reviewed the update</button></div>}<div className="proposal-compare-table"><div className="compare-labels"><span>Proposal</span><span>Coverage & availability</span><span>Commercial</span><span>Hotels & transport</span><span>Remaining gaps</span><span>Commitments</span></div>{received.map((proposal) => { const coverage = coverageOf(proposal); const margin = calculateProposalMargin(request, proposal); const top = best > 0 && coverage.score === best; return <article className={top ? "recommended" : ""} key={proposal.id}>{top && <em>★ Best requirement coverage</em>}<div>{moved(proposal.id) && <span className="updated-tag">{moved(proposal.id)}</span>}<p>{destinationName(proposal.destinationId)}</p><h2>{proposal.programName}</h2><small>{partnerName(proposal.partnerId)}</small><b>{proposal.basedOnExistingProgram ? "Adapted existing program" : "Built from scratch"}</b></div><div><strong>{coverage.score}% requirement coverage</strong><span className="availability-pill">{proposal.availability}</span><small>{formatDate(proposal.startDate)} · {proposal.nights} nights</small></div><div><strong>{moneyIn(proposal.netPricePerPerson, proposal.currency)}</strong><span>{margin ? `${(margin.margin * 100).toFixed(1)}% est. margin` : `Margin not worked out for ${proposal.currency}`}</span><small>{proposal.depositPercent ? `${proposal.depositPercent}% deposit` : "Deposit not stated"} · {proposal.currency}</small>{(proposal.unverifiedFields?.length ?? 0) > 0 && <small className="unverified-mark">From their PDF, not quote-checked: {proposal.unverifiedFields!.map(fieldLabel).join(", ")}</small>}</div><div><strong>{proposal.hotelLevel ? titleCase(proposal.hotelLevel) : "Hotel level not stated"}</strong><span>{proposal.hotelNotes}</span><small>{proposal.transportation.map(titleCase).join(", ")}</small></div><div>{coverage.mustsOpen.length > 0 && <span className="gap-line">! Must-haves not fully met: {coverage.mustsOpen.join(", ")}</span>}{proposal.cannotProvide.map((item) => <span className="gap-line" key={item}>! {item}</span>)}{!coverage.mustsOpen.length && !proposal.cannotProvide.length && <span className="clear-line">✓ No unresolved gaps</span>}<small>{proposal.changesOrAdditions.length} documented changes</small></div><div><strong>Deposit: {prior(proposal.depositDueDaysBefore)}</strong><span>Final payment: {prior(proposal.finalPaymentDaysBefore)}</span><small>Room release: {prior(proposal.roomReleaseDaysBefore)}</small>{readable.some((item) => item.id === proposal.id) && <button className="secondary read-reply" onClick={() => setReading(readable.findIndex((item) => item.id === proposal.id))}>Read their reply</button>}<button className="primary" disabled={!reviewed || changed} title={changed ? "Review the updated comparison first" : undefined} onClick={() => { if (reviewed && !changed) select(proposal.id, reviewed.overall); }}>Select Trip & ITO →</button></div></article>; })}</div><RequirementGrid requirements={requirements} proposals={received} /><ReplyReader items={readable} index={reading} onIndex={setReading} /></section>;
}

// The comparison the numbered requirements exist for: every operator's answer to
// the same question, side by side. A requirement nobody answered is shown as
// such, never as a yes.
function RequirementGrid({ requirements, proposals }: { requirements: Requirement[]; proposals: OperatorProposal[] }) {
  if (!requirements.length || !proposals.length) return null;
  return <section className="requirement-grid-section"><div className="section-heading"><p className="eyebrow">REQUIREMENT BY REQUIREMENT</p><h2>What each operator said to R1–R{requirements.length}</h2><p>Every cell is the operator's own answer; a quote means it came from their email, word for word. A blank is shown as not answered.</p></div><div className="requirement-grid-scroll"><table className="requirement-grid"><thead><tr><th scope="col">Requirement</th>{proposals.map((proposal) => <th scope="col" key={proposal.id}>{partnerName(proposal.partnerId)}<small>{proposal.programName}{proposal.simulated ? " · simulated reply" : ""}</small></th>)}</tr></thead><tbody>{requirements.map((requirement) => <tr key={requirement.key}><th scope="row"><span className="requirement-id">{requirement.id}</span> {requirement.label}<small className={`tier ${requirement.tier}`}>{TIER_LABEL[requirement.tier]}</small></th>{proposals.map((proposal) => { const answer = proposal.requirementAnswers.find((item) => item.key === requirement.key); return <td key={proposal.id} className={`answer ${answer?.answer ?? "none"}`}>{answer ? <><b>{ANSWER_MARK[answer.answer]} {ANSWER_LABEL[answer.answer]}</b>{answer.note && <span>{answer.note}</span>}{answer.quote && <q className={answer.unverified ? "unverified" : undefined}>{answer.quote}</q>}{answer.quote && answer.unverified && <small className="unverified-mark">From their PDF · not quote-checked</small>}</> : <b>Not answered</b>}</td>; })}</tr>)}</tbody><tfoot><tr><th scope="row">Coverage</th>{proposals.map((proposal) => { const coverage = requirementCoverage(requirements, proposal.requirementAnswers); return <td key={proposal.id}><b>{coverage.score}%</b><span>{coverage.yes} yes · {coverage.partly} partly · {coverage.no} no · {coverage.unanswered} not answered</span></td>; })}</tr></tfoot></table></div></section>;
}

function SelectedAndWorkback({ request, proposal, reset }: { request: TripRequest; proposal: OperatorProposal; reset: () => void }) {
  const margin = calculateProposalMargin(request, proposal);
  const schedule = buildWorkbackSchedule(request, proposal);
  return <section className="workflow-section selected-workback"><div className="selection-confirm"><div className="selected-icon">✓</div><div><p className="eyebrow">STEP 8 · SELECTED TRIP & OPERATING PARTNER</p><h1>{proposal.programName}</h1><p>Your agency will sell this proposed trip. <strong>{partnerName(proposal.partnerId)}</strong> is the behind-the-scenes operating partner.</p></div><div className="selection-commercial"><span><small>NET / PERSON</small><strong>{moneyIn(proposal.netPricePerPerson, proposal.currency)}</strong></span><span><small>EST. MARGIN</small><strong>{margin ? `${(margin.margin * 100).toFixed(1)}%` : "—"}</strong></span><span><small>LIVE AVAILABILITY</small><strong>{proposal.availability}</strong></span></div></div><div className="workback-heading"><div><p className="eyebrow">INITIAL WORKBACK SCHEDULE</p><h2>Work backward from {formatDate(proposal.startDate)}</h2><p>Contractual deadlines come from the selected proposal. Sales and viability checkpoints remain the agency's decisions.</p></div><div className="traveler-progress"><strong>{request.confirmedTravelers} confirmed so far</strong><span>{request.minimumViableTravelers} minimum viable · {request.travelerCount} target</span><div><i style={{ width: `${Math.min(100, request.confirmedTravelers / request.travelerCount * 100)}%` }} /></div></div></div><div className="go-no-go-warning"><span>!</span><div><strong>Go / No-Go Decision Required if the minimum is missed</strong><p>TripBrief never cancels anything on its own. The agency can continue, cancel, renegotiate, change price, reduce commitments, or choose another operator.</p></div></div><div className="workback-timeline">{schedule.length === 0 && <div className="inline-warning"><strong>No schedule yet</strong><span>This proposal has no valid start date, and every deadline is counted back from it. Ask the operator for the date, then record the proposal again.</span></div>}{schedule.map((item, index) => <article className={`${item.category} ${item.warning ? "warning" : ""}`} key={`${index}-${item.date}-${item.label}`}><div className="timeline-date"><strong>{formatDate(item.date)}</strong><span>{item.daysBefore ? `${item.daysBefore} days before` : "Departure"}</span></div><i /><div className="timeline-content"><span>{item.owner}</span><h3>{item.label}</h3><p>{item.detail}</p></div></article>)}</div><div className="handoff-box"><strong>Matching is complete; operations now begin.</strong><p>The capability engine answered who could deliver. This schedule answers what must happen next so the selected trip does not drift toward costly deadlines.</p></div><button className="primary" onClick={reset}>Start Another ITO Search</button></section>;
}

// The network page: who is in this workspace's operator network, how to reach
// each operator's own capability record, and how to bring another one in. It is a
// management surface rather than a ranking — the brief decides what matters for a
// particular request.
function OperatorDirectory({ findStatus, find }: { findStatus: FindStatus; find: (slugs: string[]) => void }) {
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
    <NetworkResearch findStatus={findStatus} find={find} />
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
function NetworkResearch({ findStatus, find }: { findStatus: FindStatus; find: (slugs: string[]) => void }) {
  const [slug, setSlug] = useState(destinations[0]?.id ?? "");
  return <section className="network-research"><div className="section-heading split-heading"><div><p className="eyebrow">GROW THE NETWORK</p><h2>Find real operators for any location</h2><p>Firecrawl searches published websites for incoming tour operators and destination management companies in one location, reads each company's own site, and adds it to this network with the contact address that site publishes.</p></div><label>Location<select value={slug} onChange={(event) => setSlug(event.target.value)}>{destinations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><FindRealOperators places={slug ? [slug] : []} status={findStatus} find={find} /></section>;
}

// The operator's own landing page on its private link. It shows the request and
// what the agency needs back. The agency's ranking of operators is the agency's
// own working and is never shown here.
function PartnerWorkspace({ operatorName, profile, request, go }: { operatorName: string; profile: OperatorProfile; request: TripRequest; go: (value: OperatorView) => void }) {
  const requirements = buildRequirements(request);
  return <section className="workflow-section partner-workspace"><div className="portal-identity"><div><span className="portal-logo">{initials(operatorName)}</span><div><p className="eyebrow">YOUR PRIVATE LINK</p><h1>{operatorName}</h1><span>{profile.serviceAreas.flatMap((area) => [area.country, ...area.regions]).filter(Boolean).join(" · ") || profile.locations.map(destinationName).join(" · ")}</span></div></div><button className="primary" onClick={() => go("profile")}>Open Capability Record</button></div><div className="portal-metrics"><article><span>{profile.serviceAreas.length}</span><strong>Operating area</strong><p>With regional detail</p></article><article><span>{profile.services.length}</span><strong>Experiences</strong><p>Searchable capabilities</p></article><article><span>{profile.operations.length}</span><strong>Operating services</strong><p>How trips are delivered</p></article><article><span>{profile.timing.minimumLeadTimeDays}</span><strong>Day minimum lead</strong><p>Profile planning context</p></article></div><div className="portal-columns"><section><div className="portal-section-title"><div><p className="eyebrow">INCOMING REQUEST</p><h2>{request.name}</h2></div><span className="needs-response-badge">Needs Response</span></div><div className="request-overview"><span><small>GROUP</small><strong>{request.travelerCount}</strong></span><span><small>DEPARTURE</small><strong>{formatDate(request.preferredDepartureDate)}</strong></span><span><small>WINDOW</small><strong>{request.flexibleDates ? "Flexible" : "Fixed"}</strong></span><span><small>TARGET NET</small><strong>{money(calculateTargetNet(request))}</strong></span></div><TagList title="Client needs" values={request.desiredExperiences.slice(0, 8)} tone="neutral" /><button className="primary" onClick={() => go("request")}>Review Trip Request →</button></section><aside><p className="eyebrow">WHAT THE AGENCY NEEDS BACK</p><ul className="return-list"><li>The dates you can actually operate inside the window</li><li>A yes, partly or no on each of the {requirements.length} numbered requirements</li><li>Your net price, what it includes, and its assumptions</li><li>Your deposit, payment and cancellation terms</li></ul><p className="form-help">Only this agency sees your proposal. No other operator can read it.</p></aside></div></section>;
}

function IntakeSection({ number, title, description, children }: { number: string; title: string; description: string; children: React.ReactNode }) {
  return <div className="intake-section form-card"><div className="intake-title"><span>{number}</span><div><h2>{title}</h2><p>{description}</p></div></div>{children}</div>;
}

function ProfileEditor({ operatorName, profile, setProfile, save }: { operatorName: string; profile: OperatorProfile; setProfile: (value: OperatorProfile) => void; save: () => void }) {
  const area: ServiceArea = profile.serviceAreas[0] ?? { destinationId: profile.locations[0] ?? "", country: "", regions: [], cities: [], areas: [], coverage: "regional", operatingMonths: [] };
  const setArea = (next: Partial<ServiceArea>) => setProfile({ ...profile, serviceAreas: [{ ...area, ...next }, ...profile.serviceAreas.slice(1)] });
  const splitList = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
  const toggle = (key: "locations" | "hotelTypes" | "services" | "features" | "operations" | "travelerTypes" | "groupTypes", value: string) => setProfile({ ...profile, [key]: profile[key].includes(value) ? profile[key].filter((item) => item !== value) : [...profile[key], value] });
  const commercial = profile.commercial;
  const timing = profile.timing;
  return <section className="workflow-section intake-page"><div className="section-heading split-heading"><div><p className="eyebrow">ITO CAPABILITY INTAKE</p><h1>Describe what, where, who, how, cost, and when you can deliver.</h1><p>This is supplier-product data used for matching. Ready-made programs are optional records at the end.</p></div><span className="status-badge">Your own record</span></div><div className="intake-index"><span>01 Footprint</span><span>02 Experiences</span><span>03 Operations</span><span>04 Groups & Hotels</span><span>05 Commercial</span><span>06 Timing</span><span>07 Programs</span></div>
    <IntakeSection number="01" title="Operating footprint" description="Be specific: nationwide coverage and regional expertise are not the same."><div className="form-grid three"><label className="wide">Company name<input value={operatorName} readOnly /></label><label>Country<input value={area.country} onChange={(event) => setArea({ country: event.target.value })} /></label><label>Coverage<select value={area.coverage} onChange={(event) => setArea({ coverage: event.target.value as ServiceArea["coverage"] })}><option value="nationwide">Nationwide</option><option value="regional">Regional</option><option value="local">Local</option></select></label><label className="wide">Regions<input value={area.regions.join(", ")} onChange={(event) => setArea({ regions: splitList(event.target.value) })} /></label><label className="wide">Cities<input value={area.cities.join(", ")} onChange={(event) => setArea({ cities: splitList(event.target.value) })} /></label><label className="wide">Islands / areas<input value={area.areas.join(", ")} onChange={(event) => setArea({ areas: splitList(event.target.value) })} /></label></div><fieldset><legend>Destination knowledge sets</legend><div className="choice-grid compact">{destinations.map((item) => <Choice key={item.id} item={item.id} checked={profile.locations.includes(item.id)} onChange={() => toggle("locations", item.id)} />)}</div></fieldset></IntakeSection>
    <IntakeSection number="02" title="Experiences and traveler types" description="Everything your team can reliably arrange, with room to add categories later."><fieldset><legend>Experiences and trip types</legend><div className="choice-grid">{experiences.map((item) => <Choice key={item} item={item} checked={profile.services.includes(item)} onChange={() => toggle("services", item)} />)}</div></fieldset><fieldset><legend>Traveler types served</legend><div className="choice-grid">{travelerTypes.map((item) => <Choice key={item} item={item} checked={profile.travelerTypes.includes(item)} onChange={() => toggle("travelerTypes", item)} />)}</div></fieldset></IntakeSection>
    <IntakeSection number="03" title="Operational capabilities" description="How your company moves, guides, supports, and protects travelers on the ground."><div className="choice-grid">{operations.map((item) => <Choice key={item} item={item} checked={profile.operations.includes(item)} onChange={() => toggle("operations", item)} />)}</div><label className="intake-select">Customization supported<select value={profile.customizationLevel} onChange={(event) => setProfile({ ...profile, customizationLevel: event.target.value as OperatorProfile["customizationLevel"] })}><option value="limited">Limited changes</option><option value="moderate">Moderate</option><option value="high">High</option><option value="fully_bespoke">Fully bespoke</option></select></label></IntakeSection>
    <IntakeSection number="04" title="Groups and accommodations" description="Who fits your operating model and what accommodation supply you normally contract."><div className="form-grid three"><label>Minimum group<input type="number" value={profile.minGroupSize} onChange={(event) => setProfile({ ...profile, minGroupSize: Number(event.target.value) })} /></label><label>Ideal group<input type="number" value={profile.idealGroupSize} onChange={(event) => setProfile({ ...profile, idealGroupSize: Number(event.target.value) })} /></label><label>Maximum group<input type="number" value={profile.maxGroupSize} onChange={(event) => setProfile({ ...profile, maxGroupSize: Number(event.target.value) })} /></label><label className="inline-check"><input type="checkbox" checked={profile.supportsFIT} onChange={(event) => setProfile({ ...profile, supportsFIT: event.target.checked })} />FIT / individual travelers</label></div><fieldset><legend>Group formats</legend><div className="choice-grid compact">{["fit", "small_groups", "medium_groups", "large_groups", "private_groups", "retreats"].map((item) => <Choice key={item} item={item} checked={profile.groupTypes.includes(item)} onChange={() => toggle("groupTypes", item)} />)}</div></fieldset><fieldset><legend>Accommodation types</legend><div className="choice-grid">{hotelTypes.map((item) => <Choice key={item} item={item} checked={profile.hotelTypes.includes(item)} onChange={() => toggle("hotelTypes", item)} />)}</div></fieldset></IntakeSection>
    <IntakeSection number="05" title="Budget and commercial fit" description="Typical prices per person, in the currency you quote in."><div className="form-grid three"><label>Typical net minimum<input type="number" value={commercial.typicalNetMin} onChange={(event) => setProfile({ ...profile, commercial: { ...commercial, typicalNetMin: Number(event.target.value) } })} /></label><label>Typical net maximum<input type="number" value={commercial.typicalNetMax} onChange={(event) => setProfile({ ...profile, commercial: { ...commercial, typicalNetMax: Number(event.target.value) } })} /></label><label>Currency<select value={commercial.currency} onChange={(event) => setProfile({ ...profile, commercial: { ...commercial, currency: event.target.value } })}><option>USD</option><option>EUR</option><option>IDR</option></select></label><label>Minimum trip value<input type="number" value={commercial.minimumTripValue} onChange={(event) => setProfile({ ...profile, commercial: { ...commercial, minimumTripValue: Number(event.target.value) } })} /></label><label>Typical trip value<input type="number" value={commercial.typicalTripValue} onChange={(event) => setProfile({ ...profile, commercial: { ...commercial, typicalTripValue: Number(event.target.value) } })} /></label><label>Preferred group value<input type="number" value={commercial.preferredGroupValue} onChange={(event) => setProfile({ ...profile, commercial: { ...commercial, preferredGroupValue: Number(event.target.value) } })} /></label><label className="inline-check"><input type="checkbox" checked={commercial.pricingVariesByGroupSize} onChange={(event) => setProfile({ ...profile, commercial: { ...commercial, pricingVariesByGroupSize: event.target.checked } })} />Pricing changes by group size</label></div></IntakeSection>
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

function operatorAsks(request: TripRequest) {
  return [
    `Review the full ${formatDate(request.earliestDepartureDate)}–${formatDate(request.latestDepartureDate)} window and propose dates you can actually operate`,
    "Confirm live hotel, guide, transport and activity availability",
    `Quote at or near ${money(calculateTargetNet(request))} net per person`,
    "Answer every numbered requirement with yes, partly or no",
  ];
}

const approvedNames = (request: TripRequest) => (request.approvedDestinations ?? []).map(({ slug, name }) => name || destinationName(slug));

function PartnerRequest({ request, quote }: { request: TripRequest; quote: () => void }) {
  const requirements = buildRequirements(request);
  return <section className="workflow-section"><div className="section-heading split-heading"><div><p className="eyebrow">TRIP REQUEST FROM THE AGENCY</p><h1>{request.name}</h1><p>Review the requested window, recommend the actual trip you would operate, and confirm dates, availability, fit, pricing assumptions, and deadlines.</p></div><span className="needs-response-badge">Needs Response</span></div><div className="brief-strip v2"><div><strong>{request.travelerCount} travelers · {request.minimumViableTravelers} minimum</strong><span>{request.nights} nights · {levelLabel(request.experienceLevel)} · {titleCase(request.pace)} pace</span></div><div><small>TRAVEL WINDOW TO REVIEW</small><strong>{formatDate(request.earliestDepartureDate)}–{formatDate(request.latestDepartureDate)}</strong></div><div><small>TARGET NET</small><strong>{money(calculateTargetNet(request))}</strong></div></div><div className="portal-columns request-detail"><section><div className="packet">
      <PacketSection title="Where" rows={[["Places the agency approved", approvedNames(request).join(", ")]]} />
      <PacketSection title="The group" rows={[["Who they are", request.groupDescription], ["Ages", request.ages], ["Travellers", `${request.travelerCount} to price, ${request.minimumViableTravelers} minimum viable`], ["Travelling from", request.guestOrigin]]} />
      <PacketSection title="Dates" rows={[["Window", `${request.earliestDepartureDate} to ${request.latestDepartureDate}`], ["Preferred departure", request.preferredDepartureDate], ["Length", `${request.nights} nights`], ["How firm", request.dateFirmness]]} />
      <PacketSection title="Rooms, meals and needs" rows={[["Rooms and occupancy", request.rooms], ["Dietary, mobility and medical", request.dietaryAndMedical], ["Accessibility", request.accessibilityNeeds.map(titleCase).join(", ")], ["Hotel level", levelLabel(request.experienceLevel)]]} />
      <PacketSection title="Money" rows={[["Target net", `${money(calculateTargetNet(request))} per person`], ["What it covers", request.budgetBasis || "land only"]]} />
      <PacketSection title="What a good day looks like" rows={[["The shape of a day", request.dayShape], ["Pace", titleCase(request.pace)], ["Built around", request.desiredExperiences.map(titleCase).join(", ")], ["Must be included", request.inclusionsExpected.map(titleCase).join(", ")], ["Transport and support", request.transportationNeeds.map(titleCase).join(", ")]]} />
    </div>
    <RequirementTable request={request} />
    <HardNos request={request} />
    <GapNotice request={request} />
    <section><h2>What we are asking you to return</h2><p className="form-help">A complete proposal, not a headline price: the program you would actually operate, the dates you can hold, what is included and what is not, the net price and its assumptions, your deposit and cancellation terms, and an answer to every requirement above.</p>{request.notes && <div className="notes"><strong>Agency notes</strong><p>{request.notes}</p></div>}</section></section><section><p className="eyebrow">BEFORE YOU QUOTE</p><div className="method-note"><strong>{requirements.length} numbered requirements</strong><span>The proposal form asks for a yes, partly or no on each one, with a line of explanation. A clear no is useful; a blank is not.</span></div><PlainList title="Your proposal must" values={operatorAsks(request)} /><button className="primary full" onClick={quote}>Build Full Proposal →</button></section></div></section>;
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
  const options = request.approvedDestinations?.length
    ? request.approvedDestinations.map(({ slug, name }) => ({ slug, name: name || destinationName(slug) }))
    : destinations.map((item) => ({ slug: item.id, name: item.name }));

  const apply = (result: ImportedDraft, source: string) => {
    setProposal(mergeImportedDraft(result.draft ?? {}, proposal));
    setEvidence(result.evidence ?? []);
    setDropped(result.droppedEvidence ?? []);
    setNote(
      result.quoteCheck
        ? `Filled in from ${source}. The quotes it rests on are below, copied out of your own material. Check them, then correct anything wrong or missing before you submit.`
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
    {evidence.length > 0 && <div className="evidence-list"><strong>Quoted from your material</strong>{evidence.map((item) => <blockquote key={`${item.field}-${item.quote}`}><span>{fieldLabel(item.field)}</span>“{item.quote}”</blockquote>)}</div>}
    <div className="form-grid three">
      <label className="wide">A page on your own site<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://youragency.com/trips/…" /></label>
      <label className="wide">The document you send agencies<input type="file" accept=".pdf,.txt,.md,application/pdf,text/plain" disabled={Boolean(busy)} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void readFile(file); }} /></label>
    </div>
    <div className="sticky-action"><span>{busy === "page" ? "Reading your page…" : busy === "document" ? "Reading your document…" : "A full https address for the trip itself, or a PDF or text file up to 12 MB."}</span><button className="primary" disabled={Boolean(busy) || !url.trim().startsWith("https://")} onClick={() => void readPageNow()}>Read my page →</button></div>
  </div>;
}

// One row per numbered requirement: yes, partly or no, and a line saying how. The
// same component serves the advisor reviewing a model draft of an emailed reply,
// where a quote shows which of the operator's own words the answer rests on.
function RequirementAnswers({ request, answers, setAnswers, intro }: { request: TripRequest; answers: RequirementAnswer[]; setAnswers: (value: RequirementAnswer[]) => void; intro: string }) {
  const requirements = buildRequirements(request);
  const byKey = new Map(answers.map((item) => [item.key, item]));
  const set = (key: string, patch: Partial<RequirementAnswer>) => {
    const current: RequirementAnswer = byKey.get(key) ?? { key, answer: "yes", note: "" };
    const next: RequirementAnswer = { ...current, ...patch };
    // A quote is the operator's own words for the answer the model read. Once a
    // person changes the answer, the quote no longer backs it, so it goes.
    if (patch.answer && patch.answer !== current.answer) delete next.quote;
    setAnswers([...answers.filter((item) => item.key !== key), next]);
  };
  if (!requirements.length) return null;
  return <div className="form-card"><h2>Answer each requirement</h2><p className="form-help">{intro}</p><ol className="answer-list">{requirements.map((requirement) => { const answer = byKey.get(requirement.key); return <li key={requirement.key} className={answer ? `answered ${answer.answer}` : ""}><div className="requirement-head"><span className="requirement-id">{requirement.id}</span><strong>{requirement.label}</strong><span className={`tier ${requirement.tier}`}>{TIER_LABEL[requirement.tier]}</span></div><p className="requirement-statement">{requirement.statement}</p><p className="requirement-ask">{requirement.ask}</p><div className="answer-row"><div className="answer-choices" role="radiogroup" aria-label={`${requirement.id} answer`}>{(["yes", "partly", "no"] as const).map((value) => <label key={value} className={`answer-choice ${value} ${answer?.answer === value ? "checked" : ""}`}><input type="radio" name={`answer-${requirement.key}`} checked={answer?.answer === value} onChange={() => set(requirement.key, { answer: value })} />{ANSWER_LABEL[value]}</label>)}</div><input className="answer-note" aria-label={`${requirement.id} explanation`} disabled={!answer} value={answer?.note ?? ""} placeholder={!answer ? "Choose yes, partly or no first" : answer.answer === "no" ? "What you would do instead" : "One line: how, or what changes"} onChange={(event) => set(requirement.key, { note: event.target.value })} /></div>{answer?.quote && <q className={`answer-quote${answer.unverified ? " unverified" : ""}`}>{answer.quote}</q>}{answer?.quote && answer.unverified && <small className="unverified-mark">From the attached PDF · not quote-checked</small>}</li>; })}</ol></div>;
}

function ProposalBuilder({ request, proposal, setProposal, token, submit }: { request: TripRequest; proposal: OperatorProposal; setProposal: (value: OperatorProposal) => void; token: string; submit: () => void }) {
  const [problem, setProblem] = useState("");
  const toggle = (key: "transportation" | "experiencesIncluded" | "requirementsMet", item: string) => setProposal({ ...proposal, [key]: proposal[key].includes(item) ? proposal[key].filter((value) => value !== item) : [...proposal[key], item] });
  const requirements = buildRequirements(request);
  const answered = new Set(proposal.requirementAnswers.map((item) => item.key));
  const openMusts = requirements.filter((item) => item.tier === "must" && !answered.has(item.key));
  // The places the agency approved come first; the rest of the catalog is only
  // offered when the request carries none.
  const places = request.approvedDestinations?.length
    ? request.approvedDestinations.map(({ slug, name }) => ({ id: slug, name: name || destinationName(slug) }))
    : destinations.map((item) => ({ id: item.id, name: item.name }));
  const trySubmit = () => {
    if (openMusts.length) { setProblem(`Answer the must-have requirements first: ${openMusts.map((item) => `${item.id} ${item.label}`).join(", ")}. A clear no is fine.`); return; }
    if (!proposal.programName.trim() || !proposal.startDate || proposal.netPricePerPerson <= 0) { setProblem("A proposal needs a program name, a start date and a net price."); return; }
    setProblem("");
    submit();
  };
  return <section className="workflow-section"><div className="section-heading"><p className="eyebrow">STRUCTURED OPERATOR PROPOSAL</p><h1>Tell the agency exactly what you will provide.</h1><p>This becomes the offer your agency compares and the source for operational deadlines after selection.</p></div><ImportPanel token={token} request={request} proposal={proposal} setProposal={setProposal} /><div className="form-card"><h2>What are you proposing?</h2><div className="form-grid three"><label className="wide">Program name<input value={proposal.programName} onChange={(event) => setProposal({ ...proposal, programName: event.target.value })} /></label><label>Destination<select value={proposal.destinationId} onChange={(event) => setProposal({ ...proposal, destinationId: event.target.value })}>{!places.some((item) => item.id === proposal.destinationId) && <option value={proposal.destinationId}>{destinationName(proposal.destinationId)}</option>}{places.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Start date<input type="date" value={proposal.startDate} onChange={(event) => setProposal({ ...proposal, startDate: event.target.value })} /></label><label>End date<input type="date" value={proposal.endDate} onChange={(event) => setProposal({ ...proposal, endDate: event.target.value })} /></label><label>Nights<input type="number" value={proposal.nights} onChange={(event) => setProposal({ ...proposal, nights: Number(event.target.value) })} /></label><label className="inline-check"><input type="checkbox" checked={proposal.basedOnExistingProgram} onChange={(event) => setProposal({ ...proposal, basedOnExistingProgram: event.target.checked })} />Based on an existing program</label></div></div><div className="form-card"><h2>Can you actually do it?</h2><div className="form-grid three"><label>Live availability<select value={proposal.availability} onChange={(event) => setProposal({ ...proposal, availability: event.target.value as OperatorProposal["availability"] })}>{["Confirmation Required", "Available", "On Request", "Held", "Unavailable"].map((item) => <option key={item}>{item}</option>)}</select></label><label>Group size accepted<input type="number" value={proposal.groupSizeAccepted} onChange={(event) => setProposal({ ...proposal, groupSizeAccepted: Number(event.target.value) })} /></label><label>Hotel level<select value={proposal.hotelLevel} onChange={(event) => setProposal({ ...proposal, hotelLevel: event.target.value })}><option value="">Choose…</option>{hotelTypes.map((item) => <option key={item} value={item}>{titleCase(item)}</option>)}</select></label><label className="wide">Hotel notes<input value={proposal.hotelNotes} onChange={(event) => setProposal({ ...proposal, hotelNotes: event.target.value })} /></label></div><fieldset><legend>Transportation included</legend><div className="choice-grid">{operations.slice(0, 8).map((item) => <Choice key={item} item={item} checked={proposal.transportation.includes(item)} onChange={() => toggle("transportation", item)} />)}</div></fieldset><fieldset><legend>Experiences included</legend><div className="choice-grid">{request.desiredExperiences.map((item) => <Choice key={item} item={item} checked={proposal.experiencesIncluded.includes(item)} onChange={() => toggle("experiencesIncluded", item)} />)}</div></fieldset></div><RequirementAnswers request={request} answers={proposal.requirementAnswers} setAnswers={(requirementAnswers) => setProposal({ ...proposal, requirementAnswers })} intro="One answer per numbered requirement in the request. The agency compares every operator on exactly these, side by side. Must-haves need an answer before you can submit; a clear no is useful, a blank is not." /><div className="form-card"><h2>Changes and gaps</h2><div className="form-grid three"><label className="wide">Changes or additions<textarea rows={3} value={proposal.changesOrAdditions.join("\n")} onChange={(event) => setProposal({ ...proposal, changesOrAdditions: event.target.value.split("\n").filter(Boolean) })} /></label><label className="wide">Cannot provide<textarea rows={3} value={proposal.cannotProvide.join("\n")} onChange={(event) => setProposal({ ...proposal, cannotProvide: event.target.value.split("\n").filter(Boolean) })} /></label></div></div><div className="form-card"><h2>Price and assumptions</h2><div className="form-grid three"><label>Net price / person<input type="number" value={proposal.netPricePerPerson} onChange={(event) => setProposal({ ...proposal, netPricePerPerson: Number(event.target.value) })} /></label><label>Currency<select value={proposal.currency} onChange={(event) => setProposal({ ...proposal, currency: event.target.value })}>{["USD", "EUR", "GBP", "THB", "IDR", "MXN", "CRC"].map((code) => <option key={code}>{code}</option>)}</select></label><label>Deposit %<input type="number" value={proposal.depositPercent} onChange={(event) => setProposal({ ...proposal, depositPercent: Number(event.target.value) })} /></label><label className="wide">Pricing assumptions<textarea rows={3} value={proposal.pricingAssumptions} onChange={(event) => setProposal({ ...proposal, pricingAssumptions: event.target.value })} /></label></div></div><div className="form-card"><h2>Deadlines that will drive the workback schedule</h2><div className="form-grid three"><label>Deposit due · days before<input type="number" value={proposal.depositDueDaysBefore} onChange={(event) => setProposal({ ...proposal, depositDueDaysBefore: Number(event.target.value) })} /></label><label>Final headcount · days before<input type="number" value={proposal.finalHeadcountDaysBefore} onChange={(event) => setProposal({ ...proposal, finalHeadcountDaysBefore: Number(event.target.value) })} /></label><label>Final payment · days before<input type="number" value={proposal.finalPaymentDaysBefore} onChange={(event) => setProposal({ ...proposal, finalPaymentDaysBefore: Number(event.target.value) })} /></label><label>Traveler names · days before<input type="number" value={proposal.travelerNamesDaysBefore} onChange={(event) => setProposal({ ...proposal, travelerNamesDaysBefore: Number(event.target.value) })} /></label><label>Room release · days before<input type="number" value={proposal.roomReleaseDaysBefore} onChange={(event) => setProposal({ ...proposal, roomReleaseDaysBefore: Number(event.target.value) })} /></label></div><div className="deadline-list"><strong>Cancellation terms</strong>{proposal.cancellationTerms.length ? proposal.cancellationTerms.map((item) => <span key={item.daysBefore}>{item.daysBefore} days before · {item.penalty} penalty</span>) : <span>None on your capability record yet. State them in the pricing assumptions.</span>}</div></div>{problem && <div className="inline-warning" role="alert"><strong>Not sent yet</strong><span>{problem}</span></div>}<div className="quote-summary"><div><small>YOUR NET / PERSON</small><strong>{moneyIn(proposal.netPricePerPerson, proposal.currency)}</strong></div><div><small>AGENCY'S TARGET NET</small><strong>{money(calculateTargetNet(request))}</strong></div><div><small>REQUIREMENTS ANSWERED</small><strong>{requirements.filter((item) => answered.has(item.key)).length}/{requirements.length}</strong></div><button className="primary" onClick={trySubmit}>Submit Full Proposal →</button></div></section>;
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
    if (/already exists|already registered|AccountAlreadyExists/i.test(raw)) return "That email already has an account. Sign in instead.";
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
  const destinationRows = useQuery(api.destinations.list);
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
  const [findStatus, setFindStatus] = useState<FindStatus>({});
  const findReal = useAction(api.webOperators.findForDestination);

  // The operator network is one live read at the root, cached under the names the demo's
  // matching engine already uses, so every ranking view sees the current records.
  if (network) cacheNetwork(network);
  // Same for the locations: the catalog, the network's places and the advisor's
  // own additions become one list here.
  if (destinationRows) cacheDestinations(destinationRows);

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

  const goView = (view: AppView) => { setActiveView(view); setNotice(""); setError(""); window.scrollTo({ top: 0, behavior: "smooth" }); };
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

  // Real operators for each location, found on the web. Runs on its own for a
  // chosen location with nobody in the network yet, and on request for more.
  const findOperators = (slugs: string[]) => {
    for (const slug of slugs) {
      if (findStatus[slug]?.state === "working") continue;
      setFindStatus((current) => ({ ...current, [slug]: { state: "working", message: "" } }));
      void findReal({ destinationSlug: slug, destinationName: destinationName(slug), focus: request.desiredExperiences })
        .then((result) => setFindStatus((current) => ({ ...current, [slug]: { state: "done", message: result.added ? `${result.added} real operator${result.added === 1 ? "" : "s"} added to your network${result.fromCache ? " (already researched)" : ""}` : "Every operator found is already in your network" } })))
        .catch((cause: unknown) => setFindStatus((current) => ({ ...current, [slug]: { state: "failed", message: errorText(cause, "The search did not finish. Try again.") } })));
    }
  };

  const chooseDestinations = async () => {
    setError("");
    if (!briefId) { goView("destinations"); return; }
    try {
      await saveBrief({ briefId, brief: briefPayload(request) });
      await writeDestinations({ briefId, destinationSlugs: request.selectedDestinationIds });
      goView("operators");
      findOperators(request.selectedDestinationIds.filter((slug) => !partners.some((partner) => partner.destinations.includes(slug))));
    } catch (cause) { report(cause, "Could not save the customer-approved locations."); }
  };

  // Choosing partners is what mints each operator's private link.
  const choosePartners = async () => {
    setError("");
    if (!briefId) { setError("Save the brief first."); return; }
    try {
      // The ranking position goes with each operator: in demo mode the strongest
      // match is the one whose reply meets every requirement.
      const order = operatorRanking(request, profile, true).map((item) => item.partner.id);
      await writeShortlist({
        briefId,
        operators: request.selectedPartnerIds.map((slug) => ({
          operatorSlug: slug,
          operatorName: partners.find((item) => item.id === slug)?.name ?? slug,
          capabilityToken: shortlist.find((row) => row.operatorSlug === slug)?.capabilityToken ?? newCapabilityToken(),
          rank: order.includes(slug) ? order.indexOf(slug) + 1 : 99,
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
      goView("responses");
      setNotice(account.reason);
      return;
    }
    let sent = 0;
    try {
      for (const row of shortlist) {
        const email = (emails[row._id] ?? row.email ?? operatorContactEmail(row.operatorSlug) ?? "").trim();
        // In demo mode every operator is sent to, published address or not: the
        // request goes to the stand-in inbox either way.
        if ((!email && !account?.demo) || row.sentAt) continue;
        await sendRequest({ briefOperatorId: row._id, email });
        sent += 1;
      }
    } catch (cause) { report(cause, "The request was not sent."); }
    finally { setSending(false); }
    goView("responses");
    // In demo mode the step's own banner already says what happened.
    if (!account?.demo) setNotice(sent ? (account?.demo ? `${sent} request${sent === 1 ? "" : "s"} sent to the demo stand-in inbox. Simulated replies arrive within about a minute.` : `${sent} request${sent === 1 ? "" : "s"} sent from the workspace mail inbox.`) : "No address was entered, so no email was sent. Each operator still has its own private link.");
  };

  // The server has the last word on whether the comparison still stands, so the
  // selected screen only opens once it has agreed. A refusal keeps the advisor on
  // the comparison, where the update is now marked.
  const selectProposal = async (id: string, seenFingerprint: string) => {
    if (briefId) {
      setError("");
      try { await decide({ briefId, proposalId: id as Id<"proposals">, seenFingerprint }); }
      catch (cause) { report(cause, "Could not record the decision."); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    }
    setRequest({ ...request, selectedProposalId: id, status: "Selected" });
    goView("selected");
  };
  // The same fingerprint the selection mutation recomputes, over the same rows.
  const liveComparison = bundle ? comparisonFingerprint(bundle.proposals.map((proposal) => ({ ...proposal, id: proposal._id }))) : null;

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
      goView("dashboard");
      setNotice("That brief and everything it produced were deleted.");
    } catch (cause) { setError(errorText(cause, "The brief could not be deleted.")); }
    finally { setDeleting(false); }
  };

  const deleteBriefById = async (id: Id<"briefs">) => {
    setError(""); setNotice("");
    try {
      await removeBrief({ briefId: id });
      if (id === briefId) { setBriefId("none"); setHydrated(null); setRequest({ ...defaultRequest }); setEmails({}); }
      setNotice("That brief and everything it produced were deleted.");
    } catch (cause) { setError(errorText(cause, "The brief could not be deleted.")); }
  };

  const viewContent = activeView === "dashboard" ? <Dashboard start={start} briefs={briefList ?? []} open={openBrief} remove={deleteBriefById} demo={Boolean(account?.demo)} />
    : activeView === "brief" ? <BriefForm request={request} setRequest={setRequest} next={() => void saveBriefStep()} />
    : activeView === "destinations" ? <DestinationDiscovery request={request} setRequest={setRequest} next={() => void chooseDestinations()} />
    : activeView === "operators" ? <OperatorResults request={request} profile={profile} next={() => goView("choose")} findStatus={findStatus} find={findOperators} />
    : activeView === "choose" ? <ChoosePartners request={request} profile={profile} setRequest={setRequest} next={() => void choosePartners()} />
    : activeView === "request" ? <><SendPanel shortlist={shortlist} emails={emails} setEmails={setEmails} blocked={account && !account.canSend ? account.reason : ""} demo={Boolean(account?.demo)} /><TripRequestReview request={request} profile={profile} canSend={Boolean(account?.canSend)} demo={Boolean(account?.demo)} send={() => void sendRequests()} />{sending && <div className="floating-success">Sending from your workspace inbox…</div>}</>
    : activeView === "responses" ? <><OperatorResponses request={request} proposals={proposals} shortlist={shortlist} next={() => goView("compare")} />{briefId && <FollowUpPanel briefId={briefId} demo={Boolean(account?.demo)} />}{briefId && <ReplyImport briefId={briefId} shortlist={shortlist} request={request} />}</>
    : activeView === "compare" ? <CompareProposals key={briefId ?? "none"} request={request} proposals={proposals} live={liveComparison} select={(id, seen) => void selectProposal(id, seen)} />
    : activeView === "selected" && selectedProposal ? <SelectedAndWorkback request={request} proposal={selectedProposal} reset={reset} />
    : activeView === "portal" ? <OperatorLinks shortlist={shortlist} briefName={request.name} resume={() => goView(resumeView())} deleting={deleting} onDelete={() => void deleteBrief()} />
    : <OperatorDirectory findStatus={findStatus} find={findOperators} />;

  return <main className="app-shell"><BrandHeader activeView={activeView} setActiveView={goView} newBrief={start} reset={reset} signOut={() => { void signOut(); }} account={account} /><WorkflowProgress view={activeView} go={goView} />{error && <div className="banner-error" role="alert">{error}</div>}{notice && <div className="banner-notice">{notice}</div>}{viewContent}</main>;
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
function OperatorLinks({ shortlist, briefName, resume, onDelete, deleting }: { shortlist: ShortlistRow[]; briefName: string; resume: () => void; onDelete: () => void; deleting: boolean }) {
  const [confirming, setConfirming] = useState(false);
  return <section className="workflow-section"><div className="section-heading split-heading"><div><p className="eyebrow">OPERATOR LINKS</p><h1>What the operator sees, through its own private link.</h1><p>Each row is one operator on one request. The link needs no account. It shows that operator what it needs to quote, including the group's ages and needs but never names or contact details, and it can only ever read and answer that operator's own request. Open one in a new tab to see exactly what the operator sees.</p></div><div className="heading-actions"><button className="primary" onClick={resume}>Back to the brief's workflow →</button></div></div>{shortlist.length === 0 ? <div className="method-note"><strong>No operator links yet.</strong><span>Choose partners on {briefName || "a brief"} and each one gets its own link here.</span></div> : <div className="link-list">{shortlist.map((row) => <article key={row._id}><div><h2>{row.operatorName}</h2><p>{row.status === "submitted" ? "Proposal received" : row.sentAt ? `Request sent${row.email ? ` to ${row.email}` : ""}` : "Ready to send"}</p></div><a className="primary" href={responseLink(row.capabilityToken)} target="_blank" rel="noreferrer">Open the operator's link →</a></article>)}</div>}
    <MailPool />
    <div className="danger-zone"><div><strong>Delete this brief</strong><span>Removes the brief, its group detail, every operator on it, every response link, every proposal it received and the mail it received. It cannot be undone. The operators themselves stay in the network.</span></div>{confirming ? <div className="heading-actions"><button className="secondary" onClick={() => setConfirming(false)}>Keep it</button><button className="primary danger" disabled={deleting} onClick={onDelete}>{deleting ? "Deleting…" : "Yes, delete this brief"}</button></div> : <button className="secondary" onClick={() => setConfirming(true)}>Delete…</button>}</div>
  </section>;
}

// One address per operator, captured by hand. Nothing is prefilled with a real
// supplier: the demo runs on the private links instead.
function SendPanel({ shortlist, emails, setEmails, blocked, demo }: { shortlist: ShortlistRow[]; emails: Record<string, string>; setEmails: (value: Record<string, string>) => void; blocked: string; demo: boolean }) {
  if (!shortlist.length) return null;
  return <section className="workflow-section send-panel"><div className="section-heading"><p className="eyebrow">DELIVERY</p><h2>Who receives it, and how</h2><p>{demo ? "Each shortlisted operator gets its own request, sent when you press Send below. In demo mode it goes to TripBrief's stand-in inbox, never to the operator." : "Add an address to email an operator from the workspace mail inbox, or hand over the private link. Either way the request reaches one named operator, and nothing is sent automatically."}</p></div>{blocked && <div className="inline-warning"><strong>Sending is off for this workspace</strong><span>{blocked}</span></div>}{demo && <div className="inline-success"><strong>Demo mode</strong><span>The address shown is the one the operator's own website publishes. It is never written to: every request goes to TripBrief's stand-in inbox, and an AI replies as the operator. The strongest match meets every requirement; the others differ on one or two things, the way real answers do.</span></div>}
    <div className="bespoke-request-list">{shortlist.map((row) => <article key={row._id}><div className="request-recipient"><span>TO</span><div><h2>{row.operatorName}</h2><p>{row.sentAt ? (row.deliveredTo ? "Sent to the demo stand-in inbox" : "Request already sent") : "Not sent yet"}{row.sendError ? ` · ${row.sendError}` : ""}</p></div></div><div className="send-row"><label>{demo ? "Operator's published address" : "Operator email"}<input type="email" inputMode="email" placeholder={demo ? "No address published" : "name@operator.example"} value={emails[row._id] ?? row.email ?? operatorContactEmail(row.operatorSlug)} disabled={Boolean(row.sentAt) || demo} onChange={(event) => setEmails({ ...emails, [row._id]: event.target.value })} /></label><a className="secondary" href={responseLink(row.capabilityToken)} target="_blank" rel="noreferrer">Open its link instead</a></div></article>)}</div></section>;
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
function ReplyImport({ briefId, shortlist, request }: { briefId: Id<"briefs">; shortlist: ShortlistRow[]; request: TripRequest }) {
  const replies = useQuery(api.replies.list, { briefId }) ?? [];
  const attachments = useQuery(api.replyAttachments.list, { briefId }) ?? [];
  const attachedTo = (id: Id<"inboxMessages">) => attachments.filter((item) => item.inboxMessageId === id);
  // An answer to a follow-up question is read like any reply, against the first
  // reply and the answer together, so the whole proposal is redrafted from both.
  const followUpAnswers = new Map((useQuery(api.followUps.forBrief, { briefId }) ?? []).flatMap((row) => row.answer ? [[row.answer.messageId as string, row.answer.source] as const] : []));
  const draftFromReply = useAction(api.proposals.draftFromReply);
  const recordEmailed = useMutation(api.proposals.recordEmailed);
  const [slug, setSlug] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<DraftReply | null>(null);
  const waiting = shortlist.filter((row) => row.status !== "submitted");
  const [reading, setReading] = useState<number | null>(null);
  if (!shortlist.length) return null;

  const draft = async (operatorSlug: string, source: string, inboxMessageId?: Id<"inboxMessages">) => {
    setError(""); setNotice(""); setResult(null); setBusy(true);
    try {
      // The approved places first, so the model reaches for them; the requirements
      // exactly as the operator's packet numbered them.
      const approved = request.selectedDestinationIds.map((id) => ({ slug: id, name: destinationName(id) }));
      const response = await draftFromReply({
        briefId,
        sourceText: source,
        destinations: [...approved, ...destinations.filter((item) => !request.selectedDestinationIds.includes(item.id)).map((item) => ({ slug: item.id, name: item.name }))].slice(0, 40),
        requirements: buildRequirements(request).map(({ key, id, label, statement }) => ({ key, id, label, statement })),
        // A stored reply brings its attached PDFs with it; pasted text has none.
        ...(inboxMessageId ? { inboxMessageId } : {}),
      });
      setSlug(operatorSlug);
      setText(source);
      setResult(response);
    } catch (cause) { setError(errorText(cause, "The draft could not be produced.")); }
    finally { setBusy(false); }
  };

  const record = async () => {
    if (!result) return;
    setError(""); setNotice("");
    if (!result.draft.startDate) { setError("Add the start date the operator proposed before recording this proposal."); return; }
    setBusy(true);
    try {
      await recordEmailed({
        briefId,
        operatorSlug: slug,
        sourceText: text,
        standardised: true,
        ...(result.unverifiedFields?.length ? { unverifiedFields: result.unverifiedFields } : {}),
        proposal: {
          ...result.draft,
          finalFit: requirementCoverage(buildRequirements(request), result.draft.requirementAnswers).score,
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

  return <section className="workflow-section reply-panel"><div className="section-heading"><p className="eyebrow">EMAILED REPLIES</p><h2>An operator can answer in its own words</h2><p>A reply that arrives in the workspace mail inbox is matched to the operator it came from, and to the request its thread belongs to. Paste it here and a model drafts the structured proposal, quoting the reply for every claim. You correct it and record it. Nothing is recorded until you press the button.</p></div>
    {error && <div className="inline-warning"><strong>Reply</strong><span>{error}</span></div>}
    {notice && <div className="inline-success"><strong>Recorded</strong><span>{notice}</span></div>}
    {replies.length > 0 && <div className="inbox-list">{replies.map((message, position) => { const answered = shortlist.find((row) => row.operatorSlug === message.operatorSlug)?.status === "submitted" && !followUpAnswers.has(message._id); return <article key={message._id}><div><small>{new Date(message.receivedAt).toLocaleString()} · {message.fromName || message.fromEmail}</small><h3>{message.subject || "(no subject)"}</h3><p>{message.text.slice(0, 240)}{message.text.length > 240 ? "…" : ""}</p>{attachedTo(message._id).length > 0 && <small className="attachment-count">{attachedTo(message._id).filter((item) => item.status === "stored").length} of {attachedTo(message._id).length} attachments kept{attachedTo(message._id).some((item) => item.status === "pending") ? " · fetching…" : ""}</small>}</div><div className="brief-actions"><button className="secondary" onClick={() => setReading(position)}>Read full reply</button>{answered ? <span className="status-badge">In the comparison</span> : <button className="primary" disabled={busy} onClick={() => void draft(message.operatorSlug ?? waiting[0]?.operatorSlug ?? "", followUpAnswers.get(message._id) ?? message.text, message._id)}>{followUpAnswers.has(message._id) ? "Update the proposal with this answer →" : "Draft a proposal from this →"}</button>}</div></article>; })}</div>}
    <ReplyReader index={reading} onIndex={setReading} items={replies.map((message) => { const answered = shortlist.find((row) => row.operatorSlug === message.operatorSlug)?.status === "submitted" && !followUpAnswers.has(message._id); return { id: message._id, operator: message.fromName || message.fromEmail, subject: message.subject, receivedAt: message.receivedAt, text: message.text, simulated: /\(Simulated reply/.test(message.text), facts: [], attachments: attachedTo(message._id), action: answered ? undefined : { label: "Draft a proposal from this", run: () => void draft(message.operatorSlug ?? waiting[0]?.operatorSlug ?? "", followUpAnswers.get(message._id) ?? message.text, message._id) } }; })} />
    {waiting.map((row) => <article className="reply-compose" key={row._id}><div><h3>{row.operatorName}</h3><p>{row.sentAt ? `Request sent${row.email ? ` to ${row.email}` : ""}` : "No request sent yet. The private link is the other way in."}</p></div><label>Paste the reply<textarea rows={4} value={slug === row.operatorSlug ? text : ""} placeholder="Paste what the operator wrote…" onChange={(event) => { setSlug(row.operatorSlug); setText(event.target.value); setResult(null); }} /></label><button className="secondary" disabled={busy || (slug !== row.operatorSlug) || text.trim().length < 20} onClick={() => void draft(row.operatorSlug, text)}>{busy && slug === row.operatorSlug ? "Drafting…" : "Draft the proposal"}</button></article>)}
    {result && <div className="draft-review"><div className="section-heading split-heading"><div><p className="eyebrow">REVIEW DRAFT · {shortlist.find((row) => row.operatorSlug === slug)?.operatorName}</p><h2>{result.draft.programName || "Untitled program"}</h2><p>The model read the reply and filled this in. {result.attachmentsRead?.length ? "Every quote from the email is checked against it; quotes from the attached PDF are marked, because they cannot be. Anything" : "Every quote below is copied from the reply; anything"} the reply did not say is left at zero or empty. Correct it, then record it.</p></div><span className="status-badge">{requirementCoverage(buildRequirements(request), result.draft.requirementAnswers).score}% requirement coverage · {moneyIn(result.draft.netPricePerPerson, result.draft.currency)} net</span></div><div className="form-grid three"><label>Program name<input value={result.draft.programName} onChange={(event) => setResult({ ...result, draft: { ...result.draft, programName: event.target.value } })} /></label><label>Start date<input type="date" value={result.draft.startDate} onChange={(event) => setResult({ ...result, draft: { ...result.draft, startDate: event.target.value } })} /></label><label>End date<input type="date" value={result.draft.endDate} onChange={(event) => setResult({ ...result, draft: { ...result.draft, endDate: event.target.value } })} /></label><label>Net price / person<input type="number" value={result.draft.netPricePerPerson} onChange={(event) => setResult({ ...result, draft: { ...result.draft, netPricePerPerson: Number(event.target.value) } })} /></label><label className="wide">Operator notes<textarea rows={3} value={result.draft.operatorNotes} onChange={(event) => setResult({ ...result, draft: { ...result.draft, operatorNotes: event.target.value } })} /></label></div>{!result.draft.startDate && <div className="inline-warning"><strong>No start date in the reply</strong><span>Every later step is dated from it. Add the date the operator proposed, or ask them for one.</span></div>}<div className="result-detail-grid"><TagList title="Experiences it says it includes" values={result.draft.experiencesIncluded} /><PlainList title="It says it cannot provide" values={result.draft.cannotProvide} tone="missing" /></div><RequirementAnswers request={request} answers={result.draft.requirementAnswers} setAnswers={(requirementAnswers) => setResult({ ...result, draft: { ...result.draft, requirementAnswers } })} intro="The model answered a requirement only where the reply addresses it, and every answer carries the operator's own words. Anything left blank was not answered in the reply: correct or fill in what you know, then record it." />{result.droppedEvidence.length > 0 && <div className="inline-warning"><strong>Check these by hand</strong><span>The model claimed these and then quoted something the operator did not write, so the quotes were dropped:</span>{result.droppedEvidence.map((field) => <span key={field}>· {field}</span>)}</div>}
        {(result.attachmentsRead?.length ?? 0) > 0 && <div className="inline-warning unverified-notice"><strong>Parts of this draft are not quote-checked</strong><span>The model also read {result.attachmentsRead!.join(", ")}. We cannot check its words against a PDF, so anything marked “from the PDF” is shown as the model read it, not as proven: open the PDF from the reply and check it before you record. The program name, dates and hotel carry no quote either way, and may have come from the PDF.</span>{(result.unverifiedFields?.length ?? 0) > 0 && <span>Figures that rest on the PDF alone: {result.unverifiedFields!.map(fieldLabel).join(", ")}.</span>}</div>}
        {(result.attachmentsLeftOut?.length ?? 0) > 0 && <div className="inline-warning"><strong>Not read</strong><span>These PDFs were too large to read in one draft together: {result.attachmentsLeftOut!.join(", ")}. Open them from the reply.</span></div>}
        {result.evidence.length > 0 && <div className="evidence-list"><strong>Quoted from the reply</strong>{result.evidence.map((item) => <blockquote key={`${item.field}-${item.quote}`} className={item.unverified ? "unverified" : undefined}><span>{fieldLabel(item.field)}{item.unverified ? " · from the PDF, not quote-checked" : ""}</span>“{item.quote}”</blockquote>)}</div>}{result.caveats.length > 0 && <div className="method-note"><strong>The model flagged</strong>{result.caveats.map((caveat) => <span key={caveat}>{caveat}</span>)}</div>}<div className="sticky-action"><span>Recording attaches this proposal to {shortlist.find((row) => row.operatorSlug === slug)?.operatorName}, with the reply kept as its source.</span><button className="primary" disabled={busy} onClick={() => void record()}>Record this proposal</button></div></div>}
  </section>;
}

// ---------------------------------------------------------------------------
// The operator's side. A private link is the whole credential: it reads that
// operator's own capability record, the request it was sent, and its proposal.
// ---------------------------------------------------------------------------

function OperatorApp({ token }: { token: string }) {
  // Everything on this side comes from the link itself. The agency's own network
  // is only readable when signed in to that agency, which an operator never is.
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

  // Both of these are React's "adjust state when an input changes" case: the
  // guard closes after one pass, and the operator's edits are never overwritten.
  // An operator added by hand has no capability record yet; it starts from an
  // empty one rather than waiting forever for a record that does not exist.
  if (link && !profile) setProfile(link.capability ? toProfile(link.capability) : emptyProfile(link.operatorSlug));
  if (link && brief && stored !== undefined && !draft) {
    const startingPoint = fromOperatorBrief(brief);
    const own = link.capability ? toProfile(link.capability) : emptyProfile(link.operatorSlug);
    setDraft(
      stored
        ? toDemoProposal({ ...stored, id: "own-proposal", operatorSlug: link.operatorSlug })
        : blankProposal(startingPoint, link.operatorSlug, own),
    );
  }

  if (link === undefined) return <Splash label="Opening your request…" />;
  if (link === null)
    return <main className="app-shell"><section className="portal-submitted"><div className="selected-icon">!</div><p className="eyebrow">LINK NOT ACTIVE</p><h1>This response link is no longer active.</h1><p>Ask your agency for a current link. Nothing was read, changed or submitted.</p></section></main>;
  if (!profile) return <Splash label="Reading your capability record…" />;

  // A standing capability link carries no request: the operator is here to keep
  // its own record current. A request link carries one brief and one proposal.
  // Still loading: a request link must not flash the "no request is waiting" page.
  if (brief === undefined || (brief && stored === undefined)) return <Splash label="Reading the request…" />;
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
      if (!draft || !request) return;
      // The stored fit is the requirement coverage worked out from the operator's
      // own answers, so an alert or a list can quote it without recomputing.
      const coverage = requirementCoverage(buildRequirements(request), draft.requirementAnswers);
      await submit({ token, proposal: toStoredProposal({ ...draft, finalFit: coverage.score }) });
      setView("submitted");
    } catch (cause) { setError(errorText(cause, "Could not submit the proposal.")); }
    finally { setSaving(false); }
  };

  const content = view === "workspace" ? (request ? <PartnerWorkspace operatorName={link.operatorName} profile={profile} request={request} go={go} /> : <CapabilityWorkspace profile={profile} go={() => go("profile")} />)
    : view === "profile" ? <ProfileEditor operatorName={link.operatorName} profile={profile} setProfile={setProfile} save={() => void save()} />
    : view === "request" && request ? <PartnerRequest request={request} quote={() => go("quote")} />
    : view === "quote" && request && draft ? <ProposalBuilder request={request} proposal={draft} setProposal={setDraft} token={token} submit={() => void send()} />
    : view === "submitted" ? <Submitted goBack={() => go("workspace")} label="Back to the request →" />
    : request ? <PartnerWorkspace operatorName={link.operatorName} profile={profile} request={request} go={go} /> : <CapabilityWorkspace profile={profile} go={() => go("profile")} />;

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
  targetNetPerPerson: number;
  approvedDestinations: { slug: string; name: string }[];
  climates: string[];
  travelerTypes: string[];
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
    confirmedTravelers: 0,
    nights: brief.nights,
    earliestDepartureDate: brief.earliestDepartureDate,
    preferredDepartureDate: brief.preferredDepartureDate,
    latestDepartureDate: brief.latestDepartureDate,
    flexibleDates: brief.flexibleDates,
    proposalDecisionDate: brief.proposalDecisionDate,
    // The operator is never told the client's price; only the net to quote.
    targetRetailPricePerPerson: 0,
    targetNetPerPerson: brief.targetNetPerPerson,
    approvedDestinations: brief.approvedDestinations,
    climates: brief.climates,
    travelerTypes: brief.travelerTypes,
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
    selectedDestinationIds: brief.approvedDestinations.map((item) => item.slug),
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
  requirementAnswers?: RequirementAnswer[];
  simulated?: boolean;
  sourceText?: string;
  unverifiedFields?: string[];
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
    requirementAnswers: proposal.requirementAnswers ?? [],
    simulated: proposal.simulated === true,
    sourceText: proposal.sourceText ?? "",
    ...(proposal.unverifiedFields?.length ? { unverifiedFields: proposal.unverifiedFields } : {}),
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
    requirementAnswers: proposal.requirementAnswers,
  };
}

// A blank proposal is only a starting point: the operator still has to say what
// it would actually operate, and the submitted form will not accept a proposal
// without a program name, a start date and a net price. The payment terms are
// prefilled from the operator's own capability record, because those are the
// terms it already told the agency it works to.
function blankProposal(request: TripRequest, operatorSlug: string, own: OperatorProfile): OperatorProposal {
  const timing: OperatorTiming = own.timing;
  // Default to an approved place this operator actually serves.
  const approved = request.selectedDestinationIds;
  const destinationId = approved.find((id) => own.locations.includes(id)) ?? approved[0] ?? destinations[0].id;
  return {
    id: "draft",
    partnerId: operatorSlug,
    programName: "",
    basedOnExistingProgram: false,
    readyMadeTripId: null,
    destinationId,
    startDate: request.preferredDepartureDate,
    endDate: "",
    nights: request.nights,
    availability: "Confirmation Required",
    groupSizeAccepted: request.travelerCount,
    hotelLevel: request.experienceLevel === 1 ? "3-star" : request.experienceLevel === 2 ? "4-star" : "5-star_luxury",
    hotelNotes: "",
    transportation: [],
    experiencesIncluded: [],
    requirementsMet: [],
    changesOrAdditions: [],
    cancellationTerms: timing.cancellationDeadlines ?? [],
    cannotProvide: [],
    finalFit: 0,
    netPricePerPerson: Math.round(calculateTargetNet(request)),
    currency: own.commercial.currency || "USD",
    pricingAssumptions: "",
    depositPercent: timing.depositDueDaysBefore ? 25 : 0,
    depositDueDaysBefore: timing.depositDueDaysBefore ?? 0,
    finalHeadcountDaysBefore: timing.finalHeadcountDaysBefore ?? 0,
    finalPaymentDaysBefore: timing.finalPaymentDaysBefore ?? 0,
    travelerNamesDaysBefore: timing.travelerNamesDaysBefore ?? 0,
    roomReleaseDaysBefore: timing.roomReleaseDaysBefore ?? 0,
    operatorNotes: "",
    requirementAnswers: [],
  };
}

// The capability record of an operator the agency added by hand, before the
// operator has filled anything in. Every field is neutral: nothing is claimed.
function emptyProfile(operatorSlug: string): OperatorProfile {
  return {
    partnerId: operatorSlug,
    locations: [],
    serviceAreas: [],
    minGroupSize: 1,
    maxGroupSize: 40,
    idealGroupSize: 16,
    supportsFIT: false,
    groupTypes: [],
    travelerTypes: [],
    hotelTypes: [],
    services: [],
    features: [],
    operations: [],
    canBuildBespoke: true,
    customizationLevel: "moderate",
    quoteTurnaroundDays: 7,
    languages: ["English"],
    commercial: { typicalNetMin: 0, typicalNetMax: 0, minimumTripValue: 0, typicalTripValue: 0, preferredGroupValue: 0, pricingModels: [], currency: "USD", pricingVariesByGroupSize: false },
    timing: { yearRound: true, operatingMonths: [], seasonalNotes: "", blackoutPeriods: [], shortestLeadTimeDays: 0, minimumLeadTimeDays: 0, idealLeadTimeDays: 0, averageProposalTurnaroundDays: 0, maximumProposalTurnaroundDays: 0, spaceHoldDays: 0, depositDueDaysBefore: 0, finalPaymentDaysBefore: 0, finalHeadcountDaysBefore: 0, travelerNamesDaysBefore: 0, latestGroupChangeDaysBefore: 0, roomReleaseDaysBefore: 0, cancellationDeadlines: [] },
  };
}
