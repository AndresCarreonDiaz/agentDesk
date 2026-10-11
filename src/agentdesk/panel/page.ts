// The panel page: one self-contained HTML document, inline CSS and vanilla JS, no build step.
// Every string from the database goes through esc() before it reaches innerHTML.
// The look follows the approved design (mockup C): numbered, collapsible sections, light and dark tokens.

export const PANEL_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>AgentDesk panel</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap">
<style>

/* Layout: slim header, one full-width hero (3 visit columns), then a fixed 7/5 grid:
   left = how it teaches + visits, right = learned actions, guardrails, autopilot. */
:root {
  --bg: #F6F7F9;
  --surface: #FFFFFF;
  --subtle: #F1F3F6;
  --line: #E3E6EB;
  --line-strong: #CDD2DA;
  --fg: #14171C;
  --muted: #5B6370;
  --faint: #8A919C;
  --accent: #2456D3;          /* only for: learned / the desk did it */
  --accent-soft: #EAF0FD;
  --accent-line: #BCCDF5;
  --ok: #17803D;  --ok-soft: #E8F5EC;
  --err: #C4302B; --err-soft: #FCECEB;
  --f-ui: "Inter", "Helvetica Neue", Arial, sans-serif;
  --f-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --r: 12px;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #111317; --surface: #181B20; --subtle: #1F2329; --line: #2A2F37; --line-strong: #3A404A;
    --fg: #ECEEF1; --muted: #A3AAB5; --faint: #767E8A;
    --accent: #7FA2F5; --accent-soft: #1D2740; --accent-line: #34487A;
    --ok: #5CC787; --ok-soft: #17291F; --err: #F07670; --err-soft: #321C1C;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #111317; --surface: #181B20; --subtle: #1F2329; --line: #2A2F37; --line-strong: #3A404A;
  --fg: #ECEEF1; --muted: #A3AAB5; --faint: #767E8A;
  --accent: #7FA2F5; --accent-soft: #1D2740; --accent-line: #34487A;
  --ok: #5CC787; --ok-soft: #17291F; --err: #F07670; --err-soft: #321C1C;
  color-scheme: dark;
}

*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; }
body {
  background: var(--bg); color: var(--fg);
  font: 400 15px/1.5 var(--f-ui);
  -webkit-font-smoothing: antialiased;
  padding-inline: 16px;
}
.mono { font-family: var(--f-mono); }
.num { font-variant-numeric: tabular-nums; }
button { font: inherit; color: inherit; cursor: pointer; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 6px; }
h1, h2, h3, p { margin: 0; }
h1, h2 { text-wrap: balance; letter-spacing: -.02em; }

.page { max-width: 1320px; margin: 0 auto; padding-block: 24px 40px; display: grid; gap: 24px; }
.page > * { min-width: 0; }

/* Header */
.top { border-bottom: 1px solid var(--line); background: var(--surface); margin-inline: -16px; padding: 10px 16px; position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; }
.top-in { max-width: 1320px; margin: 0 auto; display: flex; align-items: center; gap: 12px 16px; flex-wrap: wrap; font-size: 14px; }
.brand { font-weight: 700; letter-spacing: -.01em; }
.site { color: var(--muted); }
.site b { color: var(--fg); font-weight: 500; }
.top .spacer { flex: 1; }
.ap-state { color: var(--muted); }
.ap-state b { color: var(--fg); font-weight: 600; }
.theme-btn { border: 1px solid var(--line); background: var(--surface); border-radius: 8px; padding: 4px 10px; font-size: 13px; color: var(--muted); }
.theme-btn:hover { color: var(--fg); border-color: var(--line-strong); }

/* Cards */
.card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); min-width: 0; }
/* Section headers: a tinted band, a numbered badge and a large title, so each section is obvious at a glance. */
main { counter-reset: sec; }
.card { overflow: hidden; }
.card-h { padding: 18px 22px 16px; border-bottom: 1px solid var(--line-strong); background: var(--subtle); counter-increment: sec; }
.card-h h2 { font-size: 22px; font-weight: 700; letter-spacing: -.025em; display: flex; align-items: center; gap: 12px; color: var(--fg); }
.card-h h2::before { content: counter(sec); flex: none; width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center;
  background: var(--fg); color: var(--surface); font: 700 14px/1 var(--f-mono, ui-monospace, monospace); letter-spacing: 0; }
.card-h p { color: var(--muted); font-size: 14.5px; margin-top: 6px; padding-left: 40px; }
.card-b { padding: 18px 22px; }
.row + .row { border-top: 1px solid var(--line); }

