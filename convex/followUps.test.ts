/// <reference types="vite/client" />
// Follow-ups, pinned: a request gets one nudge at most, and none once the operator
// has answered; a gap question asks about exactly the must-haves left open;
// nothing is sent until a person approves the exact words, an edit voids that
// approval, and demo mode can only ever reach the stand-in inbox.
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import workflowTest from "@convex-dev/workflow/test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { demoBrief as brief } from "./fixtures.test";
import { findGaps, followUpRoute, gapText, nudgeDelayMs, nudgeText } from "./followUps";
import { requestFromBrief } from "./demoResponder";
import { buildRequirements } from "../src/lib/requirements";
import type { Doc, Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const token = (letter: string) => letter.repeat(43);
const DAY = 24 * 60 * 60 * 1000;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const proposal = {
  programName: "Bali Reset",
  basedOnExistingProgram: false,
  basedOnProgramSlug: "",
  destinationSlug: "bali",
  startDate: "2027-10-15",
  endDate: "2027-10-22",
  nights: 7,
  availability: "Available" as const,
  groupSizeAccepted: 16,
  hotelLevel: "4-star",
  hotelNotes: "",
  transportation: [],
  experiencesIncluded: [],
  requirementsMet: [],
  changesOrAdditions: [],
  cannotProvide: [],
  finalFit: 0,
  netPricePerPerson: 2150,
  currency: "USD",
  pricingAssumptions: "",
  depositPercent: 25,
  depositDueDaysBefore: 90,
  finalHeadcountDaysBefore: 60,
  finalPaymentDaysBefore: 45,
  travelerNamesDaysBefore: 30,
  roomReleaseDaysBefore: 45,
  cancellationTerms: [],
  operatorNotes: "",
};

// Must-haves on the fixture brief: R1 Budget .. R9 Accessibility. This reply
// answers most of them, leaves R6 blank, answers R2 "partly", and puts R7 off.
const answers = [
  { key: "budget", answer: "yes" as const, note: "", quote: "Net price: 2,150 USD per person." },
  { key: "dates", answer: "partly" as const, note: "", quote: "We can start on 18 October, not the 15th." },
  { key: "travelerCount", answer: "yes" as const, note: "", quote: "Sixteen guests is fine." },
  { key: "groupDescription", answer: "yes" as const, note: "", quote: "We host returning groups often." },
  { key: "ages", answer: "yes" as const, note: "", quote: "All ages are covered." },
  { key: "dietaryAndMedical", answer: "yes" as const, note: "", quote: "Gluten-free is TBC with the hotel." },
  { key: "desiredExperiences", answer: "yes" as const, note: "", quote: "Yoga and spa are our core." },
  { key: "accessibilityNeeds", answer: "no" as const, note: "", quote: "One temple has steep stairs we cannot avoid." },
  // A should-have answered partly is not a must-have gap.
  { key: "dayShape", answer: "partly" as const, note: "", quote: "Two early starts." },
];

async function setup() {
  const t = convexTest(schema, modules);
  workflowTest.register(t, "workflow");
  rateLimiterTest.register(t, "rateLimiter");
  // A real account on the send list, because a real send checks it with no
  // session to lean on.
  vi.stubEnv("SEND_ALLOWED_EMAILS", "advisor@agency.example");
  const owner = await t.run(async (ctx) => ctx.db.insert("users", { email: "advisor@agency.example" }));
  const advisor = t.withIdentity({ subject: owner });
  const { briefId } = await advisor.mutation(api.briefs.create, { brief, selectedDestinationSlugs: ["bali"] });
  await advisor.mutation(api.briefs.setShortlist, {
    briefId,
    operators: [{ operatorSlug: "p1", operatorName: "Island Wellbeing Indonesia", capabilityToken: token("a") }],
  });
  const row = (await advisor.query(api.briefs.get, { briefId }))!.shortlist[0];
  return { t, advisor, owner, briefId, rowId: row._id };
}

// A real (non-demo) send, as the outbound path records it.
async function sendReal(t: ReturnType<typeof convexTest>, rowId: Id<"briefOperators">) {
  const owner = (await t.run(async (ctx) => ctx.db.get("briefOperators", rowId)))!.owner;
  const mailboxId = await t.run(async (ctx) =>
    ctx.db.insert("mailboxes", { owner, inboxId: "workspace@agentmail.to", address: "workspace@agentmail.to", displayName: "TripBrief", lastUsedAt: 0, createdAt: 0 }),
  );
  await t.mutation(internal.outbound.markSent, {
    briefOperatorId: rowId,
    email: "bookings@operator.example",
    providerMessageId: "<request-1@agentmail.to>",
    providerThreadId: "thread-1",
    mailboxId,
  });
}

async function withProposal(t: ReturnType<typeof convexTest>, briefId: Id<"briefs">, rowId: Id<"briefOperators">) {
  await t.run(async (ctx) => {
    const owner = (await ctx.db.get("briefOperators", rowId))!.owner;
    const proposalId = await ctx.db.insert("proposals", {
      briefId,
      owner,
      operatorSlug: "p1",
      ...proposal,
      requirementAnswers: answers,
      submittedVia: "email_import",
      submittedAt: Date.now(),
      sourceText: "Our first reply.",
    });
    await ctx.db.patch("briefOperators", rowId, { status: "submitted", proposalId });
  });
}

const followUpsOf = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => ctx.db.query("followUps").collect());

