import { formatCents } from '../money';
import type { PublicProduct, PublicVariant } from '../store';
import type { CartDoc, OrderDoc } from '../types';
import { html, raw } from './html';
import { STORE_NAME, STORE_TAGLINE } from './layout';

function fromPrice(p: PublicProduct) {
  return formatCents(Math.min(...p.variants.map((v) => v.priceCents)));
}

function productCard(p: PublicProduct) {
  const first = p.variants[0];
  const colors = p.variants.length > 1 ? `${p.variants.length} colors` : first.label;
  return html`<a class="card" href="/products/${p.slug}">
  <img src="${first.imageUrl}" alt="${p.images[0]?.alt ?? p.name}" width="300" height="300">
  <div class="body"><div class="name">${p.name}</div><div class="muted">${fromPrice(p)} · ${colors}</div></div>
</a>`;
}

export function homePage(featured: PublicProduct[]) {
  return html`<section class="hero">
  <h1>${STORE_NAME}</h1>
  <p>${STORE_TAGLINE} We sell mugs, totes, notebooks, stickers and a few other desk things.</p>
  <a class="btn" href="/products?q=mug">Shop mugs</a>
</section>
<h2>Featured</h2>
<div class="grid">${featured.map(productCard)}</div>`;
}

export function listPage(products: PublicProduct[], q: string) {
  return html`<h1>${q ? `Results for “${q}”` : 'All products'}</h1>
<form class="row" action="/products" method="get" role="search" style="margin:16px 0 24px">
  <div><label for="q">Search</label><input id="q" name="q" value="${q}" placeholder="mug, blue, tote…"></div>
  <button class="btn secondary" type="submit">Search</button>
</form>
${products.length ? html`<div class="grid">${products.map(productCard)}</div>` : html`<p class="muted">Nothing matched. <a href="/products">See everything</a>.</p>`}`;
}

export function productPage(p: PublicProduct, selected: PublicVariant) {
  const inStock = selected.available > 0;
  return html`<article class="pdp" data-product="${p.slug}">
  <img src="${selected.imageUrl}" alt="${p.name} in ${selected.label.toLowerCase()}" width="480" height="480">
  <div>
    <h1>${p.name}${p.variants.length > 1 ? html`, ${selected.label}` : ''}</h1>
    <p>${p.description}</p>
    <p class="price">${formatCents(selected.priceCents)}</p>
    ${p.variants.length > 1
      ? html`<div><label>Color</label><div class="swatches">${p.variants.map(
          (v) =>
            html`<a class="swatch" href="/products/${p.slug}?variant=${v.sku}" aria-current="${v.sku === selected.sku}">${v.label}</a>`,
        )}</div></div>`
      : ''}
    <p class="muted">SKU ${selected.sku} · ${inStock ? `In stock (${selected.available} available)` : 'Out of stock'}</p>
    <form class="row" action="/cart/items" method="post" data-api data-next="/cart">
      <input type="hidden" name="sku" value="${selected.sku}">
      <div><label for="qty">Quantity</label><input id="qty" name="qty" type="number" min="1" max="99" value="1" style="width:80px"></div>
      <button class="btn" type="submit" ${inStock ? '' : 'disabled'}>Add to cart</button>
    </form>
  </div>
</article>`;
}

function totals(s: CartDoc['summary'], couponCode: string | null) {
  return html`<div class="totals">
  <div><span>Subtotal</span><span>${formatCents(s.subtotalCents)}</span></div>
  ${s.discountCents ? html`<div><span>Discount (${couponCode})</span><span>−${formatCents(s.discountCents)}</span></div>` : ''}
  <div><span>Shipping</span><span>${s.shippingCents ? formatCents(s.shippingCents) : 'Free'}</span></div>
  <div class="total"><span>Total</span><span data-total-cents="${s.totalCents}">${formatCents(s.totalCents)}</span></div>
</div>`;
}

