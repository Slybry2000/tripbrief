/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function tripFor(root: ReturnType<typeof convexTest>, subject: string) {
  const user = root.withIdentity({ subject });
  const tripId = await user.mutation(api.trips.create, {
    title: "Quota test",
    destination: "Portugal",
    startDate: "2026-11-10",
    endDate: "2026-11-14",
    travelers: 12,
    brief: "Fictional",
    requirements: ["Transfers"],
  });
  return { user, tripId };
}

test("AI reviews are limited per user", async () => {
  const root = convexTest(schema, modules);
  rateLimiterTest.register(root);
  const { user, tripId } = await tripFor(root, "analysis-user");
  for (let i = 0; i < 5; i++)
    await user.mutation(internal.integrationLimits.consumeAnalysis, { tripId });
  await expect(
    user.mutation(internal.integrationLimits.consumeAnalysis, { tripId }),
  ).rejects.toThrow("limit reached");
});

test("production inbox creation has a global free-tier guard", async () => {
  const root = convexTest(schema, modules);
  rateLimiterTest.register(root);
  for (const subject of ["inbox-user-1", "inbox-user-2"]) {
    const { user, tripId } = await tripFor(root, subject);
    await user.mutation(internal.integrationLimits.consumeInbox, { tripId });
  }
  const third = await tripFor(root, "inbox-user-3");
  await expect(
    third.user.mutation(internal.integrationLimits.consumeInbox, {
      tripId: third.tripId,
    }),
  ).rejects.toThrow("limit reached");
});
