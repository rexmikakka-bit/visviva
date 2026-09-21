// Market price fetching. Three sources, one interface.
//
// Fuzzwork is the default and the only one with a BULK endpoint — one request for every type in the
// fit. The other two are per-type, so they are fetched with a small concurrency pool and cached
// hard. Prices are "what it costs to buy one", which is sell-percentile on Fuzzwork and lowest sell
// elsewhere; close enough to compare fits, and each source says which it used.
//
// Results are cached in localStorage per SOURCE and hub. The hour-long TTL decides whether to
// REFETCH, not whether a number is still worth showing — see the cache block below.
//
// ⚠️ CORS: only Fuzzwork sends `Access-Control-Allow-Origin: *`. ceve-market sends no CORS header at
// all, so a BROWSER blocks it and it returns nothing. It works fine in the
// shipped app because capacitor.config.json sets `CapacitorHttp.enabled: true`, which routes
// fetch() through native networking, where CORS does not apply — the same mechanism that lets ESI
// work without a backend. Verified with curl: both return 200 and real data; only Fuzzwork
// carries the header. Practical upshot: test ceve ON DEVICE, not in `npm run dev`.

const HUBS = {
  Jita:    60003760,
  Amarr:   60008494,
  Dodixie: 60011866,
  Rens:    60004588,
  Hek:     60005686,
};

// Region for each hub. ceve-market and EVE Tycoon work by region rather than station, so a hub
// means "the region that hub sits in" for those two. Verified against ceve by fetching Tritanium in
// each: The Forge 9.39, Domain 8.92, Sinq Laison 15, Heimatar 7.06, Metropolis 20.
const HUB_REGIONS = {
  Jita:    10000002,   // The Forge
  Amarr:   10000043,   // Domain
  Dodixie: 10000032,   // Sinq Laison
  Rens:    10000030,   // Heimatar
  Hek:     10000042,   // Metropolis
};

export const MARKET_HUBS = Object.keys(HUBS);
export const MARKET_SOURCES = ['fuzzwork', 'ceve'];

// ── Never hang ──────────────────────────────────────────────────────────────────────────────────
// A price fetch is triggered by a button ("Optimize Fit Price") and reports through a banner, so a
// request that never settles leaves "Checking market prices…" on screen forever with no way out.
// That is exactly what a phone with no signal produces: neither Capacitor's native HTTP layer nor
// `fetch()` applies a default timeout, and a dead socket can sit open for minutes.
//
// Two mechanisms, because one is not enough. The AbortController actually cancels the request, but
// CapacitorHttp routes fetch() through native code and is not guaranteed to honour a signal — so
// the deadline ALSO races a timer, which settles the caller's promise whether or not the underlying
// request ever comes back. Belt and braces: the abort frees the socket where it works, the race is
// what the UI can rely on.
const REQUEST_TIMEOUT_MS = 8000;    // one HTTP request
const BATCH_TIMEOUT_MS  = 20000;    // the whole fetch, however many requests it takes

/** A network failure the UI can phrase as "you're offline" rather than "the market API is down". */
function offlineError(msg) {
  const e = new Error(msg);
  e.offline = true;
  return e;
}

function withDeadline(promise, ms, ctl) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { ctl.abort(); } catch {}
      reject(offlineError('Price lookup timed out'));
    }, ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

async function timedFetch(url, signal) {
  const ctl = new AbortController();
  const relay = () => ctl.abort();
  signal?.addEventListener('abort', relay, { once: true });
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: ctl.signal });
  } catch (e) {
    throw (e?.name === 'AbortError') ? offlineError('Price request timed out') : e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relay);
  }
}

// Run `jobs` with at most `limit` in flight. These two sources need one request PER TYPE, and a
// 40-module fit firing 40 parallel requests is how you get rate-limited by a hobby API.
async function pooled(items, limit, worker) {
  const out = [];
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await worker(items[idx]); } catch { out[idx] = null; }
    }
  });
  await Promise.all(runners);
  return out;
}

// An hour is how long a price is worth REUSING, not how long it is worth knowing. Past it the entry
// is refetched, but it is still handed out: an hour-old price is the only thing a phone docked
// somewhere with no signal can say about what a fit costs, and discarding it leaves the fit value at
// zero — which reads as free rather than as unknown. Screens showing a stale figure say how old it is.
export const PRICE_TTL_MS = 60 * 60 * 1000;

function cacheKey(hub, source) { return `axis_price_${source}_${hub}`; }

// Timestamped per ENTRY rather than per blob. The blob is rewritten every time a fit introduces a new
// type to it, so a blob-level stamp would date a fortnight-old price to today — and the age is the
// entire reason a stale price is safe to show. Entries written by earlier versions are bare numbers;
// they inherit the blob's stamp, which is the closest thing to their real age and beats discarding them.
function loadCache(hub, source) {
  try {
    const raw = localStorage.getItem(cacheKey(hub, source));
    if (!raw) return null;
    const { ts, prices } = JSON.parse(raw);
    const out = new Map();
    for (const [id, value] of Object.entries(prices ?? {})) {
      const [price, at] = Array.isArray(value) ? value : [value, ts];
      if (price > 0) out.set(Number(id), { price, ts: Number(at) || 0 });
    }
    return out.size ? out : null;
  } catch { return null; }
}

