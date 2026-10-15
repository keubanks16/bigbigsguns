# Big Big's Gun Collection

A private, phone-friendly catalog for a firearm collection.

- **Snap two photos** — the gun and its serial number — and the app fills in make, model, caliber and serial.
- **Ownership** — mark each gun as yours, or as stored for someone else with their name and phone.
- **Search & filter** — All / Mine / Stored for others.
- **Automatic encrypted cloud backup** — every change is encrypted on your phone and saved to your own private GitHub repo.
- **Extras** — an encrypted backup file you can keep in Drive/iCloud, and a CSV spreadsheet for insurance.
- **Private by design** — the catalog lives on your device. The only thing that ever leaves it is the encrypted backup, which can't be opened without your backup password. This app repo being public never exposes your collection.

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

## Automatic cloud backup

Every time you add, edit or delete a gun, the app encrypts it on your phone (AES-256, key made from your backup password) and saves it to a **private** GitHub repo you own. Changes made with no signal wait and upload when you reconnect. GitHub only ever sees scrambled data.

### One-time setup (about 5 minutes)

1. **Create a private repo** for the backups: https://github.com/new
   - Name: `bigbigsguns-vault`
   - Visibility: **Private** (the app refuses public repos)
   - Tick **Add a README file**, then **Create repository**.
2. **Create an access token** limited to that one repo: https://github.com/settings/personal-access-tokens/new
   - Token name: `Gun collection backup`
   - Expiration: **No expiration** (fine here: the token only reaches this one private repo, and everything in it is encrypted)
   - Repository access: **Only select repositories** → `bigbigsguns-vault`
   - Permissions → Repository permissions → **Contents: Read and write**
   - **Generate token** and copy it (starts with `github_pat_`).
3. **In the app:** Settings ⚙ → Automatic cloud backup → enter `keubanks16/bigbigsguns-vault`, paste the token, choose a backup password → **Turn on auto-backup**.

**Write the backup password down and keep it somewhere safe** (e.g. with your firearm paperwork or in a password manager). It is never stored or sent anywhere, so it can't be reset — without it the backup can't be opened by anyone, including you.

### New phone / restoring

Install the app, open Settings ⚙ → Automatic cloud backup, and enter the same repo, a token, and the **same backup password**. Your whole catalog, photos included, downloads back onto the phone and auto-backup continues from there.

### If something goes wrong

A banner appears on the main screen if backups stop (e.g. the token expired). Make a new token (step 2) and turn auto-backup off and on again with it.
