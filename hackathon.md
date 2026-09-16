# Hackathon log

- **Project:** TripBrief
- **Event:** Convex All Gas Hackathon
- **What it does:** Turns group-travel requirements and supplier replies into a live, evidence-backed comparison while keeping supplier selection human-controlled.
- **Live app:** https://hip-minnow-543.convex.site
- **Repo:** https://github.com/Slybry2000/tripbrief
- **Frontend:** https://hip-minnow-543.convex.site
- **Convex deployment:** https://hip-minnow-543.convex.cloud
- **Components:** @convex-dev/rate-limiter, @convex-dev/static-hosting
- **Convex features:** schema, indexes, queries, mutations, realtime queries, auth HTTP routes
- **Auth:** Convex Auth
- **AI models:** gpt-4.1-mini
- **Started:** 2026-09-12T07:27:18Z
- **Last updated:** 2026-09-16

## Log

### 2026-09-12 - f33b224
Created a new standalone React and Convex project with the neutral TripBrief
identity. Established a local Convex deployment, installed the official Convex
agent rules and hackathon logging skill, and documented public-data and submission
boundaries before adding product features (`package.json`, `AGENTS.md`,
`README.md`).

### 2026-09-12 - 9b525dc
Built the local brief-to-comparison workflow with authenticated ownership,
numbered requirements, exact-source offer evidence, and human-controlled selection
(`convex/trips.ts`, `convex/schema.ts`, `src/App.tsx`). Build, lint, and four
backend tests pass. A fictional browser walkthrough verified sign-in, brief creation,
offer capture, and selection. Added Firecrawl search with a live five-result browser
check and owner-only, deduplicated partner shortlists (`convex/research.ts`,
`convex/partners.ts`, `src/PartnerResearch.tsx`). Eight tests and lint pass.
Added transactional per-workspace and app-wide research quotas using the registered
rate-limiter component. Nine tests and lint pass, including burst-limit rejection.
Research remains restricted to an enabled test workspace during integration testing.
Public deployment remains unfinished.

### 2026-09-12 - 9b525dc
Added a review-only OpenAI analysis action that returns structured, exact-source
evidence for every requirement; it cannot select or save an offer (`convex/analysis.ts`).
Added on-demand AgentMail inbox provisioning for each brief without sending email
(`convex/inboxes.ts`). Twelve tests, lint, and the production build pass.

### 2026-09-12 - 7048343
Ran one user-approved fictional OpenAI analysis in the local app. It returned
structured requirement coverage with verbatim evidence from the supplied fictional
offer and made no selection or write. Provisioned a distinct AgentMail inbox for
the same fictional brief; no email was sent. Corrected the response parser to
accept AgentMail's documented non-empty inbox IDs rather than assuming a prefix.
The production build, all twelve tests, and targeted lint for the changed files
pass.