function saveCache(hub, source, entries) {
  const prices = {};
  for (const [id, entry] of entries) prices[id] = [entry.price, entry.ts];
  try { localStorage.setItem(cacheKey(hub, source), JSON.stringify({ ts: Date.now(), prices })); } catch {}
}

export function getCachedPrices(hub = 'Jita', source = 'fuzzwork') {
  const cached = loadCache(hub, source);
  return cached ? new Map([...cached].map(([id, entry]) => [id, entry.price])) : new Map();
}

// The OLDEST entry behind a set of types, because a total is only as current as its stalest part and
// "can I trust this number" is one question about the whole card, not one per row. Types with no
// cached price at all are skipped — they are missing, not old.
export function priceAsOf(typeIDs, hub = 'Jita', source = 'fuzzwork') {
  const cached = loadCache(hub, source);
  if (!cached) return null;
  let oldest = null;
  for (const id of new Set(typeIDs)) {
    const entry = cached.get(Number(id));
    if (entry && (oldest == null || entry.ts < oldest)) oldest = entry.ts;
  }
  return oldest;
}

export function pricesAreStale(asOf, now = Date.now()) {
  return asOf != null && now - asOf > PRICE_TTL_MS;
}

// ceve-market: one small aggregate per type, region-scoped. Must be www + https — the bare host
// 301s to plain http, and a mixed-content request is blocked outright in the web build.
async function fetchCeve(ids, region, signal) {
  const out = new Map();
  await pooled(ids, 6, async (id) => {
    const r = await timedFetch(`https://www.ceve-market.org/api/market/region/${region}/type/${id}.json`, signal);
    if (!r.ok) return;
    const d = await r.json();
    const p = Number(d?.sell?.min);
    if (p > 0) out.set(id, p);
  });
  return out;
}

async function fetchFuzzwork(ids, station, signal) {
  const url = `https://market.fuzzwork.co.uk/aggregates/?types=${ids.join(',')}&station=${station}`;
  const resp = await timedFetch(url, signal);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  const out = new Map();
  for (const [id, info] of Object.entries(data)) {
    const price = parseFloat(info?.sell?.percentile ?? 0);
    if (price > 0) out.set(Number(id), price);
  }
  return out;
}

// ── Priming the whole catalogue ─────────────────────────────────────────────────────────────────
// The cache only ever learns the types some screen has already asked about, so a module you have
// never opened has nothing cached and reads as blank the moment the connection goes — the one time
// you most want a number. Priming walks every priceable type once so that stops being true. The
// entries are dated like any other, so a month-old price still says how old it is rather than
// passing itself off as current.
//
// CHUNKED because Fuzzwork's bulk endpoint takes the ids in the query string, and seven thousand of
// them is a 60 KB URL that nothing will serve. Each chunk goes through fetchPrices, so it is merged
// and written as it lands: a prime interrupted halfway keeps everything it got up to that point,
// and re-running it costs nothing for the part still inside the TTL.
const PRIME_CHUNK = 400;

export async function primePrices(typeIDs, hub = 'Jita', source = 'fuzzwork', { onProgress } = {}) {
  const ids = [...new Set(typeIDs.filter(id => id != null && id > 0))];
  for (let i = 0; i < ids.length; i += PRIME_CHUNK) {
    try { await fetchPrices(ids.slice(i, i + PRIME_CHUNK), hub, source); }
    // One chunk the market has nothing to say about is not a reason to abandon the other sixteen.
    // A dead connection is, and every remaining chunk would fail the same way.
    catch (e) { if (e?.offline) throw e; }
    onProgress?.(Math.min(i + PRIME_CHUNK, ids.length), ids.length);
  }
  // What the cache actually HOLDS, not what was asked for. The gap is real and permanent: plenty of
  // types have no sell order anywhere, and reporting the request count would claim otherwise.
  return { priced: getCachedPrices(hub, source).size, total: ids.length };
}

export async function fetchPrices(typeIDs, hub = 'Jita', source = 'fuzzwork') {
  const ids = [...new Set(typeIDs.filter(id => id != null && id > 0))];
  if (!ids.length) return new Map();

  const cached = loadCache(hub, source) ?? new Map();
  const now = Date.now();
  const result = new Map(), needed = [];
  for (const id of ids) {
    const entry = cached.get(id);
    if (entry) result.set(id, entry.price);
    if (!entry || now - entry.ts > PRICE_TTL_MS) needed.push(id);
  }

  if (needed.length) {
    try {
      // Asked before anything is attempted, so a phone in a tunnel gets an instant honest answer
      // instead of a spinner and a 20-second wait for the deadline below.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw offlineError('No connection — market prices unavailable offline');
      }
      const region = HUB_REGIONS[hub] ?? HUB_REGIONS.Jita;
      const ctl = new AbortController();
      const fetched = await withDeadline(
        source === 'ceve' ? fetchCeve(needed, region, ctl.signal)
                          : fetchFuzzwork(needed, HUBS[hub] ?? HUBS.Jita, ctl.signal),
        BATCH_TIMEOUT_MS, ctl);
      const merged = new Map(cached);
      for (const [id, p] of fetched) { result.set(id, p); merged.set(id, { price: p, ts: now }); }
      saveCache(hub, source, merged);
    } catch (e) {
      // Whatever is already cached is returned regardless: losing the connection costs you the prices
      // you never had, not the ones you did. Only a lookup with nothing at all behind it is an error,
      // and it stays one so the caller can say "no prices" rather than quietly showing a fit as free.
      if (!result.size) throw e;
    }
  }

  return result;
}