/* Hero */
.hero { padding: 26px 26px 24px; display: grid; gap: 22px; }
.hero h1 { font-size: clamp(26px, 3vw, 36px); font-weight: 700; line-height: 1.15; }
.hero .goal { color: var(--muted); margin-top: 6px; font-size: 15px; }
.hero .goal b { color: var(--fg); font-weight: 600; }
.visits3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.vcol { border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; display: grid; gap: 12px; align-content: start; min-width: 0; }
.vcol-h { font-size: 13px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
.big { display: flex; align-items: baseline; gap: 10px; }
.big .n { font-size: 56px; font-weight: 700; line-height: 1; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
.big .u { color: var(--muted); font-size: 14px; }
.vcol.desk .big .n { color: var(--accent); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; min-height: 30px; align-content: flex-start; }
.chip { display: inline-flex; align-items: center; gap: 6px; font: 500 12px/1 var(--f-mono); padding: 6px 8px; border-radius: 6px; background: var(--subtle); border: 1px solid var(--line); max-width: 100%; }
.chip .m { font-weight: 600; color: var(--muted); }
.chip .p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.chip.learned { background: var(--accent-soft); border-color: var(--accent-line); color: var(--accent); }
.st { font: 600 12px/1 var(--f-mono); }
.st.s2 { color: var(--ok); }
.st.s4 { color: var(--err); }
.vmeta { color: var(--faint); font-size: 13px; }

/* Main grid */
.grid { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: 24px; align-items: start; }
.col { display: grid; gap: 24px; min-width: 0; }

/* Teaching card */
.steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; list-style: none; margin: 0; padding: 0; }
.step button { width: 100%; text-align: left; border: 1px solid var(--line); background: var(--surface); border-radius: 8px; padding: 10px 12px; display: grid; gap: 2px; transition: border-color .2s, background-color .2s; }
.step .k { font-size: 12px; color: var(--faint); font-weight: 500; }
.step .t { font-size: 14px; font-weight: 600; }
.step button:hover { border-color: var(--line-strong); }
.step button[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); }
.step button[aria-pressed="true"] .t { color: var(--accent); }
.compare { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; margin-top: 16px; }
.lbox { border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; display: grid; gap: 6px; transition: border-color .25s, opacity .25s; }
.lbox .lh { font-size: 12px; color: var(--faint); font-weight: 500; display: flex; gap: 8px; flex-wrap: wrap; }
.lbox .lt { font: 500 13.5px/1.55 var(--f-mono); overflow-wrap: anywhere; }
.lbox .lt .ep { color: var(--muted); }
.lbox mark { background: var(--subtle); color: var(--fg); border-radius: 3px; padding: 0 3px; }
.lbox.after mark { background: var(--accent-soft); color: var(--accent); }
.lbox.current { border-color: var(--accent); }
.lbox.dim { opacity: .55; }
.facts { margin-top: 16px; display: grid; gap: 6px; font-size: 14px; }
.facts div { display: grid; grid-template-columns: 70px minmax(0, 1fr); gap: 10px; }
.facts dt, .facts .lab { color: var(--faint); font-weight: 500; }
.facts .ok { color: var(--ok); font-weight: 600; }