### 2026-09-13 - 1ee5fe1
Linked the local build to the TripBrief Convex project and deployed the schema,
functions, auth, and rate-limiter component to production. Replaced the private
test-user gate with transactional per-user and global quotas for OpenAI and
AgentMail while retaining Firecrawl quotas (`convex/integrationLimits.ts`). All
fourteen tests, lint, and the production build pass. Published the source on
GitHub and deployed the production frontend to a `chatgpt.site` URL. (Corrected
2026-09-16: an unauthenticated request to that URL returns HTTP 401, "Sign in
required", so the frontend is deployed but not yet publicly viewable.)

### 2026-09-13 - fe06fec
Replaced the requester-entered proposal as the primary workflow with a true
two-sided supplier portal. Requesters now create revocable, high-entropy,
single-use response links; suppliers open a no-login page that exposes only the
minimum structured trip scope and submit their own price, proposal, and exact
requirement evidence. Submissions atomically become owner-scoped offers in the
live comparison (`convex/invites.ts`, `src/SupplierPortal.tsx`). Added three
capability and authorization tests; all 17 tests, lint, TypeScript, and the
production build pass.

### 2026-09-13 - 670e596
Completed a fictional production walkthrough across separate requester and
supplier browser tabs. A supplier opened a no-login invitation, submitted its
own proposal, and the requester received the offer and exact evidence through a
live Convex update. Normalized the production Firecrawl credential before adding
it to the outbound request; a follow-up public-app search returned five current
partner results.

### 2026-09-16 - fe12430
Recorded a verified statement of what actually runs, with a source for every
line, before any further work: `.local/ceo-review/REALITY-BRIEF.md` (private,
with the independent re-check in `verification-notes.md`). The load-bearing
findings are corrections to this log's earlier claims, not new features:

- The deployed frontend is **not publicly viewable**. An unauthenticated request
  to `https://tripbrief.perseidechocreations.chatgpt.site/` returns HTTP 401
  ("Sign in required"); `https://hip-minnow-543.convex.site/` returns 404. Every
  browser walkthrough recorded here was performed in a session already signed in
  as the owner, which is why this went unnoticed.
  *(Corrected 2026-09-16: true when written. The `convex.site` address returned
  404 that morning because no frontend was hosted there yet; it was hosting the
  public frontend by the afternoon. See the entries below.)*
- **AgentMail neither sends nor receives.** `convex/inboxes.ts` provisions an
  inbox per brief and `convex/http.ts` registers only auth routes; there is no
  send path, no inbound webhook and no message handling. Firecrawl performs a
  real search and OpenAI performs a real review-only analysis.
- The schema has **no deadline, no batch grading and no client role**, so the
  two-sided supplier-reply workflow described in this log is the built one, and
  the any-format reply workflow is not built.
- The test suite was re-run from a clean checkout of `fe12430`: 8 files, 17
  tests, 0 failures; typecheck and the production build pass.

The current commit is preserved before further work on three paths: tag
`backup/2026-09-16-pre-ceo-review`, branch `codex/backup-pre-ceo-review`, and a
full working-tree copy outside the repository. No demo video, social post or
submission exists yet.

### 2026-09-16 - public frontend on convex.site
Replaced the sign-in-gated frontend address with a public one. The app now
serves its built frontend from the Convex deployment itself via
`@convex-dev/static-hosting`, mounted with app-owned root routing so Convex
Auth's exact `/api/auth` and `/.well-known` routes keep working and the static
files take the root. `npm run deploy` builds the frontend with the production
`VITE_CONVEX_URL`, deploys the backend and uploads the assets in one step
(`convex/convex.config.ts`, `convex/http.ts`, `package.json`).

Verified from an unauthenticated client: `https://hip-minnow-543.convex.site/`
and `/index.html` return 200, a hashed asset returns 200, an unknown deep path
falls back to the app, `/api/auth` routes still resolve, and
`/.well-known/openid-configuration` returns the auth discovery document. A query
against the backend from an unauthenticated caller returns the app's own
"Please sign in to use your workspace." message. All 17 tests, lint and the
production build pass on this change.

### 2026-09-16 - data note
Added a plain-language data note to the public landing page
(`src/App.tsx`, `src/index.css`): fictional information only in this preview;
what is stored (brief, requirements, supplier response text and price, quoted
evidence, the recorded decision); what is not (payment details, identifiers,
health information); who can see it; and that deletion is by request because the
preview has no delete control yet. The note states in its own text that it was
written by the operator, not a lawyer, and is not legal advice. Tests, lint and
the production build pass; the note is confirmed present in the deployed bundle.

### 2026-09-16 - suppliers come from the shortlist, and the inbox sends
Replaced the trip's inert supplier card with a working supplier roster
(`src/App.tsx`, `src/PartnerResearch.tsx`, `convex/invites.ts`,
`convex/outbound.ts`, `convex/inboxes.ts`, `convex/schema.ts`):

- Shortlisting a researched partner now also creates that partner's single-use
  response link (`invites.createFromPartner`), and the Suppliers card can create
  the missing links for a whole shortlist in one action. A supplier is a row on
  a roster rather than a name typed from scratch; adding one by hand is still
  possible for a supplier the search did not find.
- The trip inbox now sends: `outbound.sendInvitation` mails that supplier their
  own link from the brief's own AgentMail inbox, with an idempotency key so a
  retry cannot send twice, and the requirement count and destination in the
  message rather than the client's private brief. The message states that the
  trip inbox is the only sender and that no traveller detail is included.
- Sending is a deliberate click on one named supplier. Nothing is automatic and
  no call can reach more than one address. A failed send records its reason on
  the row instead of failing silently.
- The supplier's email is captured separately from the link, validated, and
  locked once the invitation has been sent.

Six new tests cover the shortlist-to-link path, cross-brief partner refusal,
email validation and locking, and the invitation message's contents; 23 tests,
lint and the production build pass, and the new card is confirmed present in the
deployed bundle. No email has been sent to any real supplier.

### 2026-09-16 - guided intake
Replaced the six-field brief form with a guided intake of six steps: the trip,
the group, what the trip is built around, timing and money, what matters to
them, then a review of everything before it is saved (`src/IntakeForm.tsx`,
`src/intakeOptions.ts`, `convex/schema.ts`, `convex/trips.ts`).

- The group and interest answers become a starting requirement list
  (`suggestRequirements`), which the advisor edits. That is the step that turns
  a vague group brief into questions a supplier can answer one by one.
- The intake shape follows the private group-trip planner built for a client
  earlier in this project: the step structure, chip selection, progress rail,
  and review-before-send. No client branding, client copy or client pricing was
  reused, and this repository stays free of any client name.
- The budget band and currency are collected for the advisor only. They are
  stored on the brief, are not part of the supplier's view (`invites.getByToken`
  selects its own fields), and are deliberately not turned into requirements. A
  test asserts the budget never appears in a generated requirement.