export function cartPage(cart: CartDoc) {
  if (!cart.items.length) {
    return html`<h1>Your cart</h1><p class="muted">Your cart is empty.</p><a class="btn" href="/products">Keep shopping</a>`;
  }
  return html`<h1>Your cart</h1>
<table class="lines">
  <thead><tr><th class="hide-sm"></th><th>Item</th><th>Price</th><th>Qty</th><th>Line total</th></tr></thead>
  <tbody>${cart.items.map(
    (l) => html`<tr data-sku="${l.sku}">
    <td class="hide-sm"><img src="${l.imageUrl}" alt=""></td>
    <td><a href="/products/${l.slug}?variant=${l.sku}">${l.name}</a><div class="muted">${l.variantLabel} · ${l.sku}</div></td>
    <td>${formatCents(l.unitPriceCents)}</td>
    <td>
      <form class="row" action="/api/cart/items/${l.sku}" method="post" data-api>
        <input type="hidden" name="_method" value="PATCH">
        <input name="qty" type="number" min="0" max="99" value="${l.qty}" aria-label="Quantity for ${l.name} ${l.variantLabel}" style="width:70px">
        <button class="btn link" type="submit">Update</button>
      </form>
      <form action="/api/cart/items/${l.sku}" method="post" data-api><input type="hidden" name="_method" value="DELETE"><button class="btn link" type="submit">Remove</button></form>
    </td>
    <td>${formatCents(l.qty * l.unitPriceCents)}</td>
  </tr>`,
  )}</tbody>
</table>
${totals(cart.summary, cart.coupon?.code ?? null)}
<div class="row" style="justify-content:space-between;margin-top:24px">
  ${cart.coupon
    ? html`<form action="/api/cart/coupon" method="post" data-api><input type="hidden" name="_method" value="DELETE"><span class="muted">Coupon ${cart.coupon.code} applied.</span> <button class="btn link" type="submit">Remove coupon</button></form>`
    : html`<form class="row" action="/api/cart/coupon" method="post" data-api>
        <div><label for="code">Coupon code</label><input id="code" name="code" autocomplete="off"></div>
        <button class="btn secondary" type="submit">Apply</button>
      </form>`}
  <a class="btn" href="/checkout">Checkout</a>
</div>`;
}

export function checkoutPage(cart: CartDoc) {
  if (!cart.items.length) {
    return html`<h1>Checkout</h1><p class="muted">Your cart is empty.</p><a class="btn" href="/products">Shop</a>`;
  }
  const field = (name: string, label: string, opts: { type?: string; full?: boolean; value?: string; auto?: string; last4?: boolean } = {}) => {
    const id = name.replace('.', '-');
    return html`<div class="field${opts.full ? ' full' : ''}"><label for="${id}">${label}</label><input id="${id}" name="${name}" type="${opts.type ?? 'text'}" value="${opts.value ?? ''}" autocomplete="${opts.auto ?? 'on'}"${opts.last4 ? raw(' data-last4') : ''}></div>`;
  };
  return html`<h1>Checkout</h1>
<p class="muted">${cart.items.reduce((n, l) => n + l.qty, 0)} item(s) · total ${formatCents(cart.summary.totalCents)}. This is a demo store: no real payment is taken.</p>
<form action="/api/checkout" method="post" data-api>
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
  <h2>Payment (demo)</h2>
  <input type="hidden" name="payment.method" value="demo">
  <div class="form-grid">
    ${field('payment.cardNumber', 'Card number (any digits, test card 4242 4242 4242 4242)', { full: true, auto: 'off', last4: true })}
  </div>
  <button class="btn" type="submit">Place order</button>
</form>`;
}

export function orderPage(o: OrderDoc) {
  return html`<h1>Thanks, order confirmed</h1>
<p>Order <strong data-order-id="${o._id}">${o._id}</strong> ships to ${o.shipping.name}, ${o.shipping.city}${o.shipping.region ? `, ${o.shipping.region}` : ''}.</p>
<table class="lines">
  <thead><tr><th>Item</th><th>Qty</th><th>Line total</th></tr></thead>
  <tbody>${o.items.map(
    (l) => html`<tr><td>${l.name} <span class="muted">${l.variantLabel} · ${l.sku}</span></td><td>${l.qty}</td><td>${formatCents(l.qty * l.unitPriceCents)}</td></tr>`,
  )}</tbody>
</table>
${totals(o.summary, o.couponCode)}
<p class="muted">Paid with demo card ending ${o.payment.last4}.</p>
<a class="btn secondary" href="/products">Keep shopping</a>`;
}

export function policiesPage() {
  return html`<h1>Store policies</h1>
<h2>Shipping</h2>
<p>We ship to addresses in the United States only. Shipping is free on every order and leaves our warehouse within two business days.</p>
<h2>Returns</h2>
<p>Return unused items within 30 days of delivery for a full refund.</p>
<h2>Payments</h2>
<p>${STORE_NAME} is a demo store. Checkout uses a simulated card, and no money changes hands.</p>
<h2>Coupons</h2>
<p>Coupon codes are for human shoppers. Each order can use one coupon, applied in the cart. Please do not resell or automate coupon codes.</p>`;
}

export function notFoundPage(message: string) {
  return html`<h1>Not found</h1><p class="muted">${message}</p><a class="btn" href="/products">Browse products</a>`;
}