/* Visits list */
.visit { padding: 14px 22px; display: grid; gap: 4px; }
.visit-top { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; }
.agent { font: 600 13px var(--f-mono); }
.goal-t { font-weight: 500; }
.visit-top .spacer { flex: 1; }
.vstats { font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.vstats b { color: var(--fg); font-weight: 600; }
.vstats .acc { color: var(--accent); }
.why { color: var(--muted); font-size: 14px; max-width: 72ch; }
.why code { font: 500 13px var(--f-mono); color: var(--fg); }
.why code.lrn { color: var(--accent); }
.fdiff { margin-top: 6px; font: 500 12.5px/1.5 var(--f-mono); padding: 7px 10px; border-radius: 6px; background: var(--subtle); border: 1px solid var(--line); overflow-wrap: anywhere; }
.badge { font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px; }
.b-ok { color: var(--ok); background: var(--ok-soft); }
.b-err { color: var(--err); background: var(--err-soft); }
.b-idle { color: var(--muted); background: var(--subtle); }

/* Learned actions */
.act { padding: 16px 22px; display: grid; gap: 10px; }
.act-top { display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap; }
.act-name { font: 600 14px var(--f-mono); }
.act-desc { color: var(--muted); font-size: 14px; }
.act-top .spacer { flex: 1; }
.req { font: 500 12.5px var(--f-mono); color: var(--fg); overflow-wrap: anywhere; }
.req .b { color: var(--muted); }
.stages { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; }
.stage { display: grid; gap: 4px; font-size: 12px; color: var(--faint); }
.stage::before { content: ""; height: 4px; border-radius: 2px; background: var(--line); }
.stage.done::before { background: var(--line-strong); }
.stage.cur::before { background: var(--accent); }
.stage.cur { color: var(--accent); font-weight: 600; }
.act-row { display: flex; align-items: center; gap: 8px 16px; flex-wrap: wrap; font-size: 13px; color: var(--muted); }
.act-row b { color: var(--fg); font-weight: 600; }
.act-row .spacer { flex: 1; }
.pill-paused { font-size: 12px; font-weight: 600; color: var(--err); background: var(--err-soft); padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
.tbtn { border: 0; background: none; padding: 4px 6px; border-radius: 6px; font-size: 13px; font-weight: 500; color: var(--muted); }
.tbtn:hover { color: var(--fg); background: var(--subtle); }
.tbtn[aria-pressed="true"] { color: var(--fg); background: var(--subtle); font-weight: 600; }

/* Guardrails */
.gr { padding: 16px 22px; display: grid; gap: 10px; }
.gr-t { font-size: 14px; }
.gr-t code { font: 500 13px var(--f-mono); }
.gr-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 13px; color: var(--faint); }
.gr-row .spacer { flex: 1; }
.ev { font: 500 12px var(--f-mono); padding: 2px 7px; border-radius: 5px; border: 1px solid var(--line); background: var(--subtle); color: var(--muted); }
.rule-form { display: flex; gap: 8px; }
.rule-form input { flex: 1; min-width: 0; font: 400 14px var(--f-ui); color: var(--fg); background: var(--surface); border: 1px solid var(--line-strong); border-radius: 8px; padding: 8px 12px; }
.rule-form input:focus { outline: 0; border-color: var(--fg); }
.rule-form button { border: 1px solid var(--fg); border-radius: 8px; padding: 0 14px; background: var(--fg); color: var(--surface); font-size: 14px; font-weight: 500; white-space: nowrap; }
.rules { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 14px; color: var(--muted); }
.rules li::before { content: "•"; color: var(--faint); margin-right: 8px; }

/* Autopilot */
.ap-h { display: flex; align-items: flex-start; gap: 16px; }
.ap-h > div { flex: 1; min-width: 0; }
.switch { position: relative; width: 42px; height: 24px; border-radius: 999px; border: 0; background: var(--line-strong); padding: 0; flex: none; transition: background-color .2s; margin-top: 2px; }
.switch::after { content: ""; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: var(--surface); transition: left .2s; }
.switch[aria-checked="true"] { background: var(--fg); }
.switch[aria-checked="true"]::after { left: 21px; }
.audit { list-style: none; margin: 0; padding: 8px 22px 14px; }
.audit li { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 10px; padding: 8px 0; font-size: 14px; }
.audit li + li { border-top: 1px solid var(--line); }
.audit time { font: 400 12.5px/1.7 var(--f-mono); color: var(--faint); }
.audit .tx { overflow-wrap: anywhere; color: var(--muted); }
.audit code { font: 500 12.5px var(--f-mono); color: var(--fg); }
.audit .s2 { color: var(--ok); } .audit .s4 { color: var(--err); }

footer { text-align: center; color: var(--faint); font-size: 13px; }

/* Responsive */
@media (max-width: 1080px) {
  .grid { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 760px) {
  .visits3 { grid-template-columns: minmax(0, 1fr); }
  .compare { grid-template-columns: minmax(0, 1fr); }
  .hero { padding: 20px 16px; }
  .card-h, .card-b, .visit, .act, .gr { padding-inline: 16px; }
  .audit { padding-inline: 16px; }
  .big .n { font-size: 44px; }
}
@media (max-width: 480px) {
  .steps { grid-template-columns: minmax(0, 1fr); }
  .top .site span { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition-duration: .001s !important; animation-duration: .001s !important; }
}

/* Learning curve */
.curve-legend { display: flex; flex-wrap: wrap; gap: 8px 22px; font-size: 13.5px; color: var(--muted); margin-bottom: 10px; }
.curve-legend span { display: inline-flex; align-items: center; gap: 8px; }
.lg { width: 18px; height: 3px; border-radius: 2px; display: inline-block; }
.lg-req { background: var(--fg); } .lg-tools { background: var(--line-strong); }
.lg-learn { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); }
.curve-svg { width: 100%; height: auto; display: block; }
.curve-svg .grid-l line { stroke: var(--line); stroke-width: 1; }
.curve-svg .grid-l line.base { stroke: var(--line-strong); }
.curve-svg .ax text { fill: var(--faint); font: 500 12px var(--f-mono); text-anchor: end; }
.curve-svg .ax .xl { fill: var(--fg); font: 600 13px var(--f-ui, inherit); text-anchor: middle; }
.curve-svg .ax .xs { fill: var(--faint); text-anchor: middle; }
.curve-svg polyline { fill: none; stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; }
.curve-svg .s-tools { stroke: var(--line-strong); stroke-dasharray: 5 5; }
.curve-svg .s-req { stroke: var(--fg); }
.curve-svg .pt-tools circle { fill: var(--surface); stroke: var(--line-strong); stroke-width: 2; }
.curve-svg .pt-req circle { fill: var(--fg); }
.curve-svg .pt-learn circle { fill: var(--accent); stroke: var(--surface); stroke-width: 2; }
.curve-svg .vl text { fill: var(--muted); font: 600 12px var(--f-mono); text-anchor: middle; }
.curve-svg .vl text.r { fill: var(--fg); font-size: 14px; text-anchor: start; }

/* Expandable sections: click a header to fold it; long lists show the latest 2 items */
.card-h.fold { cursor: pointer; user-select: none; position: relative; padding-right: 56px; }
.card-h.fold:hover { background: color-mix(in srgb, var(--subtle) 70%, var(--line)); }
.fold-btn { position: absolute; right: 18px; top: 50%; transform: translateY(-50%); width: 30px; height: 30px; border-radius: 8px;
  border: 1px solid var(--line-strong); background: var(--surface); display: grid; place-items: center; color: var(--muted); pointer-events: none; }
.fold-btn svg { width: 14px; height: 14px; transition: transform .2s; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.card.folded .fold-btn svg { transform: rotate(-90deg); }
.card.folded > :not(.card-h) { display: none; }
.card.folded .card-h { border-bottom: 0; }
.is-extra { display: none !important; }
.more-btn { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 11px; border: 0; border-top: 1px solid var(--line);
  background: transparent; color: var(--accent); font: 600 13.5px var(--f-ui, inherit); cursor: pointer; }
.more-btn:hover { background: var(--subtle); }
ul > .more-li { list-style: none; }

.muted { color: var(--muted); }
.empty { color: var(--muted); padding: 18px 22px; font-size: 14px; }
.vcol-empty { color: var(--muted); font-size: 15px; }
.btns { display: inline-flex; gap: 4px; }
.rule-form input[name=method] { flex: 0 0 76px; }
.rule-form input[name=path] { flex: 0 0 140px; }
.rule-form { flex-wrap: wrap; }
.tbtn:disabled, .step button:disabled { opacity: .5; cursor: default; }
#status { color: var(--faint); font-size: 13px; }
</style>
</head>
<body>

<header class="top">
  <div class="top-in">
    <span class="brand">AgentDesk panel</span>
    <span class="site" id="site"></span>
    <span class="spacer"></span>
    <span id="status">loading…</span>
    <span class="ap-state">Autopilot: <b id="ap-top">off</b></span>
    <button class="theme-btn" type="button" id="theme">Light / dark</button>
  </div>
</header>

<main class="page">

  <section class="card hero" aria-labelledby="h-hero">
    <div>
      <h1 id="h-hero">Each visitor needs the website less</h1>
      <p class="goal" id="hero-goal"></p>
    </div>
    <div class="visits3" id="hero"></div>
  </section>

  <div class="grid">
    <div class="col">

      <section class="card" aria-labelledby="h-teach" id="sec-teach">
        <div class="card-h">
          <h2 id="h-teach">The desk improved how it teaches</h2>
          <p>How the desk words the lesson it gives the next agent after a failure. Click a step.</p>
        </div>
        <div class="card-b" id="teach"></div>
      </section>

      <section class="card" aria-labelledby="h-visits" id="sec-visits">
        <div class="card-h">
          <h2 id="h-visits">Visits</h2>
          <p>Every agent visit, judged by what the site answered.</p>
        </div>
        <div id="feed"></div>
      </section>
    </div>

    <div class="col">

      <section class="card" aria-labelledby="h-acts" id="sec-acts">
        <div class="card-h">
          <h2 id="h-acts">Learned actions</h2>
          <p>Shortcuts the desk built from visits. Nobody wrote them by hand.</p>
        </div>
        <div id="caps"></div>
      </section>

      <section class="card" aria-labelledby="h-gr" id="sec-gr">
        <div class="card-h">
          <h2 id="h-gr">Guardrails</h2>
          <p>Rules agents must follow. The desk can propose new ones.</p>
        </div>
        <div>
          <div id="proposed"></div>
          <div class="gr row">
            <form class="rule-form" id="rule-form">
              <input name="text" autocomplete="off" aria-label="Rule in plain words" placeholder="Add a rule, e.g. agents may not apply coupons" required>
              <input name="method" autocomplete="off" aria-label="Method" placeholder="Method" value="POST" required>
              <input name="path" autocomplete="off" aria-label="Path" placeholder="/path" required>
              <button type="submit">Add a rule</button>
            </form>
            <ul class="rules" id="rules"></ul>
          </div>
        </div>
      </section>

      <section class="card" aria-labelledby="h-ap" id="sec-ap">
        <div class="card-h ap-h">
          <div>
            <h2 id="h-ap">Autopilot</h2>
            <p id="ap-sub">Off: the desk waits for your approval before it runs an action.</p>
          </div>
          <button class="switch" type="button" role="switch" aria-checked="false" id="autopilot" aria-labelledby="h-ap"></button>
        </div>
        <div id="audit"></div>
      </section>
    </div>
  </div>

  <section class="card curve" aria-labelledby="h-curve" id="sec-curve" style="margin-top:20px">
    <div class="card-h">
      <h2 id="h-curve">Learning curve</h2>
      <p>Same goal, visit after visit: how much work the agent needed.</p>
    </div>
    <div class="card-b" id="curve"></div>
  </section>

  <footer>Memory: MongoDB Atlas · Embeddings: Voyage · Model: Gemini · Signals: Raindrop</footer>
</main>

<script>
(function () {
  var token = new URLSearchParams(location.search).get("token") || "";
  var $ = function (id) { return document.getElementById(id); };
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  var base = location.pathname.replace(/\\/?$/, "/");
  function url(path) { return base + path + "?token=" + encodeURIComponent(token); }
  function post(path, body) {
    return fetch(url(path), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function empty(msg) { return '<div class="empty">' + esc(msg) + "</div>"; }
  function clock(v) { return v ? new Date(v).toTimeString().slice(0, 8) : ""; }
  function secs(ms) { return Math.round((ms || 0) / 100) / 10; }
  function num(n) { return Math.round(n * 10) / 10; }
  function code(t, cls) { return "<code" + (cls ? ' class="' + cls + '"' : "") + ">" + esc(t) + "</code>"; }
  var CHEV = '<svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg>';

  // Which lists are expanded, which sections are folded and which teaching step is picked survive each refresh.
  var openLists = {};
  var picked = null;
  var last = "";

  // A list keeps the latest 2 items; the rest sit behind "Show N more".
  function limited(key, items, tag) {
    if (items.length <= 2) return items.join("");
    var open = !!openLists[key];
    var shown = items.map(function (h, i) { return i < 2 || open ? h : ""; }).join("");
    var label = open ? "Show less" : "Show " + (items.length - 2) + " more";
    var btn = '<button type="button" class="more-btn" data-more="' + esc(key) + '">' + esc(label) + " " + CHEV.replace("<svg", '<svg style="width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2;' + (open ? "transform:rotate(180deg)" : "") + '"') + "</button>";
    return shown + (tag === "li" ? '<li class="more-li">' + btn + "</li>" : btn);
  }

  function btns(kind, id, yes, no, cur) {
    return '<span class="btns">' +
      '<button type="button" class="tbtn" data-kind="' + kind + '" data-id="' + esc(id) + '" data-value="' + yes[0] + '" aria-pressed="' + (cur === yes[0]) + '">' + yes[1] + "</button>" +
      '<button type="button" class="tbtn" data-kind="' + kind + '" data-id="' + esc(id) + '" data-value="' + no[0] + '" aria-pressed="' + (cur === no[0]) + '">' + no[1] + "</button></span>";
  }

  // ---- hero ----
  function stClass(status) { return status >= 400 ? "s4" : "s2"; }
  function hero(s) {
    var closed = s.episodes.filter(function (e) { return e.outcome !== "open"; })
      .sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });
    if (!closed.length) {
      $("hero-goal").textContent = "";
      return '<div class="vcol"><p class="vcol-empty">No visits yet. The desk starts empty.</p></div>';
    }
    var newest = closed[closed.length - 1];
    var same = closed.filter(function (e) { return e.goal && e.goal === newest.goal; });
    var picks = (same.length >= 2 ? same : closed).slice(-3);
    var numbers = {};
    s.metrics.visits.forEach(function (v) { numbers[v.episodeId] = v.n; });
    $("hero-goal").innerHTML = same.length >= 2
      ? "Same goal, " + esc(plural(picks.length, "visit", "visits")) + ": <b>“" + esc(newest.goal) + "”</b>"
      : "The latest " + esc(plural(picks.length, "visit", "visits"));
    return picks.map(function (e, i) {
      var chips = (e.requests || []).map(function (r) {
        var learned = r.source === "capability";
        return '<span class="chip' + (learned ? " learned" : "") + '">' + (learned ? "" : '<span class="m">' + esc(r.method) + "</span>") +
          '<span class="p">' + esc(learned ? "learned: " + r.method + " " + r.path : r.path) + '</span><span class="st ' + stClass(r.status) + '">' + esc(r.status) + "</span></span>";
      }).join("");
      return '<article class="vcol' + (e.usedLearned ? " desk" : "") + '">' +
        '<div class="vcol-h">Visit ' + esc(numbers[e.episodeId] || i + 1) + "</div>" +
        '<div class="big"><span class="n">' + esc(e.siteRequests) + '</span><span class="u">' + (e.siteRequests === 1 ? "site request" : "site requests") + "</span></div>" +
        '<div class="chips">' + chips + "</div>" +
        '<p class="vmeta">' + esc(plural(e.steps || 0, "tool call", "tool calls")) + " · " + esc(secs(e.durationMs)) + " s</p></article>";
    }).join("");
  }

  // ---- teaching ----
  var STYLE_NAME = { field: "names the field", example: "example" };
  function teach(s) {
    var pbs = (s.playbooks || []).slice().sort(function (a, b) { return a.version - b.version; });
    if (!pbs.length) {
      return '<ol class="steps" aria-label="Lesson style history">' + stepButton(1, "v1 · names the field", true, false) +
        stepButton(2, "v2 · example, on trial", false, true) + stepButton(3, "v2 decided", false, true) + "</ol>" +
        '<div class="facts"><div><span class="lab">Now</span><span>Lesson style: field (default). The desk changes it if agents keep failing after a lesson.</span></div></div>';
    }
    var pb = pbs[pbs.length - 1];
    var decided = pb.status === "kept" || pb.status === "reverted";
    var reached = decided ? 3 : 2;
    var cur = picked && picked <= reached ? picked : reached;
    var ver = "v" + pb.version;
    var trig = pb.trigger ? pb.trigger.method + " " + pb.trigger.path : "the failing route";
    var field = pb.trigger && pb.trigger.field ? pb.trigger.field : "the field";
    var afterState = cur === 3 ? pb.status : "on trial";
    return '<ol class="steps" aria-label="Lesson style history">' +
      stepButton(1, "v1 · names the field", cur === 1, false) +
      stepButton(2, ver + " · example, on trial", cur === 2, false) +
      stepButton(3, decided ? ver + " " + pb.status : ver + " decided", cur === 3, !decided) + "</ol>" +
      '<div class="compare">' +
      '<div class="lbox before' + (cur === 1 ? " current" : " dim") + '"><div class="lh">Before · v1</div><div class="lt"><span class="ep">' + esc(trig) + ':</span> <mark>include ' + esc(field) + "</mark></div></div>" +
      '<div class="lbox after' + (cur !== 1 ? " current" : " dim") + '"><div class="lh">After · ' + esc(ver) + " · " + esc(afterState) + '</div><div class="lt"><span class="ep">' + esc(trig) + ':</span> <mark>send a body like a request that worked</mark></div></div></div>' +
      '<div class="facts">' +
      '<div><span class="lab">Reason</span><span>' + esc(pb.reason) + "</span></div>" +
      '<div><span class="lab">Verdict</span><span>' + (pb.result ? esc(pb.result) : "Trial open: the next agent that writes this route decides it.") + "</span></div></div>";
  }
  function stepButton(n, label, pressed, off) {
    return '<li class="step"><button type="button" data-s="' + n + '" aria-pressed="' + pressed + '"' + (off ? " disabled" : "") + '><span class="k">Step ' + n + '</span><span class="t">' + esc(label) + "</span></button></li>";
  }

  // ---- visits ----
  function visit(e) {
    var r = e.reflection;
    var cls = e.outcome === "success" ? "b-ok" : e.outcome === "error" || e.outcome === "blocked" ? "b-err" : "b-idle";
    var why = r && r.why ? esc(r.why)
      : e.usedLearned ? "The agent used a learned action and the site accepted it."
      : e.outcome === "open" ? "This visit is still open."
      : esc(e.doneNote || "No reflection yet.");
    return '<article class="visit row"><div class="visit-top"><span class="agent">' + esc(e.agentFamily) + '</span><span class="goal-t">' + esc(e.goal || "no goal stated") +
      '</span><span class="badge ' + cls + '">' + esc(e.outcome) + '</span><span class="spacer"></span><span class="vstats"><b>' + esc(e.siteRequests) + "</b> " +
      (e.siteRequests === 1 ? "request" : "requests") + " · " + esc(secs(e.durationMs)) + ' s</span></div><p class="why">' + why + "</p>" +
      (r && r.diff ? '<div class="fdiff">' + esc(r.diff) + (e.priorFailureId ? " (fixed the failure from " + esc(e.priorFailureId) + ")" : "") + "</div>" : "") + "</article>";
  }

  // ---- learned actions ----
  var STAGES = ["observed", "proposed", "verified", "approved"];
  function action(c) {
    var st = c.stats || { calls: 0, successes: 0 };
    var fails = st.consecutiveFailures || 0;
    var at = STAGES.indexOf(c.stage);
    var stages = STAGES.map(function (name, i) {
      return '<span class="stage' + (c.stage === "blocked" ? "" : i < at ? " done" : i === at ? " cur" : "") + '">' + name + "</span>";
    }).join("");
    var reqs = (c.mappedRequests || []).map(function (m) {
      var keys = m.bodyTemplate && typeof m.bodyTemplate === "object" ? Object.keys(m.bodyTemplate) : [];
      return '<div class="req">' + esc(m.method) + " " + esc(m.path) + (keys.length ? ' <span class="b">{' + esc(keys.join(", ")) + "}</span>" : "") + "</div>";
    }).join("");
    var pills = (c.stage === "blocked" ? '<span class="pill-paused">Blocked</span>' : "") +
      (fails >= 2 ? '<span class="pill-paused">Paused after ' + esc(plural(fails, "failure", "failures")) + "</span>" : "") +
      (c.waiting ? '<span class="pill-paused">Waiting for you</span>' : "");
    return '<article class="act row"><div class="act-top"><div style="min-width:0"><div class="act-name"' + (c.stage === "approved" || c.stage === "verified" ? ' style="color:var(--accent)"' : "") + ">" + esc(c.name) +
      '</div><div class="act-desc">' + esc(c.description) + '</div></div><span class="spacer"></span>' + pills + "</div>" + reqs +
      '<div class="stages" aria-label="Stage: ' + esc(c.stage) + '">' + stages + "</div>" +
      '<div class="act-row"><span><b>' + esc(st.calls) + "</b> calls · <b>" + esc(st.successes) + "</b> successes</span>" + '<span class="spacer"></span>' +
      btns("capability", c.capabilityId, ["approved", "Approve"], ["blocked", "Block"], c.stage) + "</div></article>";
  }

  // ---- guardrails ----
  function proposal(r) {
    var ev = r.evidence && r.evidence.length ? r.evidence.map(function (id) { return '<span class="ev">' + esc(id) + "</span>"; }).join("") : '<span class="ev">none</span>';
    return '<div class="gr row"><p class="gr-t"><b>Desk proposal:</b> ' + esc(r.text) + '</p><div class="gr-row">Evidence ' + ev + '<span class="spacer"></span>' +
      btns("rule", r.ruleId, ["active", "Approve"], ["rejected", "Reject"], null) + "</div></div>";
  }

  // ---- autopilot audit ----
  function auditRow(a, capsById) {
    var review = a.action === "ran_unreviewed" && a.capabilityId && capsById[a.capabilityId]
      ? " " + btns("capability", a.capabilityId, ["approved", "Keep"], ["blocked", "Stop"], capsById[a.capabilityId].stage) : "";
    return "<li><time>" + esc(clock(a.createdAt)) + '</time><span class="tx">' + esc(a.detail) + " " + code(a.actor + " · " + a.action) + review + "</span></li>";
  }

  // ---- learning curve ----
  function curve(s) {
    var visits = s.metrics.visits;
    if (!visits.length) return empty("The curve appears after the first closed visit.");
    var byId = {};
    s.episodes.forEach(function (e) { byId[e.episodeId] = e; });
    var pts = visits.map(function (v) {
      var e = byId[v.episodeId];
      return { n: v.n, tools: v.steps, secs: v.seconds, req: e ? e.siteRequests : null, learned: !!(e && e.usedLearned) };
    });
    var top = Math.max(1, Math.max.apply(null, pts.map(function (p) { return Math.max(p.tools, p.req == null ? 0 : p.req); })));
    var stepY = Math.ceil(top / 3);
    var maxY = stepY * Math.ceil(top / stepY);
    var L = 60, R = 690, T = 30, B = 200, n = pts.length;
    function x(i) { return n === 1 ? (L + R) / 2 : L + 60 + (i / (n - 1)) * (R - L - 120); }
    function y(v) { return num(B - (v / maxY) * (B - T)); }
    var grid = "", ticks = "";
    for (var t = 0; t <= maxY; t += stepY) {
      grid += '<line x1="' + L + '" y1="' + y(t) + '" x2="' + R + '" y2="' + y(t) + '"' + (t === 0 ? ' class="base"' : "") + "/>";
      ticks += '<text x="48" y="' + (y(t) + 4) + '">' + t + "</text>";
    }
    var every = Math.max(1, Math.ceil(n / 8));
    var labels = pts.map(function (p, i) {
      if (i % every !== 0 && i !== n - 1) return "";
      return '<text x="' + num(x(i)) + '" y="226" class="xl">Visit ' + esc(p.n) + '</text><text x="' + num(x(i)) + '" y="243" class="xs">' + esc(p.secs) + " s</text>";
    }).join("");
    var toolsLine = pts.map(function (p, i) { return num(x(i)) + "," + y(p.tools); }).join(" ");
    var reqPts = pts.map(function (p, i) { return p.req == null ? null : { i: i, p: p }; }).filter(Boolean);
    var reqLine = reqPts.map(function (q) { return num(x(q.i)) + "," + y(q.p.req); }).join(" ");
    var dotTools = pts.map(function (p, i) { return '<circle cx="' + num(x(i)) + '" cy="' + y(p.tools) + '" r="5"/>'; }).join("");
    var dotReq = reqPts.filter(function (q) { return !q.p.learned; }).map(function (q) { return '<circle cx="' + num(x(q.i)) + '" cy="' + y(q.p.req) + '" r="6"/>'; }).join("");
    var dotLearn = reqPts.filter(function (q) { return q.p.learned; }).map(function (q) { return '<circle cx="' + num(x(q.i)) + '" cy="' + y(q.p.req) + '" r="6"/>'; }).join("");
    var vals = pts.map(function (p, i) {
      return '<text x="' + num(x(i)) + '" y="' + (y(p.tools) - 10) + '">' + esc(p.tools) + "</text>" +
        (p.req == null ? "" : '<text x="' + num(x(i) + 14) + '" y="' + (y(p.req) - 4) + '" class="r">' + esc(p.req) + "</text>");
    }).join("");
    var aria = "Site requests per visit: " + pts.map(function (p) { return p.req == null ? "unknown" : p.req; }).join(", ") +
      ". Tool calls per visit: " + pts.map(function (p) { return p.tools; }).join(", ") + ".";
    return '<div class="curve-legend"><span><i class="lg lg-req"></i>Site requests the agent sent itself</span>' +
      '<span><i class="lg lg-tools"></i>Tool calls</span><span><i class="lg lg-learn"></i>Visit used a learned action</span></div>' +
      '<svg class="curve-svg" viewBox="0 0 720 250" role="img" aria-label="' + esc(aria) + '">' +
      '<g class="grid-l">' + grid + '</g><g class="ax">' + ticks + labels + "</g>" +
      '<polyline class="s-tools" points="' + toolsLine + '"/>' +
      (reqLine ? '<polyline class="s-req" points="' + reqLine + '"/>' : "") +
      '<g class="pt-tools">' + dotTools + '</g><g class="pt-req">' + dotReq + '</g><g class="pt-learn">' + dotLearn + '</g><g class="vl">' + vals + "</g></svg>";
  }

  // ---- render ----
  function render(s) {
    var capsById = {};
    s.capabilities.forEach(function (c) { capsById[c.capabilityId] = c; });
    $("site").innerHTML = "<b>" + esc((s.site && s.site.siteId) || "") + "</b>";
    $("hero").innerHTML = hero(s);
    $("teach").innerHTML = teach(s);
    $("feed").innerHTML = s.episodes.length
      ? limited("visits", s.episodes.map(visit))
      : empty("No visits yet. The desk starts empty.");
    $("caps").innerHTML = s.capabilities.length
      ? limited("caps", s.capabilities.map(action))
      : empty("Nothing learned yet.");
    $("proposed").innerHTML = s.proposedRules.length
      ? s.proposedRules.map(proposal).join("")
      : '<div class="gr row"><p class="gr-t muted">No proposed guardrails.</p></div>';
    var active = s.rules.filter(function (r) { return r.status === "active"; });
    $("rules").innerHTML = limited("rules", active.map(function (r) { return "<li>" + esc(r.text) + "</li>"; }), "li");
    $("audit").innerHTML = s.audit.length
      ? '<ul class="audit">' + limited("audit", s.audit.map(function (a) { return auditRow(a, capsById); }), "li") + "</ul>"
      : empty("Nothing audited yet.");
    $("curve").innerHTML = curve(s);
    var on = !!s.autopilot;
    $("autopilot").setAttribute("aria-checked", String(on));
    $("ap-top").textContent = on ? "on" : "off";
    $("ap-sub").textContent = on ? "On: the desk runs verified actions before you review them." : "Off: the desk waits for your approval before it runs an action.";
  }
  var state = null;

  function refresh() {
    return fetch(url("api/state")).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    }).then(function (raw) {
      if (raw !== last) { last = raw; state = JSON.parse(raw); render(state); }
      $("status").textContent = "live · updated " + new Date().toLocaleTimeString();
    }).catch(function (err) {
      $("status").textContent = "cannot reach the desk: " + err.message;
    });
  }

  // ---- events ----
  document.addEventListener("click", function (ev) {
    var t = ev.target;
    if (!t.closest) return;
    var more = t.closest("button[data-more]");
    if (more) { openLists[more.dataset.more] = !openLists[more.dataset.more]; if (state) render(state); return; }
    var step = t.closest("button[data-s]");
    if (step && !step.disabled) { picked = +step.dataset.s; if (state) render(state); return; }
    var b = t.closest("button[data-kind]");
    if (b) {
      var isCap = b.dataset.kind === "capability";
      post((isCap ? "api/capabilities/" : "api/rules/") + encodeURIComponent(b.dataset.id),
        isCap ? { stage: b.dataset.value } : { status: b.dataset.value }).then(refresh);
      return;
    }
    var head = t.closest("section.card:not(.hero) > .card-h");
    if (head && !t.closest("button, input, a")) {
      var folded = head.parentElement.classList.toggle("folded");
      head.setAttribute("aria-expanded", String(!folded));
    }
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    var head = ev.target.closest && ev.target.closest(".card-h.fold");
    if (head && ev.target === head) { ev.preventDefault(); head.click(); }
  });

  document.querySelectorAll("section.card:not(.hero) > .card-h").forEach(function (h) {
    h.classList.add("fold");
    h.setAttribute("role", "button");
    h.setAttribute("aria-expanded", "true");
    h.tabIndex = 0;
    var b = document.createElement("span");
    b.className = "fold-btn";
    b.innerHTML = CHEV;
    h.appendChild(b);
  });

  $("theme").addEventListener("click", function () {
    var r = document.documentElement;
    var dark = r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    r.dataset.theme = dark ? "light" : "dark";
  });

  $("rule-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var f = ev.target;
    post("api/rules", { text: f.text.value, method: f.method.value, path: f.path.value }).then(function (r) {
      if (r.ok) f.text.value = "";
      return refresh();
    });
  });

  $("autopilot").addEventListener("click", function () {
    var on = this.getAttribute("aria-checked") !== "true";
    post("api/autopilot", { on: on }).then(refresh);
  });

  refresh();
  setInterval(refresh, 2000);
})();
</script>
</body>
</html>
`;
