import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { newCapabilityToken } from "./capability";

// The advisor does not search. The brief already knows the destination, who is
// travelling, what they care about and what has to be avoided, so the search is
// built from it and the queries used are shown afterwards.
export function PartnerResearch({ tripId }: { tripId: Id<"trips"> }) {
  const search = useAction(api.research.searchForBrief);
  const save = useMutation(api.partners.save);
  const createFromPartner = useMutation(api.invites.createFromPartner);
  const partners = useQuery(api.partners.list, { tripId });
  const invites = useQuery(api.invites.list, { tripId });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [found, setFound] = useState<Awaited<
    ReturnType<typeof search>
  > | null>(null);
  const message = (cause: unknown, fallback: string) =>
    cause instanceof ConvexError && typeof cause.data === "string"
      ? cause.data
      : cause instanceof Error && cause.message
        ? cause.message
        : fallback;

  return (
    <section className="card">
      <p className="eyebrow">STEP ONE</p>
      <h2>Find partners for this brief</h2>
      <p>
        Nothing to type. The brief decides the search: where the group is going,
        who is travelling, what they care about, and what suppliers have to
        avoid.
      </p>
      <button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError("");
          setFound(null);
          void search({ tripId })
            .then(setFound)
            .catch((cause: unknown) =>
              setError(message(cause, "Research could not finish. Please try again.")),
            )
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Searching…" : "Search partner websites for this brief"}
      </button>
      {error && <p role="alert">{error}</p>}
      {found && (
        <>
          <p className="searched-for">
            <small>
              Searched for:{" "}
              {found.queries.map((query) => (
                <code key={query}>{query}</code>
              ))}{" "}
              {found.usedModel
                ? "— written from your brief."
                : "— built from your brief."}
            </small>
          </p>
          {found.results.length === 0 && (
            <p>
              No matching websites came back. Broaden the destination, or run it
              again later.
            </p>
          )}
          {found.results.map((result) => (
            <article key={result.url}>
              <h3>
                <a href={result.url} target="_blank" rel="noopener noreferrer">
                  {result.title}
                </a>
              </h3>
              <p>{result.description}</p>
              <small>
                Unverified website information · confirm directly with the
                supplier.
              </small>
              <button
                disabled={
                  busy || partners?.some((partner) => partner.url === result.url)
                }
                onClick={() => {
                  setBusy(true);
                  setError("");
                  // Shortlisting a partner is also the moment they become a
                  // supplier with their own response link.
                  void save({ tripId, ...result })
                    .then((partnerId) =>
                      createFromPartner({
                        tripId,
                        partnerId,
                        token: newCapabilityToken(),
                      }),
                    )
                    .catch((cause: unknown) =>
                      setError(message(cause, "Could not shortlist this partner.")),
                    )
                    .finally(() => setBusy(false));
                }}
              >
                {partners?.some((partner) => partner.url === result.url)
                  ? "On the shortlist"
                  : "Add to shortlist"}
              </button>
            </article>
          ))}
        </>
      )}
      <h3>Saved partner shortlist</h3>
      <p>
        <small>
          Shortlisting a partner also gives them a private response link, ready
          in the Suppliers card below.
        </small>
      </p>
      {partners === undefined ? (
        <p>Loading shortlist…</p>
      ) : partners.length === 0 ? (
        <p>No partners shortlisted yet.</p>
      ) : (
        partners.map((partner) => {
          const invite = invites?.find((i) => i.partnerId === partner._id);
          return (
            <article key={partner._id}>
              <a href={partner.url} target="_blank" rel="noopener noreferrer">
                {partner.title}
              </a>
              <p>{partner.description}</p>
              <small>
                {invite
                  ? invite.sentAt
                    ? "Invitation sent from the brief's inbox"
                    : "Response link ready · not sent yet"
                  : "Shortlisted · response link not created yet"}
              </small>
            </article>
          );
        })
      )}
    </section>
  );
}
