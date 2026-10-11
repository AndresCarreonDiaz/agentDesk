import type { Request } from 'express';
import { HttpError } from './errors';

export function isForm(req: Request): boolean {
  return Boolean(req.is('application/x-www-form-urlencoded'));
}

export function body(req: Request): Record<string, unknown> {
  return (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
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
