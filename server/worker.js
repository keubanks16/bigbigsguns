// Big Big's Gun Collection — account server (Cloudflare Worker).
//
// Zero-knowledge design: the app derives two keys from the user's password on their device.
// One encrypts the catalog (never leaves the device); the other ("authKey") proves the
// password to this server. The server only ever stores a slow hash of authKey and
// encrypted blobs it cannot read.
//
// Routes (all JSON unless noted):
//   POST /api/prelogin   {username}                         -> {salt}
//   POST /api/signup     {username, salt, authKey}          -> {token}
//   POST /api/login      {username, authKey, device}        -> {token}
//   POST /api/logout                                         -> {}
//   GET  /api/guns                                           -> {guns:[{id, updated, size}]}
//   GET  /api/guns/:id                                       -> encrypted text
//   PUT  /api/guns/:id   (encrypted text)                    -> {updated}
//   DELETE /api/guns/:id                                     -> {}

const ALLOWED_ORIGINS = ['https://keubanks16.github.io'];
const SESSION_DAYS = 180;
const MAX_BLOB = 25 * 1024 * 1024;
const AUTH_ITER = 100000; // Workers' PBKDF2 maximum
const enc = new TextEncoder();

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const fromHex = h => new Uint8Array((h.match(/../g) || []).map(b => parseInt(b, 16)));
const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

function cors(req) {
  const origin = req.headers.get('Origin') || '';
  const ok = ALLOWED_ORIGINS.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
  return ok ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  } : { Vary: 'Origin' };
}

const json = (req, data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(req) } });
const fail = (req, status, error) => json(req, { error }, status);

const cleanUser = u => String(u || '').trim().toLowerCase();
const validUser = u => /^[a-z0-9._-]{3,32}$/.test(u);
const validId = id => /^[A-Za-z0-9-]{6,64}$/.test(id);

async function hashAuth(authKeyHex, saltHex) {
  const base = await crypto.subtle.importKey('raw', fromHex(authKeyHex), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: AUTH_ITER }, base, 256));
}

