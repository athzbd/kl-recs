# KL Recs

Static site listing Kuala Lumpur recommendations. No build step, no framework,
no backend. Hosted on GitHub Pages at https://athzbd.github.io/kl-recs/

## Layout

- `data/places.json` — the single source of truth
- `index.html`, `assets/app.js`, `assets/styles.css` — the page
- `scripts/*.mjs` — Node scripts run by GitHub Actions (Node 20+, no deps)
- `.github/workflows/` — deploy on push to main; weekly place check

## Rules that matter

**Never write to a place's `google` block by hand.** It is owned by
`scripts/check-places.mjs`. Conversely, that script must never touch
`name`, `notes`, `rating`, `categories`, `tags`, or `area` — those are the
user's own words and judgements.

**No build step.** Don't introduce npm, bundlers, or a framework without asking.
Editing a file and pushing is the entire deploy process, and that is deliberate.

**Leaflet + OpenStreetMap for map tiles; Google only for data.** The Google API
key lives in GitHub Actions secrets and must never reach the browser.

**Keep `FIELD_MASK` in `check-places.mjs` minimal** — each extra field can move
the request into a more expensive billing tier.

## Adding a place

When the user asks to add somewhere, append to `places` in `data/places.json`:
kebab-case `id`, today's date for `added`/`updated`, `google.placeId` set to
`null`. Then run the resolver if a key is available, otherwise leave it null —
the weekly job will skip it and report it as missing.

Categories and areas must come from the `categories` / `areas` lists already in
the JSON. Add a new one to those lists first if nothing fits.

## Checking work

```bash
node --check assets/app.js
node -e "JSON.parse(require('fs').readFileSync('data/places.json','utf8'))"
python3 -m http.server 8000   # then open http://localhost:8000
```
