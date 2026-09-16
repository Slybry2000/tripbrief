import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { DateRangePicker } from "./DateRangePicker";
import { formatDay, rangeLabel } from "./dateRange";
import {
  bookingOpenItems,
  emptyProfile,
  GUARDRAILS,
  isIndividualLane,
  pricingAssumptions,
  suggestRequirements,
  supplierMustReturn,
  validateIntake,
  WHO_TRAVELS,
  type Profile,
} from "./intakeOptions";

const AGES = ["Under 18s present", "18-30", "30-50", "50-65", "65+", "Mixed ages"];
const ROOMS = ["Double rooms", "Twin rooms", "Singles for everyone", "Family rooms", "Mixed room plan", "Not decided yet"];
const NEEDS = [
  "Step-free access",
  "Accessible rooms",
  "Dietary requirements",
  "Quiet rooms",
  "Early breakfasts",
  "Late arrivals",
  "Room for equipment",
  "Someone with limited walking",
];
const INTERESTS = [
  "Food and wine",
  "History",
  "Art and museums",
  "Walking and nature",
  "Music",
  "Sport",
  "Wellness and spa",
  "Wildlife",
  "Beaches",
  "Local crafts",
  "Photography",
  "Nightlife",
];
const PACES = ["Relaxed", "Balanced", "Full days", "Not sure yet"];
const SETTINGS = ["City", "Coast", "Countryside", "Mountains", "Islands", "A mix"];
const STYLES = [
  "Guided throughout",
  "Free time each day",
  "Private transfers",
  "Group meals included",
  "Self-guided",
  "Time at leisure at the end",
];
const FLEXIBILITY = ["Exact dates", "Flexible by a few days", "Flexible by a week", "Still deciding"];
const BUDGETS = ["Under 1,500 per person", "1,500 to 2,500 per person", "2,500 to 4,000 per person", "4,000 to 6,000 per person", "Above 6,000 per person", "Prefer not to say yet"];
const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"];
const COVERS = ["Accommodation", "Meals", "Transfers", "Activities", "Flights", "Tips and fees"];

const STEPS = [
  "Who is travelling",
  "Where and when",
  "The group",
  "A good day",
  "Money and limits",
  "What matters",
  "Assumptions",
  "Review and save",
];

// A missing answer is not a reason to ask another question. Each of these points
// back at the step that would settle it.
function assumptionStep(assumption: string) {
  const text = assumption.toLowerCase();
  if (/dates|one-day move/.test(text)) return 1;
  if (/twin rooms|single supplement|room counts/.test(text)) return 2;
  if (/step-free|dietary/.test(text)) return 2;
  if (/travellers twice|maximum/.test(text)) return 1;
  return 4;
}

