// Generates assets/rich-menu.png (2500x1686, 2x2 panels, icon + Japanese label).
// One-off tool; its dependencies live OUTSIDE the repo (no package.json here):
//   npm install --no-save --prefix <depsDir> sharp @expo-google-fonts/noto-sans-jp
//   node tools/make-rich-menu.mjs <depsDir>
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const depsDir = process.argv[2];
if (!depsDir) {
  console.error('Usage: node tools/make-rich-menu.mjs <depsDir>');
  process.exit(1);
}
const req = createRequire(path.resolve(depsDir, 'noop.js'));
const sharp = req('sharp');
const fontfile = req.resolve('@expo-google-fonts/noto-sans-jp/package.json')
  .replace(/package\.json$/, '700Bold/NotoSansJP_700Bold.ttf');

const W = 2500, H = 1686, COLS = 2, ROWS = 2, PW = W / COLS, PH = H / ROWS; // 1250x843 per panel
const MARGIN = 50, FONT_PX = 110, ICON = 300, ICON_GAP = 60, DIVIDER = 4;
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'rich-menu.png');

// Simple white icons on a 100x100 viewBox.
const ICONS = {
  search: `<circle cx="42" cy="42" r="27" fill="none" stroke="#FFFFFF" stroke-width="10"/>
    <path d="M62 62L88 88" fill="none" stroke="#FFFFFF" stroke-width="10" stroke-linecap="round"/>`,
  calendar: `<rect x="26" y="6" width="10" height="22" rx="5"/>
    <rect x="64" y="6" width="10" height="22" rx="5"/>
    <path fill-rule="evenodd" d="M16 16h68a8 8 0 0 1 8 8v60a8 8 0 0 1-8 8H16a8 8 0 0 1-8-8V24a8 8 0 0 1 8-8zM18 42v42h64V42zM24 50h14v10H24zM43 50h14v10H43zM62 50h14v10H62zM24 66h14v10H24zM43 66h14v10H43z"/>`,
  chat: `<path fill-rule="evenodd" d="M20 14h60a12 12 0 0 1 12 12v34a12 12 0 0 1-12 12H50L28 90V72h-8a12 12 0 0 1-12-12V26a12 12 0 0 1 12-12zM25 43a6 6 0 1 0 12 0a6 6 0 1 0-12 0zM44 43a6 6 0 1 0 12 0a6 6 0 1 0-12 0zM63 43a6 6 0 1 0 12 0a6 6 0 1 0-12 0z"/>`,
  building: `<path fill-rule="evenodd" d="M22 8h56v84H22zM32 18h12v12H32zM56 18h12v12H56zM32 38h12v12H32zM56 38h12v12H56zM32 58h12v12H32zM56 58h12v12H56zM42 76h16v16H42z"/>`,
};

const panels = [
  { text: '物件を見る', bg: '#2B8A3E', icon: 'search' },
  { text: '内見予約', bg: '#D9480F', icon: 'calendar' },
  { text: 'お問い合わせ', bg: '#1864AB', icon: 'chat' },
  { text: '会社案内', bg: '#6741D9', icon: 'building' },
];

async function renderLine(text) {
  const { data, info } = await sharp({
    text: {
      text: `<span foreground="white">${text}</span>`,
      font: `Noto Sans JP Bold ${FONT_PX}`,
      fontfile, rgba: true, dpi: 72,
    },
  }).trim().png().toBuffer({ resolveWithObject: true });
  return { buf: data, w: info.width, h: info.height };
}

async function renderIcon(name) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON}" height="${ICON}" viewBox="0 0 100 100" fill="#FFFFFF">${ICONS[name]}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const composites = [];
for (const [i, p] of panels.entries()) {
  const x0 = (i % COLS) * PW, y0 = Math.floor(i / COLS) * PH;
  composites.push({
    input: { create: { width: PW, height: PH, channels: 3, background: p.bg } },
    left: x0, top: y0,
  });
  const label = await renderLine(p.text);
  const total = ICON + ICON_GAP + label.h;
  if (label.w > PW - 2 * MARGIN || total > PH - 2 * MARGIN) {
    throw new Error(`Panel "${p.text}" too large: ${label.w}x${total} (max ${PW - 2 * MARGIN}x${PH - 2 * MARGIN})`);
  }
  console.log(`panel ${i + 1} "${p.text}": label ${label.w}x${label.h}, content height ${total} (max ${PW - 2 * MARGIN}x${PH - 2 * MARGIN})`);
  const top = y0 + Math.round((PH - total) / 2);
  composites.push({ input: await renderIcon(p.icon), left: x0 + Math.round((PW - ICON) / 2), top });
  composites.push({ input: label.buf, left: x0 + Math.round((PW - label.w) / 2), top: top + ICON + ICON_GAP });
}
composites.push({
  input: { create: { width: DIVIDER, height: H, channels: 3, background: '#FFFFFF' } },
  left: PW - DIVIDER / 2, top: 0,
});
composites.push({
  input: { create: { width: W, height: DIVIDER, channels: 3, background: '#FFFFFF' } },
  left: 0, top: PH - DIVIDER / 2,
});

fs.mkdirSync(path.dirname(out), { recursive: true });
await sharp({ create: { width: W, height: H, channels: 3, background: '#000000' } })
  .composite(composites)
  .png({ palette: true, compressionLevel: 9 })
  .toFile(out);

const meta = await sharp(out).metadata();
const size = fs.statSync(out).size;
if (meta.width !== 2500 || meta.height !== 1686) throw new Error(`Bad size ${meta.width}x${meta.height}`);
if (size >= 1024 * 1024) throw new Error(`File too large: ${size}`);
console.log(`OK ${out}: ${meta.width}x${meta.height}, ${size} bytes`);
