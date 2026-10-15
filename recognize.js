// Reads make, caliber and serial number off the photos, right on the device (Tesseract.js):
// it reads the stamped text, then picks out the serial and a known manufacturer name.
const Recognize = (() => {
  const MAKERS = [
    'Glock', 'Smith & Wesson', 'Sig Sauer', 'Ruger', 'Springfield Armory', 'Colt', 'Beretta',
    'Heckler & Koch', 'Taurus', 'Kimber', 'Walther', 'CZ', 'FN', 'Browning', 'Remington',
    'Mossberg', 'Winchester', 'Savage', 'Marlin', 'Henry', 'Benelli', 'Daniel Defense',
    'Palmetto State Armory', 'Aero Precision', 'Bushmaster', 'Canik', 'Kel-Tec', 'Hi-Point',
    'Charter Arms', 'Rossi', 'Stoeger', 'Tikka', 'Bergara', 'Christensen Arms', 'Anderson',
    'Radical Firearms', 'IWI', 'Steyr', 'SCCY', 'Diamondback', 'Wilson Combat', 'Les Baer',
    'Dan Wesson', 'Chiappa', 'Uberti', 'Weatherby', 'Howa', 'Franchi', 'Stevens', 'Century Arms',
    'Zastava', 'Kahr', 'Bersa', 'Heritage', 'North American Arms', 'Shadow Systems', 'Staccato',
    'Mauser', 'Norinco', 'Lee-Enfield', 'Mosin',
  ];
  const ALIASES = {
    'S&W': 'Smith & Wesson', 'SMITH': 'Smith & Wesson', 'SIG': 'Sig Sauer', 'SAUER': 'Sig Sauer',
    'H&K': 'Heckler & Koch', 'HK': 'Heckler & Koch', 'SPRINGFIELD': 'Springfield Armory',
    'STURM': 'Ruger', 'PSA': 'Palmetto State Armory', 'KELTEC': 'Kel-Tec', 'FNH': 'FN',
    'CESKA': 'CZ', 'DANIEL': 'Daniel Defense', 'AERO': 'Aero Precision',
  };
  const CALIBERS = [
    [/\b9\s?MM|9X19|LUGER\b/i, '9mm'], [/\.?45\s?ACP|\b45\s?AUTO/i, '.45 ACP'], [/\.?40\s?S&?W/i, '.40 S&W'],
    [/\.?380/i, '.380 ACP'], [/\.?22\s?L\.?R/i, '.22 LR'], [/\.?357/i, '.357 Mag'], [/\.?38\s?SPL|SPECIAL/i, '.38 Special'],
    [/5\.56|\.?223/i, '5.56 / .223'], [/\.?308|7\.62\s?X\s?51/i, '.308 Win'], [/7\.62\s?X\s?39/i, '7.62x39'],
    [/12\s?GA|12\s?GAUGE/i, '12 ga'], [/20\s?GA|20\s?GAUGE/i, '20 ga'], [/\.?44\s?MAG/i, '.44 Mag'],
    [/10\s?MM/i, '10mm'], [/6\.5\s?CREED/i, '6.5 Creedmoor'], [/\.?300\s?(BLK|BLACKOUT|AAC)/i, '.300 BLK'],
  ];

  // ---------- On-device OCR ----------
  let tesseractLoading;
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve();
    if (!tesseractLoading) {
      tesseractLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('Could not load the text reader (are you offline?)'));
        document.head.appendChild(s);
      });
    }
    return tesseractLoading;
  }

  // Boost contrast so stamped metal reads better.
  function prep(dataUrl) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        const scale = Math.min(1, 1800 / Math.max(img.width, img.height));
        c.width = img.width * scale; c.height = img.height * scale;
        const ctx = c.getContext('2d');
        ctx.filter = 'grayscale(1) contrast(1.8)';
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/png'));
      };
      img.src = dataUrl;
    });
  }

  function pickSerial(text) {
    const tokens = (text.toUpperCase().match(/[A-Z0-9-]{4,14}/g) || [])
      .map(t => t.replace(/^-+|-+$/g, ''))
      .filter(t => /\d/.test(t) && t.length >= 4)
      .filter(t => !/^(19|20)\d{2}$/.test(t))          // years
      .filter(t => !/^\d{1,2}MM$|^\d+GA$|^\d{3}$/.test(t)); // calibers
    // Prefer mixed letter+digit tokens, then longest.
    tokens.sort((a, b) => (/[A-Z]/.test(b) - /[A-Z]/.test(a)) || (b.length - a.length));
    return tokens[0] || '';
  }

  function pickMake(text) {
    const up = text.toUpperCase();
    for (const m of MAKERS) if (up.includes(m.toUpperCase())) return m;
    for (const [k, v] of Object.entries(ALIASES)) if (new RegExp(`\\b${k.replace(/[&]/g, '\\&')}\\b`).test(up)) return v;
    return '';
  }

  function pickCaliber(text) {
    for (const [re, name] of CALIBERS) if (re.test(text)) return name;
    return '';
  }

  async function withOCR(images, onProgress) {
    await loadTesseract();
    const read = async (url, label) => {
      if (!url) return '';
      const { data } = await Tesseract.recognize(await prep(url), 'eng', {
        logger: m => m.status === 'recognizing text' && onProgress && onProgress(`Reading ${label}… ${Math.round(m.progress * 100)}%`),
      });
      return data.text || '';
    };
    const serialText = await read(images.serial, 'serial photo');
    const gunText = await read(images.gun, 'gun photo');
    const all = `${gunText}\n${serialText}`;
    return {
      make: pickMake(all),
      model: '',
      caliber: pickCaliber(all),
      type: '',
      serial: pickSerial(serialText) || pickSerial(gunText),
      confidence: 'low',
      note: 'Read on-device. Double-check the serial against the photo.',
      source: 'ocr',
    };
  }

  const run = (images, onProgress) => withOCR(images, onProgress);

  return { run };
})();
