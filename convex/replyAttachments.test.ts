/// <reference types="vite/client" />
// An operator's PDF itinerary, pinned end to end: it is fetched from the mail
// provider and kept in storage beside the reply it came on, anything else is
// named with a reason rather than crashed on, only the brief's owner is ever
// handed a link to it, and what a draft reads only from it is never shown as
// checked.
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import rateLimiter from "@convex-dev/rate-limiter/test";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { demoBrief as brief } from "./fixtures.test";
import { readInboundEvent } from "./replies";
import { plan, readAttachments } from "./replyAttachments";
import { validateDraft } from "./proposals";

const modules = import.meta.glob("./**/*.ts");
const token = (letter: string) => letter.repeat(43);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");

async function world() {
  const base = convexTest(schema, modules);
  rateLimiter.register(base);
  const t = base.withIdentity({ subject: "advisor" });
  await t.mutation(api.network.ensureWorkspace, {});
  const owner = (await t.query(api.network.list, {}))[0].operator.owner;
  await t.mutation(internal.mailboxes.record, {
    owner,
    inboxId: "inbox-1",
    address: "workspace@mail.example",
    displayName: "TripBrief - advisor",
  });
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
  await t.run(async (ctx) => {
    const [row] = await ctx.db.query("briefOperators").take(1);
    await ctx.db.patch("briefOperators", row._id, {
      email: "hello@operator.example",
      sentAt: Date.now(),
      status: "sent",
      providerThreadId: "thread-one",
    });
  });
  return { base, t, owner, briefId };
}

const reply = (messageId: string, attachments?: { attachmentId: string; filename: string; contentType: string; size: number }[]) => ({
  inboxId: "inbox-1",
  threadId: "thread-one",
  fromEmail: "hello@operator.example",
  subject: "Re: Trip request",
  text: "We can host 16 guests. Our itinerary and quote are attached.",
  messageId,
  receivedAt: Date.now(),
  ...(attachments ? { attachments } : {}),
});

async function messageFor(t: Awaited<ReturnType<typeof world>>["t"], messageId: string) {
  return await t.run(async (ctx) =>
    (await ctx.db
      .query("inboxMessages")
      .withIndex("by_messageId", (q) => q.eq("messageId", messageId))
      .unique())!._id,
  );
}

async function scheduledCollects(t: Awaited<ReturnType<typeof world>>["t"]) {
  return await t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").take(50)).filter((job) =>
      job.name.includes("replyAttachments"),
    ),
  );
}

test("the webhook's attachment list is read, and a plain reply carries no attachment field at all", () => {
  const withFiles = readInboundEvent({
    event_type: "message.received",
    message: {
      inbox_id: "inbox-1",
      thread_id: "thread-one",
      from: "hello@operator.example",
      message_id: "<m1@operator.example>",
      text: "Attached.",
      attachments: [
        { attachment_id: "att-1", filename: "Itinerary.pdf", content_type: "application/pdf", size: 2048 },
        { attachmentId: "att-2", name: "quote.PDF", contentType: "application/octet-stream", size: "900" },
        { filename: "no id, so nothing to fetch" },
      ],
    },
  });
  expect(withFiles!.attachments).toEqual([
    { attachmentId: "att-1", filename: "Itinerary.pdf", contentType: "application/pdf", size: 2048 },
    { attachmentId: "att-2", filename: "quote.PDF", contentType: "application/octet-stream", size: 900 },
  ]);
  const plain = readInboundEvent({
    event_type: "message.received",
    message: { inbox_id: "inbox-1", from: "a@b.example", message_id: "m2", text: "Hi" },
  });
  expect(Object.keys(plain!)).not.toContain("attachments");
  expect(readAttachments({ attachments: "not a list" })).toEqual([]);
});

