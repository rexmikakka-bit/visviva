import { useEffect, useState } from 'react';
import { readAbyssals, readListings } from './abyssal-store.js';

export function useAbyssalData(refreshKey){
  const [data,setData]=useState({owned:[],listings:[],loading:true,error:''});
  useEffect(()=>{
    let active=true;
    Promise.all([readAbyssals(),readListings()]).then(([owned,listings])=>{
      if(active)setData({owned,listings,loading:false,error:''});
    }).catch(e=>{if(active)setData({owned:[],listings:[],loading:false,error:e.message});});
    return()=>{active=false;};
  },[refreshKey]);
  return data;
}