function Chips({
  options,
  value,
  onChange,
  multiple = false,
}: {
  options: readonly string[];
  value: string[];
  onChange: (next: string[]) => void;
  multiple?: boolean;
}) {
  return (
    <div className="chips">
      {options.map((option) => {
        const on = value.includes(option);
        return (
          <button
            key={option}
            type="button"
            className="chip"
            aria-pressed={on}
            onClick={() =>
              onChange(
                multiple
                  ? on
                    ? value.filter((item) => item !== option)
                    : [...value, option]
                  : on
                    ? []
                    : [option],
              )
            }
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

export function IntakeForm({ done }: { done: (id: Id<"trips">) => void }) {
  const create = useMutation(api.trips.create);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    destination: "",
    startDate: "",
    endDate: "",
    travellers: 16,
    brief: "",
    requirements: "",
    profile: emptyProfile(),
  });

  // Editing any source answer invalidates a previously accepted assumption set,
  // so an accepted basis can never outlive the answers behind it.
  const edit = (change: (current: typeof draft) => typeof draft) =>
    setDraft((current) => {
      const next = change(current);
      return next.profile.assumptionsAccepted
        ? { ...next, profile: { ...next.profile, assumptionsAccepted: false } }
        : next;
    });
  const set = <K extends keyof typeof draft>(
    key: K,
    value: (typeof draft)[K],
  ) => edit((current) => ({ ...current, [key]: value }));
  const setProfile = <K extends keyof Profile>(key: K, value: Profile[K]) =>
    edit((current) => ({
      ...current,
      profile: { ...current.profile, [key]: value },
    }));

  const assumptions = pricingAssumptions(draft.profile, draft.travellers);
  const openItems = bookingOpenItems(draft.profile);
  const requirements = draft.requirements
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  // Step 0 is the fit check: the wrong lane exits before anything is collected.
  if (isIndividualLane(draft.profile.lane ?? ""))
    return (
      <section className="intake-body narrow">
        <p className="eyebrow">NOT THE RIGHT LANE</p>
        <h1>This tool is for groups.</h1>
        <p>
          It works by getting the same requirement list quoted by several
          suppliers and comparing what comes back. One or two travellers have no
          requirement list to quote against, so nothing is collected here.
        </p>
        <p>
          <small>
            A trip for a club, a company, a school, a community or a family group
            is exactly what this is for.
          </small>
        </p>
        <button
          type="button"
          className="quiet-button"
          onClick={() => setProfile("lane", "")}
        >
          Back to the fit check
        </button>
      </section>
    );

  const stepProblem = () => {
    if (step === 0)
      return draft.profile.lane ? "" : "Choose who is travelling.";
    if (step === 1) {
      if (!draft.destination.trim()) return "Say where the group is going.";
      if (!draft.startDate || !draft.endDate)
        return "Pick the arrival and departure days on the calendar.";
      if (!Number.isInteger(draft.travellers) || draft.travellers < 3)
        return "This tool starts at three travellers. How many are going?";
    }
    if (step === 2 && (draft.profile.groupStory ?? "").trim().length < 20)
      return "Describe the group in a sentence or two.";
    if (step === 3 && (draft.profile.goodDay ?? "").trim().length < 20)
      return "Describe what a good day on this trip looks like.";
    if (step === 6 && draft.profile.assumptionsAccepted !== true)
      return "Accept the assumptions, or go back and replace them with real detail.";
    return "";
  };
  const next = () => {
    const problem = stepProblem();
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    if (step === 4 && !touched && !draft.requirements.trim())
      set("requirements", suggestRequirements(draft.profile, draft.travellers));
    if (step === 6)
      setProfile("assumptions", assumptions);
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  };

  return (
    <section className="intake">
      <div className="intake-rail">
        <p className="eyebrow">
          STEP {step + 1} OF {STEPS.length}
        </p>
        <ol>
          {STEPS.map((label, index) => (
            <li
              key={label}
              className={index === step ? "current" : index < step ? "done" : ""}
            >
              <button type="button" onClick={() => setStep(index)}>
                {label}
              </button>
            </li>
          ))}
        </ol>
        <p>
          <small>
            This becomes the brief every supplier answers. Suppliers see the
            trip and the requirements; they never see the budget.
          </small>
        </p>
      </div>
      <div className="intake-body">
        {step === 0 && (
          <>
            <p className="eyebrow">FIRST, A FIT CHECK</p>
            <h1>Who brings the travellers?</h1>
            <p>Choose the closest fit.</p>
            <div className="choice-grid">
              {WHO_TRAVELS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="choice"
                  aria-pressed={draft.profile.lane === option.value}
                  onClick={() => setProfile("lane", option.value)}
                >
                  <strong>{option.label}</strong>
                  <span>{option.help}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <h1>Where and when?</h1>
            <div className="grid">
              <label>
                Trip name
                <input
                  value={draft.title}
                  onChange={(event) => set("title", event.target.value)}
                  maxLength={160}
                  placeholder="Autumn walking week"
                />
              </label>
              <label>
                Destination or region
                <input
                  value={draft.destination}
                  onChange={(event) => set("destination", event.target.value)}
                  maxLength={160}
                  placeholder="Northern Portugal, or open to suggestions"
                />
              </label>
              <label>
                How many travellers
                <input
                  type="number"
                  min={3}
                  max={500}
                  value={draft.travellers}
                  onChange={(event) =>
                    set("travellers", Number(event.target.value))
                  }
                />
              </label>
            </div>
            <fieldset>
              <legend>Travel dates</legend>
              <p>
                <small>Click the arrival day, then the day the trip ends.</small>
              </p>
              <DateRangePicker
                start={draft.startDate || null}
                end={draft.endDate || null}
                onChange={(range) =>
                  edit((current) => ({
                    ...current,
                    startDate: range.start ?? "",
                    endDate: range.end ?? "",
                  }))
                }
              />
            </fieldset>
            <fieldset>
              <legend>How firm are those dates?</legend>
              <Chips
                options={FLEXIBILITY}
                value={
                  draft.profile.dateFlexibility
                    ? [draft.profile.dateFlexibility]
                    : []
                }
                onChange={(list) => setProfile("dateFlexibility", list[0])}
              />
            </fieldset>
          </>
        )}
        {step === 2 && (
          <>
            <h1>Who is travelling?</h1>
            <label>
              In your own words
              <textarea
                rows={4}
                maxLength={4000}
                value={draft.profile.groupStory ?? ""}
                onChange={(event) => setProfile("groupStory", event.target.value)}
                placeholder="Fourteen to eighteen members of a walking club, mostly in their sixties, led by their chair. Two need a lift rather than stairs."
              />
            </label>
            <fieldset>
              <legend>Roughly what ages?</legend>
              <Chips
                options={AGES}
                value={draft.profile.ages ? [draft.profile.ages] : []}
                onChange={(list) => setProfile("ages", list[0])}
              />
            </fieldset>
            <fieldset>
              <legend>Room plan</legend>
              <Chips
                options={ROOMS}
                value={draft.profile.rooms ? [draft.profile.rooms] : []}
                onChange={(list) => setProfile("rooms", list[0])}
              />
            </fieldset>
            <fieldset>
              <legend>Anything a supplier has to work around?</legend>
              <Chips
                options={NEEDS}
                value={draft.profile.needs}
                onChange={(list) => setProfile("needs", list)}
                multiple
              />
              <small>Everything picked here becomes a requirement.</small>
            </fieldset>
          </>
        )}
        {step === 3 && (
          <>
            <h1>What does a good day look like?</h1>
            <label>
              In your own words
              <textarea
                rows={4}
                maxLength={4000}
                value={draft.profile.goodDay ?? ""}
                onChange={(event) => setProfile("goodDay", event.target.value)}
                placeholder="A short walk before lunch, one local stop, a long table in the evening, and nobody rushed."
              />
            </label>
            <fieldset>
              <legend>Interests</legend>
              <Chips
                options={INTERESTS}
                value={draft.profile.interests}
                onChange={(list) => setProfile("interests", list)}
                multiple
              />
            </fieldset>
            <fieldset>
              <legend>Pace</legend>
              <Chips
                options={PACES}
                value={draft.profile.pace ? [draft.profile.pace] : []}
                onChange={(list) => setProfile("pace", list[0])}
              />
            </fieldset>
            <fieldset>
              <legend>Setting</legend>
              <Chips
                options={SETTINGS}
                value={draft.profile.setting ? [draft.profile.setting] : []}
                onChange={(list) => setProfile("setting", list[0])}
              />
            </fieldset>
            <fieldset>
              <legend>How should it run?</legend>
              <Chips
                options={STYLES}
                value={draft.profile.styles}
                onChange={(list) => setProfile("styles", list)}
                multiple
              />
            </fieldset>
          </>
        )}
        {step === 4 && (
          <>
            <h1>Money and limits</h1>
            <p>
              The budget stays with you. No supplier sees it, and it never
              becomes a requirement.
            </p>
            <fieldset>
              <legend>What is the group working with?</legend>
              <Chips
                options={BUDGETS}
                value={draft.profile.budgetBand ? [draft.profile.budgetBand] : []}
                onChange={(list) => setProfile("budgetBand", list[0])}
              />
            </fieldset>
            <fieldset>
              <legend>Currency</legend>
              <Chips
                options={CURRENCIES}
                value={
                  draft.profile.budgetCurrency
                    ? [draft.profile.budgetCurrency]
                    : []
                }
                onChange={(list) => setProfile("budgetCurrency", list[0])}
              />
            </fieldset>
            <fieldset>
              <legend>That should cover</legend>
              <Chips
                options={COVERS}
                value={draft.profile.budgetCovers}
                onChange={(list) => setProfile("budgetCovers", list)}
                multiple
              />
            </fieldset>
            <fieldset>
              <legend>What should suppliers avoid?</legend>
              <Chips
                options={GUARDRAILS}
                value={draft.profile.guardrails}
                onChange={(list) => setProfile("guardrails", list)}
                multiple
              />
              <small>
                Each one becomes a requirement, so a supplier cannot quietly
                propose it.
              </small>
            </fieldset>
            <label>
              Anything else they must know
              <textarea
                rows={3}
                maxLength={4000}
                value={draft.profile.boundaries ?? ""}
                onChange={(event) => setProfile("boundaries", event.target.value)}
                placeholder="One member has a bad knee. The exact dietary list follows before booking."
              />
            </label>
          </>
        )}
        {step === 5 && (
          <>
            <h1>What matters to them</h1>
            <p>
              Every supplier answers these one by one, in their own words. They
              come from your answers — edit anything that reads wrong.
            </p>
            <label>
              Requirements · one per line
              <textarea
                rows={12}
                value={draft.requirements}
                onChange={(event) => {
                  setTouched(true);
                  set("requirements", event.target.value);
                }}
              />
            </label>
            <button
              type="button"
              className="quiet-button"
              onClick={() => {
                setTouched(false);
                set(
                  "requirements",
                  suggestRequirements(draft.profile, draft.travellers),
                );
              }}
            >
              Rebuild from my answers
            </button>
            <label>
              The group&rsquo;s brief in their own words
              <textarea
                rows={4}
                maxLength={8000}
                value={draft.brief}
                onChange={(event) => set("brief", event.target.value)}
                placeholder="What the group is hoping for, and anything you already know."
              />
            </label>
          </>
        )}
        {step === 6 && (
          <>
            <h1>Where you stayed open, we will assume this</h1>
            <p>
              You were not asked to answer everything. These are the gaps, turned
              into something a supplier can price. Change any of them, or accept
              them as the basis of the first quotes.
            </p>
            <ol className="assumptions">
              {assumptions.map((assumption) => (
                <li key={assumption}>
                  <span>{assumption}</span>
                  <button
                    type="button"
                    className="quiet-button"
                    onClick={() => {
                      setError("");
                      setStep(assumptionStep(assumption));
                    }}
                  >
                    Change this
                  </button>
                </li>
              ))}
            </ol>
            <label className="accept">
              <input
                type="checkbox"
                checked={draft.profile.assumptionsAccepted === true}
                onChange={(event) =>
                  setProfile("assumptionsAccepted", event.target.checked)
                }
              />
              Use these assumptions for the first quotes
            </label>
            <p>
              <small>
                Change any earlier answer and this approval is withdrawn, so a
                supplier never prices an assumption you have since replaced.
              </small>
            </p>
          </>
        )}
        {step === 7 && (
          <>
            <h1>Ready to send out</h1>
            <div className="card">
              <h2>{draft.title || draft.destination || "Untitled trip"}</h2>
              <p>
                {draft.destination} ·{" "}
                {draft.startDate ? formatDay(draft.startDate) : "No arrival"} to{" "}
                {draft.endDate ? formatDay(draft.endDate) : "no departure"} ·{" "}
                {draft.travellers} travellers ·{" "}
                {rangeLabel({
                  start: draft.startDate || null,
                  end: draft.endDate || null,
                })}
              </p>
              <h3>Confirmed by you</h3>
              <dl className="summary">
                {[
                  ["Group", draft.profile.groupStory],
                  ["Ages", draft.profile.ages],
                  ["Rooms", draft.profile.rooms],
                  ["Needs", draft.profile.needs.join(", ")],
                  ["A good day", draft.profile.goodDay],
                  ["Interests", draft.profile.interests.join(", ")],
                  ["Pace", draft.profile.pace],
                  ["Setting", draft.profile.setting],
                  ["How it runs", draft.profile.styles.join(", ")],
                  ["Avoid", draft.profile.guardrails.join(", ")],
                  ["Anything else", draft.profile.boundaries],
                  ["Budget", draft.profile.budgetBand],
                  ["Budget covers", draft.profile.budgetCovers.join(", ")],
                ]
                  .filter(([, value]) => value)
                  .map(([label, value]) => (
                    <div key={String(label)}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
              </dl>
              <h3>Assumed, and you accepted it</h3>
              <ul>
                {assumptions.map((assumption) => (
                  <li key={assumption}>{assumption}</li>
                ))}
              </ul>
              <h3>Open before a supplier quotes — not blockers</h3>
              <ul>
                {openItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <h3>Requirements every supplier answers</h3>
              <ul>
                {requirements.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <h3>What every supplier must return</h3>
              <ul>
                {supplierMustReturn(draft.travellers).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="actions">
          {step > 0 && (
            <button
              type="button"
              className="quiet-button"
              onClick={() => {
                setError("");
                setStep((current) => current - 1);
              }}
            >
              Back
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button type="button" onClick={next}>
              Continue
            </button>
          ) : (
            <button
              disabled={busy}
              onClick={() => {
                const problems = validateIntake({
                  destination: draft.destination,
                  startDate: draft.startDate,
                  endDate: draft.endDate,
                  travellers: draft.travellers,
                  profile: {
                    ...draft.profile,
                    assumptions,
                  },
                });
                if (problems.length) {
                  setError(problems[0]);
                  return;
                }
                if (!requirements.length) {
                  setStep(5);
                  setError("Add at least one requirement.");
                  return;
                }
                setBusy(true);
                setError("");
                void create({
                  title: draft.title || draft.destination,
                  destination: draft.destination,
                  startDate: draft.startDate,
                  endDate: draft.endDate,
                  travelers: draft.travellers,
                  brief: draft.brief || draft.destination,
                  requirements,
                  profile: { ...draft.profile, assumptions },
                })
                  .then(done)
                  .catch((cause: unknown) =>
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "Could not save the brief.",
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "Saving…" : "Save brief →"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
