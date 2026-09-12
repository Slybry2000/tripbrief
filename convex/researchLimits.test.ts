/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

test("research burst quota stops the fourth request and rejects foreign trips", async () => {
  const root = convexTest(schema, import.meta.glob("./**/*.ts"));
  rateLimiterTest.register(root);
  const advisor = root.withIdentity({ subject: "advisor|session" });
  const other = root.withIdentity({ subject: "other|session" });
  const tripId = await advisor.mutation(api.trips.create, {
    title: "Quota test",
    destination: "Portugal",
    startDate: "2026-11-10",
    endDate: "2026-11-14",
    travelers: 12,
    brief: "Fictional",
    requirements: ["Transfers"],
  });
  await expect(
    other.mutation(internal.researchLimits.consume, { tripId }),
  ).rejects.toThrow("not found");
  for (let i = 0; i < 3; i++)
    await advisor.mutation(internal.researchLimits.consume, { tripId });
  await expect(
    advisor.mutation(internal.researchLimits.consume, { tripId }),
  ).rejects.toThrow("limit reached");
});
