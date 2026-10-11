import { SWATCHES } from '../catalog';
import { escape } from './html';

// Our own placeholder art: a flat product silhouette in the variant's color with a label,
// so both a camera and a vision model can read "Blue mug".
export function productSvg(sku: string, label: string): string | null {
  const fill = SWATCHES[sku];
  if (!fill) return null;
  const light = ['MUG-WHITE', 'TOTE-NAT'].includes(sku);
  const stroke = light ? '#b9b3a6' : 'none';
  const kind = sku.split('-')[0];
  const shapes: Record<string, string> = {
    MUG: `<rect x="110" y="120" width="150" height="170" rx="18" fill="${fill}" stroke="${stroke}" stroke-width="3"/><path d="M260 160h22a34 34 0 0 1 0 68h-22" fill="none" stroke="${light ? '#b9b3a6' : fill}" stroke-width="18"/>`,
    TOTE: `<path d="M150 150v-30a50 50 0 0 1 100 0v30" fill="none" stroke="#9c8a63" stroke-width="10"/><path d="M110 150h180l-14 160H124z" fill="${fill}" stroke="${stroke}" stroke-width="3"/>`,
    NOTE: `<rect x="120" y="100" width="160" height="210" rx="10" fill="${fill}"/><rect x="134" y="100" width="6" height="210" fill="#00000033"/>`,
    STK: `<circle cx="160" cy="170" r="48" fill="${fill}"/><rect x="190" y="180" width="90" height="90" rx="16" fill="#1f5fbf"/><circle cx="150" cy="260" r="30" fill="#c4694a"/>`,
    CST: `<circle cx="200" cy="205" r="95" fill="${fill}"/><circle cx="200" cy="205" r="80" fill="none" stroke="#00000022" stroke-width="3"/>`,
    PEN: `<rect x="185" y="90" width="30" height="210" rx="8" fill="${fill}" transform="rotate(30 200 200)"/><rect x="214" y="80" width="6" height="90" fill="#9aa0a6" transform="rotate(30 200 200)"/>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" role="img" aria-label="${escape(label)}">
<rect width="400" height="400" fill="#f2f0ea"/>
${shapes[kind] ?? `<rect x="110" y="110" width="180" height="180" rx="20" fill="${fill}"/>`}
<text x="200" y="365" text-anchor="middle" font-family="system-ui,sans-serif" font-size="24" fill="#3a3f45">${escape(label)}</text>
</svg>`;
}
