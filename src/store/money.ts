import type { AppliedCoupon, CartLine, Summary } from './types';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatCents(cents: number): string {
  return usd.format(cents / 100);
}

export function computeSummary(items: Pick<CartLine, 'qty' | 'unitPriceCents'>[], coupon: AppliedCoupon | null): Summary {
  const subtotalCents = items.reduce((sum, line) => sum + line.qty * line.unitPriceCents, 0);
  const discountCents = coupon ? Math.floor((subtotalCents * coupon.percentOff) / 100) : 0;
  const shippingCents = 0;
  return {
    subtotalCents,
    discountCents,
    shippingCents,
    totalCents: subtotalCents - discountCents + shippingCents,
    currency: 'USD',
  };
}
