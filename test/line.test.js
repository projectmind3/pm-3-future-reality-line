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

test('menu areas tile 2500x1686 without overlap', () => {
  const d = buildRichMenuDefinition({});
  assert.deepStrictEqual(d.size, { width: 2500, height: 1686 });
  assert.strictEqual(d.chatBarText, 'メニュー');
  assert.strictEqual(d.areas.length, 4);
  assert.deepStrictEqual(d.areas.map((a) => a.bounds), [
    { x: 0, y: 0, width: 1250, height: 843 },
    { x: 1250, y: 0, width: 1250, height: 843 },
    { x: 0, y: 843, width: 1250, height: 843 },
    { x: 1250, y: 843, width: 1250, height: 843 },
  ]);
  const total = d.areas.reduce((s, a) => s + a.bounds.width * a.bounds.height, 0);
  assert.strictEqual(total, 2500 * 1686);
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const p = d.areas[i].bounds;
      const q = d.areas[j].bounds;
      const overlap = p.x < q.x + q.width && q.x < p.x + p.width &&
        p.y < q.y + q.height && q.y < p.y + p.height;
      assert.ok(!overlap, `areas ${i} and ${j} overlap`);
    }
  }
});

const LIFF_URL = 'https://liff.line.me/2012657091-N3HrjM7P';

test('labels, action types and addresses', () => {
  const d = buildRichMenuDefinition({});
  const labels = ['物件を見る', '内見予約', 'お問い合わせ', '会社案内'];
  d.areas.forEach((a, i) => {
    assert.ok(a.action.label.length <= 12);
    assert.strictEqual(a.action.label, labels[i]);
    if (i === 0) {
      assert.strictEqual(a.action.type, 'uri');
      assert.strictEqual(a.action.uri, LIFF_URL);
    } else {
      assert.strictEqual(a.action.type, 'message');
      assert.strictEqual(a.action.text, labels[i]);
    }
  });
});

test('LINE_LIFF_ID does not change the first uri', () => {
  const d = buildRichMenuDefinition({ LINE_LIFF_ID: '1234-abcd' });
  assert.strictEqual(d.areas[0].action.uri, LIFF_URL);
});

test('name changes when definition changes', () => {
  const png = Buffer.from('png');
  const def = buildRichMenuDefinition({});
  const changed = buildRichMenuDefinition({});
  changed.areas[0].action.uri = 'https://liff.line.me/other';
  const a = richMenuName(def, png);
  assert.match(a, /^pm-menu-[0-9a-f]{12}$/);
  assert.notStrictEqual(a, richMenuName(changed, png));
  assert.notStrictEqual(a, richMenuName(def, Buffer.from('other')));
});

async function sendText(text) {
  const original = global.fetch;
  let replied;
  const got = new Promise((resolve) => {
    replied = resolve;
  });
  global.fetch = async (url, options = {}) => {
    const u = String(url);
    if (u.includes('/oauth2/v3/token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 't', expires_in: 3600 }) };
    }
    if (u.endsWith('/v2/bot/message/reply')) {
      replied(JSON.parse(options.body));
      return { ok: true, status: 200, text: async () => '{}' };
    }
    return { ok: false, status: 500, text: async () => '' };
  };
  try {
    const body = JSON.stringify({
      events: [{ type: 'message', replyToken: 'rt', message: { type: 'text', text } }],
    });
    const r = await call('POST', body, sign(body));
    assert.strictEqual(r.status, 200);
    const sent = await Promise.race([
      got,
      new Promise((_, rej) => setTimeout(() => rej(new Error('no reply')), 2000)),
    ]);
    assert.strictEqual(sent.messages.length, 1);
    return sent.messages[0].text;
  } finally {
    global.fetch = original;
  }
}

test('button texts get their replies, others get HELP', async () => {
  const { REPLY_TEXTS, HELP } = require('../server.js');
  const yoyaku = await sendText('内見予約');
  assert.strictEqual(yoyaku, REPLY_TEXTS['内見予約']);
  assert.match(yoyaku, /ご希望の日にち/);
  const toiawase = await sendText(' お問い合わせ ');
  assert.strictEqual(toiawase, REPLY_TEXTS['お問い合わせ']);
  assert.match(toiawase, /【電話番号】/);
  assert.match(toiawase, /【メールアドレス】/);
  assert.match(toiawase, /営業時間：【営業時間】/);
  const company = await sendText('会社案内');
  assert.strictEqual(company, REPLY_TEXTS['会社案内']);
  assert.match(company, /【会社名】.*【所在地】.*【営業時間】/s);
  assert.strictEqual(await sendText('こんにちは'), HELP);
  assert.strictEqual(await sendText('constructor'), HELP);
});
