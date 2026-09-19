import { defineApp } from "convex/server";
import { v } from "convex/values";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import staticHosting from "@convex-dev/static-hosting/convex.config";

const app = defineApp({
  env: {
    FIRECRAWL_API_KEY: v.optional(v.string()),
    OPENAI_API_KEY: v.optional(v.string()),
    AGENTMAIL_API_KEY: v.optional(v.string()),
    AGENTMAIL_WEBHOOK_SECRET: v.optional(v.string()),
    // Who may send real email. Empty means nobody, which is the safe default for
    // a public deployment.
    SEND_ALLOWED_EMAILS: v.optional(v.string()),
    // Optional: the address sign-in codes are sent from. Without it, the
    // deployment uses an inbox the mail account already has.
    AUTH_MAIL_FROM: v.optional(v.string()),
    // The public address the app is served from. A response link has to point at
    // wherever the operator can actually open it: the deployment's own site URL in
    // production, and the local dev server when the backend is running locally.
    SITE_URL: v.optional(v.string()),
    // Demo mode is on unless this is exactly "off". In demo mode no request ever
    // reaches a real operator: it goes to the stand-in inbox below, and a model
    // answers as the operator. Locked on for the hackathon.
    DEMO_MODE: v.optional(v.string()),
    // The shared inbox demo requests are sent from.
    DEMO_AGENCY_INBOX: v.optional(v.string()),
    // The stand-in inbox that receives every demo request in place of the real
    // operator's address.
    DEMO_OPERATOR_INBOX: v.optional(v.string()),
  },
});
app.use(rateLimiter);
// The app owns the root so Convex Auth keeps its exact /api/auth and
// /.well-known routes; convex/http.ts registers the static catch-all last.
app.use(staticHosting);
export default app;
