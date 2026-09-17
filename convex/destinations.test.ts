/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { slugify } from "./destinations";

const modules = import.meta.glob("./**/*.ts");

test("a location name becomes a slug the brief can store", () => {
  expect(slugify("Vietnam")).toBe("vietnam");
  expect(slugify("  Costa   Rica ")).toBe("costa-rica");
  expect(slugify("São Paulo & the coast")).toBe("s-o-paulo-the-coast");
  expect(slugify("!!!")).toBe("");
});

test("the list is the network's places plus the advisor's own", async () => {
  const t = convexTest(schema, modules).withIdentity({ subject: "advisor" });
  expect(await t.query(api.destinations.list, {})).toEqual([]);
  await t.mutation(api.network.ensureWorkspace, {});

  // The network's places come from the operators, so an operator is enough.
  const fromNetwork = await t.query(api.destinations.list, {});
  expect(fromNetwork.map((row) => row.slug)).toContain("bali");
  expect(fromNetwork.find((row) => row.slug === "bali")!.source).toBe("network");
  expect(
    fromNetwork.find((row) => row.slug === "bali")!.operatorCount,
  ).toBeGreaterThan(0);

  await t.mutation(api.destinations.add, {
    name: "Vietnam",
    country: "Vietnam",
    strengths: ["beach", "culture", "beach"],
  });
  const listed = await t.query(api.destinations.list, {});
  const vietnam = listed.find((row) => row.slug === "vietnam")!;
  expect(vietnam.source).toBe("added");
  expect(vietnam.name).toBe("Vietnam");
  expect(vietnam.country).toBe("Vietnam");
  // The advisor's assessment is kept once, and only from the vocabulary.
  expect(vietnam.strengths).toEqual(["beach", "culture"]);
  expect(vietnam.operatorCount).toBe(0);
});

test("an added location belongs to one workspace and can be removed", async () => {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice" });
  const bob = t.withIdentity({ subject: "bob" });
  await alice.mutation(api.network.ensureWorkspace, {});
  await bob.mutation(api.network.ensureWorkspace, {});
  await alice.mutation(api.destinations.add, {
    name: "Vietnam",
    country: "Vietnam",
    strengths: [],
  });

  expect(
    (await alice.query(api.destinations.list, {})).map((row) => row.slug),
  ).toContain("vietnam");
  expect(
    (await bob.query(api.destinations.list, {})).map((row) => row.slug),
  ).not.toContain("vietnam");
  // The same name twice is a mistake to explain, not a second row.
  await expect(
    alice.mutation(api.destinations.add, {
      name: "vietnam",
      country: "Vietnam",
      strengths: [],
    }),
  ).rejects.toThrow("already on your list");

  // A place the network covers is not the advisor's to delete: removing it would
  // hide an operator from the matching that reads the same list.
  await expect(
    alice.mutation(api.destinations.remove, { slug: "bali" }),
  ).rejects.toThrow("comes from your operator network");
  await alice.mutation(api.destinations.remove, { slug: "vietnam" });
  expect(
    (await alice.query(api.destinations.list, {})).map((row) => row.slug),
  ).not.toContain("vietnam");
});
