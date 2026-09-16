# TripBrief

TripBrief turns a group-travel request into a **capability-ranked shortlist of
incoming tour operators**, gives each shortlisted operator its own private
request, and compares the trips those operators say they would actually operate.
A person always chooses the shortlist and the winner.

Live app: **https://hip-minnow-543.convex.site** — public, no invitation. As of
this commit that address still serves the build from before the rebuild; deploying
this one is a single `npm run deploy`, and it has not been run.

Everything in the shipped operator network is fictional. No real supplier, price,
quote or message is included, and no message has been sent to a real supplier.

## The problem it solves

An agency has a client and a group, and it does not have a destination, an
operator, or a program. Deciding those things is the work, and it is usually done
by emailing a few suppliers in whatever format each of them prefers, then trying
to compare three answers that describe different trips at different prices with
different gaps.

TripBrief makes that one process. The work is the eight steps below, and the
records they produce are the point: a brief that can be re-read, a shortlist that
can be justified, one request per operator that says exactly what must be
answered, and a comparison built from proposals rather than from a headline price.

| Step | What happens |
|---|---|
| 1. Client needs | The trip is described without choosing a destination: group size and minimum viable count, nights, hotel level, pace, target retail price, dates, decision deadline, experiences, operating needs, accessibility needs, notes. |
| 2. Destinations | Every destination is scored against the brief and the customer-approved locations are chosen. Only operators serving those locations are considered from here on. |
| 3. Operator matches | Operators are ranked by **Capability Match** — 35% experiences, 20% operations, 15% destination, 10% group, 10% accommodation, 10% commercial — with the reason for every score, what is missing, and what has to be confirmed. |
| 4. Choose partners | Up to five operators are shortlisted. Naming one creates its private request link. |
| 5. Trip request | One core brief, plus the questions that operator specifically has to answer. It can be emailed from the brief's own inbox, or handed over as a link. |
| 6. Operator responses | The operator opens its link, confirms the dates it can actually operate, and returns a structured proposal. A reply that arrives by email can be read, drafted into the same structure, reviewed and recorded. |
| 7. Compare trips | Proposals are compared as **trips**: final fit, availability, price and margin, hotels, transport, remaining gaps, deposits and deadlines. |
| 8. Selection & workback | The trip and the operating partner behind it are selected, and a workback schedule is built from that proposal's own deadlines. |

A ready-made program is supporting evidence, never an entry requirement. An
operator with no program is matched on identical terms and labelled *Custom /
À la carte*.

## Two kinds of private link

An operator needs no account. It has a link, and a link is a capability: 32 random
bytes generated in the advisor's browser, carried in the URL fragment, so it never
appears in a request line, a referrer or a server log.

- **A request link** belongs to one brief and one operator. It reads the request,
  and it can write exactly one thing: that operator's proposal. It is created by
  shortlisting the operator.
- **A standing capability link** belongs to the network, not to a brief. It is how
  an operator keeps its own capability record current — the record the matcher
  reads — and it survives every brief being deleted. It is created from the
  operator network page.

Either link can update the operator's capability record. Neither can read another
operator's record, price or proposal. The owner and the operator slug are taken
from the link server-side, never from the browser.

## The operator network is a workspace's own

A workspace starts with the fictional network this repository ships, and from
there it is that workspace's alone: another workspace sees its own copy and cannot
read or change anything in this one. Operators can be added by hand or from a
researched page, kept current by the operator itself, and removed while they have
never quoted — once an operator has answered a brief, its record is part of a
recorded decision and stays.

## What each sponsor actually does

Each one is a real surface in the product, not a line in this file, and the status
column says what has actually been run.

| Sponsor | Real work in the product | Status |
|---|---|---|
| **Convex** | Schema, indexes, live queries, mutations, actions, HTTP routes, authentication, per-workspace ownership, rate-limiter quotas, and hosting of the built frontend | Running. 35 tests cover ownership isolation, link scope, the shortlist cap, the cascade delete, reply matching and the provider paths |
| **Firecrawl** | *Grow the network*: searches published websites for operators serving one destination, stores each result with the query that surfaced it, and lets an advisor add one as an operator | Wired, and previously verified against the live provider. Quota-limited per workspace and app-wide |
| **OpenAI** | Reads an operator's emailed reply and drafts the structured proposal. Every claim carries an exact contiguous quote from the reply, and a quote that is not in the reply voids the whole draft | Wired and unit-tested. Review-only: it returns a draft, never writes, and refuses to run without a key |
| **AgentMail** | Each brief gets its own inbox. That inbox sends one named operator its own request link, and a reply to that address is matched back to the operator it came from | Wired, and the send path has been exercised. **No email has been sent to a real supplier** |

## What makes it safe to point at real suppliers

- Identity always comes from the session. No function accepts an owner argument.
- Sending is always one deliberate click on one named operator, to one address a
  human typed into that operator's row. No call can reach a second address.
- A model draft is never applied by itself. It is reviewed, corrected and recorded
  by a person, and the operator's own words are stored beside the structured
  version.
- Anything a browser can write is bounded before it is stored, and every read
  returns an explicit projection rather than the stored document.
- Deleting a brief removes everything it produced: its operators, their request
  links, every proposal it received and the mail it received. The operators stay in
  the network.
- Provider spend is capped by per-workspace and app-wide quotas.

## Local development

```text
npm install
npx convex dev                # pushes functions to the local deployment and watches
npx vite                      # the app on http://localhost:5173
```

The first sign-in seeds that workspace's operator network, so there is no separate
seed step for development. To seed a named workspace from the CLI instead:
`npx convex run network:seed '{"owner":"<the account id>"}'`.

```text
npm test        # 35 tests: matching baselines, and the backend's actual behaviour
npm run lint
npm run build
npm run deploy  # builds the frontend and publishes it with the backend
```

## Deployment

The frontend is served by the Convex deployment itself through
`@convex-dev/static-hosting`, using app-owned root routing so Convex Auth keeps
its exact `/api/auth` and `/.well-known` routes.

```text
npx convex env set FIRECRAWL_API_KEY …        # Firecrawl
npx convex env set OPENAI_API_KEY …           # OpenAI
npx convex env set AGENTMAIL_API_KEY …        # AgentMail
npx convex env set AGENTMAIL_WEBHOOK_SECRET … # the inbound shared secret
npx convex run replies:registerWebhook        # one webhook covers every brief inbox
npm run deploy
```

## Repository layout

- `convex/` — schema, the operator network, briefs, proposals, research, inboxes,
  inbound mail, quotas and HTTP routes. See `convex/README.md`.
- `convex/seedData.ts` — generated by `scripts/build-seed.mjs`; the fictional
  network the app ships with.
- `src/App.tsx` — both sides of the product.
- `src/lib/matching.ts` — the matching engine, kept pure so it can be tested
  against the published baselines.
- `src/data/` — destinations and ready-made programs (reference data).
- `hackathon.md` — the build log, in order, saying what actually ran.
