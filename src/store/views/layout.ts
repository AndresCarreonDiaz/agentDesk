import { html, raw, type Raw } from './html';

export const STORE_NAME = 'Harbor Goods';
export const STORE_TAGLINE = 'Small, sturdy things for your desk. Ships anywhere in the US.';

const ERRORS: Record<string, string> = {
  bad_request: 'Something in that form was not valid.',
  not_found: 'We could not find that item.',
  out_of_stock: 'Sorry, there is not enough stock for that.',
  invalid_coupon: 'That coupon code is not valid.',
  empty_cart: 'Your cart is empty.',
  invalid_shipping: 'Please fill in name, email, address, city and country.',
  conflict: 'Your cart changed in another tab. Please try again.',
  already_ordered: 'That order was already placed.',
};

// Small inline icons (24x24, stroke = currentColor), so the store ships no icon files.
const svgIcon = (body: string) =>
  raw(`<svg class="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`);

export const icon = {
  anchor: svgIcon('<circle cx="12" cy="5" r="2.2"/><path d="M12 7.2V21"/><path d="M5 13a7 7 0 0 0 14 0"/><path d="M8.5 11h7"/>'),
  bag: svgIcon('<path d="M5 8h14l-1.2 12H6.2z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>'),
  truck: svgIcon('<path d="M3 6h11v10H3z"/><path d="M14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/>'),
  returns: svgIcon('<path d="M4 9h11a5 5 0 0 1 0 10H8"/><path d="M8 5 4 9l4 4"/>'),
  lock: svgIcon('<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>'),
  tag: svgIcon('<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>'),
  search: svgIcon('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
  check: svgIcon('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  arrow: svgIcon('<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>'),
};

const CSS = `
:root{
  --ink:#13213a;--ink-2:#3a4658;--muted:#6a7280;--line:#e7e1d6;--line-2:#d9d1c3;
  --bg:#faf7f1;--card:#fff;--sand:#f2ece1;--sand-2:#ebe3d5;
  --accent:#1f5fbf;--accent-hover:#184d9c;--accent-soft:#e9f0fb;--accent-ink:#fff;
  --clay:#c4694a;--ok:#1e7a4b;--ok-soft:#e6f3ec;--warn:#a33a1f;--warn-soft:#fdf0ec;
  --radius:16px;--radius-sm:10px;
  --shadow:0 1px 2px rgba(19,33,58,.05),0 10px 30px -12px rgba(19,33,58,.18);
  --display:'Fraunces',Georgia,'Times New Roman',serif;
  --sans:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;font:16px/1.55 var(--sans);color:var(--ink);background:var(--bg);-webkit-font-smoothing:antialiased}
img{max-width:100%;height:auto;display:block}
a{color:var(--accent);text-decoration-thickness:1px;text-underline-offset:3px}
code{font:600 .95em ui-monospace,SFMono-Regular,Menlo,monospace;background:rgba(255,255,255,.18);padding:1px 6px;border-radius:6px}
.icon{flex:none}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.wrap{max-width:1120px;margin:0 auto;padding:0 20px}
.muted{color:var(--muted)}
h1,h2,h3{font-family:var(--display);font-weight:600;letter-spacing:-.015em;line-height:1.15;margin:0}
h1{font-size:clamp(30px,4vw,44px)}
h2{font-size:24px}
.eyebrow{display:inline-block;font:600 12px/1 var(--sans);letter-spacing:.09em;text-transform:uppercase;color:var(--accent)}

/* header */
.announce{background:var(--ink);color:#dfe7f4;font-size:13px;text-align:center;padding:9px 16px}
.announce strong{color:#fff}
header.site{position:sticky;top:0;z-index:10;background:rgba(250,247,241,.9);backdrop-filter:saturate(1.4) blur(10px);border-bottom:1px solid var(--line)}
header.site .wrap{display:flex;align-items:center;gap:28px;height:68px}
.brand{display:flex;align-items:center;gap:10px;color:var(--ink);text-decoration:none;margin-right:auto}
.brand-mark{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:var(--accent);color:#fff}
.brand-name{font:600 21px/1 var(--display);letter-spacing:-.01em}
nav.main{display:flex;align-items:center;gap:6px}
nav.main a{color:var(--ink-2);text-decoration:none;padding:8px 12px;border-radius:999px;font-weight:500;font-size:15px}
nav.main a:hover{background:var(--sand)}
nav.main a[aria-current="page"]{color:var(--ink);background:var(--sand)}
nav.main a.cart-pill{display:flex;align-items:center;gap:8px;background:var(--ink);color:#fff;padding:8px 14px}
nav.main a.cart-pill:hover{background:#0b1628}
.cart-pill .count{display:grid;place-items:center;min-width:22px;height:22px;padding:0 6px;border-radius:999px;background:#fff;color:var(--ink);font-size:12px;font-weight:700}

main{padding:28px 0 72px}
.notice{display:flex;gap:10px;align-items:center;padding:12px 16px;border-radius:var(--radius-sm);margin-bottom:20px;background:var(--warn-soft);color:var(--warn);border:1px solid #f1cfc4;font-weight:500}

/* buttons and inputs */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:var(--accent);color:var(--accent-ink);border:1px solid transparent;border-radius:999px;padding:10px 20px;font:600 15px/1.2 var(--sans);cursor:pointer;text-decoration:none;transition:background .15s,transform .15s,box-shadow .15s}
.btn:hover{background:var(--accent-hover)}
.btn:active{transform:translateY(1px)}
.btn:disabled{opacity:.55;cursor:not-allowed}
.btn-lg{padding:14px 26px;font-size:16px}
.btn.block{display:flex;width:100%}
.btn.secondary{background:transparent;color:var(--ink);border-color:var(--line-2)}
.btn.secondary:hover{background:var(--sand)}
.btn.light{background:#fff;color:var(--ink)}
.btn.light:hover{background:#eef2f8}
.btn.link{background:none;color:var(--muted);padding:4px 6px;font-weight:500;font-size:14px;text-decoration:underline;border-radius:6px}
.btn.link:hover{color:var(--ink);background:none}
input,select{font:inherit;color:inherit;padding:11px 13px;border:1px solid var(--line-2);border-radius:var(--radius-sm);background:#fff;min-width:0;transition:border-color .15s,box-shadow .15s}
input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
label{display:block;font-size:14px;font-weight:500;color:var(--ink-2);margin-bottom:6px}
.field{margin-bottom:16px}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end}

/* home */
.hero{display:grid;grid-template-columns:1.05fr .95fr;gap:48px;align-items:center;padding:24px 0 40px}
.hero h1{font-size:clamp(38px,5.4vw,64px);margin:14px 0 16px}
.lead{font-size:19px;color:var(--ink-2);max-width:520px;margin:0 0 28px}
.hero-cta{display:flex;gap:12px;flex-wrap:wrap}
.hero-facts{display:flex;gap:22px;flex-wrap:wrap;list-style:none;padding:0;margin:28px 0 0;color:var(--ink-2);font-size:14px}
.hero-facts li{display:flex;align-items:center;gap:8px}
.hero-facts .icon{color:var(--accent)}
.hero-art{position:relative;display:block;border-radius:28px;overflow:hidden;background:var(--sand);box-shadow:var(--shadow)}
.hero-art img{width:100%;aspect-ratio:1;transition:transform .4s}
.hero-art:hover img{transform:scale(1.03)}
.hero-tag{position:absolute;left:20px;top:20px;display:flex;flex-direction:column;gap:2px;background:#fff;color:var(--ink);padding:12px 16px;border-radius:14px;box-shadow:var(--shadow);font-size:14px}
.hero-tag strong{font-size:15px}
.section{margin-top:56px}
.section-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:20px}
.section-head a{font-weight:600;text-decoration:none}
.chips{display:flex;gap:10px;flex-wrap:wrap}
.chip{padding:9px 16px;border-radius:999px;background:#fff;border:1px solid var(--line);color:var(--ink);text-decoration:none;font-weight:500;font-size:15px;transition:border-color .15s,background .15s}
.chip:hover{border-color:var(--ink-2)}
.chip[aria-current="true"]{background:var(--ink);border-color:var(--ink);color:#fff}
.banner{margin-top:64px;display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap;padding:36px 40px;border-radius:24px;background:linear-gradient(120deg,var(--accent),#2b4f97 60%,var(--ink));color:#fff}
.banner h2{font-size:30px;margin-bottom:6px}
.banner p{margin:0;color:#dbe5f6}

/* product cards */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:22px}
.grid.grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}
.card{display:flex;flex-direction:column;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;text-decoration:none;color:inherit;transition:transform .2s,box-shadow .2s,border-color .2s}
.card:hover{transform:translateY(-3px);box-shadow:var(--shadow);border-color:var(--line-2)}
.card-media{background:var(--sand);aspect-ratio:1;overflow:hidden}
.card-media img{width:100%;height:100%;object-fit:cover;transition:transform .35s}
.card:hover .card-media img{transform:scale(1.04)}
.card-body{padding:14px 16px 16px;display:flex;flex-direction:column;gap:6px}
.card-top{display:flex;justify-content:space-between;gap:12px;align-items:baseline}
.card-top .name{font-weight:600}
.card-top .price{font-weight:600;white-space:nowrap}
.card-meta{display:flex;justify-content:space-between;align-items:center;font-size:14px}
.dots{display:flex;gap:5px}
.dot{width:14px;height:14px;border-radius:50%;border:1px solid rgba(0,0,0,.12);display:inline-block}

/* listing */
.page-head{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;flex-wrap:wrap;margin-bottom:22px}
.page-head p{margin:6px 0 0}
.search{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid var(--line-2);border-radius:999px;padding:5px 5px 5px 16px;min-width:min(380px,100%)}
.search .icon{color:var(--muted)}
.search input{border:0;padding:8px 4px;flex:1;background:transparent;box-shadow:none}
.empty{text-align:center;padding:56px 20px;background:#fff;border:1px dashed var(--line-2);border-radius:var(--radius)}
.empty .icon{width:40px;height:40px;color:var(--muted);margin:0 auto 12px}
.empty h2{margin-bottom:8px}
.empty p{margin:0 0 20px}

/* product page */
.crumbs{display:flex;gap:8px;font-size:14px;color:var(--muted);margin-bottom:22px;flex-wrap:wrap}
.crumbs a{color:var(--muted);text-decoration:none}
.crumbs a:hover{color:var(--ink)}
.pdp{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:48px;align-items:start}
.gallery-main{border-radius:24px;overflow:hidden;background:var(--sand);border:1px solid var(--line)}
.gallery-main img{width:100%;aspect-ratio:1}
.thumbs{display:flex;gap:12px;margin-top:14px}
.thumb{width:84px;border-radius:12px;overflow:hidden;border:2px solid transparent;background:var(--sand)}
.thumb[aria-current="true"]{border-color:var(--accent)}
.buybox{position:sticky;top:96px}
.buybox h1{margin:10px 0 8px}
.buybox .price{font:600 26px/1.2 var(--sans);margin:0 0 14px}
.desc{color:var(--ink-2);font-size:17px;margin:0 0 22px}
.option-label{font-size:14px;color:var(--ink-2);margin-bottom:10px}
.swatches{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:22px}
.swatch{display:flex;align-items:center;gap:8px;padding:8px 16px 8px 10px;border:1px solid var(--line-2);border-radius:999px;text-decoration:none;color:var(--ink);background:#fff;font-weight:500;transition:border-color .15s}
.swatch:hover{border-color:var(--ink-2)}
.swatch[aria-current="true"]{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent);font-weight:600}
.stock{display:flex;align-items:center;gap:8px;font-size:14px;margin:0 0 18px;color:var(--muted)}
.stock .pill{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:var(--ok-soft);color:var(--ok);font-weight:600}
.stock .pill.out{background:var(--warn-soft);color:var(--warn)}
.buy{display:flex;gap:12px;align-items:flex-end}
.buy .qty{width:96px}
.buy .btn{flex:1}
.perks{list-style:none;padding:0;margin:26px 0 0;border-top:1px solid var(--line)}
.perks li{display:flex;gap:14px;padding:16px 0;border-bottom:1px solid var(--line)}
.perks .icon{color:var(--accent);margin-top:2px}
.perks strong{display:block}
.perks span{color:var(--muted);font-size:14px}

/* cart and checkout */
.cart-layout{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:32px;align-items:start;margin-top:24px}
.lines{display:flex;flex-direction:column;gap:14px}
.line{display:grid;grid-template-columns:96px 1fr auto;gap:18px;align-items:center;background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:14px}
.line-media{border-radius:12px;overflow:hidden;background:var(--sand)}
.line-name{font-weight:600;color:var(--ink);text-decoration:none}
.line-name:hover{text-decoration:underline}
.line-info{display:flex;flex-direction:column;gap:2px;font-size:15px}
.line-actions{display:flex;align-items:center;gap:6px;margin-top:8px;flex-wrap:wrap}
.qty-form{display:flex;align-items:center;gap:4px}
.qty-form input{width:72px;padding:7px 10px}
.line-total{font-weight:700;font-size:17px;align-self:start;padding-top:2px}
.summary{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:22px;position:sticky;top:96px;box-shadow:var(--shadow)}
.summary h2{font-size:20px;margin-bottom:14px}
.totals div{display:flex;justify-content:space-between;padding:6px 0;color:var(--ink-2)}
.totals .discount{color:var(--ok)}
.totals .total{color:var(--ink);font-weight:700;font-size:20px;border-top:1px solid var(--line);margin-top:8px;padding-top:14px}
.coupon{margin:18px 0;padding-top:18px;border-top:1px solid var(--line)}
.coupon .row input{flex:1}
.coupon-applied{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 8px 8px 12px;border-radius:var(--radius-sm);background:var(--ok-soft);color:var(--ok);font-weight:600;font-size:14px}
.coupon-applied>span{display:flex;align-items:center;gap:6px}
.coupon-applied .btn{white-space:nowrap}
.fine{display:flex;align-items:center;justify-content:center;gap:6px;font-size:13px;color:var(--muted);margin:14px 0 0}
.mini-lines{display:flex;flex-direction:column;gap:12px;margin-bottom:16px}
.mini-line{display:grid;grid-template-columns:52px 1fr auto;gap:12px;align-items:center;font-size:14px}
.mini-line img{border-radius:10px;background:var(--sand)}
.form-card{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:26px}
.form-card h2{font-size:20px;margin:0 0 16px}
.form-card h2:not(:first-child){margin-top:26px}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}
.form-grid .full{grid-column:1/-1}
.form-grid input{width:100%}

/* confirmation */
.success{text-align:center;max-width:640px;margin:0 auto 32px}
.success-mark{display:grid;place-items:center;width:64px;height:64px;margin:0 auto 18px;border-radius:50%;background:var(--ok-soft);color:var(--ok)}
.success-mark .icon{width:32px;height:32px}
.success p{color:var(--ink-2);font-size:17px}
.receipt{max-width:640px;margin:0 auto}

/* policies */
.policy-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px;margin-top:26px}
.policy{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:22px}
.policy .icon{color:var(--accent);width:26px;height:26px;margin-bottom:10px}
.policy h2{font-size:19px;margin-bottom:8px}
.policy p{margin:0;color:var(--ink-2)}

/* footer */
footer.site{background:var(--ink);color:#c5d0e2;font-size:14px}
footer.site .wrap{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:32px;padding:48px 20px 28px}
footer.site h3{font:600 13px/1 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:#fff;margin-bottom:14px}
footer.site ul{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px}
footer.site a{color:#c5d0e2;text-decoration:none}
footer.site a:hover{color:#fff}
footer.site .brand{color:#fff;margin-bottom:12px}
footer.site .legal{grid-column:1/-1;border-top:1px solid rgba(255,255,255,.12);padding-top:18px;color:#8e9bb3}

@media (max-width:860px){
  .hero,.pdp,.cart-layout{grid-template-columns:1fr}
  .grid.grid-3{grid-template-columns:repeat(2,minmax(0,1fr))}
  .hero{gap:28px}
  .buybox,.summary{position:static}
  footer.site .wrap{grid-template-columns:1fr 1fr}
}
@media (max-width:560px){
  header.site .wrap{gap:10px}
  nav.main a:not(.cart-pill){display:none}
  .form-grid{grid-template-columns:1fr}
  .line{grid-template-columns:72px 1fr;}
  .line-total{grid-column:2}
  .banner{padding:28px 24px}
  .grid.grid-3{grid-template-columns:1fr}
  .hero-cta .btn{flex:1}
  footer.site .wrap{grid-template-columns:1fr}
}
`;

// Pages call the real JSON API, like a modern shop: forms marked data-api are sent as JSON
// (numbers as numbers, "shipping.city" nested), so the traffic AgentDesk learns from is the
// API itself. Without JavaScript the same forms post normally and get a redirect.
export const PAGE_SCRIPT = `
document.addEventListener('submit', async (event) => {
  const form = event.target.closest('form[data-api]');
  if (!form) return;
  event.preventDefault();
  const data = {};
  for (const el of form.elements) {
    if (!el.name || el.name === '_method' || el.disabled) continue;
    let value = el.type === 'number' ? Number(el.value) : el.value;
    let path = el.name.split('.');
    if (el.dataset.last4 !== undefined) { value = el.value.replace(/\\D/g, '').slice(-4); path[path.length - 1] = 'last4'; }
    let node = data;
    path.slice(0, -1).forEach((k) => { node = node[k] ??= {}; });
    node[path[path.length - 1]] = value;
  }
  const method = (form.elements._method?.value || form.method).toUpperCase();
  const button = form.querySelector('[type=submit]');
  if (button) button.disabled = true;
  const res = await fetch(form.action, {
    method,
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: Object.keys(data).length ? JSON.stringify(data) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (res.ok) location.href = json.order ? '/orders/' + json.order.id : form.dataset.next || location.pathname;
  else if (json.error === 'already_ordered') location.href = '/orders/' + json.orderId;
  else location.href = location.pathname + '?error=' + encodeURIComponent(json.error || 'bad_request');
});
`;

export type NavKey = 'home' | 'shop' | 'policies' | 'cart';

export interface LayoutOptions {
  title: string;
  description?: string;
  cartCount: number;
  error?: string;
  nav?: NavKey;
}

const NAV: { key: NavKey; href: string; label: string }[] = [
  { key: 'shop', href: '/products', label: 'Shop' },
  { key: 'policies', href: '/policies', label: 'Shipping & returns' },
];

export function layout(opts: LayoutOptions, content: Raw): string {
  const title = opts.title === STORE_NAME ? `${STORE_NAME}: small, sturdy things for your desk` : `${opts.title} · ${STORE_NAME}`;
  const message = opts.error ? (ERRORS[opts.error] ?? 'Something went wrong.') : '';
  const current = (key: NavKey) => (opts.nav === key ? 'page' : 'false');
  return `<!doctype html>${html`<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${opts.description ?? STORE_TAGLINE}">
<meta name="theme-color" content="#13213a">
<link rel="alternate" type="text/plain" href="/llms.txt" title="About this store">
<link rel="icon" href="/img/mug-blue.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter:wght@400;500;600;700&display=swap">
<style>${raw(CSS)}</style>
</head>
<body>
<div class="announce"><strong>Free shipping</strong> on every US order · 10% off your first order with <strong>WELCOME10</strong></div>
<header class="site"><div class="wrap">
  <a class="brand" href="/" aria-label="${STORE_NAME} home"><span class="brand-mark">${icon.anchor}</span><span class="brand-name">${STORE_NAME}</span></a>
  <nav class="main" aria-label="Main">
    ${NAV.map((n) => html`<a href="${n.href}" aria-current="${current(n.key)}">${n.label}</a>`)}
    <a class="cart-pill" href="/cart" aria-current="${current('cart')}">${icon.bag}<span class="sr-only">Cart</span><span class="count" data-cart-count>${opts.cartCount}</span></a>
  </nav>
</div></header>
<main><div class="wrap">
${message ? html`<p class="notice" role="alert" data-error="${opts.error}">${message}</p>` : ''}
${content}
</div></main>
<footer class="site"><div class="wrap">
  <div>
    <a class="brand" href="/"><span class="brand-mark">${icon.anchor}</span><span class="brand-name">${STORE_NAME}</span></a>
    <p>${STORE_TAGLINE}</p>
  </div>
  <div><h3>Shop</h3><ul>
    <li><a href="/products?q=mug">Mugs</a></li><li><a href="/products?q=tote">Totes</a></li>
    <li><a href="/products?q=notebook">Notebooks</a></li><li><a href="/products">Everything</a></li>
  </ul></div>
  <div><h3>Help</h3><ul>
    <li><a href="/policies">Shipping</a></li><li><a href="/policies">Returns</a></li>
    <li><a href="/policies">Coupons</a></li><li><a href="/cart">Your cart</a></li>
  </ul></div>
  <p class="legal">Demo store built for the AgentDesk hackathon project. Payments are simulated and no money changes hands.</p>
</div></footer>
<script>${raw(PAGE_SCRIPT)}</script>
</body>
</html>`}`;
}
