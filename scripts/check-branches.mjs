#!/usr/bin/env node
/* Report-only: which entries are chains with more than one outlet?
 *
 * The resolver stores exactly one place ID per entry, so a chain silently
 * gets pinned to whichever branch Google returned first. This searches each
 * name and counts how many distinct outlets carry essentially that name, so
 * the multi-branch ones can be named or split deliberately.
 *
 * Writes nothing. Prints a report.
 *
 * Usage:  GOOGLE_MAPS_API_KEY=xxx node scripts/check-branches.mjs
 */

import { readFile } from 'node:fs/promises';

const DATA_PATH = new URL('../data/places.json', import.meta.url);
const API_KEY = process.env.GOOGLE_MAPS_API_KEY;

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
    body: JSON.stringify({
      textQuery: query,
      regionCode: 'MY',
      maxResultCount: 20,
    }),
  });

  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const { places } = await res.json();
  return places ?? [];
}

/** Pull the neighbourhood-ish part out of a Malaysian formatted address. */
function shortArea(address = '') {
  const parts = address.split(',').map((s) => s.trim());
  // Second-to-last useful chunk is usually "50480 Kuala Lumpur" or "Bangsar".
  const withoutCountry = parts.filter((p) => !/malaysia/i.test(p));
  const tail = withoutCountry.slice(-3, -1).join(', ');
  return tail || address.slice(0, 40);
}

const data = JSON.parse(await readFile(DATA_PATH, 'utf8'));
const multi = [];
const problems = [];

for (const place of data.places) {
  try {
    const results = await search(`${place.name} Kuala Lumpur Malaysia`);
    const brand = results.filter(
      (r) => sameBrand(place.name, r.displayName?.text)
        && r.businessStatus !== 'CLOSED_PERMANENTLY'
    );

    if (brand.length > 1) {
      multi.push({
        name: place.name,
        pinnedTo: place.area || '?',
        count: brand.length,
        outlets: brand.map((r) => shortArea(r.formattedAddress)),
      });
    }
  } catch (err) {
    problems.push(`${place.name}: ${err.message}`);
  }

  await new Promise((r) => setTimeout(r, 120));
}

multi.sort((a, b) => b.count - a.count);

console.log(`\nChecked ${data.places.length} places.`);
console.log(`${multi.length} look like they have more than one outlet.\n`);

for (const m of multi) {
  console.log(`${m.count}x  ${m.name}  [pinned to ${m.pinnedTo}]`);
  m.outlets.forEach((o) => console.log(`      · ${o}`));
}

if (problems.length) {
  console.log(`\nLookup problems:\n  ${problems.join('\n  ')}`);
}