- Every profile field is optional, and the stored chip arrays are bounded and
  de-duplicated by `trips.create`; the schema change is additive on a live
  database, so no migration was needed.

Three new tests cover the suggestion rules and the budget exclusion; 26 tests,
lint and the production build pass, and the deployed bundle contains the new
intake.

### 2026-09-16 - suppliers answer the same way the organizer does
The supplier's response is now a guided form in the same shape as the intake
rather than a grid of coverage dropdowns (`src/SupplierPortal.tsx`,
`convex/invites.ts`, `convex/offerRules.ts`, `convex/schema.ts`,
`convex/trips.ts`):

- Four steps: the quote, how they would run the trip, the requirements, then
  attach and send. A supplier may answer every requirement, some of them, or
  none, and anything left alone is standardised from their own words afterwards.
- **Attachments.** A supplier can attach up to five documents of 20 MB each — a
  quote as a PDF, a sample itinerary, a completed trip. They upload to Convex
  storage through a URL authorised by the same single-use invitation token, and
  the advisor reads them behind their own sign-in: `trips.attachmentUrl` returns
  a short-lived URL for an offer on their own brief and nothing else.
- **One assembled response.** Everything the supplier gives is assembled into a
  single document (`offerRules.assembleResponseText`) so the engine, the advisor
  and the evidence checks all read the same source, and an attachment can never
  drift from the text that was standardised.
- The evidence rule was corrected while building this. The engine still has to
  quote the supplier's document exactly, and the advisor's own import path still
  demands an exact excerpt, but a supplier writing their own answer is the
  source of that answer rather than a fabrication. Without that split, an answer
  echoing itself would have satisfied the old check.
- Offers that have not been standardised now say so in the comparison instead of
  showing a misleading "unknown" against every requirement.

Two further tests cover a prose-and-attachment response with no requirement grid,
and the attachment rules (real upload, five-file cap, open invitation required).
28 tests, lint and the production build pass.

### 2026-09-16 - deleting a brief, and importing an emailed response with a file
Added `trips.remove` and a two-step delete on the brief's own page
(`convex/trips.ts`, `src/App.tsx`, `src/index.css`). One transaction removes the
brief, its offers, its suppliers and their response links, its researched
shortlist, and the files those suppliers attached — calling
`ctx.storage.delete` on each attachment rather than orphaning it. A brief is
always deletable, including one whose decision is already recorded, and the
delete is confined to the signed-in owner: a second account is refused. The
confirmation states what goes and that it cannot be undone, and the data note on
the landing page was corrected, since it previously said there was no delete
control.

The advisor's own import path (`trips.addOffer`) now accepts the same structured
details and attachments as the supplier portal, because an emailed response
usually arrives with the supplier's own document. Its own rules are unchanged:
every requirement answered, each with an exact excerpt from the response.

One new test proves the cascade — offers, suppliers, shortlist and the stored
file are all gone afterwards, and a stranger cannot delete another account's
brief. 29 tests, lint and the production build pass.

### 2026-09-16 - ticket-style travel dates
The intake's two date fields are replaced by an airline-style calendar
(`src/DateRangePicker.tsx`, `src/dateRange.ts`). One click sets the arrival day,
a second click sets the day the trip ends, hovering previews the range before
the second click, and a click before the arrival moves the arrival rather than
producing an impossible range. Days before today cannot be picked, the month
pages forwards and backwards across a year boundary, and the selection reads
back as both dates and a duration ("7 days, 6 nights").

