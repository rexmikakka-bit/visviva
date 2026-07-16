// Market price fetching via Fuzzwork aggregates API.
// Prices are sell-percentile, matching pyfa's default.
// Results are cached in localStorage per hub with a 1-hour TTL.

const HUBS = {
  Jita:    60003760,
  Amarr:   60008494,
  Dodixie: 60011866,
  Rens:    60004588,
  Hek:     60005686,
};

export const MARKET_HUBS = Object.keys(HUBS);

const CACHE_TTL_MS = 60 * 60 * 1000;

function cacheKey(hub) { return `visviva_price_${hub}`; }

function loadCache(hub) {
  try {
    const raw = localStorage.getItem(cacheKey(hub));
    if (!raw) return null;
    const { ts, prices } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL_MS) return null;
    return new Map(Object.entries(prices).map(([k, v]) => [Number(k), v]));
  } catch { return null; }
}

function saveCache(hub, priceMap) {
  const prices = {};
  for (const [id, price] of priceMap) prices[id] = price;
  try { localStorage.setItem(cacheKey(hub), JSON.stringify({ ts: Date.now(), prices })); } catch {}
}

export function getCachedPrices(hub = 'Jita') { return loadCache(hub) ?? new Map(); }

export async function fetchPrices(typeIDs, hub = 'Jita') {
  const ids = [...new Set(typeIDs.filter(id => id != null && id > 0))];
  if (!ids.length) return new Map();

  const cached = loadCache(hub);
  const needed = cached ? ids.filter(id => !cached.has(id)) : ids;
  const result = new Map();

  if (cached) {
    for (const id of ids) if (cached.has(id)) result.set(id, cached.get(id));
  }

  if (needed.length) {
    const station = HUBS[hub] ?? HUBS.Jita;
    const url = `https://market.fuzzwork.co.uk/aggregates/?types=${needed.join(',')}&station=${station}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    for (const [id, info] of Object.entries(data)) {
      const price = parseFloat(info?.sell?.percentile ?? 0);
      if (price > 0) result.set(Number(id), price);
    }
    saveCache(hub, cached ? new Map([...cached, ...result]) : new Map(result));
  }

  return result;
}
