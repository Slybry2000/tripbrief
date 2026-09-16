# Hackathon log

- **Project:** TripBrief — Incoming Operator Finder
- **Event:** Convex All Gas Hackathon
- **What it does:** Turns a group-travel request into a capability-ranked shortlist of incoming tour operators, sends each one its own private request, and compares the trips they would actually operate — with a human choosing the shortlist and the winner.
- **Live app:** https://hip-minnow-543.convex.site — public, no invitation, serving
  the build described in this log.
- **Repo:** https://github.com/Slybry2000/tripbrief
- **Frontend:** https://hip-minnow-543.convex.site
- **Convex deployment:** https://hip-minnow-543.convex.cloud
- **Components:** @convex-dev/rate-limiter, @convex-dev/static-hosting
- **Convex features:** schema, indexes, queries, mutations, actions, realtime queries, auth HTTP routes, per-workspace ownership, rate-limiter quotas, static hosting of the frontend
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

### 2026-09-16 - the search comes from the brief, and the inbox receives
Three fixes, all of them about the end of the flow:

**The search is the brief's, not the advisor's.** The free-text search box is
gone. `research.searchForBrief` builds its queries from what the intake already
knows — destination, who is travelling, the group's interests and the needs that
have to be met (`convex/searchQueries.ts`) — and the model is asked to sharpen
them when it is available, with the tested rules as the fallback. What was
searched for is shown after the run, so the advisor can see what the brief
decided. Accessibility needs are searched for before a second interest, because
an accessible hotel is the harder constraint.

The provider itself was never broken: `research.checkProvider`, a new ops probe
that never touches the credential, returned HTTP 200 from Firecrawl on this
production deployment. The old form's search box was `required`, so pressing the
button with nothing typed did nothing at all — and there was nothing to type.

**The inbox receives.** `message.received` webhooks from AgentMail now post to
`/incoming/agentmail` (`convex/http.ts`, `convex/replies.ts`), guarded by a
shared secret header; the endpoint answers 403 without it and 200 with it, both
verified against the live deployment. A reply is matched to a brief by the inbox
it landed in and to a supplier by the address the invitation was sent to —
never by anything in the message body. A reply from an address we never invited
is kept on the brief under its own heading rather than guessed at. Duplicate
deliveries are dropped by message id. One account-level webhook covers every
brief's inbox, so a new trip needs no setup.

**The flow is now ordered the way the work happens:** find partners from the
brief, shortlist them, which creates each one's response link, then send from
the brief's own inbox and receive the reply on the same card.

Five new tests cover the queries (including that no search ever carries the
budget), and six cover inbound mail: matching, duplicates, mail for an inbox no
brief owns, an uninvited sender, owner-only reading, and the event reader
ignoring anything that is not a received message. 63 tests, lint and the
production build pass.

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

Open at that point in the day, and **superseded by the pivot below**: the deadline
and the batch standardisation were not built, the client's approve-or-change view
was not built, the brief's inbox sent but did not yet receive, and there was no
demo video, no social post and no submitted entry. The pivot replaced the whole
domain, so the first two items no longer describe this product; the inbox now both
sends and receives, and the video, the post and the submission are still open.

### 2026-09-16 - the pivot: the operator finder becomes the product

The site the hackathon had was a competent generic comparer, and it was the wrong
product. The operator answered a question nobody had asked: it compared supplier
proposals against a numbered requirement list, when the work actually starts one
step earlier, with a client who wants something and an agency that has neither the
destination nor the operator. A separate demo was built to work out that
experience, and the app was rebuilt around it.

**What the app is now.** Eight steps: client needs, destination discovery,
capability-ranked operator matches, choose partners, one bespoke trip request per
operator, operator responses, a comparison of proposed *trips*, and selection with
a workback schedule. The group's own words, a target retail price, a minimum
viable traveller count and an explicit go/no-go checkpoint all survive the whole
way through, which is the part the old app could not express.