function stubMail() {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify({ message_id: "<follow-up-1@agentmail.to>", thread_id: "thread-1" }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("AGENTMAIL_API_KEY", "test-key");
  return fetchMock;
}

const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string) as { to: string[]; text: string; labels: string[] };

test("the nudge wait is three days unless configured, and nonsense falls back to three", () => {
  expect(nudgeDelayMs(undefined)).toBe(3 * DAY);
  expect(nudgeDelayMs("")).toBe(3 * DAY);
  expect(nudgeDelayMs("five")).toBe(3 * DAY);
  expect(nudgeDelayMs("-1")).toBe(3 * DAY);
  expect(nudgeDelayMs("5")).toBe(5 * DAY);
  expect(nudgeDelayMs("0.5")).toBe(DAY / 2);
  expect(nudgeDelayMs("999")).toBe(60 * DAY);
});

test("a gap question lists exactly the must-haves left unanswered, partly met or put off", () => {
  const requirements = buildRequirements(requestFromBrief({ ...brief, _id: "b" } as unknown as Doc<"briefs">));
  const gaps = findGaps(requirements, answers);
  expect(gaps.map((gap) => `${gap.id} ${gap.label} ${gap.reason}`)).toEqual([
    "R2 Travel window partly",
    "R6 Rooms and occupancy unanswered",
    "R7 Dietary, mobility and medical needs unclear",
  ]);
  // A clear no, a clear yes and a should-have are never asked about again.
  const text = gapText(brief, "Island Wellbeing Indonesia", gaps, "https://example.test/#respond=x");
  expect(text).toContain("R6 Rooms and occupancy: we could not find an answer");
  expect(text).toContain("R2 Travel window: you said you can partly meet this.");
  expect(text).toContain('"We can start on 18 October, not the 15th."');
  expect(text).toContain("3 points");
  for (const absent of ["R1 ", "R3 ", "R8 ", "R9 ", "What a good day looks like"]) expect(text).not.toContain(absent);
  // The client's own details stay behind the private link.
  expect(text).not.toContain("8 twin rooms");
  expect(text).not.toContain("cannot manage stairs");
  expect(findGaps(requirements, requirements.map((item) => ({ key: item.key, answer: "yes" as const, note: "", quote: "Yes." })))).toEqual([]);
});

