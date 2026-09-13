# Hackathon log

- **Project:** TripBrief
- **Event:** Convex All Gas Hackathon
- **What it does:** Turns group-travel requirements and supplier replies into a live, evidence-backed comparison while keeping supplier selection human-controlled.
- **Live app:** https://tripbrief.perseidechocreations.chatgpt.site
- **Repo:** https://github.com/Slybry2000/tripbrief
- **Frontend:** https://tripbrief.perseidechocreations.chatgpt.site
- **Convex deployment:** https://hip-minnow-543.convex.cloud
- **Components:** @convex-dev/rate-limiter
- **Convex features:** schema, indexes, queries, mutations, realtime queries, auth HTTP routes
- **Auth:** Convex Auth
- **AI models:** gpt-4.1-mini
- **Started:** 2026-09-12T07:27:18Z
- **Last updated:** 2026-09-13T20:19:53Z

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
GitHub and deployed the production frontend to a public `chatgpt.site` URL.
