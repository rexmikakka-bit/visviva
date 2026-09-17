import { useEffect, useMemo, useState } from 'react';
import { readAbyssals, readListings } from './abyssal-store.js';
import { fittedAbyssalIds } from './variation-items.js';

// Keyed on the fit's abyssal item ids rather than on the fit. Neither read takes an argument — the
// whole library comes back either way — so the key exists only to catch a module that has just been
// given a roll. Keyed on `slots` it also fires on every state change, and each one then costs two
// full store scans plus a second pass over the whole fit before the numbers settle.
export function useAbyssalData(slots){
  const key=useMemo(()=>[...fittedAbyssalIds(slots)].sort().join(','),[slots]);
  const [data,setData]=useState({owned:[],listings:[],loading:true,error:''});
  useEffect(()=>{
    let active=true;
    Promise.all([readAbyssals(),readListings()]).then(([owned,listings])=>{
      if(active)setData({owned,listings,loading:false,error:''});
    }).catch(e=>{if(active)setData({owned:[],listings:[],loading:false,error:e.message});});
    return()=>{active=false;};
  },[key]);
  return data;
}