test("only PDFs are fetched, within size and count, and every other file is named with its reason", () => {
  const planned = plan(
    [
      { attachmentId: "a", filename: "itinerary.pdf", contentType: "application/pdf", size: 1_000 },
      { attachmentId: "b", filename: "photo.jpg", contentType: "image/jpeg", size: 1_000 },
      { attachmentId: "c", filename: "brochure.pdf", contentType: "application/pdf", size: 40 * 1024 * 1024 },
      { attachmentId: "d", filename: "two.pdf", contentType: "", size: 1_000 },
      { attachmentId: "e", filename: "three.pdf", contentType: "application/pdf", size: 1_000 },
      { attachmentId: "f", filename: "four.pdf", contentType: "application/pdf", size: 1_000 },
    ],
    true,
  );
  expect(planned.map((item) => item.status)).toEqual([
    "pending",
    "skipped",
    "skipped",
    "pending",
    "pending",
    "skipped",
  ]);
  expect(planned[1]).toMatchObject({ reason: expect.stringContaining("Not a PDF") });
  expect(planned[2]).toMatchObject({ reason: expect.stringContaining("10 MB") });
  expect(planned[5]).toMatchObject({ reason: expect.stringContaining("first 3") });
  // Mail nobody on file sent is never fetched from.
  expect(plan([{ attachmentId: "a", filename: "x.pdf", contentType: "application/pdf", size: 10 }], false)[0].status).toBe("skipped");
});

test("a reply with a PDF keeps it in storage, linked to the reply and the brief it answers", async () => {
  vi.stubEnv("AGENTMAIL_API_KEY", "am-test");
  const { t, briefId } = await world();
  const outcome = await t.mutation(
    internal.replies.record,
    reply("<m1@operator.example>", [
      { attachmentId: "att-1", filename: "Itinerary.pdf", contentType: "application/pdf", size: PDF.length },
      { attachmentId: "att-2", filename: "rates.xlsx", contentType: "application/vnd.ms-excel", size: 500 },
    ]),
  );
  expect(outcome).toBe("filed");
  const inboxMessageId = await messageFor(t, "<m1@operator.example>");
  expect(await scheduledCollects(t)).toHaveLength(1);

  // AgentMail's reference shape: JSON with a signed link, then the file.
  const calls: { url: string; auth: string | null }[] = [];
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    calls.push({ url: input, auth: new Headers(init?.headers).get("authorization") });
    if (input.startsWith("https://api.agentmail.to/"))
      return new Response(JSON.stringify({ attachment_id: "att-1", download_url: "https://files.agentmail.example/signed/att-1", size: PDF.length }), {
        headers: { "content-type": "application/json" },
      });
    return new Response(PDF, { headers: { "content-type": "application/pdf" } });
  });
  await t.action(internal.replyAttachments.collect, { inboxMessageId });

  expect(calls[0].url).toBe(
    "https://api.agentmail.to/v0/inboxes/inbox-1/messages/%3Cm1%40operator.example%3E/attachments/att-1",
  );
  expect(calls[0].auth).toBe("Bearer am-test");
  // The signed link is followed without the API key.
  expect(calls[1]).toEqual({ url: "https://files.agentmail.example/signed/att-1", auth: null });

  const listed = await t.query(api.replyAttachments.list, { briefId });
  const byName = new Map(listed.map((item) => [item.filename, item]));
  expect(byName.get("Itinerary.pdf")).toMatchObject({ status: "stored", inboxMessageId, size: PDF.length });
  expect(byName.get("Itinerary.pdf")!.url).toEqual(expect.any(String));
  expect(byName.get("rates.xlsx")).toMatchObject({ status: "skipped", url: null, reason: expect.stringContaining("Not a PDF") });

  const stored = await t.run(async (ctx) => {
    const row = await ctx.db.query("inboxAttachments").withIndex("by_inboxMessageId", (q) => q.eq("inboxMessageId", inboxMessageId)).first();
    const blob = await ctx.storage.get(row!.storageId!);
    return { briefId: row!.briefId, text: await blob!.text() };
  });
  expect(stored.briefId).toBe(briefId);
  expect(stored.text.startsWith("%PDF-")).toBe(true);

  // The reply itself is recorded exactly as a plain one would be.
  expect((await t.query(api.replies.list, { briefId }))[0].text).toContain("itinerary and quote are attached");
});

