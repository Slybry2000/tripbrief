// The film layer. Everything here is drawn over the live product: a cursor that
// travels before it clicks, a lower third, a ribbon that points at the thing a
// sponsor's technology just produced, and the title and end cards. It never
// replaces or fakes product pixels.
//
// The page is zoomed for the recording (see FILM_ZOOM in record-demo.mjs), so
// every element in here cancels that zoom and lives in visual pixels. That is
// also what getBoundingClientRect returns, so a ribbon lands exactly on target
// with no conversion, in the page and inside an open <dialog>.
export const OVERLAY = () => {
  const NS = "tbfilm";
  if (window.__tbfilm) return;
  const css = `
  :root{ --f-ink:oklch(0.28 0.035 170); --f-muted:oklch(0.5 0.02 170);
    --f-green:oklch(0.47 0.085 168); --f-green-dark:oklch(0.39 0.075 168);
    --f-mint:oklch(0.935 0.03 168); --f-paper:oklch(0.975 0.01 85);
    --f-white:oklch(0.995 0.004 85); --f-line:oklch(0.9 0.013 110);
    --f-gold:oklch(0.58 0.11 70); --f-gold-bg:oklch(0.96 0.035 85);
    --f-display:"Newsreader",Georgia,serif; --f-body:"Figtree",system-ui,sans-serif;
    --f-ease:cubic-bezier(.22,1,.36,1); }

  /* The recorder owns scroll timing, so the app's smooth scrolling is off. */
  html{ scroll-behavior:auto !important; }

  /* Every film element cancels the document zoom. */
  #${NS}-cur,#${NS}-cap,#${NS}-card,#${NS}-scrim,.${NS}-rib,.${NS}-ring{ zoom:calc(1 / var(--film-zoom,1)); }

  /* ---------- cursor ---------- */
  #${NS}-cur{position:fixed;left:0;top:0;width:28px;height:28px;z-index:2147483645;
    pointer-events:none;will-change:transform;transform:translate3d(-200px,-200px,0);
    filter:drop-shadow(0 3px 6px oklch(0.3 0.03 170/.45))}
  #${NS}-cur svg{display:block;width:28px;height:28px;transform-origin:4px 3px;
    transition:transform .12s var(--f-ease)}
  #${NS}-cur.down svg{transform:scale(.86)}
  .${NS}-ring{position:fixed;left:0;top:0;width:14px;height:14px;border-radius:50%;
    border:2px solid var(--f-green);z-index:2147483644;pointer-events:none;
    animation:${NS}-ring .55s var(--f-ease) forwards}
  @keyframes ${NS}-ring{from{opacity:.85}
    to{width:66px;height:66px;margin:-26px 0 0 -26px;opacity:0;border-width:1px}}

  /* ---------- lower third + scrim ---------- */
  #${NS}-scrim{position:fixed;left:0;right:0;bottom:0;height:380px;z-index:2147483605;
    pointer-events:none;opacity:0;transition:opacity .4s var(--f-ease);
    background:linear-gradient(to top,oklch(0.975 0.01 85/.98) 0,oklch(0.975 0.01 85/.92) 30%,
      oklch(0.975 0.01 85/.6) 62%,transparent 100%)}
  #${NS}-scrim.on{opacity:1}
  #${NS}-cap{position:fixed;left:0;right:0;bottom:0;z-index:2147483610;pointer-events:none;
    /* Inside the title-safe area: a shot that pushes crops up to 3% off the
       bottom, and at 54px the caption was losing its second line. */
    padding:0 0 108px 68px;display:flex;align-items:flex-end}
  #${NS}-cap .wrap{position:relative;max-width:44ch;padding-left:20px;opacity:0;
    transform:translateY(12px);transition:opacity .34s var(--f-ease),transform .34s var(--f-ease)}
  #${NS}-cap .wrap.on{opacity:1;transform:none}
  #${NS}-cap .wrap::before{content:"";position:absolute;left:0;top:3px;bottom:3px;width:3px;
    border-radius:3px;background:var(--f-green);transform:scaleY(0);transform-origin:top;
    transition:transform .45s var(--f-ease) .08s}
  #${NS}-cap .wrap.on::before{transform:scaleY(1)}
  #${NS}-cap .kicker{display:block;font:700 13px/1 var(--f-body);letter-spacing:.18em;
    text-transform:uppercase;color:var(--f-green-dark);margin:0 0 8px}
  #${NS}-cap .kicker:empty{display:none}
  #${NS}-cap .line{display:block;font:500 31px/1.26 var(--f-display);font-style:normal;
    color:var(--f-ink)}

  /* ---------- attribution ribbon ---------- */
  .${NS}-rib{position:fixed;z-index:2147483620;pointer-events:none;opacity:0;
    transition:opacity .3s var(--f-ease)}
  .${NS}-rib.on{opacity:1}
  .${NS}-rib .box{position:absolute;inset:0;border:2px solid var(--f-green);border-radius:14px;
    box-shadow:0 0 0 6px oklch(0.47 0.085 168/.13);animation:${NS}-draw .55s var(--f-ease)}
  @keyframes ${NS}-draw{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
  .${NS}-rib .tab{position:absolute;display:inline-flex;align-items:baseline;gap:10px;
    white-space:nowrap;background:var(--f-green-dark);color:var(--f-white);border-radius:11px;
    padding:9px 15px;box-shadow:0 10px 26px oklch(0.3 0.03 170/.3)}
  .${NS}-rib .tab b{font:800 12px/1 var(--f-body);letter-spacing:.15em;text-transform:uppercase}
  .${NS}-rib .tab span{font:500 15px/1 var(--f-body);color:oklch(0.93 0.02 168)}
  .${NS}-rib.above .tab{bottom:calc(100% + 11px);left:0}
  .${NS}-rib.below .tab{top:calc(100% + 11px);left:0}

  /* ---------- quote link ---------- */
  .${NS}-mark{background:var(--f-gold-bg);
    box-shadow:0 0 0 3px var(--f-gold-bg),inset 0 -2px 0 var(--f-gold);
    border-radius:3px;color:inherit;transition:background .35s var(--f-ease)}
  .${NS}-mark.hot{background:oklch(0.91 0.075 85)}

  /* ---------- cards ---------- */
  #${NS}-card{position:fixed;inset:0;z-index:2147483630;opacity:0;pointer-events:none;
    background:var(--f-paper);transition:opacity .5s var(--f-ease);overflow:hidden;
    display:grid;grid-template-columns:1.02fr .98fr;column-gap:6vw;
    align-content:center;align-items:center;padding:0 7vw}
  #${NS}-card.on{opacity:1}
  body:has(#${NS}-card.on) #${NS}-cur{opacity:0}
  #${NS}-card::after{content:"";position:absolute;inset:0;pointer-events:none;
    background:radial-gradient(105% 70% at 92% -14%,oklch(0.935 0.03 168/.85) 0,transparent 60%)}
  #${NS}-card .lead,#${NS}-card .credits{position:relative;z-index:1}
  #${NS}-card .eyebrow{font:800 14px/1 var(--f-body);letter-spacing:.22em;text-transform:uppercase;
    color:var(--f-green);margin:0 0 22px;display:flex;align-items:center;gap:14px}
  #${NS}-card .eyebrow::after{content:"";height:1px;flex:1;background:var(--f-line);max-width:120px}
  #${NS}-card h1{font:500 96px/0.96 var(--f-display);letter-spacing:-.028em;color:var(--f-ink);
    margin:0 0 20px}
  #${NS}-card .sub{font:400 26px/1.4 var(--f-body);color:var(--f-muted);margin:0;max-width:24ch}
  #${NS}-card .credits{display:grid;gap:22px;margin:0;border-left:1px solid var(--f-line);
    padding-left:5vw}
  #${NS}-card .credits > div{display:grid;grid-template-columns:132px 1fr;gap:4px 18px;
    align-items:baseline}
  #${NS}-card .credits b{font:700 19px/1.3 var(--f-body);color:var(--f-green-dark)}
  #${NS}-card .credits span{font:400 17px/1.45 var(--f-body);color:var(--f-muted);max-width:34ch}
  #${NS}-card .foot{position:absolute;left:7vw;right:7vw;bottom:6vh;z-index:1;display:flex;
    justify-content:space-between;align-items:baseline;gap:24px;
    font:500 17px/1 var(--f-body);color:var(--f-muted)}
  #${NS}-card .foot b{color:var(--f-green-dark);font-weight:700;font-size:21px}
  `;

  const mount = () => {
    if (!document.body) return;
    if (!document.getElementById(`${NS}-style`)) {
      const s = document.createElement("style");
      s.id = `${NS}-style`;
      s.textContent = css;
      document.head.append(s);
    }
    if (document.getElementById(`${NS}-cur`)) return;
    const cur = document.createElement("div");
    cur.id = `${NS}-cur`;
    cur.innerHTML = `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg"><path d="M4 2.4 L4 21.4 L9 16.8 L12.2 24 L15.8 22.4 L12.6 15.3 L19.6 14.8 Z" fill="#ffffff" stroke="#173735" stroke-width="1.7" stroke-linejoin="round"/></svg>`;
    const cap = document.createElement("div");
    cap.id = `${NS}-cap`;
    cap.innerHTML = `<div class="wrap"><b class="kicker"></b><i class="line"></i></div>`;
    const scrim = document.createElement("div");
    scrim.id = `${NS}-scrim`;
    const card = document.createElement("div");
    card.id = `${NS}-card`;
    document.body.append(scrim, cur, cap, card);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();

  const state = { x: -200, y: -200 };
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  // The reader is a <dialog> in the top layer, so the film layer has to move
  // into it or it is painted underneath.
  const host = () => document.querySelector("dialog[open]") ?? document.body;

  window.__tbfilm = {
    mount,
    at: () => ({ ...state }),

    cursorTo(x, y, ms = 440) {
      mount();
      const cur = document.getElementById(`${NS}-cur`);
      if (!cur) return Promise.resolve();
      const x0 = state.x, y0 = state.y;
      // A slight arc, because a hand does not travel in a straight line.
      const bowX = (y - y0) * 0.08, bowY = -(x - x0) * 0.08;
      const t0 = performance.now();
      return new Promise((done) => {
        const frame = (now) => {
          const p = Math.min(1, (now - t0) / ms), e = ease(p), b = Math.sin(p * Math.PI);
          state.x = x0 + (x - x0) * e + bowX * b;
          state.y = y0 + (y - y0) * e + bowY * b;
          cur.style.transform = `translate3d(${state.x}px,${state.y}px,0)`;
          p < 1 ? requestAnimationFrame(frame) : done();
        };
        requestAnimationFrame(frame);
      });
    },

    press() {
      const cur = document.getElementById(`${NS}-cur`);
      cur?.classList.add("down");
      const ring = document.createElement("div");
      ring.className = `${NS}-ring`;
      ring.style.left = `${state.x - 7}px`;
      ring.style.top = `${state.y - 7}px`;
      host().append(ring);
      setTimeout(() => { cur?.classList.remove("down"); ring.remove(); }, 580);
    },

    cap(kicker, line) {
      mount();
      const bar = document.getElementById(`${NS}-cap`);
      const scrim = document.getElementById(`${NS}-scrim`);
      if (!bar) return;
      const h = host();
      if (bar.parentElement !== h) h.append(bar);
      if (scrim && scrim.parentElement !== h) h.append(scrim);
      scrim?.classList.toggle("on", !!line);
      const wrap = bar.querySelector(".wrap");
      if (!line) { wrap.classList.remove("on"); return; }
      wrap.classList.remove("on");
      setTimeout(() => {
        wrap.querySelector(".kicker").textContent = kicker ?? "";
        wrap.querySelector(".line").textContent = line;
        wrap.classList.add("on");
      }, 150);
    },

    // The outline is drawn outside the element and the label sits clear of it,
    // so a ribbon never covers what it is pointing at.
    ribbon(selector, tech, did) {
      this.clearRibbons();
      const el = typeof selector === "string" ? document.querySelector(selector) : selector;
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const pad = 8;
      const rib = document.createElement("div");
      rib.className = `${NS}-rib ${r.top > 82 ? "above" : "below"}`;
      rib.style.left = `${r.left - pad}px`;
      rib.style.top = `${r.top - pad}px`;
      rib.style.width = `${r.width + pad * 2}px`;
      rib.style.height = `${r.height + pad * 2}px`;
      rib.innerHTML = `<div class="box"></div><div class="tab"><b>${tech}</b><span>${did}</span></div>`;
      host().append(rib);
      requestAnimationFrame(() => rib.classList.add("on"));
      return true;
    },
    clearRibbons() {
      document.querySelectorAll(`.${NS}-rib`).forEach((n) => {
        n.classList.remove("on");
        setTimeout(() => n.remove(), 340);
      });
    },

    // Finds a quote verbatim inside a root and wraps it, so the same sentence
    // can be lit in the operator's email and in the grid cell at once.
    markQuote(rootSelector, quote) {
      const root = document.querySelector(rootSelector);
      if (!root || !quote) return 0;
      const clean = (s) => s.replace(/[“”"']/g, "").replace(/\s+/g, " ");
      const needle = clean(quote).trim().slice(0, 80);
      if (needle.length < 12) return 0;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.parentElement?.closest(`.${NS}-mark`)) continue;
        const i = clean(node.nodeValue).indexOf(needle);
        if (i < 0) continue;
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, Math.min(node.nodeValue.length, i + needle.length));
        const mark = document.createElement("mark");
        mark.className = `${NS}-mark`;
        try { range.surroundContents(mark); return 1; } catch { return 0; }
      }
      return 0;
    },
    hotQuotes(on = true) {
      document.querySelectorAll(`.${NS}-mark`).forEach((n) => n.classList.toggle("hot", on));
    },
    clearMarks() {
      document.querySelectorAll(`.${NS}-mark`).forEach((n) => {
        const p = n.parentNode;
        while (n.firstChild) p.insertBefore(n.firstChild, n);
        n.remove();
        p.normalize();
      });
    },

    card(html) {
      mount();
      const card = document.getElementById(`${NS}-card`);
      if (!card) return;
      if (!html) { card.classList.remove("on"); return; }
      card.innerHTML = html;
      card.classList.add("on");
    },
  };
};
