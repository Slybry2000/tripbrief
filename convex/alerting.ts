import {
  env,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { ensureMailbox } from "./outbound";

// Telling the advisor that something arrived.
//
// The app is live: a proposal submitted in an operator's browser appears in the
// advisor's comparison with no refresh. That is only true while the advisor is
// looking at it. A quote that lands on Thursday evening for a brief sent on Monday
// has to announce itself, or the deadline moves without anyone noticing.
//
// So an arrival is announced once, by email, from the workspace's own mailbox to
// its own address, and several arrivals inside one sweep are announced together —
// when a brief goes to five operators, that is one message and not five.
//
// What this deliberately is not: a notification per event, a mobile push, or
// anything that depends on the app being open. Email is the channel the workspace
// already has, and the sponsor that already carries everything else.

const longLists = v.array(
  v.object({
    id: v.string(),
    kind: v.union(v.literal("proposal"), v.literal("reply")),
    briefTitle: v.string(),
    operatorName: v.string(),
    detail: v.string(),
  }),
);

// Everything that arrived and has not been announced.
export const pending = internalQuery({
  args: { owner: v.string() },
  returns: v.object({
    email: v.string(),
    items: longLists,
  }),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .get("users", args.owner as never)
      .catch(() => null);
    const items: {
      id: string;
      kind: "proposal" | "reply";
      briefTitle: string;
      operatorName: string;
      detail: string;
    }[] = [];

    const briefs = await ctx.db
      .query("briefs")
      .withIndex("by_owner", (q) => q.eq("owner", args.owner))
      .take(50);
    const titles = new Map(briefs.map((brief) => [brief._id, brief.name]));

    for (const brief of briefs) {
      const proposals = await ctx.db
        .query("proposals")
        .withIndex("by_briefId", (q) => q.eq("briefId", brief._id))
        .take(20);
      for (const proposal of proposals) {
        if (proposal.announcedAt) continue;
        // The name the operator was shortlisted under, not its internal slug: the
        // announcement is read by a person.
        const shortlisted = await ctx.db
          .query("briefOperators")
          .withIndex("by_briefId", (q) => q.eq("briefId", brief._id))
          .take(20);
        const price = new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: proposal.currency || "USD",
          maximumFractionDigits: 0,
        }).format(proposal.netPricePerPerson);
        items.push({
          id: proposal._id,
          kind: "proposal",
          briefTitle: brief.name,
          operatorName:
            shortlisted.find((row) => row.operatorSlug === proposal.operatorSlug)
              ?.operatorName ?? proposal.operatorSlug,
          detail: `${proposal.programName} — ${price} net per person, ${proposal.finalFit}% ${proposal.requirementAnswers?.length ? "of the requirements covered" : "fit"}`,
        });
      }
    }

    const messages = await ctx.db
      .query("inboxMessages")
      .withIndex("by_owner", (q) => q.eq("owner", args.owner))
      .take(50);
    for (const message of messages) {
      if (message.announcedAt || message.briefId === null) continue;
      items.push({
        id: message._id,
        kind: "reply",
        briefTitle: titles.get(message.briefId) ?? "a brief",
        operatorName: message.fromEmail,
        detail: message.subject || "(no subject)",
      });
    }

    return { email: (user?.email ?? "").trim().toLowerCase(), items };
  },
});

// Which workspaces have something waiting, for the safety-net sweep.
export const ownersWithPending = internalQuery({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const owners = new Set<string>();
    for (const proposal of await ctx.db.query("proposals").take(200))
      if (!proposal.announcedAt) owners.add(proposal.owner);
    for (const message of await ctx.db.query("inboxMessages").take(200))
      if (!message.announcedAt && message.briefId !== null) owners.add(message.owner);
    return [...owners];
  },
});

export const markAnnounced = internalMutation({
  args: { ids: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const id of args.ids) {
      const proposal = await ctx.db.get("proposals", id as never).catch(() => null);
      if (proposal && !proposal.announcedAt) {
        await ctx.db.patch("proposals", proposal._id, { announcedAt: now });
        continue;
      }
      const message = await ctx.db.get("inboxMessages", id as never).catch(() => null);
      if (message && !message.announcedAt)
        await ctx.db.patch("inboxMessages", message._id, { announcedAt: now });
    }
    return null;
  },
});

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// One version of the announcement, used by both the immediate trigger and the
// safety-net sweep, so they cannot drift apart.
async function announce(
  ctx: Parameters<typeof ensureMailbox>[0],
  owner: string,
) {
  const permission: { allowed: boolean } = await ctx.runQuery(
    internal.accounts.permissionFor,
    { owner },
  );
  // A trial workspace has no address to tell, and nothing to send from.
  if (!permission.allowed) return null;

  const found: {
    email: string;
    items: { id: string; kind: "proposal" | "reply"; briefTitle: string; operatorName: string; detail: string }[];
  } = await ctx.runQuery(internal.alerting.pending, { owner });
  if (!found.email || !found.items.length) return null;

  const key = env.AGENTMAIL_API_KEY?.trim();
  if (!key) return null;
  const mailbox = await ensureMailbox(ctx, owner, "TripBrief arrivals");

  const count = found.items.length;
  const subject =
    count === 1
      ? `${found.items[0].kind === "proposal" ? "A quote" : "A reply"} arrived — ${found.items[0].briefTitle}`
      : `${count} answers arrived for your briefs`;
  const lines = found.items.map(
    (item) =>
      `- ${item.operatorName} · ${item.briefTitle}: ${item.detail}`,
  );
  const text = [
    count === 1 ? "Something arrived:" : `${count} answers arrived:`,
    "",
    ...lines,
    "",
    "Open TripBrief to compare them. The brief's page shows every response beside the requirements it answers.",
  ].join("\n");
  const html = `<p>${count === 1 ? "Something arrived:" : `${count} answers arrived:`}</p><ul>${found.items
    .map(
      (item) =>
        `<li><strong>${escapeHtml(item.operatorName)}</strong> · ${escapeHtml(item.briefTitle)}: ${escapeHtml(item.detail)}</li>`,
    )
    .join("")}</ul><p>Open TripBrief to compare them.</p>`;

  const response = await fetch(
    `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(mailbox.inboxId)}/messages/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `tripbrief-arrivals-${owner}-${found.items.map((item) => item.id).join("-")}`.slice(0, 200),
      },
      body: JSON.stringify({ to: [found.email], subject, text, html, labels: ["arrivals"] }),
      signal: AbortSignal.timeout(30_000),
    },
  ).catch(() => null);
  if (!response?.ok) return null;

  // Announced only once it actually went out: a failure leaves the items pending,
  // and the sweep will try again.
  await ctx.runMutation(internal.alerting.markAnnounced, {
    ids: found.items.map((item) => item.id),
  });
  return { sent: count, to: found.email };
}

// Called the moment something arrives.
export const sweep = internalAction({
  args: { owner: v.string() },
  returns: v.union(v.null(), v.object({ sent: v.number(), to: v.string() })),
  handler: async (ctx, args) => await announce(ctx, args.owner),
});

// The safety net: anything that arrived while a send was failing, or while the
// deployment was redeploying, is announced on the next pass.
export const sweepAll = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const owners: string[] = await ctx.runQuery(
      internal.alerting.ownersWithPending,
      {},
    );
    let announced = 0;
    for (const owner of owners) {
      const result = await announce(ctx, owner);
      if (result) announced += result.sent;
    }
    return announced;
  },
});
