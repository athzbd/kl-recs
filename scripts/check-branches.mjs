#!/usr/bin/env node
/* Work out which entries are chains, and which areas each chain reaches.
 *
 * The resolver stores exactly one place ID per entry, so a chain silently gets
 * pinned to whichever branch Google returned first. That breaks the area
 * filter: Kopenhagen Coffee has a Bangsar outlet, but if Google pinned the
 * Mont Kiara one, filtering "Bangsar" hides it.
 *
 * This records, inside each entry's `google` block:
 *   outlets     — how many outlets carry the name
 *   outletAreas — every area they sit in, for the area filter
 *
 * Entries flagged `singleLocation: true` are skipped — that flag marks the
 * landmarks and complexes (TRX, The Five) where multiple Google results are
 * shops inside one place, not branches of a brand.
 *
 * Usage:  GOOGLE_MAPS_API_KEY=xxx node scripts/check-branches.mjs [--dry-run]
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

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Does this result look like the same brand, rather than a coincidence? */
function sameBrand(entryName, resultName) {
  const a = norm(entryName);
  const b = norm(resultName);
  if (!a || !b) return false;
  return b.startsWith(a) || a.startsWith(b) || b.includes(a);
}

async function search(query) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.businessStatus',
    },
    body: JSON.stringify({ textQuery: query, regionCode: 'MY', maxResultCount: 20 }),
  });

  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const { places } = await res.json();
  return places ?? [];
}

const data = JSON.parse(await readFile(DATA_PATH, 'utf8'));
const report = [];
const problems = [];

for (const place of data.places) {
  if (place.singleLocation) {
    place.google.outlets = 1;
    place.google.outletAreas = place.area ? [place.area] : [];
    continue;
  }

  try {
    const results = await search(`${place.name} Kuala Lumpur Malaysia`);
    const brand = results.filter(
      (r) => sameBrand(place.name, r.displayName?.text)
        && r.businessStatus !== 'CLOSED_PERMANENTLY'
    );

    // De-duplicate by place ID — Google occasionally returns the same outlet twice.
    const byId = new Map(brand.map((r) => [r.id, r]));
    const outlets = [...byId.values()];

    const areas = [...new Set(
      outlets.map((r) => areaFromAddress(r.formattedAddress)).filter(Boolean)
    )].sort();

    // Never lose the pinned area just because Text Search moved on.
    if (place.area && !areas.includes(place.area)) areas.push(place.area);

    place.google.outlets = Math.max(outlets.length, 1);
    place.google.outletAreas = areas.sort();

    // A chain with no pinned area can still take one from its outlets.
    if (!place.area && areas.length) place.area = areas[0];

    if (outlets.length > 1) {
      report.push({ name: place.name, count: outlets.length, areas });
    }
  } catch (err) {
    problems.push(`${place.name}: ${err.message}`);
  }

  await new Promise((r) => setTimeout(r, 120));
}

// The area dropdown must offer every area any outlet reaches.
data.areas = [...new Set(
  data.places.flatMap((p) => [p.area, ...(p.google.outletAreas || [])]).filter(Boolean)
)].sort();

report.sort((a, b) => b.count - a.count);

console.log(`\nChecked ${data.places.length} places.`);
console.log(`${report.length} have more than one outlet.\n`);
for (const r of report) {
  console.log(`${String(r.count).padStart(2)}x  ${r.name}`);
  console.log(`      ${r.areas.join(', ') || 'no recognised areas'}`);
}
if (problems.length) console.log(`\nProblems:\n  ${problems.join('\n  ')}`);
console.log(`\nArea list is now: ${data.areas.join(', ')}`);

if (DRY_RUN) {
  console.log('\n--dry-run: no files written.');
} else {
  await writeFile(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
}
