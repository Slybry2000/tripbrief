# PRD - The Structured Mirror, Web Edition (Convex All Gas Hackathon entry)

> **PARKED 2026-09-16 by Bryan's decision (GATE-06 A).** This entry is the travel app; this document is
> parked, unedited, until after the Convex All Gas Hackathon deadline of 2026-09-22 12:00 PM PT. Its
> Section 0 prediction — that it reverses the 2026-09-14 recommendation to finish the existing entry — is
> what happened, and Bryan chose the existing entry. Nothing here is approved, built or scheduled. Do not
> act on this document without a new decision.

- **Status:** Draft for owner review - not approved, nothing built, nothing published
- **Owner:** Bryan
- **Date:** 2026-09-15
- **Event:** Convex All Gas Hackathon (sponsored by OpenAI, Firecrawl, AgentMail)
- **Hard deadline:** Tuesday 2026-09-22, 12:00 PM PT (submission + live URL + demo video + public repo)
- **Working name:** Mirror Web (repo `structured-mirror-web`); the public-facing name is an open decision
- **Source product:** The Structured Mirror (Flutter, `C:\Projects\The Structured Mirror`), Phase 1 / Stage A

---

## 0. How to read this

Two things in the request are read as follows, and are worth confirming in one line:

1. **"Convert the structured mirror for this one"** = the Convex hackathon entry becomes a
   Convex-hosted **web version of The Structured Mirror**, built as new code, not a port of the
   Flutter app.
2. **"Start with a PRD"** = this document. Nothing is built, deployed, or published until it is
   approved.

This also **reverses yesterday's recommendation**. The 2026-09-14 portfolio review advised finishing
the existing TripBrief entry and *not* starting a competing near-term build. That advice is on record;
this PRD deliberately goes the other way, and Section 12 explains what makes that acceptable.

---

## 1. Why this is worth doing

TripBrief (already public and live) is a competent entry, but it is a business workflow: a travel
advisor compares supplier proposals. The judging criteria lead with *"Everyday apps, not developer
tools... something a real person would use this week."*

The Structured Mirror is the opposite kind of object. It is a daily-life app about a person's own
relationship, it has a fully-specified questionnaire, and it carries a trust architecture that is
genuinely unusual. Its own weaknesses are what a hackathon project can now fix:

| Structured Mirror as of today | Why the hackathon changes the answer |
|---|---|
| Native Flutter app, store submission blocked on accounts, fees, QA walk, privacy policy | A web app ships today, at a public URL, with no store gate |
| Fully local: no accounts, no sync, no reminders, no multi-device | Convex supplies accounts, sync, scheduling, and realtime - the missing half |
| Brand promise is "we cannot read your words" | A web build can *demonstrate* that claim live (network tab, in the demo) |

The hackathon supplies the deadline, three sponsor services that must do real work, and a public
showcase. The Mirror supplies a product worth showing.

---

## 2. One-sentence pitch

**A weekly reflection app for one relationship. You answer twenty short scale questions and can write
privately; your numbers sync so you can see your own pattern over months; your words never leave your
device, and no model ever reads anything you wrote.**

---

## 3. Who it is for and what job it does

- **User:** one adult reflecting on one relationship (partner, spouse, close family, a relationship
  they are deciding about). Not a couple's tool - one person, one private mirror.
- **Job:** "Once a week, give me a structured way to notice what my own experience has been, without
  anything or anyone telling me what it means."
- **Why weekly, not daily:** the product's philosophy is that constant reflection becomes reactivity.
  Cadence is a feature, not a restriction. Weekly default, bi-weekly optional, 72-hour open window.

---

## 4. The trust line (non-negotiable, and the product's main asset)

The existing locked governance documents say the narrative never leaves the device, no model analyzes
journal content, and there is no scoring, ranking, advice, or prediction. **This PRD keeps every one of
those promises for the web app**, and adds one line the web version can finally prove out loud:

