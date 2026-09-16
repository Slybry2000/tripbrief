import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

type AssessmentStatus = "yes" | "partial" | "no" | "unknown";
type Attachment = {
  storageId: Id<"_storage">;
  name: string;
  size: number;
  contentType?: string;
};

const COVERS = [
  "Accommodation",
  "Breakfast",
  "All meals",
  "Transfers",
  "Activities",
  "Guide",
  "Flights",
  "Taxes and fees",
];
const ROOM_PLANS = [
  "Twin rooms",
  "Double rooms",
  "Singles for everyone",
  "Family rooms",
  "Mixed plan",
  "Not decided yet",
];
const MEALS = ["Breakfast", "Lunch", "Dinner", "Packed lunches", "Some meals out", "Drinks included"];
const TRANSFERS = [
  "Airport transfers",
  "Transfers between stops",
  "Public transport",
  "Coach",
  "Car hire",
  "No transfers needed",
];
const ANSWERS: { value: AssessmentStatus; label: string }[] = [
  { value: "yes", label: "Yes, we can do this" },
  { value: "partial", label: "Partly" },
  { value: "no", label: "No, we cannot" },
  { value: "unknown", label: "Leave it to the organizer's system" },
];

const STEPS = ["Your quote", "How you would run it", "The requirements", "Send it"];

