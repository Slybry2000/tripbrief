# TripBrief

TripBrief turns a messy group-travel request into one consistent supplier brief,
routes it to selected travel partners, and converts their differently formatted
replies into a live, evidence-backed comparison. A human advisor always chooses
the suppliers and the winning proposal.

## Hackathon boundary

TripBrief is a new standalone application created for the Convex All Gas
Hackathon. It contains no client branding, customer records, private supplier
roster, credentials, or copied proprietary source code. Development and
demonstrations use fictional people, trips, suppliers, inboxes, and proposals.

The intended sponsor roles are:

- Convex: database, server functions, workflows, and live updates.
- Firecrawl: research supplied partner websites and attach cited evidence.
- OpenAI: structure proposal text and identify comparable facts with citations.
- AgentMail: provide a case inbox and route supplier replies to the correct brief.

These integrations count only after working behavior is present in source and has
been tested. Listing an integration here is not evidence that it has shipped.

## Safety rules

- Never send email to a real supplier during development or judging.
- Never import private client, traveler, supplier, or inbox data.
- Never let AI select a supplier or silently invent a missing fact.
- Keep secrets only in ignored local or Convex environment storage.
- Treat `hackathon.md`, source code, fixtures, screenshots, and videos as public.
- Require explicit authorization before deployment, publication, social posting,
  submission, or any real external message.

## Local development

```text
npm install
npm run dev
```

The project currently uses a local Convex deployment and is not publicly
deployed.

## Submission gates

- New app started after August 25, 2026 at 12:00 PM PT.
- Convex is the substantive backend, including live queries and mutations.
- OpenAI, Firecrawl, and AgentMail each perform real in-product work.
- Public repository with `hackathon.md` at its root.
- Public `convex.site` or `chatgpt.site` URL requiring no invitation.
- Public build post tagging all four sponsors.
- Working demo video under three minutes.
- Submission completed before September 22, 2026 at 12:00 PM PT.
