import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

type AssessmentStatus = "yes" | "partial" | "no" | "unknown";

function formText(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function SupplierPortal({ token }: { token: string }) {
  const invitation = useQuery(api.invites.getByToken, { token });
  const submit = useMutation(api.invites.submitByToken);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedSupplier, setSubmittedSupplier] = useState("");
  const [error, setError] = useState("");

  if (submitted) {
    return (
      <main className="supplier-shell">
        <section className="supplier-panel narrow">
          <p className="eyebrow">RESPONSE RECEIVED</p>
          <h1>Thank you{submittedSupplier ? `, ${submittedSupplier}` : ""}.</h1>
          <p>Your proposal is now available to the trip organizer for comparison. You can close this window.</p>
        </section>
      </main>
    );
  }

  if (invitation === undefined) {
    return <main className="supplier-shell"><p>Opening invitation…</p></main>;
  }

  if (invitation === null) {
    return (
      <main className="supplier-shell">
        <section className="supplier-panel narrow">
          <p className="eyebrow">SUPPLIER RESPONSE PORTAL</p>
          <h1>This invitation is not available.</h1>
          <p>The link may be incomplete, expired, or already withdrawn. Ask the trip organizer for a new response link.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="supplier-shell">
      <section className="supplier-panel">
        <div className="portal-banner">
          <span>TripBrief</span>
          <small>Secure supplier response portal</small>
        </div>
        <p className="eyebrow">INVITATION FOR {invitation.supplierName.toUpperCase()}</p>
        <h1>{invitation.title}</h1>
        <p className="trip-meta">
          {invitation.destination} · {invitation.startDate} — {invitation.endDate} · {invitation.travelers} travelers
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

        <form
          className="card supplier-form"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const sourceText = formText(data, "source");
            const assessments = invitation.requirements.map((requirement) => ({
              requirementNumber: requirement.number,
              status: formText(data, `status${requirement.number}`) as AssessmentStatus,
              evidence: formText(data, `evidence${requirement.number}`),
            }));
            const unsupported = assessments.find(
              (assessment) => assessment.evidence && !sourceText.includes(assessment.evidence),
            );
            const missingEvidence = assessments.find(
              (assessment) =>
                assessment.status !== "unknown" &&
                !assessment.evidence,
            );
            if (unsupported) {
              setError(`R${unsupported.requirementNumber}: the supporting quotation must appear exactly in your proposal text.`);
              return;
            }
            if (missingEvidence) {
              setError(`R${missingEvidence.requirementNumber}: include an exact quotation for every assessed answer.`);
              return;
            }
            setBusy(true);
            setError("");
            void submit({
              token,
              sourceText,
              amount: Number(data.get("amount")),
              currency: formText(data, "currency").toUpperCase(),
              priceBasis: formText(data, "basis") as "total" | "per_person" | "per_night",
              assessments,
            })
              .then(() => {
                setSubmittedSupplier(invitation.supplierName);
                setSubmitted(true);
              })
              .catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : "Your response could not be submitted."),
              )
              .finally(() => setBusy(false));
          }}
        >
          <p className="eyebrow">YOUR PROPOSAL</p>
          <h2>Price and response</h2>
          <div className="grid price-grid">
            <label>
              Quoted amount
              <input name="amount" type="number" min="0.01" step="0.01" required />
            </label>
            <label>
              Currency
              <input name="currency" defaultValue="USD" pattern="[A-Za-z]{3}" maxLength={3} required />
            </label>
            <label>
              Price basis
              <select name="basis" defaultValue="total">
                <option value="total">Total group</option>
                <option value="per_person">Per person</option>
                <option value="per_night">Per night</option>
              </select>
            </label>
          </div>
          <label>
            Full proposal text
            <textarea name="source" required maxLength={20000} placeholder="Paste the complete proposal or response here. This remains the source of truth for every answer below." />
          </label>
          <h2>Requirement-by-requirement answers</h2>
          <p className="form-help">For Yes or Partial, paste the exact words from your full proposal that support the answer.</p>
          {invitation.requirements.map((requirement) => (
            <div className="assessment" key={requirement.number}>
              <strong>R{requirement.number} · {requirement.text}</strong>
              <div className="grid">
                <label>
                  Coverage
                  <select name={`status${requirement.number}`} defaultValue="unknown">
                    <option value="yes">Yes</option>
                    <option value="partial">Partial</option>
                    <option value="no">No</option>
                    <option value="unknown">Not addressed</option>
                  </select>
                </label>
                <label>
                  Exact supporting quotation
                  <input name={`evidence${requirement.number}`} maxLength={2000} placeholder="Copy exact words from your proposal" />
                </label>
              </div>
            </div>
          ))}
          {error && <p role="alert">{error}</p>}
          <button disabled={busy}>{busy ? "Submitting…" : "Submit proposal →"}</button>
          <p><small>This secure link is unique to {invitation.supplierName}. Do not forward it.</small></p>
        </form>
      </section>
    </main>
  );
}
