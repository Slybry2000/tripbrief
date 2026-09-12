import { useRef, useState } from "react";
import { useAction, useConvexAuth, useQuery, useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { PartnerResearch } from "./PartnerResearch";
function formText(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}
export default function App() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn } = useAuthActions();
  const [error, setError] = useState("");
  return (
    <>
      <header>
        <a href="/">TripBrief</a>
        <span>THE ADVISOR'S DESK</span>
        <small>Development preview</small>
      </header>
      {isAuthenticated ? (
        <Desk />
      ) : (
        <main className="welcome">
          <p className="eyebrow">LESS BACK-AND-FORTH. BETTER TRIPS.</p>
          <h1>
            One brief.
            <br />
            Every offer, in perspective.
          </h1>
          <p>
            Compare what each travel partner actually offers, with their words
            beside every answer.
          </p>
          <button
            disabled={isLoading}
            onClick={() => {
              void signIn("anonymous").catch(() =>
                setError("Could not open workspace. Please retry."),
              );
            }}
          >
            Open a private trial workspace →
          </button>
          <p>
            <small>
              Your trial belongs to this browser session. Use fictional
              information during this preview.
            </small>
          </p>
          {error && <p role="alert">{error}</p>}
        </main>
      )}
    </>
  );
}
function Desk() {
  const trips = useQuery(api.trips.list, {});
  const [id, setId] = useState<Id<"trips"> | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <div className="desk">
      <aside>
        <p className="eyebrow">YOUR TRIPS</p>
        <button onClick={() => setCreating(true)}>＋ New brief</button>
        {trips?.map((t) => (
          <button
            className="trip"
            key={t._id}
            onClick={() => {
              setId(t._id);
              setCreating(false);
            }}
          >
            <strong>{t.title}</strong>
            <small>
              {t.destination} · {t.travelers} travelers
            </small>
          </button>
        ))}
      </aside>
      <main>
        {creating ? (
          <NewTrip
            done={(i) => {
              setId(i);
              setCreating(false);
            }}
          />
        ) : id ? (
          <Trip key={id} id={id} />
        ) : (
          <section>
            <h1>A great trip starts here.</h1>
            <p>Give every supplier a consistent starting point.</p>
            <button onClick={() => setCreating(true)}>
              Create your first brief →
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
function NewTrip({ done }: { done: (id: Id<"trips">) => void }) {
  const create = useMutation(api.trips.create);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <section>
      <p className="eyebrow">01 / THE BRIEF</p>
      <h1>What are we planning?</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          setBusy(true);
          void create({
            title: formText(d, "title"),
            destination: formText(d, "destination"),
            startDate: formText(d, "start"),
            endDate: formText(d, "end"),
            travelers: Number(d.get("travelers")),
            brief: formText(d, "brief"),
            requirements: formText(d, "requirements")
              .split("\n")
              .map((x) => x.trim())
              .filter(Boolean),
          })
            .then(done)
            .catch((e) => setError(String(e)))
            .finally(() => setBusy(false));
        }}
      >
        <div className="grid">
          <label>
            Trip name
            <input name="title" required maxLength={160} />
          </label>
          <label>
            Destination
            <input name="destination" required maxLength={160} />
          </label>
          <label>
            Arrival
            <input name="start" type="date" required />
          </label>
          <label>
            Departure
            <input name="end" type="date" required />
          </label>
          <label>
            Travelers
            <input
              name="travelers"
              type="number"
              min="1"
              max="500"
              defaultValue="16"
              required
            />
          </label>
        </div>
        <label>
          The group's brief
          <textarea name="brief" required maxLength={10000} />
        </label>
        <label>
          Requirements · one per line
          <textarea
            name="requirements"
            required
            placeholder={"Private rooms\nGuided walks\nVegetarian meals"}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button disabled={busy}>{busy ? "Saving…" : "Save brief →"}</button>
      </form>
    </section>
  );
}
function Trip({ id }: { id: Id<"trips"> }) {
  const data = useQuery(api.trips.get, { tripId: id });
  const select = useMutation(api.trips.selectOffer);
  const provisionInbox = useAction(api.inboxes.provision);
  const [adding, setAdding] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!data) return <p>Loading brief…</p>;
  const { trip, offers } = data;
  return (
    <section>
      <p className="eyebrow">THE TRIP DESK / {trip.destination}</p>
      <h1>{trip.title}</h1>
      <p>
        {trip.startDate} — {trip.endDate} · {trip.travelers} travelers
      </p>
      <button
        disabled={trip.status === "selected"}
        onClick={() => setAdding(!adding)}
      >
        {adding ? "Close form" : "+ Record an offer"}
      </button>
      <div className="card">
        <h2>The shared brief</h2>
        <p>{trip.brief}</p>
      </div>
      <div className="card">
        <h2>Trip inbox</h2>
        {trip.agentMailInboxEmail ? (
          <p>
            <strong>{trip.agentMailInboxEmail}</strong>
            <br />
            <small>
              Supplier replies will stay attached to this brief when inbound
              routing is enabled. No email has been sent.
            </small>
          </p>
        ) : (
          <>
            <p>
              Give this brief its own AgentMail address. Creating an inbox does
              not contact suppliers.
            </p>
            <button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                void provisionInbox({ tripId: id })
                  .catch((cause: unknown) =>
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "Could not create the trip inbox.",
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "Creating inbox…" : "Create this trip's inbox"}
            </button>
          </>
        )}
      </div>
      <PartnerResearch key={id} tripId={id} />
      {adding && (
        <OfferForm
          id={id}
          requirements={trip.requirements}
          done={() => setAdding(false)}
        />
      )}
      <h2>Compare the details · {offers.length} offers</h2>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Requirement</th>
              {offers.map((o) => (
                <th key={o._id}>
                  {o.supplierName}
                  <small>
                    {o.amount} {o.currency} /{" "}
                    {o.priceBasis.replaceAll("_", " ")}
                  </small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trip.requirements.map((r) => (
              <tr key={r.number}>
                <th>
                  R{r.number} · {r.text}
                </th>
                {offers.map((o) => {
                  const a = o.assessments.find(
                    (a) => a.requirementNumber === r.number,
                  );
                  return (
                    <td key={o._id}>
                      <span className={"status " + a?.status}>
                        {a?.status ?? "unknown"}
                      </span>
                      <p>
                        {a?.evidence || "No supporting statement supplied."}
                      </p>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {trip.selectedOfferId ? (
        <div className="card">
          <h2>
            Selected:{" "}
            {offers.find((o) => o._id === trip.selectedOfferId)?.supplierName}
          </h2>
          <p>{trip.selectionReason}</p>
        </div>
      ) : (
        offers.length > 0 && (
          <div className="card">
            <h2>Your decision</h2>
            <label>
              Explain your choice
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={2000}
              />
            </label>
            <div className="actions">
              {offers.map((o) => (
                <button
                  disabled={busy || !reason.trim()}
                  key={o._id}
                  onClick={() => {
                    setBusy(true);
                    void select({ tripId: id, offerId: o._id, reason })
                      .catch((e) => setError(String(e)))
                      .finally(() => setBusy(false));
                  }}
                >
                  Choose {o.supplierName}
                </button>
              ))}
            </div>
            {error && <p role="alert">{error}</p>}
          </div>
        )
      )}
      <h2>Original responses</h2>
      {offers.map((o) => (
        <details key={o._id}>
          <summary>{o.supplierName}</summary>
          <pre>{o.sourceText}</pre>
        </details>
      ))}
    </section>
  );
}
function OfferForm({
  id,
  requirements,
  done,
}: {
  id: Id<"trips">;
  requirements: { number: number; text: string }[];
  done: () => void;
}) {
  const add = useMutation(api.trips.addOffer);
  const analyze = useAction(api.analysis.analyzeOffer);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Awaited<
    ReturnType<typeof analyze>
  > | null>(null);
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        setBusy(true);
        void add({
          tripId: id,
          supplierName: formText(d, "supplier"),
          sourceText: formText(d, "source"),
          amount: Number(d.get("amount")),
          currency: formText(d, "currency"),
          priceBasis: formText(d, "basis") as
            "total" | "per_person" | "per_night",
          assessments: requirements.map((r) => ({
            requirementNumber: r.number,
            status: formText(d, "status" + r.number) as
              "yes" | "partial" | "no" | "unknown",
            evidence: formText(d, "evidence" + r.number),
          })),
        })
          .then(done)
          .catch((e) => setError(String(e)))
          .finally(() => setBusy(false));
      }}
    >
      <h2>Record a supplier offer</h2>
      <label>
        Supplier name
        <input name="supplier" required maxLength={160} />
      </label>
      <label>
        Original response
        <textarea
          ref={sourceRef}
          name="source"
          required
          maxLength={20000}
          onChange={() => setDraft(null)}
        />
      </label>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          const sourceText = sourceRef.current?.value ?? "";
          setBusy(true);
          setError("");
          setDraft(null);
          void analyze({ tripId: id, sourceText })
            .then(setDraft)
            .catch((cause: unknown) => {
              setError(
                cause instanceof Error
                  ? cause.message
                  : "AI analysis could not finish.",
              );
            })
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Analyzing…" : "Analyze response with OpenAI"}
      </button>
      {draft && (
        <section className="ai-draft">
          <h3>AI review draft — verify before saving</h3>
          {draft.assessments.map((item) => (
            <p key={item.requirementNumber}>
              <strong>
                R{item.requirementNumber}: {item.status}
              </strong>
              {item.evidence
                ? ` — “${item.evidence}”`
                : " — no supported answer"}
            </p>
          ))}
          {draft.caveats.map((caveat) => (
            <p key={caveat}>
              <small>Review: {caveat}</small>
            </p>
          ))}
          <p>
            <small>
              This draft does not change the comparison. Transfer each answer
              only after you verify it against the original response.
            </small>
          </p>
        </section>
      )}
      <div className="grid">
        <label>
          Quoted amount
          <input name="amount" type="number" min="0.01" step="0.01" required />
        </label>
        <label>
          Currency
          <input
            name="currency"
            required
            pattern="[A-Z]{3}"
            defaultValue="USD"
            maxLength={3}
          />
        </label>
        <label>
          Price basis
          <select name="basis">
            <option value="total">Total group</option>
            <option value="per_person">Per person</option>
            <option value="per_night">Per night</option>
          </select>
        </label>
      </div>
      {requirements.map((r) => (
        <div className="assessment" key={r.number}>
          <strong>
            R{r.number} · {r.text}
          </strong>
          <label>
            Coverage
            <select name={"status" + r.number} defaultValue="unknown">
              <option value="unknown">Unknown</option>
              <option value="yes">Yes</option>
              <option value="partial">Partial</option>
              <option value="no">No</option>
            </select>
          </label>
          <label>
            Supporting quotation
            <input
              name={"evidence" + r.number}
              placeholder="Exact words from the response"
              maxLength={2000}
            />
          </label>
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
      <button disabled={busy}>{busy ? "Saving…" : "Add to comparison"}</button>
    </form>
  );
}
