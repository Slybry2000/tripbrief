import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

// Follow-ups in the request's own thread. The agency reads every word before it
// goes: a draft is shown, can be edited, and is sent only by the approve button.
// Editing an approved draft takes the approval away.

type Row = FunctionReturnType<typeof api.followUps.forBrief>[number];
type FollowUp = NonNullable<Row["nudge"]>;

const REASON: Record<Row["gaps"][number]["reason"], string> = {
  unanswered: "not answered",
  partly: "answered partly",
  unclear: "answer unclear",
};

const when = (at: number) => new Date(at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function errorText(cause: unknown, fallback: string) {
  if (!(cause instanceof Error)) return fallback;
  return cause.message.replace(/^\[.*?\]\s*/, "").replace(/^Uncaught (Convex)?Error:\s*/, "") || fallback;
}

function Draft({ item, title, demo }: { item: FollowUp; title: string; demo: boolean }) {
  const edit = useMutation(api.followUps.edit);
  const approve = useMutation(api.followUps.approve);
  const discard = useMutation(api.followUps.discard);
  const [text, setText] = useState(item.text);
  const [seen, setSeen] = useState(item.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The server's text moved on (a save, a fresh draft): show it rather than a
  // stale copy the agency might approve by mistake.
  if (item.text !== seen) { setSeen(item.text); setText(item.text); }
  const unsaved = text !== item.text;
  const open = item.status === "draft" || item.status === "approved" || item.status === "failed";
  const run = async (work: () => Promise<unknown>, fallback: string) => {
    setError(""); setBusy(true);
    try { await work(); } catch (cause) { setError(errorText(cause, fallback)); } finally { setBusy(false); }
  };
  const id = item._id;
  return <div className="draft-review">
    <div className="section-heading split-heading"><div><p className="eyebrow">{title}{item.requirementIds.length ? ` · ${item.requirementIds.join(", ")}` : ""}</p><p className="form-help">{demo ? "Demo mode: this goes to TripBrief's stand-in inbox, never to the operator." : "Sent as a reply in the same thread as your request, so their answer is matched to it."}</p></div>
      <span className={`status-badge ${item.status === "sent" ? "" : "pending"}`}>{item.status === "sent" ? `Sent ${item.sentAt ? when(item.sentAt) : ""}` : item.status === "sending" || item.approved ? "Approved · sending…" : item.status === "failed" ? "Not sent" : item.status === "cancelled" ? "No longer needed" : item.status === "discarded" ? "Discarded" : "Draft · not sent"}</span></div>
    {item.status === "failed" && item.sendError && <div className="inline-warning"><strong>Not sent</strong><span>{item.sendError} Nothing reached the operator. Approve again to retry.</span></div>}
    {error && <div className="inline-warning" role="alert"><strong>Follow-up</strong><span>{error}</span></div>}
    <label className="wide">Message<textarea rows={12} value={text} readOnly={!open || busy} onChange={(event) => setText(event.target.value)} /></label>
    {open && <div className="sticky-action"><span>{unsaved ? "Save your changes, then read it once more before approving." : "Nothing is sent until you approve this exact text."}</span>
      <div className="brief-actions">
        <button className="secondary" disabled={busy} onClick={() => void run(() => discard({ followUpId: id }), "The draft could not be discarded.")}>Discard</button>
        {unsaved && <button className="secondary" disabled={busy} onClick={() => void run(() => edit({ followUpId: id, text }), "The changes could not be saved.")}>Save changes</button>}
        <button className="primary" disabled={busy || unsaved} onClick={() => void run(() => approve({ followUpId: id, text: item.text }), "The follow-up could not be approved.")}>Approve and send →</button>
      </div></div>}
  </div>;
}

function OperatorFollowUps({ row, demo }: { row: Row; demo: boolean }) {
  const draftGaps = useMutation(api.followUps.draftGapFollowUp);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nudgeOpen = row.nudge && !(row.replied && row.nudge.status === "draft") && row.nudge.status !== "discarded";
  const gapDraft = row.gapFollowUp && row.gapFollowUp.status !== "discarded" ? row.gapFollowUp : null;
  const ask = async () => {
    setError(""); setBusy(true);
    try { await draftGaps({ briefOperatorId: row.briefOperatorId }); } catch (cause) { setError(errorText(cause, "The follow-up could not be drafted.")); } finally { setBusy(false); }
  };
  return <article className="reply-compose">
    <div><h3>{row.operatorName}</h3><p>{row.replied
      ? row.gaps.length ? `Replied. ${row.gaps.length} must-have${row.gaps.length === 1 ? " is" : "s are"} still open:` : "Replied, and every must-have is answered."
      : row.nudge ? "No reply yet." : row.nudgeDueAt ? `No reply yet. If none arrives by ${when(row.nudgeDueAt)}, one polite nudge is drafted here for you to approve.` : "No reply yet."}</p>
      {row.replied && row.gaps.length > 0 && <ul className="gap-list">{row.gaps.map((gap) => <li key={gap.id}><strong>{gap.id} {gap.label}</strong> · {REASON[gap.reason]}{gap.quote ? <> — “{gap.quote}”</> : null}</li>)}</ul>}
      {row.answer && <p className="inline-success">Their answer to your question has arrived. Read it into the comparison from the emailed replies below.</p>}
      {error && <div className="inline-warning" role="alert"><strong>Follow-up</strong><span>{error}</span></div>}
    </div>
    {row.replied && row.gaps.length > 0 && !gapDraft && <button className="primary" disabled={busy} onClick={() => void ask()}>{busy ? "Drafting…" : "Ask about these →"}</button>}
    {nudgeOpen && row.nudge && <Draft item={row.nudge} title="NUDGE" demo={demo} />}
    {gapDraft && <Draft item={gapDraft} title="QUESTION ABOUT THE GAPS" demo={demo} />}
  </article>;
}

export function FollowUpPanel({ briefId, demo }: { briefId: Id<"briefs">; demo: boolean }) {
  const rows = useQuery(api.followUps.forBrief, { briefId });
  if (!rows?.length) return null;
  return <section className="workflow-section reply-panel follow-up-panel"><div className="section-heading"><p className="eyebrow">FOLLOW-UPS</p><h2>Ask again, in the same thread</h2><p>An operator that goes quiet gets one polite nudge, and an operator whose reply leaves a must-have open can be asked about exactly that, by number. Every message is a draft until you approve its exact words. Change it after approving and it needs approving again.</p></div>
    {rows.map((row) => <OperatorFollowUps key={row.briefOperatorId} row={row} demo={demo} />)}
  </section>;
}
