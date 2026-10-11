import { SWATCHES } from '../catalog';
import { formatCents } from '../money';
import type { PublicProduct, PublicVariant } from '../store';
import type { CartDoc, OrderDoc } from '../types';
import { html, raw } from './html';
import { icon } from './layout';

const CATEGORY_LABELS: Record<string, string> = {
  mugs: 'Mugs',
  bags: 'Bags',
  paper: 'Paper',
  desk: 'Desk',
  stickers: 'Stickers',
};

export function categoryLabel(category: string) {
  return CATEGORY_LABELS[category] ?? category[0].toUpperCase() + category.slice(1);
}

const swatch = (sku: string) => SWATCHES[sku] ?? '#cfc8bb';
const itemCount = (items: { qty: number }[]) => items.reduce((n, l) => n + l.qty, 0);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function priceLabel(p: PublicProduct) {
  const prices = p.variants.map((v) => v.priceCents);
  const min = Math.min(...prices);
  return prices.every((x) => x === min) ? formatCents(min) : `From ${formatCents(min)}`;
}

function colorDots(p: PublicProduct) {
  if (p.variants.length < 2) return '';
  return html`<span class="dots" aria-hidden="true">${p.variants.map(
    (v) => html`<span class="dot" style="background:${swatch(v.sku)}" title="${v.label}"></span>`,
  )}</span>`;
}

function productCard(p: PublicProduct) {
  const first = p.variants[0];
  const meta = p.variants.length > 1 ? `${p.variants.length} colors` : first.label;
  return html`<a class="card" href="/products/${p.slug}">
  <div class="card-media"><img src="${first.imageUrl}" alt="${p.images[0]?.alt ?? p.name}" width="400" height="400" loading="lazy"></div>
  <div class="card-body">
    <div class="card-top"><span class="name">${p.name}</span><span class="price">${priceLabel(p)}</span></div>
    <div class="card-meta"><span class="muted">${meta}</span>${colorDots(p)}</div>
  </div>
</a>`;
}

function categoryChips(categories: string[], active?: string) {
  return html`<div class="chips">
  <a class="chip" href="/products" aria-current="${!active}">All</a>
  ${categories.map(
    (c) => html`<a class="chip" href="/products?q=${c}" aria-current="${active === c}">${categoryLabel(c)}</a>`,
  )}
</div>`;
}

export function categoriesOf(products: PublicProduct[]) {
  return [...new Set(products.map((p) => p.category))];
}

export function homePage(featured: PublicProduct[], all: PublicProduct[]) {
  const mug = all.find((p) => p.slug === 'harbor-mug');
  const blue = mug?.variants.find((v) => v.sku === 'MUG-BLUE');
  return html`<section class="hero">
  <div>
    <span class="eyebrow">New in · The Harbor Mug in blue</span>
    <h1>Small, sturdy things for your desk.</h1>
    <p class="lead">Mugs, totes, notebooks and stickers made to be used every day. Free shipping anywhere in the US.</p>
    <div class="hero-cta">
      <a class="btn btn-lg" href="/products/harbor-mug?variant=MUG-BLUE">Shop the blue mug ${icon.arrow}</a>
      <a class="btn btn-lg secondary" href="/products">Browse everything</a>
    </div>
    <ul class="hero-facts">
      <li>${icon.truck} Free US shipping</li>
      <li>${icon.returns} 30-day returns</li>
      <li>${icon.lock} Simulated checkout</li>
    </ul>
  </div>
  <a class="hero-art" href="/products/harbor-mug?variant=MUG-BLUE">
    <img src="/img/mug-blue.svg" alt="Harbor Mug in blue" width="560" height="560">
    ${blue ? html`<span class="hero-tag"><strong>Harbor Mug, Blue</strong><span class="muted">${formatCents(blue.priceCents)} · the house favorite</span></span>` : ''}
  </a>
</section>
<section class="section">
  <div class="section-head"><h2>Shop by category</h2></div>
  ${categoryChips(categoriesOf(all))}
</section>
<section class="section">
  <div class="section-head"><h2>Featured</h2><a href="/products">View all →</a></div>
  <div class="grid grid-3">${featured.map(productCard)}</div>
</section>
<section class="banner">
  <div>
    <h2>10% off your first order</h2>
    <p>Use code <code>WELCOME10</code> in your cart. One coupon per order, for human shoppers.</p>
  </div>
  <a class="btn btn-lg light" href="/products">Start shopping</a>
</section>`;
}

