'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'assets', 'rich-menu.png');

test('rich menu image is a 2500x1686 PNG under 1 MB', () => {
  assert.ok(fs.existsSync(file), 'assets/rich-menu.png exists');
  const buf = fs.readFileSync(file);
  assert.strictEqual(buf.readUInt32BE(16), 2500);
  assert.strictEqual(buf.readUInt32BE(20), 1686);
  assert.ok(buf.length < 1024 * 1024, `size ${buf.length} must be < 1 MB`);
});
