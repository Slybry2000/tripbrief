# TripBrief demo video: shot list

Under three minutes, no narration track: captions carry the story while the live
app at https://hip-minnow-543.convex.site does the work. Everything on screen is
the real product, driven end to end in one take. The only post-production is
speeding up the wait for the operators' replies.

| # | Shot | Caption | Sponsor shown |
|---|---|---|---|
| 1 | Title card | TripBrief. From a client brief to trips real operators will actually run. | — |
| 2 | Home, briefs list | An agency has a group and a budget. No destination yet. | Convex |
| 3 | Step 1 form | The brief is the group, the dates, the money and the needs. | Convex |
| 4 | Step 2, type "Portugal" | Type a country. Firecrawl reads published travel sources and fills in the rest. | Firecrawl |
| 5 | Portugal card | What it is strong for, its climate, what to plan around, and the sources. | Firecrawl |
| 6 | Step 3 | Firecrawl finds real incoming tour operators and reads each company's own site. | Firecrawl |
| 7 | Operator cards | Real companies, ranked on what their own sites say they can deliver. | Convex |
| 8 | Step 4 | Shortlist. Each operator gets its own private link, no account needed. | Convex |
| 9 | Step 5 | AgentMail sends each operator its own request. Demo mode: it goes to a stand-in inbox, never to the operator. | AgentMail |
| 10 | Step 6, waiting then arriving | OpenAI answers as each operator. The page updates itself as replies land. | OpenAI, Convex |
| 11 | Reply reader | Every reply answers all 18 numbered requirements. The differences come first. | OpenAI |
| 12 | Comparison grid | Every operator's answer to every requirement, side by side, quoted from their own email. | Convex |
| 13 | Selection and workback | Pick the trip. The schedule works back from departure, using the operator's own deadlines. | Convex |
| 14 | End card | Live app, repo, and the four sponsors. | — |

Rendering: `node videos/record-demo.mjs <url> <out-dir>` records the run, then
ffmpeg speeds up the reply wait and joins the parts into `tripbrief-demo.mp4`.
