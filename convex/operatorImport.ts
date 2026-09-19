import {
  action,
  env,
  internalQuery,
  mutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { structuredResponse } from "./openai";
import { draftSchema, validateDraft } from "./proposals";

// An incoming operator should not have to retype the trip it already sells.
//
// It can hand over a page on its own site, or a trip document it already sends to
// agencies, and the structured proposal comes back filled in. Two sponsors do the
// work: Firecrawl turns a published page into clean text, and OpenAI reads either
// that text or the document itself into the fields the comparison needs.
//
// A page can be quote-checked, because we hold the text. A document cannot —
// nothing here extracts a PDF — so those drafts come back marked unverified and
// the interface says so rather than implying a guarantee it cannot make.

const MAX_SOURCE = 60_000;
const MAX_FILE_BYTES = 12 * 1024 * 1024;

export function cleanSourceUrl(value: string) {
  // A half-typed address is a mistake to explain, not a crash: anything that is
  // not a whole https address comes back null and the action says what to do.
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  return url.href;
}

// Actions have no database, so the link is resolved in a query and the action
// works from that.
export const forToken = internalQuery({
  args: { token: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      briefId: v.id("briefs"),
      operatorName: v.string(),
      brief: v.object({
        _id: v.id("briefs"),
        name: v.string(),
        nights: v.number(),
        travelerCount: v.number(),
        minimumViableTravelers: v.number(),
        desiredExperiences: v.array(v.string()),
        importantRequirements: v.array(v.string()),
        transportationNeeds: v.array(v.string()),
        accessibilityNeeds: v.array(v.string()),
        targetRetailPricePerPerson: v.number(),
      }),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("briefOperators")
      .withIndex("by_capabilityToken", (q) =>
        q.eq("capabilityToken", args.token),
      )
      .unique();
    if (!row) return null;
    const brief = await ctx.db.get("briefs", row.briefId);
    if (!brief) return null;
    return {
      briefId: brief._id,
      operatorName: row.operatorName,
      brief: {
        _id: brief._id,
        name: brief.name,
        nights: brief.nights,
        travelerCount: brief.travelerCount,
        minimumViableTravelers: brief.minimumViableTravelers,
        desiredExperiences: brief.desiredExperiences,
        importantRequirements: brief.importantRequirements,
        transportationNeeds: brief.transportationNeeds,
        accessibilityNeeds: brief.accessibilityNeeds,
        targetRetailPricePerPerson: brief.targetRetailPricePerPerson,
      },
    };
  },
});

const developer =
  "You read an incoming tour operator's own trip material and fill in a structured proposal for a travel agency. Use only what the material states. Never invent a price, a date, an inclusion or a deadline: use an empty string, 0 or an empty list when it is not stated. Every item in evidence must be copied character for character out of the material, exactly as written: do not paraphrase, shorten, tidy or join sentences. This is a draft for a human to check, never a recommendation.";

// The brief the operator was sent, as the drafting step needs it. An action has
// no database, so the link is resolved to this shape first.
type DraftBrief = {
  nights: number;
  travelerCount: number;
  minimumViableTravelers: number;
  desiredExperiences: string[];
  importantRequirements: string[];
  transportationNeeds: string[];
  accessibilityNeeds: string[];
  targetRetailPricePerPerson: number;
};

// The return type is written out because these actions call `internal` for their
// own link lookup, and the generated types import this module: without the
// annotation TypeScript reports a circular inference instead of a real error.
type ImportedDraft = ReturnType<typeof validateDraft>;

async function fill(
  brief: DraftBrief,
  material: { text: string } | { filename: string; dataUrl: string },
  destinations: { slug: string; name: string }[],
  openai: string,
): Promise<ImportedDraft> {
  const allowed = destinations.slice(0, 40);
  const request = [
    "THE REQUEST FROM THE AGENCY",
    `Destination options: ${allowed.map((item) => `${item.slug} (${item.name})`).join(", ")}`,
    `Nights requested: ${brief.nights}`,
    `Travellers: ${brief.travelerCount} (minimum viable ${brief.minimumViableTravelers})`,
    `Experiences requested: ${brief.desiredExperiences.join(", ")}`,
    `Operating needs: ${[...brief.transportationNeeds, ...brief.accessibilityNeeds, ...brief.importantRequirements].join(", ")}`,
    `Target net per person: ${Math.round(brief.targetRetailPricePerPerson * 0.75)} USD`,
    "",
    "YOUR TRIP MATERIAL",
  ].join("\n");

  const raw = await structuredResponse({
    apiKey: openai,
    model: "gpt-4.1-mini",
    developer,
    user:
      "text" in material
        ? `${request}\n${material.text}`
        : `${request}\n(Read the attached document.)`,
    schemaName: "operator_proposal_draft",
    schema: draftSchema(brief, allowed.map((item) => item.slug)),
    ...("dataUrl" in material
      ? { file: { filename: material.filename, dataUrl: material.dataUrl } }
      : {}),
  });
  const sourceText = "text" in material ? material.text : "";
  return validateDraft(raw, sourceText, brief, allowed, {
    verifiable: "text" in material,
  });
}

// A page on the operator's own site.
export const draftFromUrl = action({
  args: { token: v.string(), url: v.string(), destinations: v.array(v.object({ slug: v.string(), name: v.string() })) },
  returns: v.any(),
  handler: async (ctx, args): Promise<ImportedDraft> => {
    const url = cleanSourceUrl(args.url);
    if (!url)
      throw new ConvexError(
        "That needs to be a full https address, like https://youragency.com/trip.",
      );
    const link = await ctx.runQuery(internal.operatorImport.forToken, { token: args.token });
    if (!link) throw new ConvexError("This response link is no longer active.");
    const brief = link.brief;
    const openai = env.OPENAI_API_KEY?.trim();
    if (!openai) throw new ConvexError("AI drafting has not been configured.");
    const firecrawl = env.FIRECRAWL_API_KEY?.trim();
    if (!firecrawl) throw new ConvexError("Page reading has not been configured.");

    await ctx.runMutation(internal.integrationLimits.consumeAnalysisForLink, {
      briefId: brief._id,
    });
    const page = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${firecrawl}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
      signal: AbortSignal.timeout(45_000),
    }).catch(() => null);
    if (!page?.ok)
      throw new ConvexError(
        `That page could not be read (status ${page?.status ?? 0}). Check the address, or upload the document instead.`,
      );
    const body: unknown = await page.json().catch(() => null);
    const markdown = readMarkdown(body);
    if (!markdown)
      throw new ConvexError(
        "That page had no readable trip text. Try the page for the trip itself, or upload the document.",
      );
    return await fill(brief, { text: markdown.slice(0, MAX_SOURCE) }, args.destinations, openai);
  },
});

