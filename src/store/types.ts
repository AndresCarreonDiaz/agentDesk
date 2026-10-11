export interface Variant {
  sku: string;
  color: string;
  label: string;
  priceCents: number;
  imageUrl: string;
}

export interface ProductDoc {
  _id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  images: { url: string; alt: string }[];
  variants: Variant[];
  featured: boolean;
  active: boolean;
  createdAt: Date;
}

export interface InventoryDoc {
  _id: string; // sku
  productId: string;
  available: number;
  reserved: number;
  sold: number;
}

export interface CartLine {
  sku: string;
  productId: string;
  slug: string;
  name: string;
  variantLabel: string;
  imageUrl: string;
  qty: number;
  unitPriceCents: number;
}

export interface Summary {
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
  currency: 'USD';
}

export interface AppliedCoupon {
  code: string;
  percentOff: number;
}

export interface CartDoc {
  _id: string;
  shopperId: string;
  status: 'active' | 'converted';
  items: CartLine[];
  coupon: AppliedCoupon | null;
  summary: Summary;
  orderId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CouponDoc {
  _id: string; // code
  code: string;
  percentOff: number;
  active: boolean;
  description: string;
}

export interface Shipping {
  name: string;
  email: string;
  line1: string;
  city: string;
  region: string;
  postal: string;
  country: string;
}

export interface OrderDoc {
  _id: string;
  shopperId: string;
  cartId: string;
  status: 'paid';
  items: Omit<CartLine, 'productId' | 'imageUrl'>[];
  summary: Summary;
  couponCode: string | null;
  idempotencyKey: string | null;
  shipping: Shipping;
  payment: { method: 'demo'; last4: string; transactionId: string };
  createdAt: Date;
}
