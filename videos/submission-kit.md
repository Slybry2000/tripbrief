# Submission kit

Everything to paste in on Tuesday. Deadline: **Tuesday 22 September, 12:00 noon
Pacific**. Live app: https://hip-minnow-543.convex.site · Repo:
https://github.com/Slybry2000/tripbrief

## The social post (X or LinkedIn, tag all four sponsors)

Short version, for X:

> An agency gets a group, a budget and no destination. TripBrief turns that into
> a shortlist of real local operators, sends each one its own request, and puts
> their answers side by side.
>
> Type a country and @firecrawl reads published sources and finds real incoming
> operators with the addresses their own sites publish. @agentmail sends each one
> its own request from the workspace inbox. @OpenAI reads the replies and answers
> every numbered requirement, quoting the operator's own words. @convex holds all
> of it and updates the comparison live as answers land.
>
> Built for the Convex All Gas hackathon. Demo mode is on, so no real operator is
> ever contacted.
>
> Live: hip-minnow-543.convex.site
> Code: github.com/Slybry2000/tripbrief

Longer version, for LinkedIn: keep the same three paragraphs, then add:

> The part I care about most: an operator answers R1 to R18, and the comparison
> is built from those answers, not from a fit score anyone gave themselves. When
> a reply does not address a requirement, the grid says "not answered" instead of
> guessing.

## Likely submission fields

- **Name:** TripBrief, Incoming Operator Finder
- **One line:** Turns a group-travel brief into a capability-ranked shortlist of
  real incoming tour operators, sends each one its own request, and compares the
  trips they would actually run.
- **Live URL:** https://hip-minnow-543.convex.site
- **Repo:** https://github.com/Slybry2000/tripbrief
- **Video:** (link after upload)
- **Post:** (link after posting)
- **What Convex does:** schema and indexes, queries, mutations and actions, live
  queries that update the comparison as replies land, Convex Auth with accounts,
  email verification and password reset, per-workspace ownership on every read,
  HTTP routes for inbound mail, a fifteen-minute cron, scheduled follow-up work,
  the rate-limiter component for provider quotas, and static hosting of the
  frontend.
- **What OpenAI does:** reads an operator's emailed reply and drafts the
  structured proposal, answering each numbered requirement only where the reply
  addresses it, with a verbatim quote for every answer; writes the operator's
  reply in demo mode.
- **What Firecrawl does:** looks up a place from published travel sources, and
  finds real incoming tour operators and DMCs by reading their own websites,
  keeping the contact address each site publishes.
- **What AgentMail does:** sends each operator its own request from the
  workspace mailbox, receives replies on a webhook, files each reply on the
  request it answers by its thread, and carries sign-up and password-reset codes.
- **Demo mode note for judges:** operators and destinations are real; no request
  reaches an operator. Requests go to a stand-in inbox and a model answers as the
  operator, labelled as simulated everywhere it appears.
