import { useRef, useState } from "react";
import { useAction, useConvexAuth, useQuery, useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { PartnerResearch } from "./PartnerResearch";
import { SupplierPortal } from "./SupplierPortal";
import { newCapabilityToken, supplierLink } from "./capability";
import { IntakeForm } from "./IntakeForm";
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
        <strong>Deleting it:</strong> any brief can be deleted from its own
        page. That removes the brief, its requirements and group details, its
        shortlist, its suppliers and their response links, every response it
        received, and the files a supplier attached. The brief's own email
        address is retired with it; mail already sitting in that address is not
        removed from the mail provider.
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
          <IntakeForm
            done={(i) => {
              setId(i);
              setCreating(false);
            }}
          />
        ) : id ? (
          <Trip key={id} id={id} onDeleted={() => setId(null)} />
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
function Trip({ id, onDeleted }: { id: Id<"trips">; onDeleted: () => void }) {
  const data = useQuery(api.trips.get, { tripId: id });
  const select = useMutation(api.trips.selectOffer);
  const removeTrip = useMutation(api.trips.remove);
  const provisionInbox = useAction(api.inboxes.provision);
  const [adding, setAdding] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
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
      <Suppliers tripId={id} />
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
                      {o.assessments.length === 0 ? (
                        <p>
                          <small>Waiting to be standardised</small>
                        </p>
                      ) : (
                        <>
                          <span className={"status " + (a?.status ?? "unknown")}>
                            {a?.status ?? "unknown"}
                          </span>
                          <p>
                            {a?.evidence || "No supporting statement supplied."}
                          </p>
                        </>
                      )}
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
          <summary>
            {o.supplierName}
            {o.attachments?.length
              ? ` · ${o.attachments.length} attachment${o.attachments.length === 1 ? "" : "s"}`
              : ""}
          </summary>
          {o.attachments?.length ? (
            <p>
              {o.attachments.map((file) => (
                <AttachmentLink key={file.storageId} offerId={o._id} file={file} />
              ))}
            </p>
          ) : null}
          <pre>{o.sourceText}</pre>
        </details>
      ))}
      <div className="card danger-zone">
        <h2>Delete this brief</h2>
        <p>
          <small>
            This removes the brief and everything attached to it: its
            requirements and group details, its shortlist, its suppliers and
            their links, {offers.length} recorded{" "}
            {offers.length === 1 ? "response" : "responses"} and any files a
            supplier sent. It cannot be undone.
          </small>
        </p>
        {confirmingDelete ? (
          <div className="actions">
            <button
              type="button"
              className="quiet-button"
              onClick={() => setConfirmingDelete(false)}
            >
              Keep it
            </button>
            <button
              type="button"
              className="danger-button danger-solid"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                void removeTrip({ tripId: id })
                  .then(() => onDeleted())
                  .catch((cause: unknown) =>
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "The brief could not be deleted.",
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "Deleting…" : "Delete permanently"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="quiet-button danger-button"
            onClick={() => setConfirmingDelete(true)}
          >
            Delete this brief
          </button>
        )}
      </div>
    </section>
  );
}

// Each attachment is fetched through the advisor's own authenticated session, so
// the file is never at a permanent public address.
function AttachmentLink({
  offerId,
  file,
}: {
  offerId: Id<"offers">;
  file: { storageId: Id<"_storage">; name: string };
}) {
  const url = useQuery(api.trips.attachmentUrl, {
    offerId,
    storageId: file.storageId,
  });
  return (
    <span className="attachment">
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          {file.name}
        </a>
      ) : (
        file.name
      )}
    </span>
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

