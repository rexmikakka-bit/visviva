import { useState, useEffect, useMemo, useRef } from "react";
import { calcFitStats, computeCommandBursts, computeProjectedReps, projectionResistances, applyRemoteRepDiminishing, calcRangeFactor, stackingPenalty, checkFitSkills, SKILL_DEFAULTS, TYPES, tidByName, isT3Cruiser, T3C_SUBSYSTEM_GROUPS } from "./calc.js";
import { SAVED_FITS_SEED, GLOBAL_CSS, _bundleListeners, _bundleReady, buildSlotsFromEFT, generateEmptySlots, lookupShip, cheaperEquivalent, moduleVariations, haptic } from "./lib/core.js";
import { DRONE_TYPES } from "./dogma-engine-init.js";
import { fetchPrices } from "./prices.js";
import { C } from "./theme.js";
import { ImportFitSheet } from "./components/ui.jsx";
import { SnapshotModal } from "./components/snapshot.jsx";
import { ActiveFitBar, FittingsScreen, ShipInfoSheet } from "./components/FittingsScreen.jsx";
import { CargoScreen } from "./components/cargo.jsx";
import { DronesScreen } from "./components/drones.jsx";
import { ImplantsScreen } from "./components/implants.jsx";
import { EffectsScreen, buildBoosterFromName } from "./components/effects.jsx";
import { SettingsOverlay } from "./components/settings.jsx";
import { ExportFitModal, HamburgerMenu, ChooserSheet, AppHeader, BottomNav, SkillGapSheet } from "./components/layout.jsx";
import { FeedbackModal } from "./components/feedback.jsx";
import { EsiImportModal, EsiExportModal } from "./components/esi-ui.jsx";
import { FitTabs, resolveTabs, MAX_OPEN_TABS } from "./components/FitTabs.jsx";
import * as esi from "./lib/esi.js";

const IMPLANT_LOADOUTS_KEY = 'visviva_implant_loadouts';
const OPEN_TABS_KEY = 'visviva_open_tabs';
const NEW_TAB_PREF_KEY = 'visviva_open_in_new_tab';

