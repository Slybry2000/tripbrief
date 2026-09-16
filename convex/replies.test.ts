/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { readInboundEvent } from "./replies";

const modules = import.meta.glob("./**/*.ts");
const token = (letter: string) => letter.repeat(43);

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

async function withInbox(inboxId = "inbox-1") {
  const t = convexTest(schema, modules).withIdentity({ subject: "advisor" });
  const { briefId } = await t.mutation(api.briefs.create, {
    brief,
    selectedDestinationSlugs: ["bali"],
  });
  await t.mutation(api.briefs.setShortlist, {
    briefId,
    operators: [
      {
        operatorSlug: "p1",
        operatorName: "Island Wellbeing Indonesia",
        capabilityToken: token("a"),
      },
    ],
  });
  const owner = (await t.query(api.briefs.one, { briefId }))!.owner;
  await t.mutation(internal.inboxes.attach, {
    briefId,
    owner,
    inboxId,
    email: "requests@inbox.example",
  });
  // The request has to have been sent for the reply to be matched to an operator.
  await t.run(async (ctx) => {
    const row = (await ctx.db.query("briefOperators").take(1))[0];
    await ctx.db.patch("briefOperators", row._id, {
      email: "hello@operator.example",
      sentAt: Date.now(),
      status: "sent",
    });
  });
  return { t, briefId };
}

test("a reply is matched by the inbox it landed in and the address it came from", async () => {
  const { t, briefId } = await withInbox();
  const outcome = await t.mutation(internal.replies.record, {
    inboxId: "inbox-1",
    fromEmail: "HELLO@operator.example",
    subject: "Re: Trip request",
    text: "We can operate 15-22 October.",
    messageId: "m1",
    receivedAt: Date.now(),
  });
  expect(outcome).toBe("recorded");
  const replies = await t.query(api.replies.list, { briefId });
  expect(replies).toHaveLength(1);
  expect(replies[0].operatorSlug).toBe("p1");
  expect(replies[0].text).toContain("15-22 October");
});

test("an uninvited sender is kept without being attributed to an operator", async () => {
  const { t, briefId } = await withInbox();
  await t.mutation(internal.replies.record, {
    inboxId: "inbox-1",
    fromEmail: "stranger@elsewhere.example",
    subject: "Interested",
    text: "We would like to quote.",
    messageId: "m2",
    receivedAt: Date.now(),
  });
  const replies = await t.query(api.replies.list, { briefId });
  expect(replies).toHaveLength(1);
  expect(replies[0].operatorSlug).toBeUndefined();
});

test("a duplicate delivery is dropped and an unknown inbox is not guessed at", async () => {
  const { t } = await withInbox();
  const event = {
    inboxId: "inbox-1",
    fromEmail: "hello@operator.example",
    subject: "Re: Trip request",
    text: "Yes.",
    messageId: "m3",
    receivedAt: Date.now(),
  };
  expect(await t.mutation(internal.replies.record, event)).toBe("recorded");
  expect(await t.mutation(internal.replies.record, event)).toBe("duplicate");
  expect(
    await t.mutation(internal.replies.record, {
      ...event,
      inboxId: "inbox-nobody-owns",
      messageId: "m4",
    }),
  ).toBe("unmatched");
});

test("only a received message is read, and the body is never trusted for matching", () => {
  expect(readInboundEvent({ event_type: "message.sent" })).toBeNull();
  const event = readInboundEvent({
    event_type: "message.received",
    message: {
      inbox_id: "inbox-1",
      from: "hello@operator.example",
      subject: "Re: Trip request",
      text: "We can operate those dates.",
      message_id: "m5",
    },
  });
  expect(event).toMatchObject({
    inboxId: "inbox-1",
    fromEmail: "hello@operator.example",
    messageId: "m5",
  });
  expect(Object.keys(event!)).not.toContain("briefId");
  expect(() => readInboundEvent({ event_type: "message.received" })).toThrow();
  expect(() =>
    readInboundEvent({ event_type: "message.received", message: {} }),
  ).toThrow("no inbox");
});
