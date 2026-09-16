import { httpRouter } from "convex/server";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { auth } from "./auth";
import { components } from "./_generated/api";

const http = httpRouter();
// Exact routes are registered first so they win over the static catch-all.
auth.addHttpRoutes(http);
// Serves the built frontend at the deployment's convex.site URL.
registerStaticRoutes(http, components.staticHosting);
export default http;
