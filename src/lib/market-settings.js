import { FORGE_REGION_ID, JITA_4_4_STATION_ID } from './mutamarket.js';

// Validated on read rather than trusted, the same way VAR_SORT_KEY is: this is a single JSON blob in
// localStorage, and a hand-edited or half-migrated value must not be able to put a NaN ceiling into a
// price comparison — `price <= NaN` is false for everything, so a bad number here would silently
// empty the market list rather than fail.
export const MARKET_KEY='axis_market';

// A ceiling is on by DEFAULT and deliberately not "no limit". The compare tab exists to answer "what
// else could go in this slot", and an unbounded abyssal market answers it with 300B ISK collector
// pieces — technically listings, useless as alternatives. 250M is high enough to leave the ordinary
// market visible and low enough to drop the outliers; it is a starting point, not a claim, which is
// why it is the first thing the sheet shows.
//
// `showAbyssals` and `sources` live here too, so they survive closing a module. They still DEFAULT to
// off / owned-only: "off by default" is a statement about a fresh install, not a rule that the
// triangle must be re-tapped on every module you open. Once you have said you are shopping for
// rolls, asking again on the next module is just friction.
//
// `fitsOnly` is the same kind of setting and lives here for the same reason, even though it has
// nothing to do with the market: it is a statement about the ship, not about the module you happen
// to have open. It defaults OFF because it can only ever hide rows, and a list that silently omitted
// the variant you were looking for would be read as "that module does not exist".
//
// `allContracts` admits auctions and multi-item contracts. It defaults OFF because their price is a
// bid or a bundle total rather than this module's price, and a wrong number shown without comment is
// worse than a shorter list. It is a setting rather than a permanent exclusion because the listings
// themselves are real — that IS where the roll is — so the honest fix was to label them, not to
// pretend they do not exist. `contractKind` carries the label and the row badges it.
export const MARKET_DEFAULTS={maxPrice:250_000_000,jitaOnly:true,regionId:FORGE_REGION_ID,
  showAbyssals:false,sources:['owned'],fitsOnly:false,allContracts:false};

// A container source is a JSON pair keyed by character and location, so any non-empty string is
// structurally valid here. A source naming a character who has since been disconnected simply
// matches nothing, which the sheet already shows as an empty list rather than an error.
//
// EMPTY IS A REAL ANSWER and survives the round trip — it means "no abyssal rolls", which the sheet
// says out loud. Only an ABSENT field falls back to the default, so unticking the last source is not
// silently undone the next time the settings are read.
//
// A legacy single `source` string is lifted into a one-element list. `axis_market` is a settings blob
// validated on every read rather than a saved-fit shape, so this is the migration — there is nothing
// for storage-migrate.js to do.
function normalizeSources(raw){
  const list=Array.isArray(raw?.sources)?raw.sources
    :typeof raw?.source==='string'&&raw.source?[raw.source]:null;
  if(!list)return [...MARKET_DEFAULTS.sources];
  return [...new Set(list.filter(s=>typeof s==='string'&&s))];
}

export function normalizeMarketSettings(raw){
  const max=Number(raw?.maxPrice);
  return {maxPrice:Number.isFinite(max)&&max>0?max:(raw?.maxPrice===null?null:MARKET_DEFAULTS.maxPrice),
    jitaOnly:raw?.jitaOnly!==false,
    regionId:Number.isInteger(raw?.regionId)?raw.regionId:MARKET_DEFAULTS.regionId,
    showAbyssals:raw?.showAbyssals===true,
    fitsOnly:raw?.fitsOnly===true,
    allContracts:raw?.allContracts===true,
    sources:normalizeSources(raw)};
}

// ── The ceiling slider's scale ───────────────────────────────────────────────
// LOGARITHMIC, because the useful range spans two and a half orders of magnitude. On a linear track
// half the travel would be spent between 2.5B and 5B — a stretch nobody narrows — and every ceiling
// worth setting would be crammed into the first two percent, where a fingertip covers 200M.
//
// The LAST stop is "no limit", not 5B. A ceiling is the one setting here that can silently empty the
// list, so turning it off has to be reachable by dragging the way you would expect, rather than
// hidden behind a separate control.
// One per line: check-imports.mjs reads exports by regex and only sees the first declarator of a
// comma-separated `export const`.
export const PRICE_MIN=10_000_000;
export const PRICE_MAX=5_000_000_000;
// 60 stops, not 200. The snapping below is what sets the floor: two significant figures near the
// start of a decade means 10M, 11M, 12M, and a track fine enough to ask for 10.6M would have several
// stops that round to the same ceiling — which makes the thumb jump backwards under a dragging
// finger, because there is no longer one stop per value.
export const PRICE_STOPS=60;

export function priceAtStop(stop){
  if(!(stop<PRICE_STOPS))return null;
  const f=Math.max(stop,0)/(PRICE_STOPS-1);
  const raw=PRICE_MIN*Math.pow(PRICE_MAX/PRICE_MIN,f);
  // Two significant figures, and part of the SCALE rather than a display choice: the stored ceiling
  // has to be the number printed beside it, or the typed field and the thumb disagree by a few
  // million forever and neither looks wrong on its own.
  const mag=Math.pow(10,Math.floor(Math.log10(raw))-1);
  return Math.round(raw/mag)*mag;
}

// Nearest stop by scanning the whole track rather than inverting the log: priceAtStop snaps, so the inverse
// of a snapped value can land one stop off, and the thumb would jump backwards under your finger.
export function stopAtPrice(value){
  if(value==null)return PRICE_STOPS;
  let best=0,bestGap=Infinity;
  for(let s=0;s<PRICE_STOPS;s++){
    const gap=Math.abs(priceAtStop(s)-value);
    if(gap<bestGap){bestGap=gap;best=s;}
  }
  return best;
}

// "300m", "1.2b", "300,000,000". A bare number is ISK, matching what MutaMarket and the contract
// window print; the suffixes exist because nobody types nine digits on a phone.
//
// Three-valued on purpose. `null` is a real answer — an empty field means no ceiling — so garbage
// cannot also be null, or a typo would silently switch the market to unlimited. `undefined` means
// "this is not a number, leave the setting alone".
export function parsePriceInput(text){
  const s=String(text??'').trim().toLowerCase().replace(/[\s,_]/g,'').replace(/isk$/,'');
  if(!s)return null;
  const m=/^(\d+(?:\.\d+)?)([kmb])?$/.exec(s);
  if(!m)return undefined;
  const value=Number(m[1])*({k:1e3,m:1e6,b:1e9}[m[2]]??1);
  if(!Number.isFinite(value)||value<=0)return null;
  // Clamped to the slider's own range so the two controls can never print different numbers. The
  // way past 5B is "Any", which the track's last stop already offers.
  return Math.min(Math.max(value,PRICE_MIN),PRICE_MAX);
}

export function marketStationId(settings){
  return settings.jitaOnly?JITA_4_4_STATION_ID:null;
}

export function readMarketSettings(storage=globalThis.localStorage){
  try{return normalizeMarketSettings(JSON.parse(storage?.getItem(MARKET_KEY)??'null'));}
  catch{return normalizeMarketSettings(null);}   // private mode, or a value someone edited by hand
}

export function writeMarketSettings(settings,storage=globalThis.localStorage){
  const next=normalizeMarketSettings(settings);
  try{storage?.setItem(MARKET_KEY,JSON.stringify(next));}catch{/* private mode */}
  return next;
}
