// MutaMarket (https://mutamarket.com) indexes every publicly contracted abyssal module in EVE and
// exposes it without a key or account. That removes the need for an Axis-hosted contract index:
// ESI has no server-side search by contained module type, so discovering listings ourselves would
// mean scanning every public contract, reading its contents and maintaining our own database.
//
// This file is PURE — query building and conversion only, no network. `mutamarket-client.js` does
// the fetching. Keeping them apart is what lets the regression suite exercise the conversion against
// captured payloads with no npm install and no live service.
//
// Five traps live here, each verified against the live API:
//
//   1. ONLY THE LAST `attributes/` SEGMENT IS APPLIED. Stacking two of them does not intersect and
//      does not error — it silently returns rows violating the earlier filter. Verified: asking for
//      missileDamageMultiplierBonus 1.13-1.20 AND cpu 0-35 returned rows with damage down at 1.0978.
//      `mutaMarketQuery` therefore takes ONE attribute filter; narrow further on-device.
//   2. `is_derived` / `is_virtual` attributes are MutaMarket's own computations, not EVE rolls
//      (their `dpsIncreaseMissiles` has the synthetic ID 5000004). Feeding them to the dogma engine
//      would invent or double-count bonuses, so they are dropped before conversion.
//   3. `public_asset.price` is 0.0 for any module that is not on a contract. It is NOT free, and a
//      zero here must never reach the UI as a price — see `listingPrice`.
//   4. AN UNRECOGNISED PATH SEGMENT IS SILENTLY IGNORED — 200, and the FULL unfiltered list.
//      `/modules/type/49738/bogus-segment-xyz` returns exactly what `/modules/type/49738` does. So a
//      typo in a segment name does not fail, it quietly widens the search. This is why the response
//      is re-checked against `isIndividuallyPriced` rather than trusted because the URL asked nicely.
//      THE `attributes/` SEGMENT IS THE EXCEPTION, and it fails the other way — see trap 6.
//   5. THERE IS NO SERVER-SIDE PRICE FILTER. `contract-price/0-30000000`, `price/0-30000000`,
//      `value/0-30000000` and `contract-price/min/0/max/30000000` were each fetched over 400 rows
//      sorted price-descending: all 400 exceeded the ceiling in every spelling, i.e. all four are
//      trap 4. A budget ceiling therefore has to be applied on device — see `withinBudget`. Sorting
//      ascending lets the client stop paging at the first row over budget instead of reading the
//      whole type, so the cost of doing it here rather than server-side is close to nothing.
//   6. THE `attributes/` SEGMENT FAILS CLOSED, BOTH WAYS, and is the only segment that does. An
//      unknown attribute name is a 400 `{"message":"Unknown attribute: notAnAttribute"}` — so a name
//      we made up does not widen the search like trap 4, it takes the whole market list down with an
//      error. And an INVERTED range is worse: `capacityBonus/2800-2600` is a 200 with `data: []`, so
//      a bound computed backwards silently reports that nothing is for sale. Both are why
//      `attrFilterFor` derives the name and the far bound from our own mutaplasmid data and returns
//      null rather than guessing. Verified on type 47808: `capacityBonus/2600-2800` returned 64 rows,
//      every one inside the range, against 100 rows spanning 1976–3024 unfiltered.
import { TYPES, ATTR_ID_TO_NAME } from '../calc.js';
import mutators from '../data/mutaplasmids.json' with { type: 'json' };
import { guessSlotFromDogma } from './core.js';
import { contractExpiry } from './shopping-list.js';

export function savedMarketListings(listings,{typeIds,regionId,stationId=null,maxPrice=null,individuallyPriced=true,singleItem,showAuctions,now=Date.now()}){
  return listings.filter(l=>{
    const expires=contractExpiry(l.expiresAt);
    return typeIds.includes(l.dynamicTypeId)&&l.contractId!=null&&expires!=null&&expires>now&&
      (l.regionId===regionId||(regionId===FORGE_REGION_ID&&l.stationId===JITA_4_4_STATION_ID))&&
      (stationId==null||l.stationId===stationId)&&matchesContractFilters(l,{individuallyPriced,singleItem,showAuctions})&&withinBudget(l,{maxPrice});
  });
}

