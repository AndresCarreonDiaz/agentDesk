// The panel page: one self-contained HTML document, inline CSS and vanilla JS, no build step.
// Every string from the database goes through esc() before it reaches innerHTML.

export const PANEL_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AgentDesk panel</title>
<style>
  :root { --ink:#1b1f24; --mute:#667085; --line:#e4e7ec; --bg:#f7f8fa; --ok:#12823b; --err:#c0262d; --warn:#9a6700; --grey:#6b7280; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif; color:var(--ink); background:var(--bg); }
  header { display:flex; align-items:center; justify-content:space-between; padding:14px 24px; background:#fff; border-bottom:1px solid var(--line); }
  header h1 { font-size:16px; margin:0; }
  main { max-width:960px; margin:0 auto; padding:16px 24px 48px; }
  section { background:#fff; border:1px solid var(--line); border-radius:8px; padding:14px 16px; margin-top:16px; }
  h2 { font-size:14px; margin:0 0 10px; }
  .row { padding:10px 0; border-top:1px solid var(--line); }
  .row:first-of-type { border-top:0; }
  .muted { color:var(--mute); }
  .small { font-size:12px; }
  .badge { display:inline-block; padding:1px 8px; border-radius:10px; font-size:12px; color:#fff; background:var(--grey); }
  .success, .approved, .verified { background:var(--ok); }
  .error, .blocked { background:var(--err); }
  .proposed, .waiting { background:var(--warn); }
  code { background:var(--bg); padding:1px 5px; border-radius:4px; font-size:12px; }
  button { font:inherit; padding:3px 10px; border:1px solid var(--line); border-radius:6px; background:#fff; cursor:pointer; }
  button.yes { border-color:var(--ok); color:var(--ok); }
  button.no { border-color:var(--err); color:var(--err); }
  form { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
  input { font:inherit; padding:4px 8px; border:1px solid var(--line); border-radius:6px; }
  input[name=text] { flex:1; min-width:200px; }
  #status { font-size:12px; }
  svg text { font-size:11px; fill:var(--mute); }
</style>
</head>
<body>
<header><h1>AgentDesk panel</h1><span id="status" class="muted">loading…</span></header>
<main>
  <section><h2>Live visits</h2><div id="feed"></div></section>
  <section><h2>Learned actions</h2><div id="caps"></div></section>
  <section><h2>Guardrails the desk proposed</h2><div id="proposed"></div>
    <form id="rule-form">
      <input name="text" placeholder="New rule, e.g. agents may not apply coupons" required>
      <input name="method" placeholder="Method" size="8" value="POST" required>
      <input name="path" placeholder="/path" size="18" required>
      <button class="yes" type="submit">Add rule</button>
    </form>
  </section>
  <section><h2>Autopilot</h2>
    <label><input type="checkbox" id="autopilot"> Autopilot: learned everyday actions go live; money still asks.</label>
    <div id="audit" style="margin-top:10px"></div>
  </section>
  <section><h2>Learning curve</h2><div id="curve"></div></section>
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
  function empty(msg) { return '<div class="muted">' + esc(msg) + "</div>"; }
  function ago(v) { return v ? new Date(v).toLocaleTimeString() : ""; }
  function badge(cls, label) { return '<span class="badge ' + esc(cls) + '">' + esc(label) + "</span>"; }
  function buttons(kind, id, yes, no) {
    return '<button class="yes" data-kind="' + kind + '" data-id="' + esc(id) + '" data-value="' + yes[0] + '">' + yes[1] + "</button> " +
      '<button class="no" data-kind="' + kind + '" data-id="' + esc(id) + '" data-value="' + no[0] + '">' + no[1] + "</button>";
  }

  function feed(episodes) {
    if (!episodes.length) return empty("No visits yet.");
    return episodes.map(function (e) {
      var r = e.reflection;
      var cls = e.outcome === "success" ? "success" : e.outcome === "error" ? "error" : "";
      return '<div class="row"><div>' + badge(cls, e.outcome) + " <strong>" + esc(e.agentFamily) + "</strong> " + esc(e.goal || "no goal stated") + "</div>" +
        '<div class="muted small">' + esc(e.steps) + " steps · " + esc(Math.round((e.durationMs || 0) / 100) / 10) + " s · " + esc(ago(e.createdAt)) + "</div>" +
        (r && r.why ? '<div class="small">' + esc(r.why) + "</div>" : "") +
        (r && r.diff ? '<div class="small"><strong>' + esc(r.diff) + "</strong>" +
          (e.priorFailureId ? " (fixed the failure from " + esc(e.priorFailureId) + ")" : "") + "</div>" : "") +
        "</div>";
    }).join("");
  }

  function caps(list) {
    if (!list.length) return empty("Nothing learned yet.");
    return list.map(function (c) {
      var reqs = (c.mappedRequests || []).map(function (m) { return "<code>" + esc(m.method) + " " + esc(m.path) + "</code>"; }).join(" ");
      var st = c.stats || { calls: 0, successes: 0 };
      return '<div class="row"><div>' + badge(c.stage, c.stage) + (c.waiting ? " " + badge("waiting", "waiting for you") : "") +
        " <strong>" + esc(c.name) + '</strong> <span class="muted small">' + esc(c.kind) + "</span></div>" +
        '<div class="small">' + esc(c.description) + "</div>" +
        '<div class="small">' + reqs + ' <span class="muted">' + esc(st.successes) + "/" + esc(st.calls) + " calls succeeded</span></div>" +
        "<div>" + buttons("capability", c.capabilityId, ["approved", "Approve"], ["blocked", "Block"]) + "</div></div>";
    }).join("");
  }

  function proposed(list) {
    if (!list.length) return empty("No proposed guardrails.");
    return list.map(function (r) {
      return '<div class="row"><div>' + esc(r.text) + "</div>" +
        '<div class="muted small">Evidence: ' + (r.evidence && r.evidence.length ? r.evidence.map(function (id) { return "<code>" + esc(id) + "</code>"; }).join(" ") : "none") + "</div>" +
        "<div>" + buttons("rule", r.ruleId, ["active", "Approve"], ["rejected", "Reject"]) + "</div></div>";
    }).join("");
  }

  function audit(list, capsById) {
    if (!list.length) return empty("Nothing audited yet.");
    return list.map(function (a) {
      var review = a.action === "ran_unreviewed" && a.capabilityId && capsById[a.capabilityId]
        ? "<div>" + buttons("capability", a.capabilityId, ["approved", "Keep"], ["blocked", "Stop"]) + "</div>" : "";
      return '<div class="row"><div class="small">' + esc(a.detail) + '</div><div class="muted small">' +
        esc(a.actor) + " · " + esc(a.action) + " · " + esc(ago(a.createdAt)) + "</div>" + review + "</div>";
    }).join("");
  }

  function curve(visits) {
    if (!visits.length) return empty("The curve appears after the first closed visit.");
    var W = 640, H = 200, L = 36, B = 24, T = 10, R = 10;
    var n = visits.length;
    var maxY = Math.max(1, Math.max.apply(null, visits.map(function (v) { return Math.max(v.steps, v.seconds); })));
    function x(i) { return n === 1 ? L + (W - L - R) / 2 : L + (i / (n - 1)) * (W - L - R); }
    function y(v) { return T + (1 - v / maxY) * (H - T - B); }
    function line(key, color) {
      var pts = visits.map(function (v, i) { return x(i) + "," + y(v[key]); }).join(" ");
      var dots = visits.map(function (v, i) {
        return '<circle cx="' + x(i) + '" cy="' + y(v[key]) + '" r="4" fill="' + (v.success ? "#12823b" : "#c0262d") + '" stroke="' + color + '" stroke-width="2"/>';
      }).join("");
      return '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="2"' + (key === "seconds" ? ' stroke-dasharray="5 3"' : "") + "/>" + dots;
    }
    var labels = visits.map(function (v, i) {
      return '<text x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(v.n) + "</text>";
    }).join("");
    return '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" role="img" aria-label="Steps and seconds per visit">' +
      '<line x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + (H - B) + '" stroke="#e4e7ec"/>' +
      '<text x="4" y="' + (T + 8) + '">' + esc(maxY) + '</text><text x="4" y="' + (H - B) + '">0</text>' + labels +
      line("steps", "#344054") + line("seconds", "#2563eb") + "</svg>" +
      '<div class="muted small">Solid: steps. Dashed: seconds. Per visit number. Green point: succeeded. Red point: failed.</div>';
  }

  var focused = false;
  function render(s) {
    var capsById = {};
    s.capabilities.forEach(function (c) { capsById[c.capabilityId] = c; });
    $("feed").innerHTML = feed(s.episodes);
    $("caps").innerHTML = caps(s.capabilities);
    $("proposed").innerHTML = proposed(s.proposedRules);
    $("audit").innerHTML = audit(s.audit, capsById);
    $("curve").innerHTML = curve(s.metrics.visits);
    if (!focused) $("autopilot").checked = !!s.autopilot;
  }

  function refresh() {
    return fetch(url("api/state")).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (s) {
      render(s);
      $("status").textContent = "live · updated " + new Date().toLocaleTimeString();
    }).catch(function (err) {
      $("status").textContent = "cannot reach the desk: " + err.message;
    });
  }

  document.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("button[data-kind]");
    if (!b) return;
    var isCap = b.dataset.kind === "capability";
    post((isCap ? "api/capabilities/" : "api/rules/") + encodeURIComponent(b.dataset.id),
      isCap ? { stage: b.dataset.value } : { status: b.dataset.value }).then(refresh);
  });

  $("rule-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var f = ev.target;
    post("api/rules", { text: f.text.value, method: f.method.value, path: f.path.value }).then(function (r) {
      if (r.ok) f.text.value = "";
      return refresh();
    });
  });

  var ap = $("autopilot");
  ap.addEventListener("focus", function () { focused = true; });
  ap.addEventListener("blur", function () { focused = false; });
  ap.addEventListener("change", function () { post("api/autopilot", { on: ap.checked }).then(refresh); });

  refresh();
  setInterval(refresh, 2000);
})();
</script>
</body>
</html>
`;
