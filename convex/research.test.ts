/// <reference types="vite/client" />
import { expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { parseResults } from "./research";

test("research fails closed before network access when signed out or unconfigured", async () => {
  const t = convexTest(schema, import.meta.glob("./**/*.ts"));
  const advisor = t.withIdentity({ subject: "research-advisor|session" });
  const tripId = await advisor.mutation(api.trips.create, {
    title: "Research test",
    destination: "Portugal",
    startDate: "2026-11-10",
    endDate: "2026-11-14",
    travelers: 12,
    brief: "Fictional",
    requirements: ["Transfers"],
  });
  const network = vi.spyOn(globalThis, "fetch");
  try {
    await expect(
      t.action(api.research.search, { tripId, query: "Portugal operators" }),
    ).rejects.toThrow("sign in");
    await expect(
      advisor.action(api.research.search, {
        tripId,
        query: "Portugal operators",
      }),
    ).rejects.toThrow("not been configured");
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
});

test("research rejects malformed provider responses", () => {
  for (const response of [
    null,
    {},
    { success: false },
    { success: true, data: {} },
  ]) {
    expect(() => parseResults(response)).toThrow("unexpected response");
  }
});

test("research keeps sources separate and strips unsafe links and duplicates", () => {
  const results = parseResults({
    success: true,
    data: {
      web: [
        { url: "javascript:alert(1)", title: "Unsafe" },
        { url: "https://user:password@example.com" },
        {
          url: "https://example.com",
          title: "Example",
          description: "Unverified website claim.",
        },
        { url: "https://example.com", title: "Duplicate" },
      ],
    },
  });
  expect(results).toEqual([
    {
      url: "https://example.com/",
      title: "Example",
      description: "Unverified website claim.",
    },
  ]);
});
