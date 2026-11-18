'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) process.loadEnvFile(envPath);
} catch (e) {
  console.error('env load failed');
}

const MAX_BODY = 1024 * 1024;
const PUBLIC_DIR = path.join(__dirname, 'public');
const RICH_MENU_IMAGE = path.join(__dirname, 'assets', 'rich-menu.png');
const MENU_PREFIX = 'pm-menu-';
const MENU_WIDTH = 2500;
const MENU_HEIGHT = 1686;

// ID is a placeholder; replaced by LINE_LIFF_ID when set.
const MENU_BUTTONS = [
  { label: '新しいアイデア', uri: 'https://liff.line.me/ID?redirect=%2Fm%2Fnew' },
  { label: 'プロジェクト', uri: 'https://liff.line.me/ID?redirect=%2Fm%2Fprojects' },
  { label: 'ホーム', uri: 'https://liff.line.me/ID?redirect=%2Fm%2Fhome' },
  { label: 'マイページ', uri: 'https://liff.line.me/ID?redirect=%2Fm%2Fme' },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

// ---------- rich menu definition ----------

function buildRichMenuDefinition(env = process.env) {
  const liffId = env.LINE_LIFF_ID;
  const width = MENU_WIDTH / 2;
  const height = MENU_HEIGHT / 2;
  return {
    size: { width: MENU_WIDTH, height: MENU_HEIGHT },
    selected: true,
    chatBarText: 'メニュー',
    areas: MENU_BUTTONS.map((b, i) => ({
      bounds: { x: (i % 2) * width, y: Math.floor(i / 2) * height, width, height },
      action: {
        type: 'uri',
        label: b.label,
        uri: liffId
          ? b.uri.replace(/^(https:\/\/liff\.line\.me\/)[^?/#]*/, (_, p) => p + liffId)
          : b.uri,
      },
    })),
  };
}

function richMenuName(definition, pngBytes) {
  const h = crypto.createHash('sha256');
  h.update(JSON.stringify(definition));
  h.update(pngBytes);
  return MENU_PREFIX + h.digest('hex').slice(0, 12);
}

// ---------- LINE API ----------

let tokenCache = null;

async function getAccessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  const res = await fetch('https://api.line.me/oauth2/v3/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.LINE_CHANNEL_ID || '',
      client_secret: process.env.LINE_CHANNEL_SECRET || '',
    }),
  });
  if (!res.ok) throw new Error('token request failed: ' + res.status);
  const data = await res.json();
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(0, (data.expires_in || 0) - 60) * 1000,
  };
  return tokenCache.token;
}

async function lineFetch(url, options = {}) {
  const token = await getAccessToken();
  return fetch(url, {
    ...options,
    headers: { Authorization: 'Bearer ' + token, ...(options.headers || {}) },
  });
}

async function lineJson(url, options, what) {
  const res = await lineFetch(url, options);
  if (!res.ok) throw new Error(what + ' failed: ' + res.status);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

async function replyMessages(replyToken, messages) {
  const body = {
    replyToken,
    messages: messages.slice(0, 5).map((m) => ({ ...m, text: String(m.text).slice(0, 5000) })),
  };
  const res = await lineFetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('reply failed: ' + res.status);
}

// ---------- rich menu setup ----------

let richMenuDone = false;
let richMenuRunning = false;
let richMenuRetryAt = 0;

async function setupRichMenu() {
  let png;
  try {
    png = fs.readFileSync(RICH_MENU_IMAGE);
  } catch (e) {
    console.error('rich menu image missing; skipping rich menu setup');
    return;
  }
  const definition = buildRichMenuDefinition();
  const name = richMenuName(definition, png);

  const list = await lineJson('https://api.line.me/v2/bot/richmenu/list', {}, 'richmenu list');
  const menus = list.richmenus || [];
  let id = (menus.find((m) => m.name === name) || {}).richMenuId;

  if (id) {
    const def = await lineFetch('https://api.line.me/v2/bot/user/all/richmenu');
    if (def.ok) {
      const d = await def.json();
      if (d.richMenuId === id) {
        await deleteOldMenus(menus, id);
        return;
      }
    }
  } else {
    const created = await lineJson(
      'https://api.line.me/v2/bot/richmenu',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...definition, name }),
      },
      'richmenu create'
    );
    id = created.richMenuId;
    const up = await lineFetch(`https://api-data.line.me/v2/bot/richmenu/${id}/content`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: png,
    });
    if (!up.ok) {
      await lineFetch(`https://api.line.me/v2/bot/richmenu/${id}`, { method: 'DELETE' }).catch(() => {});
      throw new Error('richmenu upload failed: ' + up.status);
    }
  }

  const set = await lineFetch(`https://api.line.me/v2/bot/user/all/richmenu/${id}`, { method: 'POST' });
  if (!set.ok) throw new Error('richmenu default failed: ' + set.status);
  await deleteOldMenus(menus, id);
}

