#!/usr/bin/env node
/**
 * mutamarket-check.mjs — re-verify the MutaMarket integration against the LIVE service.
 *
 *     node scripts/mutamarket-check.mjs [typeId] [maxPriceISK]
 *
 * The regression suite exercises conversion against a captured payload, which is what makes it run
 * with no network and no npm install. That leaves one class of failure it cannot see: MutaMarket
 * changing what a URL means. This script covers exactly that gap, and is not part of `npm run
 * verify` because it needs the internet and an unrelated outage should not fail CI.
 *
 * It exists because of trap 4 in src/lib/mutamarket.js: AN UNRECOGNISED PATH SEGMENT IS SILENTLY
 * IGNORED. `/modules/type/49738/bogus-segment-xyz` returns 200 and the FULL unfiltered list. So if
 * MutaMarket ever renames `no-multi-item-contracts`, nothing errors — auctions and bundles just
 * start appearing, with their bundle price shown as the price of one module. The segment probe below
 * is the only thing that would catch it.
 */
import { fetchListings } from '../src/lib/mutamarket-client.js';
import { MUTAMARKET_API, MUTAMARKET_USER_AGENT, FORGE_REGION_ID, JITA_4_4_STATION_ID, isIndividuallyPriced } from '../src/lib/mutamarket.js';
import { fetchContractIndex, withStations } from '../src/lib/mutamarket-contracts.js';

const TYPE = Number(process.argv[2] ?? 49738);
const MAX = process.argv[3] ? Number(process.argv[3]) : null;
let failures = 0;
const ok = (pass, label) => { console.log(`  ${pass ? 'OK  ' : 'FAIL'}  ${label}`); if (!pass) failures++; };

async function raw(path) {
  const r = await fetch(`${MUTAMARKET_API}/modules/type/${TYPE}${path}`, { headers: { 'User-Agent': MUTAMARKET_USER_AGENT } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${path}`);
  return (await r.json()).data ?? [];
}

// Sorted price-DESCENDING, because the expensive end is where an unclean contract or a price ceiling
// has to bite. Four pages is enough to contain unclean rows: an unfiltered sample of 400 held 27
// multi-item contracts and 19 carrying other items.
async function pages(path, n = 4) {
  const out = [];
  let cursor = null;
  for (let i = 0; i < n; i++) {
    const rows = await raw(`${path}/sort/price/desc${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
    out.push(...rows);
    if (rows.length < 100) break;
    // Re-derived per page rather than kept, so this mirrors what the client does.
    const r = await fetch(`${MUTAMARKET_API}/modules/type/${TYPE}${path}/sort/price/desc${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { headers: { 'User-Agent': MUTAMARKET_USER_AGENT } });
    cursor = (await r.json()).meta?.next_cursor;
    if (!cursor) break;
  }
  return out;
}

console.log(`\nMutaMarket live check — type ${TYPE}\n`);

console.log('1. the four contract-cleanliness segments, as a stack');
const CLEAN = '/contracts-only/item-exchange/no-multi-item-contracts/without-other-items';
const dirty = await pages('');
const clean = await pages(CLEAN);
const unclean = clean.filter((m) => m.contract && !isIndividuallyPriced(m.contract));
ok(dirty.filter((m) => m.contract && !isIndividuallyPriced(m.contract)).length > 0, `the unfiltered sample contains unclean contracts (else this proves nothing)`);
ok(unclean.length === 0, `${clean.length} filtered rows contain 0 auctions/bundles (found ${unclean.length})`);

console.log('\n2. trap 4 — an unknown segment is ignored, not rejected');
const bogus = await raw('/bogus-segment-xyz');
const plain = await raw('');
ok(bogus.length === plain.length, 'an invented segment still returns a full page (documented behaviour)');

console.log('\n3. trap 5 — no spelling of a price filter is honoured');
for (const seg of ['/contract-price/0-30000000', '/price/0-30000000', '/value/0-30000000', '/contract-price/min/0/max/30000000']) {
  const rows = await pages(seg, 1);
  const over = rows.filter((m) => m.contract?.price > 30_000_000).length;
  ok(over > 0, `${seg} is ignored, so the ceiling stays ours (${over}/${rows.length} over)`);
}

console.log('\n4. the client, end to end');
const t0 = Date.now();
const { listings, skipped, truncated } = await fetchListings({ typeId: TYPE, regionId: FORGE_REGION_ID, maxPrice: MAX });
console.log(`     ${listings.length} listings, ${skipped.length} skipped, truncated=${truncated}, ${Date.now() - t0}ms`);
ok(skipped.length === 0, `every row converted (${skipped.length} skipped${skipped.length ? `: ${skipped[0].message}` : ''})`);
ok(listings.every((l) => l.contractId != null && l.price > 0), 'every listing carries a real contract and a real price');
if (MAX != null) ok(listings.every((l) => l.price <= MAX), `the device-side ceiling holds (max ${Math.max(...listings.map((l) => l.price)).toLocaleString()})`);

console.log('\n5. the ESI station join');
const index = await fetchContractIndex(FORGE_REGION_ID, {});
const located = withStations(listings, index);
const jita = located.filter((l) => l.stationId === JITA_4_4_STATION_ID);
console.log(`     ${index.index.size} Forge contracts indexed; ${jita.length}/${listings.length} at Jita 4-4, ${located.filter((l) => l.stationId == null).length} unresolved`);
ok(located.filter((l) => l.stationId == null).length / (listings.length || 1) < 0.2, 'most contracts resolve to a station (a high miss rate means the ID spaces diverged)');
ok(jita.length < listings.length, 'the station filter does real work — some Forge listings are NOT at Jita 4-4');

console.log(failures ? `\n${failures} CHECK(S) FAILED\n` : '\nall live checks passed\n');
process.exit(failures ? 1 : 0);
