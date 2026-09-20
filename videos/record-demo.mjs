// Records the TripBrief demo against a live deployment: one take of the real
// product, with captions drawn over it. Writes the raw recording plus a
// markers.json saying when the wait for replies started and ended, which
// build-demo.mjs uses to speed that stretch up.
//
//   node videos/record-demo.mjs https://hip-minnow-543.convex.site videos/out
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";

const base = process.argv[2] ?? "https://hip-minnow-543.convex.site";
const out = process.argv[3] ?? "videos/out";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 2,
  recordVideo: { dir: out, size: { width: 1280, height: 720 } },
});

// The caption bar and the title cards live in the page, so they are recorded
// with it. Added before any script runs, so a reload keeps them.
await context.addInitScript(() => {
  const paint = () => {
    if (document.getElementById("tb-cap")) return;
    const style = document.createElement("style");
    style.textContent = `
      #tb-cap { position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483647; display: flex; justify-content: center; pointer-events: none; padding: 0 0 28px; }
      #tb-cap span { max-width: 62ch; margin: 0 24px; padding: 14px 24px; border-radius: 14px; background: oklch(0.24 0.03 170 / .92); color: oklch(0.99 0.004 85); font: 600 25px/1.35 "Figtree", system-ui, sans-serif; text-align: center; opacity: 0; transition: opacity .35s ease; box-shadow: 0 10px 40px oklch(0.2 0.02 170 / .35); }
      #tb-cap span.on { opacity: 1; }
      #tb-card { position: fixed; inset: 0; z-index: 2147483646; display: grid; place-content: center; gap: 18px; text-align: center; background: oklch(0.975 0.01 85); opacity: 0; transition: opacity .4s ease; pointer-events: none; padding: 40px; }
      #tb-card.on { opacity: 1; }
      #tb-card h1 { font: 500 66px/1.05 "Newsreader", Georgia, serif; color: oklch(0.28 0.035 170); margin: 0; letter-spacing: -.02em; }
      #tb-card p { font: 500 26px/1.45 "Figtree", system-ui, sans-serif; color: oklch(0.42 0.03 170); margin: 0; }
      #tb-card .row { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-top: 8px; }
      #tb-card .row span { font: 700 19px/1 "Figtree", system-ui, sans-serif; color: oklch(0.39 0.075 168); background: oklch(0.935 0.03 168); padding: 11px 16px; border-radius: 999px; }
    `;
    document.head.append(style);
    const bar = document.createElement("div");
    bar.id = "tb-cap";
    bar.innerHTML = "<span></span>";
    const card = document.createElement("div");
    card.id = "tb-card";
    document.body.append(bar, card);
  };
  const ready = () => { paint(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
  window.__cap = (text) => {
    const bar = document.getElementById("tb-cap");
    const span = bar?.querySelector("span");
    if (!bar || !span) return;
    const dialog = document.querySelector("dialog[open]");
    const host = dialog ?? document.body;
    if (bar.parentElement !== host) host.append(bar);
    if (!text) { span.classList.remove("on"); return; }
    span.classList.remove("on");
    setTimeout(() => { span.textContent = text; span.classList.add("on"); }, 120);
  };
  window.__card = (html) => {
    const card = document.getElementById("tb-card");
    if (!card) return;
    if (!html) { card.classList.remove("on"); return; }
    card.innerHTML = html;
    card.classList.add("on");
  };
});

const page = await context.newPage();
const started = Date.now();
const at = () => (Date.now() - started) / 1000;
const markers = {};
const wait = (ms) => page.waitForTimeout(ms);
const cap = async (text, hold = 0) => { await page.evaluate((value) => window.__cap(value), text); if (hold) await wait(hold); };
const card = async (html, hold = 0) => { await page.evaluate((value) => window.__card(value), html); if (hold) await wait(hold); };
const click = async (name) => { await page.getByRole("button", { name }).first().click(); };
const scroll = async (to, ms = 1200) => {
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
};

await page.goto(base);
await page.waitForTimeout(1500);

// 1. Title
await card(`<h1>TripBrief</h1><p>From a client brief to trips real operators will actually run.</p><div class="row"><span>Convex</span><span>OpenAI</span><span>Firecrawl</span><span>AgentMail</span></div>`, 3800);
await card("", 400);

// 2. Home
await click(/trial workspace/i);
await page.waitForTimeout(3000);
await cap("An agency has a group and a budget. No destination yet.", 3200);

// 3. The brief
await click(/^New brief$/);
await wait(900);
await cap("The brief is the group, the dates, the money and what they need.", 2600);
await scroll(700, 1400);
await wait(1400);
await scroll(1500, 1400);
await cap("Answers here become numbered requirements every operator must answer.", 3000);
await scroll(0, 800);

// 4. A place, looked up live
await click(/Discover Destinations/);
await page.waitForTimeout(2200);
await cap("Type a country. Firecrawl reads published travel sources and fills in the rest.", 2200);
await click(/Add a location/);
await wait(600);
await page.locator('input[list="country-names"]').fill("Portugal");
await wait(900);
markers.lookupStart = at();
await click(/Look it up/);
await page.waitForFunction(() => /is on the list/.test(document.body.innerText), null, { timeout: 90_000 });
markers.lookupEnd = at();
await wait(600);
const portugal = page.locator("article.destination-discovery-card", { hasText: "Portugal" }).first();
await portugal.scrollIntoViewIfNeeded();
await wait(400);
await cap("What it is strong for, its climate, what to plan around, and the sources it came from.", 4600);

// 5. Operators, found on the web
const bali = page.locator("article.destination-discovery-card", { hasText: "Bali" }).first();
await bali.locator("label.destination-select").click();
await wait(600);
await cap("", 200);
await click(/Find ITOs in Selected/);
await page.waitForFunction(() => document.querySelectorAll(".operator-result-card").length > 2, null, { timeout: 120_000 });
await wait(900);
await cap("Firecrawl finds real incoming tour operators and reads each company's own site.", 4000);
await scroll(620, 1400);
await cap("Real companies, ranked on what their own sites say they can deliver.", 4200);
await scroll(1400, 1600);
await wait(1400);

// 6. Shortlist
await click(/^Choose Partners/);
await wait(1400);
const toggles = page.locator(".choose-list label.include-toggle");
await cap("Shortlist. Each operator gets its own private link, and needs no account.", 900);
for (let i = 0; i < 3; i += 1) { await toggles.nth(i).click(); await wait(600); }
await wait(1400);

// 7. Send
await click(/Prepare Trip Request/);
await page.waitForTimeout(2600);
await cap("AgentMail sends each operator its own request, to the address its own site publishes.", 4000);
await scroll(460, 1200);
await cap("Demo mode: every request goes to a stand-in inbox, never to the operator.", 3600);
markers.waitStart = at();
await click(/Send Trip Requests/);
await page.waitForTimeout(4000);
await cap("OpenAI now answers as each operator, the way a real one would.", 3000);
await cap("The page updates itself as each reply lands.", 1000);
await page.waitForFunction(() => /3 of 3 proposals received/.test(document.body.innerText), null, { timeout: 180_000 });
markers.waitEnd = at();
await wait(1200);
await cap("Three replies, each with its own price, dates and differences.", 3400);
await scroll(460, 1200);
await wait(1600);

// 8. Read one reply
await cap("", 200);
// Open a reply that differs from the brief: that is the one worth reading.
const differing = page.locator(".proposal-response-grid article").filter({ hasNotText: "100% covered" }).getByRole("button", { name: /Read full reply/ }).first();
await (await differing.count() ? differing : page.getByRole("button", { name: /^Read full reply/ }).first()).click();
await wait(1600);
await cap("Every reply answers all eighteen numbered requirements, in the operator's own words.", 4200);
await page.evaluate(() => document.querySelector(".reader-body")?.scrollTo({ top: 420, behavior: "smooth" }));
await cap("What a reply does not fully meet comes first, so nothing hides in the prose.", 4000);
await page.keyboard.press("Escape");
await wait(900);

// 9. Compare
await click(/^Compare \d/);
await page.waitForTimeout(2200);
await cap("The comparison is built from the operators' own answers, not a score they gave themselves.", 4000);
await scroll(700, 1400);
await wait(1200);
await page.locator(".requirement-grid-section").scrollIntoViewIfNeeded();
await wait(900);
await cap("Every operator's answer to every requirement, side by side, quoted from their email.", 4600);
await scroll((await page.evaluate(() => document.body.scrollHeight)) - 720, 2000);
await wait(1600);
await cap("", 200);

// 10. Decide
await page.locator(".proposal-compare-table article.recommended").getByRole("button", { name: /Select Trip/ }).first().click();
await page.waitForTimeout(2200);
await cap("Pick the trip. The schedule works back from departure, on that operator's own deadlines.", 4200);
await scroll(900, 1800);
await wait(2600);
await cap("", 300);

// 11. End card
await card(`<h1>TripBrief</h1><p>hip-minnow-543.convex.site</p><p style="font-size:21px">github.com/Slybry2000/tripbrief</p><div class="row"><span>Convex</span><span>OpenAI</span><span>Firecrawl</span><span>AgentMail</span></div>`, 4000);

markers.total = at();
await page.close();
await context.close();
await browser.close();

const file = readdirSync(out).filter((name) => name.endsWith(".webm")).sort().pop();
renameSync(join(out, file), join(out, "raw.webm"));
writeFileSync(join(out, "markers.json"), JSON.stringify(markers, null, 2));
console.log(JSON.stringify(markers, null, 2));
