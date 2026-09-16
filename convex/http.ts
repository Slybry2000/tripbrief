import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { auth } from "./auth";
import { components, internal } from "./_generated/api";
import { env } from "./_generated/server";
import { readInboundEvent } from "./replies";

const http = httpRouter();
// Exact routes are registered first so they win over the static catch-all.
auth.addHttpRoutes(http);

// Inbound supplier mail. AgentMail posts here when a supplier replies to the
// address a brief sent its invitation from. The shared secret is the only
// credential in the request; nothing in the body is trusted for matching.
http.route({
  path: "/incoming/agentmail",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = env.AGENTMAIL_WEBHOOK_SECRET?.trim();
    if (!secret)
      return new Response("Not configured", { status: 503 });
    if (request.headers.get("x-tripbrief-secret") !== secret)
      return new Response("Forbidden", { status: 403 });
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    try {
      const event = readInboundEvent(body);
      if (!event) return new Response("Ignored", { status: 200 });
      const outcome = await ctx.runMutation(internal.replies.record, event);
      return new Response(outcome, { status: 200 });
    } catch {
      // A malformed or unmatched message must not make AgentMail retry forever.
      return new Response("Unmatched", { status: 200 });
    }
  }),
});

// Serves the built frontend at the deployment's convex.site URL.
registerStaticRoutes(http, components.staticHosting);
export default http;
