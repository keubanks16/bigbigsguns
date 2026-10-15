// Password-encrypted backups (AES-256-GCM, key derived with PBKDF2-SHA256).
// Encryption happens on the device; the password is never stored or sent anywhere.
const Vault = (() => {
  const ITER = 600000;
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function toB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromB64(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  async function deriveKey(password, salt, iter) {
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function lock(obj, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, ITER);
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))));
    return JSON.stringify({
      app: 'bigbigs-gun-collection', format: 'encrypted-backup', version: 1,
      cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iter: ITER,
      salt: toB64(salt), iv: toB64(iv), data: toB64(data),
      created: new Date().toISOString(),
    });
  }

  async function unlock(text, password) {
    const box = JSON.parse(text);
    const key = await deriveKey(password, fromB64(box.salt), box.iter || ITER);
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(box.iv) }, key, fromB64(box.data));
      return JSON.parse(dec.decode(plain));
    } catch {
      throw new Error('Wrong password, or the file is damaged');
    }
  }

  const isLocked = text => { try { return JSON.parse(text).format === 'encrypted-backup'; } catch { return false; } };

  // Key-based helpers for automatic backup: the key is derived once from the password and
  // kept on this device as a non-extractable key (the password itself is never saved).
  async function makeKey(password, saltB64) {
    const salt = saltB64 ? fromB64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
    return { key: await deriveKey(password, salt, ITER), salt: toB64(salt), iter: ITER };
  }
  async function seal(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))));
    return JSON.stringify({ v: 1, iv: toB64(iv), data: toB64(data) });
  }
  async function open(key, text) {
    const box = JSON.parse(text);
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(box.iv) }, key, fromB64(box.data));
      return JSON.parse(dec.decode(plain));
    } catch { throw new Error('Wrong password'); }
  }

  return { lock, unlock, isLocked, makeKey, seal, open, toB64, fromB64 };
})();
