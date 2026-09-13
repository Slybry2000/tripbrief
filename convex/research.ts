import { action, env } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

export const search = action({
  args: { tripId: v.id("trips"), query: v.string() },
  returns: v.array(
    v.object({ title: v.string(), url: v.string(), description: v.string() }),
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Please sign in.");
    // A configured test user keeps local integration work private. Production
    // omits this switch and relies on transactional user + global quotas.
    if (env.RESEARCH_TEST_USER_ID && env.RESEARCH_TEST_USER_ID !== userId) {
      throw new ConvexError(
        "Live research is not enabled for this preview workspace yet.",
      );
    }
    await ctx.runQuery(api.trips.get, { tripId: args.tripId });
    const query = args.query.trim();
    if (query.length < 3 || query.length > 300)
      throw new ConvexError("Use a search of 3–300 characters.");
    const key = env.FIRECRAWL_API_KEY;
    if (!key)
      throw new ConvexError("Partner research has not been configured.");
    await ctx.runMutation(internal.researchLimits.consume, {
      tripId: args.tripId,
    });
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
        signal: AbortSignal.timeout(35000),
      });
    } catch {
      throw new ConvexError(
        "Research could not connect. Please try again later.",
      );
    }
    if (!response.ok)
      throw new ConvexError(
        "Research provider is unavailable. Please try again later.",
      );
    const body: unknown = await response.json();
    return parseResults(body);
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
