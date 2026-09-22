import {
  env,
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v, type Infer } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";

// Operators often answer with the itinerary or quote they already have, as a
// PDF, rather than typing it into the email. Those files are kept here so the
// advisor can open them and the drafting step can read them.
//
// The limits, and why:
// - Only PDFs. That is what an itinerary or a quote arrives as, and it is the
//   one document type the drafting model reads directly. Anything else is named
//   with a reason and left in the mailbox.
// - 10 MB a file. A drafting action holds the bytes, their base64 and the
//   request body at once, inside an action's memory; 10 MB keeps that well
//   clear of the limit, and a real itinerary is rarely a tenth of it.
// - Three PDFs a reply, and ten attachments looked at in all. A reply with more
//   than that is a brochure dump, not an answer, and every file kept is storage
//   anyone who can email the inbox would otherwise be able to fill.
// - 10 MB read per draft, across its PDFs, for the same memory reason.
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_PDFS_PER_REPLY = 3;
export const MAX_ATTACHMENTS_LISTED = 10;
export const MAX_DRAFT_BYTES = 10 * 1024 * 1024;

export const attachmentMeta = v.object({
  attachmentId: v.string(),
  filename: v.string(),
  contentType: v.string(),
  size: v.number(),
});
export type AttachmentMeta = Infer<typeof attachmentMeta>;

const clean = (value: unknown, limit: number) =>
  typeof value === "string" ? value.slice(0, limit) : "";

// The webhook's attachment list, read defensively: AgentMail documents
// `attachment_id`, `filename`, `content_type` and `size`, and a camel-cased
// shape is accepted too, so a client library's spelling does not lose a file.
export function readAttachments(message: Record<string, unknown>): AttachmentMeta[] {
  const list = message.attachments;
  if (!Array.isArray(list)) return [];
  const found: AttachmentMeta[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const attachmentId = clean(entry.attachment_id ?? entry.attachmentId ?? entry.id, 300);
    if (!attachmentId) continue;
    const size = Number(entry.size);
    found.push({
      attachmentId,
      filename: clean(entry.filename ?? entry.name, 200) || "attachment",
      contentType: clean(entry.content_type ?? entry.contentType, 120).toLowerCase(),
      size: Number.isFinite(size) && size >= 0 ? size : 0,
    });
    if (found.length >= MAX_ATTACHMENTS_LISTED) break;
  }
  return found;
}

// A sender's content type is a claim, and a mail client often says
// "application/octet-stream" for everything, so the name is allowed to decide
// when the type says nothing. The bytes are checked again once downloaded.
export function looksLikePdf(meta: Pick<AttachmentMeta, "filename" | "contentType">) {
  if (meta.contentType.startsWith("application/pdf")) return true;
  const vague = !meta.contentType || meta.contentType === "application/octet-stream";
  return vague && /\.pdf$/i.test(meta.filename.trim());
}

export function plan(metas: AttachmentMeta[], placed: boolean) {
  let pdfs = 0;
  return metas.slice(0, MAX_ATTACHMENTS_LISTED).map((meta) => {
    if (!looksLikePdf(meta))
      return { meta, status: "skipped" as const, reason: "Not a PDF, so it was left in the mailbox." };
    if (!placed)
      return {
        meta,
        status: "skipped" as const,
        reason: "The reply is not on a brief yet, so its attachments were not fetched.",
      };
    if (meta.size > MAX_ATTACHMENT_BYTES)
      return { meta, status: "skipped" as const, reason: "Larger than 10 MB, so it was not fetched." };
    pdfs += 1;
    if (pdfs > MAX_PDFS_PER_REPLY)
      return {
        meta,
        status: "skipped" as const,
        reason: `Only the first ${MAX_PDFS_PER_REPLY} PDFs on a reply are kept.`,
      };
    return { meta, status: "pending" as const };
  });
}

// Called from the reply's own mutation, so the rows exist the moment the reply
// does and nothing about them can be lost between two transactions.
export async function noteAttachments(
  ctx: MutationCtx,
  message: Pick<Doc<"inboxMessages">, "_id" | "briefId" | "owner">,
  metas: AttachmentMeta[],
) {
  // Mail that could not be placed is from an address nobody wrote to. Fetching
  // its files would let a stranger fill the workspace's storage.
  const now = Date.now();
  let pending = 0;
  for (const item of plan(metas, message.briefId !== null)) {
    await ctx.db.insert("inboxAttachments", {
      inboxMessageId: message._id,
      briefId: message.briefId,
      owner: message.owner,
      providerAttachmentId: item.meta.attachmentId,
      filename: item.meta.filename,
      contentType: item.meta.contentType,
      size: item.meta.size,
      status: item.status,
      ...(item.status === "skipped" ? { reason: item.reason, settledAt: now } : {}),
      createdAt: now,
    });
    if (item.status === "pending") pending += 1;
  }
  if (pending)
    await ctx.scheduler.runAfter(0, internal.replyAttachments.collect, {
      inboxMessageId: message._id,
    });
}

