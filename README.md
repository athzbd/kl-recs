# KL Recs

A filterable, map-backed list of Kuala Lumpur recommendations. Static site, no
backend, hosted on GitHub Pages.

**Live site:** https://athzbd.github.io/kl-recs/

## How it's put together

| Piece | What it does |
|---|---|
| `data/places.json` | The whole list. Everything else reads from this. |
| `index.html` + `assets/` | The page. Plain HTML/CSS/JS, no build step. |
| `scripts/check-places.mjs` | Weekly: asks Google if anything closed. |
| `scripts/resolve-place-ids.mjs` | Fills in missing Google Place IDs. |
| `.github/workflows/` | Deploys on push; runs the weekly check. |

## The data model

Each place keeps **your** fields and **Google's** fields in separate blocks:

```json
{
  "id": "merchants-lane",
  "name": "Merchant's Lane",
  "categories": ["coffee", "brunch"],
  "area": "Chinatown",
  "price": 2,
  "rating": 4,
  "notes": "Upstairs shophouse. Go on a weekday.",
  "tags": ["date-spot"],
  "google": {
    "placeId": "ChIJ…",
    "lat": 3.1436, "lng": 101.6958,
    "businessStatus": "OPERATIONAL",
    "hours": [ … ],
    "lastChecked": "2026-08-11"
  }
}
```

Automation only ever writes inside `google`. Your notes and ratings are yours —
nothing overwrites them.

`rating` is your own 0–5. `price` is 0–4 (0 = free, renders as `$`–`$$$$`).

## Adding a place

Easiest: ask Claude Code — *"add Merchant's Lane in Chinatown, great coffee,
4 stars"* — and it writes the entry, resolves the Place ID, commits, pushes.

By hand: add an object to `places` in `data/places.json` with `google.placeId`
set to `null`, then run the resolver:

```bash
GOOGLE_MAPS_API_KEY=… node scripts/resolve-place-ids.mjs
```

## Google API setup

Needed only for the map coordinates and the closure detection — the page itself
works without any key.

1. Create a project at https://console.cloud.google.com/
2. Enable **Places API (New)**
3. Create an API key, restrict it to the Places API
4. Add it as a repo secret named `GOOGLE_MAPS_API_KEY`
   (Settings → Secrets and variables → Actions)

The key lives only in GitHub Actions — it is never shipped to the browser. Map
tiles come from OpenStreetMap, which needs no key.

**Cost:** the weekly check makes one Place Details call per place. A few hundred
places is a few hundred calls a month, which normally lands inside Google's free
monthly allowance. Requesting `rating` and `regularOpeningHours` uses a pricier
SKU — drop them from `FIELD_MASK` in `scripts/check-places.mjs` to cut the cost,
at the price of losing the "open now" filter.

## Running it locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000 — a plain file:// open won't work, because the
page fetches the JSON.