test("demo mode, or a thread that began in demo mode, can only reach the stand-in inbox", () => {
  const demoOn = { on: true, agencyInbox: "agency@demo.test", operatorInbox: "standin@demo.test" };
  const demoOff = { on: false, agencyInbox: "agency@demo.test", operatorInbox: "standin@demo.test" };
  const real = { sentAt: 1, providerMessageId: "m", email: "bookings@operator.example" };
  expect(followUpRoute(demoOn, real, "workspace@agentmail.to")).toMatchObject({ ok: true, to: "standin@demo.test", inboxId: "agency@demo.test", demo: true });
  // Demo was switched off after this request went to the stand-in: it stays there.
  expect(followUpRoute(demoOff, { ...real, deliveredTo: "standin@demo.test" }, "workspace@agentmail.to")).toMatchObject({ ok: true, to: "standin@demo.test" });
  // Demo on, stand-ins missing: refused, never the real address.
  expect(followUpRoute({ on: true, agencyInbox: "", operatorInbox: "" }, real, "workspace@agentmail.to").ok).toBe(false);
  expect(followUpRoute(demoOff, real, "workspace@agentmail.to")).toMatchObject({ ok: true, to: "bookings@operator.example", demo: false });
  expect(followUpRoute(demoOff, { ...real, providerMessageId: undefined }, "x").ok).toBe(false);
});

test("sending a request starts exactly one timer, and the timer drafts one nudge and sends nothing", async () => {
  vi.useFakeTimers();
  const fetchMock = stubMail();
  const { t, advisor, briefId, rowId } = await setup();
  await sendReal(t, rowId);
  const first = await t.run(async (ctx) => ctx.db.get("briefOperators", rowId));
  expect(first!.nudgeWorkflowId).toBeTruthy();
  expect(first!.nudgeDueAt! - Date.now()).toBeGreaterThan(3 * DAY - 60_000);
  // Recorded as sent a second time: the same timer, not a second one.
  await t.mutation(internal.outbound.markSent, { briefOperatorId: rowId, email: "bookings@operator.example", providerMessageId: "<request-1@agentmail.to>", providerThreadId: "thread-1" });
  const second = await t.run(async (ctx) => ctx.db.get("briefOperators", rowId));
  expect(second!.nudgeWorkflowId).toBe(first!.nudgeWorkflowId);

  // Let the workflow sleep its three days and wake.
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  const drafted = await followUpsOf(t);
  expect(drafted).toHaveLength(1);
  expect(drafted[0]).toMatchObject({ kind: "nudge", status: "draft" });
  expect(drafted[0].text).toContain("A short follow-up on our request for Wellness Escape");
  expect(fetchMock).not.toHaveBeenCalled();

  // The step run again (a retry, a second timer) still leaves one nudge.
  expect(await t.mutation(internal.followUps.draftNudgeIfSilent, { briefOperatorId: rowId })).toBe("exists");
  expect(await followUpsOf(t)).toHaveLength(1);
  const view = await advisor.query(api.followUps.forBrief, { briefId });
  expect(view[0].nudge).toMatchObject({ kind: "nudge", status: "draft", approved: false });
});

test("a reply before the timer wakes means the workflow ends without drafting anything", async () => {
  vi.useFakeTimers();
  stubMail();
  const { t, briefId, rowId } = await setup();
  await sendReal(t, rowId);
  await t.run(async (ctx) => {
    await ctx.db.insert("inboxMessages", { briefId, owner: (await ctx.db.get("briefOperators", rowId))!.owner, briefOperatorId: rowId, operatorSlug: "p1", inboxId: "workspace@agentmail.to", threadId: "thread-1", matchedBy: "thread", fromEmail: "bookings@operator.example", subject: "Re: Trip request", text: "We are working on it.", messageId: "<reply-1>", receivedAt: Date.now() });
  });
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect(await followUpsOf(t)).toHaveLength(0);
  expect(await t.mutation(internal.followUps.draftNudgeIfSilent, { briefOperatorId: rowId })).toBe("replied");
  expect(await followUpsOf(t)).toHaveLength(0);
});

