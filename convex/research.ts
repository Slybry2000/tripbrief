import { action, env, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc } from "./_generated/dataModel";
import { buildQueries, queryPrompt } from "./searchQueries";
import { extractOutputText } from "./analysis";

export const result = v.object({
  title: v.string(),
  url: v.string(),
  description: v.string(),
});

const MAX_QUERIES = 3;
const MAX_RESULTS = 9;

// The advisor never types a search. The brief already knows the destination, who
// is travelling, what they care about and what has to be avoided, so the queries
// are built from that — refined by the model when it is available, and by the
// tested rules when it is not.
async function planQueries(trip: Pick<Doc<"trips">, "destination" | "travelers" | "profile">) {
  const fallback = buildQueries(trip);
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) return { queries: fallback, usedModel: false };
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        store: false,
        input: [
          {
            role: "developer",
            content:
              "You write short web search queries for a travel advisor who needs supplier websites. Never include a budget, a price, or a person's name.",
          },
          { role: "user", content: queryPrompt(trip) },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "search_queries",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["queries"],
              properties: {
                queries: {
                  type: "array",
                  minItems: 1,
                  maxItems: MAX_QUERIES,
                  items: { type: "string" },
                },
              },
            },
          },
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return { queries: fallback, usedModel: false };
    const parsed: unknown = JSON.parse(
      extractOutputText(await response.json()),
    );
    if (!parsed || typeof parsed !== "object" || !("queries" in parsed))
      return { queries: fallback, usedModel: false };
    const queries = (parsed.queries as unknown[])
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.replace(/\s+/g, " ").trim().slice(0, 300))
      .filter((item) => item.length >= 3)
      .slice(0, MAX_QUERIES);
    return queries.length
      ? { queries, usedModel: true }
      : { queries: fallback, usedModel: false };
  } catch {
    // A failed model call must never block the search.
    return { queries: fallback, usedModel: false };
  }
}

async function firecrawl(key: string, query: string) {
  let response: Response;
  try {
    response = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        sources: [{ type: "web" }],
        limit: 5,
        timeout: 30000,
      }),
    });
  } catch {
    throw new ConvexError("Research could not connect. Please try again.");
  }
  if (!response.ok) {
    // The provider's own words are safe to surface: no credential is echoed.
    const detail = (await response.text().catch(() => "")).slice(0, 180);
    throw new ConvexError(
      `The research provider refused the search (status ${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  return parseResults(await response.json());
}

export const searchForBrief = action({
  args: { tripId: v.id("trips") },
  returns: v.object({
    queries: v.array(v.string()),
    usedModel: v.boolean(),
    results: v.array(result),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Please sign in.");
    if (env.RESEARCH_TEST_USER_ID && env.RESEARCH_TEST_USER_ID !== userId)
      throw new ConvexError(
        "Live research is not enabled for this preview workspace yet.",
      );
    const { trip }: { trip: Doc<"trips">; offers: Doc<"offers">[] } =
      await ctx.runQuery(api.trips.get, { tripId: args.tripId });
    const key = env.FIRECRAWL_API_KEY?.trim();
    if (!key) throw new ConvexError("Partner research has not been configured.");
    const planned = await planQueries(trip);
    // One search action costs one unit, however many queries it runs: the
    // advisor pressed a button once, and the burst limit exists to stop repeats.
    await ctx.runMutation(internal.researchLimits.consume, { tripId: args.tripId });
    const found: { title: string; url: string; description: string }[] = [];
    for (const query of planned.queries) found.push(...(await firecrawl(key, query)));
    const seen = new Set<string>();
    const results = found.filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
    return {
      queries: planned.queries,
      usedModel: planned.usedModel,
      results: results.slice(0, MAX_RESULTS),
    };
  },
});

// An ops probe: run from the CLI to see what the provider answers without
// touching the credential. `npx convex run --prod research:checkProvider`
export const checkProvider = internalAction({
  args: {},
  returns: v.object({
    configured: v.boolean(),
    keyLooksValid: v.boolean(),
    status: v.number(),
    detail: v.string(),
  }),
  handler: async () => {
    const key = env.FIRECRAWL_API_KEY?.trim();
    if (!key)
      return {
        configured: false,
        keyLooksValid: false,
        status: 0,
        detail: "FIRECRAWL_API_KEY is not set on this deployment.",
      };
    const keyLooksValid = key.startsWith("fc-");
    try {
      const response = await fetch("https://api.firecrawl.dev/v2/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: "lisbon group travel operator",
          sources: [{ type: "web" }],
          limit: 1,
          timeout: 30000,
        }),
        signal: AbortSignal.timeout(35_000),
      });
      return {
        configured: true,
        keyLooksValid,
        status: response.status,
        detail: (await response.text()).slice(0, 300),
      };
    } catch (cause) {
      return {
        configured: true,
        keyLooksValid,
        status: 0,
        detail: `fetch failed: ${String(cause).slice(0, 200)}`,
      };
    }
  },
});

export function parseResults(body: unknown) {
  if (
    !body ||
    typeof body !== "object" ||
    !("success" in body) ||
    body.success !== true ||
    !("data" in body)
  ) {
    throw new ConvexError("Research returned an unexpected response.");
  }
  const data = body.data;
  if (
    !data ||
    typeof data !== "object" ||
    !("web" in data) ||
    !Array.isArray(data.web)
  ) {
    throw new ConvexError("Research returned an unexpected response.");
  }
  const seen = new Set<string>();
  const results: { title: string; url: string; description: string }[] = [];
  for (const raw of data.web) {
    const item: unknown = raw;
    if (
      !item ||
      typeof item !== "object" ||
      !("url" in item) ||
      typeof item.url !== "string"
    )
      continue;
    let url: URL;
    try {
      url = new URL(item.url);
    } catch {
      continue;
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      seen.has(url.href)
    )
      continue;
    seen.add(url.href);
    results.push({
      url: url.href,
      title:
        "title" in item && typeof item.title === "string"
          ? item.title.slice(0, 300)
          : url.hostname,
      description:
        "description" in item && typeof item.description === "string"
          ? item.description.slice(0, 2000)
          : "No preview available. Review the source website.",
    });
    if (results.length === 5) break;
  }
  return results;
}
