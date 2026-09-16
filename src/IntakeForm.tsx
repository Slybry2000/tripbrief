import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { suggestRequirements, type Profile } from "./intakeOptions";

// The intake gathers what a supplier actually needs to quote well, and what the
// advisor would otherwise chase by email: who the group is, what the trip is
// built around, when it is, and what it may cost. Nothing here is sent to a
// supplier except the requirements list and the trip scope.
const GROUP_TYPES = [
  "Family",
  "Friends",
  "Club or society",
  "Company or team",
  "School or alumni",
  "Community or congregation",
  "Interest group",
];
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

type Draft = {
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  travelers: number;
  brief: string;
  requirements: string;
  profile: Profile;
};

const STEPS = [
  "The trip",
  "The group",
  "What it is built around",
  "Timing and money",
  "What matters to them",
  "Review and save",
];

function Chips({
  options,
  value,
  onChange,
  multiple = false,
}: {
  options: string[];
  value: string[] | undefined;
  onChange: (next: string[]) => void;
  multiple?: boolean;
}) {
  const selected = value ?? [];
  return (
    <div className="chips">
      {options.map((option) => {
        const on = selected.includes(option);
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
                    ? selected.filter((item) => item !== option)
                    : [...selected, option]
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
  const [draft, setDraft] = useState<Draft>({
    title: "",
    destination: "",
    startDate: "",
    endDate: "",
    travelers: 16,
    brief: "",
    requirements: "",
    profile: {
      needs: [],
      interests: [],
      styles: [],
      budgetCovers: [],
    },
  });
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const setProfile = <K extends keyof Profile>(key: K, value: Profile[K]) =>
    setDraft((current) => ({
      ...current,
      profile: { ...current.profile, [key]: value },
    }));

  const stepError = () => {
    if (step === 0) {
      if (!draft.title.trim()) return "Give the trip a name.";
      if (!draft.destination.trim()) return "Where is the group going?";
      if (!draft.startDate || !draft.endDate) return "Add the arrival and departure dates.";
      if (draft.endDate < draft.startDate)
        return "The departure date cannot be before the arrival date.";
      if (!Number.isInteger(draft.travelers) || draft.travelers < 1)
        return "How many people are travelling?";
    }
    return "";
  };
  const next = () => {
    const problem = stepError();
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    if (step === 4 && !touched && !draft.requirements.trim())
      set("requirements", suggestRequirements(draft.profile, draft.travelers));
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
            Answers stay in this brief. Suppliers only ever see the trip scope
            and the requirements.
          </small>
        </p>
      </div>
      <div className="intake-body">
        {step === 0 && (
          <>
            <h1>What are we planning?</h1>
            <p>Start with the shape of the trip. You can change all of this later.</p>
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
                  placeholder="Northern Portugal"
                />
              </label>
              <label>
                Arrival
                <input
                  type="date"
                  value={draft.startDate}
                  onChange={(event) => set("startDate", event.target.value)}
                />
              </label>
              <label>
                Departure
                <input
                  type="date"
                  value={draft.endDate}
                  onChange={(event) => set("endDate", event.target.value)}
                />
              </label>
              <label>
                How many people
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={draft.travelers}
                  onChange={(event) =>
                    set("travelers", Number(event.target.value))
                  }
                />
              </label>
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <h1>Who is travelling?</h1>
            <p>The more a supplier knows about the group, the closer the first quote lands.</p>
            <fieldset>
              <legend>What kind of group is it?</legend>
              <Chips
                options={GROUP_TYPES}
                value={draft.profile.groupType ? [draft.profile.groupType] : []}
                onChange={(next) => setProfile("groupType", next[0])}
              />
            </fieldset>
            <fieldset>
              <legend>Roughly what ages?</legend>
              <Chips
                options={AGES}
                value={draft.profile.ages ? [draft.profile.ages] : []}
                onChange={(next) => setProfile("ages", next[0])}
              />
            </fieldset>
            <fieldset>
              <legend>Room plan</legend>
              <Chips
                options={ROOMS}
                value={draft.profile.rooms ? [draft.profile.rooms] : []}
                onChange={(next) => setProfile("rooms", next[0])}
              />
            </fieldset>
            <fieldset>
              <legend>Anything a supplier has to work around?</legend>
              <Chips
                options={NEEDS}
                value={draft.profile.needs}
                onChange={(next) => setProfile("needs", next)}
                multiple
              />
              <small>Pick everything that applies. These become requirements.</small>
            </fieldset>
          </>
        )}
        {step === 2 && (
          <>
            <h1>What is the trip built around?</h1>
            <p>This is what tells one supplier's idea from another's.</p>
            <fieldset>
              <legend>Interests</legend>
              <Chips
                options={INTERESTS}
                value={draft.profile.interests}
                onChange={(next) => setProfile("interests", next)}
                multiple
              />
            </fieldset>
            <fieldset>
              <legend>Pace</legend>
              <Chips
                options={PACES}
                value={draft.profile.pace ? [draft.profile.pace] : []}
                onChange={(next) => setProfile("pace", next[0])}
              />
            </fieldset>
            <fieldset>
              <legend>Setting</legend>
              <Chips
                options={SETTINGS}
                value={draft.profile.setting ? [draft.profile.setting] : []}
                onChange={(next) => setProfile("setting", next[0])}
              />
            </fieldset>
            <fieldset>
              <legend>How should it run?</legend>
              <Chips
                options={STYLES}
                value={draft.profile.styles}
                onChange={(next) => setProfile("styles", next)}
                multiple
              />
            </fieldset>
            <label>
              One thing that must happen
              <textarea
                value={draft.profile.mustDo ?? ""}
                onChange={(event) => setProfile("mustDo", event.target.value)}
                maxLength={2000}
                placeholder="A meal in the village where her family is from."
              />
            </label>
          </>
        )}
        {step === 3 && (
          <>
            <h1>Timing and money</h1>
            <p>
              The budget stays with you. No supplier ever sees it, and it is
              never repeated in an invitation.
            </p>
            <fieldset>
              <legend>How firm are the dates?</legend>
              <Chips
                options={FLEXIBILITY}
                value={
                  draft.profile.dateFlexibility
                    ? [draft.profile.dateFlexibility]
                    : []
                }
                onChange={(next) => setProfile("dateFlexibility", next[0])}
              />
            </fieldset>
            <fieldset>
              <legend>What is the group working with?</legend>
              <Chips
                options={BUDGETS}
                value={draft.profile.budgetBand ? [draft.profile.budgetBand] : []}
                onChange={(next) => setProfile("budgetBand", next[0])}
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
                onChange={(next) => setProfile("budgetCurrency", next[0])}
              />
            </fieldset>
            <fieldset>
              <legend>That should cover</legend>
              <Chips
                options={COVERS}
                value={draft.profile.budgetCovers}
                onChange={(next) => setProfile("budgetCovers", next)}
                multiple
              />
            </fieldset>
          </>
        )}
        {step === 4 && (
          <>
            <h1>What matters to them</h1>
            <p>
              Every supplier answers these, one by one, with their own words.
              Ask for what a supplier can actually confirm.
            </p>
            <label>
              Requirements · one per line
              <textarea
                value={draft.requirements}
                onChange={(event) => {
                  setTouched(true);
                  set("requirements", event.target.value);
                }}
                rows={10}
              />
            </label>
            <button
              type="button"
              className="quiet-button"
              onClick={() => {
                setTouched(false);
                set("requirements", suggestRequirements(draft.profile, draft.travelers));
              }}
            >
              Rebuild the suggestions from my answers
            </button>
            <label>
              The group's brief in their own words
              <textarea
                value={draft.brief}
                onChange={(event) => set("brief", event.target.value)}
                maxLength={8000}
                rows={5}
                placeholder="What the group is hoping for, and anything you already know."
              />
            </label>
          </>
        )}
        {step === 5 && (
          <>
            <h1>Ready to send out</h1>
            <p>Check the brief before any supplier sees it.</p>
            <div className="card">
              <h2>{draft.title || "Untitled trip"}</h2>
              <p>
                {draft.destination || "No destination"} · {draft.startDate} to{" "}
                {draft.endDate} · {draft.travelers} travellers
              </p>
              <dl className="summary">
                {[
                  ["Group", draft.profile.groupType],
                  ["Ages", draft.profile.ages],
                  ["Rooms", draft.profile.rooms],
                  ["Needs", draft.profile.needs.join(", ")],
                  ["Interests", draft.profile.interests.join(", ")],
                  ["Pace", draft.profile.pace],
                  ["Setting", draft.profile.setting],
                  ["How it runs", draft.profile.styles.join(", ")],
                  ["Must happen", draft.profile.mustDo],
                  ["Date flexibility", draft.profile.dateFlexibility],
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
              <h3>Requirements</h3>
              <ul>
                {draft.requirements
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean)
                  .map((line) => (
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
                const problem = stepError();
                const requirements = draft.requirements
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean);
                if (problem) {
                  setStep(0);
                  setError(problem);
                  return;
                }
                if (!requirements.length) {
                  setStep(4);
                  setError("Add at least one requirement.");
                  return;
                }
                setBusy(true);
                setError("");
                void create({
                  title: draft.title,
                  destination: draft.destination,
                  startDate: draft.startDate,
                  endDate: draft.endDate,
                  travelers: draft.travelers,
                  brief: draft.brief || draft.title,
                  requirements,
                  profile: draft.profile,
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
