// Writes proof/end-to-end.json: a record of one real run on the production
// deployment, read back out of the database rather than written by hand, so
// every claim in it can be checked against the live system.
//
//   node scripts/make-proof.mjs
//
// It deliberately leaves out anything that grants access or names a person:
// capability tokens (they are the operators' private links), account ids, and
// sign-in data are never read into the record.
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const DEPLOYMENT = "https://hip-minnow-543.convex.cloud";
const SITE = "https://hip-minnow-543.convex.site";

const rows = (table, limit = 500) =>
  execSync(`npx convex data ${table} --prod --limit ${limit} --format jsonLines`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));

const briefs = rows("briefs");
const sent = rows("briefOperators");
const proposals = rows("proposals");
const inbox = rows("inboxMessages");
const webOperators = rows("webOperators");
const places = rows("placeProfiles");

// The run on record is the most recent brief that went all the way: at least
// three operators sent a request and every one of them has a proposal.
const complete = briefs
  .map((brief) => ({ brief, rows: sent.filter((row) => row.briefId === brief._id) }))
  .filter(({ rows }) => rows.length >= 3 && rows.every((row) => row.sentAt && row.proposalId))
  .sort((a, b) => b.brief._creationTime - a.brief._creationTime);
if (!complete.length) throw new Error("No complete run found in production.");
const { brief, rows: briefRows } = complete[0];

const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
const byId = new Map(proposals.map((row) => [row._id, row]));

const operators = briefRows
  .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
  .map((row) => {
    const proposal = byId.get(row.proposalId);
    const reply = inbox.find((message) => message.briefOperatorId === row._id);
    const web = webOperators.find((item) => row.operatorSlug === `web-${item.domain.replace(/\./g, "-")}`);
    const answers = proposal?.requirementAnswers ?? [];
    return {
      operator: row.operatorName,
      website: web?.website ?? null,
      publishedAddress: row.email,
      addressFoundOnItsOwnSite: web ? web.email === row.email : null,
      requestSentAt: iso(row.sentAt),
      requestDeliveredTo: row.deliveredTo,
      agentMailThreadId: row.providerThreadId ?? null,
      outboundMessageId: row.providerMessageId ?? null,
      replyReceivedAt: iso(reply?.receivedAt),
      replyMatchedBy: reply?.matchedBy ?? null,
      replySimulated: Boolean(proposal?.simulated),
      netPricePerPerson: proposal?.netPricePerPerson ?? null,
      requirementsAnswered: answers.length,
      answersWithAVerbatimQuote: answers.filter((answer) => answer.quote).length,
      answerTally: {
        yes: answers.filter((answer) => answer.answer === "yes").length,
        partly: answers.filter((answer) => answer.answer === "partly").length,
        no: answers.filter((answer) => answer.answer === "no").length,
      },
      oneQuotedAnswer: answers.find((answer) => answer.quote && answer.answer !== "yes") ??
        answers.find((answer) => answer.quote) ?? null,
    };
  });

const researched = places
  .filter((place) => place.sources?.length)
  .sort((a, b) => b._creationTime - a._creationTime)[0];

const record = {
  generatedAt: new Date().toISOString(),
  howThisWasMade: "Read out of the production Convex deployment by scripts/make-proof.mjs. Nothing here is typed by hand.",
  deployment: DEPLOYMENT,
  liveApp: SITE,
  demoMode: {
    on: true,
    whatItMeans:
      "Requests are really sent through AgentMail, but to a stand-in inbox the project owns, never to the operator. The operator's reply is then written by OpenAI in the operator's voice and read back through the same pipeline a real reply uses. The operators, their websites and their published addresses are real.",
  },
  totals: {
    briefs: briefs.length,
    requestsSent: sent.filter((row) => row.sentAt).length,
    proposalsRecorded: proposals.length,
    repliesReceived: inbox.length,
    operatorsFoundOnTheWeb: webOperators.length,
    operatorsWithAPublishedAddress: webOperators.filter((item) => item.email).length,
    countriesResearched: places.length,
  },
  firecrawlAndOpenAI_placeResearch: researched
    ? {
        place: researched.name ?? researched.country,
        sources: researched.sources.map((source) => source.url ?? source).slice(0, 6),
      }
    : null,
  run: {
    brief: brief.brief?.name ?? brief.name ?? "(unnamed brief)",
    createdAt: iso(brief._creationTime),
    operators,
  },
};

mkdirSync("proof", { recursive: true });
writeFileSync("proof/end-to-end.json", JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify({
  brief: record.run.brief,
  operators: operators.map((item) => `${item.operator}: ${item.answersWithAVerbatimQuote} quoted answers, thread ${item.agentMailThreadId ? "yes" : "no"}`),
  totals: record.totals,
}, null, 2));
