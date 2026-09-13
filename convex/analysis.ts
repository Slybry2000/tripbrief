import { action, env } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { assessment } from "./schema";
import type { Doc } from "./_generated/dataModel";

const analysis = v.object({
  assessments: v.array(assessment),
  caveats: v.array(v.string()),
});
type AnalysisResult = {
  assessments: {
    requirementNumber: number;
    status: "yes" | "partial" | "no" | "unknown";
    evidence: string;
  }[];
  caveats: string[];
};

export const analyzeOffer = action({
  args: { tripId: v.id("trips"), sourceText: v.string() },
  returns: analysis,
  handler: async (ctx, args): Promise<AnalysisResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Please sign in.");
    // A configured test user keeps local integration work private. Production
    // omits this switch and relies on transactional user + global quotas.
    if (env.RESEARCH_TEST_USER_ID && env.RESEARCH_TEST_USER_ID !== userId)
      throw new ConvexError(
        "AI analysis is not enabled for this preview workspace yet.",
      );
    const { trip }: { trip: Doc<"trips">; offers: Doc<"offers">[] } =
      await ctx.runQuery(api.trips.get, { tripId: args.tripId });
    const sourceText = args.sourceText.trim();
    if (!sourceText || sourceText.length > 20_000)
      throw new ConvexError(
        "Original response must contain 1–20,000 characters.",
      );
    if (!env.OPENAI_API_KEY)
      throw new ConvexError("AI analysis has not been configured.");
    await ctx.runMutation(internal.integrationLimits.consumeAnalysis, {
      tripId: args.tripId,
    });
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        store: false,
        input: [
          {
            role: "developer",
            content:
              "Extract only explicit support from a travel supplier response. Never infer. Evidence must be an exact contiguous quote from the response. An unknown answer uses empty evidence. This is a review draft, never a recommendation.",
          },
          {
            role: "user",
            content: `REQUIREMENTS:\n${trip.requirements.map((r) => `${r.number}. ${r.text}`).join("\n")}\n\nSUPPLIER RESPONSE:\n${sourceText}`,
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "offer_review",
            strict: true,
            schema: responseSchema(trip.requirements.map((r) => r.number)),
          },
        },
      }),
      signal: AbortSignal.timeout(45_000),
    }).catch(() => {
      throw new ConvexError(
        "AI analysis could not connect. Please try again later.",
      );
    });
    if (!response.ok)
      throw new ConvexError(
        "AI analysis is unavailable. Please try again later.",
      );
    const body: unknown = await response.json();
    return validateAnalysis(
      extractOutputText(body),
      sourceText,
      trip.requirements.map((r) => r.number),
    );
  },
});

function responseSchema(numbers: number[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["assessments", "caveats"],
    properties: {
      assessments: {
        type: "array",
        minItems: numbers.length,
        maxItems: numbers.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["requirementNumber", "status", "evidence"],
          properties: {
            requirementNumber: { type: "integer", enum: numbers },
            status: {
              type: "string",
              enum: ["yes", "partial", "no", "unknown"],
            },
            evidence: { type: "string" },
          },
        },
      },
      caveats: { type: "array", maxItems: 5, items: { type: "string" } },
    },
  };
}

export function extractOutputText(body: unknown): string {
  if (
    !body ||
    typeof body !== "object" ||
    !("output" in body) ||
    !Array.isArray(body.output)
  )
    throw new ConvexError("AI returned an unexpected response.");
  for (const item of body.output) {
    if (
      !item ||
      typeof item !== "object" ||
      !("content" in item) ||
      !Array.isArray(item.content)
    )
      continue;
    for (const part of item.content)
      if (
        part &&
        typeof part === "object" &&
        "text" in part &&
        typeof part.text === "string"
      )
        return part.text;
  }
  throw new ConvexError("AI returned no structured review.");
}

export function validateAnalysis(
  rawText: string,
  sourceText: string,
  requirementNumbers: number[],
) {
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    throw new ConvexError("AI returned invalid structured data.");
  }
  if (
    !raw ||
    typeof raw !== "object" ||
    !("assessments" in raw) ||
    !Array.isArray(raw.assessments) ||
    !("caveats" in raw) ||
    !Array.isArray(raw.caveats)
  )
    throw new ConvexError("AI returned invalid structured data.");
  const expected = new Set(requirementNumbers);
  const assessments = raw.assessments.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      !("requirementNumber" in item) ||
      !("status" in item) ||
      !("evidence" in item) ||
      typeof item.requirementNumber !== "number" ||
      typeof item.evidence !== "string" ||
      !["yes", "partial", "no", "unknown"].includes(String(item.status))
    )
      throw new ConvexError("AI returned invalid assessments.");
    const evidence = item.evidence.trim();
    if (
      !expected.delete(item.requirementNumber) ||
      evidence.length > 2_000 ||
      (String(item.status) !== "unknown" && !evidence) ||
      (evidence && !sourceText.includes(evidence))
    )
      throw new ConvexError(
        "AI draft failed evidence validation. Please review manually.",
      );
    return {
      requirementNumber: item.requirementNumber,
      status: item.status as "yes" | "partial" | "no" | "unknown",
      evidence,
    };
  });
  if (expected.size !== 0)
    throw new ConvexError("AI draft did not cover every requirement.");
  const caveats = raw.caveats
    .filter((c): c is string => typeof c === "string")
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 5);
  return { assessments, caveats };
}