test("a download that fails, is too large or is not really a PDF is recorded, never crashed on", async () => {
  vi.stubEnv("AGENTMAIL_API_KEY", "am-test");
  const { t, briefId } = await world();
  await t.mutation(
    internal.replies.record,
    reply("m2", [
      { attachmentId: "refused", filename: "a.pdf", contentType: "application/pdf", size: 10 },
      { attachmentId: "huge", filename: "b.pdf", contentType: "application/pdf", size: 10 },
      { attachmentId: "fake", filename: "c.pdf", contentType: "application/pdf", size: 10 },
    ]),
  );
  const inboxMessageId = await messageFor(t, "m2");
  // The file itself this time, the shape AgentMail's guide describes.
  vi.stubGlobal("fetch", async (input: string) => {
    if (input.endsWith("/refused")) return new Response("no", { status: 403 });
    if (input.endsWith("/huge"))
      return new Response(PDF, { headers: { "content-type": "application/pdf", "content-length": String(50 * 1024 * 1024) } });
    return new Response("<html>not a pdf</html>", { headers: { "content-type": "application/pdf" } });
  });
  await t.action(internal.replyAttachments.collect, { inboxMessageId });
  const byName = new Map((await t.query(api.replyAttachments.list, { briefId })).map((item) => [item.filename, item]));
  expect(byName.get("a.pdf")).toMatchObject({ status: "failed", reason: expect.stringContaining("403"), url: null });
  expect(byName.get("b.pdf")).toMatchObject({ status: "skipped", reason: expect.stringContaining("10 MB"), url: null });
  expect(byName.get("c.pdf")).toMatchObject({ status: "skipped", reason: expect.stringContaining("not one"), url: null });
  expect(await t.run(async (ctx) => (await ctx.db.system.query("_storage").take(5)).length)).toBe(0);
});

test("without a mail key nothing is fetched, and the reason says so", async () => {
  const { t, briefId } = await world();
  await t.mutation(internal.replies.record, reply("m3", [{ attachmentId: "a", filename: "a.pdf", contentType: "application/pdf", size: 10 }]));
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  await t.action(internal.replyAttachments.collect, { inboxMessageId: await messageFor(t, "m3") });
  expect(fetchSpy).not.toHaveBeenCalled();
  expect((await t.query(api.replyAttachments.list, { briefId }))[0]).toMatchObject({ status: "failed", reason: expect.stringContaining("not been configured") });
});

test("a reply without attachments behaves exactly as before: no rows, nothing to fetch", async () => {
  const { t, briefId } = await world();
  expect(await t.mutation(internal.replies.record, reply("m4"))).toBe("filed");
  expect(await t.mutation(internal.replies.record, reply("m4b", []))).toBe("filed");
  expect(await t.query(api.replyAttachments.list, { briefId })).toEqual([]);
  expect(await scheduledCollects(t)).toEqual([]);
  expect(await t.run(async (ctx) => (await ctx.db.query("inboxAttachments").take(5)).length)).toBe(0);
});

test("mail that could not be placed on a brief never has its files fetched", async () => {
  const { t } = await world();
  const outcome = await t.mutation(internal.replies.record, {
    ...reply("m5", [{ attachmentId: "a", filename: "a.pdf", contentType: "application/pdf", size: 10 }]),
    threadId: undefined,
    fromEmail: "stranger@elsewhere.example",
  });
  expect(outcome).toBe("recorded");
  const rows = await t.run(async (ctx) => await ctx.db.query("inboxAttachments").take(5));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ status: "skipped", briefId: null });
  expect(await scheduledCollects(t)).toEqual([]);
});

