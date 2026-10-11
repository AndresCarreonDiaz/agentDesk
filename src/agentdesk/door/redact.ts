// What the tap stores about a request body: its shape always, its values only when safe.

const SECRET_KEY = /pass(word|wd)?|secret|token|authorization|bearer|cookie|session|card|cvv|cvc|ccv|iban|ssn|pin\b|otp|api[-_]?key|private/i;
const CARD_NUMBER = /^\d[\d -]{11,22}\d$/;
const REDACTED = "[redacted]";
const MAX_DEPTH = 6;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return REDACTED;
  if (typeof value === "string") return looksLikeCard(value) ? REDACTED : value.length > 2000 ? `${value.slice(0, 2000)}...` : value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY.test(k) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function looksLikeCard(s: string): boolean {
  if (!CARD_NUMBER.test(s)) return false;
  const digits = s.replace(/\D/g, "");
  return digits.length >= 13 && digits.length <= 19 && luhn(digits);
}

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Top-level field -> type. No values, so it is always safe to store. */
export function bodyShape(body: unknown): Record<string, string> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const shape: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) shape[k] = typeOf(v);
  return shape;
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

export function flatQuery(query: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!query || typeof query !== "object") return out;
  for (const [k, v] of Object.entries(query)) {
    if (SECRET_KEY.test(k)) out[k] = REDACTED;
    else out[k] = Array.isArray(v) ? v.map(String).join(",") : String(v);
  }
  return out;
}
