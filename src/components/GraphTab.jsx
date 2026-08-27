import { useState, useEffect, useMemo, useRef } from "react";
import { C } from "../theme.js";
import { haptic } from "../lib/core.js";
import { useScrollMemory } from "../lib/use-scroll-memory.js";
import { DAMAGE_PROFILES } from "../data/damage-profiles.js";
import { FitPickerSheet } from "./effects.jsx";
import { targetFitProfile } from "../lib/graph-target.js";
import {
  TYPES, tidByName, calcFitStats, computeProjectedReps,
  calcRangeFactor, calcTurretCTH, calcTurretMult, calcMissileFactor, calcAngularSpeed,
  stackingPenalty, simulateCapTrace,
} from "../calc.js";

// "Ideal" is a REAL point in the parameter space, not a special case: a stationary target with an
// effectively infinite signature. Both application terms reach their perfect limit at that input —
// the turret tracking factor is 0.5^((angular × sigRes)/(tracking × sig))², which goes to 1, and the
// missile factor is min(1, sig/explosionRadius, …), which pins at 1 — so every ship applies its full
// paper damage, which is the whole point of the preset.
//
// A large FINITE number, not Infinity: the graph's setup is persisted with JSON.stringify, and
// Infinity serialises to null.
//
// 1e15 is chosen, not guessed. It is the smallest round value at which the real math reproduces the
// old perfect-application short-circuit EXACTLY (0 ULP) across every turret in the game, including
// the worst case — a Dual Giga Beam, tracking 0.0021, at point-blank against a 5 km/s target. At
// 1e9 that case still drifted 6.5e-5; the regression suite pins the exact agreement so the constant
// cannot be lowered without the test noticing.
const IDEAL_SIG=1e15;

// Reference targets for the application curves. Only the graph uses these, so they live here.
//
// `mwdSig` / `mwdVel` are the same hull class with its microwarpdrive RUNNING, which is how most
// things are actually flown in combat — and it is not a small correction: a frigate's signature goes
// from 40 m to 200 m, which changes turret application against it more than any other single factor.
// Note it cuts BOTH ways, which is the point of making it a toggle rather than the default: the
// bigger signature helps turrets and missiles, while the much higher speed hurts turret tracking.
//
// These are DERIVED, not chosen. For each size class, every fittable hull in the ship taxonomy was
// given the size-appropriate T2 MWD (5MN / 50MN / 500MN), run active at all skills V through this
// app's own engine, and the resulting sig and velocity MEDIANED — median rather than mean so a
// handful of interceptors and oddball hulls don't drag the class. 95 frigates, 79 cruisers, 40
// battleships, none skipped. Raw medians were 201.3m / 3047 m/s, 690.0m / 1874 m/s and 2300.0m /
// 1039 m/s; rounded here to the nearest 5m and 10 m/s. The regression suite re-derives them, so an
// eve.db rebalance of hull signatures or speeds shows up as a failure rather than silent drift.
//
// The non-MWD `sig`/`vel` values are deliberately left alone: they are a "typical engagement" figure
// rather than a hull's flat-out maximum, which is why e.g. the frigate's 350 m/s is below the 444
// m/s median top speed. Only the MWD variants claim to be derived.
const TARGET_PROFILES={
  ideal:   {label:"Ideal",   sig:IDEAL_SIG, vel:0,   dist:0,     desc:"Stationary, infinite sig"},
  frigate: {label:"Frigate", sig:40,      vel:350,   dist:10000, desc:"40m sig / 350 m/s",   mwdSig:200,  mwdVel:3050},
  cruiser: {label:"Cruiser", sig:130,     vel:200,   dist:20000, desc:"130m sig / 200 m/s",  mwdSig:690,  mwdVel:1870},
  battleship:{label:"Battleship",sig:380, vel:100,   dist:30000, desc:"380m sig / 100 m/s",  mwdSig:2300, mwdVel:1040},
};
// A saved fit used as the target is `targetProfile === TARGET_FIT`, which is deliberately NOT an
// entry above: those are static sig/speed pairs, and a fit's are computed from the fit. There used
// to be a `fit:{sig:null,vel:null}` placeholder here, hidden again by a filter on the button row —
// applying it would have written a null sig, which is why it was never wired up.
const TARGET_FIT="fit";
/** The sig/speed a profile presents, with the MWD toggle applied where the profile has a variant. */
const profileTarget=(key,mwd)=>{
  const p=TARGET_PROFILES[key];
  if(!p) return null;
  return (mwd&&p.mwdSig!=null) ? {sig:p.mwdSig,vel:p.mwdVel} : {sig:p.sig,vel:p.vel};
};

const GRAPH_CONFIG=[
  {key:"damage",label:"Damage",icon:"sword",color:C.danger,showTargetControls:true,
   yAxes:[{key:"dps",label:"DPS"},{key:"volley",label:"Volley"},{key:"inflicted",label:"Damage inflicted"}],
   xAxes:[{key:"dist",label:"Distance, km"},{key:"time",label:"Time, s"},{key:"tgtSpeedMs",label:"Target speed, m/s"},{key:"tgtSpeedPct",label:"Target speed, %"},{key:"tgtSigM",label:"Target sig. radius, m"},{key:"tgtSigPct",label:"Target sig. radius, %"}]},
  {key:"ewar",label:"Ewar",icon:"radar",color:C.high,yAxes:[{key:"neutsCap",label:"Neuts: cap/s"},{key:"webSpeed",label:"Webs: speed red., %"},{key:"ecmStr",label:"ECM: combined strength"},{key:"dampLock",label:"Damps: lock range red., %"},{key:"tdRange",label:"Tracking disr: range red., %"},{key:"gdRange",label:"Guidance disr: range red., %"},{key:"tpSig",label:"Target paint: sig incr., %"}],xAxes:[{key:"dist",label:"Distance, km"}]},
  {key:"reps",label:"Reps",icon:"heart",color:C.rig,yAxes:[{key:"repSpeed",label:"Repair speed, HP/s"},{key:"repTotal",label:"Total repaired, HP"}],xAxes:[{key:"dist",label:"Distance, km"},{key:"time",label:"Time, s"}]},
  {key:"shieldRegen",label:"Shield",icon:"shield",color:C.mid,yAxes:[{key:"shieldAmt",label:"Shield, EHP"},{key:"shieldRegen",label:"Shield regen, EHP/s"}],xAxes:[{key:"time",label:"Time, s"},{key:"shieldPct",label:"Shield, %"}]},
  {key:"cap",label:"Capacitor",icon:"bolt",color:C.warning,yAxes:[{key:"capAmt",label:"Cap, GJ"},{key:"capRegen",label:"Cap regen, GJ/s"}],xAxes:[{key:"time",label:"Time, s"},{key:"capPct",label:"Cap, %"}]},
  {key:"mobility",label:"Mobility",icon:"rocket",color:C.low,yAxes:[{key:"speed",label:"Speed, m/s"},{key:"distance",label:"Distance, km"}],xAxes:[{key:"time",label:"Time, s"}]},
  {key:"warp",label:"Warp",icon:"warp",color:C.high,yAxes:[{key:"warpTime",label:"Warp time, s"}],xAxes:[{key:"distAU",label:"Distance, AU"},{key:"distKm",label:"Distance, km"}]},
  {key:"lock",label:"Lock",icon:"target",color:C.danger,yAxes:[{key:"lockTime",label:"Lock time, s"}],xAxes:[{key:"tgtSig",label:"Target sig. radius, m"}]},
];

// The one distance to evaluate at when the X axis is sweeping something other than range: the reach of
// the longest-ranged weapon on the fit, or 30 km if it has none. The speed and sig axes hold range
// constant at this while they vary the tracking inputs, and the angular-velocity readout quotes it, so
// the two cannot describe different engagements.
function engagementDistanceM(cs){
  let d = 0;
  for (const w of (cs?.graphWeapons ?? [])) d = Math.max(d, w.kind==="missile" ? (w.lowerRange||0) : (w.optimal || 0));
  return d > 0 ? d : 30000;
}

// Your own fitted web(s) at a given distance — range-scaled and stacking-penalised, same as the
// Damage graph's application curve. Shared so the transversal/angular readouts can't disagree with
// that curve about how fast a webbed target is actually moving; see the damage curve's own
// `webMultAt` (built from this) for the reasoning.
function ownWebMultAt(ownProj, distM) {
  const ms = (ownProj?.webs || []).map(w => 1 + (w.speedFactor * calcRangeFactor(w.optimal, w.falloff, distM, true)) / 100);
  return ms.length ? stackingPenalty(ms) : 1;
}
// Grapplers need no separate handling here: CCP files them in their own group but
// computeProjectedReps already folds both into `webs` (see the damage curve's own comment on this).

// Is your own scrambler/disruptor in range at `distM`? A scram doesn't scale speed itself — it just
// turns the target's MWD off, a state it either has or doesn't (hard-edged, no falloff) — so this
// only answers "in range", and the caller decides what turning the MWD off is worth.
function ownScrammedAt(ownProj, distM) {
  return (ownProj?.scrams || []).some(s => distM <= (s.optimal || 0));
}

