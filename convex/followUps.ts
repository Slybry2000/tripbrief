import { WorkflowManager } from "@convex-dev/workflow";
import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  env,
  internalAction,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { demoMode } from "./demo";
import { isSendableAddress } from "./outbound";
import { requestFromBrief } from "./demoResponder";
import { buildRequirements, type Requirement } from "../src/lib/requirements";

// Follow-ups are the only mail the agency sends after the request, and they obey
// one rule above the others: nothing leaves without a person approving the exact
// words. The model is never involved. A nudge and a gap question are both written
// from fixed templates, so what is approved is what the agency read.

export const workflow = new WorkflowManager(components.workflow);

const DAY = 24 * 60 * 60 * 1000;
const TEXT_LIMIT = 6_000;

// How long a request may sit unanswered before a nudge is drafted. Read once, when
// the request is sent, so a change applies to new requests and never moves a timer
// that is already sleeping.
export function nudgeDelayMs(value = env.FOLLOW_UP_NUDGE_DAYS) {
  const days = Number((value ?? "").trim());
  if (!value?.trim() || !Number.isFinite(days) || days <= 0) return 3 * DAY;
  return Math.round(Math.min(days, 60) * DAY);
}

// ---------------------------------------------------------------------------
// Which must-haves a reply left open
// ---------------------------------------------------------------------------

type Answer = { key: string; answer: "yes" | "partly" | "no"; note: string; quote?: string };

export type Gap = {
  key: string;
  id: string;
  label: string;
  ask: string;
  reason: "unanswered" | "partly" | "unclear";
  quote?: string;
};

// Words that put an answer off rather than give it. A "yes" in these terms is not
// something the agency can price on, so it is asked about again. A clear "no" is
// never a gap: it is an answer, and a useful one.
const HEDGE =
  /\b(tbc|tba|to be (confirmed|advised|determined)|(we|we'll|we will|i|i'll|i will) (can |will )?(confirm|check|revert|come back|get back|let you know)|subject to (availability|confirmation)|depend(s|ing) on|if possible|where possible|should be (fine|possible|ok)|probably|not sure|hopefully)\b/i;

export function findGaps(requirements: Requirement[], answers: Answer[] | undefined): Gap[] {
  const byKey = new Map((answers ?? []).map((item) => [item.key, item]));
  const gaps: Gap[] = [];
  for (const requirement of requirements) {
    if (requirement.tier !== "must") continue;
    const base = { key: requirement.key, id: requirement.id, label: requirement.label, ask: requirement.ask };
    const given = byKey.get(requirement.key);
    const quote = given?.quote?.trim() || undefined;
    if (!given) gaps.push({ ...base, reason: "unanswered" });
    else if (given.answer === "partly") gaps.push({ ...base, reason: "partly", ...(quote ? { quote } : {}) });
    else if (given.answer === "yes" && HEDGE.test(`${quote ?? ""} ${given.note}`))
      gaps.push({ ...base, reason: "unclear", ...(quote ? { quote } : {}) });
  }
  return gaps;
}

// ---------------------------------------------------------------------------
// The two messages
// ---------------------------------------------------------------------------

const responseLink = (token: string) =>
  `${env.SITE_URL?.trim() || env.CONVEX_SITE_URL}/#respond=${encodeURIComponent(token)}`;

const shortDate = (at: number) =>
  new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

// Plain and short: the operator already has the brief, and a nudge that restates
// it reads as pressure. It offers a way out, because a quick no is worth more to
// the agency than a quote that never comes.
export function nudgeText(
  brief: Pick<Doc<"briefs">, "name" | "earliestDepartureDate" | "latestDepartureDate" | "nights" | "travelerCount">,
  operatorName: string,
  sentAt: number,
  link: string,
) {
  return [
    `Hello ${operatorName},`,
    "",
    `A short follow-up on our request for ${brief.name} (${brief.earliestDepartureDate} to ${brief.latestDepartureDate}, ${brief.nights} nights, ${brief.travelerCount} travellers), which we sent on ${shortDate(sentAt)}.`,
    "",
    "If you are able to quote, the brief and the proposal form are at your private link:",
    link,
    "",
    "If the dates or the group do not suit you, a one-line reply saying so is just as helpful, so we can plan around it.",
    "",
    "Thank you.",
  ].join("\n");
}

