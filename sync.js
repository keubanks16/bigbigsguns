// Automatic encrypted cloud backup to a PRIVATE GitHub repo.
//
// Every add / edit / delete is encrypted on this phone and uploaded a couple of seconds later.
// Remote layout (nothing readable without the backup password):
//   vault.json          salt + an encrypted check value used to verify the password
//   guns/<random-id>    one encrypted file per gun
// Changes made offline wait in a queue and upload when the connection returns.
const Sync = (() => {
  const CFG = 'bbgc-sync';
  const QUEUE = 'bbgc-sync-queue';
  const API = 'https://api.github.com';
  let key = null;
  let getGun = async () => null;
  let onStatus = () => {};
  let timer = null;
  let flushing = false;

  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const cfg = () => read(CFG, {});
  const setCfg = patch => { write(CFG, { ...cfg(), ...patch }); emit(); };
  const queue = () => read(QUEUE, {});
  const emit = () => onStatus(status());

  function status() {
    const c = cfg();
    return { enabled: !!c.enabled, repo: c.repo, last: c.last || 0, error: c.error || '', pending: Object.keys(queue()).length, busy: flushing };
  }

  // ---------- device key storage (non-extractable CryptoKey in IndexedDB) ----------
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
  const saveKey = k => keyOp('readwrite', s => s.put(k, 'vault'));
  const loadKey = () => keyOp('readonly', s => s.get('vault'));
  const dropKey = () => keyOp('readwrite', s => s.delete('vault'));

  // ---------- GitHub API ----------
  async function gh(path, { method = 'GET', body, raw = false, token, allow404 = false } = {}) {
    const c = cfg();
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token || c.token}`,
        Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    if (res.status === 404 && allow404) return null;
    if (!res.ok) {
      let msg = `GitHub error ${res.status}`;
      try { msg = (await res.json()).message || msg; } catch {}
      if (res.status === 401) msg = 'GitHub token is invalid or expired';
      if (res.status === 403 || res.status === 404) msg = `GitHub denied access (${msg}). Check the token has Contents read & write on this repo.`;
      const err = new Error(msg); err.status = res.status; throw err;
    }
    return raw ? res.text() : res.status === 204 ? null : res.json();
  }
  const repoPath = (repo = cfg().repo) => `/repos/${repo}`;
  const b64 = s => Vault.toB64(new TextEncoder().encode(s));

  async function listRemote(repo, token) {
    const items = await gh(`${repoPath(repo)}/contents/guns`, { token, allow404: true });
    const map = {};
    for (const it of items || []) if (it.type === 'file') map[it.name] = it.sha;
    return map;
  }

  // ---------- setup ----------
  // Turns on auto-backup. If the repo already holds a backup (e.g. new phone), the same password
  // unlocks it and everything is restored into this phone.
  async function enable({ token, repo, password, saveGun, localGuns }) {
    repo = repo.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Repo should look like yourname/repo-name');
    const info = await gh(`/repos/${repo}`, { token });
    if (!info.private) throw new Error('That repo is public. Use a PRIVATE repo for backups.');

    const vaultText = await gh(`/repos/${repo}/contents/vault.json`, { token, raw: true, allow404: true });
    let made, restored = 0;
    const remoteIds = new Set();

    if (vaultText) {
      const vault = JSON.parse(vaultText);
      made = await Vault.makeKey(password, vault.salt);
      await Vault.open(made.key, vault.check); // throws on wrong password
      const remote = await listRemote(repo, token);
      const localById = Object.fromEntries(localGuns.map(g => [g.id, g]));
      for (const name of Object.keys(remote)) {
        const text = await gh(`/repos/${repo}/contents/guns/${name}`, { token, raw: true });
        const gun = await Vault.open(made.key, text);
        remoteIds.add(gun.id);
        const local = localById[gun.id];
        if (!local || (gun.updated || '') > (local.updated || '')) { await saveGun(gun); restored++; }
      }
    } else {
      made = await Vault.makeKey(password);
      const check = await Vault.seal(made.key, { ok: true, app: 'bigbigs-gun-collection' });
      await gh(`/repos/${repo}/contents/vault.json`, {
        token, method: 'PUT',
        body: { message: 'Set up encrypted backup vault', content: b64(JSON.stringify({ app: 'bigbigs-gun-collection', v: 1, salt: made.salt, iter: made.iter, check })) },
      });
    }

    key = made.key;
    await saveKey(key);
    write(CFG, { enabled: true, repo, token, last: Date.now(), error: '' });
    // Upload anything on this phone that the vault doesn't have yet.
    const q = queue();
    for (const g of localGuns) if (!remoteIds.has(g.id)) q[g.id] = 'put';
    write(QUEUE, q);
    emit();
    await flush();
    return { restored, existing: !!vaultText };
  }

  async function disable() {
    key = null;
    await dropKey().catch(() => {});
    localStorage.removeItem(CFG);
    localStorage.removeItem(QUEUE);
    emit();
  }

  // ---------- change tracking ----------
  function track(op, id) {
    if (!cfg().enabled) return;
    const q = queue(); q[id] = op; write(QUEUE, q);
    emit();
    clearTimeout(timer);
    timer = setTimeout(flush, 2000);
  }

  async function flush() {
    const c = cfg();
    if (!c.enabled || flushing) return;
    let q = queue();
    if (!Object.keys(q).length) return;
    if (navigator.onLine === false) { setCfg({ error: 'Offline — will back up when you reconnect' }); return; }
    flushing = true; emit();
    try {
      if (!key) key = await loadKey();
      if (!key) throw new Error('Backup key missing — turn auto-backup off and on again');
      const shas = await listRemote(c.repo);
      for (const [id, op] of Object.entries(q)) {
        const path = `${repoPath()}/contents/guns/${id}`;
        if (op === 'delete') {
          if (shas[id]) await gh(path, { method: 'DELETE', body: { message: 'Remove gun', sha: shas[id] } });
        } else {
          const gun = await getGun(id);
          if (gun) {
            const r = await gh(path, {
              method: 'PUT',
              body: { message: 'Update gun', content: b64(await Vault.seal(key, gun)), ...(shas[id] ? { sha: shas[id] } : {}) },
            });
            shas[id] = r.content.sha;
          }
        }
        q = queue();
        if (q[id] === op) { delete q[id]; write(QUEUE, q); }
        emit();
      }
      setCfg({ last: Date.now(), error: '' });
    } catch (err) {
      setCfg({ error: err.message || 'Backup failed' });
      clearTimeout(timer);
      timer = setTimeout(flush, 60000); // try again in a minute
    } finally {
      flushing = false; emit();
      if (Object.keys(queue()).length && !cfg().error) { clearTimeout(timer); timer = setTimeout(flush, 1000); }
    }
  }

  function init(opts) {
    getGun = opts.getGun; onStatus = opts.onStatus || onStatus;
    window.addEventListener('online', () => { setCfg({ error: '' }); flush(); });
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && flush());
    emit();
    flush();
  }

  return { init, enable, disable, track, flush, status };
})();