function generateCurve(catKey,yKey,xKey,params={}){
  const{targetProfile="ideal",shipVelFrac=1,ship={},cs=null,xZoom=1}=params;
  // The X zoom control has to widen/narrow the DATA DOMAIN, not just the axis — otherwise zooming out
  // leaves the curve stopping dead at the old domain edge (e.g. damage-inflicted flatlining at 120s
  // while the axis ran to 160s). dom() scales every domain constant below by 1/xZoom; percentage axes
  // that are physically bounded (shield %, cap %) pass a cap so they never run past 100%.
  const XS = 1/(xZoom||1);
  const dom = (base,capMax)=>{ const d=base*XS; return capMax!=null?Math.min(d,capMax):d; };
  // Use real fit DPS from calcFitStats when available. Resist-weighted when a target profile is
  // set, so the Y axis scales to the curve actually drawn (which uses volleyEff); identical to the
  // raw totals when the profile is "None".
  const realDps   = cs?.effective?.totalDps?.total    ?? cs?.totalDps?.total    ?? cs?.weaponDps?.total    ?? 0;
  const realVolley= cs?.effective?.totalVolley?.total ?? cs?.totalVolley?.total ?? cs?.weaponVolley?.total ?? 0;
  let pts=[],xMax,yMax;
  if(catKey==="damage"){
    const weapons = cs?.graphWeapons ?? [];
    const baseDps = realDps || 0, baseVolley = realVolley || 0;
    const wantVolley = yKey==="volley";
    // Editable target sig/speed. There is no "ideal" short-circuit any more — the real application
    // math runs for every profile, with Ideal expressed as IDEAL_SIG (see above). The branch this
    // replaces ignored its tgtSig argument entirely, so the "Target sig. radius" X axis drew a FLAT
    // line whenever Ideal was selected: an axis whose whole job is to vary sig, plotted against a
    // formula that had been told to ignore it.
    const profSig = params.tgtSig ?? IDEAL_SIG;
    const profVel = params.tgtSpeed ?? 0;
    // YOUR OWN ewar, applied to the thing you are shooting. A web that is fitted and running is part
    // of how much damage lands, so leaving it out understated every tackle fit's application — and
    // the same modules were already drawn, at the same ranges, one tab over under Ewar.
    //
    // Range-scaled and stacking-penalised exactly as the Ewar graph does it, so the two cannot
    // disagree about what one web is worth at 15 km. Grapplers need no special case: CCP files them
    // in their own group but `computeProjectedReps` already folds both into `webs`.
    const PJ = params.ownProj || {};
    const rfE = (o,f,d) => calcRangeFactor(o,f,d,true);
    const webMultAt = (dM) => ownWebMultAt(PJ, dM);
    const sigMultAt = (dM) => { const ms=(PJ.painters||[]).map(p=>1+((p.sigBonus||0)*rfE(p.optimal,p.falloff,dM))/100); return ms.length?stackingPenalty(ms):1; };
    // A scrambler does not modify an attribute — it turns the target's microwarpdrive OFF, which is a
    // state the target either has or doesn't. `tgtNoMwd` is the same profile's not-MWDing sig/speed
    // pair, supplied only when the target is a preset currently running its MWD; against a hand-typed
    // sig or speed it is null, because there is no way to know how much of a typed 200 m is MWD bloom.
    // Tackle is hard-edged (no falloff), so this flips at exactly the scrambler's engine-computed
    // range — which on a Mordu's hull is a good deal further out than the module's own 9 km.
    const scrammedAt = (dM) => ownScrammedAt(PJ, dM);
    // `free` names the quantity the X AXIS is sweeping. Substituting the MWD-off value for it would
    // overwrite the axis with a constant and draw a flat line across a graph whose entire subject is
    // that quantity — the same trap the tgtSig branch fell into once before (see above).
    const effTarget = (dM, sig, vel, free) => {
      const nm = (params.tgtNoMwd && scrammedAt(dM)) ? params.tgtNoMwd : null;
      const s = (nm && free!=="sig") ? nm.sig : sig;
      const v = (nm && free!=="vel") ? nm.vel : vel;
      return [s*sigMultAt(dM), v*webMultAt(dM)];
    };
    // Fixed engagement distance for the speed/sig axes (hold range constant, vary tracking inputs).
    const engDist = engagementDistanceM(cs);
    const atkSpeed = params.selfVel ?? 0, atkAngle = params.selfAngle ?? 0;
    const tgtAngle = params.targetAngle ?? 0;
    const shipRadius = cs?.shipRadius ?? 0;
    const tgtRadius = 0; // surface-to-surface distance is the x value; target radius folded out
    // Auto-scale the distance axis to the fit's effective weapon range. Turrets reach ~zero DPS at
    // optimal + 3×falloff; missiles/drones at their max range. Use the longest-reaching weapon.
    let rangeMaxM = 0;
    for (const w of weapons) {
      if (w.kind === "turret") rangeMaxM = Math.max(rangeMaxM, (w.optimal||0) + 3*(w.falloff||0));
      else if (w.kind === "drone") rangeMaxM = Math.max(rangeMaxM, w.controlRange||0);
      else if (w.kind === "missile") rangeMaxM = Math.max(rangeMaxM, w.higherRange||0);
      else if (w.optimal) rangeMaxM = Math.max(rangeMaxM, w.optimal);
    }
    // Round up to a clean km value with a little headroom; fall back to 40km if no range info.
    let distMaxKm = rangeMaxM > 0 ? rangeMaxM/1000*1.05 : 40;
    distMaxKm = distMaxKm <= 20 ? Math.ceil(distMaxKm) : distMaxKm <= 60 ? Math.ceil(distMaxKm/5)*5 : Math.ceil(distMaxKm/10)*10;
    distMaxKm = dom(distMaxKm);
    // Per-weapon applied multiplier at an engagement (tracking/range/application).
    //
    // `perfect` asks the same question with the APPLICATION terms removed — a stationary attacker
    // against a stationary target of effectively infinite signature — which is what the ghost line
    // draws. RANGE is deliberately left in: a turret sitting past falloff is not missing because of
    // transversal, and a ceiling that ignored range would promise damage no amount of flying can
    // recover. The ideal inputs are fed through the same math rather than short-circuited to 1, for
    // the same reason IDEAL_SIG exists at all (see its comment).
    const weaponMult = (w, distM, tgtSig, tgtSpeed, perfect) => {
        if (w.kind === "turret") {
          const cth = calcTurretCTH({ atkSpeed: perfect?0:atkSpeed, atkAngle, atkRadius: shipRadius,
            optimal: w.optimal, falloff: w.falloff, tracking: w.tracking,
            optimalSigRadius: w.optimalSigRadius, distance: distM,
            tgtSpeed: perfect?0:tgtSpeed, tgtAngle, tgtRadius, tgtSig: perfect?IDEAL_SIG:tgtSig });
          return calcTurretMult(cth);
        } else if (w.kind === "missile") {
          const df = distM <= w.lowerRange ? 1 : (distM <= w.higherRange ? w.higherChance : 0);
          return df * calcMissileFactor(w.explosionRadius, w.explosionVelocity, w.aoeDamageReductionFactor,
                                        perfect?0:tgtSpeed, perfect?IDEAL_SIG:tgtSig);
        } else if (w.kind === "drone") {
          return distM <= (w.controlRange ?? Infinity) ? 1 : 0;
        }
        return 1;
    };
    // Compute total applied DPS (or volley) at a given engagement.
    // The ghost column needs no ewar handling: `perfect` discards sig and speed outright, so a web
    // cannot improve on a target already treated as stationary and infinitely large.
    const applied = (distM, tgtSig, tgtSpeed, perfect, free) => {
      const [sig, vel] = effTarget(distM, tgtSig, tgtSpeed, free);
      let total = 0;
      for (const w of weapons) {
        const _v = w.volleyEff ?? w.volley;
        const vol = _v.em + _v.th + _v.kin + _v.exp;
        // A forced idle between cycles (a bomb launcher's 67.5 s) is time the weapon is not firing,
        // so it belongs in the DPS divisor. Reload does not: this curve is sustained-fire DPS and
        // the reload gap is what the damage-over-time graph exists to show.
        const per = wantVolley ? vol : vol / (w.cycleS + (w.delayS ?? 0));
        total += per * weaponMult(w, distM, sig, vel, perfect);
      }
      return total;
    };
    // Every damage point carries TWO y values: what lands against the target being simulated, and
    // what would land with application perfect. Both come from one call site so the ghost can never
    // sample an x the real line didn't.
    const both = (distM, tgtSig, tgtSpeed, free) => [applied(distM,tgtSig,tgtSpeed,false,free), applied(distM,tgtSig,tgtSpeed,true,free)];
    // Every volley landed within `TMAX` seconds at one engagement distance, as [t, damage] pairs.
    // Both the time axis (which draws them as a staircase) and the distance axis (which sums them)
    // go through this, so the two can never disagree about what "damage inflicted" means.
    const damageEvents=(TMAX,distM,rawSig,rawVel,free)=>{
      const [sig,vel]=effTarget(distM,rawSig,rawVel,free);
      const evts=[];
      for (const w of weapons){
        const v=w.volleyEff??w.volley;
        const raw=v.em+v.th+v.kin+v.exp;
        const base=raw*weaponMult(w,distM,sig,vel), ideal=raw*weaponMult(w,distM,sig,vel,true);
        // Kept if EITHER column lands, so a weapon the target is currently outrunning still
        // contributes to the ghost staircase — and both staircases keep the same step positions,
        // which they would not if each built its own event list.
        if(!(base>0||ideal>0)||!(w.cycleS>0))continue;
        // Entropic disintegrators ramp. eos's calculateSpoolup (SpoolType.CYCLES) is the authority:
        // after `cycles` COMPLETED cycles the bonus is min(max, cycles * step), so the FIRST shot
        // lands with none of it and the cap arrives on shot ceil(max/step). A Heavy Entropic
        // Disintegrator is max 2.125 / step 0.07 → 31 cycles to a 3.125x multiplier, which is why
        // this curve has to bend: the last volley in a two-minute window is worth three of the first.
        //
        // RELOAD RESETS THE SPOOL in game (confirmed 2026-08-07). This loop does NOT model that,
        // and the omission is currently invisible: disintegrator clips are enormous (a Vedmak's is
        // 500 rounds, ~33 minutes of firing) so no reload occurs inside the graph's window. If a
        // short-clip spooling weapon is ever added, reset `cycles` to 0 in the reload branch below.
        const spools=w.spoolMax>0&&w.spoolPerCycle>0;
        let t=0, shots=0, cycles=0, guard=0;
        while (t<=TMAX+1e-9 && guard++<100000){
          const sp=spools?1+Math.min(w.spoolMax,cycles*w.spoolPerCycle):1;
          evts.push([t, base*sp, ideal*sp]);
          shots++; cycles++;
          // The forced idle runs concurrently with the reload, so a clip boundary costs whichever is
          // longer rather than both — a bomb launcher reloads inside its 67.5 s delay for free.
          const idle = w.delayS ?? 0;
          if (w.numShots>0 && shots>=w.numShots){ shots=0; t += w.cycleS + Math.max(w.reloadS, idle); }
          else t += w.cycleS + idle;
        }
      }
      evts.sort((a,b)=>a[0]-b[0]);
      return evts;
    };
    if (baseDps === 0 && baseVolley === 0) { pts=[[0,0],[40,0]]; xMax=40; yMax=100; }
    else if (xKey === "dist") {
      const step = distMaxKm/80;
      // "Damage inflicted" against distance used to plot a CONSTANT ZERO — the axis pair rendered a
      // flat line on the floor. It now sums the same volleys the time axis draws, over the same
      // window, at each range: "how much do I actually land in two minutes at X km".
      const TMAX=dom(120);
      for (let km=0; km<=distMaxKm+1e-9; km+=step){
        if (yKey==="inflicted"){
          const ev=damageEvents(TMAX, km*1000, profSig, profVel);
          pts.push([km, ev.reduce((s,e)=>s+e[1],0), ev.reduce((s,e)=>s+e[2],0)]);
        } else pts.push([km, ...both(km*1000, profSig, profVel)]);
      }
      xMax=distMaxKm;
      yMax=yKey==="inflicted" ? (Math.max(...pts.map(p=>p[1]))||100)*1.1 : (wantVolley?baseVolley:baseDps)*1.15;
    }
    else if (xKey === "time") {
      if (yKey === "inflicted") {
        // Stepped cumulative damage: each weapon lands a discrete volley at t=0, then every cycle,
        // pausing for reload after each clip of numShots (so the staircase flattens during reload).
        const TMAX=dom(120);
        const evts = damageEvents(TMAX, 0, profSig, profVel);
        let acc=0, gacc=0; pts.push([0,0,0]);
        for (const [t,d,g] of evts){ pts.push([t,acc,gacc]); acc+=d; gacc+=g; pts.push([t,acc,gacc]); }   // step then jump
        pts.push([TMAX,acc,gacc]);
        xMax=TMAX; yMax=acc*1.05||100;
      } else {
        const [eff,effIdeal]=both(0,profSig,profVel);
        const tEnd=dom(120), tStep=tEnd/480;
        for(let t=0;t<=tEnd+1e-9;t+=tStep) pts.push([t,eff,effIdeal]);
        xMax=tEnd; yMax=(wantVolley?baseVolley:baseDps)*1.15;
      }
    }
    else if (xKey === "tgtSpeedMs") { const vEnd=dom(3000), vStep=vEnd/120; for(let v=0;v<=vEnd+1e-9;v+=vStep) pts.push([v, ...both(engDist, profSig, v, "vel")]); xMax=vEnd; yMax=(wantVolley?baseVolley:baseDps)*1.15; }
    else if (xKey === "tgtSpeedPct") { const vmax=profVel||1000; const pEnd=dom(100), pStep=pEnd/100; for(let p=0;p<=pEnd+1e-9;p+=pStep) pts.push([p, ...both(engDist, profSig, vmax*p/100, "vel")]); xMax=pEnd; yMax=(wantVolley?baseVolley:baseDps)*1.15; }
    else if (xKey === "tgtSigM") { const sEnd=dom(1000), sStep=sEnd/125; for(let sg=0;sg<=sEnd+1e-9;sg+=sStep) pts.push([sg, ...both(engDist, sg, profVel, "sig")]); xMax=sEnd; yMax=(wantVolley?baseVolley:baseDps)*1.15; }
    else { const pEnd=dom(200), pStep=pEnd/100; for(let p=0;p<=pEnd+1e-9;p+=pStep) pts.push([p, ...both(engDist, profSig*p/100, profVel, "sig")]); xMax=pEnd; yMax=(wantVolley?baseVolley:baseDps)*1.15; }
  }else if(catKey==="ewar"){
    const P=params.ownProj||{};
    const rf=(o,f,d)=>calcRangeFactor(o,f,d,true);
    // Distance axis auto-scales to the relevant modules' reach (optimal + falloff).
    const mods = yKey==="neutsCap"?(P.neuts||[]) : yKey==="webSpeed"?(P.webs||[]) : yKey==="ecmStr"?(P.ecm||[]) : yKey==="tdRange"?(P.trackDisr||[]) : yKey==="gdRange"?(P.guideDisr||[]) : yKey==="tpSig"?(P.painters||[]) : (P.damps||[]);
    let reachM=0; for(const m of mods) reachM=Math.max(reachM,(m.optimal||0)+(m.falloff||0)*2);
    let dmax=reachM>0?reachM/1000*1.05:30; dmax=dmax<=20?Math.ceil(dmax):dmax<=60?Math.ceil(dmax/5)*5:Math.ceil(dmax/10)*10;
    dmax=dom(dmax);
    const valAt=(dM)=>{
      if(yKey==="neutsCap") return (P.neuts||[]).reduce((s,n)=>s+n.gjPerSec*rf(n.optimal,n.falloff,dM),0);
      if(yKey==="ecmStr")   return (P.ecm||[]).reduce((s,e)=>s+Math.max(0,...Object.values(e.byType||{}))*rf(e.optimal,e.falloff,dM),0);
      if(yKey==="webSpeed"){const ms=(P.webs||[]).map(w=>1+(w.speedFactor*rf(w.optimal,w.falloff,dM))/100);return ms.length?(1-stackingPenalty(ms))*100:0;}
      if(yKey==="tdRange"){const ms=(P.trackDisr||[]).map(t=>1+((t.optimalBonus||0)*rf(t.optimal,t.falloff,dM))/100);return ms.length?(1-stackingPenalty(ms))*100:0;}
      if(yKey==="gdRange"){const gd=(P.guideDisr||[]);if(!gd.length)return 0;
        // Missile range = velocity × flight time; both are disrupted (stacking-penalized per attr).
        const vp=gd.map(g=>1+((g.missileRange||0)*rf(g.optimal,g.falloff,dM))/100);
        const fp=gd.map(g=>1+((g.explosionDelay||0)*rf(g.optimal,g.falloff,dM))/100);
        return (1-stackingPenalty(vp)*stackingPenalty(fp))*100;}
      if(yKey==="tpSig"){const ms=(P.painters||[]).map(p=>1+((p.sigBonus||0)*rf(p.optimal,p.falloff,dM))/100);return ms.length?(stackingPenalty(ms)-1)*100:0;}
      const ds=(P.damps||[]).map(d=>1+(d.lockBonus*rf(d.optimal,d.falloff,dM))/100);return ds.length?(1-stackingPenalty(ds))*100:0; // dampLock
    };
    const step=dmax/80; for(let km=0;km<=dmax+1e-9;km+=step) pts.push([km,valAt(km*1000)]);
    xMax=dmax; yMax=(pts.length?Math.max(...pts.map(p=>p[1])):1)*1.2||1;
  }
  else if(catKey==="reps"){
    const P=params.ownProj||{};
    const rf=(o,f,d)=>calcRangeFactor(o,f,d,true);
    const reps=P.reps||[];
    let reachM=0; for(const r of reps) reachM=Math.max(reachM,(r.optimal||0)+(r.falloff||0)*2);
    const rateAt=(dM)=>reps.reduce((s,r)=>s+r.rawPS*rf(r.optimal,r.falloff,dM),0);
    if(xKey==="time"){
      // Reps land in DISCRETE CYCLES, and a Mutadaptive repper (Rodiva/Zarmazd) ramps its amount
      // each cycle. This used to integrate a constant HP/s (`acc += rate*dt`), which drew a
      // perfectly straight total-repaired line and a flat repair-speed line — no cycles, no ramp,
      // for every logi in the game.
      //
      // Spool follows eos's calculateSpoolup (SpoolType.CYCLES): after `cycles` COMPLETED cycles
      // the bonus is min(max, cycles * step), so the first cycle lands unspooled.
      const tEnd=dom(120);
      const src=reps.map(r=>({amt:(r.amount??r.rawPS*(r.cycleS||1))*rf(r.optimal,r.falloff,0),
                              cycleS:r.cycleS||1, spoolMax:r.spoolMax||0, spoolPerCycle:r.spoolPerCycle||0}))
                    .filter(r=>r.amt>0&&r.cycleS>0);
      const evts=[];
      for(const r of src){
        const spools=r.spoolMax>0&&r.spoolPerCycle>0;
        let t=r.cycleS, cycles=0, guard=0;   // a repairer delivers at the END of its cycle
        while(t<=tEnd+1e-9&&guard++<100000){
          evts.push([t, r.amt*(spools?1+Math.min(r.spoolMax,cycles*r.spoolPerCycle):1), r.cycleS]);
          cycles++; t+=r.cycleS;
        }
      }
      evts.sort((a,b)=>a[0]-b[0]);
      if(yKey==="repTotal"){
        let acc=0; pts.push([0,0]);
        for(const [t,hp] of evts){ pts.push([t,acc]); acc+=hp; pts.push([t,acc]); }   // step then jump
        pts.push([tEnd,acc]);
        xMax=tEnd; yMax=acc*1.05||1;
      }else{
        // Repair speed: the rate that cycle delivered (hp / cycleS), held until the next landing.
        let cur=0; pts.push([0,0]); let peak=0;
        for(const [t,hp,cyc] of evts){ pts.push([t,cur]); cur=hp/cyc; peak=Math.max(peak,cur); pts.push([t,cur]); }
        pts.push([tEnd,cur]);
        xMax=tEnd; yMax=(peak||1)*1.15;
      }
    }
    else{
      let dmax=reachM>0?reachM/1000*1.05:30;dmax=dmax<=20?Math.ceil(dmax):dmax<=60?Math.ceil(dmax/5)*5:Math.ceil(dmax/10)*10;dmax=dom(dmax);
      const step=dmax/80;
      // "Total repaired" against distance was `rate * 10` — an arbitrary ten seconds with nothing
      // behind it, and no cycles or spool. It now runs the same cycle simulation the time axis uses
      // over the same window, so the two axes report the same quantity.
      const tEnd=dom(120);
      const totalAt=(dM)=>reps.reduce((sum,r)=>{
        const amt=(r.amount??r.rawPS*(r.cycleS||1))*rf(r.optimal,r.falloff,dM);
        const cyc=r.cycleS||1;
        if(!(amt>0)||!(cyc>0))return sum;
        const spools=r.spoolMax>0&&r.spoolPerCycle>0;
        let t=cyc,cycles=0,acc=0,guard=0;
        while(t<=tEnd+1e-9&&guard++<100000){ acc+=amt*(spools?1+Math.min(r.spoolMax,cycles*r.spoolPerCycle):1); cycles++; t+=cyc; }
        return sum+acc;
      },0);
      for(let km=0;km<=dmax+1e-9;km+=step){pts.push([km,yKey==="repTotal"?totalAt(km*1000):rateAt(km*1000)]);}
      xMax=dmax;yMax=(pts.length?Math.max(...pts.map(p=>p[1])):1)*1.2||1;
    }
  }
  else if(catKey==="shieldRegen"){
    const maxHP=cs?.shieldHP??ship.shieldHP??6200, maxEHP=cs?.shieldEHP??maxHP;
    const ehpR=maxHP>0?maxEHP/maxHP:1, peakRaw=cs?.passiveShieldRegen??(2.5*maxHP/((cs?.shieldRechargeMs??2500000)/1000));
    // Passive recharge only (EVE curve, peak at 25%); active boosters are excluded so the line is
    // pure regen. Curve is 0 at both 0% and 100% shield by construction.
    const regenEhp=p=>{const q=Math.max(0,Math.min(1,p));return peakRaw*4*(Math.sqrt(q)-q)*ehpR;};
    if(xKey==="shieldPct"){const pEnd=dom(100,100),pStep=pEnd/100;for(let p=0;p<=pEnd+1e-9;p+=pStep)pts.push([p,yKey==="shieldRegen"?regenEhp(p/100):maxEHP*p/100]);xMax=pEnd;yMax=yKey==="shieldRegen"?regenEhp(0.25)*1.25:maxEHP*1.05;}
    else{
      const tau=(cs?.shieldRechargeMs??2500000)/1000;
      const tEnd=dom(Math.max(120,tau*1.5)), dt=Math.max(tEnd/480,tau/1200);
      let frac=0;  // start from an empty shield → Y=0 at t=0
      for(let t=0;t<=tEnd+1e-9;t+=dt){
        pts.push([t,yKey==="shieldRegen"?regenEhp(frac):maxEHP*frac]);
        const fr=Math.max(frac,1e-3);  // seed past the 0%-rate singularity so it charges from empty
        frac=Math.min(1,frac+(peakRaw*4*(Math.sqrt(fr)-fr)/Math.max(1,maxHP))*dt);
      }
      xMax=pts.length?pts[pts.length-1][0]:120;
      yMax=yKey==="shieldRegen"?regenEhp(0.25)*1.25:maxEHP*1.05;
    }
  }
  else if(catKey==="cap"){
    const maxC=cs?.capCapacity??ship.capacitorCapacity??1000, tau=(cs?.capRechargeMs??250000)/1000;
    const cr=c=>(10*maxC/tau)*(Math.sqrt(Math.max(0,c)/maxC)-Math.max(0,c)/maxC);  // gross regen GJ/s
    if(xKey==="capPct"){const pEnd=dom(100,100),pStep=pEnd/100;for(let p=0;p<=pEnd+1e-9;p+=pStep){const c=maxC*p/100;pts.push([p,yKey==="capAmt"?c:cr(c)]);}xMax=pEnd;yMax=yKey==="capAmt"?maxC*1.05:cr(maxC*0.25)*1.25;}
    else{
      // Drive the curve from the same discrete event simulation as the cap-stability readout, so the
      // graph agrees with it: modules drain, the booster pulses (clip + reload), and on an unstable
      // fit cap drains down and oscillates instead of pegging high. Window scales to the lifetime.
      const capTime=cs?.capTime; // seconds to cap-out, or null when stable
      const tMaxSec=dom(capTime?Math.min(Math.max(capTime*2.5,60),600):180);
      const trace=simulateCapTrace(cs?.capModules??[],maxC,(cs?.capRechargeMs??250000),{tMaxSec,sampleDt:0.5});
      if(trace.length){for(const [t,c] of trace)pts.push([t,yKey==="capAmt"?c:cr(c)]);xMax=tMaxSec;}
      else{const tE=dom(180);pts=[[0,maxC],[tE,maxC]];xMax=tE;}
      yMax=yKey==="capAmt"?maxC*1.05:cr(maxC*0.25)*1.25;
    }
  }
  else if(catKey==="mobility"){
    const vmax=(cs?.maxVelocityAB&&cs.maxVelocityAB!==cs.maxVelocity?cs.maxVelocityAB:(cs?.maxVelocity??ship.maxVelocity??115));
    const mass=cs?.mass??ship.mass??1e7, ag=cs?.agility??ship.agility??0.5;
    const tau=ag*mass/1e6; let dist=0;
    const tEnd=dom(Math.max(30,tau*3)), dt=Math.max(.05,tEnd/400);
    for(let t=0;t<=tEnd+1e-9;t+=dt){const v=vmax*(1-Math.exp(-t/tau));dist+=v*dt/1000;pts.push([t,yKey==="speed"?v:dist]);}
    xMax=tEnd;yMax=yKey==="speed"?vmax*1.1:dist*1.15;
  }
  else if(catKey==="warp"){
    const AU=1.496e11, ws=cs?.warpSpeed??ship.warpSpeed??3, subwarp=cs?.maxVelocity??ship.maxVelocity??200;
    const warpT=(distM)=>{if(distM<=0)return 0;const kA=ws,kD=Math.min(ws/3,2),dropout=Math.min(subwarp/2,100);let maxMs=ws*AU;const accelD=AU,decelD=maxMs/kD,minD=accelD+decelD;let cruise=0;if(minD>distM)maxMs=distM*kA*kD/(kA+kD);else cruise=(distM-minD)/maxMs;return Math.max(0,cruise+Math.log(maxMs/kA)/kA+Math.log(maxMs/dropout)/kD);};
    if(xKey==="distAU"){const aEnd=dom(100),aStep=aEnd/100;for(let au=0;au<=aEnd+1e-9;au+=aStep)pts.push([au,warpT(au*AU)]);xMax=aEnd;}
    else{const kEnd=dom(150),kStep=kEnd/75;for(let km=0;km<=kEnd+1e-9;km+=kStep)pts.push([km,warpT(km*1000)]);xMax=kEnd;}
    yMax=(pts.length?Math.max(...pts.map(p=>p[1])):10)*1.1||10;
  }
  else if(catKey==="lock"){
    const sr=cs?.scanRes??ship.scanResolution??200;
    const sEnd=dom(1000), sStep=Math.max(1,sEnd/198);
    for(let s=10;s<=sEnd+1e-9;s+=sStep){const t=sr>0?Math.min(40000/sr/Math.pow(Math.asinh(s),2),1800):0;pts.push([s,t]);}
    xMax=sEnd;yMax=(pts.length?Math.max(...pts.map(p=>p[1])):10)*1.15||10;
  }
  // The ghost column counts toward the axis fit, or the ceiling it draws gets clipped off the top of
  // the plot at exactly the engagements where the gap is worth seeing.
  if(pts.length){const dm=Math.max(...pts.map(p=>Math.max(p[1],p[2]??0)));if(!yMax||dm>yMax)yMax=dm*1.1;}
  return{pts,xMax:xMax??100,yMax:yMax??100};
}

