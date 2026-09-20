// Records the TripBrief demo against a live deployment: one take of the real
// product, with the film layer (videos/overlay.mjs) drawn over it. Writes the
// raw recording plus a markers.json describing the captions, the shot
// boundaries and framing, the two stretches where a person would wait, and the
// money shot.
//
//   node videos/record-demo.mjs https://hip-minnow-543.convex.site videos/out
//
// Two things here are not obvious. The page is zoomed 1.5x for the recording,
// because Playwright's recordVideo ignores deviceScaleFactor entirely and a
// 1920x1080 capture of an unzoomed page still renders the product's text too
// small to read at delivery. And the cursor is drawn by us: Playwright's
// recording has no pointer in it, so without this nothing ever appears to be
// clicked and the film reads as a slideshow.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { OVERLAY } from "./overlay.mjs";

const base = process.argv[2] ?? "https://hip-minnow-543.convex.site";
const out = process.argv[3] ?? "videos/out";
const FILM_ZOOM = 1.5;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: out, size: { width: 1920, height: 1080 } },
  colorScheme: "light",
  reducedMotion: "no-preference",
});

// Zoom <html>, not #root: the reply reader is a <dialog> in the browser's top
// layer, and only zooming the document element reaches it. That dialog is the
// money shot, so it has to scale with everything else.
await context.addInitScript((zoom) => {
  const apply = () => {
    document.documentElement.style.setProperty("--film-zoom", String(zoom));
    document.documentElement.style.zoom = String(zoom);
  };
  apply();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply);
}, FILM_ZOOM);
await context.addInitScript(OVERLAY);

const page = await context.newPage();
const started = Date.now();
const at = () => (Date.now() - started) / 1000;
const markers = { captions: [], shots: [], clicks: [] };
const wait = (ms) => page.waitForTimeout(ms);

// A shot boundary. Everything from here until the next one is one continuous
// frame of camera, with its own framing and at most one move.
const shot = (name, opts = {}) => {
  markers.shots.push({ at: at(), name, z0: 1, z1: 1, cx: 0.5, cy: 0.5, ...opts });
};

// Each caption's moment is logged, so the narration can be placed on it later.
const cap = async (kicker, line, hold = 0) => {
  if (line) markers.captions.push({ at: at(), text: line, kicker: kicker ?? "" });
  await page.evaluate(([k, l]) => window.__tbfilm.cap(k, l), [kicker, line]);
  if (hold) await wait(hold);
};

const card = async (html, hold = 0, spoken = "") => {
  if (spoken) markers.captions.push({ at: at(), text: spoken, kicker: "" });
  await page.evaluate((value) => window.__tbfilm.card(value), html);
  if (hold) await wait(hold);
};

// Points at the live element a technology just produced, and names the job it
// did. The outline is drawn outside the element, so it never covers its target.
const ribbon = async (selector, tech, did, hold = 2800) => {
  const ok = await page.evaluate(
    ([s, t, d]) => window.__tbfilm.ribbon(s, t, d),
    [selector, tech, did],
  );
  if (!ok) console.warn(`ribbon missed: ${selector}`);
  if (hold) await wait(hold);
  return ok;
};
const clearRibbon = () => page.evaluate(() => window.__tbfilm.clearRibbons());
// The requirement grid is wider than the viewport at the film's usual zoom, so
// the third operator's column fell off the right edge. That column carries the
// two answers that are only partly met, which is the honest half of the
// comparison, so the grid is shot a little wider instead.
const setZoom = (value) => page.evaluate((z) => window.__tbfilm.zoom(z), value);
// 1.35 is the largest zoom at which nothing clips. The app's wide sections are
// sized in vw, and vw resolves against the unzoomed viewport before the zoom is
// painted, so at 1.5 the grid is laid out 1420 CSS px wide and painted 2130
// device px into a 1920 frame: 210 px, about half an operator column, off the
// right edge.
const GRID_ZOOM = 1.35;

