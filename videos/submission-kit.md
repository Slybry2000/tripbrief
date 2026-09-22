# Submission kit

Everything to paste in. Deadline: **Tuesday 22 September, 12:00 noon Pacific**.
Submit at https://vibeapps.dev/judging/convex-all-gas-hackathon-openai/submit

- Live app: https://hip-minnow-543.convex.site
- Repo: https://github.com/Slybry2000/tripbrief (public, `hackathon.md` in the root)
- Film: `videos/take9/tripbrief-demo.mp4` (2:31, 1080p)
- Captions: `videos/take9/tripbrief-demo.srt`

## Before the form: the video goes on YouTube, with captions

The judging pipeline reads a transcript from the video link. A YouTube link with
captions is read; a bare .mp4 link is recorded as unsupported. So:

1. Upload `tripbrief-demo.mp4` to YouTube (unlisted is fine).
2. In YouTube Studio, Subtitles, upload `tripbrief-demo.srt` as English.
3. Paste the YouTube link into the form.

## Submission fields

- **Name:** TripBrief
- **Tagline:** Finds the local operators you did not know existed, asks each one
  the same eighteen questions, and compares what they actually said.
- **Description:**

  A travel agency gets a group, a budget and no destination. The slow part is
  not choosing a hotel: it is finding the local operators in a country the agency
  has never worked in, then comparing replies that arrive as prose and PDFs.

  TripBrief starts from not knowing who to ask. Type a country and Firecrawl
  fetches published travel sources, which OpenAI reads into a profile of what the
  place is strong for. Firecrawl then searches the open web for real incoming
  tour operators and reads each company's own site; OpenAI judges which pages are
  really local operators rather than directories, and the contact address is
  taken from the operator's own page, never from the model.

  The brief becomes eighteen numbered requirements. AgentMail sends each
  shortlisted operator its own request with a private, no-account link. When a
  reply lands, Convex pushes it to the page live, and OpenAI reads the prose into
  an answer for every requirement. Each answer stands only on a quote that
  appears in the operator's email word for word, and each figure the comparison
  is decided on (price, group size, deposit) must be inside the quote given for
  it. Where an operator said nothing, the grid says so rather than guessing.

  Demo mode is on: operators, websites and addresses are real, but every request
  goes to a stand-in inbox the project owns, and the replies are written by
  OpenAI in each operator's voice. `proof/end-to-end.json` is a record of one
  real run, read out of the production database.

- **What Convex does:** schema and indexes; queries, mutations and actions; live
  queries that update the comparison as replies land; Convex Auth with
  verification and password reset; per-workspace ownership on every read; an HTTP
  route for AgentMail's inbound webhook; a fifteen-minute cron that catches any
  reply announcement that failed; scheduled work; the rate-limiter component for
  provider quotas; and static hosting of the frontend.
- **What OpenAI does (called directly, gpt-4.1-mini, structured outputs):**
  reads Firecrawl's pages into a destination profile; reads operator websites and
  judges which are genuine local operators; reads an operator's own trip document
  into a proposal; reads each emailed reply into answers to all eighteen
  requirements, quote-checked. In demo mode it also writes the operators' replies.
  The film's narration is OpenAI text to speech.
- **What Firecrawl does:** fetches published travel sources for a place, and
  searches for and reads each operator's own website.
- **What AgentMail does:** sends each operator its own request from the
  workspace mailbox, receives replies on a webhook, and files each reply against
  the request it answers by its thread.

## The social post (X or LinkedIn, tag all four sponsors)

Short version, for X:

> An agency gets a group, a budget and no destination. The hard part is finding
> the local operators who could run the trip.
>
> TripBrief: @firecrawl searches the web for real local operators and reads their
> own sites. @OpenAI judges which are real and reads every reply into answers to
> the same 18 questions, each quoted word for word. @agentmail sends each operator
> its own request. @convex updates the comparison live as replies land.
>
> Built for the Convex All Gas hackathon. Demo mode is on, so no real operator is
> contacted.
>
> Live: hip-minnow-543.convex.site
> Code: github.com/Slybry2000/tripbrief

Longer version, for LinkedIn: the same, then add:

> The part I care about most: every answer in the comparison is quoted from the
> operator's own email, and a price only counts if it is inside the words quoted
> for it. When a reply does not address a requirement, the grid says "not
> answered" instead of guessing.