// CONTROLLED cursor: the selected x lives in GraphTab (persisted, shared across fits), not in local
// pixel state here. Two consequences worth knowing:
//   * it STICKS. Touch-end and mouse-leave used to clear it, so on a phone the reading vanished the
//     instant you lifted your finger — there was no "selected point" to navigate away from at all.
//     Drag off either edge of the plot to clear, or reset a zoom / change an axis.
//   * it is an x VALUE, so it re-reads correctly after a zoom or a switch to another fit's curve.
// `marker` (optional): {x, label} — a dim vertical reference on the x axis. Used for the ship's lock
// range on the distance graphs, where the curve happily keeps going past the point at which you can
// no longer hold a target: a projection graph reading 40% web strength at 90 km is describing
// something that cannot happen on a hull that locks to 60. Drawn as annotation, not data — thin,
// dashed, at the grid's own colour weight — because it must not read as a second series.
function LineChart({pts,xMax,yMax,xLabel,yLabel,color,cursorX,onCursorXChange,marker}){
  // W wider than a naive "fill the box" guess: the SVG's box height is fixed (H+18) but its CSS width
  // is 100% of whatever card it sits in, so with the old W=280 (a viewBox aspect narrower than any
  // phone's actual card) preserveAspectRatio="meet" scaled to the HEIGHT and centered the content,
  // leaving ~65px of dead margin on each side on a 430pt-wide device. 340 is chosen to stay under the
  // narrowest iPhone's card width (~355pt after the 20px padding on an SE) so it never flips to the
  // opposite failure — scaling to fit WIDTH instead and letterboxing the height — while still cutting
  // the wasted margin roughly in half on wider phones.
  const W=340,H=140,PL=36,PB=20,PT=6,PR=8,gW=W-PL-PR,gH=H-PB-PT;
  const toX=x=>PL+(x/xMax)*gW,toY=y=>PT+gH-(y/yMax)*gH;
  if(!pts||!pts.length)return null;
  const fmt=v=>v>=10000?`${(v/1000).toFixed(0)}k`:v>=1000?`${(v/1000).toFixed(1)}k`:parseFloat(v.toPrecision(3)).toString();
  const yT=[0,.25,.5,.75,1].map(f=>yMax*f),xT=[0,.25,.5,.75,1].map(f=>xMax*f);
  const lp=pts.map(([x,y],i)=>`${i===0?"M":"L"}${toX(x).toFixed(1)},${toY(Math.max(0,y)).toFixed(1)}`).join(" ");
  const ap=lp+` L${toX(pts[pts.length-1][0])},${toY(0)} L${toX(pts[0][0])},${toY(0)} Z`;
  // The perfect-application ceiling, drawn behind the real curve wherever the two differ. Only the
  // damage curves carry a third column, and only a non-ideal target makes it diverge, so the test is
  // "is there a gap" rather than a flag threaded down from the target controls: against a stationary
  // infinite-sig target the ghost sits exactly on the line and drawing it would just fatten it.
  const hasGhost=pts.some(p=>p.length>2&&p[2]>p[1]*1.005+1e-9);
  const gp=hasGhost?pts.map(([x,,y],i)=>`${i===0?"M":"L"}${toX(x).toFixed(1)},${toY(Math.max(0,y)).toFixed(1)}`).join(" "):null;
  const gId="g"+color.replace(/[^a-zA-Z0-9]/g,"");
  // Pointer x -> curve x, or null when the drag leaves the plot box (which is how you clear it).
  const xFromClient=(clientX,rect)=>{const scaleX=W/rect.width,svgX=(clientX-rect.left)*scaleX;
    return(svgX<PL||svgX>W-PR)?null:Math.max(0,Math.min(xMax,(svgX-PL)/gW*xMax));};
  const handleMouseMove=e=>{onCursorXChange&&onCursorXChange(xFromClient(e.clientX,e.currentTarget.getBoundingClientRect()));};
  const handleTouchMove=e=>{e.preventDefault();onCursorXChange&&onCursorXChange(xFromClient(e.touches[0].clientX,e.currentTarget.getBoundingClientRect()));};
  const cursorPx=(cursorX!=null&&cursorX<=xMax)?toX(cursorX):null;
  const cursorYVal=cursorPx!=null?interpCurveAt(pts,cursorX):null;
  // touchAction:none + stopPropagation: dragging along the x-axis to read a datapoint was reaching
  // the Fit/Stats/Graph swipe handler on an ancestor, so scrubbing the plot flicked you to another
  // sub-tab instead. The graph owns horizontal drags inside its own box.
  const swallow=e=>e.stopPropagation();
  // no-select: dragging across the chart to move the cursor was selecting the axis tick labels,
  // which on a phone also raises the text-selection handles and the long-press callout.
  return(<svg className="no-select" width="100%" height={H+18} viewBox={`0 0 ${W} ${H+18}`} style={{overflow:"visible",cursor:"crosshair",touchAction:"none"}} onMouseMove={handleMouseMove} onTouchStart={swallow} onTouchMove={e=>{e.stopPropagation();handleTouchMove(e);}} onTouchEnd={swallow}>
    <defs>
      <linearGradient id={gId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".22"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient>
      {/* Zoomed axes shrink xMax/yMax, so the curve can run past the plot box — clip it to the grid. */}
      <clipPath id={gId+"clip"}><rect x={PL} y={PT} width={gW} height={gH}/></clipPath>
    </defs>
    {yT.map((v,i)=><line key={i} x1={PL} y1={toY(v)} x2={W-PR} y2={toY(v)} stroke={C.border} strokeWidth="1"/>)}
    {xT.map((v,i)=><line key={i} x1={toX(v)} y1={PT} x2={toX(v)} y2={PT+gH} stroke={C.border} strokeWidth="1"/>)}
    <g clipPath={`url(#${gId}clip)`}>
      {gp&&<path d={gp} fill="none" stroke={color} strokeWidth="1.25" strokeDasharray="4,3" opacity=".3" strokeLinejoin="round" strokeLinecap="round"/>}
      <path d={ap} fill={`url(#${gId})`}/><path d={lp} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
    </g>
    {/* Off the right-hand edge it would be drawn ON the axis and read as part of the frame, so it is
        dropped rather than clamped — the honest message at that zoom is "everything shown is in
        range". Zooming in brings it back. */}
    {marker!=null&&marker.x>0&&marker.x<xMax*0.995&&(<g>
      <line x1={toX(marker.x)} y1={PT} x2={toX(marker.x)} y2={PT+gH} stroke={C.textMute} strokeWidth="1" strokeDasharray="2,4"/>
      {/* Hung from the top-left of the line so it cannot collide with the x-axis tick labels, and
          right-anchored so it grows back INTO the plot rather than off the edge near xMax. */}
      <text x={toX(marker.x)-3} y={PT+8} textAnchor="end" fill={C.textMute} fontSize="8">{marker.label}</text>
    </g>)}
    {cursorPx!=null&&cursorYVal!=null&&(<g><line x1={cursorPx} y1={PT} x2={cursorPx} y2={PT+gH} stroke={C.text} strokeWidth="1" strokeDasharray="3,3" opacity="0.6"/><circle cx={cursorPx} cy={Math.max(PT,Math.min(PT+gH,toY(Math.max(0,cursorYVal))))} r={4} fill={color} stroke={C.surface} strokeWidth="2"/></g>)}
    {yT.map((v,i)=><text key={i} x={PL-3} y={toY(v)+3} textAnchor="end" fill={C.textMute} fontSize="8">{fmt(v)}</text>)}
    {xT.map((v,i)=><text key={i} x={toX(v)} y={H+4} textAnchor="middle" fill={C.textMute} fontSize="8">{fmt(v)}</text>)}
    <text x={PL+gW/2} y={H+16} textAnchor="middle" fill={C.textMute} fontSize="9">{xLabel}</text>
    <text x={9} y={PT+gH/2} textAnchor="middle" fill={C.textMute} fontSize="9" transform={`rotate(-90,9,${PT+gH/2})`}>{yLabel}</text>
  </svg>);
}

// BOTH compasses draw in ONE shared frame: 0 deg is East on either wheel, so two arrows pointing the
// same way on screen are two ships moving the same way in the world.
//
// This has to be shared, because the transversal both wheels feed is a single subtraction across one
// axis — |atkSpeed·sin(atk) − tgtSpeed·sin(tgt)|, eve-uni's formula, which pyfa's _calcAngularSpeed
// implements identically and which assumes the target sits to the attacker's right. Each wheel used to
// draw its own 0 pointing at its own enemy marker, which put the Target's arrow 180 deg out of the
// frame its number is read in: the picture and the number described different manoeuvres. Aligning the
// two on screen — the thing you would do to fly a stern chase — computed as a head-on pass, so getting
// low transversal meant hunting for a pair of angles that looked wrong.
//
// Nothing about the physics moves: a stored angle keeps the number it always had and the DPS it always
// produced. Only the arrow that was misdrawing it does. pyfa's own picker takes an `offset` for this
// and passes 0 for both wheels for the same reason.
//
// The enemy markers stay where they are (East on Your Ship, West on Target) and are now purely
// positional — you on the left, the target on the right, which is exactly the frame the formula wants.
// So heading 0 closes on the target and, on the Target wheel, is the target running from you.
const COMPASS_DIRS=["N","NE","E","SE","S","SW","W","NW"];

function VectorCompass({label,value,velocity,maxVelocity,onChange,onVelocityChange,enemyPos}){
  const cx=45,cy=45,rMax=34;
  // A maxVelocity of 0 means IMMOBILISED — a sieged dread, a bastioned marauder — not "unknown".
  // This used to fall back to 500 the same way the caller did, so the Your Ship wheel happily
  // offered a 500 m/s vector on a ship that physically cannot move, and the transversal that
  // produced went straight into the turret tracking maths. It is now a real state: the wheel is
  // inert and reads "immobilised" rather than inventing a speed.
  const immobile=!(maxVelocity>0);
  const safeMV=immobile?1:maxVelocity;   // divide-by-zero guard only; nothing can move anyway
  const velFrac=immobile?0:Math.min((velocity??0)/safeMV,1);
  // No minimum radius: at velFrac=0 this lands exactly on (cx,cy), so a zeroed "Your Ship" wheel
  // and a zeroed "Target" wheel land on the identical center point instead of each drifting a few
  // px toward wherever that wheel's own enemyPos happens to be.
  const r=rMax*velFrac;
  const atZero=r<0.5;
  const theta=value;   // screen angle of the drawn arrow; the frame is shared, see COMPASS_DIRS above
  const rad=theta*Math.PI/180,nx=cx+r*Math.cos(rad),ny=cy+r*Math.sin(rad);
  const cardinal=COMPASS_DIRS[((Math.round((theta+90)/45)%8)+8)%8];

  function handlePt(clientX,clientY,rect){
    if(immobile)return;
    const scale=rect.width/90;
    const dx=(clientX-rect.left)/scale-cx;
    const dy=(clientY-rect.top)/scale-cy;
    const dist=Math.sqrt(dx*dx+dy*dy);
    const angle=Math.round(((Math.atan2(dy,dx)*180/Math.PI)%360+360)%360);
    const newVelFrac=Math.min(dist/rMax,1);
    onChange(angle);
    onVelocityChange&&onVelocityChange(Math.round(newVelFrac*safeMV));
  }
  // Double-tap / double-click a compass to park it: heading 0 (East, along the line between the two
  // ships), speed 0. At zero speed the heading contributes nothing either way.
  // The first tap of a double still moves the vector — harmless, since the reset lands on top of it
  // and the alternative is delaying every single tap by the double-tap window just to find out.
  const reset=()=>{if(immobile)return;onChange(0);onVelocityChange&&onVelocityChange(0);};
  const lastTap=useRef(0);
  const dragging=useRef(false);

  // The compass is DRAGGABLE, not just tappable. It used to handle touchstart only, so setting a
  // heading meant repeatedly stabbing at the ring instead of sweeping to it — and because the
  // gesture never reached pointer-move, the Fit/Stats/Graph swipe handler on an ancestor saw the
  // horizontal movement and flicked to another sub-tab mid-adjustment.
  //
  // Pointer events cover mouse and touch in one path. setPointerCapture keeps the drag alive when
  // the finger leaves the little 90px box, which it does constantly at the outer ring.
  const onPointerDown=e=>{
    e.stopPropagation();
    dragging.current=true;
    try{e.currentTarget.setPointerCapture(e.pointerId);}catch{}
    // Double-tap to park: heading 0, speed 0.
    const now=Date.now();
    if(now-lastTap.current<300){lastTap.current=0;dragging.current=false;reset();haptic();return;}
    lastTap.current=now;
    handlePt(e.clientX,e.clientY,e.currentTarget.getBoundingClientRect());
  };
  const onPointerMove=e=>{
    if(!dragging.current)return;
    e.stopPropagation();
    handlePt(e.clientX,e.clientY,e.currentTarget.getBoundingClientRect());
  };
  const onPointerUp=e=>{
    if(!dragging.current)return;
    dragging.current=false;
    try{e.currentTarget.releasePointerCapture(e.pointerId);}catch{}
  };
  // Belt and braces: touchmove does not go through the pointer path on every engine, and any
  // horizontal movement here must never reach the sub-tab swipe.
  const swallowTouch=e=>e.stopPropagation();

  return(<div className="no-select" style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
    <span style={{fontSize:10,fontWeight:600,color:C.textMid}}>{label}</span>
    <svg className="no-select" width={90} height={90} style={{cursor:immobile?"not-allowed":"crosshair",touchAction:"none",opacity:immobile?0.4:1}}
         onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
         onTouchStart={swallowTouch} onTouchMove={swallowTouch}>
      <circle cx={cx} cy={cy} r={rMax+6} fill={C.surfaceAlt} stroke={C.border} strokeWidth="1"/>
      {[0.25,0.5,0.75,1.0].map(f=><circle key={f} cx={cx} cy={cy} r={rMax*f} fill="none" stroke={C.borderStrong} strokeWidth="0.5" strokeDasharray={f===1?"none":"2,4"}/>)}
      {/* Below the deadzone, both wheels render an identical hollow ring dead-center rather than a
          filled dot nudged a few px toward wherever THIS wheel's own enemyPos happens to be — a
          zeroed Your Ship and a zeroed Target used to visibly disagree on where "zero" was. */}
      {atZero
        ?<circle cx={cx} cy={cy} r={5} fill="none" stroke={C.accent} strokeWidth="1.5"/>
        :<><line x1={cx} y1={cy} x2={nx} y2={ny} stroke={C.accent} strokeWidth="1.5" strokeLinecap="round" strokeDasharray="3,2"/>
           <circle cx={nx} cy={ny} r={4} fill={C.accent} stroke={C.surface} strokeWidth="1.5"/></>}
      <circle cx={cx} cy={cy} r={2.5} fill={C.textMid}/>
      {/* The enemy marker is a plain dot, no label: right for Your Ship, left for Target, which lays
          the pair out as one picture — you on the left, the target on the right. It marks a POSITION,
          not this wheel's zero; the zero is East on both (see COMPASS_DIRS above). */}
      {enemyPos==="N"&&<circle cx={cx} cy={cy-rMax-9} r={3.2} fill={C.danger}/>}
      {enemyPos==="S"&&<circle cx={cx} cy={cy+rMax+9} r={3.2} fill={C.danger}/>}
      {enemyPos==="E"&&<circle cx={cx+rMax+9} cy={cy} r={3.2} fill={C.danger}/>}
      {enemyPos==="W"&&<circle cx={cx-rMax-9} cy={cy} r={3.2} fill={C.danger}/>}
      {[["N",cx,cy-rMax-13],["S",cx,cy+rMax+13],["W",cx-rMax-10,cy+4],["E",cx+rMax+10,cy+4]].map(([l,x,y])=>(
        <text key={l} x={x} y={y} textAnchor="middle" fill={C.textMute} fontSize="7">{l}</text>
      ))}
    </svg>
    <div style={{textAlign:"center"}}>
      <div style={{fontSize:11,fontWeight:700,color:immobile?C.textMute:C.text}}>{immobile?"—":`${value}deg ${cardinal}`}</div>
      <div style={{fontSize:10,color:C.textMute}}>{immobile?"immobilised":`${velocity??0} m/s (${Math.round(velFrac*100)}%)`}</div>
    </div>
  </div>);
}

// How far the finger must travel before a press on a number cell stops being a tap and becomes a
// scrub. Small enough that the gesture feels immediate, large enough that a stationary tap meant for
// the keyboard never loses a digit to a stray pixel.
const SCRUB_ARM_PX = 4;

// One pixel of travel is worth one STEP, sized from the value the drag started on. A signature of 40 m
// and a speed of 3000 m/s then both sweep something useful across a thumb's width without a per-field
// range table, and the step lands on a readable 1/2/5 rather than a fraction.
//
// It is computed once per drag and held. Recomputing it as the number grows sounds better and is
// worse: the gesture becomes hysteretic, so sliding out and back does not return the value you
// started on — which is the exact thing that makes a scrubber feel broken rather than imprecise.
function scrubStep(v){
  const raw = Math.max(Math.abs(v), 1) / 60;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return Math.max(1, (n<1.5?1:n<3.5?2:n<7.5?5:10) * pow);
}

// A number cell you can either type into or press-and-slide, the way the iPhone camera's zoom
// buttons work. The graph redraws on every step, so sweeping the cell is a live simulation of the
// target getting bigger or faster rather than a series of guesses typed one at a time.
//
// Typing is the fallback, not the casualty: the drag only takes over once the finger has moved past
// SCRUB_ARM_PX, so a plain tap still focuses the field. `anchor` is where a scrub starts from when
// the field holds no finite number to slide from (signature's ∞) — grabbing it is already a
// statement that you want a real value.
// ⚠️ The gesture is NOT bound to the <input>. It lives on a transparent overlay sitting on top of it,
// because on iOS an <input> is the one element whose horizontal drag is already spoken for. WebKit's
// text-selection recognizer claims the touch (highlight + magnifier) and, having claimed it, fires
// `pointercancel` — so the scrub armed, moved a few digits and died. Reacting to that after the fact
// is not possible: touch-action and user-select are read at touchstart, so flipping `.no-select` at
// the 4px arm threshold is always too late, user-select is ignored on form controls anyway, and React
// registers `touchmove` PASSIVELY at the root so no handler here can preventDefault the native
// behaviour. A plain <div> has none of that machinery, so the gesture simply never gets taken away.
//
// The input stays mounted underneath and keeps every typing affordance; the overlay is removed while
// the field is focused so the caret, keyboard and desktop spinners work normally.
function ScrubField({value,display,placeholder,anchor,onType,onScrub,style,title}){
  const drag = useRef(null);
  const suppressClick = useRef(false);
  const inputRef = useRef(null);
  const [scrubbing,setScrubbing] = useState(false);
  const [typing,setTyping] = useState(false);

  // Belt-and-braces against a selection started elsewhere being extended across the labels behind the
  // cell. `.no-select` is the class every other draggable surface here uses (it carries the -webkit-
  // prefixes WebKit needs).
  const lockSelection = on => {
    document.body.classList.toggle("no-select", on);
    if(on) window.getSelection?.()?.removeAllRanges();
  };
  // A drag cut short by an unmount (switching tabs mid-scrub) must not leave the page unselectable.
  useEffect(()=>()=>lockSelection(false),[]);

  const onPointerDown = e => {
    // Clear here rather than trusting the click to consume it: a drag released far from the cell
    // (which is every drag, given pointer capture) may never produce a click at all on touch, and a
    // flag left set would silently swallow the NEXT genuine tap. A fresh press is always a clean start.
    suppressClick.current = false;
    drag.current = { x:e.clientX, start:Number.isFinite(value)?value:anchor, armed:false, id:e.pointerId, step:1 };
  };
  const onPointerMove = e => {
    const d = drag.current; if(!d) return;
    const dx = e.clientX - d.x;
    if(!d.armed){
      if(Math.abs(dx) < SCRUB_ARM_PX) return;
      d.armed = true;
      d.step = scrubStep(d.start);
      // Capture keeps the drag alive once the finger leaves the 58px cell, which it does immediately.
      try{ e.currentTarget.setPointerCapture(d.id); }catch{}
      lockSelection(true);
      setScrubbing(true);
      haptic();
    }
    e.stopPropagation();
    onScrub(Math.max(0, Math.round(d.start + dx*d.step)));
  };
  const endDrag = e => {
    const d = drag.current; if(!d) return;
    if(d.armed){
      try{ e.currentTarget.releasePointerCapture(d.id); }catch{}
      lockSelection(false);
      setScrubbing(false);
      suppressClick.current = true;   // the click that closes a drag must not then open the keyboard
    }
    drag.current = null;
  };
  // Same defence VectorCompass documents: any horizontal movement here must never reach the
  // Fit/Stats/Graph swipe handler on an ancestor, or scrubbing flicks you to another sub-tab. All
  // THREE touch events are swallowed, not just move: that handler is a little state machine, and
  // feeding it an end without the matching start leaves it reasoning about the previous gesture.
  const swallowTouch = e => e.stopPropagation();

  return (
    <span style={{position:"relative",display:"inline-flex"}}>
      <input ref={inputRef} type="number" inputMode="numeric" value={display} placeholder={placeholder} title={title}
        onChange={onType} onFocus={()=>setTyping(true)} onBlur={()=>setTyping(false)}
        style={{...style, ...(scrubbing?{border:`1px solid ${C.accent}`,color:C.accent}:null)}}/>
      {!typing && <div
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
        // Losing the capture is the backstop release. A pointerup that never arrives (the element
        // re-rendered out from under the gesture, the OS took the pointer) would otherwise strand the
        // whole page unselectable, which outlives the graph the drag was for.
        onLostPointerCapture={endDrag}
        onTouchStart={swallowTouch} onTouchMove={swallowTouch} onTouchEnd={swallowTouch}
        // preventDefault unconditionally: these cells sit inside a <label>, whose default click action
        // is to forward activation to the input — which would refocus it the instant a drag ended.
        // Focus is therefore granted explicitly, only for a press that never became a scrub.
        onClick={e=>{ e.preventDefault();
                      if(suppressClick.current){ suppressClick.current=false; return; }
                      inputRef.current?.focus(); }}
        title={title}
        // none, not pan-y: leaving the vertical axis to the scroller lets it claim a thumb-swipe that
        // drifts a few pixels off horizontal and cancel the pointer mid-scrub. The cost is that these
        // two 58px cells can't be used to start a page scroll, which is the normal bargain for a
        // slider-shaped control.
        style={{position:"absolute",inset:0,borderRadius:5,cursor:"ew-resize",
                touchAction:"none",userSelect:"none",WebkitUserSelect:"none",WebkitTouchCallout:"none"}}/>}
    </span>
  );
}

function TargetControls({tgtProfile,targetProfile,setTargetProfile,targetMwd,setTargetMwd,targetAngle,setTargetAngle,selfAngle,setSelfAngle,targetVel,setTargetVel,selfVel,setSelfVel,transversalSpeed,angularSpeed,angularDistM,showTransversal,setShowTransversal,tgtSig,setTgtSig,targetVelMax,setTargetVelMax,selfMaxVel,ship,ownProj,targetFit,targetFitStats,onPickFit,onClearFit}){
  // Same test the Stats tab's Firepower header uses, so the two agree on what counts as "active".
  const resistsOn=!!(tgtProfile?.r&&tgtProfile.r.some(v=>v>0.001));
  const fitActive=targetProfile===TARGET_FIT;
  // Webs, grapplers and painters need no note: they just scale the sig and speed, which is visible
  // in the fields below. The scrambler is the one case where a module you have fitted is silently
  // NOT applied, and that is only ever true on a hand-typed target — hence both the gate and the
  // fact that this is the only thing the strip says. A FIT target is not custom: its prop mod can be
  // switched off and the hull re-read, so the scrambler applies and there is nothing to warn about.
  const customTarget=TARGET_PROFILES[targetProfile]==null&&!fitActive;
  const nScram=customTarget?(ownProj?.scrams||[]).length:0;
  // Selecting a profile sets sig + speed and re-anchors the wheel's 100% reference to that speed.
  const applyTarget=(key,mwd)=>{
    const t=profileTarget(key,mwd); if(!t) return;
    setTgtSig(t.sig);
    if(t.vel!=null){setTargetVel(t.vel);setTargetVelMax(Math.max(t.vel,100));}
  };
  // A fit target's numbers are pushed by GraphTab's effect, not from here — applyTarget only knows
  // the static presets, and profileTarget returns null for anything else, so this is a no-op for it.
  const pickProfile=(key)=>{setTargetProfile(key);applyTarget(key,targetMwd);};
  // Toggling MWD re-applies the CURRENT profile immediately, so the sig/speed fields below always
  // agree with the buttons above. On Ideal (or a hand-edited custom target) there is no MWD variant
  // to apply, so the flag is just remembered for the next profile picked.
  const toggleMwd=()=>{const next=!targetMwd;setTargetMwd(next);applyTarget(targetProfile,next);};
  // A fit only has an MWD variant if it actually carries a prop mod; without one the two passes come
  // back identical and the toggle would silently do nothing.
  const mwdApplies=fitActive?!!targetFitStats?.hasProp:TARGET_PROFILES[targetProfile]?.mwdSig!=null;
  // The honest admission, and the only state left now that the strip is custom-target-only: pyfa
  // drags a whole target FIT onto the graph and can just switch its prop mod off, whereas a
  // hand-typed 200 m could be a hull that size or a 40 m frigate blooming under an MWD, and nothing
  // here can tell which — so the scrambler has nothing to cut.
  const scramNote = nScram ? "not applied to a typed target: a typed sig or speed can't be split into hull and MWD bloom" : null;
  // Editing the speed field sets the exact speed AND re-anchors the wheel's 100% to it.
  const setSpeed=(v)=>{const n=Math.max(0,Number(v)||0);setTargetVel(n);if(n>0)setTargetVelMax(n);setTargetProfile("custom");};
  // The scrub's numeric path into the same two writes typing does. It cannot produce the empty string
  // that means ∞, so it never needs that branch.
  const setSig=(n)=>{setTgtSig(Math.max(0,n));setTargetProfile("custom");};
  // An infinite sig shows as an empty field with an "∞" placeholder rather than "1000000000",
  // which is the number but not the meaning. Clearing the field puts it back to infinite.
  const sigVal = (tgtSig==null||tgtSig>=IDEAL_SIG) ? "" : Math.round(tgtSig);
  const trans = Math.round(transversalSpeed);
  // Coloured off the transversal in both units. Angular has no threshold that means anything on its
  // own — 3°/s is nothing to a frigate's guns and hopeless for a battleship's — so a scale built
  // on it would be inventing a judgement. Tapping between the two units must not change the verdict.
  const transColor = trans<50?C.success:trans>400?C.danger:C.warning;
  // calcAngularSpeed returns rad/s — that's the unit the trackingSpeed attribute itself ships in
  // (see Stats > Firepower and the module info panel, both "rad/s"), and calcTrackingFactor plugs
  // the two together directly, so the INTERNAL value must stay radians or the tracking/DPS math the
  // regression suite validates against pyfa breaks. But EVE's own overview "Angular Velocity" column
  // shows deg/s — CCP converts it for that one readout and nowhere else, a real inconsistency in the
  // client, not ours. This on-screen readout mirrors the overview, so it converts for DISPLAY ONLY.
  const angularSpeedDeg = angularSpeed * (180/Math.PI);
  // deg/s spans orders of magnitude across a distance axis: ~115 at knife-fight range, ~0.06 at 200 km.
  // A fixed decimal count either truncates the near end to 115.00 or flattens the far end to 0.06→0.1.
  // Not finite when the two hulls are touching and neither has a radius, which is a real reading at
  // the very left of a distance axis on a fit with no ship resolved.
  const fmtAngular = v => !Number.isFinite(v) ? "--" : v>=10 ? v.toFixed(1) : v>=1 ? v.toFixed(2) : v>=0.1 ? v.toFixed(3) : v.toFixed(4);
  // Whole km past 10, where a decimal would only jitter under a scrubbing finger.
  const fmtRangeKm = m => { const km=m/1000; return km>=10?String(Math.round(km)):km.toFixed(1); };
  const inputStyle={width:58,padding:"3px 5px",borderRadius:5,fontSize:12,fontWeight:700,textAlign:"center",background:C.surface,border:`1px solid ${C.border}`,color:C.text};
  return(<div style={{background:C.surfaceAlt,borderRadius:10,border:`1px solid ${C.border}`,padding:12,marginBottom:14}}>
    <div style={{fontSize:10,fontWeight:700,color:C.textMute,letterSpacing:.8,textTransform:"uppercase",marginBottom:8}}>Target Profile</div>
    <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
      {Object.entries(TARGET_PROFILES).filter(([k])=>k!=="fit").map(([key,p])=>(
        <button key={key} onClick={()=>pickProfile(key)} style={{padding:"5px 10px",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer",background:targetProfile===key?C.accentLight:C.surface,border:`1px solid ${targetProfile===key?C.accentBorder:C.border}`,color:targetProfile===key?C.accent:C.textMid}}>{p.label}</button>
      ))}
      {/* A TOGGLE, not another profile — hence the separator, so it doesn't read as a fifth
          mutually-exclusive option. Dimmed (not disabled) where the current profile has no MWD
          variant: the setting still holds for the next profile picked, and disabling it would make
          the control look broken on the Ideal profile.
          Its state is carried by the accent fill alone. A check mark used to sit in front of the
          label, which made the button wider when on — enough to wrap the whole row onto a second
          line on a phone, so turning MWD on moved the control out from under the thumb that had
          just pressed it. aria-pressed still carries the state where the colour cannot. */}
      <span style={{width:1,alignSelf:"stretch",background:C.border,margin:"0 2px"}}/>
      <button onClick={toggleMwd} aria-pressed={targetMwd}
        title={mwdApplies
          ? "Target has its microwarpdrive running: much larger signature (easier to hit and to apply full missile damage) but much faster (harder for turrets to track)"
          : fitActive?"This fit carries no propulsion module"
                     :"No MWD variant for this profile — applies to Frigate / Cruiser / Battleship"}
        style={{padding:"5px 10px",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer",
                opacity:mwdApplies?1:0.45,
                background:targetMwd?C.accentLight:C.surface,border:`1px solid ${targetMwd?C.accentBorder:C.border}`,
                color:targetMwd?C.accent:C.textMid}}>
        MWD
      </button>
    </div>
    {/* A saved fit standing in for the target. Deliberately its own row rather than a fifth button
        above: the row already wraps onto a second line on a phone once MWD is in it, and the chip
        has to hold a ship name and a fit name anyway.
        It supplies SIG and SPEED only. Resists stay with Stats › Firepower — simming against the
        uniform profile while doing the resist arithmetic yourself is the normal way to read one of
        these graphs, and a curve silently pre-corrected for a specific hull's resists is harder to
        reason about, not easier. */}
    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10}}>
      <button onClick={()=>{if(targetFit&&!fitActive)setTargetProfile(TARGET_FIT);else onPickFit();}}
        title={targetFit?"Tap to use this fit's signature and speed, or pick a different fit":"Use a saved fit's signature and speed as the target"}
        style={{flex:1,minWidth:0,display:"flex",alignItems:"center",gap:6,padding:"6px 10px",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer",textAlign:"left",
                background:fitActive?C.accentLight:C.surface,border:`1px solid ${fitActive?C.accentBorder:C.border}`,
                color:targetFit?(fitActive?C.accent:C.textMid):C.textMute}}>
        <span style={{flexShrink:0}}>&#8982;</span>
        <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
          {targetFit?`${targetFit.ship} · ${targetFit.name}`:"Choose target fit…"}
          {/* The reference outlived the fit. Say so rather than clearing it: the sig and speed it
              last supplied are still on screen and still a real target. */}
          {targetFit&&!targetFitStats&&<span style={{color:C.warning,fontWeight:400}}> · not found</span>}
        </span>
      </button>
      {targetFit&&<button onClick={onClearFit} title="Stop using a fit as the target"
        style={{padding:"6px 9px",borderRadius:6,fontSize:12,cursor:"pointer",background:C.surface,border:`1px solid ${C.border}`,color:C.danger,flexShrink:0}}>&#10005;</button>}
    </div>
    {/* Target RESISTS — how much of your damage actually lands — are chosen ONCE, in Stats >
        Firepower, and only read here. This used to be a second picker writing the same shared
        state, which is two places to set one number with nothing to say which had won.
        Read-only, and shown only when it is actually biting: a DPS curve quietly cut by 40% with
        nothing on screen explaining why is exactly the graph nobody should trust.
        Distinct from the sig/speed presets above, which govern APPLICATION (tracking), not
        mitigation — those stay local to the graph. */}
    {resistsOn&&<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,padding:"6px 8px",marginBottom:10,background:C.surface,border:`1px solid ${C.border}`,borderRadius:7}}>
      <span style={{fontSize:10,color:C.textMute}}>Target resists</span>
      <span style={{fontSize:11,fontWeight:700,color:C.textMid}}>{tgtProfile?.n}
        <span style={{fontSize:10,fontWeight:400,color:C.textMute}}> · set in Stats › Firepower</span>
      </span>
    </div>}
    {scramNote&&<div style={{padding:"6px 8px",marginBottom:10,background:C.surface,border:`1px solid ${C.border}`,borderRadius:7}}>
      <div style={{fontSize:11,color:C.textMid}}>Scrambler: <span style={{color:C.textMute}}>{scramNote}</span></div>
    </div>}
    {/* Editable sig + speed */}
    <div style={{display:"flex",gap:14,marginBottom:12,alignItems:"center"}}>
      <label style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:C.textMid}}>
        Sig radius
        {/* Anchored at 1000 m when the field reads ∞: a scrub has to start from a real number, and the
            top of the sensible range is where a drag downward into ship-sized signatures begins. */}
        <ScrubField value={tgtSig>=IDEAL_SIG?null:tgtSig} display={sigVal} placeholder="∞" anchor={1000}
          title="Type a signature, or press and slide sideways to sweep it"
          onType={e=>{const v=e.target.value;setTgtSig(v===""?IDEAL_SIG:Math.max(0,Number(v)));setTargetProfile("custom");}}
          onScrub={n=>setSig(n)} style={inputStyle}/>
        <span style={{fontSize:10,color:C.textMute}}>m</span>
      </label>
      <label style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:C.textMid}}>
        Speed
        <ScrubField value={targetVel} display={Math.round(targetVel)} anchor={0}
          title="Type a speed, or press and slide sideways to sweep it"
          onType={e=>setSpeed(e.target.value)} onScrub={setSpeed} style={inputStyle}/>
        <span style={{fontSize:10,color:C.textMute}}>m/s</span>
      </label>
    </div>
    <div style={{fontSize:10,fontWeight:700,color:C.textMute,letterSpacing:.8,textTransform:"uppercase",marginBottom:8}}>Flight Vectors</div>
    <div style={{display:"flex",justifyContent:"space-around",alignItems:"center"}}>
      {/* NOT `selfMaxVel||500` — 0 is falsy, and 0 is exactly the value a sieged or bastioned hull
          reports. The caller already ends its own fallback chain with 500 for the genuinely-unknown
          case, so passing the number straight through is what lets 0 mean immobilised. */}
      <VectorCompass label="Your Ship" value={selfAngle} velocity={selfVel} maxVelocity={selfMaxVel} onChange={setSelfAngle} onVelocityChange={setSelfVel} enemyPos="E"/>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
        <div style={{width:1,height:18,background:C.border}}/>
        {/* Tap to swap units. Transversal is what you fly and needs no context; angular velocity is
            what a turret is judged against — shown in deg/s to match EVE's own overview column — but
            it only exists at a range, so its label names the one it was taken at. Which of the two
            you think in is a habit rather than a per-visit whim, so the choice sticks. */}
        <div onClick={()=>setShowTransversal(v=>!v)} title={showTransversal?"Transversal — tap for angular velocity":"Angular velocity — tap for transversal"}
             style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:"4px 8px",textAlign:"center",cursor:"pointer"}}>
          <div style={{fontSize:14,fontWeight:800,color:transColor,fontVariantNumeric:"tabular-nums"}}>
            {showTransversal?trans:fmtAngular(angularSpeedDeg)}</div>
          <div style={{fontSize:8,color:C.textMute}}>
            {showTransversal?"m/s transversal":`°/s @ ${fmtRangeKm(angularDistM)}km`}</div>
        </div>
        <div style={{width:1,height:18,background:C.border}}/>
      </div>
      <VectorCompass label="Target" value={targetAngle} velocity={targetVel} maxVelocity={Math.max(targetVelMax,1)} onChange={setTargetAngle} onVelocityChange={setTargetVel} enemyPos="W"/>
    </div>
  </div>);
}

