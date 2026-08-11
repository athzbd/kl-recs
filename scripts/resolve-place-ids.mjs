#!/usr/bin/env node
/* Fill in missing Place IDs, coordinates and areas.
 *
 * For every place whose google.placeId is null, searches Google by name and
 * stores the top match. Prints what it matched so you can eyeball it — Text
 * Search is fuzzy, and a wrong match here poisons everything downstream.
 *
 * Also derives `area` from the matched address when it is still null. Your own
 * fields (name, notes, categories, tags) are never touched.
 *
 * Usage:  GOOGLE_MAPS_API_KEY=xxx node scripts/resolve-place-ids.mjs [--dry-run]
 */

import { readFile, writeFile } from 'node:fs/promises';
import { areaFromAddress } from './lib/areas.mjs';

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
const unmatched = [];

for (const place of data.places) {
  if (place.google?.placeId) continue;

  // `searchQuery` is an explicit override for entries Text Search gets wrong.
  // Otherwise the note usually carries the hint ("SS2", "Jalan Alor", "@ W Hotel").
  const hint = place.notes?.replace(/^@\s*/, '') || '';
  const query = place.searchQuery
    || `${place.name} ${hint} Kuala Lumpur Malaysia`.replace(/\s+/g, ' ');

  try {
    const match = await search(query);
    if (!match) {
      unmatched.push(place.name);
      console.log(`✗ ${place.name} — no match`);
      continue;
    }

    place.google.placeId = match.id;
    place.google.lat = match.location?.latitude ?? null;
    place.google.lng = match.location?.longitude ?? null;
    place.google.businessStatus = match.businessStatus ?? null;
    place.google.address = match.formattedAddress ?? null;
    place.google.lastChecked = today;

    if (!place.area) place.area = areaFromAddress(match.formattedAddress);
    resolved++;

    const flag = match.businessStatus === 'CLOSED_PERMANENTLY' ? '  ⚠️ CLOSED' : '';
    console.log(`✓ ${place.name}${flag}\n    → ${match.displayName?.text} · ${match.formattedAddress}`);
  } catch (err) {
    unmatched.push(place.name);
    console.log(`✗ ${place.name} — ${err.message}`);
  }

  await new Promise((r) => setTimeout(r, 150));
}

// Rebuild the area list from what actually resolved.
data.areas = [...new Set(data.places.map((p) => p.area).filter(Boolean))].sort();

console.log(`\nResolved ${resolved}. Areas found: ${data.areas.join(', ') || 'none'}`);
if (unmatched.length) console.log(`Needs a manual look: ${unmatched.join(', ')}`);

if (DRY_RUN) {
  console.log('--dry-run: no files written.');
} else if (resolved) {
  await writeFile(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
}
