#!/usr/bin/env node
/* Weekly health check.
 *
 * Asks Google Places for the current status of every place that has a placeId,
 * and writes the answer back into each entry's `google` block. Personal fields
 * (name, notes, rating, tags, categories) are never touched.
 *
 * Places that report CLOSED_PERMANENTLY are moved into `archive`.
 *
 * Usage:  GOOGLE_MAPS_API_KEY=xxx node scripts/check-places.mjs [--dry-run]
 */

import { readFile, writeFile } from 'node:fs/promises';

const DATA_PATH = new URL('../data/places.json', import.meta.url);
const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const DRY_RUN = process.argv.includes('--dry-run');

// Keep this tight — every extra field can raise the billing tier.
// `regularOpeningHours` and `rating` are deliberately absent: they push the
// request into the priciest SKU and nothing on the page uses them.
const FIELD_MASK = 'id,displayName,businessStatus,location,formattedAddress';

if (!API_KEY) {
  console.error('Missing GOOGLE_MAPS_API_KEY.');
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);

async function fetchPlace(placeId) {
  const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: { 'X-Goog-Api-Key': API_KEY, 'X-Goog-FieldMask': FIELD_MASK },
  });

  if (res.status === 404) return { gone: true };
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

const data = JSON.parse(await readFile(DATA_PATH, 'utf8'));
const closures = [];
const problems = [];
let checked = 0;

for (const place of data.places) {
  const placeId = place.google?.placeId;
  if (!placeId) {
    problems.push(`${place.name} — no placeId yet, skipped`);
    continue;
  }

  try {
    const result = await fetchPlace(placeId);
    checked++;

    if (result.gone) {
      problems.push(`${place.name} — placeId no longer resolves, needs re-linking`);
      place.google.lastChecked = today;
      continue;
    }

    place.google.businessStatus = result.businessStatus ?? null;
    place.google.lat = result.location?.latitude ?? place.google.lat;
    place.google.lng = result.location?.longitude ?? place.google.lng;
    place.google.address = result.formattedAddress ?? place.google.address;
    place.google.lastChecked = today;

    if (result.businessStatus === 'CLOSED_PERMANENTLY') closures.push(place);
  } catch (err) {
    problems.push(`${place.name} — lookup failed: ${err.message}`);
  }

  await new Promise((r) => setTimeout(r, 120)); // be polite to the API
}

// Move permanent closures out of the main list.
if (closures.length) {
  const closedIds = new Set(closures.map((p) => p.id));
  data.places = data.places.filter((p) => !closedIds.has(p.id));
  data.archive = [
    ...(data.archive || []),
    ...closures.map((p) => ({ ...p, archivedOn: today })),
  ];
}

const summary = {
  checked,
  closed: closures.map((p) => p.name),
  problems,
};
console.log(JSON.stringify(summary, null, 2));

if (DRY_RUN) {
  console.log('\n--dry-run: no files written.');
} else {
  await writeFile(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
}

// Surfaced to the workflow so it can decide whether to open an issue.
if (process.env.GITHUB_OUTPUT) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_OUTPUT, `closed_count=${closures.length}\n`);
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `closed_names=${closures.map((p) => p.name).join(', ')}\n`
  );
}
