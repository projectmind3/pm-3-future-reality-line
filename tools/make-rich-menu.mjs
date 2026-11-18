// Generates assets/rich-menu.png (2500x843, 4 panels, Japanese labels).
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

const W = 2500, H = 843, N = 4, PW = W / N; // 625 per panel
const MARGIN = 50, FONT_PX = 84, LINE_GAP = 1.25, DIVIDER = 4;
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'rich-menu.png');

const panels = [
  { lines: ['新しい', 'アイデア'], bg: '#D9480F' },
  { lines: ['プロジェクト'], bg: '#1864AB' },
  { lines: ['ホーム'], bg: '#2B8A3E' },
  { lines: ['マイページ'], bg: '#6741D9' },
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

const composites = [];
for (const [i, p] of panels.entries()) {
  const x0 = i * PW;
  composites.push({
    input: { create: { width: PW, height: H, channels: 3, background: p.bg } },
    left: x0, top: 0,
  });
  const lines = [];
  for (const t of p.lines) {
    const r = await renderLine(t);
    if (r.w > PW - 2 * MARGIN || r.h > H - 2 * MARGIN) {
      throw new Error(`Label "${t}" too large: ${r.w}x${r.h} (max ${PW - 2 * MARGIN}x${H - 2 * MARGIN})`);
    }
    console.log(`panel ${i + 1} "${t}": ${r.w}x${r.h} (max width ${PW - 2 * MARGIN})`);
    lines.push(r);
  }
  const step = Math.round(FONT_PX * LINE_GAP);
  const total = step * (lines.length - 1) + lines[lines.length - 1].h;
  let y = Math.round((H - total) / 2);
  for (const r of lines) {
    composites.push({ input: r.buf, left: x0 + Math.round((PW - r.w) / 2), top: y });
    y += step;
  }
  if (i > 0) {
    composites.push({
      input: { create: { width: DIVIDER, height: H, channels: 3, background: '#FFFFFF' } },
      left: x0 - DIVIDER / 2, top: 0,
    });
  }
}

fs.mkdirSync(path.dirname(out), { recursive: true });
await sharp({ create: { width: W, height: H, channels: 3, background: '#000000' } })
  .composite(composites)
  .png({ palette: true, compressionLevel: 9 })
  .toFile(out);

const meta = await sharp(out).metadata();
const size = fs.statSync(out).size;
if (meta.width !== W || meta.height !== H) throw new Error(`Bad size ${meta.width}x${meta.height}`);
if (size >= 1024 * 1024) throw new Error(`File too large: ${size}`);
console.log(`OK ${out}: ${meta.width}x${meta.height}, ${size} bytes`);
