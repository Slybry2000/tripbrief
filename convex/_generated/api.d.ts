/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as alerting from "../alerting.js";
import type * as auth from "../auth.js";
import type * as authMail from "../authMail.js";
import type * as briefs from "../briefs.js";
import type * as crons from "../crons.js";
import type * as demo from "../demo.js";
import type * as demoResponder from "../demoResponder.js";
import type * as destinations from "../destinations.js";
import type * as followUps from "../followUps.js";
import type * as http from "../http.js";
import type * as integrationLimits from "../integrationLimits.js";
import type * as mailboxes from "../mailboxes.js";
import type * as network from "../network.js";
import type * as openai from "../openai.js";
import type * as operatorImport from "../operatorImport.js";
import type * as outbound from "../outbound.js";
import type * as places from "../places.js";
import type * as proposals from "../proposals.js";
import type * as replies from "../replies.js";
import type * as research from "../research.js";
import type * as seedData from "../seedData.js";
import type * as vocabulary from "../vocabulary.js";
import type * as web from "../web.js";
import type * as webOperators from "../webOperators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  alerting: typeof alerting;
  auth: typeof auth;
  authMail: typeof authMail;
  briefs: typeof briefs;
  crons: typeof crons;
  demo: typeof demo;
  demoResponder: typeof demoResponder;
  destinations: typeof destinations;
  followUps: typeof followUps;
  http: typeof http;
  integrationLimits: typeof integrationLimits;
  mailboxes: typeof mailboxes;
  network: typeof network;
  openai: typeof openai;
  operatorImport: typeof operatorImport;
  outbound: typeof outbound;
  places: typeof places;
  proposals: typeof proposals;
  replies: typeof replies;
  research: typeof research;
  seedData: typeof seedData;
  vocabulary: typeof vocabulary;
  web: typeof web;
  webOperators: typeof webOperators;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
};
