# Big Big's Gun Collection

A private, phone-friendly catalog for a firearm collection.

- **Snap two photos** — the gun and its serial number — and the app fills in make, model, caliber and serial.
- **Ownership** — mark each gun as yours, or as stored for someone else with their name and phone.
- **Search & filter** — All / Mine / Stored for others.
- **Backups** — export a full backup (with photos) or a CSV spreadsheet for insurance.
- **Private by design** — everything is stored on your device only (IndexedDB). Nothing is uploaded anywhere, so this repo being public never exposes your collection.

## Auto-fill

| Mode | How | Fills |
|---|---|---|
| Default | On-device text reading (Tesseract.js) | Serial, make (from stamped text), caliber |
| With API key | Claude vision via your Anthropic API key (Settings ⚙) | Make, model, caliber, type, serial |

The API key is saved only in your browser. Always check the serial against the photo before saving.

## Using it

Live at **https://keubanks16.github.io/bigbigsguns/** once GitHub Pages is on
(repo **Settings → Pages → Source: Deploy from a branch → `main` / root**).

On your phone, open the link and choose **Add to Home Screen** to install it like an app.

> Data lives in the browser you use. Export a backup before clearing browser data or switching phones, then use **Import backup** on the new device.
