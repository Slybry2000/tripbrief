# TripBrief

TripBrief turns a group-travel request into one consistent brief, researches
prospective suppliers, and gives each supplier a secure response link. Supplier
submissions flow into a live, evidence-backed comparison while a human advisor
always chooses the suppliers and the winning proposal.

## Hackathon boundary

TripBrief is a new standalone application created for the Convex All Gas
Hackathon. It contains no client branding, customer records, private supplier
roster, credentials, or copied proprietary source code. Development and
demonstrations use fictional people, trips, suppliers, inboxes, and proposals.

The intended sponsor roles are:

- Convex: database, server functions, workflows, and live updates.
- Firecrawl: research supplied partner websites and attach cited evidence.
- OpenAI: structure proposal text and identify comparable facts with citations.
- AgentMail: each brief gets its own inbox, and that inbox sends each supplier
  their private response link.

Firecrawl has been tested in the deployed backend; OpenAI and AgentMail have been
tested with fictional local data. OpenAI returns review-only requirement
evidence. AgentMail provisions a distinct brief inbox and currently neither sends
nor receives mail — there is no send path and no inbound route yet. No supplier
email has been sent or received. Listing a planned behavior is not evidence that
it has shipped.

The frontend is publicly hosted on Convex at
**https://hip-minnow-543.convex.site** — no sign-in, no invitation. Verified on
2026-09-16 from an unauthenticated client: the page and its assets return 200, a
deep path falls back to the app, and the backend answers an unauthenticated
query with its own "Please sign in to use your workspace." message rather than a
connection error. The earlier `chatgpt.site` deployment still requires a
ChatGPT sign-in and is no longer the address judges should use.

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

Public app: https://hip-minnow-543.convex.site

Public source: https://github.com/Slybry2000/tripbrief

Local development still uses the configured local Convex deployment. Production
uses a separate Convex deployment with server-side secrets and shared-use quotas.

## Demo path

1. Start a private trial workspace and answer the guided intake: the trip, the
   group, what the trip is built around, timing and money, then the
   requirements. The advisor edits suggested requirements built from those
   answers, so the group's needs become questions a supplier can answer.
2. Search public supplier websites with Firecrawl and add prospects to the
   shortlist. Shortlisting a partner also creates that partner's own response
   link — one per supplier, no account for them.
3. Open the Suppliers card: it lists who is quoting, the private link for each
   one, and where each stands. Add a supplier's email address and send the
   invitation from the brief's own inbox.
4. Open a supplier's link in a separate browser tab and answer it the way a real
   supplier would: their quote, how they would run the trip, their own words on
   the requirements they want to answer, and any documents they already have —
   a quote PDF, a sample itinerary, a completed trip. It appears in the
   requester's live comparison with its attachments.
5. Optionally use OpenAI to structure an emailed-response fallback.
6. Compare offers and record a human decision with its reason.

Sending is always a deliberate click on one named supplier. Nothing is mailed
automatically, and no message can go to more than one address.

Any brief can be deleted from its own page. That removes the brief, its
requirements and group details, its shortlist, its suppliers and their response
links, every response it received, and the files a supplier attached — the
stored files are deleted from storage rather than orphaned. The brief's own
email address is retired with it; mail already sitting in that address is not
removed from the mail provider.

## Submission gates

- New app started after August 25, 2026 at 12:00 PM PT.
- Convex is the substantive backend, including live queries and mutations.
- OpenAI, Firecrawl, and AgentMail each perform real in-product work.
- Public repository with `hackathon.md` at its root.
- Public `convex.site` or `chatgpt.site` URL requiring no invitation.
- Public build post tagging all four sponsors.
- Working demo video under three minutes.
- Submission completed before September 22, 2026 at 12:00 PM PT.
