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
  bulb: `<circle cx="50" cy="38" r="26"/>
    <path d="M38 62h24v10a4 4 0 0 1-4 4H42a4 4 0 0 1-4-4z"/>
    <rect x="40" y="79" width="20" height="6" rx="3"/>`,
  folder: `<path d="M8 24a5 5 0 0 1 5-5h24l9 10h41a5 5 0 0 1 5 5v43a5 5 0 0 1-5 5H13a5 5 0 0 1-5-5z"/>`,
  home: `<path fill-rule="evenodd" d="M50 10L6 50h12v38h64V50h12zM42 88V62h16v26z"/>`,
  person: `<circle cx="50" cy="30" r="19"/>
    <path d="M12 90c0-22 15-35 38-35s38 13 38 35z"/>`,
};

const panels = [
  { text: '新しいアイデア', bg: '#D9480F', icon: 'bulb' },
  { text: 'プロジェクト', bg: '#1864AB', icon: 'folder' },
  { text: 'ホーム', bg: '#2B8A3E', icon: 'home' },
  { text: 'マイページ', bg: '#6741D9', icon: 'person' },
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
