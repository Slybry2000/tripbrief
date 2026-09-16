/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { MAILBOX_LIMIT, displayName, parseInbox } from "./mailboxes";

const modules = import.meta.glob("./**/*.ts");

test("a mailbox display name survives whatever a brief is called", () => {
  // The mail provider rejects brackets, so a brief named with them must not be
  // able to make sending impossible.
  expect(displayName("Wellness week (October)")).toBe(
    "TripBrief - Wellness week October",
  );
  expect(displayName("Kyoto · family — Dec 2026–Jan 2027")).toBe(
    "TripBrief - Kyoto family Dec 2026 Jan 2027",
  );
  expect(displayName("   ")).toBe("TripBrief - workspace");
  expect(displayName("x".repeat(300)).length).toBeLessThanOrEqual(120);
  expect(displayName("A&B <C>")).not.toMatch(/[&<>()·—]/);
});

test("an inbox is only accepted in the documented shape", () => {
  expect(
    parseInbox({ inbox_id: "abc@inbox.example", email: "abc@inbox.example" }),
  ).toEqual({ inboxId: "abc@inbox.example", email: "abc@inbox.example" });
  expect(
    parseInbox({ inboxId: "xyz@inbox.example", email: "xyz@inbox.example" }),
  ).toEqual({ inboxId: "xyz@inbox.example", email: "xyz@inbox.example" });
  expect(() => parseInbox(null)).toThrow("unexpected response");
  expect(() => parseInbox({ inbox_id: "", email: "" })).toThrow("invalid inbox");
  expect(() => parseInbox({ inbox_id: "abc", email: "not-an-address" })).toThrow(
    "invalid inbox",
  );
});

test("the pool hands out the quietest mailbox, and three is the ceiling", async () => {
  const t = convexTest(schema, modules);
  const advisor = t.withIdentity({ subject: "advisor" });
  for (const [index, address] of ["one", "two", "three"].entries()) {
    await t.mutation(internal.mailboxes.record, {
      owner: "advisor",
      inboxId: `inbox-${index}`,
      address: `${address}@mail.example`,
      displayName: `TripBrief - ${address}`,
    });
  }
  // Newest first in the UI, quietest first for the next send.
  const listed = await advisor.query(api.mailboxes.list, {});
  expect(listed.limit).toBe(MAILBOX_LIMIT);
  expect(listed.mailboxes).toHaveLength(MAILBOX_LIMIT);
  const pool = await t.query(internal.mailboxes.pool, { owner: "advisor" });
  expect(pool[0].address).toBe("one@mail.example");

  // Using the quietest one moves it to the back of the queue.
  await t.mutation(internal.mailboxes.markUsed, { mailboxId: pool[0]._id });
  const after = await t.query(internal.mailboxes.pool, { owner: "advisor" });
  expect(after[after.length - 1].address).toBe("one@mail.example");

  // The pool is per workspace, and another one starts empty.
  const other = t.withIdentity({ subject: "other" });
  expect((await other.query(api.mailboxes.list, {})).mailboxes).toEqual([]);
});
