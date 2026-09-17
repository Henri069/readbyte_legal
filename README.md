# PageBite website (readbyte_legal)

Static website for the PageBite app: start page, privacy policy, terms of use, account deletion and imprint, in German (root) and English (`en/`). Published with GitHub Pages.

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

Published address: `https://henri069.github.io/readbyte_legal/` (for example `https://henri069.github.io/readbyte_legal/privacy.html`).

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