> **We hold your numbers. We never hold your words, and nothing you write is ever read by a model.**

Concretely, for the web app:

| Data | Where it lives | Server can read it? | Model can see it? |
|---|---|---|---|
| Written reflections | Browser only, encrypted at rest with a user passphrase (WebCrypto, AES-GCM) | No - never uploaded | No |
| Numeric weekly answers | Convex | Yes | **No** |
| Session metadata (opened / completed / source) | Convex | Yes | No |
| Cadence, timezone, pause state | Convex | Yes | No |
| Prompt library text and its sources | Convex (public data) | Yes | Yes - this is public text, not user text |
| Encrypted backup file (optional) | Convex file storage + the user's own inbox, as an opaque blob | No - ciphertext only | No |

This is the line that makes a privacy-constrained app still able to satisfy the sponsor requirement,
because each sponsor does real work on **public sources, delivery, and structure** - never on the
user's own writing.

---

## 5. What each sponsor actually does in the product

Judges dock entries where sponsors "sit in the README." Each of these is a visible product surface with
an acceptance test.

| Sponsor | Role in Mirror Web | Acceptance test (must pass before submission) |
|---|---|---|
| **Convex** | Accounts, mirrors, weekly windows, numeric answer series, realtime multi-device timeline, scheduled reminder jobs, capability resume links, rate limits | Two browser tabs update live from one submission; a second user cannot read the first user's mirror |
| **Firecrawl** | Builds the **prompt library**: crawls public, non-clinical reflection and communication sources, stores verbatim prompt text with source URL, title, and retrieval date | The library shows at least 3 real crawled sources with working outbound links; no invented sources |
| **OpenAI** | Turns crawled source text into neutral, non-advice prompt phrasing tagged to the five constructs, and acts as a self-review filter that rejects any phrasing containing advice, judgment, diagnosis, scoring, or prediction | Every published prompt has a source citation; the filter demonstrably rejects advice-style text (unit test with hostile examples) |
| **AgentMail** | Gives each mirror a private inbox that (a) sends a **zero-content** weekly reminder, (b) accepts control replies - "pause", "weekly", "biweekly", "stop" - which update cadence live, and (c) can receive the user's own encrypted backup file as an opaque attachment | A real reminder email lands; a real reply changes cadence in the app; the reminder body contains no user data (asserted in a test) |

**Not allowed anywhere:** sending user narrative through an email, model, or server. The reminder email
is a link and a date. Nothing else.

---

## 6. Scope

### 6.1 Must ship (the demo cannot work without these)

1. **Auth + mirror creation** - Convex Auth (password provider, anonymous trial), one or more mirrors.
2. **Cadence + window** - weekly default, bi-weekly option, 72-hour open window, timezone-aware.
3. **The weekly check-in** - locked questionnaire v1: 20 statements, 5 constructs x 4, 1-5 scale,
   no scoring displayed, no totals, no comparisons.
4. **Live timeline** - the user's own numeric answers over time, per construct, descriptive only.
   Visible updating in a second tab.
5. **Prompt library** - Firecrawl-sourced, OpenAI-neutralized, cited, reviewed before publishing.
6. **AgentMail reminder + control replies** - real sends, real inbound routing, cadence updates.
7. **Trust copy v1.2** - the web edition's own version of the first-run acknowledgment, journal
   header, backup warning, and quick-delete explanation (Section 9).
8. **Public deployment** - `convex.site` or `chatgpt.site` URL, public repo, `hackathon.md` build log,
   demo video under 3 minutes, social post.

### 6.2 Should ship (real value, do after the demo path is green)

9. **Local encrypted private note** - the notebook, encrypted in the browser, with a visible "private -
   stored only on this browser" treatment and a live proof in the demo (DevTools network tab).
10. **Encrypted backup by email** - export the encrypted blob, mail it to the user's own mirror inbox
    as an opaque attachment, restore from it. Demonstrates "your exit is always free."