// Suppliers are the researched shortlist, not names typed from nothing. Each one
// gets a private response link, and the trip's own inbox sends it.
function Suppliers({ tripId }: { tripId: Id<"trips"> }) {
  const invites = useQuery(api.invites.list, { tripId });
  const partners = useQuery(api.partners.list, { tripId });
  const createFromPartner = useMutation(api.invites.createFromPartner);
  const createManual = useMutation(api.invites.create);
  const setEmail = useMutation(api.invites.setEmail);
  const sendInvitation = useAction(api.outbound.sendInvitation);
  const revoke = useMutation(api.invites.revoke);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const message = (cause: unknown, fallback: string) =>
    cause instanceof Error && cause.message ? cause.message : fallback;
  const waiting = (partners ?? []).filter(
    (partner) => !(invites ?? []).some((i) => i.partnerId === partner._id),
  );

  return (
    <div className="card invite-card">
      <p className="eyebrow">SUPPLIERS</p>
      <h2>Who is quoting</h2>
      <p>
        Suppliers come from the shortlist you build above. Each one gets their
        own private link, and the brief&rsquo;s own inbox sends it for you.
      </p>
      {waiting.length > 0 && (
        <>
          <p>
            <small>
              {waiting.length} shortlisted{" "}
              {waiting.length === 1 ? "partner has" : "partners have"} no
              response link yet.
            </small>
          </p>
          <button
            disabled={Boolean(busy)}
            onClick={() => {
              setBusy("links");
              setError("");
              void (async () => {
                for (const partner of waiting) {
                  try {
                    await createFromPartner({
                      tripId,
                      partnerId: partner._id,
                      token: newCapabilityToken(),
                    });
                  } catch (cause) {
                    setError(
                      message(
                        cause,
                        `Could not create a link for ${partner.title}.`,
                      ),
                    );
                  }
                }
              })().finally(() => setBusy(""));
            }}
          >
            {busy === "links"
              ? "Creating links…"
              : `Create ${waiting.length} response ${waiting.length === 1 ? "link" : "links"} →`}
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="invite-list">
        {invites?.map((invite) => (
          <div key={invite._id}>
            <span>
              <strong>{invite.supplierName}</strong>
              <span className={`invite-status ${invite.status}`}>
                {invite.status}
              </span>
              {invite.sentAt ? (
                <small>
                  Invitation sent {new Date(invite.sentAt).toLocaleDateString()}
                </small>
              ) : invite.email ? (
                <small>Link ready for {invite.email} — not sent yet</small>
              ) : (
                <small>Link ready — add an email address to send it</small>
              )}
              {invite.sendError && (
                <small role="alert">{invite.sendError}</small>
              )}
            </span>
            <span className="supplier-link">
              <input
                readOnly
                aria-label={`Response link for ${invite.supplierName}`}
                value={supplierLink(invite.token)}
                onFocus={(event) => event.currentTarget.select()}
              />
              <button
                type="button"
                className="quiet-button"
                onClick={() => {
                  setError("");
                  void navigator.clipboard
                    .writeText(supplierLink(invite.token))
                    .then(() => setCopied(invite._id))
                    .catch(() =>
                      setError(
                        "Copy failed. Select the link and copy it manually.",
                      ),
                    );
                }}
              >
                {copied === invite._id ? "Copied" : "Copy link"}
              </button>
            </span>
            {invite.status === "open" && !invite.sentAt && (
              <span className="invite-actions">
                {invite.email ? (
                  <button
                    type="button"
                    disabled={busy === invite._id}
                    onClick={() => {
                      setBusy(invite._id);
                      setError("");
                      void sendInvitation({ inviteId: invite._id })
                        .catch((cause: unknown) =>
                          setError(
                            message(cause, "The invitation could not be sent."),
                          ),
                        )
                        .finally(() => setBusy(""));
                    }}
                  >
                    {busy === invite._id
                      ? "Sending…"
                      : `Send invitation to ${invite.email}`}
                  </button>
                ) : (
                  <form
                    className="supplier-email"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const data = new FormData(event.currentTarget);
                      setBusy(invite._id);
                      setError("");
                      void setEmail({
                        inviteId: invite._id,
                        email: formText(data, "supplierEmail"),
                      })
                        .catch((cause: unknown) =>
                          setError(
                            message(cause, "Could not save that email address."),
                          ),
                        )
                        .finally(() => setBusy(""));
                    }}
                  >
                    <input
                      name="supplierEmail"
                      type="email"
                      required
                      maxLength={254}
                      aria-label={`Email address for ${invite.supplierName}`}
                      placeholder="supplier@example.com"
                    />
                    <button disabled={busy === invite._id}>Save email</button>
                  </form>
                )}
                <button
                  type="button"
                  className="quiet-button danger-button"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    setBusy(invite._id);
                    setError("");
                    void revoke({ inviteId: invite._id })
                      .catch((cause: unknown) =>
                        setError(message(cause, "Could not revoke this link.")),
                      )
                      .finally(() => setBusy(""));
                  }}
                >
                  Revoke
                </button>
              </span>
            )}
          </div>
        ))}
        {invites?.length === 0 && (
          <small>
            No suppliers yet. Search for partners above, add them to the
            shortlist, then create their response links here.
          </small>
        )}
      </div>
      <details>
        <summary>Add a supplier that search did not find</summary>
        <form
          className="invite-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            const email = formText(data, "newSupplierEmail").trim();
            setBusy("manual");
            setError("");
            void createManual({
              tripId,
              supplierName: formText(data, "newSupplierName").trim(),
              token: newCapabilityToken(),
              ...(email ? { email } : {}),
            })
              .then(() => form.reset())
              .catch((cause: unknown) =>
                setError(message(cause, "Could not add that supplier.")),
              )
              .finally(() => setBusy(""));
          }}
        >
          <label>
            Supplier name
            <input
              name="newSupplierName"
              required
              maxLength={160}
              placeholder="Example: Harbor House Hotel"
            />
          </label>
          <label>
            Email address (optional for now)
            <input name="newSupplierEmail" type="email" maxLength={254} />
          </label>
          <button disabled={busy === "manual"}>Add supplier</button>
        </form>
      </details>
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