test("a link to a kept PDF is only ever served to the brief's owner", async () => {
  vi.stubEnv("AGENTMAIL_API_KEY", "am-test");
  const { base, t, briefId } = await world();
  await t.mutation(internal.replies.record, reply("m6", [{ attachmentId: "a", filename: "a.pdf", contentType: "application/pdf", size: 10 }]));
  const inboxMessageId = await messageFor(t, "m6");
  vi.stubGlobal("fetch", async () => new Response(PDF, { headers: { "content-type": "application/pdf" } }));
  await t.action(internal.replyAttachments.collect, { inboxMessageId });
  expect((await t.query(api.replyAttachments.list, { briefId }))[0].url).toEqual(expect.any(String));

  await expect(base.query(api.replyAttachments.list, { briefId })).rejects.toThrow("sign in");
  const stranger = base.withIdentity({ subject: "someone-else" });
  await stranger.mutation(api.network.ensureWorkspace, {});
  await expect(stranger.query(api.replyAttachments.list, { briefId })).rejects.toThrow("not found");
  // Nor can a stranger's draft be handed the file.
  expect(await stranger.query(internal.replyAttachments.forDraft, { briefId, inboxMessageId })).toEqual([]);
  expect(await t.query(internal.replyAttachments.forDraft, { briefId, inboxMessageId })).toHaveLength(1);

  // Deleting the brief takes the file out of storage with it.
  await t.mutation(api.briefs.remove, { briefId });
  expect(await t.run(async (ctx) => (await ctx.db.system.query("_storage").take(5)).length)).toBe(0);
});

// The trust rule. The email's words are checked exactly as before; whatever
// could only have come from the PDF is kept, but marked, and never as checked.
const email = "We can host 16 guests. Our full itinerary and prices are in the attached PDF.";
const requirements = [
  { key: "travelerCount", id: "R3", label: "Group size", statement: "16 travellers" },
  { key: "budget", id: "R1", label: "Budget", statement: "A net of $2,625" },
];
const modelRead = {
  draft: {
    programName: "Ubud Quiet Week",
    startDate: "2027-10-15",
    netPricePerPerson: 2380,
    groupSizeAccepted: 16,
    requirementAnswers: [
      { key: "travelerCount", answer: "yes", note: "", quote: "We can host 16 guests." },
      // In the PDF, as far as anyone can tell: not in the email.
      { key: "budget", answer: "yes", note: "", quote: "Net rate USD 2,380 per person, twin share." },
    ],
  },
  evidence: [
    { field: "groupSizeAccepted", quote: "We can host 16 guests." },
    { field: "netPricePerPerson", quote: "Net rate USD 2,380 per person, twin share." },
  ],
  caveats: [],
};

test("body-quoted answers stay verified while PDF-only ones are marked unverified", () => {
  const result = validateDraft(modelRead, email, brief, [{ slug: "bali", name: "Bali" }], {
    requirements,
    documentRead: true,
  });
  const answers = new Map(result.draft.requirementAnswers.map((item) => [item.key, item]));
  expect(answers.get("travelerCount")).toEqual({ key: "travelerCount", answer: "yes", note: "", quote: "We can host 16 guests." });
  expect(answers.get("budget")).toMatchObject({ answer: "yes", unverified: true });
  expect(result.evidence).toEqual([
    { field: "groupSizeAccepted", quote: "We can host 16 guests." },
    { field: "netPricePerPerson", quote: "Net rate USD 2,380 per person, twin share.", unverified: true },
  ]);
  expect(result.draft.groupSizeAccepted).toBe(16);
  expect(result.draft.netPricePerPerson).toBe(2380);
  expect(result.unverifiedFields).toEqual(["netPricePerPerson"]);
  // The email is still quote-checked: the draft does not claim otherwise.
  expect(result.quoteCheck).toBe(true);

  // A figure the PDF quote does not contain is still cleared.
  const invented = validateDraft(
    { ...modelRead, draft: { ...modelRead.draft, netPricePerPerson: 2600 } },
    email,
    brief,
    [{ slug: "bali", name: "Bali" }],
    { requirements, documentRead: true },
  );
  expect(invented.draft.netPricePerPerson).toBe(0);
  expect(invented.unverifiedFields).toEqual([]);

  // Without a PDF, the same draft is judged exactly as it always was.
  const plain = validateDraft(modelRead, email, brief, [{ slug: "bali", name: "Bali" }], { requirements });
  expect(plain.draft.requirementAnswers.map((item) => item.key)).toEqual(["travelerCount"]);
  expect(plain.draft.netPricePerPerson).toBe(0);
  expect(plain.droppedEvidence).toContain("R1 Budget");
  expect("unverifiedFields" in plain).toBe(false);
  expect(plain.evidence.every((item) => !("unverified" in item))).toBe(true);
});