11. **Quick-delete** - one tap, irreversible, deletes narrative and (separately, with its own warning)
    the numeric series.

### 6.3 Won't ship (say so plainly in the README)

- No AI reading, summarizing, scoring, or interpreting anything the user wrote or answered.
- No couples/partner linking, no sharing, no therapist dashboard.
- No subscriptions, no paid tier, no engagement mechanics, no streaks, no notifications beyond the
  weekly window.
- No diagnosis, risk detection, advice, or "compatibility" claims.
- No medical/mental-health claims of any kind.

---

## 7. Convex design sketch

Read `convex/_generated/ai/guidelines.md` before writing any of this - it overrides general knowledge of
the API. Reuse the patterns already proven in the TripBrief repo (`convex/auth.ts`,
`convex/invites.ts` capability tokens, `convex/integrationLimits.ts` quotas, `convex/http.ts` routes).

**Tables**

| Table | Purpose | Key indexes |
|---|---|---|
| `authTables` | Users, sessions | from `@convex-dev/auth/server` |
| `mirrors` | One reflection context: label, cadence days, timezone, pausedUntil, nextWindowAt, status | `by_owner`, `by_nextWindowAt` |
| `checkins` | One completed weekly period: `answers: {questionId, value}[]`, periodStart, submittedAt | `by_mirror_period`, `by_owner` |
| `sessionsMeta` | Window opened / completed, source (`web` or `email_link`) | `by_mirror` |
| `resumeTokens` | High-entropy, single-use, expiring capability links for email entry | `by_token` |
| `inboxes` | AgentMail address per mirror | `by_mirror` |
| `deliveries` | Every outbound/inbound message: kind, address, provider id, status, timestamps | `by_mirror`, `by_providerId` |
| `promptSources` | Crawled source: url, title, retrievedAt, verbatimExcerpt | `by_url` |
| `prompts` | Generated prompt: text, construct, sourceId, status (`pending`/`approved`/`rejected`), rejectReason | `by_status_construct` |
| `blobs` | Optional encrypted backup files (opaque) | `by_mirror` |

**Functions**

- Queries: `getMyMirror`, `listCheckins`, `getTimeline` (per-construct series, descriptive only),
  `listApprovedPrompts`, `getWindowState`.
- Mutations: `createMirror`, `setCadence`, `pauseMirror`, `openWindow`, `submitCheckin`,
  `rotateResumeToken`, `deleteMyNarrative`.
- Actions: `researchPromptSources` (Firecrawl), `draftPrompt` (OpenAI + rejection filter).
- HTTP routes: AgentMail inbound webhook (control replies only), resume-link resolution.
- Crons: daily window-opening pass; reminder dispatch through AgentMail; delivery retry/cleanup.
- Components: rate limiter (per-user email sends per day, per-user Firecrawl/OpenAI quotas).

**Guardrails to encode, not just document**

- `submitCheckin` rejects any field other than the 20 known question ids and 1-5 integers.
- The reminder body is built from a template with no interpolated user content, and a test asserts the
  template has no user-data slots.
- No query returns narrative; there is no narrative table to return from.
- Every function derives identity from `getAuthUserId`; no function accepts an owner id argument.

---

## 8. Governance: what this needs from the owner

The native app has frozen documents (`docs/governance/execution-lock.md`) requiring product-lead
approval, legal review, a version bump, and a user communication plan before any change. Three locked
items touch this plan:

| Locked item | Conflict with a Convex web build | Proposed handling |
|---|---|---|
| Narrative content never leaves device | No conflict - web edition keeps words in the browser, encrypted | Keep, and prove it in the demo |
| No accounts / no server (Stage A as shipped, trust copy v1.1) | Direct conflict: accounts, sync, reminders, scheduling | **Web edition gets its own charter**; the locked native documents stay frozen and unedited |
| No AI, insights, scoring, comparisons | Partial conflict: OpenAI drafts and filters *prompt text from public sources*, and never sees user data | Web charter allows prompt-generation from public sources only; scope it narrowly and write it down |