// The cursor travels, settles, and ripples before the real click fires.
const click = async (name) => {
  const target = page.getByRole("button", { name }).first();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box) {
    await page.evaluate(
      ([x, y]) => window.__tbfilm.cursorTo(x, y, 480),
      [box.x + box.width / 2, box.y + box.height / 2],
    );
    await wait(140);
    // Logged so the mix can put a click under it.
    markers.clicks.push(at());
    await page.evaluate(() => window.__tbfilm.press());
    await wait(170);
  }
  await target.click();
  await wait(320);
};

// A scroll that only relocates the viewport is not a shot, it is a cut. The
// jump happens instantly and the cut is placed on it, so it is never seen.
const jump = async (to) => {
  await page.evaluate((y) => window.scrollTo(0, y), to);
  await wait(650);
};

// Kept only where the length of a thing is the point: the operator list, and
// the eighteen rows of the grid. The camera stays locked during these.
const scroll = async (to, ms = 2200) => {
  await page.evaluate(async ({ to, ms }) => {
    const from = window.scrollY;
    const start = performance.now();
    await new Promise((done) => {
      const frame = (now) => {
        const t = Math.min(1, (now - start) / ms);
        window.scrollTo(0, from + (to - from) * (1 - Math.pow(1 - t, 3)));
        t < 1 ? requestAnimationFrame(frame) : done();
      };
      requestAnimationFrame(frame);
    });
  }, { to, ms });
  await wait(1200);
};

// domcontentloaded plus an immediate card, so the sign-in screen is never a
// frame of the film.
await page.goto(base, { waitUntil: "domcontentloaded" });
await page.evaluate(OVERLAY).catch(() => {});
await page.evaluate((zoom) => {
  document.documentElement.style.setProperty("--film-zoom", String(zoom));
  document.documentElement.style.zoom = String(zoom);
}, FILM_ZOOM);
await page.evaluate(() => window.__tbfilm.address(true));

// ---------------------------------------------------------------- title
shot("title", { z0: 1.0, z1: 1.012 });
await card(`
  <div class="lead">
    <p class="eyebrow">All Gas Hackathon</p>
    <h1>TripBrief</h1>
    <p class="sub">A client brief becomes trips real operators have agreed to run.</p>
  </div>
  <div class="credits">
    <div><b>The problem</b><span>An agency has a group, a budget and eighteen requirements. Finding operators who can actually meet them takes weeks of email.</span></div>
    <div><b>This film</b><span>One brief, start to finish, against the live deployment. Nothing is mocked.</span></div>
  </div>`, 4600, "TripBrief turns a client brief into trips real operators will actually run.");
await page.waitForTimeout(400);

// ---------------------------------------------------------------- the brief
await click(/trial workspace/i);
await page.waitForTimeout(2600);
await card("", 300);
await click(/^New brief$/);
await wait(900);
shot("brief-form", { z0: 1.0, z1: 1.06, cy: 0.28, xfadeIn: 0.4 });
await cap(null, "A group, a budget, no destination.", 3400);
await jump(760);
shot("brief-needs", { z0: 1.0, z1: 1.05, cy: 0.35 });
await cap(null, "Who is travelling, when, the money, and what they need.", 4400);
await jump(1500);
shot("requirements", { cy: 0.32 });
await cap(null, "Each answer becomes a numbered requirement.", 3400);
await jump(0);

// ---------------------------------------------------------- a place, live
await click(/Discover Destinations/);
await page.waitForTimeout(2000);
shot("place-type", { cy: 0.3 });
await cap("Firecrawl", "Type a country.", 900);
await click(/Add a location/);
await wait(600);
// Typed a character at a time, because the previous cut claimed a country was
// typed over a field that stayed empty for the whole shot.
await page.locator('input[list="country-names"]').pressSequentially("Portugal", { delay: 130 });
// Held, because the point of the shot is that a person typed a country and the
// rest was filled in from the web.
await wait(1700);
markers.lookupStart = at();
await click(/Look it up/);
shot("place-waiting", { cy: 0.3 });
await page.waitForFunction(() => /is on the list/.test(document.body.innerText), null, { timeout: 90_000 });
markers.lookupEnd = at();
await wait(700);
const portugal = page.locator("article.destination-discovery-card", { hasText: "Portugal" }).first();
await portugal.scrollIntoViewIfNeeded();
await wait(500);
shot("place-card", { z0: 1.0, z1: 1.06, cy: 0.42 });
await cap("Firecrawl", "Strengths, climate, what to plan around, and the sources.", 1000);
await ribbon("article.destination-discovery-card", "Firecrawl", "fetched the published sources behind this", 3000);
await clearRibbon();

