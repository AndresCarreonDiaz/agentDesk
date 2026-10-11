import { randomBytes } from "node:crypto";

// CONTRACT section 2: prefix plus a random id.
export type IdPrefix = "ses" | "ep" | "req" | "cap" | "kn" | "rule" | "fb" | "aud";

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}