export const MUTAMARKET_API='https://mutamarket.com/api';
// The public page for one module, e.g. /modules/abyssal-warp-disruptor-1055169244217. It is the
// fallback for opening a contract when no character has granted the in-game window scope, and the
// only route at all on a machine with no EVE client — so it is built from the slug the API returns
// rather than assembled from the name, which would guess wrong on every duplicate.
export function mutaMarketUrl(slug){return slug?`https://mutamarket.com/modules/${encodeURIComponent(slug)}`:null;}
// The Forge / Jita 4-4. MutaMarket filters contracts by REGION only — its contract payload carries
// no station — so pinning to Jita 4-4 needs the ESI join in `mutamarket-contracts.js`.
export const FORGE_REGION_ID=10000002;
export const JITA_4_4_STATION_ID=60003760;

// MutaMarket asks callers to identify themselves with a contact address.
export const MUTAMARKET_USER_AGENT='Axis EVE fitting tool (rexmikakka@gmail.com)';

// Segments restricting the list to ONE abyssal module priced on its own. A contract holding a
// second module, other items or PLEX has a single price for the whole bundle, and showing that as
// this module's price would overstate what the module costs.
const INDIVIDUAL_SEGMENTS=['contracts-only','item-exchange','no-multi-item-contracts','without-other-items'];
const SORT_FIELDS=new Set(['price','value','fraction','contract-date','date-added']);
const ATTR_NAME_OK=/^[A-Za-z][A-Za-z0-9]*$/;

export function mutaMarketTypeIds(){return new Set(Object.values(mutators).map(m=>m.r));}

// MutaMarket indexes the ABYSSAL result type, not the base module: Gravid, Unstable and Decayed
// webifier mutaplasmids all produce one "Abyssal Stasis Webifier". A variant family can still span
// several result types (an family holding both a web and a scram would), so this returns a list.
const ABYSSAL_TYPE_BY_BASE=new Map();
for(const m of Object.values(mutators))for(const base of m.t??[]){
  if(!Number.isInteger(m.r))continue;
  if(!ABYSSAL_TYPE_BY_BASE.has(base))ABYSSAL_TYPE_BY_BASE.set(base,new Set());
  ABYSSAL_TYPE_BY_BASE.get(base).add(m.r);
}
export function abyssalTypeIds(typeIds){
  const out=new Set();
  for(const id of typeIds??[])for(const r of ABYSSAL_TYPE_BY_BASE.get(Number(id))??[])out.add(r);
  return [...out].sort((a,b)=>a-b);
}

function range(value){
  const parts=Array.isArray(value)?value:[value];
  if(parts.some(v=>typeof v!=='number'||!Number.isFinite(v)))throw new Error('Filter bounds must be finite numbers');
  return parts.length>1?`${parts[0]}-${parts[1]}`:String(parts[0]);
}

// Builds the request path. `attribute` is deliberately singular — see trap 1 above. There is no
// price option on purpose: every spelling of one is trap 5, so a budget belongs in `withinBudget`.
export function mutaMarketQuery({typeId,individuallyPriced=true,singleItem,showAuctions,attribute,metaGroup,sort,regionId}={}){
  if(!Number.isInteger(typeId))throw new Error('A MutaMarket query needs an abyssal type ID');
  const segments=[`type/${typeId}`];
  if(singleItem!==undefined){
    segments.push('contracts-only');
    if(!showAuctions)segments.push('item-exchange');
    if(singleItem)segments.push('no-multi-item-contracts','without-other-items');
  }else if(individuallyPriced)segments.push(...INDIVIDUAL_SEGMENTS);
  if(metaGroup)segments.push(`meta-group/${metaGroup}`);
  if(attribute){
    if(Array.isArray(attribute))throw new Error('MutaMarket applies only one attribute filter per request; filter the rest on device');
    segments.push(`attributes/${attribute.name}/${range(attribute.value)}`);
  }
  if(sort){
    const by=sort.by??'price';
    if(!SORT_FIELDS.has(by)&&!Number.isInteger(Number(by))&&!ATTR_NAME_OK.test(by))throw new Error(`Unsupported MutaMarket sort field: ${by}`);
    segments.push(`sort/${by}/${sort.dir==='desc'?'desc':'asc'}`);
  }
  const query=regionId?`?region_id=${regionId}`:'';
  return `/modules/${segments.join('/')}${query}`;
}

