// Finds a stock photo for a gun that doesn't have one yet, from Wikipedia / Wikimedia Commons
// (free, no key, and the images are licensed for reuse). Only make/model/type are sent —
// never serial numbers or anything personal.
const StockPhoto = (() => {
  const WIKI = 'https://en.wikipedia.org/w/api.php';
  const COMMONS = 'https://commons.wikimedia.org/w/api.php';

  const words = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const STOP = new Set(['co', 'company', 'inc', 'mfg', 'arms', 'firearms', 'firearm', 'repeating', 'america', 'the', 'and', 'of', 'model', 'file', 'jpg', 'jpeg', 'png']);

  function tokens(g) {
    const make = words(g.make).filter(w => !STOP.has(w));
    const model = words(g.model).filter(w => !STOP.has(w));
    return { make, model, makeAll: words(g.make), brand: make[0] || '', all: new Set([...make, ...model, ...words(g.type), 'model', 'rifle', 'shotgun', 'pistol', 'revolver', 'series']) };
  }

  // Does a page/file title plausibly show this gun?
  function matches(title, t, strict) {
    const tw = words(title.replace(/^File:/, '').replace(/\.[a-z]+$/i, ''));
    const joined = tw.join(' ');
    const hasModel = t.model.some(m => m.length >= 2 && (tw.includes(m) || (/\d/.test(m) && joined.includes(m))));
    const hasBrand = t.brand && tw.includes(t.brand);
    if (hasModel && (hasBrand || !strict)) return true;
    // e.g. a "Glock" article for a Glock 19X: the title is just the brand name — but not a
    // company history page, whose picture is usually a logo.
    if (!hasBrand || tw.some(w => /^(company|corporation|inc|arms|manufacturing|industries)$/.test(w))) return false;
    return tw.every(w => t.makeAll.includes(w));
  }

  async function api(base, params) {
    const url = `${base}?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Photo search failed (${res.status})`);
    return res.json();
  }

  async function fromWikipedia(g, t) {
    const q = [g.make, g.model, /shotgun|rifle|pistol|revolver/i.test(g.type) ? g.type : 'firearm'].filter(Boolean).join(' ');
    const d = await api(WIKI, { action: 'query', generator: 'search', gsrsearch: q, gsrlimit: '6', gsrnamespace: '0', prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '800' });
    return Object.values(d.query?.pages || {})
      .sort((a, b) => a.index - b.index)
      .filter(p => p.thumbnail && matches(p.title, t, false) && !/\.svg/i.test(p.thumbnail.source))
      .map(p => ({ url: p.thumbnail.source, source: 'Wikipedia', page: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`, title: p.title }));
  }

  async function fromCommons(g, t) {
    const q = `${[g.make, g.model].filter(Boolean).join(' ')} filetype:bitmap`;
    const d = await api(COMMONS, { action: 'query', generator: 'search', gsrsearch: q, gsrlimit: '10', gsrnamespace: '6', prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: '800' });
    return Object.values(d.query?.pages || {})
      .sort((a, b) => a.index - b.index)
      .filter(p => p.imageinfo?.[0] && /image\/(jpeg|png|webp)/.test(p.imageinfo[0].mime) && matches(p.title, t, true))
      .map(p => ({ url: p.imageinfo[0].thumburl || p.imageinfo[0].url, source: 'Wikimedia Commons', page: p.imageinfo[0].descriptionurl, title: p.title.replace(/^File:/, '') }));
  }

  // All plausible photos, best first.
  async function candidates(g) {
    if (!g.make && !g.model) return [];
    const t = tokens(g);
    const [a, b] = await Promise.all([fromWikipedia(g, t).catch(() => []), fromCommons(g, t).catch(() => [])]);
    const seen = new Set();
    return [...a, ...b].filter(c => !seen.has(c.url) && seen.add(c.url));
  }

  return { candidates };
})();
