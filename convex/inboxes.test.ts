import { expect, test } from "vitest";
import { parseInbox } from "./inboxes";

test("AgentMail responses require an inbox ID and a valid address", () => {
  expect(
    parseInbox({ inbox_id: "inbox_123", email: "trip@agentmail.to" }),
  ).toEqual({ inboxId: "inbox_123", email: "trip@agentmail.to" });
  expect(
    parseInbox({ inboxId: "inbox_456", email: "trip@agentmail.to" }),
  ).toEqual({ inboxId: "inbox_456", email: "trip@agentmail.to" });
  expect(
    parseInbox({
      inbox_id: "agentmail-generated-id",
      email: "trip@agentmail.to",
    }),
  ).toEqual({ inboxId: "agentmail-generated-id", email: "trip@agentmail.to" });
  expect(() => parseInbox({ inbox_id: "", email: "not-an-address" })).toThrow(
    "invalid inbox",
  );
});
