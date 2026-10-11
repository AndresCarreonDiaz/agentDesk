import type { CouponDoc, ProductDoc } from './types';

type SeedProduct = Omit<ProductDoc, 'createdAt' | 'images' | 'variants' | 'active'> & {
  variants: { sku: string; color: string; label: string; priceCents: number }[];
};

// Swatch colors for the generated SVG product images (served from /img/:sku.svg).
export const SWATCHES: Record<string, string> = {
  'MUG-BLUE': '#2f6fde',
  'MUG-WHITE': '#f1ede4',
  'MUG-CLAY': '#c4694a',
  'TOTE-NAT': '#d8c49c',
  'NOTE-DOT': '#2d3a4a',
  'STK-PACK': '#e0a526',
  'CST-CORK': '#b4885a',
  'PEN-BLK': '#26262b',
};

const SEED: SeedProduct[] = [
  {
    _id: 'prod_harbor_mug',
    slug: 'harbor-mug',
    name: 'Harbor Mug',
    description: '12oz stoneware mug with a glazed finish. The blue mug is the house favorite.',
    category: 'mugs',
    tags: ['mug', 'ceramic', 'desk', 'coffee'],
    featured: true,
    variants: [
      { sku: 'MUG-BLUE', color: 'blue', label: 'Blue', priceCents: 2400 },
      { sku: 'MUG-WHITE', color: 'white', label: 'White', priceCents: 2400 },
      { sku: 'MUG-CLAY', color: 'clay', label: 'Clay', priceCents: 2400 },
    ],
  },
  {
    _id: 'prod_canvas_tote',
    slug: 'canvas-tote',
    name: 'Canvas Tote',
    description: 'Heavy natural canvas tote with an inside pocket. Fits a laptop and lunch.',
    category: 'bags',
    tags: ['tote', 'bag', 'canvas'],
    featured: true,
    variants: [{ sku: 'TOTE-NAT', color: 'natural', label: 'Natural', priceCents: 3200 }],
  },
  {
    _id: 'prod_notebook',
    slug: 'softcover-notebook',
    name: 'Softcover Notebook',
    description: 'A5 dot-grid notebook, 120 pages, lies flat.',
    category: 'paper',
    tags: ['notebook', 'paper', 'dot grid'],
    featured: true,
    variants: [{ sku: 'NOTE-DOT', color: 'navy', label: 'Navy dot grid', priceCents: 1400 }],
  },
  {
    _id: 'prod_sticker',
    slug: 'laptop-stickers',
    name: 'Laptop Sticker Pack',
    description: 'Six matte vinyl stickers with harbor and wave designs.',
    category: 'stickers',
    tags: ['sticker', 'laptop', 'vinyl'],
    featured: false,
    variants: [{ sku: 'STK-PACK', color: 'assorted', label: 'Assorted', priceCents: 800 }],
  },
  {
    _id: 'prod_coaster',
    slug: 'cork-coaster',
    name: 'Cork Coaster',
    description: 'Natural cork coaster sized for the Harbor Mug.',
    category: 'desk',
    tags: ['coaster', 'cork', 'desk'],
    featured: false,
    variants: [{ sku: 'CST-CORK', color: 'cork', label: 'Cork', priceCents: 900 }],
  },
  {
    _id: 'prod_pen',
    slug: 'gel-pen',
    name: 'Gel Pen',
    description: '0.5mm black gel pen with a metal clip.',
    category: 'desk',
    tags: ['pen', 'writing', 'desk'],
    featured: false,
    variants: [{ sku: 'PEN-BLK', color: 'black', label: 'Black', priceCents: 600 }],
  },
];

export const STARTING_STOCK = 100;

export function seedProducts(now = new Date()): ProductDoc[] {
  return SEED.map((p) => {
    const variants = p.variants.map((v) => ({ ...v, imageUrl: `/img/${v.sku.toLowerCase()}.svg` }));
    return {
      ...p,
      variants,
      images: variants.map((v) => ({ url: v.imageUrl, alt: `${p.name} in ${v.label.toLowerCase()}` })),
      active: true,
      createdAt: now,
    };
  });
}

export const SEED_COUPONS: CouponDoc[] = [
  { _id: 'WELCOME10', code: 'WELCOME10', percentOff: 10, active: true, description: '10% off subtotal' },
];
