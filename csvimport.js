// Imports a spreadsheet (CSV) of guns — from another gun-inventory app, a spreadsheet you made,
// or this app's own CSV export. Columns are matched by name, so order doesn't matter.
const CsvImport = (() => {
  // Proper CSV parsing: quoted fields, "" escapes, commas and line breaks inside quotes.
  function parse(text) {
    text = text.replace(/^﻿/, '');
    const rows = []; let row = []; let field = ''; let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some(v => v.trim())) rows.push(row);
        row = [];
      } else field += c;
    }
    row.push(field);
    if (row.some(v => v.trim())) rows.push(row);
    return rows;
  }

  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  // Spreadsheet column name -> app field
  const COLUMNS = {
    make: ['manufacturer', 'make', 'brand', 'mfg'],
    model: ['model'],
    nickname: ['name', 'nickname'],
    caliber: ['caliber', 'calibre', 'gauge', 'cartridge'],
    type: ['firearmtype', 'type', 'category'],
    action: ['action'],
    capacity: ['capacity'],
    barrel: ['barrel', 'barrellength'],
    finish: ['finish', 'color', 'colour'],
    serial: ['serial', 'serialnumber', 'serialno', 'sn'],
    value: ['value', 'estimatedvalue', 'currentvalue'],
    price: ['price', 'pricepaid', 'cost', 'purchaseprice'],
    acquired: ['datepurchased', 'purchasedate', 'acquired', 'dateacquired'],
    source: ['seller', 'purchasedfrom', 'source', 'from'],
    location: ['location', 'storagelocation'],
    accessories: ['accessories', 'otheraccessories', 'modifications', 'optics', 'parts'],
    notes: ['notes', 'note', 'comments', 'description'],
    owner: ['owner'], ownerName: ['ownername'], ownerPhone: ['ownerphone'], storedSince: ['storedsince'],
  };
  // Columns kept as labelled lines in Notes when they have something in them.
  const EXTRA = { factorymagazines: 'Factory magazines', magazines: 'Magazines', condition: 'Condition', itemnumber: 'Item #', item: 'Item #', tags: 'Tags' };

  function date(s) {
    s = s.trim(); if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!m) return '';
    let y = +m[3]; if (y < 100) y += y <= 50 ? 2000 : 1900;
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }

  function type(t, action) {
    const s = `${t}`.toLowerCase(), a = `${action}`.toLowerCase();
    if (/revolver/.test(a) || /revolver/.test(s)) return 'Revolver';
    if (/pistol|handgun|derringer/.test(s)) return 'Pistol';
    if (/\//.test(s)) return 'Other';
    if (/shotgun/.test(s)) return 'Shotgun';
    if (/rifle/.test(s)) return 'Rifle';
    return s ? 'Other' : '';
  }

  function toGuns(text) {
    const rows = parse(text);
    if (rows.length < 2) throw new Error('That spreadsheet looks empty');
    const head = rows[0].map(norm);
    const col = {};
    for (const [field, names] of Object.entries(COLUMNS)) {
      head.forEach((h, i) => { if (names.includes(h)) (col[field] ||= []).push(i); });
    }
    if (!col.make && !col.model && !col.serial) throw new Error("Couldn't find Make / Model / Serial columns in that file");

    return rows.slice(1).map(r => {
      const get = f => (col[f] || []).map(i => (r[i] || '').trim()).filter(Boolean).join('; ');
      const extras = head.map((h, i) => EXTRA[h] && (r[i] || '').trim() ? `${EXTRA[h]}: ${r[i].trim()}` : '').filter(Boolean);
      let serial = get('serial').toUpperCase();
      if (/^0+$/.test(serial)) serial = '';          // placeholder serials like 0000000
      const money = s => s.replace(/[$,\s]/g, '');
      const stored = /stored|other|someone/i.test(get('owner')) || !!get('ownerName');
      const now = new Date().toISOString();
      return {
        id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2),
        created: now, updated: now,
        make: get('make'), model: get('model').replace(/\s+/g, ' '), nickname: get('nickname'),
        caliber: get('caliber'), type: type(get('type'), get('action')), action: get('action'),
        capacity: get('capacity'), barrel: get('barrel'), finish: get('finish'),
        serial, value: money(get('value')), price: money(get('price')), acquired: date(get('acquired')),
        source: get('source'), location: get('location'), accessories: get('accessories'),
        notes: [get('notes'), ...extras].filter(Boolean).join('\n'),
        owner: stored ? 'stored' : 'mine', ownerName: get('ownerName'), ownerPhone: get('ownerPhone'), storedSince: date(get('storedSince')),
        photoGun: '', photoSerial: '',
      };
    }).filter(g => g.make || g.model || g.serial);
  }

  return { parse, toGuns };
})();