// ── Spending the one attribute filter ───────────────────────────────────────────────────────────
// The walk in `fetchListings` reads at most 800 rows, cheapest first. On a popular type that is not
// everything, and what it leaves out is systematic rather than random: good rolls cost more, so the
// rows it never reaches are exactly the ones someone sorting by an attribute is looking for. The
// list then answers "here are the 800 cheapest" to a question that asked "here are the best".
//
// One `attributes/` range per request is all MutaMarket allows (trap 1), so it goes to the attribute
// the user is SORTING by, bounded at the fitted module's own value on the side the sort points at.
// The useful property is that this cannot change the top of the list: sorting descending puts the
// biggest values first, and the rows dropped are the ones below the fitted module — at the far end,
// past where anyone scrolls. It spends the page budget on rows that will be reached.

/** The legal span of one rolled attribute on an abyssal type, in RAW dogma units. */
export function abyssalAttrSpan(abyssalTypeId,attrName){
  let min=Infinity,max=-Infinity;
  for(const m of Object.values(mutators)){
    if(m.r!==Number(abyssalTypeId))continue;
    for(const [aid,bounds] of Object.entries(m.a??{})){
      if(ATTR_ID_TO_NAME[aid]!==attrName)continue;
      const [lo,hi]=bounds;
      for(const base of m.t??[]){
        const td=TYPES[base]??TYPES[String(base)];
        const b=(td?.attrs??td?.a??{})[attrName];
        if(typeof b!=='number'||!Number.isFinite(b)||typeof lo!=='number'||typeof hi!=='number')continue;
        // `lo`/`hi` are MULTIPLIERS, so a negative base — a web's speedFactor, a cap battery's
        // resistance bonus — swaps which end of the product is the minimum. Same reason
        // `mutaAttrRanges` in core.js sorts the pair rather than trusting the order.
        min=Math.min(min,b*lo,b*hi);max=Math.max(max,b*lo,b*hi);
      }
    }
  }
  // Nothing rolls it. A NAME rather than a range is what matters here: it is the gate that keeps an
  // invented attribute out of the URL, and trap 6 makes that a 400 rather than a wider search.
  return min<=max?{min,max}:null;
}

// The far bound is padded outward by 1% of the span. Our bound is `base*multiplier` and MutaMarket's
// is whatever CCP rolled and MutaMarket stored, and the two agreeing to the last bit is not something
// to bet the single best roll on the market on — which is precisely the row an exact bound would drop.
const SPAN_PAD=0.01;

/**
 * The half of a rolled attribute's span that a sort is pointing at, as a `mutaMarketQuery` filter.
 *
 * `keepHigh` is the direction in RAW units — the caller owns undoing any display transform, since
 * a resist bonus is stored negative and shown positive and only the caller knows which it is holding.
 * Returns null whenever there is nothing to narrow, so "no filter" is always the failure mode: an
 * anchor past the far end would otherwise build the inverted range of trap 6 and report an empty
 * market, which is the one wrong answer that looks like a real one.
 */