test("a nudge approved after the operator replied is not sent", async () => {
  const fetchMock = stubMail();
  const { t, advisor, briefId, rowId } = await setup();
  await sendReal(t, rowId);
  expect(await t.mutation(internal.followUps.draftNudgeIfSilent, { briefOperatorId: rowId })).toBe("drafted");
  const [nudge] = await followUpsOf(t);
  await advisor.mutation(api.followUps.approve, { followUpId: nudge._id, text: nudge.text });
  // The reply lands between the click and the send.
  await t.run(async (ctx) => {
    await ctx.db.insert("inboxMessages", { briefId, owner: (await ctx.db.get("briefOperators", rowId))!.owner, briefOperatorId: rowId, operatorSlug: "p1", inboxId: "workspace@agentmail.to", matchedBy: "thread", fromEmail: "bookings@operator.example", subject: "Re", text: "Here it is.", messageId: "<reply-2>", receivedAt: Date.now() });
  });
  await t.finishAllScheduledFunctions(() => {});
  expect(fetchMock).not.toHaveBeenCalled();
  expect((await followUpsOf(t))[0].status).toBe("cancelled");
});

test("nothing is sent without approval of the exact text, and an edit after approval voids it", async () => {
  const fetchMock = stubMail();
  const { t, advisor, briefId, rowId } = await setup();
  await sendReal(t, rowId);
  await withProposal(t, briefId, rowId);
  const followUpId = await advisor.mutation(api.followUps.draftGapFollowUp, { briefOperatorId: rowId });
  await t.finishAllScheduledFunctions(() => {});
  expect(fetchMock).not.toHaveBeenCalled();
  const [draft] = await followUpsOf(t);
  expect(draft.requirementKeys).toEqual(["dates", "rooms", "dietaryAndMedical"]);

  // Approving words that are not the draft on file is refused.
  await expect(advisor.mutation(api.followUps.approve, { followUpId, text: `${draft.text} extra` })).rejects.toThrow("changed since you read it");

  // Approved, then edited before the send runs: the send finds no approval.
  await advisor.mutation(api.followUps.approve, { followUpId, text: draft.text });
  const edited = `${draft.text}\n\nP.S. Singles matter most.`;
  await advisor.mutation(api.followUps.edit, { followUpId, text: edited });
  const afterEdit = (await followUpsOf(t))[0];
  expect(afterEdit.status).toBe("draft");
  expect(afterEdit.approvedText).toBeUndefined();
  await t.finishAllScheduledFunctions(() => {});
  expect(fetchMock).not.toHaveBeenCalled();
  expect((await advisor.query(api.followUps.forBrief, { briefId }))[0].gapFollowUp!.approved).toBe(false);

  // Approved as edited: sent once, in the thread, to the operator, word for word.
  await advisor.mutation(api.followUps.approve, { followUpId, text: edited });
  await t.finishAllScheduledFunctions(() => {});
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url] = fetchMock.mock.calls[0];
  expect(url).toBe("https://api.agentmail.to/v0/inboxes/workspace%40agentmail.to/messages/%3Crequest-1%40agentmail.to%3E/reply");
  expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ to: ["bookings@operator.example"], text: edited, labels: ["follow-up"] });
  const sent = (await followUpsOf(t))[0];
  expect(sent).toMatchObject({ status: "sent", deliveredTo: "bookings@operator.example", providerThreadId: "thread-1" });
  await expect(advisor.mutation(api.followUps.edit, { followUpId, text: "changed" })).rejects.toThrow("can no longer be changed");
});

test("a real send from an account that is not on the send list sends nothing", async () => {
  const fetchMock = stubMail();
  const { t, advisor, briefId, rowId } = await setup();
  vi.stubEnv("SEND_ALLOWED_EMAILS", "");
  await sendReal(t, rowId);
  await withProposal(t, briefId, rowId);
  const followUpId = await advisor.mutation(api.followUps.draftGapFollowUp, { briefOperatorId: rowId });
  const [draft] = await followUpsOf(t);
  await advisor.mutation(api.followUps.approve, { followUpId, text: draft.text });
  await t.finishAllScheduledFunctions(() => {});
  expect(fetchMock).not.toHaveBeenCalled();
  const failed = (await followUpsOf(t))[0];
  expect(failed.status).toBe("failed");
  expect(failed.approvedText).toBeUndefined();
});

