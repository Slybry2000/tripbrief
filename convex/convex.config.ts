import { defineApp } from "convex/server";
import { v } from "convex/values";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import staticHosting from "@convex-dev/static-hosting/convex.config";

const app = defineApp({
  env: {
    FIRECRAWL_API_KEY: v.optional(v.string()),
    OPENAI_API_KEY: v.optional(v.string()),
    AGENTMAIL_API_KEY: v.optional(v.string()),
    RESEARCH_TEST_USER_ID: v.optional(v.string()),
  },
});
app.use(rateLimiter);
// The app owns the root so Convex Auth keeps its exact /api/auth and
// /.well-known routes; convex/http.ts registers the static catch-all last.
app.use(staticHosting);
export default app;
