// Tiny escaping template tag: interpolations are escaped unless wrapped in raw().
export class Raw {
  constructor(readonly value: string) {}
  toString() {
    return this.value;
  }
}

export const raw = (value: string) => new Raw(value);

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escape(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

function render(value: unknown): string {
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  if (value === null || value === undefined || value === false) return '';
  return escape(String(value));
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  return raw(strings.reduce((out, s, i) => out + s + (i < values.length ? render(values[i]) : ''), ''));
}
