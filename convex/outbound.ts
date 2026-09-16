import { action, env } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc } from "./_generated/dataModel";

// The trip inbox is the only thing that sends, and it sends one supplier link
// to one supplier. Nothing here can send to a second address.
const sendUrl = (inboxId: string) =>
  `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inboxId)}/messages/send`;

export function invitationMessage(
  trip: Pick<
    Doc<"trips">,
    "title" | "destination" | "startDate" | "endDate" | "travelers"
  >,
  supplierName: string,
  link: string,
) {
  const scope = `${trip.destination}, ${trip.startDate} to ${trip.endDate}, ${trip.travelers} travellers`;
  const subject = `Response requested: ${trip.title}`;
  const text = [
    `Hello ${supplierName},`,
    "",
    `You are invited to quote for ${trip.title} (${scope}).`,
    "",
    "Open your private response link to see the requirements and send your quote:",
    link,
    "",
    "The link is unique to you and needs no account. If it is easier, reply to this email with your quote in your own format — it will be attached to the same brief.",
    "",
    "This message contains no personal details about any traveller.",
  ].join("\n");
  const html = [
    `<p>Hello ${escapeHtml(supplierName)},</p>`,
    `<p>You are invited to quote for <strong>${escapeHtml(trip.title)}</strong> (${escapeHtml(scope)}).</p>`,
    `<p><a href="${escapeHtml(link)}">Open your private response link</a> to see the requirements and send your quote.</p>`,
    "<p>The link is unique to you and needs no account. If it is easier, reply to this email with your quote in your own format — it will be attached to the same brief.</p>",
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

export const sendInvitation = action({
  args: { inviteId: v.id("supplierInvites") },
  returns: v.object({ to: v.string() }),
  handler: async (ctx, args): Promise<{ to: string }> => {
    const owner = await getAuthUserId(ctx);
    if (!owner) throw new ConvexError("Please sign in.");
    const { invite, trip } = await ctx.runQuery(internal.invites.forSend, {
      inviteId: args.inviteId,
    });
    if (invite.owner !== owner || trip.owner !== owner)
      throw new ConvexError("Supplier not found.");
    if (trip.status === "selected")
      throw new ConvexError("This trip's decision is already recorded.");
    const to = invite.email?.trim();
    if (!to)
      throw new ConvexError("Add the supplier's email address first.");
    if (invite.sentAt)
      throw new ConvexError("This invitation has already been sent.");
    const key = env.AGENTMAIL_API_KEY?.trim();
    if (!key) throw new ConvexError("Email sending has not been configured.");
    const inbox: { email: string; inboxId: string } = await ctx.runAction(
      api.inboxes.provision,
      { tripId: invite.tripId },
    );
    const link = `${env.CONVEX_SITE_URL}/#respond=${encodeURIComponent(invite.token)}`;
    const { subject, text, html } = invitationMessage(
      trip,
      invite.supplierName,
      link,
    );
    let response: Response;
    try {
      response = await fetch(sendUrl(inbox.inboxId), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          // A retry of the same invitation must never send a second copy.
          "Idempotency-Key": `tripbrief-invitation-${invite._id}`,
        },
        body: JSON.stringify({
          to: [to],
          subject,
          text,
          html,
          labels: ["tripbrief-invitation"],
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      await ctx.runMutation(internal.invites.markFailed, {
        inviteId: invite._id,
        error: "The email service could not be reached.",
      });
      throw new ConvexError(
        "The email service could not be reached. The invitation was not sent.",
      );
    }
    if (!response.ok) {
      await ctx.runMutation(internal.invites.markFailed, {
        inviteId: invite._id,
        error: `The email service refused the message (status ${response.status}).`,
      });
      throw new ConvexError(
        "The invitation was not sent. You can try again from this card.",
      );
    }
    const body: unknown = await response.json().catch(() => null);
    await ctx.runMutation(internal.invites.markSent, {
      inviteId: invite._id,
      providerMessageId: providerMessageId(body),
    });
    return { to };
  },
});
