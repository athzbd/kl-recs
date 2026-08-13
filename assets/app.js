/* KL Recs — static list + Google map with client-side filtering.
   Data comes from data/places.json. No build step, no backend. */

const state = {
  data: null,
  categories: new Set(),
  area: '',
  search: '',
  mustEat: false,
  nearMe: false,
  origin: null,      // {lat, lng} once geolocation resolves
  view: 'list',
};

let map = null;
let infoWindow = null;
let markers = [];
let clusterer = null;
let mapsReady = null;   // promise, created on first map view

/* ---------------- helpers ---------------- */

const $ = (id) => document.getElementById(id);

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2
    + Math.sin(dLng / 2) ** 2 * Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180);
  return 2 * R * Math.asin(Math.sqrt(h));
}

const formatDistance = (km) =>
  km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;

const isChain = (place) => (place.google?.outlets || 1) > 1;

/** Every area this place can be found in, not just the pinned branch. */
function areasFor(place) {
  const areas = place.google?.outletAreas?.length
    ? place.google.outletAreas
    : (place.area ? [place.area] : []);
  return areas;
}

/* For a chain, deliberately omit the place ID. Pinning one arbitrary branch
   sends you across town when there is an outlet round the corner; without it
   Google resolves the brand against wherever you actually are. */
function mapsUrl(place, mode) {
  const q = encodeURIComponent(`${place.name} Kuala Lumpur`);
  const pid = isChain(place) ? null : place.google?.placeId;

  if (mode === 'directions') {
    return `https://www.google.com/maps/dir/?api=1&destination=${q}`
      + (pid ? `&destination_place_id=${pid}` : '');
  }
  return `https://www.google.com/maps/search/?api=1&query=${q}`
    + (pid ? `&query_place_id=${pid}` : '');
}

/* ---------------- filtering ---------------- */

