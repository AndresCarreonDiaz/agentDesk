import { randomBytes } from 'node:crypto';

export function newId(prefix: string, bytes = 8): string {
  return `${prefix}_${randomBytes(bytes).toString('hex')}`;
}