**Recommended path:** do not edit a single locked native document. Give Mirror Web its own short charter
(`docs/governance/mirror-web-charter.md` in the new repo) that inherits the trust promises verbatim and
describes the three permitted sponsor roles above. The native app's Phase 1 lock stays exactly as it is,
so the Shipaton/store path is untouched.

**Legal review still applies** before anything is public: a relationship-reflection app with a "not
therapy" disclaimer, plus email delivery of a user's own encrypted backup, should be read by counsel
before it carries Bryan's name publicly. This is a genuine cost and timeline item for a 6-day window.

---

## 9. Trust copy v1.2 for the web edition (draft, needs the governance pass)

Three sentences in the shipped copy stop being true the moment numbers live on a server. The web
edition needs its own wording. Draft:

> **First run.** Your reflections are yours alone. What you write stays in this browser, encrypted, and
> never touches our servers - we cannot read it, and no AI reads it either. Your weekly check-ins are
> numbers, not words, and those are stored so you can see your own pattern across months and devices.
> Deleting a check-in removes it; deleting this browser's data removes anything you wrote.

Implementation requirements carry over from v1.0: acknowledgment checkbox gates continue, no skip, and
the private indicator sits on every narrative screen.

---

## 10. Hackathon compliance map

| Requirement / judging criterion | How Mirror Web satisfies it |
|---|---|
| New app, started on or after Aug 25 | New repo, new code, started Sept 15. The concept and governance are Bryan's own earlier work and the `hackathon.md` log says so plainly |
| Convex is the backend | Database, functions, realtime, auth, scheduling, HTTP routes, rate limiter all on Convex |
| Frontend on `convex.site` / `chatgpt.site` | Deploy under `mirror-web.<name>.chatgpt.site`, no invitation required |
| Public GitHub repo with `hackathon.md` | New public repo, `/hackathon` skill kept current while building |
| OpenAI does work | Prompt drafting + advice-filtering over crawled public text, with a rejection test |
| Firecrawl does work | Crawls and cites the prompt library sources, with retrieval dates |
| AgentMail does work | Real zero-content reminders, real control replies, real encrypted-backup delivery |
| Everyday app, not a developer tool | A weekly reflection app for one relationship - the broadest possible "real person, this week" |
| Convex depth | Live updates across devices, scheduled jobs, capability links, quotas, per-user isolation |
| Live URL + demo video < 3 min | Section 11 script |
| Social post tagging the four accounts | Mirror Web demo posted from the work account |

**Honesty rules** (carried over from the TripBrief repo, which got this right): listing a planned
behavior is not evidence it shipped; the build log records what actually runs, with dates.

---

## 11. Demo script (target 2:45)

| Time | On screen | Line |
|---|---|---|
| 0:00-0:20 | Live URL, empty mirror | "Most tools tell you what your relationship means. This one refuses to." |
| 0:20-0:45 | Create mirror, set weekly cadence | "One person, one weekly reflection." |
| 0:45-1:20 | Answer 20 scale questions; second tab updates live | "Numbers stay in sync across your devices. No score, no rating, no verdict." |
| 1:20-1:45 | Write a private note; DevTools network tab stays empty | "This text went nowhere. It is encrypted in this browser. We cannot read it - here is the proof." |
| 1:45-2:05 | Real AgentMail reminder arrives; reply "pause"; cadence updates live | "Your inbox is the only nudge you get, and it carries no content - not even a topic." |
| 2:05-2:30 | Prompt library with Firecrawl sources + citations | "Firecrawl finds public, non-clinical sources. OpenAI turns them into neutral questions. Neither ever sees you." |
| 2:30-2:45 | Recap of the four platforms | "Convex runs it, Firecrawl feeds it, AgentMail delivers it, OpenAI never reads it." |

---