// -------------------------------------------------- operators, from the web
const bali = page.locator("article.destination-discovery-card", { hasText: "Bali" }).first();
await bali.locator("label.destination-select").click();
await wait(500);
await cap(null, null);
await click(/Find ITOs in Selected/);
shot("operators-waiting", { cy: 0.3 });
await page.waitForFunction(() => document.querySelectorAll(".operator-result-card").length > 2, null, { timeout: 120_000 });
await wait(900);
shot("operators", { z0: 1.0, z1: 1.05, cy: 0.36 });
await cap("Firecrawl", "Real operators, found on the web.", 3200);
shot("operators-list", { cy: 0.42 });
await scroll(700);
await cap("OpenAI", "It reads each site and decides which are really operators.", 1200);
await ribbon(".operator-result-card", "OpenAI", "read this site and judged the company", 3400);
await clearRibbon();

// ---------------------------------------------------------------- shortlist
await click(/^Choose Partners/);
await wait(1200);
shot("shortlist", { z0: 1.0, z1: 1.05, cy: 0.35 });
await cap("Convex", "Shortlist three. Each gets a private link, no account.", 700);
const toggles = page.locator(".choose-list label.include-toggle");
for (let i = 0; i < 3; i += 1) { await toggles.nth(i).click(); await wait(560); }
await wait(1100);

// ------------------------------------------------------------- the email out
await click(/Prepare Trip Request/);
await page.waitForTimeout(2200);
shot("send", { cy: 0.34 });
await cap("AgentMail", "It writes to the address each site publishes.", 4600);
await jump(460);
shot("send-demo", { cy: 0.4 });
await cap(null, "In demo mode it all goes to a stand-in inbox.", 3000);
await click(/Send Trip Requests/);
await page.waitForTimeout(3200);

// ------------------------------------------------- the replies come back
shot("waiting", { cy: 0.3 });
await cap("OpenAI", "Each operator answers the way a real one would.", 3400);
// Only silence is sped up, so no narration is ever compressed.
markers.waitStart = at();
await page.waitForFunction(() => /3 of 3 proposals received/.test(document.body.innerText), null, { timeout: 180_000 });
markers.waitEnd = at();
await wait(900);
shot("arrived", { cy: 0.26 });
await cap("Convex", "Nobody refreshed this page.", 1000);
await ribbon(".success-banner", "Convex", "caught the reply on an HTTP webhook", 3400);
await clearRibbon();
await cap("Convex", "A cron sweeps every fifteen minutes for any reply that missed.", 5400);
shot("replies", { z0: 1.0, z1: 1.05, cy: 0.4 });
await cap(null, "Three replies. Three prices, three sets of dates.", 3200);
await jump(460);

// ------------------------------------------------------------- the money shot
await cap(null, null);
// A reply that differs from the brief is the one worth reading.
const differing = page.locator(".proposal-response-grid article").filter({ hasNotText: "100% covered" }).getByRole("button", { name: /Read full reply/ }).first();
await (await differing.count() ? differing : page.getByRole("button", { name: /^Read full reply/ }).first()).click();
await wait(1500);
shot("reader-prose", { z0: 1.0, z1: 1.04, cy: 0.42, xfadeIn: 0.4 });
await cap("AgentMail", "This is what the operator actually wrote back.", 4200);
await page.keyboard.press("Escape");
await wait(800);

