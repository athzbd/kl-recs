# KL Recs

A filterable, map-backed list of Kuala Lumpur recommendations for visitors.
Static site, no backend, hosted on GitHub Pages.

**Live site:** https://athzbd.github.io/kl-recs/

## How it's put together

| Piece | What it does |
|---|---|
| `data/places.json` | The whole list. Everything else reads from this. |
| `index.html` + `assets/` | The page. Plain HTML/CSS/JS, no build step. |
| `assets/config.js` | Holds the browser Maps key, injected at deploy time. |
| `scripts/resolve-place-ids.mjs` | Fills in Place IDs, coordinates and areas. |
| `scripts/check-places.mjs` | Weekly: asks Google if anything closed. |
| `.github/workflows/` | Deploys on push; runs the weekly check. |

## The data model

Each place keeps **your** fields and **Google's** fields in separate blocks:

```json
{
  "id": "village-park-nasi-lemak",
  "name": "Village Park Nasi Lemak",
  "categories": ["local"],
  "area": "Damansara",
  "notes": "",
  "tags": ["must-eat", "nasi-lemak"],
  "google": {
    "placeId": "ChIJ…",
    "lat": 3.1436, "lng": 101.6958,
    "businessStatus": "OPERATIONAL",
    "address": "…",
    "lastChecked": "2026-08-11"
  }
}
```

Automation only ever writes inside `google` (plus `area`, when it is still
null). Your notes, categories and tags are yours — nothing overwrites them.

`tags` carry the dish (`nasi-lemak`, `mamak`, `laksa`…) so searching "laksa"
finds the right places, and `must-eat` drives the ⭐ filter.

## Google API setup

Two separate keys, because they have different exposure:

**1. Server key** — used by the scripts, lives only in GitHub Actions.

1. Create a project at https://console.cloud.google.com/ and enable **Places API (New)**
2. Create an API key, restrict it to the Places API
3. Add it as a repo secret named `GOOGLE_MAPS_API_KEY`

**2. Browser key** — used by the map, necessarily public.

1. Create a second key, restrict it to the **Maps JavaScript API**
2. Under *Application restrictions* choose **HTTP referrers** and add
   `https://athzbd.github.io/*`
3. Set a **daily quota cap** on the Maps JavaScript API (Cloud Console →
   APIs & Services → Quotas). This is the important step: past the cap the map
   stops loading instead of running up a bill.
4. Add it as a repo secret named `GOOGLE_MAPS_BROWSER_KEY`

The page works without either key — you just lose the map and the closure
checks.

**Cost:** Maps JavaScript gives 10,000 free map loads a month, then $7 per
1,000. The map only loads when someone opens the Map tab, so a personal site
sits far inside the free tier. Place Details calls for ~120 places once a week
is roughly 500 calls a month, also inside the free allowance. The field mask in
`check-places.mjs` deliberately omits opening hours and Google's rating, which
would push the request into a pricier tier.

## Filling in the map data

The list ships with no Place IDs. Once the server key exists:

```bash
GOOGLE_MAPS_API_KEY=… node scripts/resolve-place-ids.mjs --dry-run
```

Read the output — Text Search is fuzzy and a few will match the wrong branch or
a same-named place elsewhere. Fix any bad ones by hand, then run it for real
without `--dry-run`.

## Adding a place

Easiest: ask Claude Code — *"add Kedai Kopi X in Bangsar, good for roti"* — and
it writes the entry, commits and pushes.

By hand: add an object to `places` in `data/places.json` with
`google.placeId` set to `null`, then run the resolver.

## Running it locally

```bash
node scripts/serve.mjs
```

Then open http://localhost:8000 — a plain `file://` open won't work, because
the page fetches the JSON. The map shows a setup message locally, since the key
is only injected at deploy time.
