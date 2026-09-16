/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { demoBrief as brief } from "./fixtures.test";

const modules = import.meta.glob("./**/*.ts");
const token = (letter: string) => letter.repeat(43);

const proposal = {
  programName: "Bali Reset",
  basedOnExistingProgram: true,
  basedOnProgramSlug: "t1",
  destinationSlug: "bali",
  startDate: "2027-10-15",
  endDate: "2027-10-22",
  nights: 7,
  availability: "Confirmation Required" as const,
  groupSizeAccepted: 16,
  hotelLevel: "4-star",
  hotelNotes: "",
  transportation: ["private_transportation"],
  experiencesIncluded: ["yoga"],
  requirementsMet: ["strong_wellness_focus"],
  changesOrAdditions: [],
  cannotProvide: [],
  finalFit: 92,
  netPricePerPerson: 2150,
  currency: "USD",
  pricingAssumptions: "",
  depositPercent: 25,
  depositDueDaysBefore: 120,
  finalHeadcountDaysBefore: 75,
  finalPaymentDaysBefore: 45,
  travelerNamesDaysBefore: 45,
  roomReleaseDaysBefore: 60,
  cancellationTerms: [],
  operatorNotes: "",
};

async function world() {
  const t = convexTest(schema, modules).withIdentity({ subject: "advisor" });
  await t.mutation(api.network.ensureWorkspace, {});
  const { briefId } = await t.mutation(api.briefs.create, {
    brief,
    selectedDestinationSlugs: ["bali"],
  });
  await t.mutation(api.briefs.setShortlist, {
    briefId,
    operators: [
      { operatorSlug: "p1", operatorName: "Island Wellbeing Indonesia", capabilityToken: token("a") },
    ],
  });
  return { t, briefId };
}

test("a quote is pending until it has been announced, and then it is not", async () => {
  const { t, briefId } = await world();
  expect((await t.query(internal.alerting.pending, { owner: "advisor" })).items).toEqual([]);

  await t.mutation(api.proposals.submitByToken, { token: token("a"), proposal });
  const pending = await t.query(internal.alerting.pending, { owner: "advisor" });
  expect(pending.items).toHaveLength(1);
  expect(pending.items[0]).toMatchObject({
    kind: "proposal",
    briefTitle: "Wellness Escape",
  });
  // The announcement says what arrived in the terms an advisor reads.
  expect(pending.items[0].detail).toContain("Bali Reset");
  expect(pending.items[0].detail).toContain("2,150");
  expect(pending.items[0].detail).toContain("92%");

  await t.mutation(internal.alerting.markAnnounced, { ids: [pending.items[0].id] });
  expect((await t.query(internal.alerting.pending, { owner: "advisor" })).items).toEqual([]);
  void briefId;
});

test("a reply is announced once it has been filed, and never twice", async () => {
  const { t } = await world();
  await t.run(async (ctx) => {
    const row = (await ctx.db.query("briefOperators").take(1))[0];
    await ctx.db.patch("briefOperators", row._id, {
      email: "hello@operator.example",
      sentAt: Date.now(),
      status: "sent",
      providerThreadId: "thread-one",
    });
    await ctx.db.insert("mailboxes", {
      owner: "advisor",
      inboxId: "inbox-1",
      address: "workspace@mail.example",
      displayName: "TripBrief - advisor",
      lastUsedAt: Date.now(),
      createdAt: Date.now(),
    });
  });
  await t.mutation(internal.replies.record, {
    inboxId: "inbox-1",
    threadId: "thread-one",
    fromEmail: "hello@operator.example",
    subject: "Re: Trip request",
    text: "We can operate those dates.",
    messageId: "m1",
    receivedAt: Date.now(),
  });
  const pending = await t.query(internal.alerting.pending, { owner: "advisor" });
  expect(pending.items).toHaveLength(1);
  expect(pending.items[0]).toMatchObject({ kind: "reply", operatorName: "hello@operator.example" });

  await t.mutation(internal.alerting.markAnnounced, { ids: [pending.items[0].id] });
  // A duplicate delivery never becomes a second announcement.
  await t.mutation(internal.replies.record, {
    inboxId: "inbox-1",
    threadId: "thread-one",
    fromEmail: "hello@operator.example",
    subject: "Re: Trip request",
    text: "We can operate those dates.",
    messageId: "m1",
    receivedAt: Date.now(),
  });
  expect((await t.query(internal.alerting.pending, { owner: "advisor" })).items).toEqual([]);
});

test("mail from a stranger is not announced: it is already visible, and it is not an answer", async () => {
  const { t } = await world();
  await t.run(async (ctx) =>
    ctx.db.insert("mailboxes", {
      owner: "advisor",
      inboxId: "inbox-1",
      address: "workspace@mail.example",
      displayName: "TripBrief - advisor",
      lastUsedAt: Date.now(),
      createdAt: Date.now(),
    }),
  );
  await t.mutation(internal.replies.record, {
    inboxId: "inbox-1",
    fromEmail: "stranger@elsewhere.example",
    subject: "Interested",
    text: "We would like to quote.",
    messageId: "m2",
    receivedAt: Date.now(),
  });
  expect(await t.query(api.replies.unfiled, {})).toHaveLength(1);
  expect((await t.query(internal.alerting.pending, { owner: "advisor" })).items).toEqual([]);
});

test("the sweep finds the workspaces with something waiting", async () => {
  const { t } = await world();
  expect(await t.query(internal.alerting.ownersWithPending, {})).toEqual([]);
  await t.mutation(api.proposals.submitByToken, { token: token("a"), proposal });
  expect(await t.query(internal.alerting.ownersWithPending, {})).toEqual(["advisor"]);
});

test("a workspace that may not send is never told, and its arrivals stay pending", async () => {
  const { t } = await world();
  await t.mutation(api.proposals.submitByToken, { token: token("a"), proposal });
  // A trial workspace has no address to tell and no mailbox to send from, so the
  // announcement stops before it touches the provider.
  expect(await t.action(internal.alerting.sweep, { owner: "advisor" })).toBeNull();
  expect((await t.query(internal.alerting.pending, { owner: "advisor" })).items).toHaveLength(1);
});
