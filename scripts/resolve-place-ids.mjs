#!/usr/bin/env node
/* One-time (and occasional) helper: fill in missing Place IDs.
 *
 * For every place whose google.placeId is null, searches Google by name and
 * stores the top match. Prints what it matched so you can eyeball it — Text
 * Search is fuzzy, and a wrong match here poisons everything downstream.
 *
 * Usage:  GOOGLE_MAPS_API_KEY=xxx node scripts/resolve-place-ids.mjs [--dry-run]
 */

import { readFile, writeFile } from 'node:fs/promises';

const DATA_PATH = new URL('../data/places.json', import.meta.url);
const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const DRY_RUN = process.argv.includes('--dry-run');

if (!API_KEY) {
  console.error('Missing GOOGLE_MAPS_API_KEY.');
  process.exit(1);
}

async function search(query) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.location,places.businessStatus',
    },
    body: JSON.stringify({ textQuery: query, regionCode: 'MY', maxResultCount: 1 }),
  });

  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const { places } = await res.json();
  return places?.[0] ?? null;
}

const data = JSON.parse(await readFile(DATA_PATH, 'utf8'));
const today = new Date().toISOString().slice(0, 10);
let resolved = 0;

for (const place of data.places) {
  if (place.google?.placeId) continue;

  const query = `${place.name}, ${place.area || 'Kuala Lumpur'}, Malaysia`;
  try {
    const match = await search(query);
    if (!match) {
      console.log(`✗ ${place.name} — no match`);
      continue;
    }

    place.google.placeId = match.id;
    place.google.lat = match.location?.latitude ?? null;
    place.google.lng = match.location?.longitude ?? null;
    place.google.businessStatus = match.businessStatus ?? null;
    place.google.lastChecked = today;
    resolved++;

    console.log(`✓ ${place.name}\n    → ${match.displayName?.text} · ${match.formattedAddress}`);
  } catch (err) {
    console.log(`✗ ${place.name} — ${err.message}`);
  }

  await new Promise((r) => setTimeout(r, 150));
}

console.log(`\nResolved ${resolved} place ID(s).`);

if (DRY_RUN) {
  console.log('--dry-run: no files written.');
} else if (resolved) {
  await writeFile(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
}
