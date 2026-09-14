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
- AgentMail: give each brief its own inbox for future supplier-reply routing.

Firecrawl has been tested in the public deployment; OpenAI and AgentMail have
been tested with fictional local data.
OpenAI returns review-only requirement evidence; AgentMail provisions a distinct
brief inbox. No supplier email has been sent. Listing a planned behavior is not
evidence that it has shipped.

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

Public app: https://tripbrief.perseidechocreations.chatgpt.site

Public source: https://github.com/Slybry2000/tripbrief

Local development still uses the configured local Convex deployment. Production
uses a separate Convex deployment with server-side secrets and shared-use quotas.

## Demo path

1. Start a private trial workspace and create a fictional group-travel brief.
2. Search public supplier websites with Firecrawl and save a prospective partner.
3. Create a secure response link for a fictional supplier and open it in a
   separate browser tab—no supplier account is required.
4. Submit the supplier's fictional proposal through its dedicated portal and
   watch it appear in the requester's live comparison.
5. Optionally create the brief's AgentMail inbox, research prospects with
   Firecrawl, or use OpenAI to structure an emailed-response fallback.
6. Compare offers and record a human decision with its reason.

## Submission gates

- New app started after August 25, 2026 at 12:00 PM PT.
- Convex is the substantive backend, including live queries and mutations.
- OpenAI, Firecrawl, and AgentMail each perform real in-product work.
- Public repository with `hackathon.md` at its root.
- Public `convex.site` or `chatgpt.site` URL requiring no invitation.
- Public build post tagging all four sponsors.
- Working demo video under three minutes.
- Submission completed before September 22, 2026 at 12:00 PM PT.