export function listPage(products: PublicProduct[], q: string, categories: string[]) {
  const activeCategory = categories.find((c) => c === q.toLowerCase());
  const heading = activeCategory ? categoryLabel(activeCategory) : q ? `Results for “${q}”` : 'Shop all';
  return html`<div class="page-head">
  <div>
    <h1>${heading}</h1>
    <p class="muted">${plural(products.length, 'product')}</p>
  </div>
  <form class="search" action="/products" method="get" role="search">
    ${icon.search}<label class="sr-only" for="q">Search</label>
    <input id="q" name="q" value="${q}" placeholder="Search mugs, blue, tote…">
    <button class="btn" type="submit">Search</button>
  </form>
</div>
${categoryChips(categories, activeCategory)}
<div class="section" style="margin-top:26px">
${products.length
  ? html`<div class="grid">${products.map(productCard)}</div>`
  : html`<div class="empty">${icon.search}<h2>Nothing matched “${q}”</h2><p class="muted">Try “mug”, “blue” or “tote”.</p><a class="btn" href="/products">See everything</a></div>`}
</div>`;
}

export function productPage(p: PublicProduct, selected: PublicVariant, related: PublicProduct[]) {
  const inStock = selected.available > 0;
  const multi = p.variants.length > 1;
  return html`<nav class="crumbs" aria-label="Breadcrumb">
  <a href="/">Home</a><span>/</span><a href="/products?q=${p.category}">${categoryLabel(p.category)}</a><span>/</span><span>${p.name}</span>
</nav>
<article class="pdp" data-product="${p.slug}">
  <div>
    <div class="gallery-main"><img src="${selected.imageUrl}" alt="${p.name} in ${selected.label.toLowerCase()}" width="640" height="640"></div>
    ${multi
      ? html`<div class="thumbs">${p.variants.map(
          (v) =>
            html`<a class="thumb" href="/products/${p.slug}?variant=${v.sku}" aria-current="${v.sku === selected.sku}" aria-label="${v.label}"><img src="${v.imageUrl}" alt="" width="84" height="84"></a>`,
        )}</div>`
      : ''}
  </div>
  <div class="buybox">
    <span class="eyebrow">${categoryLabel(p.category)}</span>
    <h1>${p.name}${multi ? html`, ${selected.label}` : ''}</h1>
    <p class="price">${formatCents(selected.priceCents)}</p>
    <p class="desc">${p.description}</p>
    ${multi
      ? html`<div class="option-label">Color: <strong>${selected.label}</strong></div>
    <div class="swatches">${p.variants.map(
      (v) =>
        html`<a class="swatch" href="/products/${p.slug}?variant=${v.sku}" aria-current="${v.sku === selected.sku}"><span class="dot" style="background:${swatch(v.sku)}"></span>${v.label}</a>`,
    )}</div>`
      : ''}
    <p class="stock">
      ${inStock
        ? html`<span class="pill">${icon.check} In stock</span> ${selected.available} available`
        : html`<span class="pill out">Out of stock</span>`}
      <span>· SKU ${selected.sku}</span>
    </p>
    <form class="buy" action="/cart/items" method="post" data-api data-next="/cart">
      <input type="hidden" name="sku" value="${selected.sku}">
      <div><label for="qty">Quantity</label><input class="qty" id="qty" name="qty" type="number" min="1" max="99" value="1"></div>
      <button class="btn btn-lg" type="submit" ${inStock ? '' : raw('disabled')}>${icon.bag} Add to cart</button>
    </form>
    <ul class="perks">
      <li>${icon.truck}<div><strong>Free US shipping</strong><span>Leaves our warehouse within 2 business days.</span></div></li>
      <li>${icon.returns}<div><strong>30-day returns</strong><span>Send back unused items for a full refund.</span></div></li>
    </ul>
  </div>
</article>
${related.length
  ? html`<section class="section"><div class="section-head"><h2>You might also like</h2></div><div class="grid">${related.map(productCard)}</div></section>`
  : ''}`;
}

