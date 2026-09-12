// What a fit would COST to actually assemble: every abyssal module in it that came off a contract
// rather than out of your hangar, with the contract still attached so it can be opened in the client.
//
// The whole point is that this survives the session. A fit slot remembers only `abyssalItemId` — the
// EVE item id — which is enough to identify the physical module but says nothing about where to buy
// it. The contract, seller, price and expiry come from the listing cache, which is written when a
// listing is chosen. So this file is a JOIN, and its interesting cases are all joins that fail:
//
//   * The module is one you OWN. Not a purchase. It is still listed, because a shopping list that
//     silently omitted half the abyssals in the fit would read as "this is all you need".
//   * The item id resolves to no cached listing. That is not "free" and not "owned" — it is a module
//     whose origin we no longer know, and it has to say so.
//   * The contract has EXPIRED. The row still exists (you still need that module) but the link is
//     dead and the price is no longer an offer. Folding an expired price into the total would put a
//     number on the screen that nobody can pay.
//
// Only the rows with a live contract are summed. `total` is what you can spend right now.
// One per line: check-imports.mjs reads exports by regex and only sees the first declarator of a
// comma-separated `export const`, so importing the others is reported as a missing export.
export const UNKNOWN='unknown';
export const OWNED='owned';
export const EXPIRED='expired';
export const BUYABLE='buyable';

// MutaMarket dates arrive as "2026-10-05 06:02:06+00", which is NOT ISO 8601 twice over: the space
// should be a "T", and "+00" should be "+00:00". `Date.parse` returns NaN for it. That matters more
// than it looks — a NaN expiry is not an error anywhere downstream, it just makes every contract
// compare as live forever, so the dead links are the ones you would drive to Jita for.
export function contractExpiry(value){
  if(typeof value!=='string')return null;
  const ms=Date.parse(value.trim().replace(' ','T').replace(/([+-]\d{2})$/,'$1:00'));
  return Number.isFinite(ms)?ms:null;
}

// Everything the app knows about ONE roll, from the only two stores that know anything: the owned
// library and the listing cache. Both are keyed by the EVE item id, which is why a listing can be
// recognised as a module you already have rather than offered as a second copy of it.
//
// OWNED wins over a live contract deliberately. If it is in your hangar it is not a purchase, whatever
// the market still says about the contract it came off — and the alternative would put a price and a
// "buy" button on a module you are already flying.
//
// `record` and `listing` come back whole rather than flattened into a dozen fields, because the two
// callers want different halves of them: the shopping list needs the contract, the info sheet needs
// the provenance. What is NOT left to the caller is the four-way state and the expiry parse — those
// are the parts that were wrong twice, and having one answer is the point of the shared join.
export function abyssalProvenance(itemId,{owned=[],listings=[],now=Date.now()}={}){
  const id=String(itemId??'');
  const record=owned.find(r=>String(r.itemId)===id)??null;
  const listing=listings.find(l=>String(l.itemId)===id)??null;
  const expiresAt=contractExpiry(listing?.expiresAt);
  const dead=!listing||listing.contractId==null||(expiresAt!=null&&expiresAt<=now);
  return {itemId:id,record,listing,expiresAt,
    state:record?OWNED:!listing?UNKNOWN:dead?EXPIRED:BUYABLE};
}

function fittedModules(slots){
  const seen=new Set(),out=[];
  for(const [slot,value] of Object.entries(slots??{})){
    for(const mod of Array.isArray(value)?value:[value]){
      // A unique physical item cannot be in two slots, so a repeat is a bug upstream, not a second
      // purchase — counting it twice would overstate the bill.
      if(!mod?.abyssalItemId||seen.has(mod.abyssalItemId))continue;
      seen.add(mod.abyssalItemId);
      out.push({slot,mod});
    }
  }
  return out;
}

export function shoppingList(slots,listings=[],{owned=[],now=Date.now()}={}){
  const rows=fittedModules(slots).map(({slot,mod})=>{
    const {itemId,listing,record,expiresAt,state}=abyssalProvenance(mod.abyssalItemId,{owned,listings,now});
    // The fit itself is the only place that knows what an unlisted module is called.
    const name=listing?.name??mod.name??null;
    if(state===OWNED||state===UNKNOWN)return {itemId,slot,name,state,price:null,contractId:null,...(record?.manual?{custom:true}:{})};
    return {itemId,slot,name,state,price:listing.price??null,
      contractId:listing.contractId??null,sellerName:listing.sellerName??null,
      stationId:listing.stationId??null,slug:listing.slug??null,expiresAt};
  });
  const buyable=rows.filter(r=>r.state===BUYABLE);
  return {rows,
    total:buyable.reduce((sum,r)=>sum+(r.price??0),0),
    // Split out rather than left for the caller to recount, because these are the three sentences
    // the screen has to be able to say: what you can buy, what you already have, what it cannot price.
    buyable:buyable.length,
    owned:rows.filter(r=>r.state===OWNED).length,
    unresolved:rows.filter(r=>r.state===UNKNOWN||r.state===EXPIRED).length};
}