The rules live in a pure module rather than the component: the two-click rule,
the day and night counts computed on the calendar rather than in milliseconds so
a daylight-saving change cannot shift them, and the month grid's padding so the
first of the month lands under the right weekday. Nine new tests cover those,
including a Sunday-start month, a leap-length February and a range that spans a
clock change. 38 tests, lint and the production build pass.

### 2026-09-16 - intake rebuilt on the group-trip form's judgment
The intake now carries the approach from the group-trip intake built and
blind-tested earlier in this project for private client work, with none of that
work's branding, copy or pricing (`src/IntakeForm.tsx`, `src/intakeOptions.ts`,
`convex/schema.ts`, `convex/trips.ts`). Eight steps:

1. **Who brings the travellers** — a fit check before anything is collected. One
   or two travellers are the wrong lane: no requirement list exists for
   suppliers to quote against, so the form stops and collects nothing.
2. **Where and when** — destination, group size, and a ticket-style calendar.
3. **The group** — a short prose answer plus ages, room plan and needs.
4. **A good day** — a prose answer plus interests, pace, setting and how the trip
   should run.
5. **Money and limits** — budget band, currency, what it covers, and the
   guardrails a supplier must avoid.
6. **What matters** — the requirement list, generated from the answers above and
   edited by the advisor.
7. **Assumptions** — everything the advisor left open becomes an explicit
   statement a supplier can price, each with its own Change path, rather than
   another question. Editing any earlier answer withdraws the approval, so a
   supplier never prices an assumption that has since been replaced.
8. **Review and save** — the brief separates three things that are usually mixed
   together: what the advisor confirmed, what is assumed and accepted, and what
   is open before booking and is deliberately not a pricing blocker. It also
   states what every supplier must return.

The guardrails are the other carried-over judgment: anything a supplier must
avoid becomes a requirement in their own list, so it cannot be quietly proposed.
The rules live in a pure module — assumptions, open items, guardrails-as-
requirements, the lane check and the validation that refuses a thin brief — with
eleven tests, including that an assumption is never phrased as a question and
that the budget never leaks into a requirement. 46 tests, lint and the
production build pass.

### 2026-09-16 - the trip names itself
The intake no longer asks for a trip name. Nothing in the question flow asks for
one; the name is generated from the finished answers at the review step, and the
advisor sees it only once everything else is done
(`src/intakeOptions.ts`, `src/IntakeForm.tsx`).

The name is where it goes, who it is for and when: "Northern Portugal ·
community group · Nov 2026", "Kyoto · family group · Dec 2026-Jan 2027". A trip
with no destination yet still names itself ("Open destination · Nov 2026") rather
than saving blank, and at the review step the name is an editable field pre-filled
with the generated one, so accepting it costs nothing and changing it is one
click. Two new tests cover the month and year spans, the lane labels and the
fallbacks. 48 tests, lint and the production build pass.

### 2026-09-16 - checkpoint taken before the day's changes
Backed the build up before anything was altered: a git tag, a branch and a full
working-tree copy outside the repository, with the suite re-run against the
frozen commit (8 files, 17 tests). The backup is a snapshot of the working tree,
not just of the committed code, so the untracked material is covered too. One
caveat recorded at the time: a local copy of the repository contains the ignored
`.env.local`, so a backup archive must never be shared, mailed or uploaded as-is.

The plan for the rest of the day was then checked against what the project
actually had. The operator answered a set of product decisions, and the ones
visible in this log are the public address, the data note, and this entry's
subject: a supplier is a researched partner on a shortlist rather than a name
typed from nothing, and the brief's own inbox sends that supplier their link.

The direction those answers set for the remaining days is recorded here plainly,
so the log matches what is being built: a supplier answers in whatever format
suits them and their reply is standardised against the frozen requirements at a
deadline; the advisor puts one recommendation in front of the client, who
approves it or asks for a change; and no client, supplier or advisor is named
publicly. The submission is anonymous, and the repository keeps this name.

Still open at the end of 2026-09-16: the deadline and the batch standardisation
are not built, the client's approve-or-change view is not built, the brief's inbox
sends but does not yet receive, and there is no demo video, no social post and no
submitted entry.
