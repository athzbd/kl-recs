/* KL Recs — static list + map with client-side filtering.
   Data comes from data/places.json. No build step, no backend. */

const KL_TZ = 'Asia/Kuala_Lumpur';

const state = {
  data: null,
  categories: new Set(),
  area: '',
  search: '',
  openNow: false,
  nearMe: false,
  origin: null,      // {lat, lng} once geolocation resolves
  view: 'list',
};

let map = null;
let markerLayer = null;

/* ---------------- helpers ---------------- */

const $ = (id) => document.getElementById(id);

function stars(n) {
  if (!n) return '';
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));
}

function priceLabel(p) {
  return p > 0 ? '$'.repeat(p) : null;
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

function formatDistance(km) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

/** Current time in Kuala Lumpur, regardless of where the viewer is. */
function nowInKL() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: KL_TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    day: days[get('weekday')],
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** Google periods: [{open:{day,hour,minute}, close:{day,hour,minute}}]. Handles overnight. */
function isOpenNow(hours) {
  if (!Array.isArray(hours) || hours.length === 0) return null;
  const now = nowInKL();
  const nowAbs = now.day * 1440 + now.minutes;

  return hours.some((period) => {
    if (!period.open) return true; // open 24/7
    const start = period.open.day * 1440 + period.open.hour * 60 + (period.open.minute || 0);
    if (!period.close) return true;
    let end = period.close.day * 1440 + period.close.hour * 60 + (period.close.minute || 0);
    if (end <= start) end += 7 * 1440; // wraps past midnight / end of week
    const probe = nowAbs < start ? nowAbs + 7 * 1440 : nowAbs;
    return probe >= start && probe < end;
  });
}

function mapsSearchUrl(place) {
  const q = encodeURIComponent(`${place.name} Kuala Lumpur`);
  const pid = place.google?.placeId;
  return pid
    ? `https://www.google.com/maps/search/?api=1&query=${q}&query_place_id=${pid}`
    : `https://www.google.com/maps/search/?api=1&query=${q}`;
}

function mapsDirectionsUrl(place) {
  const q = encodeURIComponent(`${place.name} Kuala Lumpur`);
  const pid = place.google?.placeId;
  return pid
    ? `https://www.google.com/maps/dir/?api=1&destination=${q}&destination_place_id=${pid}`
    : `https://www.google.com/maps/dir/?api=1&destination=${q}`;
}

/* ---------------- filtering ---------------- */

function visiblePlaces() {
  const { data, categories, area, search, openNow, nearMe, origin } = state;
  const term = search.trim().toLowerCase();

  let out = data.places.filter((p) => {
    if (categories.size && !p.categories.some((c) => categories.has(c))) return false;
    if (area && p.area !== area) return false;
    if (openNow && isOpenNow(p.google?.hours) !== true) return false;
    if (term) {
      const hay = [p.name, p.notes, p.area, ...(p.tags || []), ...p.categories]
        .join(' ').toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  });

  if (nearMe && origin) {
    out = out
      .map((p) => ({ ...p, _km: p.google?.lat ? haversineKm(origin, { lat: p.google.lat, lng: p.google.lng }) : Infinity }))
      .sort((a, b) => a._km - b._km);
  } else {
    out = [...out].sort((a, b) => (b.rating || 0) - (a.rating || 0) || a.name.localeCompare(b.name));
  }

  return out;
}

/* ---------------- rendering ---------------- */

function cardHtml(place, { archived = false } = {}) {
  const cats = state.data.categories.filter((c) => place.categories.includes(c.id));
  const open = archived ? null : isOpenNow(place.google?.hours);
  const price = priceLabel(place.price);

  const meta = [
    ...cats.map((c) => `<span class="pill">${c.icon} ${c.label}</span>`),
    place.area ? `<span class="pill">${place.area}</span>` : '',
    price ? `<span>${price}</span>` : '',
    place._km !== undefined && place._km !== Infinity ? `<span>${formatDistance(place._km)} away</span>` : '',
    open === true ? '<span class="badge-open">Open now</span>' : '',
    open === false ? '<span class="badge-shut">Closed now</span>' : '',
    archived ? '<span class="badge-closed">Permanently closed</span>' : '',
  ].filter(Boolean).join('');

  return `
    <li class="card">
      <div class="card-top">
        <h3>${escapeHtml(place.name)}</h3>
        <span class="stars">${stars(place.rating)}</span>
      </div>
      <div class="card-meta">${meta}</div>
      ${place.notes ? `<p class="notes">${escapeHtml(place.notes)}</p>` : ''}
      <div class="card-actions">
        <a href="${mapsSearchUrl(place)}" target="_blank" rel="noopener">View on Maps</a>
        <a href="${mapsDirectionsUrl(place)}" target="_blank" rel="noopener">Directions</a>
      </div>
    </li>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function render() {
  const places = visiblePlaces();

  $('cards').innerHTML = places.map((p) => cardHtml(p)).join('');
  $('empty').hidden = places.length > 0;

  const total = state.data.places.length;
  $('result-count').textContent =
    places.length === total ? `${total} places` : `${places.length} of ${total} places`;

  const filtered = state.categories.size || state.area || state.search || state.openNow || state.nearMe;
  $('clear-filters').hidden = !filtered;

  if (state.view === 'map') renderMap(places);
}

function renderMap(places) {
  const { defaultCenter, defaultZoom } = state.data.meta;

  if (!map) {
    map = L.map('map').setView([defaultCenter.lat, defaultCenter.lng], defaultZoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
  }

  markerLayer.clearLayers();
  const located = places.filter((p) => p.google?.lat != null && p.google?.lng != null);

  located.forEach((p) => {
    L.marker([p.google.lat, p.google.lng])
      .bindPopup(`
        <h3>${escapeHtml(p.name)}</h3>
        <p>${escapeHtml(p.notes || '')}</p>
        <a href="${mapsDirectionsUrl(p)}" target="_blank" rel="noopener">Directions →</a>`)
      .addTo(markerLayer);
  });

  if (located.length) {
    map.fitBounds(L.latLngBounds(located.map((p) => [p.google.lat, p.google.lng])).pad(0.15));
  }
  setTimeout(() => map.invalidateSize(), 0);
}

/* ---------------- setup ---------------- */

function buildControls() {
  const { categories, areas, meta } = state.data;

  $('site-title').textContent = meta.title;
  $('site-subtitle').textContent = meta.subtitle;
  document.title = meta.title;

  $('category-chips').innerHTML = categories
    .map((c) => `<button class="chip" data-cat="${c.id}" aria-pressed="false">${c.icon} ${c.label}</button>`)
    .join('');

  $('area-filter').innerHTML =
    '<option value="">All areas</option>' +
    areas.map((a) => `<option value="${a}">${a}</option>`).join('');
}

function wireEvents() {
  $('category-chips').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    const cat = btn.dataset.cat;
    const on = state.categories.has(cat);
    on ? state.categories.delete(cat) : state.categories.add(cat);
    btn.setAttribute('aria-pressed', String(!on));
    render();
  });

  $('area-filter').addEventListener('change', (e) => {
    state.area = e.target.value;
    render();
  });

  let debounce;
  $('search').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { state.search = e.target.value; render(); }, 120);
  });

  $('open-now').addEventListener('click', (e) => {
    state.openNow = !state.openNow;
    e.currentTarget.setAttribute('aria-pressed', String(state.openNow));
    render();
  });

  $('near-me').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (state.nearMe) {
      state.nearMe = false;
      btn.setAttribute('aria-pressed', 'false');
      render();
      return;
    }
    btn.textContent = '📍 Locating…';
    try {
      const pos = await new Promise((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000 }));
      state.origin = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      state.nearMe = true;
      btn.setAttribute('aria-pressed', 'true');
    } catch {
      alert('Could not get your location. Check location permissions for this site.');
    }
    btn.textContent = '📍 Near me';
    render();
  });

  $('clear-filters').addEventListener('click', () => {
    state.categories.clear();
    state.area = '';
    state.search = '';
    state.openNow = false;
    state.nearMe = false;
    $('search').value = '';
    $('area-filter').value = '';
    document.querySelectorAll('[aria-pressed="true"]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    render();
  });

  const setView = (view) => {
    state.view = view;
    $('list-view').hidden = view !== 'list';
    $('map-view').hidden = view !== 'map';
    $('tab-list').classList.toggle('active', view === 'list');
    $('tab-map').classList.toggle('active', view === 'map');
    $('tab-list').setAttribute('aria-selected', String(view === 'list'));
    $('tab-map').setAttribute('aria-selected', String(view === 'map'));
    render();
  };
  $('tab-list').addEventListener('click', () => setView('list'));
  $('tab-map').addEventListener('click', () => setView('map'));
}

function renderArchive() {
  const archive = state.data.archive || [];
  if (!archive.length) return;
  $('archive-section').hidden = false;
  $('archive-cards').innerHTML = archive.map((p) => cardHtml(p, { archived: true })).join('');
}

async function init() {
  const res = await fetch('data/places.json', { cache: 'no-cache' });
  state.data = await res.json();

  buildControls();
  wireEvents();
  render();
  renderArchive();

  const dates = state.data.places.map((p) => p.updated).filter(Boolean).sort();
  if (dates.length) $('last-updated').textContent = `Last updated ${dates[dates.length - 1]}`;
}

init().catch((err) => {
  console.error(err);
  $('empty').hidden = false;
  $('empty').textContent = 'Could not load the list.';
});
