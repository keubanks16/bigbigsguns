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
      .filter(g => !q || [g.make, g.model, g.serial, g.caliber, g.type, g.ownerName, g.notes].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (a.make || '').localeCompare(b.make || '') || (a.model || '').localeCompare(b.model || ''));

    const mine = guns.filter(g => g.owner !== 'stored').length;
    const stored = guns.length - mine;
    $('#count-line').textContent = guns.length
      ? `${guns.length} firearm${guns.length === 1 ? '' : 's'} · ${mine} mine${stored ? ` · ${stored} stored for others` : ''}`
      : 'Collection catalog';

    $('#empty').classList.toggle('hidden', guns.length > 0);
    $('#grid').innerHTML = list.map(g => `
      <button class="card" data-id="${g.id}">
        <div class="thumb" style="${g.photoGun ? `background-image:url(${g.photoGun})` : ''}">${g.photoGun ? '' : '⌖'}</div>
        <div class="meta">
          <span class="make">${esc(g.make || 'Unknown make')}</span>
          <span class="model">${esc(g.model || '—')}${g.caliber ? ` <small style="color:var(--muted);font-weight:400">· ${esc(g.caliber)}</small>` : ''}</span>
          <span class="serial">S/N ${esc(g.serial || '—')}</span>
          ${g.owner === 'stored'
            ? `<span class="badge stored">Belongs to ${esc(g.ownerName || 'someone else')}</span>`
            : `<span class="badge">Mine</span>`}
        </div>
      </button>`).join('');
    if (guns.length && !list.length) $('#grid').innerHTML = `<p class="note">No matches.</p>`;
  }

  async function load() {
    guns = await DB.all();
    render();
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
      if (gun.acquired || gun.price || gun.source || gun.notes) form.querySelector('details').open = true;
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
    $('#dlg-edit').close();
    await load();
    toast(editing ? 'Saved' : 'Added to catalog');
  };

  $('#btn-delete').onclick = async () => {
    if (!editing || !confirm(`Delete ${editing.make || ''} ${editing.model || ''} from the catalog?`)) return;
    await DB.remove(editing.id);
    $('#dlg-edit').close();
    await load();
    toast('Deleted');
  };

  // ---------- detail view ----------
  function openView(gun) {
    viewing = gun;
    $('#view-title').textContent = [gun.make, gun.model].filter(Boolean).join(' ') || 'Firearm';
    const rows = [
      ['Serial', gun.serial, 'mono'], ['Caliber', gun.caliber], ['Type', gun.type],
      ['Owner', gun.owner === 'stored' ? gun.ownerName || 'Someone else' : 'Mine'],
      ...(gun.owner === 'stored' ? [['Owner phone', gun.ownerPhone], ['Stored since', fmtDate(gun.storedSince)]] : []),
      ['Acquired', fmtDate(gun.acquired)], ['Price paid', gun.price ? `$${String(gun.price).replace(/^\$/, '')}` : ''],
      ['From', gun.source], ['Notes', gun.notes],
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

  $('#btn-export').onclick = () => {
    download(`gun-collection-backup-${stamp()}.json`, JSON.stringify({ app: 'bigbigs-gun-collection', version: 1, guns }), 'application/json');
  };
  $('#btn-csv').onclick = () => {
    const cols = ['make', 'model', 'serial', 'caliber', 'type', 'owner', 'ownerName', 'ownerPhone', 'storedSince', 'acquired', 'price', 'source', 'notes'];
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.join(','), ...guns.map(g => cols.map(c => q(c === 'owner' ? (g.owner === 'stored' ? 'Stored for owner' : 'Mine') : g[c])).join(','))].join('\n');
    download(`gun-collection-${stamp()}.csv`, csv, 'text/csv');
  };
  $('#in-import').onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const list = Array.isArray(data) ? data : data.guns;
      if (!Array.isArray(list)) throw new Error();
      for (const g of list) if (g && g.id) await DB.put(g);
      await load();
      toast(`Imported ${list.length} firearm${list.length === 1 ? '' : 's'}`);
    } catch { toast("That doesn't look like a backup file"); }
  };

  // ---------- dialogs ----------
  $$('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());
  $$('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));

  // ---------- offline support ----------
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  load();
})();