// The graph's engagement setup — speeds, angles, target sig, axis choice, zoom — is a WORKBENCH
// you tune over several minutes, and it lives in component state that unmounts the moment you swipe
// to the Fit tab to change a module. Everything you had dialled in was gone when you came back.
// Persisted to localStorage instead, and restored on mount. Deliberately NOT part of the fit: it
// describes the engagement you are imagining, not the ship, so it is one setup shared by all fits.
// ⚠ Read PER MOUNT, never once at module load. `const GP=loadGraphPrefs()` at module scope reads
// localStorage exactly once, when this file is first imported — so every later mount restored the
// snapshot taken at app START, not what you actually left the graph in. The writes below were
// landing correctly the whole time; nothing read them back until a full page reload, which is why
// the workbench appeared not to persist at all. The panel is keyed on the sub-tab in
// FittingsScreen, so it remounts every time you swipe away and back — this runs on each of those.
const GRAPH_PREFS_KEY='axis_graph_prefs';
function loadGraphPrefs(){
  try{return JSON.parse(localStorage.getItem(GRAPH_PREFS_KEY)||'{}')??{};}catch{return {};}
}

// Linear interpolation of the plotted curve at an x VALUE.
//
// The cursor is stored as a value (a range in metres, a time in seconds) rather than as a pixel,
// and that is what makes the cross-fit comparison work: switching fit tabs keeps GraphTab mounted
// and swaps the curve underneath, so the same stored x re-reads at the new fit's DPS. A pixel would
// have meant the same thing only by accident, and would have moved under a zoom change.
//
// `col` picks which y column to read: 1 is the plotted curve, 2 the damage graphs' perfect-application
// ghost. Reading both through one function is what keeps the headline's "% of perfect" honest — it is
// two reads of the same interpolation at the same x, not a second estimate.
function interpCurveAt(pts,xVal,col=1){
  if(!pts?.length||xVal==null)return null;
  if(pts[0][col]==null)return null;
  if(xVal<=pts[0][0])return pts[0][col];
  for(let i=1;i<pts.length;i++){
    if(pts[i][0]>=xVal){
      const p0=pts[i-1],p1=pts[i],t=p1[0]===p0[0]?0:(xVal-p0[0])/(p1[0]-p0[0]);
      return p0[col]+(p1[col]-p0[col])*t;
    }
  }
  return pts[pts.length-1][col];
}

