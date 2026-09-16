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

### 2026-09-16 - the review that produced the plan
Backed the work up before touching it — tag `pre-ceo-review-20260916`, branch
`codex/backup-pre-ceo-review-20260916`, and a full working-tree copy outside the
repository — then ran the entry through an approval gate and an independent
review. The gate's verdict on the plan of record was **BLOCKED**, and the review
found three questions the earlier decision sheet had not asked.

What the review changed here, with no product code affected:

- The plan of record now records the seven decisions the operator settled on
  2026-09-16 as settled, instead of listing them as still open.
- Its scope section no longer promises the mature intake and the supplier roster
  unconditionally: that material is private client work, this repository is
  public, and the question of reusing it is now an explicit open decision rather
  than an assumption inside a promise.
- The demo video and the public post are named as required closing steps of this
  phase rather than deferred extras, because the rules require both. See the
  correction above: the operator had not yet accepted a date for them.
- Corrected one stale line in the first 2026-09-16 entry above, which said the
  `convex.site` address returned 404. It did that morning; it has served the
  public frontend since the afternoon.

The review's own gates and open questions are recorded privately, not in this
public log. Nothing here marks anything implemented, measured or accepted: the
email sponsor still neither sends nor receives, the schema still has no deadline,
no batch grading, no client role and no vendor record, and there is still no
demo video, social post or submitted entry.
