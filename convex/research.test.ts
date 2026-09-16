/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { buildOperatorQueries, parseResults } from "./research";

const modules = import.meta.glob("./**/*.ts");

test("the search is built from the destination and the brief, never from a budget", () => {
  const queries = buildOperatorQueries({
    destinationName: "Bali",
    focus: ["yoga", "healthy_food"],
  });
  expect(queries[0]).toBe("Bali incoming tour operator group travel");
  expect(queries[1]).toContain("yoga");
  expect(queries.some((query) => /usd|\$|3,500|3500/i.test(query))).toBe(false);
  expect(queries.length).toBeLessThanOrEqual(3);
  expect(
    buildOperatorQueries({ destinationName: "Lisbon", focus: [] }).length,
  ).toBeGreaterThan(0);
});

test("research keeps only safe, de-duplicated https results", () => {
  const results = parseResults({
    success: true,
    data: {
      web: [
        { url: "https://one.example/page", title: "One", description: "First" },
        { url: "https://one.example/page", title: "Duplicate" },
        { url: "http://insecure.example/", title: "Insecure" },
        { url: "https://user:pass@secret.example/", title: "Credentialed" },
        { url: "not a url", title: "Nonsense" },
        { url: "https://two.example/", title: "Two", description: "Second" },
      ],
    },
  });
  expect(results.map((item) => item.url)).toEqual([
    "https://one.example/page",
    "https://two.example/",
  ]);
  expect(results[1].description).toBe("Second");
  expect(() => parseResults({ success: false })).toThrow(
    "unexpected response",
  );
});

test("candidates belong to the advisor who found them", async () => {
  const t = convexTest(schema, modules);
  const advisor = t.withIdentity({ subject: "advisor" });
  await t.run(async (ctx) =>
    ctx.db.insert("candidates", {
      owner: "advisor",
      query: "bali incoming tour operator group travel",
      title: "Example",
      url: "https://example.com/",
      description: "",
      destinationSlug: "bali",
      foundAt: Date.now(),
    }),
  );
  expect(await t.query(api.research.list, { destinationSlug: "bali" })).toEqual(
    [],
  );
  const mine = await advisor.query(api.research.list, { destinationSlug: "bali" });
  expect(mine).toHaveLength(1);
  const stranger = t.withIdentity({ subject: "stranger" });
  await expect(
    stranger.mutation(api.research.dismiss, { candidateId: mine[0]._id }),
  ).rejects.toThrow("no longer available");
});