export function attrFilterFor({abyssalTypeId,name,anchor,keepHigh}){
  const span=abyssalAttrSpan(abyssalTypeId,name);
  if(!span||typeof anchor!=='number'||!Number.isFinite(anchor))return null;
  const pad=(span.max-span.min)*SPAN_PAD;
  const [lo,hi]=keepHigh?[anchor,span.max+pad]:[span.min-pad,anchor];
  // `<=` because an anchor at or outside the span narrows nothing: one end is already the whole
  // range, and the request would cost a segment to ask for everything.
  if(!(lo<hi)||(keepHigh?anchor<=span.min:anchor>=span.max))return null;
  // Rounded OUTWARD, and only ever outward: `base*multiplier` in binary floating point produces
  // tails like 3737.2750000000005, which would go into the URL verbatim. Widening by a ten-thousandth
  // can admit a row; narrowing by one could drop the single best roll, which is the row this whole
  // filter exists to reach.
  return {name,value:[Math.floor(lo*1e4)/1e4,Math.ceil(hi*1e4)/1e4]};
}

export function contractItemCount(contract){
  return (contract?.abyssal_modules_count??0)+(contract?.non_abyssal_modules_count??0)+(contract?.plex_count??0);
}

// What KIND of number `contract.price` is — a different question from how big it is, and the one
// that decides whether the number may be called this module's price at all.
//
//   'ask'    an item exchange holding this module and nothing else. Pay it and the module is yours.
//   'bid'    an auction. You pay at LEAST that, possibly far more, and not until it closes.
//   'bundle' anything else on the contract. The number buys the whole pile; this module's share of
//            it is unknowable, not merely unknown.
//
// `asking_for_items` is none of the three — it is a want-to-buy, so there is nothing to purchase.
// MutaMarket's filter segments already ask for clean contracts, but this is applied again on the
// response: trap 4 means a renamed segment fails open, and the price is the one number a user would
// spend real ISK against.
export function contractKind(contract){
  if(!contract||contract.asking_for_items)return null;
  if(contract.type==='auction')return 'bid';
  if(contract.type!=='item_exchange')return null;
  return contract.abyssal_modules_count===1&&contractItemCount(contract)===1?'ask':'bundle';
}

export function isIndividuallyPriced(contract){return contractKind(contract)==='ask';}

// Independent dimensions: an auction may itself hold either one item or a bundle.
// Recheck responses because unknown API segments can fail open.
export function matchesContractFilters(listing,{individuallyPriced=true,singleItem,showAuctions}={}){
  if(singleItem===undefined)return !individuallyPriced||listing.contractKind==='ask';
  return ['ask','bid','bundle'].includes(listing.contractKind)&&
    (showAuctions||listing.contractKind!=='bid')&&
    (!singleItem||listing.contractItems===1);
}

// What the CONTRACT costs, whatever kind of number that is. `public_asset.price` is 0.0 for
// anything not contracted, so a non-positive number here is absence, not free.
export function contractCost(contract){
  const price=contract?.price;
  return contractKind(contract)&&typeof price==='number'&&Number.isFinite(price)&&price>0?price:null;
}

// The only honest price is a real one from a clean contract. `estimated_value` is MutaMarket's
// model, not an asking price — it is returned separately so the UI can label it rather than pass it
// off as a price.
export function listingPrice(module){
  return isIndividuallyPriced(module?.contract)?contractCost(module.contract):null;
}

