# TripBrief demo video

Under two minutes. Everything on screen is the live app at
https://hip-minnow-543.convex.site, driven end to end in one take. The only
post-production is the camera, the two speed-ups, and the sound.

## What the film has to prove

Four technologies are being judged, and each one needs a moment where a viewer
can see it doing real work, named at the instant it happens. The cut before
this one failed that test in a specific way: it credited Firecrawl for work
OpenAI does, and the only time it said "OpenAI" it was pointing at the
simulated replies. That is backwards. Firecrawl fetches; OpenAI reads.

| Technology | What it actually does here | Where the film shows it |
|---|---|---|
| Firecrawl | Fetches published travel sources, and each operator's own website | The Portugal card and its sources; the operator search |
| OpenAI | Reads those pages into a destination profile; reads each operator site for the company and its published address; reads a free-prose reply into all 18 numbered answers; reads an operator's own uploaded document | The place card, the operator cards, and the money shot |
| AgentMail | Sends each operator its own request from a real inbox and catches the reply | The send screen and the reply that arrives |
| Convex | Holds everything, and pushes each reply to the page as it lands | The counter reaching 3 of 3 with nobody touching the page |

## Shot list

| # | Shot | Caption | Evidences |
|---|---|---|---|
| 1 | Title card. "Nothing is mocked." | — | — |
| 2 | The brief: group, budget, no destination | A group, a budget, no destination. | Convex |
| 3 | Dates, money, needs | Who is travelling, when, the money, and what they need. | Convex |
| 4 | The requirements strip | Each answer becomes a numbered requirement. | Convex |
| 5 | Typing "Portugal", letter by letter, then the lookup | Type a country. | Firecrawl, OpenAI |
| 6 | The Portugal card, with a ribbon on its sources | Strengths, climate, what to plan around, and the sources. | Firecrawl |
| 7 | Operators found on the web | Real operators, found on the web. | Firecrawl |
| 8 | An operator card, with a ribbon on the published address | It reads each company's own site for the address they publish. | OpenAI |
| 9 | Shortlisting three | Shortlist three. Each gets a private link, no account. | Convex |
| 10 | The send screen | It writes to the address each site publishes. | AgentMail |
| 11 | The demo-mode notice | In demo mode it all goes to a stand-in inbox. | AgentMail |
| 12 | Waiting | Each operator answers the way a real one would. | OpenAI |
| 13 | Replies landing, ribbon on the banner, cursor parked | Nobody refreshed this page. | Convex |
| 14 | Three replies | Three replies. Three prices, three sets of dates. | Convex |
| 15 | The reply reader, on the prose the operator wrote | This is what the operator actually wrote back. | AgentMail |
| 16 | The grid, all eighteen rows | All eighteen requirements, answered. | OpenAI |
| 17 | **The money shot.** One quoted cell, lit gold | Every answer is quoted from their own email. | OpenAI |
| 18 | A cell nobody answered | Where an operator said nothing, it says so. | OpenAI |
| 19 | Selecting, and the workback schedule | Pick the trip. The schedule works back from departure. | Convex |
| 20 | End card: one line per technology on what it did | — | All four |

**The money shot is shots 16 to 18 and it gets the most screen time of
anything.** The app renders the operator's quoted sentence twice: once in the
prose of their email, once in the grid cell that cites it. The recorder finds
that sentence programmatically and lights both, so the claim that the answer
was extracted rather than invented is shown rather than asserted. `proposals.ts`
drops any quote that is not in the source text character for character, which
is why the grid can say "not answered" instead of guessing.

## The camera

Playwright records 1920x1080 with the page zoomed 1.5x. `deviceScaleFactor` is
deliberately absent: it has no effect on `recordVideo`, which is why earlier
cuts were a 1280-wide raster with text too small to read.

The take is cut into shots in `videos/shots.mjs`. A shot either pushes or
holds, never both; a push runs 1.00 to 1.06 with an ease-out; a sped-up shot
never moves. Cuts everywhere except four dissolves. Scrolling survives in two
places only, where the length of the thing is the point.

A cursor is drawn by the film layer and travels before every click, because
Playwright's recording contains no pointer and without one nothing appears to
be clicked.

## The sound

`videos/voiceover.json` holds the spoken line for each caption. Lines are
written to a budget: about 2.1 words per second of room, less a breath. That
is measured delivery, not the requested pace, and it is why nothing is ever
time-stretched to fit.

The bed is four chords with real partials that change across the film, not the
two static sine tones it replaces. It ducks under the voice. A few sound
events land on the clicks and on the replies arriving. Loudness is normalised
in two passes to -14 LUFS.

## Rendering

```text
node videos/record-demo.mjs https://hip-minnow-543.convex.site videos/takeN
OPENAI_API_KEY=... node videos/gen-vo.mjs videos/takeN
node videos/build-demo.mjs videos/takeN        # --no-music, --no-sfx
```

The build prints the finished length, the shot and push counts, any narration
line that lands with under 0.3s of room, and the measured loudness. Checked by
transcribing the finished audio and reading the lines back against this list.
