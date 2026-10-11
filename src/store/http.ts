import type { Request } from 'express';
import { HttpError } from './errors';

export function isForm(req: Request): boolean {
  return Boolean(req.is('application/x-www-form-urlencoded'));
}

export function body(req: Request): Record<string, unknown> {
  const raw = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  return isForm(req) ? unflatten(raw) : raw;
}

// HTML forms name nested fields with dots ("shipping.city"), so a form post and the JSON
// the page script sends have the same shape: { shipping: { city } }.
export function unflatten(flat: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split('.');
    if (parts.some((p) => !p || p === '__proto__' || p === 'constructor' || p === 'prototype')) continue;
    let node = out;
    for (const p of parts.slice(0, -1)) {
      if (typeof node[p] !== 'object' || node[p] === null) node[p] = {};
      node = node[p] as Record<string, unknown>;
    }
    node[parts.at(-1)!] = value;
  }
  return out;
}

export function parseQty(value: unknown, { min, fallback }: { min: number; fallback?: number }): number {
  if ((value === undefined || value === '') && fallback !== undefined) return fallback;
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > 99) {
    throw new HttpError(400, 'bad_request', `qty must be an integer from ${min} to 99.`);
  }
  return n;
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, 'bad_request', `${field} is required.`);
  }
  return value.trim();
}