test("the draft reads the kept PDF, and the recorded proposal keeps the unverified marks", async () => {
  vi.stubEnv("AGENTMAIL_API_KEY", "am-test");
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  const { t, briefId } = await world();
  await t.mutation(internal.replies.record, reply("m7", [{ attachmentId: "a", filename: "Itinerary.pdf", contentType: "application/pdf", size: 10 }]));
  const inboxMessageId = await messageFor(t, "m7");
  vi.stubGlobal("fetch", async () => new Response(PDF, { headers: { "content-type": "application/pdf" } }));
  await t.action(internal.replyAttachments.collect, { inboxMessageId });

  let sent: { input: { content: unknown }[] } | null = null;
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    expect(input).toBe("https://api.openai.com/v1/responses");
    sent = JSON.parse(init?.body as string);
    return new Response(JSON.stringify({ output: [{ content: [{ text: JSON.stringify(modelRead) }] }] }));
  });
  const result = await t.action(api.proposals.draftFromReply, {
    briefId,
    sourceText: email,
    destinations: [{ slug: "bali", name: "Bali" }],
    requirements,
    inboxMessageId,
  });
  const content = sent!.input[1].content as { type: string; filename?: string; file_data?: string }[];
  expect(content.find((part) => part.type === "input_file")).toMatchObject({
    filename: "Itinerary.pdf",
    file_data: `data:application/pdf;base64,${btoa(String.fromCharCode(...PDF))}`,
  });
  expect(result.attachmentsRead).toEqual(["Itinerary.pdf"]);
  expect(result.unverifiedFields).toEqual(["netPricePerPerson"]);

  await t.mutation(api.proposals.recordEmailed, {
    briefId,
    operatorSlug: "p1",
    sourceText: email,
    standardised: true,
    unverifiedFields: result.unverifiedFields,
    proposal: {
      ...result.draft,
      availability: "Available",
      basedOnExistingProgram: false,
      basedOnProgramSlug: "",
      cancellationTerms: [],
    },
  });
  const [proposal] = (await t.query(api.briefs.get, { briefId }))!.proposals;
  expect(proposal.unverifiedFields).toEqual(["netPricePerPerson"]);
  const answers = new Map(proposal.requirementAnswers.map((item) => [item.key, item]));
  expect(answers.get("budget")!.unverified).toBe(true);
  expect(answers.get("travelerCount")!.unverified).toBeUndefined();
});

test("a draft of pasted text, with no stored reply, sends no document", async () => {
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  const { t, briefId } = await world();
  let body = "";
  vi.stubGlobal("fetch", async (_input: string, init?: RequestInit) => {
    body = init?.body as string;
    return new Response(JSON.stringify({ output: [{ content: [{ text: JSON.stringify(modelRead) }] }] }));
  });
  const result = await t.action(api.proposals.draftFromReply, {
    briefId,
    sourceText: email,
    destinations: [{ slug: "bali", name: "Bali" }],
    requirements,
  });
  expect(body).not.toContain("input_file");
  expect(result.attachmentsRead).toBeUndefined();
  expect(result.draft.requirementAnswers.map((item) => item.key)).toEqual(["travelerCount"]);
});
