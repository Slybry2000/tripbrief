import { useRef, useState } from "react";
import { useAction, useConvexAuth, useQuery, useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { PartnerResearch } from "./PartnerResearch";
import { SupplierPortal } from "./SupplierPortal";
function formText(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}
export default function App() {
  const supplierToken = getSupplierToken();
  if (supplierToken) return <SupplierPortal token={supplierToken} />;

  return <RequesterApp />;
}

function RequesterApp() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn } = useAuthActions();
  const [error, setError] = useState("");
  return (
    <>
      <header>
        <a href="/">TripBrief</a>
        <span>THE ADVISOR'S DESK</span>
        <small>Requester workspace</small>
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
          <DataNote />
          {error && <p role="alert">{error}</p>}
        </main>
      )}
    </>
  );
}
// Plain-language data note (decision GATE-04 A). Not legal advice, and it says so.
function DataNote() {
  return (
    <details className="data-note">
      <summary>What this stores, and what it does not</summary>
      <p>
        <strong>This preview uses fictional information only.</strong> Please
        do not enter a real traveller's, client's or supplier's details yet.
      </p>
      <p>
        <strong>Stored:</strong> the trip brief and its numbered requirements;
        each supplier's name, their response text, the price and the quote from
        their own words for every requirement; and the decision you record.
      </p>
      <p>
        <strong>Not stored:</strong> payment details, passport or government
        identifiers, health information, or anything about a traveller beyond
        what you type into the brief yourself.
      </p>
      <p>
        <strong>Who can see it:</strong> only the signed-in workspace that
        created it. A supplier sees one trip's requirements through their own
        single-use link and never sees another supplier's price. Every request
        is scoped to the signed-in account, and the server takes the identity
        from the session rather than from anything the page sends.
      </p>
      <p>
        <strong>Deleting it:</strong> this preview has no delete button yet —
        ask the operator and the workspace and its briefs are removed.
      </p>
      <p>
        <small>
          This note is a plain-language summary written by the product's
          operator, not a lawyer, and it is not legal advice.
        </small>
      </p>
    </details>
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
      <SupplierInvites tripId={id} />
      <PartnerResearch key={id} tripId={id} />
      <details className="admin-import">
        <summary>Import an emailed supplier response (fallback)</summary>
        <p><small>Use this only when a supplier replied outside their secure response link. You are transcribing their original words, not answering on their behalf.</small></p>
        <button disabled={trip.status === "selected"} onClick={() => setAdding(!adding)}>
          {adding ? "Close import form" : "Import response"}
        </button>
        {adding && <OfferForm id={id} requirements={trip.requirements} done={() => setAdding(false)} />}
      </details>
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

function getSupplierToken(): string {
  const url = new URL(window.location.href);
  const hash = url.hash.startsWith("#respond=")
    ? url.hash.slice("#respond=".length)
    : "";
  try {
    return decodeURIComponent(hash);
  } catch {
    return "";
  }
}

function newCapabilityToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const encoded = btoa(String.fromCharCode(...bytes));
  return encoded.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function supplierLink(token: string): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.hash = `respond=${encodeURIComponent(token)}`;
  return url.toString();
}

function SupplierInvites({ tripId }: { tripId: Id<"trips"> }) {
  const invites = useQuery(api.invites.list, { tripId });
  const create = useMutation(api.invites.create);
  const revoke = useMutation(api.invites.revoke);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [latestLink, setLatestLink] = useState("");
  const [copied, setCopied] = useState(false);

  return (
    <div className="card invite-card">
      <p className="eyebrow">SUPPLIER RESPONSES</p>
      <h2>Invite suppliers to answer</h2>
      <p>Each supplier gets a private link to view the brief and submit their own proposal. Their answers flow directly into your comparison.</p>
      <form
        className="invite-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const supplierName = formText(data, "inviteSupplier").trim();
          const token = newCapabilityToken();
          setBusy(true);
          setError("");
          setCopied(false);
          void create({ tripId, supplierName, token })
            .then(() => {
              setLatestLink(supplierLink(token));
              form.reset();
            })
            .catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : "Could not create the supplier invitation."),
            )
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Supplier name
          <input name="inviteSupplier" required maxLength={160} placeholder="Example: Harbor House Hotel" />
        </label>
        <button disabled={busy}>{busy ? "Creating link…" : "Create response link"}</button>
      </form>
      {latestLink && (
        <div className="share-link">
          <label>
            Share this secure link with the supplier
            <input value={latestLink} readOnly onFocus={(event) => event.currentTarget.select()} />
          </label>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(latestLink).then(() => setCopied(true));
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="invite-list">
        {invites?.map((invite) => (
          <div key={invite._id}>
            <span>
              <strong>{invite.supplierName}</strong>
              <span className={`invite-status ${invite.status}`}>{invite.status}</span>
            </span>
            {invite.status === "open" && (
              <span className="invite-actions">
                <button
                  type="button"
                  className="quiet-button"
                  onClick={() => {
                    setError("");
                    void navigator.clipboard
                      .writeText(supplierLink(invite.token))
                      .then(() => setCopied(true))
                      .catch(() => setError("Copy failed. Create a fresh link and select it manually."));
                  }}
                >
                  Copy response link
                </button>
                <button
                  type="button"
                  className="quiet-button danger-button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    setError("");
                    void revoke({ inviteId: invite._id })
                      .catch((cause: unknown) =>
                        setError(cause instanceof Error ? cause.message : "Could not revoke this link."),
                      )
                      .finally(() => setBusy(false));
                  }}
                >
                  Revoke
                </button>
              </span>
            )}
          </div>
        ))}
        {invites?.length === 0 && <small>No suppliers invited yet.</small>}
      </div>
    </div>
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