## 12. Risks, ranked

1. **Six days is short for a from-scratch app.** Mitigation: the demo path in Section 6.1 is the
   contract; everything in 6.2 is bonus. TripBrief stays live and untouched as the fallback entry
   (its remaining work is a video, a social post, and the submission form), so the hackathon is not
   all-or-nothing.
2. **Public repo exposes the Mirror's thinking.** The hackathon requires a public repo, and Mirror Web
   needs the questionnaire, governance summary, and trust copy to be visible. Mitigation: publish only
   the *web* repo and its own charter - no store assets, no pricing/Stage B plans, no Shipaton material.
   Decide this consciously; it is not reversible once indexed.
3. **Shipaton collision.** Mirror is a candidate for the Sept 30 store path. A public web version with
   the same name and questionnaire could complicate (or devalue) that launch. Mitigation: either give
   the web edition its own name, or accept that the web version becomes the product's public front
   door. Owner decision, Section 13.
4. **Legal exposure on a sensitive-topic app plus emailed personal files.** Mitigation: "not therapy"
   copy, no risk claims, encrypted-blob-only email, and a counsel read before public posting.
5. **Judges may read the sponsors as decorative** despite the design in Section 5. Mitigation: the demo
   shows a real email arriving and real cited sources; neither is simulated.
6. **The trust claim breaks quietly.** Mitigation: the network-tab moment in the demo is also a
   requirement - if narrative uploads in any code path, the build fails its own test.

---

## 13. Decisions needed from Bryan

1. **Does the AI line hold?** Recommended: yes - OpenAI works only on public crawled text, never on the
   user's numbers or words. The alternative (AI describing your own numeric pattern) is the single
   biggest trust reversal and would need a formal amendment to the locked documents.
2. **TripBrief: keep, retire, or both?** Recommended: keep it live as the fallback entry, and decide on
   Sunday whether Mirror Web is demo-ready. Two entries are allowed by the rules.
3. **Name and repo exposure:** Mirror Web under the existing name (public repo), or a new name for the
   web edition so the native app's launch stays separate?
4. **Legal read before publishing:** confirm timing, or accept a limited "hackathon preview" framing
   with the disclaimers above until counsel reviews.

---

## 14. Reuse map (what carries over, what does not)

| Carries over (as source material, not copied code) | Does not carry over |
|---|---|
| Locked questionnaire v1 - 20 statements, 5 constructs | Any Flutter/Dart source |
| Trust copy v1.0/v1.1 intent, philosophy "Why We Do Less" | The locked internal governance/spec documents (stay private) |
| Cadence rules: weekly/bi-weekly, 72-hour window, locked-state copy | Stage B monetization plans, pricing, Shipaton material |
| Architecture idea: numbers on the server, words on the device | Any store assets, app icon, screenshots |
| The TripBrief repo's proven Convex patterns (auth, capability tokens, quotas, HTTP routes), refactored fresh | TripBrief product code or data |

---

## 15. Build order after approval

| Day | Deliverable | Gate |
|---|---|---|
| Tue 9/15 | Repo, scaffold, auth, schema deployed to a dev deployment, charter written | Live URL loads and signs in |
| Wed 9/16 | Check-in flow + realtime timeline | Two tabs sync live |
| Thu 9/17 | Prompt library: Firecrawl crawl, OpenAI drafting, rejection filter | 3+ cited sources, hostile-prompt test passes |
| Fri 9/18 | AgentMail reminders + control replies + resume links | Real email lands, reply changes cadence |
| Sat 9/19 | Local encrypted note + encrypted backup by email + quick-delete | Network tab stays clean |
| Sun 9/20 | Public deploy, tests, README, `hackathon.md`, social post, video shoot | Public URL + video under 3 minutes |
| Mon 9/21 | Buffer, submission, TripBrief keep/retire decision | Submissions sent a day early |
| Tue 9/22 | 12:00 PM PT deadline | - |