export const pending = internalQuery({
  args: { inboxMessageId: v.id("inboxMessages") },
  returns: v.union(
    v.null(),
    v.object({
      inboxId: v.string(),
      messageId: v.string(),
      rows: v.array(
        v.object({
          _id: v.id("inboxAttachments"),
          providerAttachmentId: v.string(),
          filename: v.string(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const message = await ctx.db.get("inboxMessages", args.inboxMessageId);
    if (!message) return null;
    const rows = await ctx.db
      .query("inboxAttachments")
      .withIndex("by_inboxMessageId", (q) => q.eq("inboxMessageId", message._id))
      .take(MAX_ATTACHMENTS_LISTED);
    return {
      inboxId: message.inboxId,
      messageId: message.messageId,
      rows: rows
        .filter((row) => row.status === "pending")
        .map((row) => ({
          _id: row._id,
          providerAttachmentId: row.providerAttachmentId,
          filename: row.filename,
        })),
    };
  },
});

export const settle = internalMutation({
  args: {
    attachmentId: v.id("inboxAttachments"),
    status: v.union(v.literal("stored"), v.literal("skipped"), v.literal("failed")),
    reason: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    size: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("inboxAttachments", args.attachmentId);
    // The reply was deleted with its brief while the file was downloading: the
    // file has nothing to belong to, so it does not stay in storage.
    if (!row || row.status !== "pending") {
      if (args.storageId) await ctx.storage.delete(args.storageId);
      return null;
    }
    await ctx.db.patch("inboxAttachments", row._id, {
      status: args.status,
      ...(args.reason ? { reason: args.reason.slice(0, 300) } : {}),
      ...(args.storageId ? { storageId: args.storageId } : {}),
      ...(args.size !== undefined ? { size: args.size } : {}),
      settledAt: Date.now(),
    });
    return null;
  },
});

type Download =
  | { ok: true; bytes: Uint8Array<ArrayBuffer> }
  | { ok: false; status: "skipped" | "failed"; reason: string };

// AgentMail's reference says this endpoint answers with JSON carrying a signed
// `download_url`; its attachments guide says it answers with the file itself.
// Both are handled, told apart by the response's content type.
export async function downloadAttachment(
  key: string,
  inboxId: string,
  messageId: string,
  attachmentId: string,
): Promise<Download> {
  const endpoint = `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;
  let response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!response) return { ok: false, status: "failed", reason: "The mail provider could not be reached." };
  if (!response.ok)
    return { ok: false, status: "failed", reason: `The mail provider refused the download (status ${response.status}).` };
  if ((response.headers.get("content-type") ?? "").includes("application/json")) {
    const body: unknown = await response.json().catch(() => null);
    const link =
      body && typeof body === "object" && "download_url" in body && typeof body.download_url === "string"
        ? body.download_url
        : "";
    if (!link.startsWith("https://"))
      return { ok: false, status: "failed", reason: "The mail provider gave no link to the file." };
    // A signed link carries its own authority; the API key is not sent to it.
    response = await fetch(link, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (!response?.ok)
      return { ok: false, status: "failed", reason: "The file could not be downloaded from the mail provider." };
  }
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_ATTACHMENT_BYTES)
    return { ok: false, status: "skipped", reason: "Larger than 10 MB, so it was not kept." };
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_ATTACHMENT_BYTES)
    return { ok: false, status: "skipped", reason: "Larger than 10 MB, so it was not kept." };
  // Every PDF starts "%PDF-". A file named .pdf that does not is not one, and
  // the model would be handed something it cannot read.
  const magic = String.fromCharCode(...bytes.subarray(0, 5));
  if (magic !== "%PDF-")
    return { ok: false, status: "skipped", reason: "Named as a PDF, but the file is not one." };
  return { ok: true, bytes };
}

export const collect = internalAction({
  args: { inboxMessageId: v.id("inboxMessages") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const work = await ctx.runQuery(internal.replyAttachments.pending, args);
    if (!work || !work.rows.length) return null;
    const key = env.AGENTMAIL_API_KEY?.trim();
    for (const row of work.rows) {
      if (!key) {
        await ctx.runMutation(internal.replyAttachments.settle, {
          attachmentId: row._id,
          status: "failed",
          reason: "The mail provider has not been configured.",
        });
        continue;
      }
      const result = await downloadAttachment(key, work.inboxId, work.messageId, row.providerAttachmentId);
      if (!result.ok) {
        await ctx.runMutation(internal.replyAttachments.settle, {
          attachmentId: row._id,
          status: result.status,
          reason: result.reason,
        });
        continue;
      }
      const storageId = await ctx.storage.store(new Blob([result.bytes], { type: "application/pdf" }));
      await ctx.runMutation(internal.replyAttachments.settle, {
        attachmentId: row._id,
        status: "stored",
        storageId,
        size: result.bytes.length,
      });
    }
    return null;
  },
});

// What the advisor sees beside each reply. A link is only ever made for the
// brief's owner, and only for a file that was really kept.
export const list = query({
  args: { briefId: v.id("briefs") },
  returns: v.array(
    v.object({
      _id: v.id("inboxAttachments"),
      inboxMessageId: v.id("inboxMessages"),
      filename: v.string(),
      size: v.number(),
      status: v.union(
        v.literal("pending"),
        v.literal("stored"),
        v.literal("skipped"),
        v.literal("failed"),
      ),
      reason: v.optional(v.string()),
      url: v.union(v.null(), v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const owner = await getAuthUserId(ctx);
    if (!owner) throw new ConvexError("Please sign in.");
    const brief = await ctx.db.get("briefs", args.briefId);
    if (!brief || brief.owner !== owner) throw new ConvexError("Brief not found.");
    const rows = await ctx.db
      .query("inboxAttachments")
      .withIndex("by_briefId", (q) => q.eq("briefId", brief._id))
      .take(200);
    return await Promise.all(
      rows
        // Belt and braces: a row is only ever served to the workspace it came in to.
        .filter((row) => row.owner === owner)
        .map(async (row) => ({
          _id: row._id,
          inboxMessageId: row.inboxMessageId,
          filename: row.filename,
          size: row.size,
          status: row.status,
          ...(row.reason ? { reason: row.reason } : {}),
          url:
            row.status === "stored" && row.storageId
              ? await ctx.storage.getUrl(row.storageId)
              : null,
        })),
    );
  },
});

// The PDFs a draft may read: those kept for one reply on a brief the caller owns.
export const forDraft = internalQuery({
  args: { briefId: v.id("briefs"), inboxMessageId: v.id("inboxMessages") },
  returns: v.array(
    v.object({ filename: v.string(), storageId: v.id("_storage"), size: v.number() }),
  ),
  handler: async (ctx, args) => {
    const owner = await getAuthUserId(ctx);
    if (!owner) return [];
    const message = await ctx.db.get("inboxMessages", args.inboxMessageId);
    if (!message || message.owner !== owner || message.briefId !== args.briefId) return [];
    const rows = await ctx.db
      .query("inboxAttachments")
      .withIndex("by_inboxMessageId", (q) => q.eq("inboxMessageId", message._id))
      .take(MAX_ATTACHMENTS_LISTED);
    return rows.flatMap((row) =>
      row.status === "stored" && row.storageId
        ? [{ filename: row.filename, storageId: row.storageId, size: row.size }]
        : [],
    );
  },
});

// A PDF as the data URL the Responses API reads. Encoded in slices a multiple of
// three bytes long, so each slice stands alone and no argument list is huge.
export function pdfDataUrl(bytes: Uint8Array) {
  const step = 3 * 4_096;
  let base64 = "";
  for (let index = 0; index < bytes.length; index += step)
    base64 += btoa(String.fromCharCode(...bytes.subarray(index, index + step)));
  return `data:application/pdf;base64,${base64}`;
}

export async function readDocuments(
  ctx: ActionCtx,
  documents: { filename: string; storageId: Id<"_storage">; size: number }[],
) {
  const files: { filename: string; dataUrl: string }[] = [];
  const read: string[] = [];
  const leftOut: string[] = [];
  let total = 0;
  for (const document of documents.slice(0, MAX_PDFS_PER_REPLY)) {
    const blob = await ctx.storage.get(document.storageId);
    if (!blob || total + blob.size > MAX_DRAFT_BYTES) {
      leftOut.push(document.filename);
      continue;
    }
    total += blob.size;
    files.push({
      filename: document.filename.slice(0, 120),
      dataUrl: pdfDataUrl(new Uint8Array(await blob.arrayBuffer())),
    });
    read.push(document.filename);
  }
  return { files, read, leftOut };
}