function visiblePlaces() {
  const { data, categories, area, search, mustEat, nearMe, origin } = state;
  const term = search.trim().toLowerCase();

  let out = data.places.filter((p) => {
    if (categories.size && !p.categories.some((c) => categories.has(c))) return false;
    // A chain matches on any area it reaches, so "coffee in Bangsar" finds
    // Kopenhagen even when Google pinned its Mont Kiara outlet.
    if (area && !areasFor(p).includes(area)) return false;
    if (mustEat && !(p.tags || []).includes('must-eat')) return false;
    if (term) {
      const hay = [p.name, p.notes, ...areasFor(p), ...(p.tags || []), ...p.categories]
        .join(' ').toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  });

  if (nearMe && origin) {
    out = out
      .map((p) => ({
        ...p,
        _km: p.google?.lat != null
          ? haversineKm(origin, { lat: p.google.lat, lng: p.google.lng })
          : Infinity,
      }))
      .sort((a, b) => a._km - b._km);
  } else {
    out = [...out].sort((a, b) => a.name.localeCompare(b.name));
  }

  return out;
}

/* ---------------- rendering ---------------- */

function cardHtml(place, { archived = false } = {}) {
  const cats = state.data.categories.filter((c) => place.categories.includes(c.id));
  const dishTags = (place.tags || []).filter((t) => t !== 'must-eat');

  // When filtering by area, name the area you asked for rather than whichever
  // branch happens to be pinned.
  const areas = areasFor(place);
  const shownArea = state.area && areas.includes(state.area) ? state.area : place.area;
  const outlets = place.google?.outlets || 1;

  const meta = [
    ...cats.map((c) => `<span class="pill">${c.icon} ${c.label}</span>`),
    shownArea ? `<span class="pill">${escapeHtml(shownArea)}</span>` : '',
    outlets > 1 ? `<span class="pill pill-chain">${outlets} branches</span>` : '',
    (place.tags || []).includes('must-eat') ? '<span class="badge-must">Must eat</span>' : '',
    place._km !== undefined && place._km !== Infinity
      ? `<span>${formatDistance(place._km)} away</span>` : '',
    archived ? '<span class="badge-closed">Closed</span>' : '',
    // Google's word, not ours — it has been wrong before, so it is surfaced
    // rather than acted on.
    !archived && place.google?.businessStatus === 'CLOSED_PERMANENTLY'
      ? '<span class="badge-closed">Reported closed</span>' : '',
  ].filter(Boolean).join('');

  return `
    <li class="card">
      <h3>${escapeHtml(place.name)}</h3>
      <div class="card-meta">${meta}</div>
      ${place.notes ? `<p class="notes">${escapeHtml(place.notes)}</p>` : ''}
      ${dishTags.length
        ? `<p class="tags">${dishTags.map((t) => `#${escapeHtml(t)}`).join(' ')}</p>` : ''}
      <div class="card-actions">
        <a class="map-link" href="${mapsUrl(place)}" target="_blank" rel="noopener">
          ${outlets > 1 ? 'Find nearest' : 'Open in Maps'}
          <span aria-hidden="true">→</span>
        </a>
      </div>
    </li>`;
}

function render() {
  const places = visiblePlaces();

  $('cards').innerHTML = places.map((p) => cardHtml(p)).join('');
  $('empty').hidden = places.length > 0;

  const total = state.data.places.length;
  $('result-count').textContent =
    places.length === total ? `${total} places` : `${places.length} of ${total} places`;

  $('clear-filters').hidden =
    !(state.categories.size || state.area || state.search || state.mustEat || state.nearMe);

  if (state.view === 'map') drawMarkers(places);
}

/* ---------------- google map ---------------- */

function loadGoogleMaps() {
  if (mapsReady) return mapsReady;

  const key = window.KLRECS?.mapsKey;
  if (!key || key.startsWith('__')) {
    mapsReady = Promise.reject(new Error('no-key'));
    return mapsReady;
  }

  mapsReady = new Promise((resolve, reject) => {
    window.__klrecsMapInit = resolve;
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}`
      + '&loading=async&callback=__klrecsMapInit';
    s.async = true;
    s.onerror = () => reject(new Error('script-failed'));
    document.head.appendChild(s);
  });

  return mapsReady;
}

async function drawMarkers(places) {
  try {
    await loadGoogleMaps();
  } catch {
    $('map').hidden = true;
    $('map-fallback').hidden = false;
    return;
  }

  const { defaultCenter, defaultZoom } = state.data.meta;

  if (!map) {
    map = new google.maps.Map($('map'), {
      center: defaultCenter,
      zoom: defaultZoom,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });
    infoWindow = new google.maps.InfoWindow();
  }

  markers.forEach((m) => m.setMap(null));
  clusterer?.clearMarkers();
  markers = [];

  const located = places.filter((p) => p.google?.lat != null && p.google?.lng != null);

  markers = located.map((p) => {
    const marker = new google.maps.Marker({
      position: { lat: p.google.lat, lng: p.google.lng },
      title: p.name,
    });
    marker.addListener('click', () => {
      infoWindow.setContent(`
        <div class="iw">
          <h3>${escapeHtml(p.name)}</h3>
          ${p.notes ? `<p>${escapeHtml(p.notes)}</p>` : ''}
          <a href="${mapsUrl(p, 'directions')}" target="_blank" rel="noopener">Directions →</a>
        </div>`);
      infoWindow.open({ map, anchor: marker });
    });
    return marker;
  });

  if (window.markerClusterer?.MarkerClusterer) {
    clusterer?.setMap(null);
    clusterer = new window.markerClusterer.MarkerClusterer({ map, markers });
  } else {
    markers.forEach((m) => m.setMap(map));
  }

  if (located.length) {
    const bounds = new google.maps.LatLngBounds();
    located.forEach((p) => bounds.extend({ lat: p.google.lat, lng: p.google.lng }));
    map.fitBounds(bounds, 40);
  }
}

/* ---------------- theme ---------------- */

const THEME_KEY = 'klrecs-theme';

/** What the page is actually showing right now. */
function currentTheme() {
  return document.documentElement.dataset.theme
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
  // Show where the click will take you, not where you are.
  $('theme-toggle').textContent = theme === 'dark' ? '☀️' : '🌙';
}

function wireTheme() {
  setTheme(currentTheme());
  $('theme-toggle').addEventListener('click', () => {
    setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  });
}

/* ---------------- setup ---------------- */

function buildControls() {
  const { categories, areas, meta } = state.data;

  $('site-title').textContent = meta.title;
  $('site-subtitle').textContent = meta.subtitle;
  document.title = meta.title;

  $('tips').innerHTML = (meta.tips || [])
    .map((t) => `<li>‼️ ${escapeHtml(t)}</li>`).join('');

  $('category-chips').innerHTML = categories
    .map((c) => `<button class="chip" data-cat="${c.id}" aria-pressed="false">${c.icon} ${c.label}</button>`)
    .join('');

  const known = areas?.length
    ? areas
    : [...new Set(state.data.places.map((p) => p.area).filter(Boolean))].sort();

  $('area-filter').innerHTML =
    '<option value="">All areas</option>'
    + known.map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');

  $('area-filter').parentElement.hidden = false;
  if (!known.length) $('area-filter').hidden = true;
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

  $('must-eat').addEventListener('click', (e) => {
    state.mustEat = !state.mustEat;
    e.currentTarget.setAttribute('aria-pressed', String(state.mustEat));
    render();
  });

  $('near-me').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (state.nearMe) {
      state.nearMe = false;
      btn.setAttribute('aria-pressed', 'false');
      return render();
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

  const resetFilters = () => {
    Object.assign(state, { area: '', search: '', mustEat: false, nearMe: false });
    state.categories.clear();
    $('search').value = '';
    $('area-filter').value = '';
    document.querySelectorAll('[aria-pressed="true"]')
      .forEach((b) => b.setAttribute('aria-pressed', 'false'));
    render();
  };

  $('clear-filters').addEventListener('click', resetFilters);

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

  /* Smooth scrolling is a no-op in some browsers and whenever the reader has
     reduce-motion on, which would leave the button looking broken. Ask for
     smooth, then make sure we actually landed. */
  const scrollToTop = () => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      window.scrollTo(0, 0);
      return;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => { if (window.scrollY > 0) window.scrollTo(0, 0); }, 600);
  };

  // The title doubles as a home button: clear everything, back to the list,
  // back to the top.
  $('site-title').addEventListener('click', () => {
    resetFilters();
    setView('list');
    scrollToTop();
  });
}

function renderArchive() {
  const archive = state.data.archive || [];
  if (!archive.length) return;
  $('archive-section').hidden = false;
  $('archive-summary').textContent = `Closed / archived (${archive.length})`;
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

// Wired independently of the data fetch, so the toggle still works if the
// list fails to load.
wireTheme();

init().catch((err) => {
  console.error(err);
  $('empty').hidden = false;
  $('empty').textContent = 'Could not load the list.';
});
