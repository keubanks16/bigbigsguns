// Account login + sync across devices.
//
// Your password never leaves this device. From it we derive (PBKDF2-SHA256, 600k rounds):
//   - an encryption key that locks every gun before upload (kept here, non-extractable)
//   - a separate login key that proves your password to the server
// The server stores only encrypted records it cannot read.
const Account = (() => {
  const API = 'https://bigbigsguns.kollinmeubanks.workers.dev';
  const ITER = 600000;
  const ST = 'bbgc-account';        // {username, token}
  const REMOTE = 'bbgc-remote';     // id -> server "updated" time we last synced
  const QUEUE = 'bbgc-acct-queue';  // id -> 'put' | 'delete'
  const enc = new TextEncoder();

  let key = null;
  let hooks = {};
  let timer = null, syncing = null, lastError = '', lastSync = 0, progress = null;

  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const state = () => read(ST, {});
  const queue = () => read(QUEUE, {});
  const remote = () => read(REMOTE, {});
  const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  const fromHex = h => new Uint8Array((h.match(/../g) || []).map(b => parseInt(b, 16)));
  const cleanUser = u => String(u || '').trim().toLowerCase();
  const emit = () => hooks.onStatus && hooks.onStatus(status());

  function status() {
    return { loggedIn: !!(state().token && key), username: state().username || '', pending: Object.keys(queue()).length, busy: !!syncing, error: lastError, last: lastSync, progress };
  }

  // ---------- key storage ----------
  function keyDb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('bbgc-keys', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('k');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function keyOp(mode, fn) {
    const db = await keyDb();
    return new Promise((res, rej) => {
      const t = db.transaction('k', mode); const req = fn(t.objectStore('k'));
      t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error);
    });
  }

  // ---------- server calls ----------
  async function api(path, { method = 'GET', json, text, auth = true } = {}) {
    let res;
    try {
      res = await fetch(API + path, {
        method,
        headers: {
          ...(auth ? { Authorization: `Bearer ${state().token}` } : {}),
          ...(json ? { 'Content-Type': 'application/json' } : text ? { 'Content-Type': 'text/plain' } : {}),
        },
        body: json ? JSON.stringify(json) : text,
        cache: 'no-store',
      });
    } catch {
      throw Object.assign(new Error("Can't reach the server — check your connection"), { offline: true });
    }
    if (!res.ok) {
      let msg = `Server error ${res.status}`;
      try { msg = (await res.json()).error || msg; } catch {}
      throw Object.assign(new Error(msg), { status: res.status });
    }
    return (res.headers.get('Content-Type') || '').includes('json') ? res.json() : res.text();
  }

  async function derive(username, password, saltHex) {
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(`${username}:${saltHex}`), iterations: ITER }, base, 512));
    const encKey = await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
    return { encKey, authKey: hex(bits.slice(32)) };
  }

  const device = () => (navigator.userAgent.match(/\(([^)]+)\)/) || [])[1] || 'Browser';

  async function finishLogin(username, token, encKey) {
    key = encKey;
    await keyOp('readwrite', s => s.put(encKey, 'account'));
    write(ST, { username, token });
    lastError = '';
    emit();
    sync(); // loads in the background; the app opens right away
  }

  async function signup(username, password) {
    username = cleanUser(username);
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    const { encKey, authKey } = await derive(username, password, salt);
    const r = await api('/api/signup', { method: 'POST', auth: false, json: { username, salt, authKey, device: device() } });
    write(REMOTE, {});
    // Anything already on this device becomes part of the new account.
    const q = queue();
    for (const g of await hooks.allGuns()) q[g.id] = 'put';
    write(QUEUE, q);
    await finishLogin(r.username, r.token, encKey);
  }

  async function login(username, password) {
    username = cleanUser(username);
    const { salt } = await api('/api/prelogin', { method: 'POST', auth: false, json: { username } });
    const { encKey, authKey } = await derive(username, password, salt);
    const r = await api('/api/login', { method: 'POST', auth: false, json: { username, authKey, device: device() } });
    // Switching accounts on this device: start clean so catalogs never mix.
    if (state().username && state().username !== r.username) await wipeLocal();
    await finishLogin(r.username, r.token, encKey);
  }

  async function wipeLocal() {
    for (const g of await hooks.allGuns()) await hooks.removeGun(g.id);
    write(REMOTE, {}); write(QUEUE, {});
  }

  async function logout({ keepData = false } = {}) {
    try { await api('/api/logout', { method: 'POST' }); } catch {}
    key = null;
    await keyOp('readwrite', s => s.delete('account')).catch(() => {});
    localStorage.removeItem(ST);
    if (!keepData) await wipeLocal();
    emit();
    hooks.onChange && hooks.onChange();
  }

  async function restore() {
    if (!state().token) return false;
    key = await keyOp('readonly', s => s.get('account')).catch(() => null);
    emit();
    return !!key;
  }

  // ---------- sync ----------
  function track(op, id) {
    const q = queue(); q[id] = op; write(QUEUE, q);
    emit();
    clearTimeout(timer);
    timer = setTimeout(sync, 1500);
  }

  function sync() {
    if (!state().token || !key) return Promise.resolve();
    if (!syncing) syncing = run().finally(() => { syncing = null; emit(); });
    return syncing;
  }

  // Runs fn over items with a few requests in flight at once (much faster than one by one).
  async function pool(items, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }));
  }

  async function run() {
    emit();
    let changed = false;
    try {
      // 1. Send this device's changes.
      const outgoing = Object.entries(queue());
      progress = outgoing.length > 3 ? { label: 'Saving', done: 0, total: outgoing.length } : null;
      await pool(outgoing, 6, async ([id, op]) => {
        let updated = null;
        if (op === 'delete') {
          await api(`/api/guns/${encodeURIComponent(id)}`, { method: 'DELETE' });
        } else {
          const gun = await hooks.getGun(id);
          if (gun) updated = (await api(`/api/guns/${encodeURIComponent(id)}`, { method: 'PUT', text: await Vault.seal(key, gun) })).updated;
        }
        const rm = remote();
        if (updated) rm[id] = updated; else delete rm[id];
        write(REMOTE, rm);
        const q = queue(); if (q[id] === op) { delete q[id]; write(QUEUE, q); }
        if (progress) progress.done++;
        emit();
      });

      // 2. Bring in changes made on other devices.
      const { guns: list } = await api('/api/guns');
      const onServer = new Set(list.map(r => r.id));
      const known = remote(), pending = queue();
      const incoming = list.filter(r => !pending[r.id] && (!(r.id in known) || r.updated > known[r.id]));
      progress = incoming.length > 3 ? { label: 'Loading your collection', done: 0, total: incoming.length } : null;
      emit();
      let sinceRefresh = 0;
      await pool(incoming, 8, async r => {
        const gun = await Vault.open(key, await api(`/api/guns/${encodeURIComponent(r.id)}`));
        await hooks.putGun(gun);
        const rm = remote(); rm[r.id] = r.updated; write(REMOTE, rm);
        changed = true;
        if (progress) progress.done++;
        emit();
        // Show guns as they arrive instead of waiting for all of them.
        if (++sinceRefresh >= 15 && hooks.onChange) { sinceRefresh = 0; hooks.onChange(); }
      });
      progress = null;

      // Deleted on another device, or never uploaded from this one.
      const rm = remote(), q = queue();
      for (const g of await hooks.allGuns()) {
        if (onServer.has(g.id) || q[g.id]) continue;
        if (g.id in rm) { await hooks.removeGun(g.id); delete rm[g.id]; changed = true; }
        else { q[g.id] = 'put'; }
      }
      write(REMOTE, rm); write(QUEUE, q);
      lastError = ''; lastSync = Date.now();
      if (Object.keys(q).length) { clearTimeout(timer); timer = setTimeout(sync, 500); }
    } catch (err) {
      progress = null;
      if (err.status === 401) {
        write(ST, { username: state().username }); // keep who was here so accounts never mix
        hooks.onAuthLost && hooks.onAuthLost();
      }
      lastError = err.message === 'Wrong password' ? "Couldn't unlock a record — log out and back in" : err.message || 'Sync failed';
      clearTimeout(timer); timer = setTimeout(sync, err.offline ? 30000 : 60000);
    }
    if (changed && hooks.onChange) hooks.onChange();
  }

  function init(h) {
    hooks = h;
    window.addEventListener('online', sync);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && sync());
    setInterval(() => document.visibilityState === 'visible' && sync(), 60000);
  }

  return { init, signup, login, logout, restore, sync, track, status };
})();