// Each open must-have is named by its number and label, the way the operator's
// packet numbered it, so the answer lines up with every other operator's. Only the
// question is repeated, never the client's own details: those stay behind the link.
export function gapText(brief: Pick<Doc<"briefs">, "name">, operatorName: string, gaps: Gap[], link: string) {
  const line = (gap: Gap) => {
    const quoted = gap.quote ? ` You wrote: "${gap.quote.slice(0, 240)}".` : "";
    if (gap.reason === "unanswered") return `${gap.id} ${gap.label}: we could not find an answer to this in your reply. ${gap.ask}`;
    if (gap.reason === "partly") return `${gap.id} ${gap.label}: you said you can partly meet this.${quoted} Could you say exactly what you can confirm, and what would change? ${gap.ask}`;
    return `${gap.id} ${gap.label}: we were not sure how to read your answer.${quoted} ${gap.ask}`;
  };
  return [
    `Hello ${operatorName},`,
    "",
    `Thank you for your proposal for ${brief.name}. Before we compare it with the others, could you help us with ${gaps.length === 1 ? "one point" : `${gaps.length} points`} from the numbered requirements?`,
    "",
    ...gaps.map(line),
    "",
    `The full brief is still at your private link: ${link}`,
    "",
    "A short reply to this email is all we need, and a clear no is as useful as a yes.",
    "",
    "Thank you.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Where a follow-up may go
// ---------------------------------------------------------------------------

export type Route =
  | { ok: true; inboxId: string; replyTo: string; to: string; demo: boolean }
  | { ok: false; reason: string };

// The one decision about a follow-up's recipient. It never reads the draft or
// anything a model wrote. In demo mode, and for any thread that began in demo
// mode, the stand-in inbox is the only possible recipient: the operator's real
// address is on a demo row for the agency to see, and must never be written to.
export function followUpRoute(
  demo: ReturnType<typeof demoMode>,
  row: Pick<Doc<"briefOperators">, "sentAt" | "providerMessageId" | "deliveredTo" | "email">,
  mailboxInboxId: string | undefined,
): Route {
  if (!row.sentAt || !row.providerMessageId)
    return { ok: false, reason: "The original request has no message to reply to." };
  if (demo.on || row.deliveredTo) {
    if (!demo.agencyInbox || !demo.operatorInbox)
      return { ok: false, reason: "This thread belongs to demo mode, and its stand-in inboxes are not configured." };
    return { ok: true, inboxId: demo.agencyInbox, replyTo: row.providerMessageId, to: demo.operatorInbox, demo: true };
  }
  const to = (row.email ?? "").trim().toLowerCase();
  if (!isSendableAddress(to)) return { ok: false, reason: "The request has no valid operator address." };
  if (!mailboxInboxId) return { ok: false, reason: "The mailbox the request went out from is no longer on file." };
  return { ok: true, inboxId: mailboxInboxId, replyTo: row.providerMessageId, to, demo: false };
}

// ---------------------------------------------------------------------------
// Shared reads
// ---------------------------------------------------------------------------

// Anything that shows the operator has answered: a proposal, a decline, or any
// mail filed against the request. Whatever the form, a nudge is no longer polite.
async function hasReplied(ctx: QueryCtx, row: Doc<"briefOperators">) {
  if (row.proposalId || row.status === "submitted" || row.status === "declined") return true;
  const mail = await ctx.db
    .query("inboxMessages")
    .withIndex("by_briefId", (q) => q.eq("briefId", row.briefId))
    .order("desc")
    .take(200);
  return mail.some((message) => message.briefOperatorId === row._id);
}

async function byKey(ctx: QueryCtx, dedupeKey: string) {
  return await ctx.db
    .query("followUps")
    .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
    .unique();
}

async function ownedFollowUp(ctx: MutationCtx, followUpId: Id<"followUps">) {
  const owner = await getAuthUserId(ctx);
  if (!owner) throw new ConvexError("Please sign in.");
  const followUp = await ctx.db.get("followUps", followUpId);
  if (!followUp || followUp.owner !== owner) throw new ConvexError("Follow-up not found.");
  return { owner, followUp };
}

const nudgeKey = (briefOperatorId: Id<"briefOperators">) => `nudge:${briefOperatorId}`;
const gapKey = (briefId: Id<"briefs">, operatorSlug: string) => `gaps:${briefId}:${operatorSlug}`;

function gapsForRow(brief: Doc<"briefs">, proposal: Doc<"proposals"> | null) {
  if (!proposal) return [];
  return findGaps(buildRequirements(requestFromBrief(brief)), proposal.requirementAnswers);
}

// ---------------------------------------------------------------------------
// The nudge timer
// ---------------------------------------------------------------------------

// Called once, in the same transaction that records the request as sent. The
// timer's id is written onto the request, so a second call finds it and starts
// nothing.
export async function startNudgeTimer(ctx: MutationCtx, row: Doc<"briefOperators">) {
  if (row.nudgeWorkflowId) return;
  const waitMs = nudgeDelayMs();
  const workflowId = await workflow.start(ctx, internal.followUps.nudgeWorkflow, {
    briefOperatorId: row._id,
    waitMs,
  });
  await ctx.db.patch("briefOperators", row._id, { nudgeWorkflowId: workflowId, nudgeDueAt: Date.now() + waitMs });
}

// Sleep, then look once. If the operator has answered in any form, the workflow
// ends having drafted nothing. It never sends: at most it leaves a draft.
export const nudgeWorkflow = workflow
  .define({ args: { briefOperatorId: v.id("briefOperators"), waitMs: v.number() } })
  .handler(async (step, args): Promise<void> => {
    await step.sleep(args.waitMs, { name: "wait for a reply" });
    await step.runMutation(internal.followUps.draftNudgeIfSilent, { briefOperatorId: args.briefOperatorId });
  });

export const draftNudgeIfSilent = internalMutation({
  args: { briefOperatorId: v.id("briefOperators") },
  returns: v.union(v.literal("drafted"), v.literal("replied"), v.literal("exists"), v.literal("gone")),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("briefOperators", args.briefOperatorId);
    if (!row || !row.sentAt) return "gone";
    const brief = await ctx.db.get("briefs", row.briefId);
    if (!brief) return "gone";
    if (await hasReplied(ctx, row)) return "replied";
    const dedupeKey = nudgeKey(row._id);
    if (await byKey(ctx, dedupeKey)) return "exists";
    const now = Date.now();
    await ctx.db.insert("followUps", {
      briefId: row.briefId,
      owner: row.owner,
      briefOperatorId: row._id,
      operatorSlug: row.operatorSlug,
      kind: "nudge",
      dedupeKey,
      status: "draft",
      requirementKeys: [],
      text: nudgeText(brief, row.operatorName, row.sentAt, responseLink(row.capabilityToken)),
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch("briefs", brief._id, { updatedAt: now });
    return "drafted";
  },
});

// ---------------------------------------------------------------------------
// What the agency sees and does
// ---------------------------------------------------------------------------

const followUpView = v.object({
  _id: v.id("followUps"),
  kind: v.union(v.literal("nudge"), v.literal("gaps")),
  status: v.string(),
  text: v.string(),
  // True only while the approval still matches the text word for word.
  approved: v.boolean(),
  requirementIds: v.array(v.string()),
  deliveredTo: v.optional(v.string()),
  sentAt: v.optional(v.number()),
  sendError: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const forBrief = query({
  args: { briefId: v.id("briefs") },
  returns: v.array(
    v.object({
      briefOperatorId: v.id("briefOperators"),
      operatorSlug: v.string(),
      operatorName: v.string(),
      sentAt: v.number(),
      nudgeDueAt: v.optional(v.number()),
      replied: v.boolean(),
      gaps: v.array(
        v.object({
          id: v.string(),
          label: v.string(),
          reason: v.union(v.literal("unanswered"), v.literal("partly"), v.literal("unclear")),
          quote: v.optional(v.string()),
        }),
      ),
      nudge: v.union(v.null(), followUpView),
      gapFollowUp: v.union(v.null(), followUpView),
      // The operator's answer to a gap question, joined to the reply it follows so
      // the reply reader can quote-check against both.
      answer: v.union(v.null(), v.object({ messageId: v.id("inboxMessages"), source: v.string() })),
    }),
  ),
  handler: async (ctx, args) => {
    const owner = await getAuthUserId(ctx);
    if (!owner) throw new ConvexError("Please sign in.");
    const brief = await ctx.db.get("briefs", args.briefId);
    if (!brief || brief.owner !== owner) throw new ConvexError("Brief not found.");
    const rows = await ctx.db
      .query("briefOperators")
      .withIndex("by_briefId", (q) => q.eq("briefId", brief._id))
      .take(20);
    const followUps = await ctx.db
      .query("followUps")
      .withIndex("by_briefId", (q) => q.eq("briefId", brief._id))
      .take(60);
    const mail = await ctx.db
      .query("inboxMessages")
      .withIndex("by_briefId", (q) => q.eq("briefId", brief._id))
      .order("desc")
      .take(200);
    const requirements = buildRequirements(requestFromBrief(brief));
    const idFor = new Map(requirements.map((item) => [item.key, item.id]));
    const view = (item: Doc<"followUps"> | undefined) =>
      item
        ? {
            _id: item._id,
            kind: item.kind,
            status: item.status,
            text: item.text,
            approved: item.status === "approved" && item.approvedText === item.text,
            requirementIds: item.requirementKeys.map((key) => idFor.get(key) ?? key),
            ...(item.deliveredTo ? { deliveredTo: item.deliveredTo } : {}),
            ...(item.sentAt ? { sentAt: item.sentAt } : {}),
            ...(item.sendError ? { sendError: item.sendError } : {}),
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          }
        : null;
    const out = [];
    for (const row of rows) {
      if (!row.sentAt) continue;
      const proposal = row.proposalId ? await ctx.db.get("proposals", row.proposalId) : null;
      const gapFollowUp = followUps.find((item) => item.dedupeKey === gapKey(brief._id, row.operatorSlug));
      const sentAt = gapFollowUp?.status === "sent" ? gapFollowUp.sentAt : undefined;
      const later = sentAt
        ? mail.find((message) => message.briefOperatorId === row._id && message.receivedAt > sentAt)
        : undefined;
      out.push({
        briefOperatorId: row._id,
        operatorSlug: row.operatorSlug,
        operatorName: row.operatorName,
        sentAt: row.sentAt,
        ...(row.nudgeDueAt ? { nudgeDueAt: row.nudgeDueAt } : {}),
        // The same test as `hasReplied`, over the mail already read for the brief.
        replied:
          Boolean(row.proposalId) ||
          row.status === "submitted" ||
          row.status === "declined" ||
          mail.some((message) => message.briefOperatorId === row._id),
        gaps: gapsForRow(brief, proposal).map((gap) => ({
          id: gap.id,
          label: gap.label,
          reason: gap.reason,
          ...(gap.quote ? { quote: gap.quote } : {}),
        })),
        nudge: view(followUps.find((item) => item.dedupeKey === nudgeKey(row._id))),
        gapFollowUp: view(gapFollowUp),
        answer: later
          ? {
              messageId: later._id,
              source: [proposal?.sourceText?.trim() ?? "", later.text].filter(Boolean).join("\n\n").slice(0, 20_000),
            }
          : null,
      });
    }
    return out;
  },
});

// One gap question per operator per brief. Pressing the button again finds the
// row that is already there; only a draft the agency threw away is written afresh,
// from the gaps as they stand now.
export const draftGapFollowUp = mutation({
  args: { briefOperatorId: v.id("briefOperators") },
  returns: v.id("followUps"),
  handler: async (ctx, args) => {
    const owner = await getAuthUserId(ctx);
    if (!owner) throw new ConvexError("Please sign in.");
    const row = await ctx.db.get("briefOperators", args.briefOperatorId);
    if (!row || row.owner !== owner) throw new ConvexError("That operator is not on one of your briefs.");
    const brief = await ctx.db.get("briefs", row.briefId);
    if (!brief) throw new ConvexError("Brief not found.");
    if (!row.sentAt) throw new ConvexError("The request has not been sent, so there is no thread to follow up in.");
    const proposal = row.proposalId ? await ctx.db.get("proposals", row.proposalId) : null;
    if (!proposal) throw new ConvexError("There is no reply to follow up on yet.");
    const gaps = gapsForRow(brief, proposal);
    if (!gaps.length) throw new ConvexError("Every must-have is answered. There is nothing to ask.");
    const dedupeKey = gapKey(brief._id, row.operatorSlug);
    const existing = await byKey(ctx, dedupeKey);
    if (existing && existing.status !== "discarded") return existing._id;
    const now = Date.now();
    const fields = {
      status: "draft" as const,
      requirementKeys: gaps.map((gap) => gap.key),
      text: gapText(brief, row.operatorName, gaps, responseLink(row.capabilityToken)),
      approvedText: undefined,
      approvedAt: undefined,
      approvedBy: undefined,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch("followUps", existing._id, fields);
      return existing._id;
    }
    return await ctx.db.insert("followUps", {
      briefId: brief._id,
      owner,
      briefOperatorId: row._id,
      operatorSlug: row.operatorSlug,
      kind: "gaps",
      dedupeKey,
      createdAt: now,
      ...fields,
    });
  },
});

// Editing is always allowed until sending starts, and any edit voids an approval:
// the agency approved words, not a draft.
export const edit = mutation({
  args: { followUpId: v.id("followUps"), text: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { followUp } = await ownedFollowUp(ctx, args.followUpId);
    if (!["draft", "approved", "failed"].includes(followUp.status))
      throw new ConvexError("This follow-up can no longer be changed.");
    const text = args.text.slice(0, TEXT_LIMIT);
    if (text === followUp.text) return null;
    await ctx.db.patch("followUps", followUp._id, {
      text,
      status: "draft",
      approvedText: undefined,
      approvedAt: undefined,
      approvedBy: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

// The approval carries the text the agency was looking at. If it is not the text
// on file, the agency approved something else, and nothing is sent.
export const approve = mutation({
  args: { followUpId: v.id("followUps"), text: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { owner, followUp } = await ownedFollowUp(ctx, args.followUpId);
    if (followUp.status !== "draft" && followUp.status !== "failed")
      throw new ConvexError("This follow-up is not waiting for approval.");
    if (args.text !== followUp.text)
      throw new ConvexError("The draft changed since you read it. Read it again, then approve.");
    if (followUp.text.trim().length < 20) throw new ConvexError("The message is too short to send.");
    const row = await ctx.db.get("briefOperators", followUp.briefOperatorId);
    if (!row) throw new ConvexError("That operator is no longer on this brief.");
    if (followUp.kind === "nudge" && (await hasReplied(ctx, row)))
      throw new ConvexError("They have replied since, so a nudge is no longer needed.");
    const now = Date.now();
    await ctx.db.patch("followUps", followUp._id, {
      status: "approved",
      approvedText: followUp.text,
      approvedAt: now,
      approvedBy: owner,
      sendError: "",
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.followUps.deliver, { followUpId: followUp._id });
    return null;
  },
});

export const discard = mutation({
  args: { followUpId: v.id("followUps") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { followUp } = await ownedFollowUp(ctx, args.followUpId);
    if (!["draft", "approved", "failed"].includes(followUp.status))
      throw new ConvexError("This follow-up can no longer be discarded.");
    await ctx.db.patch("followUps", followUp._id, {
      status: "discarded",
      approvedText: undefined,
      approvedAt: undefined,
      approvedBy: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

// The gate every send passes through, in one transaction: still approved, the
// approval still matches the text, a nudge still unanswered, and a route that the
// demo rule allows. Claiming moves the row to "sending", so a second delivery of
// the same approval finds nothing to send.
export const claim = internalMutation({
  args: { followUpId: v.id("followUps") },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      owner: v.string(),
      text: v.string(),
      inboxId: v.string(),
      replyTo: v.string(),
      to: v.string(),
      demo: v.boolean(),
      idempotencyKey: v.string(),
    }),
    v.object({ ok: v.literal(false), reason: v.string() }),
  ),
  handler: async (ctx, args) => {
    const followUp = await ctx.db.get("followUps", args.followUpId);
    if (!followUp) return { ok: false as const, reason: "gone" };
    if (followUp.status !== "approved" || followUp.approvedText !== followUp.text || !followUp.approvedAt)
      return { ok: false as const, reason: "not approved" };
    const row = await ctx.db.get("briefOperators", followUp.briefOperatorId);
    const now = Date.now();
    if (!row) {
      await ctx.db.patch("followUps", followUp._id, { status: "failed", sendError: "The request is gone.", updatedAt: now });
      return { ok: false as const, reason: "gone" };
    }
    if (followUp.kind === "nudge" && (await hasReplied(ctx, row))) {
      await ctx.db.patch("followUps", followUp._id, { status: "cancelled", updatedAt: now });
      return { ok: false as const, reason: "replied" };
    }
    const mailbox = row.mailboxId ? await ctx.db.get("mailboxes", row.mailboxId) : null;
    const route = followUpRoute(demoMode(), row, mailbox?.inboxId);
    if (!route.ok) {
      await ctx.db.patch("followUps", followUp._id, { status: "failed", sendError: route.reason, updatedAt: now });
      return { ok: false as const, reason: route.reason };
    }
    await ctx.db.patch("followUps", followUp._id, { status: "sending", updatedAt: now });
    return {
      ok: true as const,
      owner: followUp.owner,
      text: followUp.text,
      inboxId: route.inboxId,
      replyTo: route.replyTo,
      to: route.to,
      demo: route.demo,
      idempotencyKey: `follow-up-${followUp._id}-${followUp.approvedAt}`,
    };
  },
});

type Claim =
  | { ok: true; owner: string; text: string; inboxId: string; replyTo: string; to: string; demo: boolean; idempotencyKey: string }
  | { ok: false; reason: string };

const replyUrl = (inboxId: string, messageId: string) =>
  `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}/reply`;

// A reply to the request's own message, so it lands in the same thread and the
// operator's answer is matched by that thread like any other reply. The recipient
// is always named explicitly rather than left to the provider to infer.
export const deliver = internalAction({
  args: { followUpId: v.id("followUps") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const claimed: Claim = await ctx.runMutation(internal.followUps.claim, args);
    if (!claimed.ok) return null;
    const fail = async (error: string) => {
      await ctx.runMutation(internal.followUps.markFailed, { followUpId: args.followUpId, error });
      return null;
    };
    if (!claimed.demo) {
      // The same check the first request passed: a real person's inbox is reached
      // only by an account allowed to reach it.
      const permission: { allowed: boolean; reason: string } = await ctx.runQuery(
        internal.accounts.permissionFor,
        { owner: claimed.owner },
      );
      if (!permission.allowed) return await fail(permission.reason);
    }
    const key = env.AGENTMAIL_API_KEY?.trim();
    if (!key) return await fail("Email sending has not been configured.");
    try {
      await ctx.runMutation(internal.integrationLimits.consumeForOwner, { owner: claimed.owner, kind: "send" });
    } catch {
      return await fail("Sending limit reached. Please try again later.");
    }
    const response = await fetch(replyUrl(claimed.inboxId, claimed.replyTo), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": claimed.idempotencyKey,
      },
      body: JSON.stringify({
        to: [claimed.to],
        text: claimed.text,
        labels: claimed.demo ? ["follow-up", "demo"] : ["follow-up"],
      }),
      signal: AbortSignal.timeout(30_000),
    }).catch(() => null);
    if (!response) return await fail("The email service could not be reached. Nothing was sent.");
    if (!response.ok) return await fail(`The email service refused the message (status ${response.status}).`);
    const body: unknown = await response.json().catch(() => null);
    const read = (field: string) =>
      body && typeof body === "object" && field in body && typeof (body as Record<string, unknown>)[field] === "string"
        ? ((body as Record<string, unknown>)[field] as string)
        : "";
    await ctx.runMutation(internal.followUps.markSent, {
      followUpId: args.followUpId,
      deliveredTo: claimed.to,
      providerMessageId: read("message_id"),
      providerThreadId: read("thread_id"),
    });
    return null;
  },
});

export const markSent = internalMutation({
  args: {
    followUpId: v.id("followUps"),
    deliveredTo: v.string(),
    providerMessageId: v.string(),
    providerThreadId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch("followUps", args.followUpId, {
      status: "sent",
      deliveredTo: args.deliveredTo,
      providerMessageId: args.providerMessageId,
      ...(args.providerThreadId ? { providerThreadId: args.providerThreadId } : {}),
      sentAt: now,
      sendError: "",
      updatedAt: now,
    });
    return null;
  },
});

// A failed send keeps its approval off: trying again is a fresh approval of the
// text as it then stands.
export const markFailed = internalMutation({
  args: { followUpId: v.id("followUps"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const followUp = await ctx.db.get("followUps", args.followUpId);
    if (!followUp) return null;
    await ctx.db.patch("followUps", followUp._id, {
      status: "failed",
      approvedText: undefined,
      approvedAt: undefined,
      sendError: args.error.slice(0, 300),
      updatedAt: Date.now(),
    });
    return null;
  },
});
