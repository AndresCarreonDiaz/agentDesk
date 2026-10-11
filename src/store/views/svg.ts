import { SWATCHES } from '../catalog';
import { escape } from './html';

// Our own product art, drawn in code: a studio-style shot of the product in the variant's
// color, with a small caption so a camera and a vision model can both read "Blue mug".
export function productSvg(sku: string, label: string): string | null {
  const fill = SWATCHES[sku];
  if (!fill) return null;
  const light = ['MUG-WHITE', 'TOTE-NAT'].includes(sku);
  const edge = light ? '#c9c1b2' : 'none';
  const kind = sku.split('-')[0];
  const shapes: Record<string, string> = {
    MUG: `
      <path d="M268 178h26a46 46 0 0 1 0 92h-26" fill="none" stroke="${fill}" stroke-width="22" stroke-linecap="round"/>
      ${light ? `<path d="M268 178h26a46 46 0 0 1 0 92h-26" fill="none" stroke="${edge}" stroke-width="2"/>` : ''}
      <path d="M118 150h150v158a28 28 0 0 1-28 28h-94a28 28 0 0 1-28-28z" fill="${fill}" stroke="${edge}" stroke-width="2"/>
      <path d="M118 150h150v158a28 28 0 0 1-28 28h-94a28 28 0 0 1-28-28z" fill="url(#shade)"/>
      <ellipse cx="193" cy="150" rx="75" ry="13" fill="${fill}" stroke="${edge}" stroke-width="2"/>
      <ellipse cx="193" cy="151" rx="64" ry="8" fill="#000" opacity=".22"/>
      <rect x="138" y="172" width="12" height="130" rx="6" fill="#fff" opacity=".28"/>`,
    TOTE: `
      <path d="M160 168v-34a40 40 0 0 1 80 0v34" fill="none" stroke="#8d7a55" stroke-width="10" stroke-linecap="round"/>
      <path d="M112 166h176l-12 172a12 12 0 0 1-12 11H136a12 12 0 0 1-12-11z" fill="${fill}" stroke="${edge}" stroke-width="2"/>
      <path d="M112 166h176l-12 172a12 12 0 0 1-12 11H136a12 12 0 0 1-12-11z" fill="url(#shade)"/>
      <rect x="168" y="212" width="64" height="44" rx="6" fill="#000" opacity=".07"/>`,
    NOTE: `
      <rect x="128" y="104" width="160" height="226" rx="10" fill="#000" opacity=".1" transform="translate(8 6)"/>
      <rect x="122" y="100" width="160" height="226" rx="10" fill="${fill}"/>
      <rect x="122" y="100" width="160" height="226" rx="10" fill="url(#shade)"/>
      <rect x="138" y="100" width="7" height="226" fill="#000" opacity=".25"/>
      <rect x="252" y="100" width="10" height="226" fill="#e0a526" opacity=".9"/>`,
    STK: `
      <circle cx="160" cy="176" r="56" fill="${fill}"/>
      <path d="M160 150l12 24 26 4-19 18 5 26-24-13-24 13 5-26-19-18 26-4z" fill="#fff" opacity=".9"/>
      <rect x="196" y="186" width="98" height="98" rx="22" fill="#1f5fbf" transform="rotate(8 245 235)"/>
      <path d="M216 240q14-18 28 0t28 0" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" transform="rotate(8 245 235)"/>
      <circle cx="150" cy="276" r="36" fill="#c4694a"/>`,
    CST: `
      <ellipse cx="200" cy="232" rx="118" ry="44" fill="#8d6a43"/>
      <ellipse cx="200" cy="222" rx="118" ry="44" fill="${fill}"/>
      <ellipse cx="200" cy="222" rx="98" ry="35" fill="none" stroke="#000" stroke-opacity=".12" stroke-width="3"/>`,
    PEN: `
      <g transform="rotate(32 200 210)">
        <rect x="186" y="80" width="28" height="230" rx="12" fill="${fill}"/>
        <rect x="192" y="88" width="5" height="210" rx="2.5" fill="#fff" opacity=".22"/>
        <rect x="209" y="70" width="7" height="96" rx="3.5" fill="#a7adb5"/>
        <path d="M186 304h28l-14 30z" fill="#a7adb5"/>
      </g>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" role="img" aria-label="${escape(label)}">
<defs>
  <radialGradient id="bg" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="#fbf8f2"/><stop offset="1" stop-color="#ebe3d5"/></radialGradient>
  <linearGradient id="shade" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".16"/></linearGradient>
  <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
</defs>
<rect width="400" height="400" fill="url(#bg)"/>
<ellipse cx="200" cy="346" rx="112" ry="13" fill="#5b4a2f" opacity=".2" filter="url(#soft)"/>
${shapes[kind] ?? `<rect x="110" y="110" width="180" height="180" rx="20" fill="${fill}"/>`}
<text x="200" y="384" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="15" font-weight="600" letter-spacing="1.5" fill="#7a7062">${escape(label.toUpperCase())}</text>
</svg>`;
}