test("one gap question per operator per brief, and its answer is read like any other reply", async () => {
  const fetchMock = stubMail();
  const { t, advisor, briefId, rowId } = await setup();
  await sendReal(t, rowId);
  await withProposal(t, briefId, rowId);
  const first = await advisor.mutation(api.followUps.draftGapFollowUp, { briefOperatorId: rowId });
  expect(await advisor.mutation(api.followUps.draftGapFollowUp, { briefOperatorId: rowId })).toBe(first);
  const [draft] = await followUpsOf(t);
  await advisor.mutation(api.followUps.approve, { followUpId: first, text: draft.text });
  await t.finishAllScheduledFunctions(() => {});
  expect(await advisor.mutation(api.followUps.draftGapFollowUp, { briefOperatorId: rowId })).toBe(first);
  expect(await followUpsOf(t)).toHaveLength(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);

  // The operator answers in the thread; the webhook files it on the request.
  const outcome = await t.mutation(internal.replies.record, { inboxId: "workspace@agentmail.to", threadId: "thread-1", fromEmail: "bookings@operator.example", subject: "Re: Trip request", text: "R6: 8 twins and 2 singles are held.", messageId: "<answer-1>", receivedAt: Date.now() + 1000 });
  expect(outcome).toBe("filed");
  // Filing announces the arrival to the advisor; let that finish inside this test.
  await t.finishAllScheduledFunctions(() => {});
  const view = (await advisor.query(api.followUps.forBrief, { briefId }))[0];
  expect(view.answer!.source).toBe("Our first reply.\n\nR6: 8 twins and 2 singles are held.");
  // Another workspace sees none of it.
  await expect(t.withIdentity({ subject: "stranger" }).query(api.followUps.forBrief, { briefId })).rejects.toThrow("Brief not found");
});

test("in demo mode a follow-up goes to the stand-in inbox, never to the operator's address", async () => {
  vi.stubEnv("DEMO_MODE", "on");
  vi.stubEnv("DEMO_AGENCY_INBOX", "agency@demo.test");
  vi.stubEnv("DEMO_OPERATOR_INBOX", "standin@demo.test");
  const fetchMock = stubMail();
  const { t, advisor, briefId, rowId } = await setup();
  // As sendDemo records it: the real address is shown, the stand-in received it.
  await t.mutation(internal.outbound.markSent, { briefOperatorId: rowId, email: "bookings@operator.example", deliveredTo: "standin@demo.test", providerMessageId: "<demo-request@agentmail.to>", providerThreadId: "demo-thread" });
  await withProposal(t, briefId, rowId);
  const followUpId = await advisor.mutation(api.followUps.draftGapFollowUp, { briefOperatorId: rowId });
  const [draft] = await followUpsOf(t);
  await advisor.mutation(api.followUps.approve, { followUpId, text: draft.text });
  await t.finishAllScheduledFunctions(() => {});
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url] = fetchMock.mock.calls[0];
  expect(url).toContain("/inboxes/agency%40demo.test/messages/");
  const body = bodyOf(fetchMock.mock.calls[0]);
  expect(body.to).toEqual(["standin@demo.test"]);
  expect(body.labels).toContain("demo");
  expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("bookings@operator.example");
  expect((await followUpsOf(t))[0].deliveredTo).toBe("standin@demo.test");
});

test("the nudge is courteous, names the request and offers a way to say no", () => {
  const text = nudgeText(brief, "Island Wellbeing Indonesia", Date.UTC(2027, 5, 1), "https://example.test/#respond=x");
  expect(text).toContain("Hello Island Wellbeing Indonesia,");
  expect(text).toContain("which we sent on 1 June 2027");
  expect(text).toContain("https://example.test/#respond=x");
  expect(text).toContain("a one-line reply saying so is just as helpful");
});
