import { Router, type Response } from 'express';
import { seedProducts } from '../catalog';
import type { Collections } from '../db';
import { shopperId } from '../session';
import * as store from '../store';
import { layout, STORE_NAME, STORE_TAGLINE, type LayoutOptions } from '../views/layout';
import * as views from '../views/pages';
import { productSvg } from '../views/svg';
import type { Raw } from '../views/html';

// "Blue mug", "Natural tote": what the placeholder image says on it.
const IMAGE_LABELS = new Map(
  seedProducts().flatMap((p) =>
    p.variants.map((v) => [v.sku, `${v.label} ${p.name.split(' ').at(-1)!.toLowerCase()}`] as const),
  ),
);

export function pagesRouter(c: Collections, siteUrl: string) {
  const r = Router();

  async function send(res: Response, opts: Omit<LayoutOptions, 'cartCount' | 'error'>, content: Raw, status = 200) {
    const cart = await store.findActiveCart(c, shopperId(res));
    const cartCount = cart?.items.reduce((n, l) => n + l.qty, 0) ?? 0;
    const error = typeof res.req.query.error === 'string' ? res.req.query.error : undefined;
    res.status(status).type('html').send(layout({ ...opts, cartCount, error }, content));
  }

  r.get('/', async (_req, res) => {
    await send(res, { title: STORE_NAME }, views.homePage(await store.listProducts(c, undefined, true)));
  });

  r.get('/products', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    await send(res, { title: q ? `Search: ${q}` : 'Shop' }, views.listPage(await store.listProducts(c, q), q));
  });

  r.get('/products/:slug', async (req, res) => {
    const product = await store.getProduct(c, req.params.slug);
    const selected = product.variants.find((v) => v.sku === req.query.variant) ?? product.variants[0];
    const title = product.variants.length > 1 ? `${product.name}, ${selected.label}` : product.name;
    await send(res, { title, description: product.description }, views.productPage(product, selected));
  });

  r.get('/cart', async (_req, res) => {
    const sid = shopperId(res);
    const cart = (await store.findActiveCart(c, sid)) ?? store.emptyCartView(sid);
    await send(res, { title: 'Cart' }, views.cartPage(cart));
  });

  r.get('/checkout', async (_req, res) => {
    const sid = shopperId(res);
    const cart = (await store.findActiveCart(c, sid)) ?? store.emptyCartView(sid);
    await send(res, { title: 'Checkout' }, views.checkoutPage(cart));
  });

  r.get('/orders/:id', async (req, res) => {
    const order = await store.getOrder(c, shopperId(res), req.params.id);
    await send(res, { title: `Order ${order._id}` }, views.orderPage(order));
  });

  r.get('/policies', async (_req, res) => {
    await send(res, { title: 'Policies' }, views.policiesPage());
  });

  r.get('/img/:file', (req, res) => {
    const sku = req.params.file.replace(/\.svg$/i, '').toUpperCase();
    const svg = productSvg(sku, IMAGE_LABELS.get(sku) ?? sku);
    if (!svg) return res.sendStatus(404);
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(svg);
  });

  r.get('/sitemap.xml', async (_req, res) => {
    const products = await store.listProducts(c);
    const paths = ['/', '/products', ...products.map((p) => `/products/${p.slug}`), '/policies'];
    res
      .type('application/xml')
      .send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths
          .map((p) => `  <url><loc>${siteUrl}${p}</loc></url>`)
          .join('\n')}\n</urlset>\n`,
      );
  });

  // Store facts only. No API or tool list: AgentDesk has to learn those from traffic.
  r.get('/llms.txt', async (_req, res) => {
    const products = await store.listProducts(c);
    res.type('text/plain').send(
      `# ${STORE_NAME}\n\n> ${STORE_TAGLINE}\n\n` +
        `${STORE_NAME} is an online shop at ${siteUrl}. Payments are simulated (demo store).\n\n` +
        `## Products\n\n${products.map((p) => `- [${p.name}](${siteUrl}/products/${p.slug}): ${p.description}`).join('\n')}\n\n` +
        `## Pages\n\n- [All products](${siteUrl}/products)\n- [Policies](${siteUrl}/policies)\n- [Sitemap](${siteUrl}/sitemap.xml)\n`,
    );
  });

  return r;
}