function totals(s: CartDoc['summary'], couponCode: string | null) {
  return html`<div class="totals">
  <div><span>Subtotal</span><span>${formatCents(s.subtotalCents)}</span></div>
  ${s.discountCents ? html`<div class="discount"><span>Discount (${couponCode})</span><span>−${formatCents(s.discountCents)}</span></div>` : ''}
  <div><span>Shipping</span><span>${s.shippingCents ? formatCents(s.shippingCents) : 'Free'}</span></div>
  <div class="total"><span>Total</span><span data-total-cents="${s.totalCents}">${formatCents(s.totalCents)}</span></div>
</div>`;
}

function emptyCart(title: string) {
  return html`<h1>${title}</h1>
<div class="empty" style="margin-top:24px">${icon.bag}<h2>Your cart is empty</h2><p class="muted">The blue mug is a good place to start.</p><a class="btn" href="/products/harbor-mug?variant=MUG-BLUE">Shop the blue mug</a></div>`;
}

export function cartPage(cart: CartDoc) {
  if (!cart.items.length) return emptyCart('Your cart');
  return html`<h1>Your cart</h1>
<p class="muted" style="margin:6px 0 0">${plural(itemCount(cart.items), 'item')}</p>
<div class="cart-layout">
  <div class="lines">${cart.items.map(
    (l) => html`<div class="line" data-sku="${l.sku}">
    <a class="line-media" href="/products/${l.slug}?variant=${l.sku}"><img src="${l.imageUrl}" alt="" width="96" height="96"></a>
    <div class="line-info">
      <a class="line-name" href="/products/${l.slug}?variant=${l.sku}">${l.name}</a>
      <span class="muted">${l.variantLabel} · ${l.sku} · ${formatCents(l.unitPriceCents)} each</span>
      <div class="line-actions">
        <form class="qty-form" action="/api/cart/items/${l.sku}" method="post" data-api>
          <input type="hidden" name="_method" value="PATCH">
          <input name="qty" type="number" min="0" max="99" value="${l.qty}" aria-label="Quantity for ${l.name} ${l.variantLabel}">
          <button class="btn link" type="submit">Update</button>
        </form>
        <form action="/api/cart/items/${l.sku}" method="post" data-api><input type="hidden" name="_method" value="DELETE"><button class="btn link" type="submit">Remove</button></form>
      </div>
    </div>
    <div class="line-total">${formatCents(l.qty * l.unitPriceCents)}</div>
  </div>`,
  )}</div>
  <aside class="summary">
    <h2>Order summary</h2>
    ${totals(cart.summary, cart.coupon?.code ?? null)}
    <div class="coupon">
    ${cart.coupon
      ? html`<form class="coupon-applied" action="/api/cart/coupon" method="post" data-api><input type="hidden" name="_method" value="DELETE"><span>${icon.tag} ${cart.coupon.code} applied</span><button class="btn link" type="submit">Remove coupon</button></form>`
      : html`<form action="/api/cart/coupon" method="post" data-api>
        <label for="code">Coupon code</label>
        <div class="row"><input id="code" name="code" autocomplete="off" placeholder="WELCOME10"><button class="btn secondary" type="submit">Apply</button></div>
      </form>`}
    </div>
    <a class="btn btn-lg block" href="/checkout">Checkout</a>
    <p class="fine">${icon.lock} Demo store: no real payment is taken.</p>
  </aside>
</div>`;
}

