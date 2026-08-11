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
// --only=some-id limits the run to one entry, for cheap iteration.
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
const VERBOSE = process.argv.includes('--verbose');

if (!API_KEY) {
  console.error('Missing GOOGLE_MAPS_API_KEY.');
  process.exit(1);
}

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/* Words that describe what a place is rather than who it is. Stripping them
   leaves the bit that actually identifies the brand, so "Feeka Coffee
   Roasters" and "Feeka @ The Five" are recognised as the same thing. */
const GENERIC = new RegExp(
  '\\b(coffee|roasters?|roastery|cafe|caf\u00e9|restaurant|restoran|bar|bistro|'
  + 'kitchen|eatery|kl|kuala|lumpur|malaysia|sdn|bhd|the|by|at|specialty)\\b',
  'gi'
);

/** The identifying part of a name: "Feeka Coffee Roasters" -> "feeka". */
function brandCore(name) {
  const stripped = norm((name || '').replace(GENERIC, ' '));
  return stripped || norm(name);
}

/** Generic word, or bare punctuation like the "&" in "Hani Coffee & Roastery". */
const isDroppable = (token) => {
  if (/^\W+$/.test(token)) return true;
  GENERIC.lastIndex = 0;
  return GENERIC.test(token);
};

/* A shorter query to retry with, made by dropping descriptive words off the
 * END only. Google files branches as "FEEKA at The Five" and "FEEKA by the
 * Park", so "Feeka Coffee Roasters" finds one outlet but "Feeka" finds four.
 *
 * Trailing-only matters: "Coffee Stain" must not become "Stain", because
 * there the generic word is part of the brand.
 *
 * Returns null when there is nothing usefully shorter to try.
 */
function shortName(name) {
  const tokens = name.split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && isDroppable(tokens[tokens.length - 1])) tokens.pop();

  const short = tokens.join(' ');
  if (short === name) return null;
  if (short.length < 4 || /^[\d\W]+$/.test(short)) return null;  // "103" etc.
  return short;
}

/** Does this result look like the same brand, rather than a coincidence? */
function sameBrand(entryName, resultName) {
  const a = norm(entryName);
  const b = norm(resultName);
  if (!a || !b) return false;
  if (b.startsWith(a) || a.startsWith(b) || b.includes(a)) return true;

  /* Fall back to the identifying core. Guarded on length because short cores
     ("xo", "hide", "peep") collide with unrelated businesses far too easily. */
  const core = brandCore(entryName);
  if (core.length < 5) return false;
  return norm(resultName).includes(core) || brandCore(resultName).includes(core);
}

/* Greater Klang Valley. Restricting to it stops Text Search spending its 20
   result slots on same-named places in other states, which is how Feeka's
   Damansara Heights outlet went missing. */
const KLANG_VALLEY = {
  rectangle: {
    low: { latitude: 2.85, longitude: 101.35 },
    high: { latitude: 3.40, longitude: 101.90 },
  },
};

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
      locationRestriction: KLANG_VALLEY,
    }),
  });

  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const { places } = await res.json();
  return places ?? [];
}

/* --query="..." runs one arbitrary search and exits. Purely a debugging aid
   for working out what Google will and will not return for a brand. */
const RAW_QUERY = process.argv.find((a) => a.startsWith('--query='))?.slice(8);
if (RAW_QUERY) {
  const results = await search(RAW_QUERY);
  console.log(`\n"${RAW_QUERY}" -> ${results.length} results`);
  results.forEach((r) => console.log(
    `   ${r.displayName?.text} · ${r.formattedAddress?.slice(0, 70)}`
  ));
  process.exit(0);
}

const data = JSON.parse(await readFile(DATA_PATH, 'utf8'));
const report = [];
const problems = [];

for (const place of data.places) {
  if (ONLY && place.id !== ONLY) continue;

  /* An explicit override wins over Google. Text Search under-reports some
     brands — it found one Coffee Stain when there are three — and Athena
     knows the ground truth. No API call needed. */
  if (place.branchesOverride) {
    const { outlets, areas } = place.branchesOverride;
    place.google.outlets = outlets ?? areas.length;
    place.google.outletAreas = [...areas].sort();
    if (!place.area) place.area = areas[0];
    report.push({ name: `${place.name} (manual)`, count: place.google.outlets, areas });
    continue;
  }

  if (place.singleLocation) {
    // No search, but still derive an area from the address already stored.
    place.area = place.area || areaFromAddress(place.google?.address);
    place.google.outlets = 1;
    place.google.outletAreas = place.area ? [place.area] : [];
    continue;
  }

  try {
    let results = await search(place.name);

    /* One outlet may just mean the full name only matches the original branch.
       Retry with the shorter brand name, but only when the first search looks
       thin — this is the difference between ~110 and ~200 API calls a run. */
    const short = shortName(place.name);
    if (results.length <= 1 && short) {
      const more = await search(short);
      const byId = new Map([...results, ...more].map((r) => [r.id, r]));
      results = [...byId.values()];
      if (VERBOSE) console.log(`   (retried as "${short}" -> ${more.length} results)`);
    }

    const brand = results.filter(
      (r) => sameBrand(place.name, r.displayName?.text)
        && r.businessStatus !== 'CLOSED_PERMANENTLY'
    );

    if (VERBOSE) {
      console.log(`\n${place.name} — ${results.length} results, ${brand.length} same-brand`);
      results.forEach((r) => console.log(
        `   ${sameBrand(place.name, r.displayName?.text) ? '✓' : ' '} `
        + `${r.displayName?.text} · ${r.formattedAddress?.slice(0, 60)}`
      ));
    }

    // De-duplicate by place ID — Google occasionally returns the same outlet twice.
    const byId = new Map(brand.map((r) => [r.id, r]));
    const outlets = [...byId.values()];

    const areas = [...new Set(
      outlets.map((r) => areaFromAddress(r.formattedAddress)).filter(Boolean)
    )].sort();

    /* Fall back to this entry's own stored address. When Google's name for a
       place differs from Athena's — "Terrasse KL" for Terrazza — sameBrand
       rejects every result and areas comes back empty, which used to leave
       the entry with no area at all. */
    if (!areas.length) {
      const own = areaFromAddress(place.google?.address);
      if (own) areas.push(own);
    }

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
