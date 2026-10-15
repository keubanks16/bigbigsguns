# Big Big's Guns

A private, phone-friendly catalog for a firearm collection.

- **Snap two photos** — the gun and its serial number — and the app fills in make, model, caliber and serial.
- **Ownership** — mark each gun as yours, or as stored for someone else with their name and phone.
- **Search & filter** — All / Mine / Stored for others.
- **Log in anywhere** — username + password account; your collection syncs to every phone and computer you log in on.
- **Extras** — an encrypted backup file you can keep in Drive/iCloud, and a CSV spreadsheet for insurance.
- **Private by design** — everything is encrypted on your device with your password before it's uploaded. The server only stores scrambled data it can't read.

## Auto-fill

Snap the gun and its serial number and tap **Auto-fill**. Your own server (Cloudflare Workers AI, model Kimi K2.6) reads the photos and fills in make, model, caliber, type and serial. The photos are used for that one request and never stored. If the server can't be reached, the device reads the stamped text itself. Always check the serial against the photo before saving.

## Using it

Live at **https://keubanks16.github.io/bigbigsguns/** once GitHub Pages is on
(repo **Settings → Pages → Source: Deploy from a branch → `main` / root**).

On your phone, open the link and choose **Add to Home Screen** to install it like an app.



## Accounts & sync

Create an account on the login screen, then log in with the same username and password on any device. Adds, edits and deletes sync within seconds; changes made offline sync when you're back online.

**How it's protected:** your password never leaves your device. From it the app derives two keys (PBKDF2-SHA256, 600,000 rounds): one encrypts every gun (AES-256-GCM) before upload, the other proves your password to the server, which only keeps a slow hash of it. The server stores encrypted records it cannot read. 8 wrong passwords lock the account for 15 minutes.

**Your password can't be reset.** Because the data is encrypted with it, a lost password means a lost catalog. Write it down somewhere safe.

## Server (`server/`)

A Cloudflare Worker (`bigbigsguns`) with Workers AI (photo recognition), a D1 database (`bigbigsguns`: users, sessions, gun index) and an R2 bucket (`bigbigsguns-vault`: encrypted records). It deploys automatically from this repo through Cloudflare Workers Builds (root directory `server`).

- `MAX_USERS` in `server/wrangler.jsonc` caps how many accounts can be created (default 5).
- API: `https://bigbigsguns.kollinmeubanks.workers.dev`
