'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

process.env.LINE_CHANNEL_SECRET = 'test-secret';
process.env.LINE_CHANNEL_ID = 'test-id';
delete process.env.LINE_LIFF_ID;

// never hit the real LINE API
global.fetch = async () => {
  throw new Error('network disabled in tests');
};

const { handler, buildRichMenuDefinition, richMenuName } = require('../server.js');

function call(method, body, signature) {
  const req = new EventEmitter();
  req.method = method;
  req.url = '/api/line/webhook';
  req.headers = signature ? { 'x-line-signature': signature } : {};
  req.destroy = () => {};
  return new Promise((resolve) => {
    const res = {
      headersSent: false,
      writeHead(status) {
        this.status = status;
      },
      end(data) {
        resolve({ status: this.status, body: data });
      },
    };
    handler(req, res);
    setImmediate(() => {
      if (body !== undefined) req.emit('data', Buffer.from(body));
      req.emit('end');
    });
  });
}

const sign = (body) =>
  crypto.createHmac('sha256', 'test-secret').update(body).digest('base64');

test('bad signature -> 401', async () => {
  const body = JSON.stringify({ events: [] });
  assert.strictEqual((await call('POST', body, 'AAAA')).status, 401);
  assert.strictEqual((await call('POST', body)).status, 401);
});

test('non-POST -> 405', async () => {
  assert.strictEqual((await call('GET')).status, 405);
});

test('empty events -> 200 {}', async () => {
  const body = JSON.stringify({ events: [] });
  const r = await call('POST', body, sign(body));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body, '{}');
});

test('menu areas tile 2500x843 without overlap', () => {
  const d = buildRichMenuDefinition({});
  assert.deepStrictEqual(d.size, { width: 2500, height: 843 });
  assert.strictEqual(d.chatBarText, 'メニュー');
  assert.strictEqual(d.areas.length, 4);
  let x = 0;
  for (const a of d.areas) {
    assert.deepStrictEqual(a.bounds, { x, y: 0, width: 625, height: 843 });
    x += 625;
  }
  assert.strictEqual(x, 2500);
});

test('labels, uri-only actions and addresses', () => {
  const d = buildRichMenuDefinition({});
  const expected = [
    ['新しいアイデア', 'https://liff.line.me/ID?redirect=%2Fm%2Fnew'],
    ['プロジェクト', 'https://liff.line.me/ID?redirect=%2Fm%2Fprojects'],
    ['ホーム', 'https://liff.line.me/ID?redirect=%2Fm%2Fhome'],
    ['マイページ', 'https://liff.line.me/ID?redirect=%2Fm%2Fme'],
  ];
  d.areas.forEach((a, i) => {
    assert.strictEqual(a.action.type, 'uri');
    assert.ok(a.action.label.length <= 12);
    assert.strictEqual(a.action.label, expected[i][0]);
    assert.strictEqual(a.action.uri, expected[i][1]);
  });
});

test('LINE_LIFF_ID replaces ID', () => {
  const d = buildRichMenuDefinition({ LINE_LIFF_ID: '1234-abcd' });
  assert.strictEqual(d.areas[0].action.uri, 'https://liff.line.me/1234-abcd?redirect=%2Fm%2Fnew');
  assert.strictEqual(d.areas[3].action.uri, 'https://liff.line.me/1234-abcd?redirect=%2Fm%2Fme');
});

test('name changes when definition changes', () => {
  const png = Buffer.from('png');
  const a = richMenuName(buildRichMenuDefinition({}), png);
  const b = richMenuName(buildRichMenuDefinition({ LINE_LIFF_ID: 'x-y' }), png);
  assert.match(a, /^pm-menu-[0-9a-f]{12}$/);
  assert.notStrictEqual(a, b);
  assert.notStrictEqual(a, richMenuName(buildRichMenuDefinition({}), Buffer.from('other')));
});
