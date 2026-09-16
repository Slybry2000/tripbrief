/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { readInboundEvent } from "./replies";

const modules = import.meta.glob("./**/*.ts");
const token = (letter: string) => letter.repeat(43);
const INBOX = "workspace@mail.example";

const brief = {
  name: "Wellness Escape",
  evaluationDate: "2027-05-23",
  travelMonth: "October",
  travelerCount: 16,
  minimumViableTravelers: 12,
  confirmedTravelers: 8,
  nights: 7,
  earliestDepartureDate: "2027-10-10",
  preferredDepartureDate: "2027-10-15",
  latestDepartureDate: "2027-10-25",
  flexibleDates: true,
  proposalDecisionDate: "2027-06-10",
  targetRetailPricePerPerson: 3500,
  flightsIncluded: false,
  experienceLevel: 2,
  pace: "relaxed",
  climates: ["warm"],
  desiredExperiences: ["yoga"],
  importantRequirements: ["strong_wellness_focus"],
  travelerTypes: ["private_groups"],
  transportationNeeds: ["private_transportation"],
  accessibilityNeeds: [],
  notes: "",
};

// One mailbox, two briefs, and the same operator invited on both. This is the
// arrangement the whole design has to survive: a free mail plan gives three
// inboxes and an agency has more briefs than that.
async function threeInboxWorld() {
  const t = convexTest(schema, modules).withIdentity({ subject: "advisor" });
  await t.mutation(api.network.ensureWorkspace, {});
  const owner = (await t.query(api.network.list, {}))[0].operator.owner;
  await t.mutation(internal.mailboxes.record, {
    owner,
    inboxId: "inbox-1",
    address: INBOX,
    displayName: "TripBrief - advisor",
  });
  const first = await t.mutation(api.briefs.create, {
    brief,
    selectedDestinationSlugs: ["bali"],
  });
  const second = await t.mutation(api.briefs.create, {
    brief: { ...brief, name: "Second brief" },
    selectedDestinationSlugs: ["bali"],
  });
  await t.mutation(api.briefs.setShortlist, {
    briefId: first.briefId,
    operators: [
      { operatorSlug: "p1", operatorName: "Island Wellbeing Indonesia", capabilityToken: token("a") },
    ],
  });
  await t.mutation(api.briefs.setShortlist, {
    briefId: second.briefId,
    operators: [
      { operatorSlug: "p2", operatorName: "Pura Vida Retreats", capabilityToken: token("b") },
    ],
  });
  const rows = await t.run(async (ctx) => ctx.db.query("briefOperators").take(10));
  await t.run(async (ctx) => {
    for (const row of rows) {
      await ctx.db.patch("briefOperators", row._id, {
        email: "hello@operator.example",
        sentAt: Date.now(),
        status: "sent",
        providerThreadId: row.operatorSlug === "p1" ? "thread-one" : "thread-two",
      });
    }
  });
  return { t, owner, first: first.briefId, second: second.briefId };
}

test("a reply lands on the request it answers, not on whichever brief shares the inbox", async () => {
  const { t, first, second } = await threeInboxWorld();
  const outcome = await t.mutation(internal.replies.record, {
    inboxId: "inbox-1",
    threadId: "thread-two",
    fromEmail: "hello@operator.example",
    subject: "Re: Trip request",
    text: "We can operate those dates.",
    messageId: "m1",
    receivedAt: Date.now(),
  });
  expect(outcome).toBe("filed");
  const onSecond = await t.query(api.replies.list, { briefId: second });
  expect(onSecond).toHaveLength(1);
  expect(onSecond[0]).toMatchObject({
    operatorSlug: "p2",
    matchedBy: "thread",
  });
  // The other brief, which invited the very same address, stays empty.
  expect(await t.query(api.replies.list, { briefId: first })).toHaveLength(0);
});

test("without a thread the reply is placed by address, and says so", async () => {
  const { t, first, second } = await threeInboxWorld();
  const outcome = await t.mutation(internal.replies.record, {
    inboxId: "inbox-1",
    fromEmail: "HELLO@operator.example",
    subject: "A new message",
    text: "Quoting you separately.",
    messageId: "m2",
    receivedAt: Date.now(),
  });
  expect(outcome).toBe("filed");
  const filed = [
    ...(await t.query(api.replies.list, { briefId: first })),
    ...(await t.query(api.replies.list, { briefId: second })),
  ];
  expect(filed).toHaveLength(1);
  // "address" is the honest answer: a person should check it.
  expect(filed[0].matchedBy).toBe("address");
});

test("mail from an address no request went to is kept on the workspace, not filed", async () => {
  const { t, first, second } = await threeInboxWorld();
  const outcome = await t.mutation(internal.replies.record, {
    inboxId: "inbox-1",
    fromEmail: "stranger@elsewhere.example",
    subject: "Interested",
    text: "We would like to quote.",
    messageId: "m3",
    receivedAt: Date.now(),
  });
  expect(outcome).toBe("recorded");
  expect(await t.query(api.replies.list, { briefId: first })).toHaveLength(0);
  expect(await t.query(api.replies.list, { briefId: second })).toHaveLength(0);
  const unfiled = await t.query(api.replies.unfiled, {});
  expect(unfiled).toHaveLength(1);
  expect(unfiled[0].fromEmail).toBe("stranger@elsewhere.example");
});

test("a duplicate delivery is dropped and an unknown mailbox is not guessed at", async () => {
  const { t } = await threeInboxWorld();
  const event = {
    inboxId: "inbox-1",
    threadId: "thread-one",
    fromEmail: "hello@operator.example",
    subject: "Re",
    text: "Yes.",
    messageId: "m4",
    receivedAt: Date.now(),
  };
  expect(await t.mutation(internal.replies.record, event)).toBe("filed");
  expect(await t.mutation(internal.replies.record, event)).toBe("duplicate");
  expect(
    await t.mutation(internal.replies.record, {
      ...event,
      inboxId: "inbox-nobody-owns",
      messageId: "m5",
    }),
  ).toBe("unmatched");
});

test("only a received message is read, and the thread is what carries attribution", () => {
  expect(readInboundEvent({ event_type: "message.sent" })).toBeNull();
  const event = readInboundEvent({
    event_type: "message.received",
    message: {
      inbox_id: "inbox-1",
      thread_id: "thread-two",
      from: "hello@operator.example",
      subject: "Re: Trip request",
      text: "We can operate those dates.",
      message_id: "m6",
    },
  });
  expect(event).toMatchObject({
    inboxId: "inbox-1",
    threadId: "thread-two",
    fromEmail: "hello@operator.example",
    messageId: "m6",
  });
  expect(Object.keys(event!)).not.toContain("briefId");
  expect(() => readInboundEvent({ event_type: "message.received" })).toThrow();
  expect(() =>
    readInboundEvent({ event_type: "message.received", message: {} }),
  ).toThrow("no inbox");
});
