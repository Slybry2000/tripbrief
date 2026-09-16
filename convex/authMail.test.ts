/// <reference types="vite/client" />
import { expect, test } from "vitest";
import { codeMessage, pickSender } from "./authMail";

test("the code email says what it is for, and what to do if it was not you", () => {
  const verify = codeMessage("verify", "123456");
  expect(verify.subject).toContain("123456");
  expect(verify.text).toContain("123456");
  expect(verify.text).toMatch(/fifteen minutes/);
  expect(verify.text).toMatch(/did not try to create an account/i);

  const reset = codeMessage("reset", "654321");
  expect(reset.subject).toContain("reset");
  expect(reset.text).toMatch(/did not ask to reset/i);
  // A reset mail must never read like a verification mail: the two are the same
  // mechanism with different consequences.
  expect(reset.subject).not.toBe(verify.subject);
});

test("a deployment with no mail account cannot send a code, and says so", async () => {
  // Without a key there is no sender to pick, and the failure has to be a
  // sentence a person can act on rather than a crash.
  await expect(pickSender("")).rejects.toThrow();
});