**Two sides, one live record.** An operator opens a private link (32 random bytes
in the URL fragment, generated in the advisor's browser) and gets exactly three
things: its own capability record, the request it was sent, and its own proposal.
It maintains its capability record through that same link, and saving it changes
what the matcher sees on the next run. A proposal submitted in a second tab
appears in the advisor's comparison without a refresh. Verified in the browser on
2026-09-16: brief → Bali+Thailand → four ranked operators → three shortlisted →
three links → the operator portal in a second tab → a structured proposal → live
"Proposal received" in the first tab → comparison (92% final fit, $2,150 net,
38.6% margin) → selection and a workback schedule built from that proposal's own
deadlines.

**Every sponsor still does real work, on the new shape.**

- **Firecrawl** now grows the *network* rather than a shortlist: it searches
  published websites for operators serving one destination, keeps the query that
  surfaced each result, and stores each one as a candidate. A candidate becomes an
  operator only when a human adds it, and it starts with an empty capability
  record — so it matches nothing until it fills the intake in.
- **OpenAI** reads an operator's emailed reply and drafts the structured proposal,
  with an exact contiguous quote from the reply behind every claim. A quote that is
  not in the reply voids the entire draft. It returns a review draft and never
  writes; the advisor records the result. It refuses to run without a key.
- **AgentMail** keeps the per-brief inbox and the single-address send path, now
  carrying the trip request and the operator's own link. A reply is matched to a
  brief by the inbox it landed in and to an operator by the address the request was
  sent to, never by anything written in the message. No email has been sent to a
  real supplier.

**Reused, not thrown away.** The Convex ownership model, the capability-token
shape, the per-workspace and app-wide quotas, the inbound-mail webhook with its
shared secret, the exact-source evidence discipline and the static-hosting
arrangement all carried over. What was replaced is the domain: `trips`/`offers`
became `briefs`/`briefOperators`/`proposals`, and the operator network became a
stored, editable set of capability records instead of a hard-coded list.

**Where the numbers come from.** The matching engine is a pure module with the
published baselines pinned by tests: Bali 100, Thailand 98, Costa Rica 90,
Portugal 90, Greece 88, Tuscany 65, and Bali Reset at 92 for the default brief.
The suite is 32 tests — 9 against those baselines and the rest against the
backend's actual behaviour: ownership isolation, a capability link writing only
its own record, the five-operator cap, an already-answered operator not being
droppable, a decision that cannot name another brief's proposal, the cascade
delete, reply matching, duplicate suppression, and the two quota-cheap provider
paths failing closed when they are not configured.

**Honest open items at that point.** The vendor integrations had not all been
exercised against their live providers that day: Firecrawl was verified earlier,
and OpenAI and AgentMail were wired and unit-tested, but no live OpenAI draft and
no live AgentMail send had been performed since the pivot. The deployed
convex.site address and the public repository had not been updated to this build
yet.

### 2026-09-16 - the demo showed the experience; this had to be the app

The port above was faithful and it was not a product. Reviewing it against the
submission gates surfaced the difference, and the same day's work closed it. All
of the following is in the same build:

- **The identity stayed TripBrief.** The demo's copy had carried another
  company's name, and none of it belongs in this repository: 47 references in the
  app, plus the workback owners, the outbound email, the schema comments and the
  document title, were rewritten. Where the copy had named that company as the
  *agency*, it now says "the agency" or "your agency"; where it named a product, it
  says TripBrief. Internal identifiers named after it were renamed too. Nothing in
  the repository now refers to that company, and no client name appears in the
  demo data either.
- **The network became a workspace's own.** It had been global, so two trial
  workspaces shared one operator list. `operators` and `operatorCapability` are now
  owned, indexed by owner and slug, and seeded per workspace on first sign-in. One
  workspace cannot read or change another's operators. The local deployment held
  rows written before the change, so the column was added as optional, the
  unowned rows were cleared, and it was tightened to required — the migration path
  for a populated deployment, exercised against a populated one.
- **An operator no longer depends on a brief to exist.** Before this, an operator
  could only be onboarded by shortlisting it on a brief, and its capability link
  died with the brief. There are now two links: a request link scoped to one brief
  and one operator, and a standing capability link scoped to the network. An
  operator can keep its own record current without any brief existing, and the
  operator portal tells it plainly when no request is waiting.
- **The network page became a management surface.** Operators can be added by hand
  or from a researched page, each one gets a capability intake link it can be sent,
  and an operator that has never quoted can be removed. Removing one that has
  answered a brief is refused, because that record is part of a decision.
- **OpenAI became reachable.** The drafting action existed and nothing in the app
  could call it. The responses step now lists the mail a brief received, matches it
  to the operator it came from, drafts a structured proposal from any reply, shows
  every quote the draft rests on, and refuses to record anything until a person
  corrects and confirms it.
- **The app can be operated, not just demonstrated.** Sign out; delete a brief and
  everything it produced, behind a confirmation; correct a failed send and retry it
  rather than being locked out; a home view that lists the workspace's briefs and
  reopens each one at the step it actually reached.
- **The navigation survives a narrow screen.** The stylesheet the experience was
  ported from hid the header navigation below 1100px and the whole row below 760px,
  which left the workflow rail as the only way to move. The header now wraps and the
  navigation scrolls sideways instead of disappearing. Verified at a 481px viewport.
- **The notice tells the truth about what sends.** It used to promise that no real
  message was involved, which stopped being true the moment the send path worked.
  It now says the shipped network is fictional and that sending is one deliberate
  click on one named operator.

The suite grew from 32 to 35 tests, the new ones covering workspace isolation (two
workspaces, identical seeded slugs, changes on one provably invisible to the other),
both link kinds and their scope, adding by hand and from research, removing an
operator that has never quoted, and refusing to remove one that has.

### 2026-09-16 - a real operator, and two bugs a real send found

Bryan asked for a working operator he could test against, at his own address. That
request exposed a hole and then found two bugs, which is the useful part.

**The hole: the network did not remember how to reach anyone.** An address was
typed per brief and forgotten, so the same operator had to be re-entered for every
request, which is exactly how a wrong address gets sent. `operators` now carries a
contact email: validated before it is stored, editable later, cleared just as
easily, and prefilled into every request for that operator. Sending is still one
click on one named operator.

**The first bug, found by sending.** The inbox display name was built straight from
the brief's name, and the mail provider rejects brackets. A brief called
"Wellness week (October)" could therefore never send anything, and the failure
surfaced as "the service is unavailable" — which is what the code said instead of
what the provider said. Both are fixed: the display name is reduced to the
accepted character set, and a refusal now reports the provider's own reason.

**The second bug, found by clicking the link that arrived.** A capability token is
generated per row, but nothing enforced that two rows could not share one, and two
of my own test rows did. A duplicated token made the lookup throw rather than
resolve, so the link in the email was dead. Shortlisting now refuses a token that
is already in use, and the development rows written before that rule were removed.

**What was actually run, and how.** With the local deployment's real Firecrawl,
OpenAI and AgentMail credentials, a script drove the app's own public API exactly
as a browser does — anonymous sign-in, seed the workspace, add the operator, create
a brief, choose Portugal, shortlist the operator, send the request — and the
request was delivered from a brief's own inbox (`happyspeed982@agentmail.to`) to
`bryan@perseidechocreations.com`. The link inside it was then read back through
`network:forToken` and `briefs:forOperatorToken` to confirm it resolves to that
operator and that brief. That is the first real message this project has sent.

Three ops commands came out of it, because a roster arrives as a list rather than
as clicks: `network:workspaces`, `network:addOperatorForOwner` (same creation path
as the form, and it hands back the operator's intake link), and
`inboxes:checkProvider`, alongside the Firecrawl probe that already existed. A
dead `RESEARCH_TEST_USER_ID` switch from the pre-pivot build was removed from the
local deployment, and the inbox quota was corrected from a hackathon-era
one-per-week to a bounded daily rate, because one inbox per brief is the design and
the plan has to allow it.

The suite is 39 tests across 8 files.

### 2026-09-16 - three inboxes, any number of briefs

The mail design did not fit the plan. One inbox per brief meant the fourth brief
could never send, and the free plan gives three inboxes for the whole account.
Bryan's constraint, and it turned out to be the right one: the design was lazy
rather than wrong-headed.

**The fix is attribution by thread, not by mailbox.** The provider's send response
carries `message_id` and `thread_id`, and a received message carries `thread_id`
back. So sending now records the thread it started, and a reply is filed on the
exact request it answers. The mailbox only says which workspace the mail belongs
to. Two briefs can invite the same operator from the same inbox and both answers
still land in the right place — which is the case that used to make sharing
impossible, and it is now a test.

**A pool, not a fan-out.** A workspace opens one mailbox the first time it sends
and reuses the quietest one it has afterwards. It never opens a second one it does
not need: an account slot is worth more than tidiness, and reuse is what makes a
three-inbox plan sufficient for any number of briefs. The interface says how many
are in use and what happens at the ceiling, and a refusal from the provider is
shown verbatim instead of being hidden behind "service unavailable".

**Nothing is guessed and nothing is dropped.** A reply with no thread (a fresh
message rather than a reply) is placed on the most recent request sent to that
address and marked *matched by address* so a person can check it. A reply from an
address no request ever went to is kept, with no brief attached, and shown on the
home view as mail that could not be filed. A sender address is trivially forgeable,
which is exactly why the thread decides and the address only suggests.

**The migration was done as a migration.** Removing the per-brief inbox columns
from the schema was refused by Convex while documents still carried them, so the
columns were widened back to optional, the existing inboxes were adopted into the
new pool and the fields cleared, and only then were the columns removed. That is
the same path a populated deployment needs; the one-off adoption helper was
deleted once it had run.

**What was verified.** 40 tests, including a workspace with one mailbox and two
briefs inviting the same operator: a reply threaded to the second brief files on
the second brief and leaves the first empty; a reply with no thread files by
address and says so; a reply from a stranger is kept unfiled; a duplicate delivery
is dropped; an unknown mailbox is not guessed at. Against the live local
deployment, the inbound route answered **403 without its secret, 200 `recorded`
with it, and 200 `duplicate` on a repeat delivery**, and the stored row landed with
no brief attached — mail kept rather than binned. The migration ran against real
data: one legacy inbox adopted, one brief cleared, none remaining.

### 2026-09-16 - a public app has to be safe to make public

Working towards deployment surfaced the thing that would have made deploying
careless: the app sends real email from the owner's mail account, and nothing
stopped anyone who opened the URL from doing it. Every visitor could create a
workspace, spend one of three mail inboxes and send from TripBrief's name.

**Accounts exist now.** The password provider was configured from the beginning
and never used — the interface only ever offered the anonymous trial. It now
offers both: email and password to create an account or sign in, and the trial kept
as one click for evaluation. Failure messages say what to do about it ("that
password does not match", "there is no account with that email yet") rather than
repeating the provider's internal names.

**And sending is gated, on the server.** Only an account whose address is on the
deployment's `SEND_ALLOWED_EMAILS` may send; an empty list means nobody can, which
is the right default for a deployment about to be public. A trial workspace is
refused with a message that says what still works — everything except sending —
and an account that is not listed is refused with its own address in the reason,
so the person can tell it is not a password problem. The check lives in the one
action that reaches a real inbox, not in the interface.

**Verified against the live local deployment**, through the app's own public API:
a password account signed up successfully, reported `canSend: true` while listed,
and `canSend: false` with a reason naming its address once removed. The trial and
empty-list branches are covered by tests (44 now, across 9 files). The combination
of an allowed account and a real send was not run again, deliberately: a fresh
workspace would have spent the last of the account's three mail inboxes, and the
send path itself was already proven by the earlier live delivery.

### 2026-09-16 - something arriving has to announce itself

Bryan asked whether a trigger was needed when an operator sends a quote. It was,
and the reason is the shape of the app rather than a missing feature: the
comparison is a live query, so a quote appears the moment it is submitted — but
only while somebody is looking at it. A quote that lands on Thursday evening for a
brief sent on Monday would otherwise wait for someone to happen to open the app.

**What was built.** A quote submitted through an operator's link, and a reply that
arrived by mail and was filed against a brief, both announce themselves by email.
Several arrivals inside one sweep are announced together, so a brief sent to five
operators is one message and not five. The announcement goes from the workspace's
own mailbox to the workspace's own address: no new service, no second channel, and
it is the sponsor that already carries everything else doing one more piece of
real work. It is marked announced only after it actually sends, and a fifteen
minute sweep catches anything a failed attempt missed — so nothing is announced
twice and nothing sits silent. Mail that could not be filed is deliberately not
announced: it is already visible on the home view, and it is not an answer to
anything.

**Verified live.** A quote submitted against a real brief on the local deployment
queued exactly one arrival, with the brief's name, the operator's name and a
readable line — "Alert Check Week — $2,050 net per person, 88% fit". It stayed
pending because that account is not on the send list, which is the correct
behaviour and also why no email was sent for it. That check also caught a small
flaw now fixed: the alert named the operator by its internal slug rather than the
name it was shortlisted under.

54 tests across 11 files, lint, typecheck and the build pass.

### 2026-09-16 - proving the address, and letting a password be recovered

Accounts existed and could not be recovered: forget the password and the workspace
was gone, and nothing proved an account's address was its own. That second point
was not tidiness — the address is what decides whether a workspace may email real
operators, so an unproved address was a way to claim an identity the deployment
trusts.

Both now exist, and both send their code through the mail account the product
already has, so the sponsor that carries everything else carries this too. Sign-up
is gated on the code coming back; the sign-in screen can ask for a reset, take the
code and set a new password.

**Verified live, and the check found three things.**

- Sign-up returned no session until the code was entered, which is the gate
  working.
- The code is a 24-character token, not the six digits the interface was
  promising. The placeholder was corrected to "paste the code from the email" —
  a placeholder that describes the wrong thing is how somebody concludes the mail
  is broken.
- A first attempt failed with "Could not verify code", correctly: the check had
  read the *older* verification code out of the inbox instead of the new reset
  one. That is the failure the check exists to catch, and it now reads only the
  newest reset mail.

With that fixed the reset ran end to end against the live deployment: code
requested, code received, code entered with a new password, signed in, and the
session still correctly refused permission to send because its address is not on
the send list.

**And the two sponsors that had never run against their live APIs now have been.**

- **Firecrawl** returned nine real published operators for Portugal from three
  generated queries, including the queries themselves, which is what the network
  page shows an advisor.
- **OpenAI** produced a structured draft from an operator's emailed reply: the
  dates, the net price, the availability, the experiences included, what the
  operator said it could not provide, and twelve quotes — every one of them
  verbatim from the reply.

That second run also exposed a defect worth recording. The exact-quote guard was
too literal: a real reply failed it on an apostrophe and a dash, so the whole
draft was refused and the feature was unusable against the mail it exists to read.
Quotes are now compared after normalising whitespace and typography, and a quote
that still cannot be found is **dropped and named** rather than voiding a draft
the advisor could otherwise use — the rule from the RFP work: anything
unsupported is dropped and disclosed. If the model produces evidence and none of
it can be found, that is wholesale invention and the draft is refused outright.
The draft review names the dropped fields so the advisor knows exactly what to
check by hand.

57 tests across 12 files, lint, typecheck and the build pass.

### 2026-09-16 - the public build, at last

Everything above was built, tested and verified against the local deployment while
the public address served the build from before the pivot. That gap is closed.

- **The backend and schema are deployed** to `hip-minnow-543`. Deploying this
  schema drops the tables the pre-pivot app used (`trips`, `offers`, `partners`,
  `supplierInvites`, `supplierReplies`) — the new app does not use them, and their
  contents were the old build's fictional demo data. That data is gone; it is worth
  saying plainly rather than discovering it later.
- **The frontend is uploaded** and the address serves it: `200`, and the title is
  the new one.
- **An unauthenticated client is answered properly**: a query returns an empty
  result and the account query returns null, rather than a connection error or a
  stack trace.
- **Sending is switched on for one address**, `SEND_ALLOWED_EMAILS`, so a stranger
  who opens the URL still cannot send mail from the deployment's account.
- **The account-level webhook already pointed at this address**, so the inbound
  half — an operator replying by email and the reply filing itself against the
  right brief — is now live rather than merely wired.
- **The source is published**: `origin/master` is at the commit that built this,
  so the public repository, the build log and the running app finally agree.

Remaining for submission: the demo video (the existing project brief still
describes the pre-pivot product and has never been rendered), the public build post
tagging the four sponsors, and the submission itself.
