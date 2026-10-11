// What the tap stores about a request body: its shape always, its values only when safe.
// Everything here must be cheap and bounded: it runs on every host request.

const SECRET_KEY =
  /pass(word|wd)?|pwd|secret|token|jwt|authorization|^auth$|bearer|cookie|session|credential|card|cvv|cvc|ccv|csc|security.?code|iban|ssn|pin\b|otp|api[-_]?key|^key$|private|signature|^sig$/i;
const CARD_NUMBER = /^\d[\d -]{11,22}\d$/;
const REDACTED = "[redacted]";
const MAX_DEPTH = 6;
const MAX_KEYS = 100;
const MAX_ARRAY = 50;
const MAX_STRING = 2000;
const MAX_STORED_JSON = 64 * 1024;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return REDACTED;
  if (typeof value === "string") return looksLikeCard(value) ? REDACTED : value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}...` : value;
  if (typeof value === "number") return Number.isInteger(value) && looksLikeCard(String(value)) ? REDACTED : value;
  if (isBinary(value)) return binaryMarker(value);
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    if (!isPlainObject(value)) return `[${value.constructor?.name ?? "object"}]`;
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [k, v] of Object.entries(value)) {
      if (++n > MAX_KEYS) {
        out["..."] = "more keys not stored";
        break;
      }
      const key = cleanKey(k);
      out[key] = SECRET_KEY.test(key) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** The body as the tap stores it: parsed text bodies are redacted like objects, opaque ones become a marker. */
export function storableBody(body: unknown): unknown {
  if (body === undefined || body === null) return null;
  if (isBinary(body)) return binaryMarker(body);
  let value: unknown = body;
  if (typeof body === "string") {
    value = parseText(body);
    if (typeof value === "string") return value.length ? `[text, ${value.length} chars]` : null;
  }
  const redacted = redact(value);
  // Keep documents small: Mongo caps them at 16 MB and the tap runs on every request.
  const size = safeSize(redacted);
  return size > MAX_STORED_JSON ? { truncated: true, approxBytes: size } : redacted;
}

/** Top-level field -> type. No values, so it is always safe to store. */
export function bodyShape(body: unknown): Record<string, string> {
  if (typeof body === "string") body = parseText(body);
  if (!body || typeof body !== "object" || Array.isArray(body) || isBinary(body) || !isPlainObject(body)) return {};
  const shape: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of Object.entries(body)) {
    if (++n > MAX_KEYS) break;
    shape[cleanKey(k)] = typeOf(v);
  }
  return shape;
}

export function flatQuery(query: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!query || typeof query !== "object") return out;
  let n = 0;
  for (const [k, v] of Object.entries(query)) {
    if (++n > MAX_KEYS) break;
    const key = cleanKey(k);
    const value = Array.isArray(v) ? v.map(String).join(",") : String(v);
    out[key] = SECRET_KEY.test(key) || looksLikeCard(value) ? REDACTED : value.slice(0, MAX_STRING);
  }
  return out;
}

function parseText(text: string): unknown {
  const t = text.trim();
  if (!t || t.length > 1_000_000) return text;
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return JSON.parse(t);
    } catch {
      return text;
    }
  }
  if (/^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(t)) {
    return Object.fromEntries(new URLSearchParams(t));
  }
  return text;
}

function isBinary(v: unknown): v is ArrayBufferView | ArrayBuffer {
  return Buffer.isBuffer(v) || ArrayBuffer.isView(v) || v instanceof ArrayBuffer;
}

function binaryMarker(v: ArrayBufferView | ArrayBuffer): { binary: true; bytes: number } {
  return { binary: true, bytes: v.byteLength };
}

function isPlainObject(v: object): boolean {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

// Mongo rejects keys with NUL; a leading "$" or a "." breaks queries on the stored document.
function cleanKey(k: string): string {
  return k.replace(/\u0000/g, "").replace(/^\$/, "_$").replace(/\./g, "_").slice(0, 200) || "_";
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function safeSize(v: unknown): number {
  try {
    return JSON.stringify(v)?.length ?? 0;
  } catch {
    return Infinity;
  }
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