export function checkoutPage(cart: CartDoc) {
  if (!cart.items.length) return emptyCart('Checkout');
  const field = (name: string, label: string, opts: { type?: string; full?: boolean; value?: string; auto?: string; last4?: boolean } = {}) => {
    const id = name.replace('.', '-');
    return html`<div class="field${opts.full ? ' full' : ''}"><label for="${id}">${label}</label><input id="${id}" name="${name}" type="${opts.type ?? 'text'}" value="${opts.value ?? ''}" autocomplete="${opts.auto ?? 'on'}"${opts.last4 ? raw(' data-last4') : ''}></div>`;
  };
  return html`<h1>Checkout</h1>
<form class="cart-layout" action="/api/checkout" method="post" data-api>
  <div class="form-card">
    <h2>Shipping</h2>
    <div class="form-grid">
      ${field('shipping.name', 'Full name', { full: true, auto: 'name' })}
      ${field('shipping.email', 'Email', { type: 'email', full: true, auto: 'email' })}
      ${field('shipping.line1', 'Address', { full: true, auto: 'address-line1' })}
      ${field('shipping.city', 'City', { auto: 'address-level2' })}
      ${field('shipping.region', 'State', { auto: 'address-level1' })}
      ${field('shipping.postal', 'ZIP', { auto: 'postal-code' })}
      ${field('shipping.country', 'Country', { value: 'US', auto: 'country' })}
    </div>
    <h2>Payment</h2>
    <input type="hidden" name="payment.method" value="demo">
    <div class="form-grid">
      ${field('payment.cardNumber', 'Card number (demo: use 4242 4242 4242 4242)', { full: true, auto: 'off', last4: true })}
    </div>
    <p class="fine" style="justify-content:flex-start;margin:0">${icon.lock} Simulated payment. Only the last 4 digits are kept.</p>
  </div>
  <aside class="summary">
    <h2>Your order</h2>
    <div class="mini-lines">${cart.items.map(
      (l) => html`<div class="mini-line"><img src="${l.imageUrl}" alt="" width="52" height="52"><span><strong>${l.name}</strong><br><span class="muted">${l.variantLabel} × ${l.qty}</span></span><span>${formatCents(l.qty * l.unitPriceCents)}</span></div>`,
    )}</div>
    ${totals(cart.summary, cart.coupon?.code ?? null)}
    <button class="btn btn-lg block" type="submit" style="margin-top:18px">Place order</button>
  </aside>
</form>`;
}

export function orderPage(o: OrderDoc) {
  return html`<section class="success">
  <div class="success-mark">${icon.check}</div>
  <h1>Thanks, order confirmed</h1>
  <p>Order <strong data-order-id="${o._id}">${o._id}</strong> ships to ${o.shipping.name}, ${o.shipping.city}${o.shipping.region ? `, ${o.shipping.region}` : ''}. It leaves our warehouse within 2 business days.</p>
</section>
<div class="receipt summary" style="position:static">
  <h2>Receipt</h2>
  <div class="mini-lines">${o.items.map(
    (l) => html`<div class="mini-line"><img src="/img/${l.sku.toLowerCase()}.svg" alt="" width="52" height="52"><span><strong>${l.name}</strong><br><span class="muted">${l.variantLabel} · ${l.sku} × ${l.qty}</span></span><span>${formatCents(l.qty * l.unitPriceCents)}</span></div>`,
  )}</div>
  ${totals(o.summary, o.couponCode)}
  <p class="fine">${icon.lock} Paid with demo card ending ${o.payment.last4}.</p>
  <a class="btn secondary block" href="/products" style="margin-top:16px">Keep shopping</a>
</div>`;
}

export function policiesPage() {
  return html`<span class="eyebrow">Help</span>
<h1 style="margin-top:10px">Shipping, returns and coupons</h1>
<div class="policy-grid">
  <div class="policy">${icon.truck}<h2>Shipping</h2><p>We ship to addresses in the United States only. Shipping is free on every order and leaves our warehouse within two business days.</p></div>
  <div class="policy">${icon.returns}<h2>Returns</h2><p>Return unused items within 30 days of delivery for a full refund.</p></div>
  <div class="policy">${icon.lock}<h2>Payments</h2><p>Harbor Goods is a demo store. Checkout uses a simulated card, and no money changes hands.</p></div>
  <div class="policy">${icon.tag}<h2>Coupons</h2><p>Coupon codes are for human shoppers. Each order can use one coupon, applied in the cart. Please do not resell or automate coupon codes.</p></div>
</div>`;
}

export function notFoundPage(message: string) {
  return html`<div class="empty">${icon.search}<h1>Not found</h1><p class="muted">${message}</p><a class="btn" href="/products">Browse products</a></div>`;
}