// tgtProfile is READ-ONLY here — it is owned by Stats > Firepower, which is the single place it is
// set. No setTgtProfile prop on purpose: the graph consuming state it cannot write is what keeps the
// two views from disagreeing about which resist profile is in force.
function GraphTab({ship,slots,skills,implants,boosters,drones,factorInReload,externalBursts,projectedEffects,tgtProfile,fitsDB,sourceSkills,openFitTabs}){
  const _scroll=useScrollMemory("Graph");
  // Lazy, once per mount — see loadGraphPrefs. A ref rather than useMemo because these feed useState
  // initialisers, and a discarded memo would silently hand back defaults.
  const _prefs=useRef(undefined);
  if(_prefs.current===undefined)_prefs.current=loadGraphPrefs();
  const gp=(k,dflt)=>{const v=_prefs.current[k];return v===undefined?dflt:v;};
  const[catKey,setCatKey]=useState(()=>gp('catKey',"damage")),[yKey,setYKey]=useState(()=>gp('yKey',"dps")),[xKey,setXKey]=useState(()=>gp('xKey',"dist"));
  // Per-category axis memory; see handleCatChange. Damage's defaults above (DPS vs Distance) are
  // what a fresh install opens on.
  const[axisByCat,setAxisByCat]=useState(()=>gp('axisByCat',{}));
  const[targetProfile,setTargetProfile]=useState(()=>gp('targetProfile',"ideal")),[targetAngle,setTargetAngle]=useState(()=>gp('targetAngle',0)),[selfAngle,setSelfAngle]=useState(()=>gp('selfAngle',0));
  // A saved fit standing in for the target: {ship,name}, or null. Stored by NAME rather than by the
  // fit's id because ids are only unique within a ship (see FitPickerSheet's key comment), and this
  // has to survive a restore from backup. A reference that no longer resolves is left alone rather
  // than cleared — see targetFitStats.
  const[targetFit,setTargetFit]=useState(()=>gp('targetFit',null));
  const[showFitPicker,setShowFitPicker]=useState(false);
  // Off by default: the hull profiles have always meant the bare hull, and silently switching them
  // to MWD-on values would move every existing user's curves with no visible cause.
  const[targetMwd,setTargetMwd]=useState(()=>gp('targetMwd',false));
  // Flight vectors start at rest: a graph should open showing the fit's own numbers, not a
  // pre-set engagement the reader did not choose and may not notice.
  const[targetVel,setTargetVel]=useState(()=>gp('targetVel',0)),[selfVel,setSelfVel]=useState(()=>gp('selfVel',0));
  // Stable 100%-reference for the target speed wheel (set by profile/field, NOT by dragging the wheel).
  const[targetVelMax,setTargetVelMax]=useState(()=>gp('targetVelMax',1000));
  // Target sig radius (null = ideal/perfect tracking). Set by profile, editable by tapping.
  // `?? IDEAL_SIG` also migrates a setup persisted before Ideal became an explicit number, where
  // infinite sig was stored as null.
  const[tgtSig,setTgtSig]=useState(()=>gp('tgtSig',IDEAL_SIG)??IDEAL_SIG);
  // Which unit the readout between the wheels shows. Transversal by default: it is the number you fly
  // and it stands on its own, where angular velocity only means something once you also know the range
  // it is read at. Angular is a tap away, and the choice sticks.
  const[showTransversal,setShowTransversal]=useState(()=>gp('showTransversal',true));
  // The selected point, stored as its x VALUE so it survives the remount, follows a zoom, and
  // re-reads against another fit's curve when you switch fit tabs.
  const[cursorX,setCursorX]=useState(()=>gp('cursorX',null));
  // Axis scale (zoom). 1 = auto-fit range from generateCurve; >1 zooms in (smaller max),
  // <1 zooms out (larger max). Applied to the auto max, so it survives fit/axis changes.
  const[xZoom,setXZoom]=useState(()=>gp('xZoom',1)),[yZoom,setYZoom]=useState(()=>gp('yZoom',1));
  // Drag state for the axis-zoom readout's scrub gesture, keyed by axis so X and Y don't share one
  // in-flight gesture. Refs, not state — a drag reads/writes every pointermove and a ref update
  // doesn't re-render, same reasoning as ScrubField's `drag`/`suppressClick`.
  const zoomDrag=useRef({}),zoomSuppressClick=useRef({});
  const[zoomScrubAxis,setZoomScrubAxis]=useState(null);
  // One write whenever any of it changes. Cheap, and it means leaving by ANY route (swipe, tab bar,
  // backgrounding the app) keeps the setup — there is no "on unmount" hook to miss.
  useEffect(()=>{
    try{localStorage.setItem(GRAPH_PREFS_KEY,JSON.stringify(
      {catKey,yKey,xKey,axisByCat,targetProfile,targetFit,targetMwd,targetAngle,selfAngle,targetVel,selfVel,targetVelMax,tgtSig,showTransversal,xZoom,yZoom,cursorX}));}catch{}
  },[catKey,yKey,xKey,axisByCat,targetProfile,targetFit,targetMwd,targetAngle,selfAngle,targetVel,selfVel,targetVelMax,tgtSig,showTransversal,xZoom,yZoom,cursorX]);
  // The ladder the +/− buttons walk. The scrub gesture is continuous and lands BETWEEN these, so
  // stepZoom takes the first rung strictly past the current value rather than indexing off an exact
  // match — an in-between value used to miss the findIndex entirely and jump back to 1×.
  const ZOOM_STEPS=[0.5,0.75,1,1.5,2,3,4,6,8,12,16];
  const ZOOM_MIN=ZOOM_STEPS[0],ZOOM_MAX=ZOOM_STEPS[ZOOM_STEPS.length-1];
  const stepZoom=(z,dir)=>dir>0
    ? (ZOOM_STEPS.find(v=>v>z+1e-9) ?? ZOOM_MAX)
    : ([...ZOOM_STEPS].reverse().find(v=>v<z-1e-9) ?? ZOOM_MIN);
  // A scrubbed zoom is any real number in range, so it needs a readable multiplier: 0.62× / 1.4× / 12×.
  const fmtZoom=v=>v>=10?v.toFixed(0):v>=1?v.toFixed(1):v.toFixed(2);
  // Auto-fit is a value, not a flag, and a continuous drag lands exactly on 1.0 only by luck — so
  // "is this axis auto-fitted" is a tolerance test, and the drag snaps into 1× within a small band
  // so the auto-fit anchor is still reachable by sliding rather than only by tapping reset.
  const isAutoZoom=v=>Math.abs(v-1)<1e-9;
  const cat=GRAPH_CONFIG.find(c=>c.key===catKey);
  // Axis choice is remembered PER CATEGORY. This used to reset both axes to the category's first
  // entry on every switch, so Damage/Time silently became Damage/Distance the moment you looked at
  // Reps and came back — the top-level xKey persisted fine across navigation, but a category round
  // trip threw it away. A category with no remembered pair falls back to its first axes, which is
  // what makes Damage open on DPS vs Distance.
  const handleCatChange=key=>{
    const nc=GRAPH_CONFIG.find(c=>c.key===key);
    setAxisByCat(prev=>({...prev,[catKey]:{y:yKey,x:xKey}}));
    const saved=axisByCat[key];
    // Validate against the category's own axes: a remembered key from an older build (or a renamed
    // axis) must not leave the graph pointing at an axis this category does not have.
    setCatKey(key);
    setYKey(saved&&nc.yAxes.some(a=>a.key===saved.y)?saved.y:nc.yAxes[0].key);
    setXKey(saved&&nc.xAxes.some(a=>a.key===saved.x)?saved.x:nc.xAxes[0].key);
    setCursorX(null);setXZoom(1);setYZoom(1);
  };
  const validY=cat.yAxes.find(a=>a.key===yKey)?yKey:cat.yAxes[0].key;
  const validX=cat.xAxes.find(a=>a.key===xKey)?xKey:cat.xAxes[0].key;
  const yAxis=cat.yAxes.find(a=>a.key===validY),xAxis=cat.xAxes.find(a=>a.key===validX);
  const cs=calcFitStats(ship,slots,drones??[],skills,{implants,boosters,factorInReload,externalBursts,projectedWebMult:projectedEffects?.webMult,projectedNeutGJs:projectedEffects?.neutGJs,projectedCapGJs:projectedEffects?.capGJs,projectedDebuffs:projectedEffects?.debuffs,projectedBoosts:projectedEffects?.boosts,targetResists:tgtProfile?.r,pilotSec:slots?.pilotSec,systemSecurity:slots?.systemSecurity})??{};
  // The fit's own top speed, and the speed actually used by the maths. A sieged/bastioned hull
  // reports 0 here, so the wheel's stored heading and speed must NOT be allowed to contribute a
  // transversal the ship cannot physically generate — clamp rather than trust the persisted value,
  // which may predate the siege module being fitted.
  const selfMaxVel=cs?.maxVelocityAB??cs?.maxVelocity??ship?.maxVelocity??500;
  const selfVelEff=Math.max(0,Math.min(selfVel,selfMaxVel));
  // The fit's OWN outgoing projection (reps/webs/neuts/damps/ECM it applies to others) for the EWAR/Reps graphs.
  const ownProj=useMemo(()=>{
    const sn=ship?.name; if(!sn) return null;
    try{ return computeProjectedReps({name:sn,typeID:tidByName(sn)},slots,skills,{implants,boosters,drones}); }catch{ return null; }
  },[ship,slots,skills,implants,boosters,drones]);
  // What the target would present with its MWD off — the only thing a scrambler in `ownProj` can be
  // modelled against. Non-null only for a preset that HAS an MWD variant and is currently running it:
  // once sig or speed is typed the profile becomes "custom", which carries no variant, and a typed
  // number cannot be decomposed into hull plus MWD bloom.
  // The open fit tabs, resolved to real fits, as the picker's shortcut list. The fit currently being
  // EDITED is kept in rather than filtered out: shooting your own fit is a mirror match, which is a
  // question people genuinely ask of a graph like this. The tabs arrive already reconciled against
  // fitsDB by resolveTabs, so a pointer here always names a fit that exists.
  const openTabFits=useMemo(()=>(openFitTabs??[])
    .map(t=>{const f=fitsDB?.[t.ship]?.find(x=>x.name===t.name);return f?{ship:t.ship,fit:f}:null;})
    .filter(Boolean),[openFitTabs,fitsDB]);
  // The chosen target fit's two sig/speed pairs, or null when nothing is chosen — and ALSO null when
  // the reference no longer resolves (the fit was renamed or deleted). That case deliberately leaves
  // the sig and speed fields showing the numbers it last supplied: they are still a real target, and
  // silently resetting the engagement to Ideal because a fit was tidied up is worse than a stale chip
  // saying so. Skills resolve through the caller's `sourceSkills` for the same reason a projected fit
  // does — this is someone else's ship, flown on whatever sheet it was last edited under.
  const targetFitStats=useMemo(()=>{
    if(!targetFit)return null;
    const fit=fitsDB?.[targetFit.ship]?.find(f=>f.name===targetFit.name);
    if(!fit)return null;
    return targetFitProfile(targetFit.ship,fit,sourceSkills?sourceSkills(fit):skills);
  },[targetFit,fitsDB,sourceSkills,skills]);
  // The single place a fit target's numbers are pushed into the sig/speed fields. An effect rather
  // than a write inside the picker's onSelect so that all three ways in agree: choosing a fit,
  // toggling MWD, and coming back to a graph whose target fit has been edited since. Typing in either
  // field sets targetProfile to "custom", which is what detaches it from here.
  useEffect(()=>{
    if(targetProfile!==TARGET_FIT||!targetFitStats)return;
    const t=(targetMwd&&targetFitStats.hasProp)?targetFitStats.mwd:targetFitStats.noMwd;
    setTgtSig(t.sig);setTargetVel(t.vel);setTargetVelMax(Math.max(t.vel,100));
  },[targetProfile,targetFitStats,targetMwd]);
  const tgtNoMwd=useMemo(()=>{
    // A fit target is the case a scrambler was always missing: its prop mod can simply be switched
    // off and the hull re-read, which is exactly what a typed sig or speed cannot be decomposed into.
    if(targetProfile===TARGET_FIT)return (targetMwd&&targetFitStats?.hasProp)?targetFitStats.noMwd:null;
    return (targetMwd&&TARGET_PROFILES[targetProfile]?.mwdSig!=null)?profileTarget(targetProfile,false):null;
  },[targetMwd,targetProfile,targetFitStats]);
  const{pts,xMax,yMax:autoYMax}=generateCurve(catKey,validY,validX,{targetProfile,shipVelFrac:selfVelEff/(ship?.maxVelocity||500),ship:ship??{},cs,ownProj,selfVel:selfVelEff,targetVel,selfAngle,targetAngle,tgtSig,tgtSpeed:targetVel,tgtNoMwd,xZoom});
  // xMax already reflects xZoom (the curve is generated across the zoomed domain, so it actually
  // extends to the new axis edge instead of stopping short). Y just rescales the axis.
  const yMax=autoYMax/yZoom;
  const _baseIdx=Math.floor(pts.length*.05);
  const baseHeadline=pts.length?pts[_baseIdx][1]:null;
  // A stored x can fall outside the current domain (a zoom in, or an axis that runs shorter on this
  // fit). Treat that as "no selection" rather than pinning the readout to the edge — but keep the
  // value, so zooming back out or switching to a longer-ranged fit restores the same point.
  const cursorLive=cursorX!=null&&cursorX<=xMax;
  const cursorY=cursorLive?interpCurveAt(pts,cursorX):null;
  // Angular velocity is transversal over the range it is seen across, so it needs a distance to exist
  // at all (transversal itself is range-independent — the distance below is only for looking up how
  // hard a range-scaled web is biting, not for the vector maths). Scrubbing a distance axis names one,
  // and following the cursor is the point — that is the reading you would have in space at that range.
  // Otherwise it falls back to the same engagement distance the speed and sig axes hold themselves at,
  // and the readout quotes which range it used either way, so the number is never floating free of one.
  const angularDistM=(validX==="dist"&&cursorLive)?cursorX*1000:engagementDistanceM(cs);
  // Same two effects the Damage graph's application curve already accounts for (see `ownWebMultAt` /
  // `ownScrammedAt`), applied here too so the transversal/angular readouts can't disagree with the
  // curve right next to them about how fast the target is actually moving. A scrambler in range swaps
  // in the MWD-off speed first (only possible against a preset target whose MWD variant is known —
  // see `tgtNoMwd`'s own comment), THEN the web multiplier scales that down further.
  const targetVelNoMwd=(tgtNoMwd&&ownScrammedAt(ownProj,angularDistM))?tgtNoMwd.vel:targetVel;
  const targetVelWebbed=targetVelNoMwd*ownWebMultAt(ownProj,angularDistM);
  // Real transversal: component of relative velocity perpendicular to the line of sight (m/s).
  // North (up) on the compass = toward/away from the target (radial); E/W = across (transversal).
  const transversalSpeed=Math.abs(selfVelEff*Math.sin(selfAngle*Math.PI/180)-targetVelWebbed*Math.sin(targetAngle*Math.PI/180));
  const angularSpeed=calcAngularSpeed(selfVelEff,selfAngle,cs?.shipRadius??0,angularDistM,targetVelWebbed,targetAngle,0);
  const displayVal=cursorY!=null?cursorY:baseHeadline;
  const displayX=cursorY!=null?cursorX:null;
  // What the same point would be worth with application perfect, as a share.
  //
  // Shown for the whole of a damage graph, including where it reads 100%. It used to appear only where
  // the two curves differed, which meant scrubbing across the distance where a fit starts applying fully
  // mounted and unmounted the line under the headline — and moved the graph below it — on every pass.
  // A row that comes and goes while you are dragging along it is worse than a row that says 100%.
  //
  // Null only when there is no ghost column at all (every non-damage category), where the question does
  // not exist. Past every weapon's range both columns are 0 and the share is 0/0, so that reads "--"
  // rather than inventing a number, and the row keeps its height either way.
  const displayGhost=pts.length?(cursorY!=null?interpCurveAt(pts,cursorX,2):pts[_baseIdx][2]):null;
  const hasIdeal=displayGhost!=null;
  // Clamped: application cannot beat perfect, and float dust at the ceiling must not print 101%.
  const appliedPct=(displayGhost>0&&displayVal!=null)?Math.min(100,Math.round(displayVal/displayGhost*100)):null;
  const fmt=v=>v==null?"--":v>=10000?`${(v/1000).toFixed(1)}k`:v>=100?v.toFixed(0):v.toFixed(1);
  return(<div ref={_scroll} style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column"}}>
    <div style={{borderBottom:`1px solid ${C.border}`,padding:"8px 10px"}}>
      <div className="hs" style={{overflowX:"auto",display:"flex",gap:5,paddingBottom:2}}>
        {GRAPH_CONFIG.map(c=><button key={c.key} onClick={()=>handleCatChange(c.key)} style={{flexShrink:0,padding:"4px 9px",borderRadius:6,fontSize:10,fontWeight:700,cursor:"pointer",background:catKey===c.key?`${c.color}22`:C.surface,border:`1px solid ${catKey===c.key?c.color:C.border}`,color:catKey===c.key?c.color:C.textMid}}>{c.label}</button>)}
      </div>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,padding:"8px 10px",background:C.surfaceAlt,borderBottom:`1px solid ${C.border}`}}>
      <div><div style={{fontSize:9,fontWeight:700,color:C.textMute,letterSpacing:.8,textTransform:"uppercase",marginBottom:4}}>Axis Y</div><select value={validY} onChange={e=>{setYKey(e.target.value);setYZoom(1);}} style={{width:"100%",padding:"5px 6px",borderRadius:6,fontSize:11,background:C.surface,border:`1px solid ${C.border}`,color:C.text}}>{cat.yAxes.map(a=><option key={a.key} value={a.key}>{a.label}</option>)}</select></div>
      <div><div style={{fontSize:9,fontWeight:700,color:C.textMute,letterSpacing:.8,textTransform:"uppercase",marginBottom:4}}>Axis X</div><select value={validX} onChange={e=>{setXKey(e.target.value);setCursorX(null);setXZoom(1);}} disabled={cat.xAxes.length===1} style={{width:"100%",padding:"5px 6px",borderRadius:6,fontSize:11,background:C.surface,border:`1px solid ${C.border}`,color:C.text,opacity:cat.xAxes.length===1?.5:1}}>{cat.xAxes.map(a=><option key={a.key} value={a.key}>{a.label}</option>)}</select></div>
      {/* Axis scale (zoom): − shrinks the displayed max, + grows it — the naive, "smaller number"
          reading of the sign, not the zoom-level's own (max=autoMax/zoom, so shrinking the number
          means INCREASING zoom). The readout between them is a continuous scrub: press and drag
          horizontally to sweep the axis smoothly, same gesture ScrubField uses for the target
          sig/speed fields. A plain tap (no drag past SCRUB_ARM_PX) resets to auto-fit instead. */}
      {[{ax:"Y",zoom:yZoom,setZoom:setYZoom,max:yMax},{ax:"X",zoom:xZoom,setZoom:setXZoom,max:xMax}].map(z=>{
        const atMin=z.zoom<=ZOOM_MIN+1e-9, atMax=z.zoom>=ZOOM_MAX-1e-9;
        const btn=(dis)=>({flex:"0 0 26px",padding:"4px 0",borderRadius:6,fontSize:13,fontWeight:700,lineHeight:1,
          cursor:dis?"default":"pointer",background:C.surface,border:`1px solid ${C.border}`,color:dis?C.textMute:C.textMid,opacity:dis?.4:1});
        const scrubbing=zoomScrubAxis===z.ax;
        const isAuto=isAutoZoom(z.zoom);
        const onPointerDown=e=>{
          zoomDrag.current[z.ax]={x:e.clientX,startZoom:z.zoom,armed:false,id:e.pointerId};
        };
        const onPointerMove=e=>{
          const d=zoomDrag.current[z.ax]; if(!d) return;
          const dx=e.clientX-d.x;
          if(!d.armed){
            if(Math.abs(dx)<SCRUB_ARM_PX) return;
            d.armed=true;
            try{e.currentTarget.setPointerCapture(d.id);}catch{}
            document.body.classList.toggle("no-select",true);
            window.getSelection?.()?.removeAllRanges();
            setZoomScrubAxis(z.ax);
            haptic();
          }
          e.stopPropagation();
          // GEOMETRIC, not linear: zoom is a multiplier, so a fixed pixel distance has to mean a fixed
          // RATIO or the drag crawls at 0.5× and rockets past 8×. 44px per doubling puts the whole
          // 0.5–16× range in a ~220px sweep, which is what the old step-per-22px drag spanned.
          // Right = grow the number = smaller zoom, the same sign flip as the +/− buttons beside it.
          const raw=d.startZoom*Math.pow(2,-dx/44);
          // Detent: 1× is the one value worth landing on exactly (it's auto-fit), and a continuous
          // drag would otherwise only ever pass near it. The band is 0.05 to match what fmtZoom can
          // actually show — anything inside it rounds to "1.0×", so without the snap the readout
          // would claim 1.0× while the axis was still scaled, which is the confusing half-state.
          // ~3px of travel: catchable with a thumb, not enough to feel like the drag sticks.
          const snapped=Math.abs(raw-1)<0.05?1:raw;
          z.setZoom(Math.max(ZOOM_MIN,Math.min(ZOOM_MAX,snapped)));
        };
        const endDrag=e=>{
          const d=zoomDrag.current[z.ax]; if(!d) return;
          if(d.armed){
            try{e.currentTarget.releasePointerCapture(d.id);}catch{}
            document.body.classList.toggle("no-select",false);
            setZoomScrubAxis(null);
            zoomSuppressClick.current[z.ax]=true;
          }
          zoomDrag.current[z.ax]=null;
        };
        const swallowTouch=e=>e.stopPropagation();
        return(<div key={z.ax} style={{display:"flex",alignItems:"center",gap:4}}>
          <button onClick={()=>{z.setZoom(v=>stepZoom(v,1));}} disabled={atMax} style={btn(atMax)}>−</button>
          <button
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
            onTouchStart={swallowTouch} onTouchMove={swallowTouch} onTouchEnd={swallowTouch}
            onDragStart={e=>e.preventDefault()}
            onClick={()=>{ if(zoomSuppressClick.current[z.ax]){zoomSuppressClick.current[z.ax]=false;return;} z.setZoom(1); }}
            title="Drag to scrub, tap to reset to auto-fit"
            style={{flex:1,padding:"4px 0",borderRadius:6,fontSize:10,fontWeight:700,cursor:"ew-resize",touchAction:"pan-y",
              background:isAuto?C.surface:`${cat.color}22`,
              border:`1px solid ${scrubbing?C.accent:(isAuto?C.border:cat.color)}`,color:scrubbing?C.accent:(isAuto?C.textMute:cat.color),whiteSpace:"nowrap",overflow:"hidden"}}>
            {z.ax} {fmt(z.max)}{isAuto?"":` · ${fmtZoom(z.zoom)}×`}
          </button>
          <button onClick={()=>{z.setZoom(v=>stepZoom(v,-1));}} disabled={atMin} style={btn(atMin)}>+</button>
        </div>);
      })}
    </div>
    {displayVal!=null&&<div style={{padding:"8px 14px 0",display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
      <div>
        <span style={{fontSize:22,fontWeight:800,color:cat.color}}>{fmt(displayVal)}</span>
        <span style={{fontSize:11,color:C.textMute,marginLeft:5}}>{yAxis?.label}</span>
        {hasIdeal&&<div style={{fontSize:10,color:C.textMute,marginTop:1}}>{appliedPct!=null?`${appliedPct}%`:"--"}</div>}
      </div>
      <div style={{textAlign:"right"}}>
        {displayX!=null&&<div style={{fontSize:11,color:C.textMute}}>@ <span style={{color:C.text,fontWeight:600}}>{fmt(displayX)}</span> {xAxis?.label?.split(",")[0]}</div>}
        {(()=>{ if(catKey!=="ewar"&&catKey!=="reps") return null;
          const P=ownProj||{};
          const has = catKey==="reps" ? (P.reps?.length>0)
            : yKey==="neutsCap" ? (P.neuts?.length>0)
            : yKey==="webSpeed" ? (P.webs?.length>0)
            : yKey==="ecmStr"   ? (P.ecm?.length>0)
            : yKey==="tdRange"  ? (P.trackDisr?.length>0)
            : yKey==="gdRange"  ? (P.guideDisr?.length>0)
            : yKey==="tpSig"    ? (P.painters?.length>0)
            : (P.damps?.length>0);
          return has ? null : <span style={{fontSize:11,color:C.textMute,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:6,padding:"3px 8px"}}>No modules fitted</span>;
        })()}
      </div>
    </div>}
    {/* Only the `dist` axis, which is km of separation from a target you have to be holding: damage,
        ewar and reps. Warp's own distance axes are not a projection and get no line. */}
    <div style={{padding:"4px 10px 0"}}><LineChart pts={pts} xMax={xMax} yMax={yMax} xLabel={xAxis?.label} yLabel={yAxis?.label} color={cat.color} cursorX={cursorX} onCursorXChange={setCursorX}
      marker={xAxis?.key==="dist"&&(cs.targetRange>0)?{x:cs.exact?.targetRange??cs.targetRange,label:"lock range"}:null}/></div>
    {cat.showTargetControls&&<div style={{padding:"0 10px 12px"}}><TargetControls tgtProfile={tgtProfile} targetProfile={targetProfile} setTargetProfile={setTargetProfile} targetMwd={targetMwd} setTargetMwd={setTargetMwd} targetAngle={targetAngle} setTargetAngle={setTargetAngle} selfAngle={selfAngle} setSelfAngle={setSelfAngle} targetVel={targetVel} setTargetVel={setTargetVel} selfVel={selfVelEff} setSelfVel={setSelfVel} transversalSpeed={transversalSpeed} angularSpeed={angularSpeed} angularDistM={angularDistM} showTransversal={showTransversal} setShowTransversal={setShowTransversal} tgtSig={tgtSig} setTgtSig={setTgtSig} targetVelMax={targetVelMax} setTargetVelMax={setTargetVelMax} selfMaxVel={selfMaxVel} ship={ship} ownProj={ownProj} targetFit={targetFit} targetFitStats={targetFitStats} onPickFit={()=>setShowFitPicker(true)} onClearFit={()=>{setTargetFit(null);setTargetProfile("custom");}}/></div>}
    {showFitPicker&&<FitPickerSheet title="Target Fit" fitsDB={fitsDB??{}} pinned={openTabFits}
      onSelect={(shipName,fit)=>{setTargetFit({ship:shipName,name:fit.name});setTargetProfile(TARGET_FIT);}}
      onClose={()=>setShowFitPicker(false)}/>}
  </div>);
}

// ═══ ACTIVE FIT BAR ════════════════════════════════════════════
export { GraphTab, GRAPH_CONFIG, generateCurve };
