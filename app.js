(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let guns = [];
  let filter = 'all';
  let editing = null;      // gun being edited (or null for new)
  let photos = { gun: '', serial: '' };
  let ownerMode = 'mine';
  let viewing = null;

  // ---------- settings ----------
  const SETTINGS_KEY = 'bbgc-settings';
  const settings = (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; } })();
  const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {} };

  // ---------- helpers ----------
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // Shrink photos so the catalog stays light.
  function compress(file, max = 1600) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const fmtDate = d => d ? new Date(d + 'T00:00').toLocaleDateString() : '';

  // ---------- render catalog ----------
  function render() {
    const q = $('#search').value.trim().toLowerCase();
    const list = guns
      .filter(g => filter === 'all' || (filter === 'mine' ? g.owner !== 'stored' : g.owner === 'stored'))
      .filter(g => !q || [g.make, g.model, g.nickname, g.serial, g.caliber, g.type, g.action, g.finish, g.location, g.source, g.accessories, g.ownerName, g.notes].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (a.make || '').localeCompare(b.make || '') || (a.model || '').localeCompare(b.model || ''));

    const mine = guns.filter(g => g.owner !== 'stored').length;
    const stored = guns.length - mine;
    $('#count-line').textContent = guns.length
      ? `${guns.length} firearm${guns.length === 1 ? '' : 's'} · ${mine} mine${stored ? ` · ${stored} stored for others` : ''}${totalValue() ? ` · est. $${totalValue().toLocaleString()}` : ''}`
      : 'Collection catalog';

    $('#empty').classList.toggle('hidden', guns.length > 0);
    $('#grid').innerHTML = list.map(g => `
      <button class="card" data-id="${g.id}">
        <div class="thumb" style="${g.photoGun ? `background-image:url(${g.photoGun})` : ''}">${g.photoGun ? '' : '⌖'}</div>
        <div class="meta">
          <span class="make">${esc(g.make || 'Unknown make')}</span>
          <span class="model">${esc(g.model || '—')}${g.caliber ? ` <small style="color:var(--muted);font-weight:400">· ${esc(g.caliber)}</small>` : ''}</span>
          ${g.nickname ? `<span class="nick">“${esc(g.nickname)}”</span>` : ''}
          <span class="serial">S/N ${esc(g.serial || '—')}</span>
          ${g.owner === 'stored'
            ? `<span class="badge stored">Belongs to ${esc(g.ownerName || 'someone else')}</span>`
            : `<span class="badge">Mine</span>`}
        </div>
      </button>`).join('');
    if (guns.length && !list.length) $('#grid').innerHTML = `<p class="note">No matches.</p>`;
  }

  function totalValue() {
    return guns.filter(g => g.owner !== 'stored').reduce((t, g) => t + (parseFloat(String(g.value || '').replace(/[$,]/g, '')) || 0), 0);
  }

  async function load() {
    guns = await DB.all();
    render();
    renderBackupStatus();
  }

  // ---------- add / edit ----------
  const form = $('#form-edit');

  function setPhoto(kind, dataUrl) {
    photos[kind] = dataUrl;
    const slot = $(`#slot-${kind}`);
    const img = slot.querySelector('img');
    img.src = dataUrl || '';
    img.classList.toggle('hidden', !dataUrl);
    slot.classList.toggle('has', !!dataUrl);
    $('#btn-scan').disabled = !(photos.gun || photos.serial);
  }

  function setOwner(mode) {
    ownerMode = mode;
    $$('#owner-seg button').forEach(b => b.classList.toggle('on', b.dataset.o === mode));
    $('#owner-fields').classList.toggle('hidden', mode !== 'stored');
  }

  function openEditor(gun = null) {
    editing = gun;
    form.reset();
    $$('#form-edit input').forEach(i => i.classList.remove('filled'));
    $('#edit-title').textContent = gun ? 'Edit gun' : 'Add gun';
    $('#btn-delete').classList.toggle('hidden', !gun);
    $('#scan-note').textContent = ''; $('#scan-note').className = 'note';
    setPhoto('gun', gun?.photoGun || '');
    setPhoto('serial', gun?.photoSerial || '');
    setOwner(gun?.owner || 'mine');
    if (gun) {
      for (const el of form.elements) if (el.name && gun[el.name] != null) el.value = gun[el.name];
      if (['nickname','action','capacity','barrel','finish','acquired','price','value','location','source','accessories','notes'].some(k => gun[k])) form.querySelector('details').open = true;
    }
    $('#dlg-edit').showModal();
  }

  $('#btn-add').onclick = () => openEditor();
  $('#owner-seg').onclick = e => { const b = e.target.closest('button'); if (b) setOwner(b.dataset.o); };

  for (const kind of ['gun', 'serial']) {
    $(`#in-${kind}`).onchange = async e => {
      const f = e.target.files[0];
      if (!f) return;
      try { setPhoto(kind, await compress(f)); }
      catch { toast("Couldn't open that photo"); }
      e.target.value = '';
      // Auto-run recognition once the serial photo is in.
      if (kind === 'serial' && !editing) runScan();
    };
  }

  async function runScan() {
    const btn = $('#btn-scan'), note = $('#scan-note');
    if (btn.classList.contains('busy')) return;
    btn.classList.add('busy'); btn.disabled = true;
    note.className = 'note'; note.textContent = 'Starting…';
    try {
      const r = await Recognize.run(photos, settings, msg => (note.textContent = msg));
      let filledAny = false;
      for (const k of ['make', 'model', 'caliber', 'type', 'serial']) {
        const el = form.elements[k];
        if (r[k] && (!el.value || el.classList.contains('filled'))) {
          el.value = r[k]; el.classList.add('filled'); filledAny = true;
        }
      }
      note.className = filledAny ? 'note ok' : 'note err';
      note.textContent = filledAny
        ? `Filled in (${r.source === 'claude' ? 'Claude' : 'on-device'}, ${r.confidence || 'low'} confidence). ${r.note || ''} Always verify the serial.`
        : `Couldn't read it clearly. ${settings.key ? '' : 'Tip: add an API key in Settings for make/model recognition, or '}try a closer, sharper photo.`;
    } catch (err) {
      note.className = 'note err';
      note.textContent = err.message || 'Recognition failed';
    } finally {
      btn.classList.remove('busy'); btn.disabled = false;
    }
  }
  $('#btn-scan').onclick = runScan;

  form.onsubmit = async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    data.serial = (data.serial || '').toUpperCase().trim();
    if (!data.make && !data.model && !data.serial && !photos.gun) { toast('Add a photo or some details first'); return; }
    if (data.serial) {
      const dup = guns.find(g => g.serial === data.serial && g.id !== editing?.id);
      if (dup && !confirm(`Serial ${data.serial} is already in the catalog (${dup.make} ${dup.model}). Save anyway?`)) return;
    }
    const gun = {
      ...(editing || { id: uid(), created: new Date().toISOString() }),
      ...data,
      owner: ownerMode,
      photoGun: photos.gun,
      photoSerial: photos.serial,
      updated: new Date().toISOString(),
    };
    if (ownerMode === 'mine') { gun.ownerName = ''; gun.ownerPhone = ''; gun.storedSince = ''; }
    await DB.put(gun);
    markChanged('put', gun.id);
    $('#dlg-edit').close();
    await load();
    toast(editing ? 'Saved' : 'Added to catalog');
  };

  $('#btn-delete').onclick = async () => {
    if (!editing || !confirm(`Delete ${editing.make || ''} ${editing.model || ''} from the catalog?`)) return;
    await DB.remove(editing.id);
    markChanged('delete', editing.id);
    $('#dlg-edit').close();
    await load();
    toast('Deleted');
  };

  // ---------- detail view ----------
  function openView(gun) {
    viewing = gun;
    $('#view-title').textContent = [gun.make, gun.model].filter(Boolean).join(' ') || 'Firearm';
    const rows = [
      ['Nickname', gun.nickname], ['Serial', gun.serial, 'mono'], ['Caliber', gun.caliber], ['Type', gun.type],
      ['Action', gun.action], ['Capacity', gun.capacity], ['Barrel', gun.barrel], ['Finish', gun.finish],
      ['Owner', gun.owner === 'stored' ? gun.ownerName || 'Someone else' : 'Mine'],
      ...(gun.owner === 'stored' ? [['Owner phone', gun.ownerPhone], ['Stored since', fmtDate(gun.storedSince)]] : []),
      ['Acquired', fmtDate(gun.acquired)], ['Price paid', gun.price ? `$${String(gun.price).replace(/^\$/, '')}` : ''],
      ['Est. value', gun.value ? `$${String(gun.value).replace(/^\$/, '')}` : ''],
      ['From', gun.source], ['Location', gun.location], ['Optics & accessories', gun.accessories], ['Notes', gun.notes],
    ].filter(r => r[1]);
    $('#view-body').innerHTML = `
      <div class="view-photos">
        ${gun.photoGun ? `<img src="${gun.photoGun}" alt="Gun photo">` : ''}
        ${gun.photoSerial ? `<img src="${gun.photoSerial}" alt="Serial number photo">` : ''}
      </div>
      <dl class="kv">${rows.map(([k, v, c]) => `<dt>${k}</dt><dd class="${c || ''}">${esc(v).replace(/\n/g, '<br>')}</dd>`).join('')}</dl>`;
    $$('#view-body img').forEach(img => img.onclick = () => window.open().document.write(`<img src="${img.src}" style="max-width:100%">`));
    $('#dlg-view').showModal();
  }

  $('#grid').onclick = e => {
    const card = e.target.closest('.card');
    if (card) openView(guns.find(g => g.id === card.dataset.id));
  };
  $('#btn-edit').onclick = () => { $('#dlg-view').close(); openEditor(viewing); };

  // ---------- filters ----------
  $('#search').oninput = render;
  $('#filter').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    filter = b.dataset.f;
    $$('#filter button').forEach(x => x.classList.toggle('on', x === b));
    render();
  };

  // ---------- settings & backup ----------
  $('#btn-settings').onclick = () => {
    $('#set-key').value = settings.key || '';
    $('#set-model').value = settings.model || '';
    renderBackupStatus();
    $('#dlg-settings').showModal();
  };
  $('#btn-save-settings').onclick = () => {
    settings.key = $('#set-key').value.trim();
    settings.model = $('#set-model').value.trim();
    saveSettings();
    toast('Settings saved');
  };

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);

  // ---------- encrypted backup ----------
  const BK = 'bbgc-backup';
  const bkState = () => { try { return JSON.parse(localStorage.getItem(BK)) || {}; } catch { return {}; } };
  const bkSave = st => { try { localStorage.setItem(BK, JSON.stringify(st)); } catch {} };
  const markChanged = (op, id) => {
    const st = bkState(); st.changed = Date.now(); bkSave(st);
    if (op && id) Account.track(op, id);
  };

  // Banner on the main screen only when syncing is stuck.
  function renderBackupStatus() {
    const st = Account.status();
    renderSync(st);
    const bk = bkState();
    $('#bk-status').textContent = bk.last ? `Last backup file: ${new Date(bk.last).toLocaleString()}` : '';
    const problem = st.loggedIn && st.error && st.pending;
    $('#backup-banner').classList.toggle('hidden', !problem);
    $('#backup-banner-text').textContent = `${st.pending} change${st.pending === 1 ? '' : 's'} not synced yet: ${st.error}`;
  }

  $('#btn-backup-now').onclick = () => Account.sync().then(() => toast(Account.status().error || 'Synced'));

  $('#btn-export').onclick = async () => {
    const p1 = $('#bk-pass').value, p2 = $('#bk-pass2').value;
    if (p1.length < 8) { toast('Use a password of at least 8 characters'); return; }
    if (p1 !== p2) { toast("Passwords don't match"); return; }
    if (!guns.length) { toast('Nothing to back up yet'); return; }
    const btn = $('#btn-export'); btn.disabled = true; btn.textContent = 'Encrypting…';
    try {
      const text = await Vault.lock({ app: 'bigbigs-gun-collection', version: 1, guns }, p1);
      const name = `gun-collection-${stamp()}.bbgc`;
      const file = new File([text], name, { type: 'application/octet-stream' });
      // On phones, open the share sheet so it can go straight to Drive / iCloud / Files / email.
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: "Big Big's Gun Collection backup" }); }
        catch (err) { if (err.name === 'AbortError') return; download(name, text, 'application/octet-stream'); }
      } else {
        download(name, text, 'application/octet-stream');
      }
      const st = bkState(); st.last = Date.now(); bkSave(st);
      $('#bk-pass').value = ''; $('#bk-pass2').value = '';
      renderBackupStatus();
      toast('Encrypted backup saved');
    } catch (err) {
      toast(err.message || 'Backup failed');
    } finally {
      btn.disabled = false; btn.textContent = 'Save encrypted backup';
    }
  };
  $('#btn-csv').onclick = () => {
    const cols = ['make', 'model', 'nickname', 'serial', 'caliber', 'type', 'action', 'capacity', 'barrel', 'finish', 'owner', 'ownerName', 'ownerPhone', 'storedSince', 'acquired', 'price', 'value', 'source', 'location', 'accessories', 'notes'];
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.join(','), ...guns.map(g => cols.map(c => q(c === 'owner' ? (g.owner === 'stored' ? 'Stored for owner' : 'Mine') : g[c])).join(','))].join('\n');
    download(`gun-collection-${stamp()}.csv`, csv, 'text/csv');
  };
  $('#in-csv').onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    const msg = $('#csv-msg'); msg.className = 'note';
    try {
      const incoming = CsvImport.toGuns(await f.text());
      // Same serial = same gun; guns without a serial are matched on their description.
      const keyOf = g => g.serial ? `s:${g.serial}` : `d:${[g.make, g.model, g.caliber, g.finish, g.nickname].join('|').toLowerCase().replace(/\s+/g, ' ').trim()}`;
      const have = new Set(guns.map(keyOf));
      const fresh = incoming.filter(g => !have.has(keyOf(g)));
      const skipped = incoming.length - fresh.length;
      if (!fresh.length) { msg.textContent = `All ${incoming.length} guns in that file are already in your catalog.`; return; }
      if (!confirm(`Add ${fresh.length} gun${fresh.length === 1 ? '' : 's'} to your catalog?${skipped ? `\n\n${skipped} already in the catalog will be skipped.` : ''}`)) return;
      for (const g of fresh) { await DB.put(g); Account.track('put', g.id); }
      markChanged();
      await load();
      msg.className = 'note ok';
      msg.textContent = `Added ${fresh.length} gun${fresh.length === 1 ? '' : 's'}${skipped ? ` (skipped ${skipped} already here)` : ''}.${Account.status().loggedIn ? ' Saving them to your account now — keep the app open for a minute.' : ''}`;
      toast(`Imported ${fresh.length} guns`);
    } catch (err) {
      msg.className = 'note err';
      msg.textContent = err.message || "Couldn't read that spreadsheet";
    }
  };

  $('#in-import').onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      let text = await f.text(), data;
      if (Vault.isLocked(text)) {
        const pass = prompt('Enter the password for this backup');
        if (!pass) return;
        data = await Vault.unlock(text, pass);
      } else {
        data = JSON.parse(text);
      }
      const list = Array.isArray(data) ? data : data.guns;
      if (!Array.isArray(list)) throw new Error("That doesn't look like a backup file");
      for (const g of list) if (g && g.id) { await DB.put(g); Account.track('put', g.id); }
      const st = bkState(); st.last = Date.now(); st.changed = 0; bkSave(st);
      await load();
      toast(`Restored ${list.length} firearm${list.length === 1 ? '' : 's'}`);
    } catch (err) { toast(err.message && !/JSON/.test(err.message) ? err.message : "That doesn't look like a backup file"); }
  };


  // ---------- account ----------
  function ago(t) {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
    return new Date(t).toLocaleDateString();
  }
  function renderSync(st = Account.status()) {
    $('#sync-dot').className = 'dot' + (st.busy ? ' busy' : st.error ? ' err' : '');
    $('#sync-title').textContent = `Signed in as ${st.username}`;
    $('#sync-detail').textContent = st.busy ? 'Syncing…'
      : st.error ? `${st.error}${st.pending ? ` · ${st.pending} change${st.pending === 1 ? '' : 's'} waiting` : ''}`
      : st.pending ? `${st.pending} change${st.pending === 1 ? '' : 's'} waiting to sync`
      : st.last ? `Everything saved · synced ${ago(st.last)}` : 'Connecting…';
  }

  let signingUp = false;
  function showLogin(msg = '') {
    document.body.classList.add('locked');
    $('#login').classList.remove('hidden');
    $$('dialog[open]').forEach(d => d.close());
    const st = Account.status();
    if (st.username && !$('#li-user').value) $('#li-user').value = st.username;
    $('#li-msg').textContent = msg;
  }
  function hideLogin() {
    document.body.classList.remove('locked');
    $('#login').classList.add('hidden');
    $('#li-pass').value = ''; $('#li-pass2').value = ''; $('#li-msg').textContent = '';
  }
  function setMode(up) {
    signingUp = up;
    $('#li-pass2-wrap').classList.toggle('hidden', !up);
    $('#li-warn').classList.toggle('hidden', !up);
    $('#li-pass').autocomplete = up ? 'new-password' : 'current-password';
    $('#li-go').textContent = up ? 'Create account' : 'Log in';
    $('#li-switch').textContent = up ? 'Already have an account? Log in' : 'New here? Create an account';
    $('#login-sub').textContent = up ? 'Pick a username and password. You’ll use them to open your collection on any device.' : 'Log in to see your collection on any device.';
    $('#li-msg').textContent = '';
  }
  $('#li-switch').onclick = () => setMode(!signingUp);

  $('#form-login').onsubmit = async e => {
    e.preventDefault();
    const u = $('#li-user').value.trim(), p = $('#li-pass').value, msg = $('#li-msg');
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(u)) { msg.textContent = 'Username must be 3–32 letters, numbers, dots, dashes or underscores.'; return; }
    if (signingUp) {
      if (p.length < 10) { msg.textContent = 'Use a password of at least 10 characters — it protects every serial number.'; return; }
      if (p !== $('#li-pass2').value) { msg.textContent = "Passwords don't match."; return; }
    }
    const btn = $('#li-go'), label = btn.textContent;
    btn.disabled = true; btn.textContent = signingUp ? 'Creating account…' : 'Logging in…'; msg.textContent = '';
    try {
      await (signingUp ? Account.signup(u, p) : Account.login(u, p));
      hideLogin();
      await load();
      toast(signingUp ? 'Account created' : `Welcome back, ${Account.status().username}`);
      setMode(false);
    } catch (err) {
      msg.textContent = err.message || 'Something went wrong';
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  };

  $('#btn-sync-now').onclick = () => Account.sync().then(() => { renderSync(); toast(Account.status().error || 'Synced'); });
  $('#btn-logout').onclick = async () => {
    const st = Account.status();
    const warn = st.pending ? `\n\n${st.pending} change${st.pending === 1 ? " hasn't" : "s haven't"} synced yet and will be lost.` : '';
    if (!confirm(`Log out? Your collection stays safe in your account and is removed from this device.${warn}`)) return;
    await Account.logout();
    await load();
    showLogin();
  };
  setInterval(() => Account.status().loggedIn && renderSync(), 30000);

  // ---------- dialogs ----------
  $$('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());
  $$('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));

  // ---------- offline support ----------
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  Account.init({
    getGun: id => DB.get(id),
    putGun: g => DB.put(g),
    removeGun: id => DB.remove(id),
    allGuns: () => DB.all(),
    onChange: () => load(),
    onStatus: () => renderBackupStatus(),
    onAuthLost: () => showLogin('Your session ended — please log in again.'),
  });
  load().then(async () => {
    if (await Account.restore()) { hideLogin(); Account.sync(); }
    else showLogin();
  });
})();