function sameString(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function newSession(env, username, device) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await env.DB.prepare('INSERT INTO sessions (token_hash, username, created, expires, device) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256(token), username, now, now + SESSION_DAYS * 864e5, String(device || '').slice(0, 120)).run();
  return token;
}

async function sessionUser(req, env) {
  const m = (req.headers.get('Authorization') || '').match(/^Bearer ([a-f0-9]{64})$/);
  if (!m) return null;
  const row = await env.DB.prepare('SELECT username, expires FROM sessions WHERE token_hash = ?').bind(await sha256(m[1])).first();
  if (!row || row.expires < Date.now()) return null;
  return row.username;
}

async function body(req) {
  try { return await req.json(); } catch { return {}; }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    if (url.pathname === '/' || url.pathname === '/api/health') return json(req, { ok: true, app: 'bigbigs-gun-collection', version: '2026-10-15.2' });

    try {
      // ---------- accounts ----------
      if (url.pathname === '/api/prelogin' && req.method === 'POST') {
        const username = cleanUser((await body(req)).username);
        if (!validUser(username)) return fail(req, 400, 'Username must be 3–32 letters, numbers, dots, dashes or underscores');
        const row = await env.DB.prepare('SELECT salt FROM users WHERE username = ?').bind(username).first();
        // Unknown users get a stable fake salt so the response doesn't reveal which usernames exist.
        return json(req, { salt: row ? row.salt : (await sha256(`bbgc-nouser:${username}`)).slice(0, 32) });
      }

      if (url.pathname === '/api/signup' && req.method === 'POST') {
        const b = await body(req);
        const username = cleanUser(b.username);
        if (!validUser(username)) return fail(req, 400, 'Username must be 3–32 letters, numbers, dots, dashes or underscores');
        if (!/^[a-f0-9]{32}$/.test(b.salt || '') || !/^[a-f0-9]{64}$/.test(b.authKey || '')) return fail(req, 400, 'Bad request');
        const max = parseInt(env.MAX_USERS || '5', 10);
        const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
        if (n >= max) return fail(req, 403, 'New accounts are closed on this server');
        if (await env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first()) return fail(req, 409, 'That username is taken');
        const authSalt = hex(crypto.getRandomValues(new Uint8Array(16)));
        await env.DB.prepare('INSERT INTO users (username, salt, auth_hash, auth_salt, created) VALUES (?, ?, ?, ?, ?)')
          .bind(username, b.salt, await hashAuth(b.authKey, authSalt), authSalt, Date.now()).run();
        return json(req, { token: await newSession(env, username, b.device), username });
      }

      if (url.pathname === '/api/login' && req.method === 'POST') {
        const b = await body(req);
        const username = cleanUser(b.username);
        const row = validUser(username) && await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
        if (row && row.locked_until > Date.now()) {
          const mins = Math.ceil((row.locked_until - Date.now()) / 60000);
          return fail(req, 429, `Too many wrong passwords. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
        }
        const ok = row && /^[a-f0-9]{64}$/.test(b.authKey || '') && sameString(await hashAuth(b.authKey, row.auth_salt), row.auth_hash);
        if (!ok) {
          if (row) {
            const failed = row.failed + 1;
            await env.DB.prepare('UPDATE users SET failed = ?, locked_until = ? WHERE username = ?')
              .bind(failed >= 8 ? 0 : failed, failed >= 8 ? Date.now() + 15 * 60000 : 0, username).run();
          }
          return fail(req, 401, 'Wrong username or password');
        }
        await env.DB.prepare('UPDATE users SET failed = 0, locked_until = 0 WHERE username = ?').bind(username).run();
        return json(req, { token: await newSession(env, username, b.device), username });
      }

      if (url.pathname === '/api/logout' && req.method === 'POST') {
        const m = (req.headers.get('Authorization') || '').match(/^Bearer ([a-f0-9]{64})$/);
        if (m) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(m[1])).run();
        return json(req, {});
      }

      // ---------- catalog ----------
      if (url.pathname === '/api/guns' || url.pathname.startsWith('/api/guns/')) {
        const username = await sessionUser(req, env);
        if (!username) return fail(req, 401, 'Please log in again');

        if (url.pathname === '/api/guns' && req.method === 'GET') {
          const { results } = await env.DB.prepare('SELECT id, updated, size FROM guns WHERE username = ?').bind(username).all();
          return json(req, { guns: results });
        }

        const id = decodeURIComponent(url.pathname.slice('/api/guns/'.length));
        if (!validId(id)) return fail(req, 400, 'Bad id');
        const key = `u/${username}/${id}`;

        if (req.method === 'GET') {
          const obj = await env.VAULT.get(key);
          if (!obj) return fail(req, 404, 'Not found');
          return new Response(obj.body, { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', ...cors(req) } });
        }
        if (req.method === 'PUT') {
          const text = await req.text();
          if (!text || text.length > MAX_BLOB) return fail(req, 413, 'Too large');
          let box; try { box = JSON.parse(text); } catch {}
          if (!box || !box.iv || !box.data) return fail(req, 400, 'Expected an encrypted record');
          await env.VAULT.put(key, text);
          const updated = Date.now();
          await env.DB.prepare('INSERT INTO guns (username, id, updated, size) VALUES (?, ?, ?, ?) ON CONFLICT(username, id) DO UPDATE SET updated = excluded.updated, size = excluded.size')
            .bind(username, id, updated, text.length).run();
          return json(req, { updated });
        }
        if (req.method === 'DELETE') {
          await env.VAULT.delete(key);
          await env.DB.prepare('DELETE FROM guns WHERE username = ? AND id = ?').bind(username, id).run();
          return json(req, {});
        }
      }

      return fail(req, 404, 'Not found');
    } catch (err) {
      console.error(err);
      return fail(req, 500, 'Server error — please try again');
    }
  },
};
