import { useState, useEffect, useMemo, useRef } from "react";
import { calcFitStats, computeCommandBursts, computeProjectedReps, projectionResistances, applyRemoteRepDiminishing, calcRangeFactor, stackingPenalty, checkFitSkills, SKILL_DEFAULTS, TYPES, tidByName, isT3Cruiser, T3C_SUBSYSTEM_GROUPS } from "./calc.js";
import { SAVED_FITS_SEED, getGlobalCss, _bundleListeners, _bundleReady, buildSlotsFromEFT, generateEmptySlots, reconcileRacks, lookupShip, optimizeSlotPrice, moduleVariations, haptic, parseEFT, readClipboardText } from "./lib/core.js";
import { DRONE_TYPES } from "./dogma-engine-init.js";
import { fetchPrices } from "./prices.js";
import { C, THEMES, setTheme } from "./theme.js";
import { ImportFitSheet, initKeyboardTracking } from "./components/ui.jsx";
import { SnapshotModal } from "./components/snapshot.jsx";
import { ActiveFitBar, FittingsScreen, ShipInfoSheet } from "./components/FittingsScreen.jsx";
import { CargoScreen } from "./components/cargo.jsx";
import { DronesScreen } from "./components/drones.jsx";
import { ImplantsScreen } from "./components/implants.jsx";
import { EffectsScreen, buildBoosterFromName } from "./components/effects.jsx";
import { SettingsOverlay } from "./components/settings.jsx";
import { ExportFitModal, HamburgerMenu, ChooserSheet, AppHeader, BottomNav, PilotSheet } from "./components/layout.jsx";
import { FeedbackModal } from "./components/feedback.jsx";
import { EsiImportModal, EsiExportModal } from "./components/esi-ui.jsx";
import { FitTabs } from "./components/FitTabs.jsx";
import { SkillsProvider } from "./components/skill-mark.jsx";
import { IconClipboard, IconCharacter } from "./components/glyphs.jsx";
import { resolveTabs, MAX_OPEN_TABS, sameTab } from "./lib/fit-tabs.js";
import { getLoadedFitsDB, persistFitsDB } from "./lib/fits-store.js";
import { buildFitEntry, emptyImplants } from "./lib/fit-entry.js";
import { resolvePilotSkills, describeSkillSheet } from "./lib/pilot.js";
import { resetScrollMemory } from "./lib/use-scroll-memory.js";
import * as esi from "./lib/esi.js";

const IMPLANT_LOADOUTS_KEY = 'axis_implant_loadouts';
const OPEN_TABS_KEY = 'axis_open_tabs';
const NEW_TAB_PREF_KEY = 'axis_open_in_new_tab';
const RECENT_FITS_KEY = 'axis_recent_fits';
const SKILL_PROFILES_KEY = 'pyfa-skill-profiles';
const THEME_PREF_KEY = 'axis_theme_pref';
const AUTOFILL_HARDPOINTS_KEY = 'axis_autofill_hardpoints';

