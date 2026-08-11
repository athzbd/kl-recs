# KL Recs

Static site listing Kuala Lumpur recommendations for visitors. No build step, no
framework, no backend. Hosted on GitHub Pages at https://athzbd.github.io/kl-recs/

Source of the list: Athena's Notes app export, migrated 2026-08-11. The original
note was dated 2026-08-04, which is what migrated entries carry as `added`.

## Layout

- `data/places.json` — the single source of truth (117 places + archive)
- `index.html`, `assets/app.js`, `assets/styles.css` — the page
- `assets/config.js` — Maps browser key placeholder, substituted on deploy
- `scripts/*.mjs` — Node scripts (Node 20+, no dependencies)
- `.github/workflows/` — deploy on push to main; weekly place check

## Rules that matter

**Never invent the user's opinions.** `notes`, `tags` and `categories` come from
her own list. If something has no note, leave it empty — do not write a
description, a rating, or a recommendation she did not make. There is no
`rating` field for exactly this reason: she never rated anything.

**Never hand-edit a place's `google` block.** It is owned by
`scripts/check-places.mjs` and `scripts/resolve-place-ids.mjs`. Those scripts
must never touch `name`, `notes`, `categories` or `tags`. They may set `area`
only when it is currently null.

**No build step.** Don't introduce npm, bundlers, or a framework without asking.
Editing a file and pushing is the entire deploy process, and that is deliberate.

**Two Google keys, different exposure.** `GOOGLE_MAPS_API_KEY` (server, Places
API) stays in Actions secrets and must never reach the browser.
`GOOGLE_MAPS_BROWSER_KEY` (Maps JavaScript) is public by necessity — it is
injected into `assets/config.js` at deploy time and protected by an HTTP
referrer restriction plus a daily quota cap.

**Keep `FIELD_MASK` in `check-places.mjs` minimal.** Opening hours and Google's
rating were deliberately removed — they raise the billing tier and nothing on
the page uses them. Adding a field costs real money.

## Adding a place

Append to `places` in `data/places.json`: kebab-case `id`, today's date for
`added`/`updated`, `google.placeId` null, `area` null. Categories must come from
the `categories` list already in the JSON; add a new one there first if nothing
fits. Dish-level tags (`nasi-lemak`, `mamak`, `laksa`, `chicken-rice`,
`banana-leaf`, `chili-pan-mee`, `seafood`, `beef-noodle`, `kopitiam`, `durian`,
`omakase`) are free-form — reuse an existing one where it applies.

## Checking work

```bash
node --check assets/app.js
node -e "JSON.parse(require('fs').readFileSync('data/places.json','utf8'))"
node scripts/serve.mjs   # then open http://localhost:8000
```

The map cannot be verified locally — there is no browser key outside deploys.
Verify map changes on the live site after a push.