await click(/^Compare \d/);
await page.waitForTimeout(2000);
await setZoom(GRID_ZOOM);
await wait(500);
await page.locator(".requirement-grid-section").scrollIntoViewIfNeeded();
await wait(900);

// The same sentence is rendered twice by the app: in the operator's prose and
// in the grid cell that cites it. Lighting both proves the answer was taken
// from the email rather than written about it.
const linked = await page.evaluate(() => {
  const cell = [...document.querySelectorAll(".requirement-grid td.answer")]
    .find((td) => td.querySelector("q") && /\b(no|partly)\b/.test(td.className));
  const quote = cell?.querySelector("q")?.textContent ?? "";
  const rid = cell?.closest("tr")?.querySelector(".requirement-id")?.textContent?.trim();
  return { quote, rid, inGrid: window.__tbfilm.markQuote(".requirement-grid", quote) };
});
markers.moneyShot = { at: at(), requirement: linked.rid ?? null, linked: linked.inGrid === 1 };
if (!linked.inGrid) console.warn("quote link failed:", JSON.stringify(linked).slice(0, 200));
await page.evaluate(() => window.__tbfilm.hotQuotes(true));
shot("grid-wide", { cy: 0.4 });
await cap("OpenAI", "All eighteen requirements, answered.", 5000);
shot("grid-detail", { z0: 1.04, z1: 1.04, cy: 0.45 });
await cap(null, "Every answer is quoted from their own email.", 4000);
shot("grid-scroll", { cy: 0.45 });
await scroll((await page.evaluate(() => document.body.scrollHeight)) - 1080, 2400);
await cap(null, "A quote that is not in the email, word for word, never reaches the screen.", 4400);
markers.coldOpen = { from: markers.moneyShot.at + 1.2, to: markers.moneyShot.at + 5.2 };
await page.evaluate(() => { window.__tbfilm.hotQuotes(false); window.__tbfilm.clearMarks(); });
await setZoom(FILM_ZOOM);

// ---------------------------------------------------------------- the choice
await cap(null, null);
await page.locator(".proposal-compare-table article.recommended").getByRole("button", { name: /Select Trip/ }).first().click();
await page.waitForTimeout(2000);
shot("selected", { z0: 1.0, z1: 1.05, cy: 0.3 });
await cap(null, "Pick the trip. The schedule works back from departure.", 3800);
await jump(900);
shot("workback", { cy: 0.42 });
await wait(2600);
await cap(null, null);
await wait(400);

// ---------------------------------------------------------------- end card
shot("end", { xfadeIn: 0.4 });
await card(`
  <div class="lead">
    <p class="eyebrow">All Gas Hackathon</p>
    <h1>TripBrief</h1>
    <p class="sub">A client brief becomes trips real operators have agreed to run.</p>
  </div>
  <div class="credits">
    <div><b>Convex</b><span>Holds every brief, reply and comparison, and updates the page the moment one lands.</span></div>
    <div><b>Firecrawl</b><span>Read published travel sources and each operator's own site to find them.</span></div>
    <div><b>OpenAI</b><span>Turned each free-prose reply into answers to all 18 numbered requirements.</span></div>
    <div><b>AgentMail</b><span>Sent every operator its own request and caught the reply that came back.</span></div>
  </div>
  <div class="foot"><b>hip-minnow-543.convex.site</b><span>github.com/Slybry2000/tripbrief</span></div>`,
  7000, "Built on Convex, with OpenAI, Firecrawl and AgentMail. Live now, code public.");

markers.total = at();
await page.close();
await context.close();
await browser.close();

const file = readdirSync(out).filter((name) => name.endsWith(".webm")).sort().pop();
renameSync(join(out, file), join(out, "raw.webm"));
writeFileSync(join(out, "markers.json"), JSON.stringify(markers, null, 2));
console.log(JSON.stringify({
  total: Number(markers.total.toFixed(1)),
  shots: markers.shots.length,
  captions: markers.captions.length,
  moneyShot: markers.moneyShot,
}, null, 2));
