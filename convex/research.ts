import {
  action,
  env,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v, type Infer } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

const MAX_RESULTS = 9;

export const candidate = v.object({
  _id: v.id("candidates"),
  title: v.string(),
  url: v.string(),
  description: v.string(),
  destinationSlug: v.string(),
  query: v.string(),
  foundAt: v.number(),
  addedOperatorSlug: v.optional(v.string()),
});

type CandidateRow = Infer<typeof candidate>;

// The search is the brief's, not the advisor's. It is built from the destination
// the customer approved and from what the group cares about, so nobody has to
// think of a query. Kept pure so the wording can be tested.
export function buildOperatorQueries(input: {
  destinationName: string;
  focus: string[];
}) {
  const place = input.destinationName.replace(/\s+/g, " ").trim();
  const queries: string[] = [];
  const add = (value: string) => {
    const text = value.replace(/\s+/g, " ").trim().slice(0, 300);
    if (text.length >= 3 && !queries.includes(text)) queries.push(text);
  };
  add(`${place} incoming tour operator group travel`);
  const first = input.focus[0]?.replaceAll("_", " ").trim();
  if (first) add(`${place} ${first} group tours incoming operator`);
  add(`${place} destination management company group trips`);
  return queries.slice(0, 3);
}

// Looking for new operators is a deliberate action on one destination. What it
// finds is stored as candidates: published pages, with the query that surfaced
// each one, so nothing is added to the network on a machine's say-so.
export const search = action({
  args: {
    briefId: v.id("briefs"),
    destinationSlug: v.string(),
    destinationName: v.string(),
    focus: v.array(v.string()),
  },
  returns: v.object({
    queries: v.array(v.string()),
    candidates: v.array(candidate),
  }),
  // The return type is written out because this action calls `internal`, whose
  // types import this module: without it, TypeScript reports a circular inference.
  handler: async (
    ctx,
    args,
  ): Promise<{ queries: string[]; candidates: CandidateRow[] }> => {
    const owner = await getAuthUserId(ctx);
    if (!owner) throw new ConvexError("Please sign in.");
    const key = env.FIRECRAWL_API_KEY?.trim();
    if (!key) throw new ConvexError("Operator research has not been configured.");
    const queries = buildOperatorQueries({
      destinationName: args.destinationName,
      focus: args.focus,
    });
    // One press of the button is one unit of quota, however many queries it runs.
    await ctx.runMutation(internal.integrationLimits.consumeResearch, {
      briefId: args.briefId,
    });
    const found: { title: string; url: string; description: string; query: string }[] =
      [];
    for (const query of queries) {
      for (const result of await firecrawl(key, query))
        found.push({ ...result, query });
    }
    const seen = new Set<string>();
    const records = found
      .filter((result) => {
        if (seen.has(result.url)) return false;
        seen.add(result.url);
        return true;
      })
      .slice(0, MAX_RESULTS)
      .map((result) => ({
        ...result,
        destinationSlug: args.destinationSlug,
      }));
    await ctx.runMutation(internal.research.record, { owner, records });
    const stored: CandidateRow[] = await ctx.runQuery(
      internal.research.listForOwner,
      {
      owner,
      destinationSlug: args.destinationSlug,
      },
    );
    return { queries, candidates: stored };
  },
});

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
    throw new ConvexError(
      "Operator research could not connect. Please try again.",
    );
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

export const record = internalMutation({
  args: {
    owner: v.string(),
    records: v.array(
      v.object({
        title: v.string(),
        url: v.string(),
        description: v.string(),
        query: v.string(),
        destinationSlug: v.string(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const record of args.records) {
      const existing = await ctx.db
        .query("candidates")
        .withIndex("by_url", (q) => q.eq("url", record.url))
        .first();
      if (existing) continue;
      await ctx.db.insert("candidates", {
        owner: args.owner,
        query: record.query.slice(0, 300),
        title: record.title.slice(0, 300),
        url: record.url.slice(0, 500),
        description: record.description.slice(0, 2_000),
        destinationSlug: record.destinationSlug.slice(0, 60),
        foundAt: now,
      });
    }
    return null;
  },
});

export const listForOwner = internalQuery({
  args: { owner: v.string(), destinationSlug: v.string() },
  returns: v.array(candidate),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("candidates")
      .withIndex("by_owner", (q) => q.eq("owner", args.owner))
      .order("desc")
      .take(60);
    return rows
      .filter((row) => row.destinationSlug === args.destinationSlug)
      .map((row) => ({
        _id: row._id,
        title: row.title,
        url: row.url,
        description: row.description,
        destinationSlug: row.destinationSlug,
        query: row.query,
        foundAt: row.foundAt,
        addedOperatorSlug: row.addedOperatorSlug,
      }));
  },
});

// The advisor's own view of what research has already found for a destination.
export const list = query({
  args: { destinationSlug: v.string() },
  returns: v.array(candidate),
  handler: async (ctx, args) => {
    const owner = await getAuthUserId(ctx);
    if (!owner) return [];
    const rows = await ctx.db
      .query("candidates")
      .withIndex("by_owner", (q) => q.eq("owner", owner))
      .order("desc")
      .take(60);
    return rows
      .filter((row) => row.destinationSlug === args.destinationSlug)
      .map((row) => ({
        _id: row._id,
        title: row.title,
        url: row.url,
        description: row.description,
        destinationSlug: row.destinationSlug,
        query: row.query,
        foundAt: row.foundAt,
        addedOperatorSlug: row.addedOperatorSlug,
      }));
  },
});

export const dismiss = mutation({
  args: { candidateId: v.id("candidates") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const owner = await getAuthUserId(ctx);
    if (!owner) throw new ConvexError("Please sign in.");
    const row = await ctx.db.get("candidates", args.candidateId);
    if (!row || row.owner !== owner)
      throw new ConvexError("That result is no longer available.");
    await ctx.db.delete("candidates", row._id);
    return null;
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
        keyLooksValid: key.startsWith("fc-"),
        status: response.status,
        detail: (await response.text()).slice(0, 300),
      };
    } catch (cause) {
      return {
        configured: true,
        keyLooksValid: key.startsWith("fc-"),
        status: 0,
        detail: `fetch failed: ${String(cause).slice(0, 200)}`,
      };
    }
  },
});

// Only https results with a hostname and no embedded credentials are kept: a
// candidate is shown to a human as a link, so it has to be safe to click.
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
          ? item.description.slice(0, 2_000)
          : "No preview available. Review the source website.",
    });
    if (results.length === 5) break;
  }
  return results;
}
