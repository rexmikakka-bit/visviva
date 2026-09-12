// The network half of the MutaMarket integration. `mutamarket.js` is pure — query building and
// conversion — and stays that way so the regression suite can exercise conversion against captured
// payloads with no npm install and no live service. Everything that touches the wire lives here.
//
// Two things about MutaMarket's pagination cost a debugging session if taken at face value:
//
//   1. `links.next` DROPS THE QUERY STRING. Page 1 of
//      `/modules/type/49738/.../sort/price/asc?region_id=10000002` comes back with
//      `links.next = "/api/modules/type/49738/.../sort/price/asc?cursor=..."` — the `region_id` is
//      gone. Following that link verbatim silently widens page 2 from The Forge to all of New Eden,
//      and nothing about the response says so. Verified: region_id genuinely filters (4 of 100 rows
//      on page 1 differ with it applied), so this is a real leak, not a no-op. The fix is to never
//      follow `links.next`: take `meta.next_cursor` and rebuild the URL from our own query.
//   2. The four contract-cleanliness segments are honoured, but only as a stack — 400 rows fetched
//      with all four applied contained zero auctions, bundles or multi-item contracts. They are
//      still re-checked on the response by `isIndividuallyPriced`, because trap 4 in `mutamarket.js`
//      means a future rename of any one of them would fail open rather than error.
import { MUTAMARKET_API, MUTAMARKET_USER_AGENT, mutaMarketQuery, mutaMarketListings, overBudget, withinBudget, matchesContractFilters } from './mutamarket.js';
import { networkJSON } from './network-request.js';

const PAGE_SIZE=100;

// mutamarket.com sends no CORS headers at all. The installed app does not care — CapacitorHttp has
// replaced global fetch by then, so the request never goes through the webview's origin checks — but
// a plain browser refuses it, which would make the whole market tab unreviewable on the dev server.
// `vite.config.js` proxies this prefix; nothing but a `npm run dev` browser session ever sees it.
const DEV_PROXY='/mutamarket-api';
function apiBase(){
  return (import.meta.env?.DEV&&typeof window!=='undefined'&&!window.Capacitor)?DEV_PROXY:MUTAMARKET_API;
}

async function fetchPage(path,signal){
  const {body}=await networkJSON(`${apiBase()}${path}`,{signal,headers:{'User-Agent':MUTAMARKET_USER_AGENT,Accept:'application/json'}});
  return {rows:body?.data??[],cursor:body?.meta?.next_cursor??null};
}

// `maxPages` is a hard stop, not a target: an unfiltered popular type runs to tens of thousands of
// rows and a phone on a station queue's connection should not be made to read all of them to show a
// comparison list. Hitting it sets `truncated`, so the UI can say the list is partial rather than
// letting it read as "that is everything on the market".
export async function fetchListings({typeId,attribute,metaGroup,regionId,maxPrice=null,minPrice=null,
  individuallyPriced=true,singleItem,showAuctions,maxPages=8,now=Date.now()}={},{signal,onProgress=()=>{},api={page:fetchPage}}={}){
  // Ascending price is not a display choice — it is what makes the budget ceiling cheap, by letting
  // the walk stop at the first row over budget instead of reading the rest of the type. The region
  // lives in the path `mutaMarketQuery` builds, and the cursor is appended to THAT, never taken from
  // `links.next` — see trap 1 above.
  const path=mutaMarketQuery({typeId,attribute,metaGroup,regionId,individuallyPriced,singleItem,showAuctions,sort:{by:'price',dir:'asc'}});
  const budget={maxPrice,minPrice};
  const listings=[],skipped=[];
  let cursor=null,page=0,truncated=false,stopped=false;
  while(page<maxPages){
    const result=await api.page(cursor?`${path}${path.includes('?')?'&':'?'}cursor=${encodeURIComponent(cursor)}`:path,signal);
    page++;
    const converted=mutaMarketListings(result.rows,now);
    skipped.push(...converted.skipped);
    for(const listing of converted.listings){
      if(overBudget(listing,budget)){stopped=true;break;}
      if(matchesContractFilters(listing,{individuallyPriced,singleItem,showAuctions})&&withinBudget(listing,budget))listings.push({...listing,regionId});
    }
    onProgress({stage:'listings',done:listings.length,page});
    if(stopped||!result.cursor||result.rows.length<PAGE_SIZE){cursor=null;break;}
    cursor=result.cursor;
  }
  if(cursor)truncated=true;
  return {listings,skipped,truncated};
}
