import { ConvexError, v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { attachment } from "./schema";

export type AssessmentInput = {
  requirementNumber: number;
  status: "yes" | "partial" | "no" | "unknown";
  evidence: string;
};
export type AttachmentInput = {
  storageId: string;
  name: string;
  size: number;
  contentType?: string;
};

export const attachmentsValidator = v.array(attachment);

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 20_000_000;

// Attachments are the supplier's own documents. They are stored as-is and never
// rewritten: the file the supplier sent stays the evidence.
export async function checkAttachments(
  ctx: MutationCtx,
  attachments: AttachmentInput[] | undefined,
) {
  if (!attachments?.length) return;
  if (attachments.length > MAX_ATTACHMENTS)
    throw new ConvexError(`Attach at most ${MAX_ATTACHMENTS} files.`);
  for (const file of attachments) {
    const name = file.name.trim();
    if (!name || name.length > 200)
      throw new ConvexError("Each attachment needs a file name.");
    if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_ATTACHMENT_BYTES)
      throw new ConvexError("Each attachment must be under 20 MB.");
    const stored = await ctx.db.system.get("_storage", file.storageId as never);
    if (!stored)
      throw new ConvexError(`The upload for ${name} did not finish. Try again.`);
  }
}

// A supplier may answer some requirements, none of them, or all of them. What is
// never allowed is inventing evidence: anything they quote has to appear in the
// material they sent. `complete` is the advisor's own path, which still demands
// an answer for every requirement.
export function checkAssessments(
  assessments: AssessmentInput[] | undefined,
  requirements: { number: number; text: string }[],
  sourceText: string,
  {
    complete,
    requireEvidence,
    evidenceMustAppearInSource,
  }: {
    complete: boolean;
    requireEvidence: boolean;
    evidenceMustAppearInSource: boolean;
  },
) {
  const given = assessments ?? [];
  const valid = new Set(requirements.map((requirement) => requirement.number));
  if (new Set(given.map((item) => item.requirementNumber)).size !== given.length)
    throw new ConvexError(
      complete
        ? "Every requirement needs exactly one assessment."
        : "Each requirement can be answered once.",
    );
  if (given.some((item) => !valid.has(item.requirementNumber)))
    throw new ConvexError("That requirement is not part of this brief.");
  if (complete && given.length !== requirements.length)
    throw new ConvexError("Every requirement needs exactly one assessment.");
  const checked = given.map((item) => {
    const evidence = item.evidence.trim();
    if (evidence.length > 2000)
      throw new ConvexError("Keep each quotation under 2,000 characters.");
    if (requireEvidence && item.status !== "unknown" && !evidence)
      throw new ConvexError(
        "Each assessed answer needs proposal evidence (up to 2,000 characters).",
      );
    // The substring rule exists to stop an advisor or a model inventing support
    // for a requirement. A supplier writing their own answer is the source, so
    // the rule does not apply to their own words. It always applies to the
    // engine: analysis.ts re-checks every model quotation against the response.
    if (evidenceMustAppearInSource && evidence && !sourceText.includes(evidence))
      throw new ConvexError(
        requireEvidence
          ? "Evidence must be an exact excerpt from the original proposal."
          : "A quotation has to be your own words from this response — it was not found in what you sent.",
      );
    return { ...item, evidence };
  });
  return checked;
}

// The one document every later step reads: the engine, the evidence check and
// the advisor. Keeping it assembled in one place is what stops the stored
// response drifting from what the supplier actually sent.
export function assembleResponseText(parts: {
  quote?: string;
  inclusions?: string[];
  exclusions?: string;
  itinerary?: string;
  rooms?: string;
  meals?: string[];
  transfers?: string[];
  terms?: string;
  answers?: { requirementText: string; answer: string }[];
  notes?: string;
}) {
  const lines: string[] = [];
  const section = (heading: string, body: string | undefined) => {
    if (!body?.trim()) return;
    lines.push(`${heading}:`, body.trim(), "");
  };
  section("Proposal", parts.quote);
  section("Price covers", parts.inclusions?.join(", "));
  section("Not covered", parts.exclusions);
  section("Itinerary", parts.itinerary);
  section("Rooms", parts.rooms);
  section("Meals", parts.meals?.join(", "));
  section("Transfers", parts.transfers?.join(", "));
  section("Terms", parts.terms);
  const answered = (parts.answers ?? []).filter((answer) => answer.answer.trim());
  if (answered.length) {
    lines.push("Requirement answers:");
    for (const answer of answered)
      lines.push(`- ${answer.requirementText}: ${answer.answer.trim()}`);
    lines.push("");
  }
  section("Anything else", parts.notes);
  return lines.join("\n").trim();
}