export default function App(){
  const[_tick,_setTick]=useState(0);
  useEffect(()=>{
    if(_bundleReady){_setTick(1);return;}
    _bundleListeners.push(()=>_setTick(t=>t+1));
  },[]);
  // Native shell setup (no-op on web). Uses the Capacitor runtime bridge so there is no build-time
  // dependency on the plugins: light status-bar content over the dark theme, kept out of the webview
  // (so the header isn't clipped), and dismiss the splash once React has mounted.
  useEffect(()=>{
    const Cap=(typeof window!=="undefined")&&window.Capacitor;
    if(!Cap?.isNativePlatform?.())return;
    try{
      const SB=Cap.Plugins?.StatusBar;
      if(SB){SB.setStyle?.({style:"DARK"});SB.setOverlaysWebView?.({overlay:false});SB.setBackgroundColor?.({color:"#0e0e10"});}
      Cap.Plugins?.SplashScreen?.hide?.();
    }catch(e){}
  },[]);
  // ESI login callback (native only — the web build's redirect-based login is completed inline by
  // EsiSettingsPanel via esi.handleWebRedirectOnLoad() on mount instead). SSO opens the system
  // browser via @capacitor/browser; CCP redirects to our visviva://auth-callback custom scheme,
  // which Android/iOS hand back to the app as an appUrlOpen event rather than a page navigation.
  useEffect(()=>{
    const Cap=(typeof window!=="undefined")&&window.Capacitor;
    if(!Cap?.isNativePlatform?.())return;
    let sub;
    (async()=>{
      try{
        const [{App:CapApp},{Browser}]=await Promise.all([import('@capacitor/app'),import('@capacitor/browser')]);
        sub=await CapApp.addListener('appUrlOpen',async({url})=>{
          if(!url?.startsWith('visviva://auth-callback'))return;
          try{await Browser.close();}catch(e){}
          try{await esi.completeLoginFromCallback(url);}catch(e){console.error('ESI login failed:',e);}
        });
      }catch(e){}
    })();
    return()=>{try{sub?.remove?.();}catch(e){}};
  },[]);
  const[bottomTab,setBottomTab]=useState("fittings");
  const[showHamburger,setShowHamburger]=useState(false);
  const[showSettings,setShowSettings]=useState(false);
  const[fitsDB,setFitsDB]=useState(()=>{try{const s=localStorage.getItem("pyfa-fitsdb");if(s)return JSON.parse(s);}catch{}return SAVED_FITS_SEED;});
  const[activeFit,setActiveFit]=useState(()=>{try{const s=localStorage.getItem("pyfa-activefit");if(s)return JSON.parse(s);}catch{}return null;});
  const initialFit=(()=>{try{const db=JSON.parse(localStorage.getItem("pyfa-fitsdb")||"null");const af=JSON.parse(localStorage.getItem("pyfa-activefit")||"null");if(db&&af)return db[af.ship]?.find(f=>f.name===af.fitName)||null;}catch{}return null;})();
  const emptyImplants=()=>Array.from({length:10},(_,i)=>({slot:i+1,name:"[Empty]",bonus:null}));
  const[slots,setSlots]=useState(initialFit?.slots??generateEmptySlots(lookupShip("Hyperion")));
  const[drones,setDrones]=useState(initialFit?.drones??[]);
  const[fighters,setFighters]=useState(initialFit?.fighters??[]);
  const[dmgProfile,setDmgProfile]=useState({name:"Uniform",p:[0.25,0.25,0.25,0.25]});
  // Resists of whatever the fit is shooting. A VIEWING parameter like dmgProfile above (its
  // outgoing-damage counterpart), not part of the fit, so it lives here and is not persisted.
  const[tgtProfile,setTgtProfile]=useState({n:"None (0%)",r:[0,0,0,0]});
  const[cargoItems,setCargoItems]=useState(initialFit?.cargo??[]);
  const[implants,setImplants]=useState(initialFit?.implants??emptyImplants());
  const[boosters,setBoosters]=useState(initialFit?.boosters??[]);
  const[implantLoadouts,setImplantLoadouts]=useState(()=>{try{return JSON.parse(localStorage.getItem(IMPLANT_LOADOUTS_KEY)??'[]');}catch{return [];}});
  useEffect(()=>{try{localStorage.setItem(IMPLANT_LOADOUTS_KEY,JSON.stringify(implantLoadouts));}catch{}},[implantLoadouts]);
  // Open fit tabs: pointers to fits in fitsDB, restored on launch like browser tabs. Stored as
  // {ship,id,name}; resolveTabs() reconciles them against the live fitsDB on every render, so a
  // renamed fit relabels itself and a deleted one drops out without this needing to hook the
  // rename/delete handlers.
  const[openTabs,setOpenTabs]=useState(()=>{try{const s=localStorage.getItem(OPEN_TABS_KEY);if(s)return JSON.parse(s);}catch{}return [];});
  useEffect(()=>{try{localStorage.setItem(OPEN_TABS_KEY,JSON.stringify(openTabs));}catch{}},[openTabs]);
  // Off by default: opening every fit in its own tab fills the strip within a session, and most
  // opens are "show me this fit", not "keep the last one to hand". So a plain open REPLACES the
  // current tab, and you ask for a new one explicitly (the + in the strip, or Open in New Tab in
  // the Fits list). Setting flips it to pyfa's always-new-tab behaviour.
  const[openInNewTab,setOpenInNewTab]=useState(()=>{try{return localStorage.getItem(NEW_TAB_PREF_KEY)==="1";}catch{return false;}});
  useEffect(()=>{try{localStorage.setItem(NEW_TAB_PREF_KEY,openInNewTab?"1":"0");}catch{}},[openInNewTab]);
  // One-shot override for the explicit "open in a new tab" affordances, consumed by the next
  // loadFit. A ref rather than state so setting it cannot race the load it is meant to modify.
  const wantNewTab=useRef(false);
  // The fit restored at launch comes straight out of localStorage rather than through loadFit, so
  // nothing would have registered its tab and the strip would start empty with a fit already open.
  // Seed it once on mount.
  useEffect(()=>{
    if(!activeFit?.ship||!activeFit?.fitName)return;
    setOpenTabs(prev=>{
      const list=prev??[];
      if(list.some(t=>t.ship===activeFit.ship&&t.name===activeFit.fitName))return list;
      const fit=fitsDB[activeFit.ship]?.find(f=>f.name===activeFit.fitName);
      if(!fit)return list;
      return [...list,{ship:activeFit.ship,id:fit.id,name:activeFit.fitName}];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  const[priceHub,setPriceHub]=useState(()=>{try{return localStorage.getItem('visviva_pricehub')??'Jita';}catch{return 'Jita';}});
  useEffect(()=>{try{localStorage.setItem('visviva_pricehub',priceHub);}catch{}},[priceHub]);
  const[priceSource,setPriceSource]=useState(()=>{try{return localStorage.getItem('visviva_pricesource')??'fuzzwork';}catch{return 'fuzzwork';}});
  useEffect(()=>{try{localStorage.setItem('visviva_pricesource',priceSource);}catch{}},[priceSource]);
  const[projFits,setProjFits]=useState(initialFit?.projFits??[]);
  const[cmdFits,setCmdFits]=useState(initialFit?.cmdFits??[]);
  const[skills,setSkills]=useState(()=>{try{const s=localStorage.getItem("pyfa-skills");if(s)return{...SKILL_DEFAULTS,...JSON.parse(s)};}catch{}return SKILL_DEFAULTS;});
  // Can this character actually fly the fit? Checked against every fitted item's own
  // requiredSkillN/requiredSkillNLevel, not just the skills the dogma engine reads.
  const skillCheck=useMemo(()=>activeFit?.ship
    ? checkFitSkills(lookupShip(activeFit.ship)??{name:activeFit.ship,typeID:tidByName(activeFit.ship)},slots,drones,fighters,skills)
    : {ok:true,missing:[]},
  [activeFit,slots,drones,fighters,skills]);
  const externalBursts=useMemo(()=>{
    const out=[];
    for(const cf of cmdFits){
      const fit=fitsDB[cf.ship]?.find(f=>f.name===cf.fitName);
      if(!fit)continue;
      const bursts=computeCommandBursts({name:cf.ship,typeID:tidByName(cf.ship)},fit.slots,skills,{implants:fit.implants,boosters:fit.boosters});
      for(const b of bursts)out.push(b);
    }
    return out;
  },[cmdFits,fitsDB,skills]);
  const projectedEffects=useMemo(()=>{
    // Collected, not summed: incoming remote reps go through a diminishing-returns curve that
    // needs every source's amount AND cycle time together (applyRemoteRepDiminishing).
    const repEntries={shield:[],armor:[],hull:[]};
    const webMults=[]; let neutGJs=0;
    const col={sig:[],lock:[],scan:[],trk:[],topt:[],tfall:[],mrng:[],edly:[],avel:[],acld:[]};
    const boosts={lock:[],scan:[]};   // projected Remote Sensor Boosters -> attribute pool, not the debuff stack
    // Target EWAR resistance. Overwhelmingly a COMMAND BURST effect (buff 19, Electronic Hardening)
    // rather than a hull attribute, so externalBursts has to go in or every boosted fit reads as
    // having no resistance and projected damps/disruptors hit at full strength. Applied PER SOURCE
    // MODULE, before stacking — stack(b*r) != stack(b)*r, and eos does the former.
    const tShip=activeFit?.ship;
    const R=(projFits.length&&tShip)?projectionResistances({name:tShip,typeID:tidByName(tShip)},slots,skills,{externalBursts}):null;
    const rz=k=>(R&&Number.isFinite(R[k])?R[k]:1);
    // disallowAssistance (in practice: an ACTIVE HIC bubble) refuses ALL incoming remote
    // assistance - reps and remote sensor boosters - while still taking EWAR normally.
    const noAssist=!!R?.disallowAssistance;
    for(const pf of projFits){
      const fit=fitsDB[pf.ship]?.find(f=>f.name===pf.fitName);
      if(!fit)continue;
      const eff=computeProjectedReps({name:pf.ship,typeID:tidByName(pf.ship)},fit.slots,skills,{implants:fit.implants,boosters:fit.boosters,drones:fit.drones});
      const rangeM=(pf.rangeKm??30)*1000;
      const rf=(o,fo)=>calcRangeFactor(o,fo,rangeM,true);
      if(!noAssist)for(const r of eff.reps)repEntries[r.kind].push({amount:r.amount*rf(r.optimal,r.falloff),cycleS:r.cycleS});
      for(const w of eff.webs)webMults.push(1+(w.speedFactor*rz('web')*rf(w.optimal,w.falloff))/100);
      for(const n of eff.neuts)neutGJs+=n.gjPerSec*rz('neut')*rf(n.optimal,n.falloff);
      for(const p of (eff.painters||[]))col.sig.push(p.sigBonus*rz('painter')*rf(p.optimal,p.falloff));
      for(const d of (eff.damps||[])){col.lock.push(d.lockBonus*rz('damp')*rf(d.optimal,d.falloff));col.scan.push(d.scanResBonus*rz('damp')*rf(d.optimal,d.falloff));}
      // Remote Sensor Booster: ASSISTANCE (not resisted), and a BONUS — so it must compete with the
      // ship's own signal amps/Sensor Optimization burst in one penalized group. Only the attribute
      // pool can do that, so these are handed to calcFitStats rather than stacked here.
      if(!noAssist)for(const b of (eff.sensorBoosts||[])){if(b.lockBonus)boosts.lock.push(b.lockBonus*rf(b.optimal,b.falloff));if(b.scanResBonus)boosts.scan.push(b.scanResBonus*rf(b.optimal,b.falloff));}
      for(const t of (eff.trackDisr||[])){const f=rz('disrupt')*rf(t.optimal,t.falloff);col.trk.push(t.tracking*f);col.topt.push(t.optimalBonus*f);col.tfall.push(t.falloffBonus*f);}
      for(const g of (eff.guideDisr||[])){const f=rz('disrupt')*rf(g.optimal,g.falloff);col.mrng.push(g.missileRange*f);col.edly.push(g.explosionDelay*f);col.avel.push(g.aoeVel*f);col.acld.push(g.aoeCloud*f);}
    }
    const reps={shield:applyRemoteRepDiminishing(repEntries.shield),armor:applyRemoteRepDiminishing(repEntries.armor),hull:applyRemoteRepDiminishing(repEntries.hull)};
    const webMult=webMults.length?stackingPenalty(webMults):1;
    const stackPct=(arr)=>arr.length?(stackingPenalty(arr.map(p=>1+p/100))-1)*100:0;
    const debuffs={sig:stackPct(col.sig),lockRange:stackPct(col.lock),scanRes:stackPct(col.scan),tracking:stackPct(col.trk),turretOptimal:stackPct(col.topt),turretFalloff:stackPct(col.tfall),missileRange:stackPct(col.mrng),explosionDelay:stackPct(col.edly),aoeVel:stackPct(col.avel),aoeCloud:stackPct(col.acld)};
    const hasDebuff=Object.values(debuffs).some(v=>Math.abs(v)>0.05);
    return {reps,webMult,neutGJs,debuffs:hasDebuff?debuffs:null,boosts};
  },[projFits,fitsDB,skills,activeFit,slots,externalBursts]);
  const projectedReps=projectedEffects.reps;
  const snapshotStats=useMemo(()=>{
    const shipName=activeFit?.ship;
    if(!shipName) return null;
    try{
      return calcFitStats({name:shipName,typeID:tidByName(shipName)},slots,drones??[],skills,{implants,boosters,externalBursts,projectedEffects,pilotSec:slots?.pilotSec,systemSecurity:slots?.systemSecurity});
    }catch{ return null; }
  },[activeFit,slots,drones,skills,implants,boosters,externalBursts,projectedEffects]);
  const shipMeta=useMemo(()=>{
    const sh=activeFit?.ship?lookupShip(activeFit.ship):null;
    return {faction:sh?.race??"",cls:sh?.hullClass??sh?.groupName??""};
  },[activeFit]);
  const droneInfo=useMemo(()=>{
    const shipName=activeFit?.ship;
    if(!shipName) return [];
    try{
      const cs=calcFitStats({name:shipName,typeID:tidByName(shipName)},slots,drones??[],skills,{implants,boosters,externalBursts,projectedEffects,pilotSec:slots?.pilotSec,systemSecurity:slots?.systemSecurity});
      return cs?.droneInfo ?? [];
    }catch{ return []; }
  },[activeFit,slots,drones,skills,implants,boosters,externalBursts,projectedEffects]);
  const activeDroneDps=useMemo(()=>{
    const shipName=activeFit?.ship;
    if(!shipName) return 0;
    try{
      const cs=calcFitStats({name:shipName,typeID:tidByName(shipName)},slots,drones??[],skills,{implants,boosters,externalBursts,projectedWebMult:projectedEffects?.webMult,projectedNeutGJs:projectedEffects?.neutGJs,projectedDebuffs:projectedEffects?.debuffs,projectedBoosts:projectedEffects?.boosts,pilotSec:slots?.pilotSec,systemSecurity:slots?.systemSecurity});
      return cs?.droneDps?.total ?? 0;
    }catch{ return 0; }
  },[activeFit,slots,drones,skills,implants,boosters,externalBursts,projectedEffects]);
  const fighterInfo=useMemo(()=>{
    const shipName=activeFit?.ship;
    if(!shipName||!(fighters?.length)) return [];
    try{
      const cs=calcFitStats({name:shipName,typeID:tidByName(shipName)},slots,drones??[],skills,{implants,boosters,externalBursts,damageProfile:dmgProfile?.p,pilotSec:slots?.pilotSec,systemSecurity:slots?.systemSecurity,fighters:fighters.map(f=>({name:f.name,qty:f.qty??1,active:f.active,abilities:f.abilities}))});
      return cs?.fighterDetails ?? [];
    }catch{ return []; }
  },[activeFit,slots,drones,skills,implants,boosters,fighters,dmgProfile]);
  const[factorInReload,setFactorInReload]=useState(()=>{try{return localStorage.getItem("pyfa-factor-reload")==="1";}catch{return false;}});
  const[fittingsView,setFittingsView]=useState(()=>{try{const db=JSON.parse(localStorage.getItem("pyfa-fitsdb")||"null");const af=JSON.parse(localStorage.getItem("pyfa-activefit")||"null");if(db&&af&&db[af.ship]?.find(f=>f.name===af.fitName))return"active";}catch{}return"browse";});
  const[showShipInfo,setShowShipInfo]=useState(false);
  const[showSkillGaps,setShowSkillGaps]=useState(false);
  const[showImportFit,setShowImportFit]=useState(false);
  const[showExportFit,setShowExportFit]=useState(false);
  const[showSnapshot,setShowSnapshot]=useState(false);
  const[showFeedback,setShowFeedback]=useState(false);
  const[showEsiImport,setShowEsiImport]=useState(false);
  const[showEsiExport,setShowEsiExport]=useState(false);
  const[showImportChooser,setShowImportChooser]=useState(false);
  const[showExportChooser,setShowExportChooser]=useState(false);
  const[priceBanner,setPriceBanner]=useState(null);
  const optimizeFitPrice=async()=>{
    if(!activeFit?.ship){setPriceBanner({kind:"none",msg:"Open a fit first"});setTimeout(()=>setPriceBanner(null),3000);return;}
    const sections=["high","mid","low","rigs","subsystems"];
    const fitted=sections.flatMap(sec=>slots[sec]??[]).filter(s=>s?.typeID);
    if(!fitted.length){setPriceBanner({kind:"none",msg:"No modules to optimize"});setTimeout(()=>setPriceBanner(null),3000);return;}
    setPriceBanner({kind:"loading",msg:"Checking market prices…"});
    const idsToPrice=new Set();
    for(const s of fitted){
      idsToPrice.add(s.typeID);
      for(const v of (moduleVariations?.[String(s.typeID)]??[]))if(v?.typeID)idsToPrice.add(v.typeID);
    }
    let priceMap;
    try{priceMap=await fetchPrices([...idsToPrice],priceHub);}
    catch{setPriceBanner({kind:"none",msg:"Couldn't fetch market prices — try again"});setTimeout(()=>setPriceBanner(null),3500);return;}
    let swapped=0;
    const patchSection=sec=>(slots[sec]??[]).map(s=>{
      if(!s?.typeID)return s;
      const better=cheaperEquivalent(s.typeID,priceMap);
      if(!better)return s;
      swapped++;
      return{...s,typeID:better.typeID,name:better.name};
    });
    const patched={...slots};
    for(const sec of sections)patched[sec]=patchSection(sec);
    if(!swapped){setPriceBanner({kind:"none",msg:"No cheaper equivalents found"});setTimeout(()=>setPriceBanner(null),3000);return;}
    setSlots(patched);
    setPriceBanner({kind:"success",msg:`Fit price optimized — ${swapped} module${swapped>1?"s":""} swapped`});
    setTimeout(()=>setPriceBanner(null),3500);
  };
  const loadFit=(ship,fitName)=>{
    const fit=fitsDB[ship]?.find(f=>f.name===fitName);
    setActiveFit({ship,fitName});
    // Opening a fit raises its tab if it already has one; otherwise it either REPLACES the current
    // tab (the default -- see openInNewTab) or is appended. Soft cap on append: past MAX_OPEN_TABS
    // the oldest tab is dropped, so the strip stays scannable on a phone. Nothing is lost -- the
    // Fits list is still the full library.
    const newTab=wantNewTab.current||openInNewTab; wantNewTab.current=false;
    // `activeFit` here is still the PREVIOUS fit: setActiveFit above only queues the update, which
    // is exactly what "replace the tab I was in" needs.
    const prevFit=activeFit;
    if(fit) setOpenTabs(prev=>{
      const list=prev??[];
      const at=list.findIndex(t=>t.ship===ship&&(t.id!=null?t.id===fit.id:t.name===fitName));
      if(at>=0)return list;
      const entry={ship,id:fit.id,name:fitName};
      if(!newTab&&prevFit){
        const cur=list.findIndex(t=>t.ship===prevFit.ship&&t.name===prevFit.fitName);
        if(cur>=0){const next=[...list];next[cur]=entry;return next;}
      }
      const next=[...list,entry];
      return next.length>MAX_OPEN_TABS?next.slice(next.length-MAX_OPEN_TABS):next;
    });
    setSlots(fit?.slots??generateEmptySlots(lookupShip(ship)));
    setDrones(fit?.drones??[]);
    setFighters(fit?.fighters??[]);
    setCargoItems(fit?.cargo??[]);
    setImplants(fit?.implants??emptyImplants());
    setBoosters(fit?.boosters??[]);
    setProjFits(fit?.projFits??[]);
    setCmdFits(fit?.cmdFits??[]);
    setFittingsView("active");
    setBottomTab("fittings");
  };
  const importFit=(parsed)=>{
    const{shipName,fitName,ship,mods,drones:pDrones,fighters:pFighters,cargo:pCargo,implantNames,boosterNames,subsystems:pSubs}=parsed;
    const modified=new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
    const subSlots=isT3Cruiser(shipName)?(()=>{
      const order=["Core","Defensive","Offensive","Propulsion"];
      const byGroup={};
      for(const s of (pSubs??[])){
        const gn=TYPES[s.typeID]?.gn??TYPES[s.typeID]?.groupName??"";
        const key=Object.entries(T3C_SUBSYSTEM_GROUPS).find(([,g])=>g===gn)?.[0];
        if(key)byGroup[key]={id:`sub${order.indexOf(key)}`,name:s.name,typeID:s.typeID,type:"subsystem",subGroup:key};
      }
      return order.map((k,i)=>byGroup[k]??{id:`sub${i}`,name:"[Empty Subsystem Slot]",icon:null,type:"empty",subGroup:k});
    })():undefined;
    const newSlots=buildSlotsFromEFT(ship,mods,subSlots);
    const newDrones=pDrones.map((d,i)=>{
      const dta=(typeof DRONE_TYPES!=='undefined'&&d.drone.typeID)?DRONE_TYPES?.[String(d.drone.typeID)]?.a:null;
      const bw=dta?.droneBandwidthUsed ?? d.drone.bandwidth ?? 5;
      return {id:Date.now()+i,name:d.name,size:d.drone.size,qty:d.qty,active:false,
        range:d.drone.range??0,tracking:d.drone.tracking??0,velocity:d.drone.velocity??0,hp:d.drone.hp??0,
        dps:d.drone.dps??0,bandwidth:bw,volume:dta?.volume??d.drone.volume,typeID:d.drone.typeID};
    });
    const newFighters=(pFighters??[]).map((f,i)=>{
      const t=f.typeID??tidByName(f.name); const gn=TYPES[t]?.gn??TYPES[t]?.groupName??"";
      const role=/Support/i.test(gn)?"Support":null;
      return{id:Date.now()+1000+i,name:f.name,qty:f.qty,tier:/ II$/.test(f.name)?"T2":"T1",dps:0,role,hp:0,active:true,typeID:t};
    });
    const newCargo=pCargo.map((c,i)=>{const tid=c.typeID??tidByName(c.name);return{id:Date.now()+i,name:c.name,qty:c.qty,vol:tid!=null?(TYPES[tid]?.attrs?.volume??TYPES[String(tid)]?.attrs?.volume??1):1,typeID:tid??undefined};});
    const newImplants=emptyImplants();
    for(const ip of implantNames){const idx=newImplants.findIndex(i=>i.slot===ip.slot);if(idx>=0)newImplants[idx]={slot:ip.slot,name:ip.name,bonus:null};}
    const newBoosters=boosterNames.map(buildBoosterFromName);
    setFitsDB(db=>{
      const existing=db[shipName]||[];
      const idx=existing.findIndex(f=>f.name===fitName);
      const entry={id:idx>=0?existing[idx].id:Date.now(),name:fitName,modified,slots:newSlots,
        drones:newDrones,fighters:newFighters,cargo:newCargo,implants:newImplants,boosters:newBoosters};
      if(idx>=0){const u=[...existing];u[idx]=entry;return{...db,[shipName]:u};}
      return{...db,[shipName]:[...existing,entry]};
    });
    setActiveFit({ship:shipName,fitName});
    setSlots(newSlots);setDrones(newDrones);setFighters(newFighters);setCargoItems(newCargo);
    setImplants(newImplants);setBoosters(newBoosters);
    setProjFits([]);setCmdFits([]);
    setBottomTab("fittings");
    setFittingsView("active");
  };
  useEffect(()=>{if(!activeFit?.ship||!activeFit?.fitName)return;setFitsDB(db=>{const sf=db[activeFit.ship];if(!sf)return db;const idx=sf.findIndex(f=>f.name===activeFit.fitName);if(idx<0)return db;const u=[...sf];u[idx]={...u[idx],slots,drones,fighters,cargo:cargoItems,implants,boosters,projFits,cmdFits};return{...db,[activeFit.ship]:u};});},[slots,drones,fighters,cargoItems,implants,boosters,projFits,cmdFits,activeFit]);
  useEffect(()=>{try{localStorage.setItem("pyfa-fitsdb",JSON.stringify(fitsDB));}catch{}},[fitsDB]);
  useEffect(()=>{try{localStorage.setItem("pyfa-activefit",JSON.stringify(activeFit));}catch{}},[activeFit]);
  useEffect(()=>{try{localStorage.setItem("pyfa-skills",JSON.stringify(skills));}catch{}},[skills]);
  useEffect(()=>{try{localStorage.setItem("pyfa-factor-reload",factorInReload?"1":"0");}catch{}},[factorInReload]);
  // ── Undo ────────────────────────────────────────────────────────────────────────────────────
  // History of the fit's editable state — the SAME eight values the persistence effect above writes
  // back to fitsDB, so "one undo step" and "one saved change" mean the same thing by construction.
  // Snapshots are cheap: every mutation path already replaces these arrays immutably, so a snapshot
  // is eight references, not a deep clone.
  const UNDO_LIMIT=50;
  const _undoStack=useRef([]);
  const _undoPrev=useRef(null);       // last committed snapshot
  const _undoApplying=useRef(false);  // true while an undo is being applied, so it isn't re-recorded
  const _undoFitKey=useRef(undefined);// which fit the stack belongs to
  const[undoDepth,setUndoDepth]=useState(0);
  const _fitSnapshot=useMemo(()=>({slots,drones,fighters,cargoItems,implants,boosters,projFits,cmdFits}),
    [slots,drones,fighters,cargoItems,implants,boosters,projFits,cmdFits]);
  useEffect(()=>{
    const key=activeFit?`${activeFit.ship} ${activeFit.fitName}`:null;
    const prev=_undoPrev.current;
    _undoPrev.current=_fitSnapshot;
    // Switching fits (or the first load) replaces all eight values at once. That is not an edit —
    // recording it would let Undo paste the previous fit's modules into this one.
    if(_undoFitKey.current!==key){
      _undoFitKey.current=key;
      _undoStack.current=[];
      _undoApplying.current=false;
      setUndoDepth(0);
      return;
    }
    if(_undoApplying.current){_undoApplying.current=false;return;}
    // `prev === _fitSnapshot` means the effect re-ran without the fit actually changing — which
    // StrictMode's deliberate double-invoke does on every mount. Recording that would seed the
    // stack with a no-op entry, so the first Undo press would appear to do nothing.
    if(prev===null||prev===_fitSnapshot)return;
    _undoStack.current.push(prev);
    if(_undoStack.current.length>UNDO_LIMIT)_undoStack.current.shift();
    setUndoDepth(_undoStack.current.length);
  },[_fitSnapshot,activeFit]);
  const undo=()=>{
    const snap=_undoStack.current.pop();
    if(!snap)return;
    _undoApplying.current=true;  // cleared by the effect this batch triggers
    setSlots(snap.slots);setDrones(snap.drones);setFighters(snap.fighters);
    setCargoItems(snap.cargoItems);setImplants(snap.implants);setBoosters(snap.boosters);
    setProjFits(snap.projFits);setCmdFits(snap.cmdFits);
    setUndoDepth(_undoStack.current.length);
    haptic();
  };
  // Ctrl/Cmd+Z for the desktop and web builds; the button covers touch.
  useEffect(()=>{
    const onKey=e=>{
      if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&(e.key==='z'||e.key==='Z')){
        const t=e.target;
        if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable))return; // let the field undo its own text
        e.preventDefault();undo();
      }
    };
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  });// no dep array: `undo` closes over the current stack each render

  const openFitTabs=resolveTabs(openTabs,fitsDB);
  // Closing the tab you are looking at moves to its neighbour, the way a browser does; closing any
  // other tab leaves the current fit alone. Closing the last tab just empties the strip -- the fit
  // stays loaded, since the strip is a shortcut rather than the thing holding the fit open.
  const closeFitTab=(tab)=>{
    const idx=openFitTabs.findIndex(t=>t.ship===tab.ship&&t.id===tab.id);
    const wasActive=activeFit?.ship===tab.ship&&activeFit?.fitName===tab.name;
    setOpenTabs(prev=>(prev??[]).filter(t=>!(t.ship===tab.ship&&(t.id!=null?t.id===tab.id:t.name===tab.name))));
    if(wasActive){
      const next=openFitTabs[idx+1]??openFitTabs[idx-1];
      if(next) loadFit(next.ship,next.name);
    }
  };
  // Auto-hide the strip while you scroll a fit, so a phone spends its rows on the fit instead of on
  // navigation; it collapses to a segmented line that still says which tab you are in, and comes
  // back on scroll-up, on reaching the top, or on a tap.
  //
  // Scroll events do not bubble, so this is a CAPTURE-phase listener on window: most screens scroll
  // the DOCUMENT (the app column is `minHeight:100vh` and grows past the viewport) while sheets and
  // panels scroll a div of their own, and capturing at the top catches both without any screen
  // having to know the strip exists. Document scrolls report `document` as the target, which has no
  // scrollTop -- read the scrolling element instead.
  const[tabsCollapsed,setTabsCollapsed]=useState(false);
  const lastScrollTop=useRef(0);
  useEffect(()=>{
    const onScroll=(e)=>{
      const t=e.target;
      const y=(t&&typeof t.scrollTop==='number')?t.scrollTop:(document.scrollingElement?.scrollTop??0);
      const prev=lastScrollTop.current;lastScrollTop.current=y;
      if(y<=4){setTabsCollapsed(false);return;}
      if(y-prev>6)setTabsCollapsed(true);
      else if(prev-y>24)setTabsCollapsed(false);
    };
    window.addEventListener('scroll',onScroll,true);
    return()=>window.removeEventListener('scroll',onScroll,true);
  },[]);
  // Changing screen swaps in a different scroller sitting at its own offset; carrying the collapsed
  // state across would hide the strip on a screen you have not scrolled.
  useEffect(()=>{setTabsCollapsed(false);lastScrollTop.current=0;},[bottomTab,fittingsView]);
  // The + sends you to the Fits list with "next open goes in a new tab" armed. Backing out without
  // picking anything must disarm it, or a fit opened much later inherits the request.
  useEffect(()=>{if(fittingsView!=="browse")wantNewTab.current=false;},[fittingsView]);
  const returnToFit=()=>{setBottomTab("fittings");setFittingsView("active");};
  return(<div style={{background:C.bg,minHeight:"100vh",display:"flex",justifyContent:"center"}}>
    <style>{GLOBAL_CSS}</style>
    <div style={{width:"100%",maxWidth:430,minHeight:"100vh",display:"flex",flexDirection:"column",background:C.bg}}>
      <AppHeader onHamburger={()=>setShowHamburger(true)} activeFit={activeFit} onShipInfo={()=>setShowShipInfo(true)} skillCheck={skillCheck} onSkillGaps={()=>setShowSkillGaps(true)}/>
      {(bottomTab!=="fittings"||(fittingsView&&fittingsView!=="active"))&&<ActiveFitBar activeFit={activeFit} onReturn={returnToFit}/>}
      {/* Tab strip. Hidden on the Fits LIST, where the list itself is the navigation and a second
          row of fit names would just be noise. */}
      {!(bottomTab==="fittings"&&fittingsView&&fittingsView!=="active")&&
        <FitTabs tabs={openFitTabs} activeFit={activeFit} collapsed={tabsCollapsed}
                 onSelect={t=>loadFit(t.ship,t.name)} onClose={closeFitTab}
                 onExpand={()=>setTabsCollapsed(false)}
                 onOpenLibrary={()=>{wantNewTab.current=true;setBottomTab("fittings");setFittingsView("browse");}}/>}
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        {bottomTab==="fittings"&&<FittingsScreen undo={undo} undoDepth={undoDepth} activeFit={activeFit} setActiveFit={setActiveFit} loadFit={loadFit} view={fittingsView} setView={setFittingsView} fitsDB={fitsDB} setFitsDB={setFitsDB} slots={slots} setSlots={setSlots} setDrones={setDrones} setFighters={setFighters} fighters={fighters} setCargoItems={setCargoItems} setImplants={setImplants} setBoosters={setBoosters} setProjFits={setProjFits} setCmdFits={setCmdFits} skills={skills} implants={implants} boosters={boosters} drones={drones} factorInReload={factorInReload} setFactorInReload={setFactorInReload} externalBursts={externalBursts} projectedReps={projectedReps} projectedEffects={projectedEffects} dmgProfile={dmgProfile} setDmgProfile={setDmgProfile} tgtProfile={tgtProfile} setTgtProfile={setTgtProfile} priceHub={priceHub} setPriceHub={setPriceHub}/>}
        {bottomTab==="cargo"   &&<CargoScreen items={cargoItems} setItems={setCargoItems} slots={slots} shipCapacity={(()=>{const t=tidByName(activeFit?.ship);return t&&TYPES[t]?(TYPES[t].attrs?.capacity??1150):1150;})()} />}
        {bottomTab==="drones"  &&<DronesScreen drones={drones} setDrones={setDrones} droneInfo={droneInfo} fighters={fighters} setFighters={setFighters} fighterInfo={fighterInfo} activeDroneDps={activeDroneDps} shipDroneBay={(()=>{const t=tidByName(activeFit?.ship);return t&&TYPES[t]?(TYPES[t].attrs?.droneCapacity??0):0;})()} shipDroneBandwidth={(()=>{const t=tidByName(activeFit?.ship);return t&&TYPES[t]?(TYPES[t].attrs?.droneBandwidth??0):0;})()} shipFighter={(()=>{const t=tidByName(activeFit?.ship);const a=t&&TYPES[t]?TYPES[t].attrs:null;return a?{cap:a.fighterCapacity??0,tubes:a.fighterTubes??0,light:a.fighterLightSlots??0,heavy:a.fighterHeavySlots??0,support:a.fighterSupportSlots??0}:{cap:0,tubes:0,light:0,heavy:0,support:0};})()} />}
        {bottomTab==="implants"&&<ImplantsScreen implants={implants} setImplants={setImplants} loadouts={implantLoadouts} setLoadouts={setImplantLoadouts}/>}
        {bottomTab==="effects" &&<EffectsScreen fitsDB={fitsDB} boosters={boosters} setBoosters={setBoosters} projFits={projFits} setProjFits={setProjFits} cmdFits={cmdFits} setCmdFits={setCmdFits} environment={slots?.environment??null} setEnvironment={(n)=>setSlots(prev=>({...prev,environment:n||undefined}))}/>}
      </div>
      <BottomNav active={bottomTab} onChange={setBottomTab}/>
    </div>
    {priceBanner&&<div style={{position:"fixed",top:12,left:"50%",transform:"translateX(-50%)",zIndex:300,background:priceBanner.kind==="success"?C.success:C.surfaceAlt,color:priceBanner.kind==="success"?"#0e0e10":C.textMid,border:priceBanner.kind==="success"?"none":`1px solid ${C.border}`,borderRadius:10,padding:"10px 16px",fontSize:13,fontWeight:700,boxShadow:"0 6px 20px rgba(0,0,0,.35)",maxWidth:"90%",textAlign:"center"}}>{priceBanner.kind==="success"?"✓ ":""}{priceBanner.msg}</div>}
    {showHamburger&&<HamburgerMenu onClose={()=>setShowHamburger(false)} onOpenSettings={()=>{setShowSettings(true);setShowHamburger(false);}} onImport={()=>setShowImportChooser(true)} onExport={()=>{setShowExportChooser(true);setShowHamburger(false);}} onSnapshot={()=>{setShowSnapshot(true);setShowHamburger(false);}} onFeedback={()=>{setShowFeedback(true);setShowHamburger(false);}} onOptimizePrice={()=>{optimizeFitPrice();setShowHamburger(false);}}/>}
    {showImportChooser&&<ChooserSheet title="Import Fit" onClose={()=>setShowImportChooser(false)} options={[
      {icon:"&#128229;",label:"From EFT",sub:"Paste from clipboard",onSelect:()=>{setShowImportChooser(false);setShowImportFit(true);}},
      {icon:"&#128640;",label:"From EVE Character",sub:"An in-game saved fitting",onSelect:()=>{setShowImportChooser(false);setShowEsiImport(true);}},
    ]}/>}
    {showExportChooser&&<ChooserSheet title="Export Fit" onClose={()=>setShowExportChooser(false)} options={[
      {icon:"&#128228;",label:"To EFT",sub:"Copy to clipboard",onSelect:()=>{setShowExportChooser(false);setShowExportFit(true);}},
      {icon:"&#128225;",label:"To EVE Character",sub:"Save into in-game fittings",onSelect:()=>{setShowExportChooser(false);setShowEsiExport(true);}},
    ]}/>}
    {showShipInfo&&activeFit?.ship&&<ShipInfoSheet ship={lookupShip(activeFit.ship)??{name:activeFit.ship}} onClose={()=>setShowShipInfo(false)}/>}
    {showSkillGaps&&<SkillGapSheet missing={skillCheck.missing} onClose={()=>setShowSkillGaps(false)}/>}
    {showExportFit&&<ExportFitModal activeFit={activeFit} slots={slots} implants={implants} boosters={boosters} cargo={[]} onClose={()=>setShowExportFit(false)}/>}
    {showSnapshot&&<SnapshotModal onClose={()=>setShowSnapshot(false)} fitName={activeFit?.fitName} shipName={activeFit?.ship} shipTypeID={tidByName(activeFit?.ship)} shipFaction={shipMeta.faction} shipClass={shipMeta.cls} slots={slots} cs={snapshotStats} drones={drones} implants={implants} boosters={boosters} cmdFits={cmdFits} projFits={projFits} fitsDB={fitsDB} skills={skills}/>}
    {showSettings &&<SettingsOverlay onClose={()=>setShowSettings(false)} skills={skills} setSkills={setSkills} factorInReload={factorInReload} setFactorInReload={setFactorInReload} openInNewTab={openInNewTab} setOpenInNewTab={setOpenInNewTab} implants={implants} setImplants={setImplants} loadouts={implantLoadouts} setLoadouts={setImplantLoadouts} priceHub={priceHub} setPriceHub={setPriceHub} priceSource={priceSource} setPriceSource={setPriceSource}/>}
    {showImportFit&&<ImportFitSheet onClose={()=>setShowImportFit(false)} onImport={importFit}/>}
    {showFeedback&&<FeedbackModal activeFit={activeFit} slots={slots} implants={implants} boosters={boosters} onClose={()=>setShowFeedback(false)}/>}
    {showEsiImport&&<EsiImportModal onClose={()=>setShowEsiImport(false)} onImport={importFit}/>}
    {showEsiExport&&<EsiExportModal activeFit={activeFit} slots={slots} drones={drones} cargoItems={cargoItems} fighters={fighters} implants={implants} boosters={boosters} onClose={()=>setShowEsiExport(false)}/>}
  </div>);
}
