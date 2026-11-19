'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'assets', 'rich-menu.png');
const generator = fs.readFileSync(path.join(__dirname, '..', 'tools', 'make-rich-menu.mjs'), 'utf8');

test('the first rich-menu icon is a magnifying glass', () => {
  const firstPanel = generator.match(/const panels = \[([\s\S]*?)\n\];/);
  assert.ok(firstPanel, 'rich-menu panels are defined');
  assert.match(firstPanel[1], /\{ text: '物件を見る', bg: '#2B8A3E', icon: 'search' \}/);

  const searchIcon = generator.match(/search:\s*`([\s\S]*?)`/);
  assert.ok(searchIcon, 'magnifying-glass icon is defined');
  assert.match(searchIcon[1], /<circle\b[^>]*fill="none"[^>]*stroke="#FFFFFF"/);
  assert.match(searchIcon[1], /<path\b[^>]*d="M62 62L88 88"[^>]*stroke="#FFFFFF"/);
});

test('rich menu image is a 2500x1686 PNG under 1 MB', () => {
  assert.ok(fs.existsSync(file), 'assets/rich-menu.png exists');
  const buf = fs.readFileSync(file);
  assert.deepStrictEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'PNG signature');
  assert.strictEqual(buf.toString('latin1', 12, 16), 'IHDR');
  assert.strictEqual(buf.readUInt32BE(16), 2500);
  assert.strictEqual(buf.readUInt32BE(20), 1686);
  assert.ok(buf.length < 1024 * 1024, `size ${buf.length} must be < 1 MB`);
});