// A trip document the operator already sends to agencies.
export const draftFromDocument = action({
  args: {
    token: v.string(),
    storageId: v.id("_storage"),
    filename: v.string(),
    destinations: v.array(v.object({ slug: v.string(), name: v.string() })),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<ImportedDraft> => {
    const link = await ctx.runQuery(internal.operatorImport.forToken, {
      token: args.token,
    });
    if (!link) throw new ConvexError("This response link is no longer active.");
    const brief = link.brief;
    const openai = env.OPENAI_API_KEY?.trim();
    if (!openai) throw new ConvexError("AI drafting has not been configured.");
    const file = await ctx.storage.get(args.storageId);
    if (!file) throw new ConvexError("That document could not be read.");
    if (file.size > MAX_FILE_BYTES)
      throw new ConvexError("That document is larger than 12 MB.");
    const type = file.type || "application/pdf";
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const dataUrl = `data:${type};base64,${btoa(binary)}`;

    await ctx.runMutation(internal.integrationLimits.consumeAnalysisForLink, {
      briefId: brief._id,
    });
    return await fill(
      brief,
      { filename: args.filename.slice(0, 120), dataUrl },
      args.destinations,
      openai,
    );
  },
});

// The operator's browser uploads straight to storage, so the file never passes
// through an action's memory twice.
export const uploadUrl = mutation({
  args: { token: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    // The token is checked, so a stranger cannot use this deployment as free
    // storage.
    const owner = await ctx.db
      .query("briefOperators")
      .withIndex("by_capabilityToken", (q) =>
        q.eq("capabilityToken", args.token),
      )
      .unique();
    if (!owner) throw new ConvexError("This response link is no longer active.");
    return await ctx.storage.generateUploadUrl();
  },
});

function readMarkdown(body: unknown) {
  if (!body || typeof body !== "object") return "";
  const data =
    "data" in body && body.data && typeof body.data === "object"
      ? (body.data as Record<string, unknown>)
      : (body as Record<string, unknown>);
  for (const key of ["markdown", "content", "text"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim().length > 40) return value;
  }
  return "";
}