function Chips({
  options,
  value,
  onChange,
  multiple = false,
}: {
  options: string[];
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

export function SupplierPortal({ token }: { token: string }) {
  const invitation = useQuery(api.invites.getByToken, { token });
  const submit = useMutation(api.invites.submitByToken);
  const getUploadUrl = useMutation(api.invites.createUploadUrl);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [draft, setDraft] = useState({
    quote: "",
    amount: "",
    currency: "USD",
    basis: "total" as "total" | "per_person" | "per_night",
    inclusions: [] as string[],
    exclusions: "",
    itinerary: "",
    rooms: [] as string[],
    meals: [] as string[],
    transfers: [] as string[],
    terms: "",
    notes: "",
  });
  const [answers, setAnswers] = useState<
    Record<number, { status: AssessmentStatus; evidence: string }>
  >({});
  const [files, setFiles] = useState<Attachment[]>([]);
  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  if (submitted)
    return (
      <main className="supplier-shell">
        <section className="supplier-panel narrow">
          <p className="eyebrow">RESPONSE RECEIVED</p>
          <h1>Thank you.</h1>
          <p>
            Your quote and any documents you attached are with the trip
            organizer. They will check it against the requirements and come back
            to you. You can close this window.
          </p>
        </section>
      </main>
    );
  if (invitation === undefined)
    return (
      <main className="supplier-shell">
        <p>Opening invitation…</p>
      </main>
    );
  if (invitation === null)
    return (
      <main className="supplier-shell">
        <section className="supplier-panel narrow">
          <p className="eyebrow">SUPPLIER RESPONSE</p>
          <h1>This invitation is not available.</h1>
          <p>
            The link may be incomplete, expired, or already withdrawn. Ask the
            trip organizer for a new response link.
          </p>
        </section>
      </main>
    );

  const amount = Number(draft.amount);
  const stepProblem = () => {
    if (step === 0) {
      if (!draft.quote.trim())
        return "Tell the organizer, in your own words, what you would offer.";
      if (!Number.isFinite(amount) || amount <= 0)
        return "Enter the price you are quoting.";
    }
    return "";
  };
  const next = () => {
    const problem = stepProblem();
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  };
  const upload = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    setError("");
    setBusy("upload");
    try {
      const added: Attachment[] = [];
      for (const file of Array.from(fileList)) {
        if (file.size > 20_000_000) {
          setError(`${file.name} is larger than 20 MB.`);
          continue;
        }
        const { url } = await getUploadUrl({ token });
        const response = await fetch(url, {
          method: "POST",
          headers: file.type ? { "Content-Type": file.type } : undefined,
          body: file,
        });
        if (!response.ok) {
          setError(`${file.name} did not upload. Try again.`);
          continue;
        }
        const body = (await response.json()) as { storageId?: unknown };
        if (typeof body.storageId !== "string") {
          setError(`${file.name} did not upload. Try again.`);
          continue;
        }
        added.push({
          storageId: body.storageId as Id<"_storage">,
          name: file.name.slice(0, 200),
          size: file.size,
          ...(file.type ? { contentType: file.type } : {}),
        });
      }
      setFiles((current) => [...current, ...added].slice(0, 5));
      if (added.length && files.length + added.length > 5)
        setError("You can attach up to 5 files. The rest were left out.");
    } catch {
      setError("The upload could not start. Try again.");
    } finally {
      setBusy("");
    }
  };

  return (
    <main className="supplier-shell">
      <section className="supplier-panel">
        <div className="portal-banner">
          <span>TripBrief</span>
          <small>Secure supplier response</small>
        </div>
        <p className="eyebrow">
          INVITATION FOR {invitation.supplierName.toUpperCase()}
        </p>
        <h1>{invitation.title}</h1>
        <p className="trip-meta">
          {invitation.destination} · {invitation.startDate} —{" "}
          {invitation.endDate} · {invitation.travelers} travellers
        </p>

        <div className="card brief-card">
          <h2>What the organizer needs</h2>
          <ol className="requirement-list">
            {invitation.requirements.map((requirement) => (
              <li key={requirement.number}>
                <span>R{requirement.number}</span>
                {requirement.text}
              </li>
            ))}
          </ol>
        </div>

        <div className="intake">
          <div className="intake-rail">
            <p className="eyebrow">
              STEP {step + 1} OF {STEPS.length}
            </p>
            <ol>
              {STEPS.map((label, index) => (
                <li
                  key={label}
                  className={
                    index === step ? "current" : index < step ? "done" : ""
                  }
                >
                  <button type="button" onClick={() => setStep(index)}>
                    {label}
                  </button>
                </li>
              ))}
            </ol>
            <p>
              <small>
                Answer what you can. Skip anything you would rather not state,
                and attach the documents you already work with.
              </small>
            </p>
          </div>

          <div className="intake-body">
            {step === 0 && (
              <>
                <h2>Your quote</h2>
                <div className="grid price-grid">
                  <label>
                    Price
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={draft.amount}
                      onChange={(event) => set("amount", event.target.value)}
                    />
                  </label>
                  <label>
                    Currency
                    <input
                      value={draft.currency}
                      maxLength={3}
                      onChange={(event) =>
                        set("currency", event.target.value.toUpperCase())
                      }
                    />
                  </label>
                  <label>
                    That price is
                    <select
                      value={draft.basis}
                      onChange={(event) =>
                        set(
                          "basis",
                          event.target.value as
                            | "total"
                            | "per_person"
                            | "per_night",
                        )
                      }
                    >
                      <option value="total">For the whole group</option>
                      <option value="per_person">Per person</option>
                      <option value="per_night">Per night</option>
                    </select>
                  </label>
                </div>
                <label>
                  Your offer, in your own words
                  <textarea
                    rows={8}
                    maxLength={20000}
                    value={draft.quote}
                    onChange={(event) => set("quote", event.target.value)}
                    placeholder="What you would put together for this group, and anything that shapes the price."
                  />
                </label>
                <fieldset>
                  <legend>The price covers</legend>
                  <Chips
                    options={COVERS}
                    value={draft.inclusions}
                    onChange={(next) => set("inclusions", next)}
                    multiple
                  />
                </fieldset>
                <label>
                  What it does not cover
                  <textarea
                    rows={3}
                    maxLength={2000}
                    value={draft.exclusions}
                    onChange={(event) => set("exclusions", event.target.value)}
                    placeholder="Anything the group would pay separately."
                  />
                </label>
              </>
            )}
            {step === 1 && (
              <>
                <h2>How you would run it</h2>
                <label>
                  The plan, day by day if you have it
                  <textarea
                    rows={8}
                    maxLength={8000}
                    value={draft.itinerary}
                    onChange={(event) => set("itinerary", event.target.value)}
                    placeholder="Arrival, the shape of each day, and where the group stays."
                  />
                </label>
                <fieldset>
                  <legend>Rooms you would use</legend>
                  <Chips
                    options={ROOM_PLANS}
                    value={draft.rooms}
                    onChange={(next) => set("rooms", next)}
                  />
                </fieldset>
                <fieldset>
                  <legend>Meals</legend>
                  <Chips
                    options={MEALS}
                    value={draft.meals}
                    onChange={(next) => set("meals", next)}
                    multiple
                  />
                </fieldset>
                <fieldset>
                  <legend>Getting around</legend>
                  <Chips
                    options={TRANSFERS}
                    value={draft.transfers}
                    onChange={(next) => set("transfers", next)}
                    multiple
                  />
                </fieldset>
                <label>
                  Terms worth knowing
                  <textarea
                    rows={4}
                    maxLength={4000}
                    value={draft.terms}
                    onChange={(event) => set("terms", event.target.value)}
                    placeholder="Deposits, cancellation, group minimums, anything with a deadline."
                  />
                </label>
              </>
            )}
            {step === 2 && (
              <>
                <h2>The requirements</h2>
                <p>
                  Answer the ones you know. Anything you leave alone will be
                  worked out from your words and your documents by the
                  organizer&rsquo;s system, and checked with you if it is unclear.
                </p>
                {invitation.requirements.map((requirement) => {
                  const answer: { status: AssessmentStatus; evidence: string } =
                    answers[requirement.number] ?? {
                      status: "unknown",
                      evidence: "",
                    };
                  const update = (next: Partial<typeof answer>) =>
                    setAnswers((current) => ({
                      ...current,
                      [requirement.number]: { ...answer, ...next },
                    }));
                  return (
                    <div className="assessment" key={requirement.number}>
                      <strong>
                        R{requirement.number} · {requirement.text}
                      </strong>
                      <div className="chips">
                        {ANSWERS.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className="chip"
                            aria-pressed={answer.status === option.value}
                            onClick={() => update({ status: option.value })}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                      <label>
                        Your words on this one (optional)
                        <input
                          maxLength={2000}
                          value={answer.evidence}
                          onChange={(event) =>
                            update({ evidence: event.target.value })
                          }
                          placeholder="Copy the sentence from your offer that answers it."
                        />
                      </label>
                    </div>
                  );
                })}
              </>
            )}
            {step === 3 && (
              <>
                <h2>Send it</h2>
                <fieldset>
                  <legend>Attach anything that helps</legend>
                  <p>
                    <small>
                      A quote as a PDF, a sample itinerary, a trip you have run
                      before. Up to 5 files, 20 MB each. Attachments are shared
                      with the trip organizer only.
                    </small>
                  </p>
                  <input
                    type="file"
                    multiple
                    aria-label="Attach documents"
                    onChange={(event) => {
                      void upload(event.currentTarget.files);
                      event.currentTarget.value = "";
                    }}
                  />
                  {busy === "upload" && <p>Uploading…</p>}
                  {files.length > 0 && (
                    <ul>
                      {files.map((file) => (
                        <li key={file.storageId}>
                          {file.name}{" "}
                          <button
                            type="button"
                            className="quiet-button"
                            onClick={() =>
                              setFiles((current) =>
                                current.filter(
                                  (item) => item.storageId !== file.storageId,
                                ),
                              )
                            }
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </fieldset>
                <label>
                  Anything else the organizer should know
                  <textarea
                    rows={4}
                    maxLength={4000}
                    value={draft.notes}
                    onChange={(event) => set("notes", event.target.value)}
                  />
                </label>
                <div className="card">
                  <h3>Before you send</h3>
                  <dl className="summary">
                    <div>
                      <dt>Price</dt>
                      <dd>
                        {draft.amount} {draft.currency}{" "}
                        {draft.basis.replaceAll("_", " ")}
                      </dd>
                    </div>
                    <div>
                      <dt>Requirements answered</dt>
                      <dd>
                        {
                          Object.values(answers).filter(
                            (answer) =>
                              answer.status !== "unknown" || answer.evidence,
                          ).length
                        }{" "}
                        of {invitation.requirements.length}
                      </dd>
                    </div>
                    <div>
                      <dt>Attachments</dt>
                      <dd>{files.length}</dd>
                    </div>
                  </dl>
                  <p>
                    <small>
                      The organizer sees your quote, your answers and your
                      documents. They never see another supplier&rsquo;s price,
                      and the group&rsquo;s budget is never shared with you.
                    </small>
                  </p>
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
                  disabled={Boolean(busy)}
                  onClick={() => {
                    const problem = stepProblem();
                    if (problem) {
                      setStep(0);
                      setError(problem);
                      return;
                    }
                    setBusy("submit");
                    setError("");
                    void submit({
                      token,
                      sourceText: draft.quote,
                      amount,
                      currency: draft.currency,
                      priceBasis: draft.basis,
                      details: {
                        inclusions: draft.inclusions,
                        ...(draft.exclusions ? { exclusions: draft.exclusions } : {}),
                        ...(draft.itinerary ? { itinerary: draft.itinerary } : {}),
                        ...(draft.rooms.length ? { rooms: draft.rooms[0] } : {}),
                        ...(draft.meals.length ? { meals: draft.meals } : {}),
                        ...(draft.transfers.length
                          ? { transfers: draft.transfers }
                          : {}),
                        ...(draft.terms ? { terms: draft.terms } : {}),
                      },
                      assessments: Object.entries(answers)
                        .map(([number, answer]) => ({
                          requirementNumber: Number(number),
                          status: answer.status,
                          evidence: answer.evidence.trim(),
                        }))
                        .filter(
                          (answer) =>
                            answer.status !== "unknown" || answer.evidence,
                        ),
                      ...(files.length
                        ? { attachments: files }
                        : {}),
                    })
                      .then(() => setSubmitted(true))
                      .catch((cause: unknown) =>
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : "Your response could not be sent. Try again.",
                        ),
                      )
                      .finally(() => setBusy(""));
                  }}
                >
                  {busy === "submit" ? "Sending…" : "Send my quote →"}
                </button>
              )}
            </div>
            <p>
              <small>
                This link is unique to {invitation.supplierName}. Do not forward
                it.
              </small>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