async function deleteOldMenus(menus, keepId) {
  for (const m of menus) {
    if (m.richMenuId === keepId || !String(m.name || '').startsWith(MENU_PREFIX)) continue;
    try {
      await lineFetch(`https://api.line.me/v2/bot/richmenu/${m.richMenuId}`, { method: 'DELETE' });
    } catch (e) {
      console.error('richmenu delete failed');
    }
  }
}

// Runs at most once per process (retries after a cooldown on failure); bounded to 3s.
async function ensureRichMenu() {
  if (richMenuDone || richMenuRunning || Date.now() < richMenuRetryAt) return;
  richMenuRunning = true;
  let timer;
  try {
    await Promise.race([
      setupRichMenu(),
      new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error('timeout')), 3000);
      }),
    ]);
    richMenuDone = true;
  } catch (e) {
    richMenuRetryAt = Date.now() + 60000;
    console.error('ensureRichMenu failed:', e && e.message ? e.message : 'error');
  } finally {
    clearTimeout(timer);
    richMenuRunning = false;
  }
}

// ---------- webhook ----------

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('too large'), { code: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function validSignature(raw, signature) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest();
  const given = Buffer.from(String(signature), 'base64');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const GREETING =
  'フォローありがとうございます！\n下のメニューから「新しいアイデア」「プロジェクト」「ホーム」「マイページ」を開けます。気軽にご利用ください。';
const HELP =
  'メッセージありがとうございます。ごめんなさい、内容を理解できませんでした。\n画面下のメニューから「新しいアイデア」「プロジェクト」「ホーム」「マイページ」をお選びください。';

async function handleEvent(event) {
  if (!event || !event.replyToken) return;
  if (event.type === 'follow') {
    await replyMessages(event.replyToken, [{ type: 'text', text: GREETING }]);
  } else if (event.type === 'message') {
    await replyMessages(event.replyToken, [{ type: 'text', text: HELP }]);
  }
}

async function handleWebhook(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
  // fire and forget: never delays or fails the webhook
  ensureRichMenu().catch(() => {});

  let raw;
  try {
    raw = await readBody(req);
  } catch (e) {
    return send(res, e.code === 413 ? 413 : 400, { error: 'bad request' });
  }
  if (!validSignature(raw, req.headers['x-line-signature'])) {
    return send(res, 401, { error: 'invalid signature' });
  }
  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch (e) {
    return send(res, 400, { error: 'invalid json' });
  }
  const events = Array.isArray(payload.events) ? payload.events : [];
  send(res, 200, {});
  for (const event of events) {
    try {
      await handleEvent(event);
    } catch (e) {
      console.error('event failed:', e && e.message ? e.message : 'error');
    }
  }
}

// ---------- static files ----------

function serveStatic(req, res, pathname) {
  if (!fs.existsSync(PUBLIC_DIR)) return send(res, 404, 'Not Found', 'text/plain; charset=utf-8');
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch (e) {
    return send(res, 400, 'Bad Request', 'text/plain; charset=utf-8');
  }
  if (rel.includes('\0') || rel.split(/[\\/]/).includes('..')) {
    return send(res, 404, 'Not Found', 'text/plain; charset=utf-8');
  }
  const base = rel === '/' ? '/index.html' : rel;
  const candidates = [base, base + '.html', path.posix.join(base, 'index.html')];
  for (const c of candidates) {
    const full = path.resolve(PUBLIC_DIR, '.' + c);
    if (full !== PUBLIC_DIR && !full.startsWith(PUBLIC_DIR + path.sep)) continue;
    try {
      if (!fs.statSync(full).isFile()) continue;
      const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(full).pipe(res);
    } catch (e) {
      // try next candidate
    }
  }
  send(res, 404, 'Not Found', 'text/plain; charset=utf-8');
}

async function handler(req, res) {
  try {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    if (pathname === '/api/line/webhook') return await handleWebhook(req, res);
    if (pathname === '/api/config' && req.method === 'GET') {
      return send(res, 200, { liffId: process.env.LINE_LIFF_ID });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, { error: 'method not allowed' });
    }
    return serveStatic(req, res, pathname);
  } catch (e) {
    console.error('handler error');
    if (!res.headersSent) send(res, 500, { error: 'internal error' });
  }
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  http.createServer(handler).listen(port, () => console.log('listening on ' + port));
}

module.exports = { handler, buildRichMenuDefinition, richMenuName, ensureRichMenu, MENU_BUTTONS };