// Convert one MutaMarket module into the same record shape the owned library uses, so the existing
// comparison rows can hold owned rolls and listings side by side. `id` IS the EVE item_id, the same
// key space as an imported asset — which is what lets a listing be recognised as a module you
// already own rather than offered as a second copy of it.
export function mutaMarketListing(module,now=Date.now()){
  const sourceId=module?.source_type?.id,base=TYPES[sourceId],plasmid=mutators[String(module?.mutaplasmid?.id)];
  if(!base||base.c!==7)throw new Error('Unknown source module. Update Axis game data.');
  if(!plasmid||!plasmid.t.includes(sourceId)||plasmid.r!==module?.type?.id)
    throw new Error('Unsupported mutaplasmid for this module. Update Axis game data.');
  const mutations={};
  for(const attr of module.mutated_attributes??[]){
    if(attr.is_derived||attr.is_virtual)continue;   // MutaMarket's own maths, not an EVE roll
    const name=ATTR_ID_TO_NAME[attr.id];
    if(!name||typeof attr.value!=='number'||!Number.isFinite(attr.value))throw new Error(`Missing rolled attribute ${attr.id}`);
    mutations[name]=attr.value;
  }
  const expected=Object.keys(plasmid.a).map(id=>ATTR_ID_TO_NAME[id]).filter(Boolean);
  for(const name of expected)if(!(name in mutations))throw new Error(`Missing rolled attribute ${name}`);
  if(Object.keys(mutations).length!==expected.length)throw new Error('Unexpected rolled attributes');
  // Identity is kept for an auction and a bundle too, because the contract is genuinely where this
  // module is and the link to it is the whole reason to show the row. Only the PRICE is withheld —
  // `price` stays null unless the number is an asking price, so everything reading it to answer
  // "what is this module worth" (the shopping list, the fit total) keeps getting the honest answer.
  const kind=contractKind(module.contract),contract=kind?module.contract:null;
  return {source:'mutamarket',itemId:String(module.id),dynamicTypeId:module.type.id,typeID:sourceId,
    name:base.n,mutaplasmid:module.mutaplasmid.id,mutations,slot:guessSlotFromDogma(sourceId),
    price:listingPrice(module),estimatedValue:typeof module.estimated_value==='number'?module.estimated_value:null,
    cost:contractCost(module.contract),contractKind:kind,contractItems:contract?contractItemCount(contract):0,
    contractId:contract?.id??null,sellerName:contract?.issuer?.name??null,
    expiresAt:contract?.date_expired??null,stationId:null,slug:module.slug??null,lastSeen:now};
}

// The number a ceiling measures a listing against: the asking price when there is one, and failing
// that what the whole contract costs. A bid and a bundle total are not this module's price — see
// `contractKind` — but they ARE what leaves your wallet, so a ceiling has something real to compare
// them to. It is also the field MutaMarket sorts the page by, which is what keeps the ascending walk
// in `fetchListings` able to stop early.
export function listingCost(listing){
  const n=listing?.price??listing?.cost;
  return typeof n==='number'&&Number.isFinite(n)?n:null;
}

// The budget ceiling, applied on device because the API has none (trap 5). A listing with no cost at
// all is NOT under the ceiling — it is unpriced, which is a different thing, and the same rule
// `stationOf` applies to an unresolved station: unknown is never folded into a match. Without a
// ceiling every listing passes, unpriced ones included, because then nothing is being claimed.
export function withinBudget(listing,{maxPrice=null,minPrice=null}={}){
  if(maxPrice==null&&minPrice==null)return true;
  const price=listingCost(listing);
  if(price==null)return false;
  return (maxPrice==null||price<=maxPrice)&&(minPrice==null||price>=minPrice);
}

export function filterListings(listings,budget={}){
  return (listings??[]).filter(l=>withinBudget(l,budget));
}

// Sorted ascending by price, the first listing over the ceiling means every later one is too, so the
// client can stop paging instead of reading the whole type. Only valid for an ascending price sort —
// the caller owns that, and passes `false` for any other ordering.
export function overBudget(listing,{maxPrice=null}={}){
  const price=listingCost(listing);
  return maxPrice!=null&&price!=null&&price>maxPrice;
}

// A page that fails to convert must not take the whole page down: CCP ships new mutaplasmids before
// our bundle is regenerated, and one unknown type should cost that row, not the listing screen.
export function mutaMarketListings(modules,now=Date.now()){
  const listings=[],skipped=[];
  for(const module of modules??[]){
    try{listings.push(mutaMarketListing(module,now));}
    catch(e){skipped.push({id:String(module?.id??'?'),message:e.message});}
  }
  return {listings,skipped};
}
