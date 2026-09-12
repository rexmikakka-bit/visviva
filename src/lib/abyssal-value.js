import { abyssalProvenance, OWNED, BUYABLE, EXPIRED } from './shopping-list.js';
import { MANUAL_OWNER } from './abyssal-library.js';

// Estimates, auction bids and bundle totals never become the value of one module.
export function abyssalValue(mod,data={}){
  const {record,listing,state}=abyssalProvenance(mod?.abyssalItemId,data);
  if(state===OWNED)return {price:null,source:record.characterId===MANUAL_OWNER?'custom':'owned'};
  if(state===BUYABLE&&typeof listing.price==='number'&&Number.isFinite(listing.price)&&listing.price>0)
    return {price:listing.price,source:'ask'};
  return {price:null,source:state===EXPIRED?'expired':'unknown'};
}