export default function App(){
  const[_tick,_setTick]=useState(0);
  useEffect(()=>{
    if(_bundleReady){_setTick(1);return;}
    _bundleListeners.push(()=>_setTick(t=>t+1));
  },[]);
  // Theme: defaults to 'dark' with no stored pref, or a manual pin to any palette in theme.js.
  // systemTheme tracks the OS live via a matchMedia listener, so flipping it in iOS Settings
  // while the app is open updates immediately under 'system' without a restart.
  //
  // Validated against THEMES rather than a literal list so a new palette needs no edit here. Only
  // 'system' is special: it is not a palette, it defers to the OS, which can only say light or dark.
  const[themePref,setThemePref]=useState(()=>{try{const v=localStorage.getItem(THEME_PREF_KEY);return(v==="system"||THEMES.includes(v))?v:"dark";}catch{return"dark";}});
  useEffect(()=>{try{localStorage.setItem(THEME_PREF_KEY,themePref);}catch{}},[themePref]);
  const[systemTheme,setSystemTheme]=useState(()=>{try{return window.matchMedia('(prefers-color-scheme: light)').matches?"light":"dark";}catch{return"dark";}});
  useEffect(()=>{
    let mq;try{mq=window.matchMedia('(prefers-color-scheme: light)');}catch{return;}
    const onChange=()=>setSystemTheme(mq.matches?"light":"dark");
    mq.addEventListener?.('change',onChange);
    return()=>mq.removeEventListener?.('change',onChange);
  },[]);
  const resolvedTheme=themePref==="system"?systemTheme:themePref;
  // Mutating theme.js's module-level palette selector synchronously, in the same render pass that
  // reads it below (via C.xxx in the JSX), same precedent as _tick above: a plain useEffect would
  // apply the switch one render late, showing a frame of the old palette.
  setTheme(resolvedTheme);
  // Native shell setup (no-op on web). Uses the Capacitor runtime bridge so there is no build-time
  // dependency on the plugins: light status-bar content over the dark theme, the webview running
  // UNDER the status bar, and dismiss the splash once React has mounted.
  //
  // overlay:TRUE is the whole point and was previously false "so the header isn't clipped". With it
  // false the webview begins below the status bar, which (a) leaves a strip of bare colour above
  // the app and (b) makes env(safe-area-inset-top) report ~0, so the header's own safe-area padding
  // silently did nothing. This runtime call also overrides capacitor.config.json, so setting it
  // there alone had no effect. Nothing gets clipped now because AppHeader insets its CONTENT by
  // env(safe-area-inset-top) while its background runs to the physical top of the screen.
  useEffect(()=>{
    const Cap=(typeof window!=="undefined")&&window.Capacitor;
    if(!Cap?.isNativePlatform?.())return;
    try{
      const SB=Cap.Plugins?.StatusBar;
      // Capacitor's style names the CONTENT colour, not the background: "DARK" content reads on a
      // light bar, so it's what our dark theme (light content on the OS bar) needs called "LIGHT",
      // and vice versa for the light theme's dark-on-light bar. Confirmed empirically on-device.
      // Tested against "light" rather than "dark" so every palette that isn't the light one gets
      // light bar content by default — which is what any new dark theme will want.
      if(SB){SB.setStyle?.({style:resolvedTheme==="light"?"LIGHT":"DARK"});SB.setOverlaysWebView?.({overlay:true});}
      Cap.Plugins?.SplashScreen?.hide?.();
    }catch(e){}
  },[resolvedTheme]);
  // The keyboard's own "Hide keyboard" chevron, iPhone-only per Capacitor's Keyboard plugin (a no-op
  // everywhere else, so no platform check needed beyond isNativePlatform). Off by default. With
  // Keyboard.resize:"none" (capacitor.config.json — see BottomSheet's useVisualViewport) the OS never
  // gives the page another way past the keyboard, and every search sheet can land on a results list
  // short enough that BottomSheet's own scroll-to-dismiss (dismissKeyboardOnScroll) has nothing to
  // scroll — the "5mn c" module search was the one that surfaced it, but it's every sheet with a
  // search box, not that one specifically.
  // initKeyboardTracking is load-bearing and must happen HERE, at boot, not from the sheets that
  // consume it: attaching Capacitor's keyboard listeners on a sheet's own mount lost the very first
  // keyboardWillShow, because the sheet's autoFocus triggers it before the bridge finishes attaching.
  // See the note above useVisualViewport in components/ui.jsx.
  useEffect(()=>{
    initKeyboardTracking();
    const Cap=(typeof window!=="undefined")&&window.Capacitor;
    if(!Cap?.isNativePlatform?.())return;
    try{ Cap.Plugins?.Keyboard?.setAccessoryBarVisible?.({isVisible:true}); }catch(e){}
  },[]);
  // ESI login callback (native only — the web build's redirect-based login is completed inline by
  // EsiSettingsPanel via esi.handleWebRedirectOnLoad() on mount instead). SSO opens the system
  // browser via @capacitor/browser; CCP redirects to our eveauth-visviva://auth-callback custom
  // scheme, which Android/iOS hand back as an appUrlOpen event rather than a page navigation.
  // The URL match goes through esi.isEsiCallbackUrl so the scheme is only written down once (in
  // esi-config.js) — a hardcoded copy here silently rejected every callback once the scheme changed.
  useEffect(()=>{
    const Cap=(typeof window!=="undefined")&&window.Capacitor;
    if(!Cap?.isNativePlatform?.())return;
    let sub;
    (async()=>{
      try{
        const [{App:CapApp},{Browser}]=await Promise.all([import('@capacitor/app'),import('@capacitor/browser')]);
        sub=await CapApp.addListener('appUrlOpen',async({url})=>{
          if(!esi.isEsiCallbackUrl(url))return;
          try{await Browser.close();}catch(e){}
          try{await esi.completeLoginFromCallback(url);}catch(e){console.error('ESI login failed:',e);esi.setLastLoginError(e);}
        });
      }catch(e){}
    })();
    return()=>{try{sub?.remove?.();}catch(e){}};
  },[]);
  const[bottomTab,setBottomTab]=useState("fittings");
  const[showHamburger,setShowHamburger]=useState(false);
  const[showSettings,setShowSettings]=useState(false);
  // Fits come from IndexedDB, which main.jsx has already loaded into memory before this renders —
  // getLoadedFitsDB() is a synchronous read of that snapshot, not a fetch. An empty object is a real
  // answer (a user who deleted everything), so only a null/absent store falls back to the seed.
  const[fitsDB,setFitsDB]=useState(()=>getLoadedFitsDB()??SAVED_FITS_SEED);
  const[activeFit,setActiveFit]=useState(()=>{try{const s=localStorage.getItem("pyfa-activefit");if(s)return JSON.parse(s);}catch{}return null;});
  const initialFit=(()=>{try{const db=getLoadedFitsDB();const af=JSON.parse(localStorage.getItem("pyfa-activefit")||"null");if(db&&af)return db[af.ship]?.find(f=>f.name===af.fitName)||null;}catch{}return null;})();
  // reconcileRacks, because a saved fit carries the rack sizes it was made with — see core.js. Both
  // fit-load paths go through it (here for the fit restored on launch, and in loadFit below).
  const[slots,setSlots]=useState(initialFit?.slots
    ?reconcileRacks(initialFit.slots,lookupShip(activeFit?.ship))
    :generateEmptySlots(lookupShip("Hyperion")));
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
  // Most-recently-OPENED fits, newest first. Separate from openTabs: a tab can be closed while the
  // fit stays recent, and the strip is capped at MAX_OPEN_TABS for layout reasons rather than
  // history. Stored as {ship,id,name} like the tabs, so a rename still resolves by id.
  const[recentFits,setRecentFits]=useState(()=>{try{const s=localStorage.getItem(RECENT_FITS_KEY);if(s)return JSON.parse(s);}catch{}return [];});
  useEffect(()=>{try{localStorage.setItem(RECENT_FITS_KEY,JSON.stringify(recentFits));}catch{}},[recentFits]);
  // Off by default: opening every fit in its own tab fills the strip within a session, and most
  // opens are "show me this fit", not "keep the last one to hand". So a plain open REPLACES the
  // current tab, and you ask for a new one explicitly (the + in the strip, or Open in New Tab in
  // the Fits list). Setting flips it to pyfa's always-new-tab behaviour.
  const[openInNewTab,setOpenInNewTab]=useState(()=>{try{return localStorage.getItem(NEW_TAB_PREF_KEY)==="1";}catch{return false;}});
  useEffect(()=>{try{localStorage.setItem(NEW_TAB_PREF_KEY,openInNewTab?"1":"0");}catch{}},[openInNewTab]);
  // On by default: picking one turret/launcher from the browser is almost always "put these on
  // every hardpoint", not "just this one" — see addMod in tabs.jsx. Stored inverted ("0" to opt
  // out) so an absent key, i.e. everyone who upgrades into this, keeps the new default.
  const[autoFillHardpoints,setAutoFillHardpoints]=useState(()=>{try{return localStorage.getItem(AUTOFILL_HARDPOINTS_KEY)!=="0";}catch{return true;}});
  useEffect(()=>{try{localStorage.setItem(AUTOFILL_HARDPOINTS_KEY,autoFillHardpoints?"1":"0");}catch{}},[autoFillHardpoints]);
  // The bottom nav is hidden with no active fit (see its render), so any other tab would be a
  // screen with no way out. Send it home whenever the fit goes away.
  useEffect(()=>{ if(!activeFit?.ship && bottomTab!=="fittings") setBottomTab("fittings"); },[activeFit,bottomTab]);
  // One-shot override for the explicit "open in a new tab" affordances, consumed by the next
  // loadFit. A ref rather than state so setting it cannot race the load it is meant to modify.
  const wantNewTab=useRef(false);
  // A render-visible mirror of the ref above, purely so the Fits list can say what the next tap is
  // going to do. Only the + arms it: the other two setters of the ref (an EFT/ESI import, the
  // Effects screen's "open this fit") never send you to the list, so there is nothing to caption.
  const[newTabIntent,setNewTabIntent]=useState(false);
  // The fit restored at launch comes straight out of localStorage rather than through loadFit, so
  // nothing registered its tab. Seed it once on mount -- but ONLY if the strip already has tabs.
  //
  // An empty strip is a legitimate state, not a gap to be filled: it means the user is not using
  // tabs. Seeding unconditionally meant closing every tab was undone by the next launch, which is
  // the same "don't drag me into the tab system" problem as a plain open creating one.
  useEffect(()=>{
    if(!activeFit?.ship||!activeFit?.fitName)return;
    setOpenTabs(prev=>{
      const list=prev??[];
      if(!list.length)return list;
      if(list.some(t=>t.ship===activeFit.ship&&t.name===activeFit.fitName))return list;
      const fit=fitsDB[activeFit.ship]?.find(f=>f.name===activeFit.fitName);
      if(!fit)return list;
      return [...list,{ship:activeFit.ship,id:fit.id,name:activeFit.fitName}];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  const[priceHub,setPriceHub]=useState(()=>{try{return localStorage.getItem('axis_pricehub')??'Jita';}catch{return 'Jita';}});
  useEffect(()=>{try{localStorage.setItem('axis_pricehub',priceHub);}catch{}},[priceHub]);
  const[priceSource,setPriceSource]=useState(()=>{try{return localStorage.getItem('axis_pricesource')??'fuzzwork';}catch{return 'fuzzwork';}});
  useEffect(()=>{try{localStorage.setItem('axis_pricesource',priceSource);}catch{}},[priceSource]);
  const[projFits,setProjFits]=useState(initialFit?.projFits??[]);
  const[cmdFits,setCmdFits]=useState(initialFit?.cmdFits??[]);
  const[skills,setSkills]=useState(()=>{try{const s=localStorage.getItem("pyfa-skills");if(s)return{...SKILL_DEFAULTS,...JSON.parse(s)};}catch{}return SKILL_DEFAULTS;});
  // Named copies of that sheet, saved from Settings → Skills and offered in the per-fit Pilot picker.
  // Keyed `pyfa-*` rather than `axis_*` — unlike the implant loadouts, a fit REFERENCES one of these
  // by id (`profile:<id>`), so a key outside backup-io's `pyfa[-_]` net would restore a fit whose
  // named pilot no longer exists and silently drop it back to the app-wide sheet.
  const[skillProfiles,setSkillProfiles]=useState(()=>{try{const s=JSON.parse(localStorage.getItem(SKILL_PROFILES_KEY)??'[]');return Array.isArray(s)?s:[];}catch{return [];}});
  useEffect(()=>{try{localStorage.setItem(SKILL_PROFILES_KEY,JSON.stringify(skillProfiles));}catch{}},[skillProfiles]);
  // Every linked character's synced sheet, keyed by character id — written by the ESI sync, read
  // here so a fit that names a pilot resolves without a network call. Re-read on the same change
  // event the ESI panels use, so syncing a character updates an open fit immediately.
  const[esiSkills,setEsiSkills]=useState(()=>esi.getAllCharacterSkills());
  useEffect(()=>esi.onCharactersChanged(()=>setEsiSkills(esi.getAllCharacterSkills())),[]);
  // The sheet THIS fit is flown with. A fit can name its pilot (`slots.pilot`); with none named it
  // falls back to the app-wide sheet, which is what every fit did before pilots existed.
  const fitSkills=useMemo(()=>resolvePilotSkills(slots?.pilot,{appSkills:skills,esiSkills,profiles:skillProfiles,fallback:skills}),
                          [slots?.pilot,skills,esiSkills,skillProfiles]);
  // The sheet a SOURCE fit (projected / command) is flown with. Resolved exactly like `fitSkills`,
  // so a saved fit reads the same whether you are editing it or projecting it — the skills it was
  // last edited under are the skills it keeps. Shared with the Effects tab, which renders a card for
  // each of these: the card and the applied value have to resolve identically or they disagree, and
  // that has happened before (see the burst comment below).
  const sourceSkills=useMemo(()=>(fit)=>resolvePilotSkills(fit?.slots?.pilot,{appSkills:skills,esiSkills,profiles:skillProfiles,fallback:skills}),
                             [skills,esiSkills,skillProfiles]);
  // What the RESOLVED sheet is, in words, for the snapshot card's footer. Derived from the sheet
  // rather than from `slots.pilot`, so a fit with no pilot named still says whether the app-wide
  // sheet it fell back to is all V or someone's actual character.
  const fitSkillLabel=useMemo(()=>describeSkillSheet(fitSkills,{esiSkills,characters:esi.listCharacters(),profiles:skillProfiles}),
                              [fitSkills,esiSkills,skillProfiles]);
  // Can this character actually fly the fit? Checked against every fitted item's own
  // requiredSkillN/requiredSkillNLevel, not just the skills the dogma engine reads.
  const skillCheck=useMemo(()=>activeFit?.ship
    ? checkFitSkills(lookupShip(activeFit.ship)??{name:activeFit.ship,typeID:tidByName(activeFit.ship)},slots,drones,fighters,fitSkills)
    : {ok:true,missing:[]},
  [activeFit,slots,drones,fighters,fitSkills]);
  // Shared by the local fit's own command tab AND by each PROJECTED fit's command tab below — a
  // projected logi (e.g. a Guardian) can carry its own cmdFits (its own Sleipnir/Claymore links),
  // saved on that fit exactly like the active fit's are (see the fitsDB-writeback effect below).
  const buildExternalBursts=(cmdFitsList)=>{
    const out=[];
    for(const cf of (cmdFitsList??[])){
      // `active` is opt-OUT (undefined counts as on), so fits saved before the toggle existed keep
      // applying and no storage migration is needed.
      if(cf.active===false)continue;
      const fit=fitsDB[cf.ship]?.find(f=>f.name===cf.fitName);
      if(!fit)continue;
      // The BOOSTER'S OWN fit decides who flies it: its `slots.pilot` if it names one, otherwise the
      // app-wide sheet — the same resolution the Effects tab uses to DRAW this list. That shared
      // resolver is the point. The two used to be computed separately and silently disagreed: the
      // applied burst took the local sheet while the card beside it was hardcoded to all V, so a
      // Vargur under Sleipnir links read 141.9k EHP against pyfa's 146k with the card still saying
      // 22.5%. They only matched while every skill was unset (and so defaulted to V); the moment a
      // real character was synced from ESI they came apart.
      const bursts=computeCommandBursts({name:cf.ship,typeID:tidByName(cf.ship)},fit.slots,sourceSkills(fit),{implants:fit.implants,boosters:fit.boosters});
      for(const b of bursts)out.push(b);
    }
    return out;
  };
  const externalBursts=useMemo(()=>buildExternalBursts(cmdFits),[cmdFits,fitsDB,sourceSkills]);
  const projectedEffects=useMemo(()=>{
    // Collected, not summed: incoming remote reps go through a diminishing-returns curve that
    // needs every source's amount AND cycle time together (applyRemoteRepDiminishing).
    const repEntries={shield:[],armor:[],hull:[]};
    const webMults=[]; let neutGJs=0, capGJs=0;
    const capEntries=[];   // projected Remote Capacitor Transmitters, kept for the Projected list
    const col={sig:[],lock:[],scan:[],trk:[],topt:[],tfall:[],mrng:[],edly:[],avel:[],acld:[]};
    const boosts={lock:[],scan:[]};   // projected Remote Sensor Boosters -> attribute pool, not the debuff stack
    // ECM is kept as raw per-type strengths, range-factored but NOT yet reduced to one number —
    // which of the four attributes matters depends on the TARGET's sensor type, which calcFitStats
    // (not this memo) knows. See calcFitStats's jamChance for the combination itself.
    const ecmEntries=[];
    // Target EWAR resistance. Overwhelmingly a COMMAND BURST effect (buff 19, Electronic Hardening)
    // rather than a hull attribute, so externalBursts has to go in or every boosted fit reads as
    // having no resistance and projected damps/disruptors hit at full strength. Applied PER SOURCE
    // MODULE, before stacking — stack(b*r) != stack(b)*r, and eos does the former.
    const tShip=activeFit?.ship;
    const R=(projFits.length&&tShip)?projectionResistances({name:tShip,typeID:tidByName(tShip)},slots,fitSkills,{externalBursts}):null;
    const rz=k=>(R&&Number.isFinite(R[k])?R[k]:1);
    // disallowAssistance (in practice: an ACTIVE HIC bubble) refuses ALL incoming remote
    // assistance - reps and remote sensor boosters - while still taking EWAR normally.
    const noAssist=!!R?.disallowAssistance;
    for(const pf of projFits){
      if(pf.active===false)continue;   // see the cmdFits loop — opt-out, so old saves stay active
      const fit=fitsDB[pf.ship]?.find(f=>f.name===pf.fitName);
      if(!fit)continue;
      // All V for the same reason as externalBursts above: a PROJECTED fit is another pilot's
      // ship, so the local skill sheet has no business scaling its logi reps, webs or neuts —
      // unless that fit names its own pilot.
      // The projected fit's OWN command links (e.g. a Guardian sitting under its own Sleipnir's
      // Rapid Repair burst) boost ITS reps before they ever reach the target — read from that
      // fit's saved cmdFits, not the locally-edited fit's, or a boosted logi projects as if unboosted.
      const eff=computeProjectedReps({name:pf.ship,typeID:tidByName(pf.ship)},fit.slots,sourceSkills(fit),{implants:fit.implants,boosters:fit.boosters,drones:fit.drones,externalBursts:buildExternalBursts(fit.cmdFits)});
      const rangeM=(pf.rangeKm??30)*1000;
      const rf=(o,fo)=>calcRangeFactor(o,fo,rangeM,true);
      if(!noAssist)for(const r of eff.reps)repEntries[r.kind].push({amount:r.amount*rf(r.optimal,r.falloff),cycleS:r.cycleS});
      for(const w of eff.webs)webMults.push(1+(w.speedFactor*rz('web')*rf(w.optimal,w.falloff))/100);
      for(const n of eff.neuts)neutGJs+=n.gjPerSec*rz('neut')*rf(n.optimal,n.falloff);
      // Remote capacitor transfer is ASSISTANCE: refused wholesale by disallowAssistance (an
      // active HIC bubble), and NOT reduced by the target's EWAR resistance the way a neut is.
      if(!noAssist)for(const c of (eff.caps||[])){const g=c.gjPerSec*rf(c.optimal,c.falloff);if(g>0){capGJs+=g;capEntries.push({name:c.name,ship:pf.ship,gjPerSec:g});}}
      for(const p of (eff.painters||[]))col.sig.push(p.sigBonus*rz('painter')*rf(p.optimal,p.falloff));
      for(const d of (eff.damps||[])){col.lock.push(d.lockBonus*rz('damp')*rf(d.optimal,d.falloff));col.scan.push(d.scanResBonus*rz('damp')*rf(d.optimal,d.falloff));}
      // Remote Sensor Booster: ASSISTANCE (not resisted), and a BONUS — so it must compete with the
      // ship's own signal amps/Sensor Optimization burst in one penalized group. Only the attribute
      // pool can do that, so these are handed to calcFitStats rather than stacked here.
      if(!noAssist)for(const b of (eff.sensorBoosts||[])){if(b.lockBonus)boosts.lock.push(b.lockBonus*rf(b.optimal,b.falloff));if(b.scanResBonus)boosts.scan.push(b.scanResBonus*rf(b.optimal,b.falloff));}
      for(const t of (eff.trackDisr||[])){const f=rz('disrupt')*rf(t.optimal,t.falloff);col.trk.push(t.tracking*f);col.topt.push(t.optimalBonus*f);col.tfall.push(t.falloffBonus*f);}
      for(const g of (eff.guideDisr||[])){const f=rz('disrupt')*rf(g.optimal,g.falloff);col.mrng.push(g.missileRange*f);col.edly.push(g.explosionDelay*f);col.avel.push(g.aoeVel*f);col.acld.push(g.aoeCloud*f);}
      // ECM jammers carry remoteResistanceID 2253 = ECMResistance, so they are resisted like any other
      // EWAR (eos multiplies the strength by getResistance before addProjectedEcm). ECCM is priced in
      // separately, on the denominator: jamChance divides by this fit's engine-computed sensorStrength.
      for(const e of (eff.ecm||[])){const f=rz('ecm')*rf(e.optimal,e.falloff);const bt={};for(const k in e.byType)bt[k]=(e.byType[k]||0)*f;ecmEntries.push({byType:bt,ship:pf.ship});}
    }
    const reps={shield:applyRemoteRepDiminishing(repEntries.shield),armor:applyRemoteRepDiminishing(repEntries.armor),hull:applyRemoteRepDiminishing(repEntries.hull)};
    const webMult=webMults.length?stackingPenalty(webMults):1;
    const stackPct=(arr)=>arr.length?(stackingPenalty(arr.map(p=>1+p/100))-1)*100:0;
    const debuffs={sig:stackPct(col.sig),lockRange:stackPct(col.lock),scanRes:stackPct(col.scan),tracking:stackPct(col.trk),turretOptimal:stackPct(col.topt),turretFalloff:stackPct(col.tfall),missileRange:stackPct(col.mrng),explosionDelay:stackPct(col.edly),aoeVel:stackPct(col.avel),aoeCloud:stackPct(col.acld)};
    const hasDebuff=Object.values(debuffs).some(v=>Math.abs(v)>0.05);
    // ecmResist is handed out so the Projected card can scale a jammer the same way this memo does;
    // the card applies its OWN range factor (it has a per-card range slider), so it cannot reuse
    // ecmEntries directly.
    return {reps,webMult,neutGJs,capGJs,capEntries,debuffs:hasDebuff?debuffs:null,boosts,ecm:ecmEntries,ecmResist:rz('ecm')};
  },[projFits,fitsDB,fitSkills,sourceSkills,activeFit,slots,externalBursts]);
  const projectedReps=projectedEffects.reps;
  const snapshotStats=useMemo(()=>{
    const shipName=activeFit?.ship;
    if(!shipName) return null;
    try{
      // lookupShip, not the bare {name,typeID} shape other calcFitStats calls below use — jamChance
      // needs ship.sensorType, which only lookupShip's fuller record carries.
      const sh=lookupShip(shipName)??{name:shipName,typeID:tidByName(shipName)};
      return calcFitStats(sh,slots,drones??[],fitSkills,{fighters,implants,boosters,externalBursts,projectedEcm:projectedEffects?.ecm,pilotSec:slots?.pilotSec,systemSecurity:slots?.systemSecurity});
    }catch{ return null; }
  },[activeFit,slots,drones,fighters,fitSkills,implants,boosters,externalBursts,projectedEffects]);
  const shipMeta=useMemo(()=>{
    const sh=activeFit?.ship?lookupShip(activeFit.ship):null;
    return {faction:sh?.race??"",cls:sh?.hullClass??sh?.groupName??""};
  },[activeFit]);
  // One memo, two consumers: the drone rows read `droneInfo` and the drone INFO SHEET reads the
  // engine items behind those rows (for its current-vs-base attribute columns). Splitting them into
  // two memos would mean running the whole fit twice to answer one screen.
  const _droneCs=useMemo(()=>{
    const shipName=activeFit?.ship;
    if(!shipName) return null;
    try{
      return calcFitStats({name:shipName,typeID:tidByName(shipName)},slots,drones??[],fitSkills,{implants,boosters,externalBursts,projectedEffects,pilotSec:slots?.pilotSec,systemSecurity:slots?.systemSecurity});
    }catch{ return null; }
  },[activeFit,slots,drones,fitSkills,implants,boosters,externalBursts,projectedEffects]);
  const droneInfo=_droneCs?.droneInfo??[];
  const fittedDrones=_droneCs?.fittedDrones??null;
  const fighterInfo=useMemo(()=>{
    const shipName=activeFit?.ship;
    if(!shipName||!(fighters?.length)) return [];
    try{
      const cs=calcFitStats({name:shipName,typeID:tidByName(shipName)},slots,drones??[],fitSkills,{implants,boosters,externalBursts,damageProfile:dmgProfile?.p,pilotSec:slots?.pilotSec,systemSecurity:slots?.systemSecurity,fighters:fighters.map(f=>({name:f.name,qty:f.qty??1,active:f.active,abilities:f.abilities}))});
      return cs?.fighterDetails ?? [];
    }catch{ return []; }
  },[activeFit,slots,drones,fitSkills,implants,boosters,externalBursts,fighters,dmgProfile]);
  const[factorInReload,setFactorInReload]=useState(()=>{try{return localStorage.getItem("pyfa-factor-reload")==="1";}catch{return false;}});
  const[fittingsView,setFittingsView]=useState(()=>{try{const db=getLoadedFitsDB();const af=JSON.parse(localStorage.getItem("pyfa-activefit")||"null");if(db&&af&&db[af.ship]?.find(f=>f.name===af.fitName))return"active";}catch{}return"browse";});
  // Set while the browser was opened by the menu's "New Fit", which tells the ship rows the user
  // has already committed to starting something — so picking a hull builds the fit instead of
  // listing what's already on it. Any other route into the browser leaves it false.
  const[newFitIntent,setNewFitIntent]=useState(false);
  const[showShipInfo,setShowShipInfo]=useState(false);
  const[showPilot,setShowPilot]=useState(false);
  const[showImportFit,setShowImportFit]=useState(false);
  // Set only when the "From EFT" chooser button's direct clipboard-import couldn't finish on its
  // own (see the onSelect below) — pre-fills the fallback sheet with whatever text/error it got,
  // instead of the sheet opening blank and asking the user to hit "Read from Clipboard" again.
  const[importFitInitial,setImportFitInitial]=useState(null);
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
      if(s.mutaplasmid)continue;   // abyssal: not a market item, and its roll belongs to THIS base type
      idsToPrice.add(s.typeID);
      for(const v of (moduleVariations?.[String(s.typeID)]??[]))if(v?.typeID)idsToPrice.add(v.typeID);
    }
    let priceMap;
    // fetchPrices carries its own timeout, so this always settles — offline, the banner says so
    // rather than sitting on "Checking market prices…" until the app is restarted.
    try{priceMap=await fetchPrices([...idsToPrice],priceHub);}
    catch(e){setPriceBanner({kind:"none",msg:e?.offline?"No connection — market prices need internet":"Couldn't fetch market prices — try again"});setTimeout(()=>setPriceBanner(null),3500);return;}
    let swapped=0;
    const patchSection=sec=>(slots[sec]??[]).map(s=>{
      const next=optimizeSlotPrice(s,priceMap);   // returns `s` itself when nothing changes
      if(next!==s)swapped++;
      return next;
    });
    const patched={...slots};
    for(const sec of sections)patched[sec]=patchSection(sec);
    if(!swapped){setPriceBanner({kind:"none",msg:"No cheaper equivalents found"});setTimeout(()=>setPriceBanner(null),3000);return;}
    setSlots(patched);
    setPriceBanner({kind:"success",msg:`Fit price optimized — ${swapped} module${swapped>1?"s":""} swapped`});
    setTimeout(()=>setPriceBanner(null),3500);
  };
  // `fitOverride` is for a fit that was JUST created and is not in fitsDB yet. setFitsDB is async,
  // so a caller that creates a fit and then loads it by name closes over the previous map and finds
  // nothing -- which silently skipped the tab registration (the fit opened, but never as a tab)
  // while still setting activeFit, so it looked like it half-worked. Passing the object removes the
  // timing question entirely.
  // `keepPage` leaves you on whatever screen you were already on. Switching between OPEN TABS is the
  // case: the tabs are a way to compare the same aspect of two fits, so being thrown back to the Fit
  // page meant re-navigating to Effects (or Drones, or Cargo) after every switch — which is most of
  // the work the strip exists to save. Opening a fit from the library still lands on the Fit page,
  // because there you picked the fit itself rather than a comparison.
  const loadFit=(ship,fitName,fitOverride,keepPage)=>{
    const fit=fitOverride??fitsDB[ship]?.find(f=>f.name===fitName);
    // A different fit is a fresh read, so it starts at the top rather than wherever the last one was
    // scrolled to. Re-opening the fit you are already in keeps your place.
    if(activeFit?.ship!==ship||activeFit?.fitName!==fitName) resetScrollMemory();
    setActiveFit({ship,fitName});
    // Every route into a fit goes through here, so this is the one place that sees an "open".
    if(fit) setRecentFits(prev=>{
      const rest=(prev??[]).filter(r=>!(r.ship===ship&&(r.id!=null&&fit.id!=null?r.id===fit.id:r.name===fitName)));
      return [{ship,id:fit.id,name:fitName},...rest].slice(0,8);
    });
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
      // Match on id only when BOTH sides have a usable one. The old test was `t.id != null`, which
      // is TRUE for NaN — and NaN === NaN is false, so a fit carrying a NaN id never matched its
      // own tab and every open appended another copy. Falling back to the name is always safe here:
      // a ship's fit names are unique by construction (createNewFit dedupes them).
      const at=list.findIndex(t=>t.ship===ship&&sameTab(t,fit,fitName));
      if(at>=0)return list;
      const entry={ship,id:fit.id,name:fitName};
      // A PLAIN open must never drag someone into the tab system who is not using it. With the
      // strip empty, opening a fit just swaps what is on screen and the strip stays empty.
      //
      // This branch used to fall through to the seeding below, which pushed the fit you were
      // leaving AND the one you opened -- so a plain open with no tabs at all produced TWO tabs
      // out of nothing. That seeding is only correct when a new tab was explicitly asked for.
      if(!newTab){
        if(!list.length)return list;
        const cur=prevFit?list.findIndex(t=>t.ship===prevFit.ship&&t.name===prevFit.fitName):-1;
        // Replace the tab you were in; if the current fit somehow has no tab, append rather than
        // silently dropping the fit being opened.
        if(cur>=0){const next=[...list];next[cur]=entry;return next;}
        const appended=[...list,entry];
        return appended.length>MAX_OPEN_TABS?appended.slice(appended.length-MAX_OPEN_TABS):appended;
      }
      // Explicitly asking for a new tab: keep what you were already working on. The fit you are
      // leaving does not always have a tab yet -- a fit made with "+ New Fit" never went through
      // loadFit, so nothing ever registered one -- and appending alone silently dropped it, leaving
      // the strip showing only the fit you just opened. Seed the outgoing fit as tab 1 first.
      const base=[...list];
      if(prevFit?.ship&&prevFit?.fitName&&!base.some(t=>t.ship===prevFit.ship&&t.name===prevFit.fitName)){
        const pf=fitsDB[prevFit.ship]?.find(f=>f.name===prevFit.fitName);
        if(pf)base.push({ship:prevFit.ship,id:pf.id,name:prevFit.fitName});
      }
      const next=[...base,entry];
      return next.length>MAX_OPEN_TABS?next.slice(next.length-MAX_OPEN_TABS):next;
    });
    setSlots(fit?.slots?reconcileRacks(fit.slots,lookupShip(ship)):generateEmptySlots(lookupShip(ship)));
    setDrones(fit?.drones??[]);
    setFighters(fit?.fighters??[]);
    setCargoItems(fit?.cargo??[]);
    setImplants(fit?.implants??emptyImplants());
    setBoosters(fit?.boosters??[]);
    setProjFits(fit?.projFits??[]);
    setCmdFits(fit?.cmdFits??[]);
    if(!keepPage){setFittingsView("active");setBottomTab("fittings");}
  };
  const importFit=(parsed)=>{
    const{shipName,fitName}=parsed;
    // Built OUTSIDE the updater so it can be handed straight to loadFit — the setFitsDB below is
    // still pending when loadFit runs, so a lookup by name would miss it.
    const existing=fitsDB[shipName]||[];
    const exIdx=existing.findIndex(f=>f.name===fitName);
    const entry=buildFitEntry(parsed,{id:exIdx>=0?existing[exIdx].id:Date.now(),buildBooster:buildBoosterFromName});
    setFitsDB(db=>{
      const ex=db[shipName]||[];
      const idx=ex.findIndex(f=>f.name===fitName);
      if(idx>=0){const u=[...ex];u[idx]=entry;return{...db,[shipName]:u};}
      return{...db,[shipName]:[...ex,entry]};
    });
    // Importing used to set every piece of state by hand, which meant it never went through the
    // tab bookkeeping and an imported fit simply did not appear in the strip. Same bug shape as
    // createNewFit had. Route it through loadFit instead, which owns that logic — and when the
    // user already has more than one tab open, don't clobber one of them.
    if((openTabs?.length??0)>=2) wantNewTab.current=true;
    loadFit(shipName,fitName,entry);
  };
  useEffect(()=>{if(!activeFit?.ship||!activeFit?.fitName)return;setFitsDB(db=>{const sf=db[activeFit.ship];if(!sf)return db;const idx=sf.findIndex(f=>f.name===activeFit.fitName);if(idx<0)return db;const u=[...sf];u[idx]={...u[idx],slots,drones,fighters,cargo:cargoItems,implants,boosters,projFits,cmdFits};return{...db,[activeFit.ship]:u};});},[slots,drones,fighters,cargoItems,implants,boosters,projFits,cmdFits,activeFit]);
  // Writes only the hulls whose array identity changed, in one IndexedDB transaction — the effect
  // above rebuilds exactly one hull's array per edit, so a keystroke costs one small record rather
  // than re-serialising the whole library the way the old localStorage blob did.
  useEffect(()=>{persistFitsDB(fitsDB);},[fitsDB]);
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
  // Bottom-nav badges, pyfa-style: a count only appears for things currently switched ON, not
  // everything carried in the bay/cargo hold. Implants have no on/off state (they're active the
  // moment they're slotted), so that one is just a fill count.
  const navBadges=useMemo(()=>({
    cargo:(cargoItems??[]).length,
    drones:(drones??[]).filter(d=>d.active).reduce((s,d)=>s+(d.qty??1),0)
      +(fighters??[]).filter(f=>f.active!==false).reduce((s,f)=>s+(f.qty??1),0),
    implants:(implants??[]).filter(i=>i.name!=="[Empty]").length,
    effects:(boosters??[]).filter(b=>b.active).length
      +(projFits??[]).filter(f=>f.active!==false).length
      +(cmdFits??[]).filter(f=>f.active!==false).length
      +(slots?.environment?1:0),
  }),[cargoItems,drones,fighters,implants,boosters,projFits,cmdFits,slots?.environment]);
  useEffect(()=>{
    const key=activeFit?`${activeFit.ship}\0${activeFit.fitName}`:null;
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
      if(next) loadFit(next.ship,next.name,undefined,true);
    }
  };
  // Deleting the fit you have open leaves the same hole as closing its tab, so it lands the same
  // way: step to the neighbouring tab. It used to just clear the active fit, which hides the bottom
  // nav (see its render) and the tab strip at once, stranding you on the Fits list until you opened
  // something else by hand.
  //
  // With an empty strip -- a legitimate state, since tabs are opt-in -- there is no neighbour, so it
  // falls back to another fit of the SAME ship: that is the list being looked at, and deleting one
  // of three Rifter fits should leave a Rifter open. Only when the ship has none left does the fit
  // actually clear, and that is the one case where losing the bottom nav is right: nothing to show.
  const deleteFit=(ship,fit)=>{
    const wasActive=activeFit?.ship===ship&&activeFit?.fitName===fit.name;
    const tabIdx=openFitTabs.findIndex(t=>t.ship===ship&&sameTab(t,fit,fit.name));
    const tabNext=tabIdx>=0?(openFitTabs[tabIdx+1]??openFitTabs[tabIdx-1]):null;
    const siblings=fitsDB[ship]??[];
    const sibIdx=siblings.findIndex(f=>f.id===fit.id);
    const sibNext=sibIdx>=0?(siblings[sibIdx+1]??siblings[sibIdx-1]):null;
    setFitsDB(prev=>{
      const next={...prev,[ship]:(prev[ship]||[]).filter(f=>f.id!==fit.id)};
      if(!next[ship].length) delete next[ship];
      return next;
    });
    if(!wasActive)return;
    // The deleted fit's tab is not pruned here: resolveTabs reconciles the strip against fitsDB on
    // every render, so it drops out on its own (see the openTabs comment).
    if(tabNext) loadFit(tabNext.ship,tabNext.name);
    else if(sibNext) loadFit(ship,sibNext.name);
    else setActiveFit(null);
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
  const[tabsOpen,setTabsOpen]=useState(false);
  // The header shrinks to a single line once you are scrolled into a screen, and comes back at
  // the top. Driven off ABSOLUTE position rather than scroll direction: direction-based toggling
  // flickers on the small bounces a finger makes mid-scroll.
  const[headerCollapsed,setHeaderCollapsed]=useState(false);
  const lastScrollTop=useRef(0);
  useEffect(()=>{
    const onScroll=(e)=>{
      const t=e.target;
      const y=(t&&typeof t.scrollTop==='number')?t.scrollTop:(document.scrollingElement?.scrollTop??0);
      const prev=lastScrollTop.current;lastScrollTop.current=y;
      // Scrolling down closes the strip; scrolling back up does NOT reopen it. Re-opening would
      // put the tab list back in front of someone who never asked for it, which is the whole
      // reason the strip is opt-in. The thin rail stays either way.
      if(y-prev>6)setTabsOpen(false);
      if(y>56)setHeaderCollapsed(true);
      else if(y<=8)setHeaderCollapsed(false);
    };
    window.addEventListener('scroll',onScroll,true);
    return()=>window.removeEventListener('scroll',onScroll,true);
  },[]);
  // Changing screen resets the scroll bookkeeping, and closes the strip so it never follows you
  // onto a screen you did not open it from.
  useEffect(()=>{setTabsOpen(false);setHeaderCollapsed(false);lastScrollTop.current=0;},[bottomTab,fittingsView]);
  // The + sends you to the Fits list with "next open goes in a new tab" armed. Backing out without
  // picking anything must disarm it, or a fit opened much later inherits the request -- but the
  // request has to survive DRILLING IN, which is the normal way to reach a fit: the list moves
  // "browse" -> "fits" (a ship's fits) before you ever tap one. Disarm only on actually leaving the
  // list, i.e. back to the active fit or off the Fits tab entirely.
  useEffect(()=>{
    if(bottomTab!=="fittings"||fittingsView==="active"){wantNewTab.current=false;setNewTabIntent(false);}
  },[bottomTab,fittingsView]);
  // Same reasoning for the menu's "New Fit", except it has no reason to survive the drill-in to a
  // ship's own fit list: reaching that means the hull was picked and the fit already exists.
  useEffect(()=>{
    if(bottomTab!=="fittings"||fittingsView!=="browse")setNewFitIntent(false);
  },[bottomTab,fittingsView]);
  const returnToFit=()=>{setBottomTab("fittings");setFittingsView("active");};
  // `height`, not `minHeight`: the shell is exactly one viewport tall and clips, so the flex
  // children below finally have a bounded height and each screen's own overflowY:auto region takes
  // over. With minHeight the column just grew and the DOCUMENT scrolled, which is what dragged the
  // bottom nav off the bottom of the screen.
  return(<SkillsProvider value={fitSkills}>
  <div className="app-shell" style={{background:C.bg,display:"flex",justifyContent:"center"}}>
    <style>{getGlobalCss()}</style>
    <div className="app-col" style={{height:"100%",display:"flex",flexDirection:"column",background:C.bg}}>
      {/* onShipInfo only when there IS a ship: the setter used to fire unconditionally while the
          sheet rendered on `showShipInfo && activeFit?.ship`, so tapping the header thumbnail with
          no fit open armed the flag invisibly and the next fit you created opened the sheet. */}
      <AppHeader collapsed={headerCollapsed} onHamburger={()=>setShowHamburger(true)} activeFit={activeFit} onShipInfo={activeFit?.ship?()=>setShowShipInfo(true):undefined} skillCheck={skillCheck} onSkillGaps={()=>setShowPilot(true)} pilot={slots?.pilot??null}/>
      {(bottomTab!=="fittings"||(fittingsView&&fittingsView!=="active"))&&<ActiveFitBar activeFit={activeFit} onReturn={returnToFit}/>}
      {/* Tab strip. Hidden on the Fits LIST, where the list itself is the navigation and a second
          row of fit names would just be noise. */}
      {!(bottomTab==="fittings"&&fittingsView&&fittingsView!=="active")&&
        <FitTabs tabs={openFitTabs} activeFit={activeFit} open={tabsOpen}
                 onSelect={t=>loadFit(t.ship,t.name,undefined,true)} onClose={closeFitTab}
                 onReorder={order=>setOpenTabs(order)}
                 onCloseAll={()=>setOpenTabs([])}
                 onToggle={()=>setTabsOpen(o=>!o)}
                 onOpenLibrary={()=>{wantNewTab.current=true;setNewTabIntent(true);setBottomTab("fittings");setFittingsView("browse");}}/>}
      {/* minHeight:0 is load-bearing — a flex child defaults to min-height:auto, which refuses to
          shrink below its content and would let the screens push the bottom nav off-screen again. */}
      <div style={{flex:1,minHeight:0,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        {bottomTab==="fittings"&&<FittingsScreen recents={recentFits} undo={undo} undoDepth={undoDepth} activeFit={activeFit} setActiveFit={setActiveFit} loadFit={loadFit} deleteFit={deleteFit} view={fittingsView} setView={setFittingsView} fitsDB={fitsDB} setFitsDB={setFitsDB} slots={slots} setSlots={setSlots} setDrones={setDrones} setFighters={setFighters} fighters={fighters} setCargoItems={setCargoItems} setImplants={setImplants} setBoosters={setBoosters} setProjFits={setProjFits} setCmdFits={setCmdFits} skills={fitSkills} sourceSkills={sourceSkills} openFitTabs={openFitTabs} implants={implants} boosters={boosters} drones={drones} factorInReload={factorInReload} setFactorInReload={setFactorInReload} externalBursts={externalBursts} projectedReps={projectedReps} projectedEffects={projectedEffects} dmgProfile={dmgProfile} setDmgProfile={setDmgProfile} tgtProfile={tgtProfile} setTgtProfile={setTgtProfile} priceHub={priceHub} setPriceHub={setPriceHub} priceSource={priceSource} newFitIntent={newFitIntent} setNewFitIntent={setNewFitIntent} newTabIntent={newTabIntent} autoFillHardpoints={autoFillHardpoints}/>}
        {bottomTab==="cargo"   &&<CargoScreen items={cargoItems} setItems={setCargoItems} slots={slots} shipCapacity={(()=>{const t=tidByName(activeFit?.ship);return t&&TYPES[t]?(TYPES[t].attrs?.capacity??1150):1150;})()} />}
        {bottomTab==="drones"  &&<DronesScreen drones={drones} setDrones={setDrones} droneInfo={droneInfo} fittedDrones={fittedDrones} fighters={fighters} setFighters={setFighters} fighterInfo={fighterInfo} maxActiveDrones={snapshotStats?.maxActiveDrones??5} shipDroneBay={snapshotStats?.droneBay??0} shipDroneBandwidth={snapshotStats?.droneBandwidth??0} shipFighter={(()=>{const t=tidByName(activeFit?.ship);const a=t&&TYPES[t]?TYPES[t].attrs:null;return a?{cap:a.fighterCapacity??0,tubes:a.fighterTubes??0,light:a.fighterLightSlots??0,heavy:a.fighterHeavySlots??0,support:a.fighterSupportSlots??0}:{cap:0,tubes:0,light:0,heavy:0,support:0};})()} />}
        {bottomTab==="implants"&&<ImplantsScreen implants={implants} setImplants={setImplants} loadouts={implantLoadouts} setLoadouts={setImplantLoadouts}/>}
        {bottomTab==="effects" &&<EffectsScreen fitsDB={fitsDB} boosters={boosters} setBoosters={setBoosters} projFits={projFits} setProjFits={setProjFits} cmdFits={cmdFits} setCmdFits={setCmdFits} sourceSkills={sourceSkills} openFitTabs={openFitTabs} environment={slots?.environment??null} setEnvironment={(n)=>setSlots(prev=>({...prev,environment:n||undefined}))} jamTarget={{strength:snapshotStats?.sensorStrength??0,type:snapshotStats?.sensorType??"",resist:projectedEffects?.ecmResist??1}} onOpenFit={(ship,fitName)=>{wantNewTab.current=true;loadFit(ship,fitName);}}/>}
      </div>
      {/* Every tab except Fittings operates ON a fit — Cargo, Drones, Implants and Effects all have
          nothing to act on with no ship selected, so the bar is five dead buttons taking a row of
          screen on the one page (the ship library) that most wants the space. */}
      {!!activeFit?.ship&&<BottomNav active={bottomTab} onChange={setBottomTab} badges={navBadges}/>}
    </div>
    {priceBanner&&<div style={{position:"fixed",top:"calc(12px + env(safe-area-inset-top, 0px))",left:"50%",transform:"translateX(-50%)",zIndex:300,background:priceBanner.kind==="success"?C.success:C.surfaceAlt,color:priceBanner.kind==="success"?"#0e0e10":C.textMid,border:priceBanner.kind==="success"?"none":`1px solid ${C.border}`,borderRadius:10,padding:"10px 16px",fontSize:13,fontWeight:700,boxShadow:"0 6px 20px rgba(0,0,0,.35)",maxWidth:"90%",textAlign:"center"}}>{priceBanner.kind==="success"?"✓ ":""}{priceBanner.msg}</div>}
    {showHamburger&&<HamburgerMenu onClose={()=>setShowHamburger(false)} onOpenSettings={()=>{setShowSettings(true);setShowHamburger(false);}} onImport={()=>setShowImportChooser(true)} onExport={()=>{setShowExportChooser(true);setShowHamburger(false);}} onSnapshot={()=>{setShowSnapshot(true);setShowHamburger(false);}} onFeedback={()=>{setShowFeedback(true);setShowHamburger(false);}} onOptimizePrice={()=>{optimizeFitPrice();setShowHamburger(false);}} onNewFit={()=>{setBottomTab("fittings");setFittingsView("browse");setNewFitIntent(true);}}/>}
    {showImportChooser&&<ChooserSheet title="Import Fit" onClose={()=>setShowImportChooser(false)} options={[
      {icon:IconClipboard,label:"From EFT",sub:"Paste from clipboard",onSelect:async()=>{
        // Skip the sheet on the golden path: read the clipboard and import immediately, so a fit
        // copied in-game lands in three fewer taps ("Read from Clipboard" + "Import '<name>'" gone).
        // Anything that isn't a clean success — unreadable/empty clipboard, text that isn't EFT —
        // falls back to the sheet, pre-filled with what was found, rather than failing silently.
        setShowImportChooser(false);
        const{text,why}=await readClipboardText();
        if(text==null){setImportFitInitial({text:"",err:`Couldn't read the clipboard${why?` — ${why}`:""}. Paste manually below.`});setShowImportFit(true);return;}
        if(!text.trim()){setImportFitInitial({text:"",err:"The clipboard is empty — copy a fit first, then tap this again."});setShowImportFit(true);return;}
        const parsed=parseEFT(text);
        if(parsed.error){setImportFitInitial({text,err:parsed.error});setShowImportFit(true);return;}
        haptic();
        importFit(parsed);
        setPriceBanner({kind:"success",msg:`Imported "${parsed.fitName}"`});setTimeout(()=>setPriceBanner(null),3000);
      }},
      {icon:IconCharacter,label:"From EVE Character",sub:"An in-game saved fitting",onSelect:()=>{setShowImportChooser(false);setShowEsiImport(true);}},
    ]}/>}
    {showExportChooser&&<ChooserSheet title="Export Fit" onClose={()=>setShowExportChooser(false)} options={[
      {icon:IconClipboard,label:"To EFT",sub:"Copy to clipboard",onSelect:()=>{setShowExportChooser(false);setShowExportFit(true);}},
      {icon:IconCharacter,label:"To EVE Character",sub:"Save into in-game fittings",onSelect:()=>{setShowExportChooser(false);setShowEsiExport(true);}},
    ]}/>}
    {showShipInfo&&activeFit?.ship&&<ShipInfoSheet ship={lookupShip(activeFit.ship)??{name:activeFit.ship}} cs={snapshotStats} onClose={()=>setShowShipInfo(false)}/>}
    {showPilot&&<PilotSheet pilot={slots?.pilot??null} setPilot={p=>setSlots(prev=>({...prev,pilot:p||undefined}))}
                            missing={skillCheck.missing} appSkills={skills} skillProfiles={skillProfiles} onClose={()=>setShowPilot(false)}/>}
    {showExportFit&&<ExportFitModal activeFit={activeFit} slots={slots} implants={implants} boosters={boosters} drones={drones} fighters={fighters} cargo={cargoItems} onClose={()=>setShowExportFit(false)}/>}
    {showSnapshot&&<SnapshotModal onClose={()=>setShowSnapshot(false)} fitName={activeFit?.fitName} shipName={activeFit?.ship} shipTypeID={tidByName(activeFit?.ship)} shipFaction={shipMeta.faction} shipClass={shipMeta.cls} slots={slots} cs={snapshotStats} drones={drones} fighters={fighters} implants={implants} boosters={boosters} cmdFits={cmdFits} projFits={projFits} fitsDB={fitsDB} skills={fitSkills} skillLabel={fitSkillLabel} priceHub={priceHub} priceSource={priceSource}/>}
    {showSettings &&<SettingsOverlay onClose={()=>setShowSettings(false)} skills={skills} setSkills={setSkills} skillProfiles={skillProfiles} setSkillProfiles={setSkillProfiles} openInNewTab={openInNewTab} setOpenInNewTab={setOpenInNewTab} priceHub={priceHub} setPriceHub={setPriceHub} priceSource={priceSource} setPriceSource={setPriceSource} themePref={themePref} setThemePref={setThemePref} autoFillHardpoints={autoFillHardpoints} setAutoFillHardpoints={setAutoFillHardpoints}/>}
    {showImportFit&&<ImportFitSheet onClose={()=>{setShowImportFit(false);setImportFitInitial(null);}} onImport={importFit} initialText={importFitInitial?.text} initialErr={importFitInitial?.err}/>}
    {showFeedback&&<FeedbackModal activeFit={activeFit} slots={slots} implants={implants} boosters={boosters} drones={drones} fighters={fighters} cargo={cargoItems} projFits={projFits} cmdFits={cmdFits} fitsDB={fitsDB} onClose={()=>setShowFeedback(false)}/>}
    {showEsiImport&&<EsiImportModal onClose={()=>setShowEsiImport(false)} onImport={importFit}/>}
    {showEsiExport&&<EsiExportModal activeFit={activeFit} slots={slots} drones={drones} cargoItems={cargoItems} fighters={fighters} implants={implants} boosters={boosters} onClose={()=>setShowEsiExport(false)}/>}
  </div>
  </SkillsProvider>);
}
