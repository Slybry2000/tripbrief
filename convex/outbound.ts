import { action, env, internalMutation, internalQuery } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc } from "./_generated/dataModel";

// The brief's inbox is the only thing that sends, and it sends one operator its
// own link. Nothing here can reach a second address, and no message ever
// contains a traveller's detail.
const sendUrl = (inboxId: string) =>
  `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inboxId)}/messages/send`;

export function requestMessage(
  brief: Pick<
    Doc<"briefs">,
    | "name"
    | "travelerCount"
    | "minimumViableTravelers"
    | "nights"
    | "earliestDepartureDate"
    | "latestDepartureDate"
  >,
  operatorName: string,
  link: string,
) {
  const scope = `${brief.earliestDepartureDate} to ${brief.latestDepartureDate}, ${brief.nights} nights, ${brief.travelerCount} travellers`;
  const subject = `Trip request: ${brief.name}`;
  const text = [
    `Hello ${operatorName},`,
    "",
    `TripBrief would like you to quote for ${brief.name} (${scope}).`,
    "",
    "Open your private link to read the client brief, confirm the dates you can actually operate, and return a structured proposal:",
    link,
    "",
    "The link is unique to you and needs no account. Existing programs are welcome as a starting point; your reply must confirm what you would really provide.",
    "",
    "This message contains no personal details about any traveller.",
  ].join("\n");
  const html = [
    `<p>Hello ${escapeHtml(operatorName)},</p>`,
    `<p>TripBrief would like you to quote for <strong>${escapeHtml(brief.name)}</strong> (${escapeHtml(scope)}).</p>`,
    `<p><a href="${escapeHtml(link)}">Open your private link</a> to read the client brief, confirm the dates you can actually operate, and return a structured proposal.</p>`,
    "<p>The link is unique to you and needs no account. Existing programs are welcome as a starting point; your reply must confirm what you would really provide.</p>",
    "<p>This message contains no personal details about any traveller.</p>",
  ].join("\n");
  return { subject, text, html };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function providerMessageId(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  for (const key of ["message_id", "messageId", "id"] as const)
    if (key in body) {
      const value = (body as Record<string, unknown>)[key];
      if (typeof value === "string") return value;
    }
  return "";
}

export const forSend = internalQuery({
  args: { briefOperatorId: v.id("briefOperators") },
  returns: v.union(
    v.null(),
    v.object({
      row: v.object({
        _id: v.id("briefOperators"),
        briefId: v.id("briefs"),
        owner: v.string(),
        operatorSlug: v.string(),
        operatorName: v.string(),
        capabilityToken: v.string(),
        status: v.string(),
        email: v.optional(v.string()),
        sentAt: v.optional(v.number()),
      }),
      brief: v.object({
        name: v.string(),
        travelerCount: v.number(),
        minimumViableTravelers: v.number(),
        nights: v.number(),
        earliestDepartureDate: v.string(),
        latestDepartureDate: v.string(),
        status: v.string(),
      }),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("briefOperators", args.briefOperatorId);
    if (!row) return null;
    const brief = await ctx.db.get("briefs", row.briefId);
    if (!brief) return null;
    return {
      row: {
        _id: row._id,
        briefId: row.briefId,
        owner: row.owner,
        operatorSlug: row.operatorSlug,
        operatorName: row.operatorName,
        capabilityToken: row.capabilityToken,
        status: row.status,
        email: row.email,
        sentAt: row.sentAt,
      },
      brief: {
        name: brief.name,
        travelerCount: brief.travelerCount,
        minimumViableTravelers: brief.minimumViableTravelers,
        nights: brief.nights,
        earliestDepartureDate: brief.earliestDepartureDate,
        latestDepartureDate: brief.latestDepartureDate,
        status: brief.status,
      },
    };
  },
});

// Sending is always a deliberate click on one named operator. The email address
// is captured here, validated, and locked once the request has gone out.
export const sendRequest = action({
  args: { briefOperatorId: v.id("briefOperators"), email: v.string() },
  returns: v.object({ to: v.string() }),
  handler: async (ctx, args): Promise<{ to: string }> => {
    const owner = await getAuthUserId(ctx);
    if (!owner) throw new ConvexError("Please sign in.");
    const found = await ctx.runQuery(internal.outbound.forSend, {
      briefOperatorId: args.briefOperatorId,
    });
    if (!found || found.row.owner !== owner)
      throw new ConvexError("That operator is not on one of your briefs.");
    const { row, brief } = found;
    const to = args.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || to.length > 320)
      throw new ConvexError("Enter a valid email address for this operator.");
    if (row.email && row.email !== to)
      throw new ConvexError(
        "This request has already been sent. The address is locked.",
      );
    if (row.sentAt)
      throw new ConvexError("This request has already been sent.");
    const key = env.AGENTMAIL_API_KEY?.trim();
    if (!key) throw new ConvexError("Email sending has not been configured.");
    await ctx.runMutation(internal.integrationLimits.consumeSend, {
      briefId: row.briefId,
    });
    const inbox: { email: string; inboxId: string } = await ctx.runAction(
      api.inboxes.provision,
      { briefId: row.briefId },
    );
    // The link has to resolve for the operator, not for the backend: a local
    // backend serves no frontend, so the site URL is what the app is served from.
    const link = `${env.SITE_URL?.trim() || env.CONVEX_SITE_URL}/#respond=${encodeURIComponent(row.capabilityToken)}`;
    const { subject, text, html } = requestMessage(
      brief,
      row.operatorName,
      link,
    );
    let response: Response;
    try {
      response = await fetch(sendUrl(inbox.inboxId), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          // A retry of the same request must never send a second copy.
          "Idempotency-Key": `operator-request-${row._id}`,
        },
        body: JSON.stringify({
          to: [to],
          subject,
          text,
          html,
          labels: ["operator-request"],
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      await ctx.runMutation(internal.outbound.markFailed, {
        briefOperatorId: row._id,
        error: "The email service could not be reached.",
      });
      throw new ConvexError(
        "The email service could not be reached. Nothing was sent.",
      );
    }
    if (!response.ok) {
      await ctx.runMutation(internal.outbound.markFailed, {
        briefOperatorId: row._id,
        error: `The email service refused the message (status ${response.status}).`,
      });
      throw new ConvexError(
        "The request was not sent. You can try again from this row.",
      );
    }
    const body: unknown = await response.json().catch(() => null);
    await ctx.runMutation(internal.outbound.markSent, {
      briefOperatorId: row._id,
      email: to,
      providerMessageId: providerMessageId(body),
    });
    return { to };
  },
});

export const markSent = internalMutation({
  args: {
    briefOperatorId: v.id("briefOperators"),
    email: v.string(),
    providerMessageId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("briefOperators", args.briefOperatorId);
    if (!row) throw new ConvexError("Operator not found.");
    const now = Date.now();
    await ctx.db.patch("briefOperators", row._id, {
      email: args.email,
      sentAt: now,
      providerMessageId: args.providerMessageId,
      sendError: "",
      status: row.status === "submitted" ? "submitted" : "sent",
      updatedAt: now,
    });
    const brief = await ctx.db.get("briefs", row.briefId);
    if (brief && brief.status === "draft")
      await ctx.db.patch("briefs", brief._id, { status: "sent", updatedAt: now });
    return null;
  },
});

export const markFailed = internalMutation({
  args: { briefOperatorId: v.id("briefOperators"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("briefOperators", args.briefOperatorId);
    if (!row) return null;
    await ctx.db.patch("briefOperators", row._id, {
      sendError: args.error.slice(0, 300),
      updatedAt: Date.now(),
    });
    return null;
  },
});
