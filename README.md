# TripBrief

TripBrief turns a group-travel request into a **capability-ranked shortlist of
incoming tour operators**, gives each shortlisted operator its own private
request, and compares the trips those operators say they would actually operate.
A person always chooses the shortlist and the winner.

Live app: **https://hip-minnow-543.convex.site** — public, no invitation, serving
this build. `npm run deploy` is the one-shot: it builds the frontend against the
production URL, deploys the backend, and uploads the assets.

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

A token identifies exactly one row. Two rows sharing one token would mean a link
could open someone else's request, so shortlisting refuses a token that is already
spoken for and asks for a retry.

## The operator network is a workspace's own

A workspace starts with the fictional network this repository ships, and from
there it is that workspace's alone: another workspace sees its own copy and cannot
read or change anything in this one. Operators can be added by hand or from a
researched page, kept current by the operator itself, and removed while they have
never quoted — once an operator has answered a brief, its record is part of a
recorded decision and stays.

An operator's **contact email lives on its network record**, not on a brief, so it
is entered once, lands on every request, and stays correctable. A request is
prefilled with it and is still sent one at a time, to one named operator, by a
deliberate click.

## Mail: three inboxes, any number of briefs

A free mail plan allows three inboxes in total, for the whole account. One inbox
per brief cannot survive that, so the workspace keeps a **small pool** instead:

- A workspace opens one mailbox the first time it sends, and reuses the quietest
  one it has ever after. It never opens a second one it does not need, because an
  account slot is worth more than tidiness.
- **A reply is attributed by the thread it belongs to.** Sending records the thread
  the message started; a reply carries that thread back; the reply is filed on the
  exact request it answers. This is what makes sharing a mailbox lossless — two
  briefs can invite the same operator from one inbox and both answers still land in
  the right place.
- If a reply carries **no thread** (the operator wrote a fresh message rather than
  replying), it is placed on the most recent request sent to that address and
  marked *matched by address* rather than exactly, so a person can check it.
- If it comes from an address **no request was ever sent to**, it is not guessed
  onto anything: it is kept and shown on the home view as mail that could not be
  filed. Silently dropping it would be worse than showing it.

A message's sender address is trivially forgeable, which is why the thread — not
the sender — decides where a reply belongs, and why the address fallback is
labelled as a fallback in the interface.

### When something arrives, you are told

The app is live: a quote submitted in an operator's browser appears in the
advisor's comparison with no refresh. That is only true while the advisor is
looking at it, so an arrival announces itself by email as well.

- One departure and two arrivals are announced: a quote submitted through the
  operator's link, and a reply that arrived by mail and was filed against a brief.
- **Several arrivals inside one sweep are announced together.** A brief sent to
  five operators produces one message, not five.
- The announcement goes from the workspace's own mailbox to its own account
  address, so it needs no new service and no second channel.
- It is marked announced only after it actually sends, and a sweep every fifteen
  minutes catches anything an attempt missed. Nothing is announced twice, and
  nothing sits silent because one send failed.
- A trial workspace cannot send, so it is never told — its arrivals stay pending
  and its counts remain visible in the app.

## Accounts, and who is allowed to send

A public URL that sends email is a liability unless it can only be done by the
people it belongs to. Anybody could otherwise sign up and spend the owner's mail
account from the owner's name. So:

- **A trial workspace** is one click and does everything except send: build a
  brief, rank operators, hand out private links, read a reply that is pasted in,
  compare proposals, select a trip. It belongs to the browser it was made in.
- **An account** is email and password, and it keeps the work.
- **The address is proved.** Sign-up sends a code and the account is unusable
  until it comes back. That is not ceremony: an account's address is what decides
  whether it may send email to real operators, so an unproved address would let
  somebody claim an identity the deployment trusts.
- **Forgotten passwords are recoverable.** The same code path sends a reset code
  and the sign-in screen takes a new password against it.
- Both codes go out through the mail account the product already has, so there is
  no second service and the sponsor that carries everything else carries these.
  The codes are long one-time tokens, and each flow's mail says what it is for and
  what to do if it was not you.
- **Sending is gated.** Only an account whose address is on the deployment's
  `SEND_ALLOWED_EMAILS` may send. With that list empty, nobody can — which is the
  right default for a deployment that is about to be public. A trial workspace is
  refused with a message that says what still works, and an account that is not
  listed is refused with its own address in the reason, so it is clear it is not a
  password problem.

The refusal is enforced on the server, in the one action that reaches a real
inbox, not in the interface.

## What each sponsor actually does

Each one is a real surface in the product, not a line in this file, and the status
column says what has actually been run.

| Sponsor | Real work in the product | Status |
|---|---|---|
| **Convex** | Schema, indexes, live queries, mutations, actions, HTTP routes, authentication, per-workspace ownership, rate-limiter quotas, and hosting of the built frontend | Running. 35 tests cover ownership isolation, link scope, the shortlist cap, the cascade delete, reply matching and the provider paths |
| **Firecrawl** | *Grow the network*: searches published websites for operators serving one destination, stores each result with the query that surfaced it, and lets an advisor add one as an operator | Wired, and previously verified against the live provider. Quota-limited per workspace and app-wide |
| **OpenAI** | Reads an operator's emailed reply and drafts the structured proposal. Every claim carries an exact contiguous quote from the reply, and a quote that is not in the reply voids the whole draft | Wired and unit-tested. Review-only: it returns a draft, never writes, and refuses to run without a key |
| **AgentMail** | A small pool of mailboxes per workspace sends requests, and a reply is attributed to the exact request it answers by the thread it belongs to | Wired and exercised end to end, including the inbound route. **No email has been sent to a real supplier** (the one live send was to the project owner's own address) |

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

To bring an operator in without opening the browser — a roster usually arrives as
a list — use the same creation path the form uses, and ask for the operator's
intake link in the same call:

```text
npx convex run network:addOperatorForOwner '{
  "owner": "<the account id>",
  "name": "Coast & Valley Travel",
  "country": "Portugal",
  "destinationSlugs": ["portugal"],
  "minGroupSize": 8,
  "maxGroupSize": 30,
  "contactEmail": "bookings@example.com",
  "capabilityToken": "<32 random bytes, base64url>"
}'
```

Which workspaces exist, and what the providers actually answer:

```text
npx convex run network:workspaces        # owner ids, operator and brief counts
npx convex run mailboxes:checkProvider   # Mail: status and inbox count
npx convex run research:checkProvider    # Firecrawl: status
```

The mail plan matters only at the start: a workspace needs **one** inbox to work,
and the pool never grows past what the account allows. When the provider refuses
one, the refusal is shown verbatim rather than hidden behind "service unavailable".

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
npx convex env set SEND_ALLOWED_EMAILS you@agency.example   # who may send; required
npx convex env set AUTH_MAIL_FROM …           # optional; sign-in codes come from
                                              # an inbox the account already has
npx convex run replies:registerWebhook        # one webhook covers every brief inbox
npm run deploy
```

`SEND_ALLOWED_EMAILS` takes a comma-separated list. Leaving it unset is safe: the
app still works, and nothing can send.

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
