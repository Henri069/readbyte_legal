# PageBite website (readbyte_legal)

Static website for the PageBite app: start page, download page, creator links, privacy policy, terms of use, account deletion and imprint, in German (root) and English (`en/`). Published with GitHub Pages.

This folder lives inside the app project (`readbyte/legal/`) but is its own Git repository. The app repository ignores it (`/legal/` in its `.gitignore`).

## Pages

| Page | German | English |
|---|---|---|
| Start | `index.html` | `en/index.html` |
| Privacy policy | `privacy.html` | `en/privacy.html` |
| AI processing section (app "Details" link) | `privacy.html#ki` | `en/privacy.html#ai` |
| Terms of use | `terms.html` | `en/terms.html` |
| Delete account (Google Play "Delete account URL") | `delete-account.html` | `en/delete-account.html` |
| Imprint | `imprint.html` | `en/imprint.html` |
| Download (QR codes, phones go straight to their store) | `download.html` | `en/download.html` |
| Creator link (`c/?code=EMELIE`) | `c/index.html` | `en/c/index.html` |
| Not found, and the short creator link `c/emelie` | `404.html` | same page |

Published address: `https://henri069.github.io/readbyte_legal/` (for example `https://henri069.github.io/readbyte_legal/privacy.html`).

## Download page and creator links

Both use `assets/stores.js`. It holds the Apple app ID (`6812806136`) and the Android package (`com.readbyte.app`).

- **Download page** (`…/download`): iPhones and iPads go straight to the App Store, Android phones straight to Google Play. The page stays hidden; only a short note with a link shows while the store opens. Computers see two QR codes and the two official store badges.
- **Store badges** in `assets/`: Apple's "Download on the App Store" / "Laden im App Store" (SVG, from Apple's marketing tools, `toolbox.marketingtools.apple.com`) and Google's "Get it on Google Play" / "Jetzt bei Google Play" (PNG, from `play.google.com/intl/en_us/badges/`), downloaded 2026-09-18. They stay unchanged; only the transparent margin of Google's PNGs was cut off, so both badges show at the same height. Apple and Google allow the badges, not their bare logos. The trademark notes below the badges are part of the rules.
- **Creator link** (`…/c/emelie` or `…/c/?code=EMELIE`): iPhones go straight to Apple's redeem page with the code filled in (Apple installs the app first if needed). Android shows the code, a copy button, three steps and a Google Play button, because on Android the code is typed into the app. Computers see both. Browsers without German get the English page. Invalid codes go to the download page.
- The short form `c/emelie` works through `404.html`, because GitHub Pages has no routes. The page answers with status 404 but sends the visitor on at once. If a platform refuses a link that answers 404, use the long form `c/?code=EMELIE`.
- Nothing is created per creator. The store setup per creator is in the app repository: `docs/redeem-codes.md`.
- No cookies, no storage, no tracking pixel. The code only ends up in the store links. The Google Play link of a creator carries the campaign `creator-<code>`, so the Play Console counts installs per creator.

The QR codes are SVG files in `assets/`, generated and checked on a Mac with macOS's own QR encoder (no download):

```
swift tools/qr-svg.swift "https://apps.apple.com/app/id6812806136" assets/qr-app-store.svg "#2B2420" "#FBF6EE"
swift tools/qr-svg.swift "https://play.google.com/store/apps/details?id=com.readbyte.app" assets/qr-google-play.svg "#2B2420" "#FBF6EE"
```

The script reads each QR code back and stops if it does not say the same address.

## Preview on this computer

```
node tools/preview-server.mjs
```

Then open `http://localhost:8765/`, for example `http://localhost:8765/download` or `http://localhost:8765/c/emelie`. The preview answers like GitHub Pages (pages without `.html`, `404.html` for unknown addresses), which a plain file server does not; with one, the short creator link shows "not found". Without the path prefix `/readbyte_legal/`, because it serves this folder as the root.

## Tests

```
node --test 'tests/*.test.mjs'
```

They check the platform detection, the redirects, the creator codes, the short links, that both languages exist and that no page loads anything from another server.

## Publish with GitHub Pages

1. Create the public repository `readbyte_legal` on GitHub (empty, no README).
2. In this folder: `git remote add origin https://github.com/Henri069/readbyte_legal.git`, then `git push -u origin main`.
3. On GitHub: Settings → Pages → Build and deployment → Source "Deploy from a branch" → Branch `main`, folder `/ (root)` → Save.
4. After a minute the site is live at the address above.

`.nojekyll` turns off Jekyll, so GitHub serves the files as they are.

## Rules

- No external requests: no Google Fonts, no analytics, no trackers. The fonts are served from `fonts/` (SIL Open Font License).
- Every text exists in German and English with the same structure. The German version is binding.
- Update the date ("Stand" / "Last updated") on every page you change.
- The texts must match what the app really does (readbyte: `docs/readbyte-ai-spec-v3.md` §14, `docs/google-play-data-safety.md`). Change the app or a service, change these pages in the same week.

## Check before publishing

- [ ] Operator name, address and email are correct (taken from the Mr. Viral imprint). Add a VAT ID if you have one.
- [ ] Minimum age 16 (spec §17 point 7, still a proposal).
- [ ] Data processing agreements signed with Supabase, Google Cloud, PostHog and RevenueCat.
- [ ] Vertex AI: request-response logging off, data caching off (spec §14.5). Keep the 90-day abuse monitoring sentence until Google approves the exception.
- [ ] PostHog: "Discard client IP data" on, shortest practical retention.
- [ ] Have a lawyer or a legal text service review privacy policy, terms and imprint.
