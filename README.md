# Dream Travel — Incoming Operator Finder

This repository was created for the **Convex All Gas Hackathon** under the neutral
working name **TripBrief**. It has since been pointed at the product the demo was
built to show, and the app is now the **Dream Travel Incoming Operator Finder**.
The repository name is unchanged; the product inside it is not.

The app turns a group-travel request into a **capability-ranked shortlist of
incoming tour operators**, sends each one its own private request, and compares
the trips they say they would actually operate. A human always chooses the
shortlist and the winner.

Live app: **https://hip-minnow-543.convex.site** (public, no invitation)

## The experience

Dream Travel has a client and a group. It does not have a destination, an
operator, or a program. The workflow starts there and ends with something it can
sell.

| Step | What happens |
|---|---|
| 1. Client needs | The trip is described without choosing a destination: group size and minimum viable count, nights, hotel level, pace, target retail price, dates, decision deadline, experiences, operating needs, accessibility needs, and notes. |
| 2. Destinations | Every destination is scored against the brief and the customer-approved locations are chosen. Only operators serving those locations are considered afterwards. |
| 3. ITO matches | Operators are ranked by **Capability Match** — 35% experiences, 20% operations, 15% destination, 10% group, 10% accommodation, 10% commercial — with the reason for every score, what is missing, and what still needs confirming. |
| 4. Choose partners | Up to five operators are shortlisted. Naming one creates its private response link. |
| 5. Trip request | One core brief, plus the questions that operator specifically has to answer. Each operator can be emailed from the brief's own inbox, or handed its link. |
| 6. Operator responses | Each operator opens its link, confirms the dates it can actually operate, and returns a structured proposal. |
| 7. Compare trips | The proposals are compared as **trips**, not as suppliers: final fit, availability, price and margin, hotels, transport, remaining gaps, deposits and deadlines. |
| 8. Selection & workback | Dream Travel selects the trip it will sell and the operator behind it, and gets a workback schedule built from that proposal's own deadlines. |

Ready-made programs are supporting evidence, never an entry requirement. An
operator with no program is matched on exactly the same terms and is labelled
*Custom / À la carte*.

## Two sides, one record

- **Dream Travel's workspace** — everything in the table above, owned by the
  signed-in account.
- **The operator's private link** — 32 random bytes carried in the URL fragment.
  It reads that operator's own capability record, the request it was sent, and
  its own proposal, and it can write nothing else. No account, no invitation.

The operator maintains its **capability record** (footprint, experiences,
operations, groups and hotels, commercial terms, and timing) through the same
link. Saving it changes what the matcher sees on the next run, and a second tab
sees a submitted proposal without a refresh — both are live Convex queries.

The matching engine itself is a pure module (`src/lib/matching.ts`) with the
published baselines pinned by tests, so a ranking change is a visible, testable
change rather than a drift.

## What each sponsor actually does

No sponsor sits in the README. Each is a real surface, and this list says which
parts have actually been run.

| Sponsor | Real work in the product | Status |
|---|---|---|
| **Convex** | Schema, indexes, live queries, mutations, actions, HTTP routes, per-workspace auth and ownership, rate-limiter quotas, static hosting of the frontend | Running; 32 tests cover ownership, the capability-link scope, quotas and the cascade delete |
| **Firecrawl** | *Grow the network*: searches published websites for operators serving one destination, stores each result with the query that surfaced it, and lets an advisor add one as an operator record | Wired and previously verified against the live provider; the added operator starts with an empty capability record and matches nothing until it fills the intake in |
| **OpenAI** | Reads an operator's emailed reply and drafts the structured proposal, with an exact quote from the reply for every claim; a quote that is not in the reply voids the whole draft | Wired and unit-tested; returns a review draft only and never writes. It does not run without `OPENAI_API_KEY` |
| **AgentMail** | Each brief gets its own inbox. That inbox sends one named operator its own request link, and a reply to that address is matched back to the operator it came from | Wired, and the send path has been exercised end to end. **No email has been sent to a real supplier.** |

## Safety rules

- Never send email to a real supplier during development or judging.
- Never import private client, traveller, operator, or inbox data.
- Only an address a human typed into one row can receive a message, and no call
  can reach more than one address.
- A model draft is never applied without a person recording it.
- Require explicit authorization before deployment, publication, social posting,
  submission, or any real external message.
- `hackathon.md`, the source, the fixtures, the screenshots and the videos are
  public. The demo data is fictional: every operator, program, price, blackout
  period and deadline in `convex/seedData.ts` was invented for demonstration.

## Local development

```text
npm install
npx convex dev          # pushes functions to the local deployment and watches
npx convex run network:seed   # loads the fictional operator network
npx vite                # the app
```

Open `http://localhost:5173`.

```text
npm test                # 32 tests: the matching baselines in convex/…/src
npm run lint
npm run build
npm run deploy          # builds the frontend and publishes it with the backend
```

## Repository layout

- `convex/` — schema, the operator network, briefs, proposals, research inboxes,
  inbound mail, quotas and HTTP routes
- `convex/seedData.ts` — generated from `scripts/build-seed.mjs`; the fictional
  network the demo runs on
- `src/App.tsx` — both sides of the product
- `src/lib/matching.ts` — the matching engine, kept pure so it can be tested
- `src/data/` — destinations and ready-made programs (reference data)
- `hackathon.md` — the build log, in order, with what actually ran

## Deployment

The frontend is served from the Convex deployment itself via
`@convex-dev/static-hosting`, using app-owned root routing so Convex Auth keeps
its exact `/api/auth` and `/.well-known` routes.

```text
npx convex env set FIRECRAWL_API_KEY …        #    Firecrawl
npx convex env set OPENAI_API_KEY …           #    OpenAI
npx convex env set AGENTMAIL_API_KEY …        #    AgentMail
npx convex env set AGENTMAIL_WEBHOOK_SECRET … #    the inbound shared secret
npx convex run --prod network:seed
npx convex run --prod replies:registerWebhook
npm run deploy
```
