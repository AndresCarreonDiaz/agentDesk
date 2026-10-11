import { html, type Raw } from './html';

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
};

const CSS = `
:root{--accent:#1f5fbf;--accent-ink:#fff;--ink:#1b1f24;--muted:#5d6670;--line:#e3e6ea;--bg:#fbfaf7;--card:#fff;--warn:#a33a1f}
*{box-sizing:border-box}
body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:var(--bg)}
a{color:var(--accent)}
header.site,footer.site{border-bottom:1px solid var(--line);background:var(--card)}
footer.site{border-top:1px solid var(--line);border-bottom:0;margin-top:48px;color:var(--muted);font-size:14px}
.wrap{max-width:1040px;margin:0 auto;padding:0 16px}
header.site .wrap{display:flex;align-items:center;gap:24px;height:64px}
header.site .brand{font-weight:700;font-size:20px;color:var(--ink);text-decoration:none;margin-right:auto}
header.site nav a{color:var(--ink);text-decoration:none;margin-left:16px}
footer.site .wrap{padding:24px 16px;display:flex;gap:16px;flex-wrap:wrap}
main{padding:32px 0}
h1{font-size:32px;line-height:1.2;margin:0 0 8px}
h2{font-size:22px;margin:32px 0 12px}
.muted{color:var(--muted)}
.hero{padding:40px 0 16px}
.hero p{font-size:18px;color:var(--muted);max-width:560px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;text-decoration:none;color:inherit;display:block}
.card img{width:100%;aspect-ratio:1;display:block;background:#f2f0ea}
.card .body{padding:12px 14px}
.card .name{font-weight:600}
.btn{display:inline-block;background:var(--accent);color:var(--accent-ink);border:0;border-radius:8px;padding:10px 18px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
.btn.secondary{background:transparent;color:var(--accent);border:1px solid var(--accent)}
.btn.link{background:none;color:var(--muted);padding:4px 8px;font-weight:400;text-decoration:underline}
input,select{font:inherit;padding:9px 10px;border:1px solid var(--line);border-radius:8px;background:#fff;min-width:0}
label{display:block;font-size:14px;color:var(--muted);margin-bottom:4px}
.field{margin-bottom:14px}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end}
.pdp{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:40px}
.pdp img{width:100%;border-radius:12px;border:1px solid var(--line);background:#f2f0ea}
.swatches{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 16px}
.swatch{padding:6px 14px;border:1px solid var(--line);border-radius:999px;text-decoration:none;color:var(--ink);background:#fff}
.swatch[aria-current="true"]{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent);font-weight:600}
.price{font-size:22px;font-weight:600}
table.lines{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px}
table.lines td,table.lines th{padding:12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle}
table.lines img{width:56px;height:56px;border-radius:8px}
.totals{margin-left:auto;max-width:320px;margin-top:16px}
.totals div{display:flex;justify-content:space-between;padding:4px 0}
.totals .total{font-weight:700;font-size:18px;border-top:1px solid var(--line);padding-top:8px}
.notice{padding:12px 14px;border-radius:8px;margin-bottom:16px;background:#fdf0ec;color:var(--warn);border:1px solid #f1cfc4}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 16px;max-width:640px}
.form-grid .full{grid-column:1/-1}
.form-grid input{width:100%}
@media (max-width:720px){.pdp,.form-grid{grid-template-columns:1fr}header.site nav a{margin-left:10px}table.lines .hide-sm{display:none}}
`;

export interface LayoutOptions {
  title: string;
  description?: string;
  cartCount: number;
  error?: string;
}

export function layout(opts: LayoutOptions, content: Raw): string {
  const title = opts.title === STORE_NAME ? STORE_NAME : `${opts.title} · ${STORE_NAME}`;
  const message = opts.error ? (ERRORS[opts.error] ?? 'Something went wrong.') : '';
  return `<!doctype html>${html`<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${opts.description ?? STORE_TAGLINE}">
<link rel="alternate" type="text/plain" href="/llms.txt" title="About this store">
<style>${CSS}</style>
</head>
<body>
<header class="site"><div class="wrap">
  <a class="brand" href="/">${STORE_NAME}</a>
  <nav aria-label="Main"><a href="/products">Shop</a><a href="/policies">Policies</a><a href="/cart">Cart (<span data-cart-count>${opts.cartCount}</span>)</a></nav>
</div></header>
<main><div class="wrap">
${message ? html`<p class="notice" role="alert" data-error="${opts.error}">${message}</p>` : ''}
${content}
</div></main>
<footer class="site"><div class="wrap">
  <span>${STORE_NAME}. ${STORE_TAGLINE}</span>
  <a href="/policies">Shipping, returns and coupons</a>
  <span>Demo store: payments are simulated.</span>
</div></footer>
</body>
</html>`}`;
}
