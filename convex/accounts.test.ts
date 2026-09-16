/// <reference types="vite/client" />
import { expect, test } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";
import { evaluate } from "./accounts";

const modules = import.meta.glob("./**/*.ts");

test("a trial workspace can do everything except send", () => {
  const permission = evaluate(
    { email: "", isAnonymous: true },
    ["someone@agency.example"],
  );
  expect(permission.allowed).toBe(false);
  expect(permission.isTrial).toBe(true);
  // The message has to be usable: it says what still works, not just "no".
  expect(permission.reason).toMatch(/matching/i);
  expect(permission.reason).toMatch(/create an account/i);
});

test("no send list means nobody sends, including a real account", () => {
  const permission = evaluate(
    { email: "someone@agency.example", isAnonymous: false },
    [],
  );
  expect(permission.allowed).toBe(false);
  expect(permission.reason).toMatch(/not been enabled/i);
});

test("a named account sends only if it is on the list", () => {
  const allowlist = ["owner@agency.example"];
  expect(
    evaluate({ email: "owner@agency.example", isAnonymous: false }, allowlist)
      .allowed,
  ).toBe(true);
  const stranger = evaluate(
    { email: "stranger@elsewhere.example", isAnonymous: false },
    allowlist,
  );
  expect(stranger.allowed).toBe(false);
  // The refusal names the address, so the owner can tell it is not a typo in the
  // password or the workspace.
  expect(stranger.reason).toContain("stranger@elsewhere.example");
});

test("the workspace can be asked what it is allowed to do", async () => {
  const t = convexTest(schema, modules);
  expect(await t.query(api.accounts.me, {})).toBeNull();
  const signedIn = t.withIdentity({ subject: "advisor" });
  const me = await signedIn.query(api.accounts.me, {});
  // A session with no email is a trial: that is what the anonymous provider
  // produces, and it is the safe reading of anything else without an address.
  expect(me).toMatchObject({ canSend: false, isTrial: true });
  expect(me!.reason).toMatch(/create an account/i);
});
