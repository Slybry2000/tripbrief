import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

export function PartnerResearch({ tripId }: { tripId: Id<"trips"> }) {
  const search = useAction(api.research.search);
  const save = useMutation(api.partners.save);
  const partners = useQuery(api.partners.list, { tripId });
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<Awaited<
    ReturnType<typeof search>
  > | null>(null);
  return (
    <section className="card">
      <h2>Find prospective partners</h2>
      <p>
        Search public websites with Firecrawl. These are research leads, not
        confirmed offers.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          setResults(null);
          void search({ tripId, query })
            .then(setResults)
            .catch((cause: unknown) => {
              setError(
                cause instanceof ConvexError && typeof cause.data === "string"
                  ? cause.data
                  : "Research could not finish. Please try again.",
              );
            })
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Public partner search
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            required
            minLength={3}
            maxLength={300}
            placeholder="Lisbon group travel operators"
          />
        </label>
        <small>
          Only this search text goes to Firecrawl. Do not include traveler names
          or private details.
        </small>
        <button disabled={busy}>
          {busy ? "Researching…" : "Search partner websites"}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {results?.length === 0 && (
        <p>No matching websites found. Try a broader search.</p>
      )}
      {results?.map((result) => (
        <article key={result.url}>
          <h3>
            <a href={result.url} target="_blank" rel="noopener noreferrer">
              {result.title}
            </a>
          </h3>
          <p>{result.description}</p>
          <small>
            Unverified website information · confirm directly with the supplier.
          </small>
          <button
            disabled={
              busy || partners?.some((partner) => partner.url === result.url)
            }
            onClick={() => {
              setBusy(true);
              setError("");
              void save({ tripId, ...result })
                .catch((cause: unknown) => {
                  setError(
                    cause instanceof ConvexError &&
                      typeof cause.data === "string"
                      ? cause.data
                      : "Could not save partner.",
                  );
                })
                .finally(() => setBusy(false));
            }}
          >
            {partners?.some((partner) => partner.url === result.url)
              ? "Shortlisted"
              : "Add to shortlist"}
          </button>
        </article>
      ))}
      <h3>Saved partner shortlist</h3>
      {partners === undefined ? (
        <p>Loading shortlist…</p>
      ) : partners.length === 0 ? (
        <p>No partners shortlisted yet.</p>
      ) : (
        partners.map((partner) => (
          <article key={partner._id}>
            <a href={partner.url} target="_blank" rel="noopener noreferrer">
              {partner.title}
            </a>
            <p>{partner.description}</p>
            <small>Research lead only · no invitation sent</small>
          </article>
        ))
      )}
    </section>
  );
}
