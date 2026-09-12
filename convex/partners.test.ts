/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");

test("shortlists are durable, deduplicated, owner-only, and never become offers", async () => {
  const root = convexTest(schema, modules);
  const advisor = root.withIdentity({ subject: "advisor|session" });
  const other = root.withIdentity({ subject: "other|session" });
  const tripId = await advisor.mutation(api.trips.create, {
    title: "Test",
    destination: "Portugal",
    startDate: "2026-11-10",
    endDate: "2026-11-14",
    travelers: 12,
    brief: "Fictional retreat",
    requirements: ["Transfers"],
  });
  const partner = {
    tripId,
    title: "Example partner",
    url: "https://example.com",
    description: "Unverified website preview",
  };
  const id = await advisor.mutation(api.partners.save, partner);
  expect(await advisor.mutation(api.partners.save, partner)).toBe(id);
  expect(await advisor.query(api.partners.list, { tripId })).toHaveLength(1);
  expect((await advisor.query(api.trips.get, { tripId })).offers).toEqual([]);
  await expect(other.query(api.partners.list, { tripId })).rejects.toThrow(
    "not found",
  );
  await expect(other.mutation(api.partners.save, partner)).rejects.toThrow(
    "not found",
  );
  await expect(
    advisor.mutation(api.partners.save, {
      ...partner,
      url: "javascript:alert(1)",
    }),
  ).rejects.toThrow("HTTPS");
});
