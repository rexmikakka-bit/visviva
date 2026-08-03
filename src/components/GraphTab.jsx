import { useState, useMemo, useRef } from "react";
import { C } from "../theme.js";
import { DAMAGE_PROFILES } from "../data/damage-profiles.js";
import {
  TYPES, tidByName, calcFitStats, computeProjectedReps,
  calcRangeFactor, calcTurretCTH, calcTurretMult, calcMissileFactor,
  stackingPenalty, simulateCapTrace,
} from "../calc.js";

// Reference targets for the application curves. Only the graph uses these, so they live here.
const TARGET_PROFILES={
  ideal:   {label:"Ideal",   sig:null,    vel:null,  dist:0,     desc:"Perfect tracking"},
  frigate: {label:"Frigate", sig:40,      vel:350,   dist:10000, desc:"40m sig / 350 m/s"},
  cruiser: {label:"Cruiser", sig:130,     vel:200,   dist:20000, desc:"130m sig / 200 m/s"},
  battleship:{label:"Battleship",sig:380, vel:100,   dist:30000, desc:"380m sig / 100 m/s"},
  fit:     {label:"Choose Fit", sig:null, vel:null,  dist:20000, desc:"From saved fit"},
};

const GRAPH_CONFIG=[
  {key:"damage",label:"Damage",icon:"sword",color:C.danger,showTargetControls:true,
   yAxes:[{key:"dps",label:"DPS"},{key:"volley",label:"Volley"},{key:"inflicted",label:"Damage inflicted"}],
   xAxes:[{key:"dist",label:"Distance, km"},{key:"time",label:"Time, s"},{key:"tgtSpeedMs",label:"Target speed, m/s"},{key:"tgtSpeedPct",label:"Target speed, %"},{key:"tgtSigM",label:"Target sig. radius, m"},{key:"tgtSigPct",label:"Target sig. radius, %"}]},
  {key:"ewar",label:"Ewar",icon:"radar",color:C.high,yAxes:[{key:"neutsCap",label:"Neuts: cap/s"},{key:"webSpeed",label:"Webs: speed red., %"},{key:"ecmStr",label:"ECM: combined strength"},{key:"dampLock",label:"Damps: lock range red., %"},{key:"tdRange",label:"Tracking disr: range red., %"},{key:"gdRange",label:"Guidance disr: range red., %"},{key:"tpSig",label:"Target paint: sig incr., %"}],xAxes:[{key:"dist",label:"Distance, km"}]},
  {key:"reps",label:"Reps",icon:"heart",color:C.rig,yAxes:[{key:"repSpeed",label:"Repair speed, HP/s"},{key:"repTotal",label:"Total repaired, HP"}],xAxes:[{key:"dist",label:"Distance, km"},{key:"time",label:"Time, s"}]},
  {key:"shieldRegen",label:"Shield",icon:"shield",color:C.mid,yAxes:[{key:"shieldAmt",label:"Shield, EHP"},{key:"shieldRegen",label:"Shield regen, EHP/s"}],xAxes:[{key:"time",label:"Time, s"},{key:"shieldPct",label:"Shield, %"}]},
  {key:"cap",label:"Capacitor",icon:"bolt",color:C.warning,yAxes:[{key:"capAmt",label:"Cap, GJ"},{key:"capRegen",label:"Cap regen, GJ/s"}],xAxes:[{key:"time",label:"Time, s"},{key:"capPct",label:"Cap, %"}]},
  {key:"mobility",label:"Mobility",icon:"rocket",color:C.low,yAxes:[{key:"speed",label:"Speed, m/s"},{key:"distance",label:"Distance, km"},{key:"bumpSpeed",label:"Bump speed, m/s"}],xAxes:[{key:"time",label:"Time, s"}]},
  {key:"warp",label:"Warp",icon:"warp",color:C.high,yAxes:[{key:"warpTime",label:"Warp time, s"}],xAxes:[{key:"distAU",label:"Distance, AU"},{key:"distKm",label:"Distance, km"}]},
  {key:"lock",label:"Lock",icon:"target",color:C.danger,yAxes:[{key:"lockTime",label:"Lock time, s"}],xAxes:[{key:"tgtSig",label:"Target sig. radius, m"}]},
];

function generateCurve(catKey,yKey,xKey,params={}){
  const{targetProfile="ideal",shipVelFrac=1,ship={},cs=null,xZoom=1}=params;
  // The X zoom control has to widen/narrow the DATA DOMAIN, not just the axis — otherwise zooming out
  // leaves the curve stopping dead at the old domain edge (e.g. damage-inflicted flatlining at 120s
  // while the axis ran to 160s). dom() scales every domain constant below by 1/xZoom; percentage axes
  // that are physically bounded (shield %, cap %) pass a cap so they never run past 100%.
  const XS = 1/(xZoom||1);
  const dom = (base,capMax)=>{ const d=base*XS; return capMax!=null?Math.min(d,capMax):d; };
  // Use real fit DPS from calcFitStats when available
  const realDps   = cs?.totalDps?.total   ?? cs?.weaponDps?.total   ?? 0;
  const realVolley= cs?.totalVolley?.total ?? cs?.weaponVolley?.total ?? 0;
  let pts=[],xMax,yMax;
  if(catKey==="damage"){
    const weapons = cs?.graphWeapons ?? [];
    const baseDps = realDps || 0, baseVolley = realVolley || 0;
    const wantVolley = yKey==="volley";
    // Editable target sig/speed (tgtSig null = ideal / perfect tracking). Range falloff still applies.
    const ideal = params.tgtSig == null;
    const profSig = params.tgtSig ?? cs?.sigRadius ?? 130;
    const profVel = params.tgtSpeed ?? 0;
    // Fixed engagement distance for the speed/sig axes (hold range constant, vary tracking inputs).
    let engDist = 0;
    for (const w of (cs?.graphWeapons ?? [])) engDist = Math.max(engDist, w.kind==="missile" ? (w.lowerRange||0) : (w.optimal || 0));
    if (engDist <= 0) engDist = 30000;
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
    const weaponMult = (w, distM, tgtSig, tgtSpeed) => {
        if (w.kind === "turret") {
          if (ideal) {
            const rf = w.falloff > 0
              ? Math.pow(0.5, Math.pow(Math.max(0, distM - w.optimal) / w.falloff, 2))
              : (distM <= w.optimal ? 1 : 0);
            return calcTurretMult(rf);
          }
          const cth = calcTurretCTH({ atkSpeed, atkAngle, atkRadius: shipRadius,
            optimal: w.optimal, falloff: w.falloff, tracking: w.tracking,
            optimalSigRadius: w.optimalSigRadius, distance: distM,
            tgtSpeed, tgtAngle, tgtRadius, tgtSig });
          return calcTurretMult(cth);
        } else if (w.kind === "missile") {
          const df = distM <= w.lowerRange ? 1 : (distM <= w.higherRange ? w.higherChance : 0);
          return ideal ? df : df * calcMissileFactor(w.explosionRadius, w.explosionVelocity, w.aoeDamageReductionFactor, tgtSpeed, tgtSig);
        } else if (w.kind === "drone") {
          return distM <= (w.controlRange ?? Infinity) ? 1 : 0;
        }
        return 1;
    };
    // Compute total applied DPS (or volley) at a given engagement.
    const applied = (distM, tgtSig, tgtSpeed) => {
      let total = 0;
      for (const w of weapons) {
        const vol = w.volley.em + w.volley.th + w.volley.kin + w.volley.exp;
        const per = wantVolley ? vol : vol / w.cycleS;
        total += per * weaponMult(w, distM, tgtSig, tgtSpeed);
      }
      return total;
    };
    if (baseDps === 0 && baseVolley === 0) { pts=[[0,0],[40,0]]; xMax=40; yMax=100; }
    else if (xKey === "dist") {
      const step = distMaxKm/80;
      for (let km=0; km<=distMaxKm+1e-9; km+=step) pts.push([km, yKey==="inflicted" ? 0 : applied(km*1000, profSig, profVel)]);
      xMax=distMaxKm; yMax=(wantVolley?baseVolley:baseDps)*1.15;
    }
    else if (xKey === "time") {
      if (yKey === "inflicted") {
        // Stepped cumulative damage: each weapon lands a discrete volley at t=0, then every cycle,
        // pausing for reload after each clip of numShots (so the staircase flattens during reload).
        const TMAX=dom(120);
        const wv = weapons.map(w=>({ vol:(w.volley.em+w.volley.th+w.volley.kin+w.volley.exp)*weaponMult(w,0,profSig,profVel),
                                     cycleS:w.cycleS, numShots:w.numShots||0, reloadS:w.reloadS||0 }))
                          .filter(x=>x.vol>0 && x.cycleS>0);
        const evts=[];
        for (const w of wv){
          let t=0, shots=0, guard=0;
          while (t<=TMAX+1e-9 && guard++<100000){
            evts.push([t,w.vol]); shots++;
            if (w.numShots>0 && shots>=w.numShots){ shots=0; t += w.cycleS + w.reloadS; }
            else t += w.cycleS;
          }
        }
        evts.sort((a,b)=>a[0]-b[0]);
        let acc=0; pts.push([0,0]);
        for (const [t,d] of evts){ pts.push([t,acc]); acc+=d; pts.push([t,acc]); }   // step then jump
        pts.push([TMAX,acc]);
        xMax=TMAX; yMax=acc*1.05||100;
      } else {
        const eff=applied(0,profSig,profVel);
        const tEnd=dom(120), tStep=tEnd/480;
        for(let t=0;t<=tEnd+1e-9;t+=tStep) pts.push([t,eff]);
        xMax=tEnd; yMax=(wantVolley?baseVolley:baseDps)*1.15;
      }
    }
    else if (xKey === "tgtSpeedMs") { const vEnd=dom(3000), vStep=vEnd/120; for(let v=0;v<=vEnd+1e-9;v+=vStep) pts.push([v, applied(engDist, profSig, v)]); xMax=vEnd; yMax=(wantVolley?baseVolley:baseDps)*1.15; }
    else if (xKey === "tgtSpeedPct") { const vmax=profVel||1000; const pEnd=dom(100), pStep=pEnd/100; for(let p=0;p<=pEnd+1e-9;p+=pStep) pts.push([p, applied(engDist, profSig, vmax*p/100)]); xMax=pEnd; yMax=(wantVolley?baseVolley:baseDps)*1.15; }
    else if (xKey === "tgtSigM") { const sEnd=dom(1000), sStep=sEnd/125; for(let sg=0;sg<=sEnd+1e-9;sg+=sStep) pts.push([sg, applied(engDist, sg, profVel)]); xMax=sEnd; yMax=(wantVolley?baseVolley:baseDps)*1.15; }
    else { const pEnd=dom(200), pStep=pEnd/100; for(let p=0;p<=pEnd+1e-9;p+=pStep) pts.push([p, applied(engDist, profSig*p/100, profVel)]); xMax=pEnd; yMax=(wantVolley?baseVolley:baseDps)*1.15; }
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
      if(yKey==="ecmStr")   return (P.ecm||[]).reduce((s,e)=>s+e.strength*rf(e.optimal,e.falloff,dM),0);
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
    if(xKey==="time"){const rate=rateAt(0);const tEnd=dom(120),dt=tEnd/240;let acc=0;for(let t=0;t<=tEnd+1e-9;t+=dt){acc+=rate*dt;pts.push([t,yKey==="repTotal"?acc:rate]);}xMax=tEnd;yMax=(yKey==="repTotal"?acc:rate)*1.15||1;}
    else{let dmax=reachM>0?reachM/1000*1.05:30;dmax=dmax<=20?Math.ceil(dmax):dmax<=60?Math.ceil(dmax/5)*5:Math.ceil(dmax/10)*10;dmax=dom(dmax);const step=dmax/80;for(let km=0;km<=dmax+1e-9;km+=step){const rate=rateAt(km*1000);pts.push([km,yKey==="repTotal"?rate*10:rate]);}xMax=dmax;yMax=(pts.length?Math.max(...pts.map(p=>p[1])):1)*1.2||1;}
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
    for(let t=0;t<=tEnd+1e-9;t+=dt){const v=vmax*(1-Math.exp(-t/tau));dist+=v*dt/1000;pts.push([t,yKey==="speed"?v:yKey==="distance"?dist:vmax*Math.exp(-t/3)]);}
    xMax=tEnd;yMax=yKey==="speed"?vmax*1.1:yKey==="distance"?dist*1.15:vmax*1.1;
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
  if(pts.length){const dm=Math.max(...pts.map(p=>p[1]));if(!yMax||dm>yMax)yMax=dm*1.1;}
  return{pts,xMax:xMax??100,yMax:yMax??100};
}

function LineChart({pts,xMax,yMax,xLabel,yLabel,color,onCursorChange}){
  const W=280,H=140,PL=36,PB=20,PT=6,PR=8,gW=W-PL-PR,gH=H-PB-PT;
  const toX=x=>PL+(x/xMax)*gW,toY=y=>PT+gH-(y/yMax)*gH;
  const[cursorX,setCursorX]=useState(null);
  if(!pts||!pts.length)return null;
  const fmt=v=>v>=10000?`${(v/1000).toFixed(0)}k`:v>=1000?`${(v/1000).toFixed(1)}k`:parseFloat(v.toPrecision(3)).toString();
  const yT=[0,.25,.5,.75,1].map(f=>yMax*f),xT=[0,.25,.5,.75,1].map(f=>xMax*f);
  const lp=pts.map(([x,y],i)=>`${i===0?"M":"L"}${toX(x).toFixed(1)},${toY(Math.max(0,y)).toFixed(1)}`).join(" ");
  const ap=lp+` L${toX(pts[pts.length-1][0])},${toY(0)} L${toX(pts[0][0])},${toY(0)} Z`;
  const gId="g"+color.replace(/[^a-zA-Z0-9]/g,"");
  const interpY=svgX=>{const xVal=Math.max(0,Math.min(xMax,(svgX-PL)/gW*xMax));for(let i=1;i<pts.length;i++){if(pts[i][0]>=xVal){const[x0,y0]=pts[i-1],[x1,y1]=pts[i],t=x1===x0?0:(xVal-x0)/(x1-x0);return{xVal,yVal:y0+(y1-y0)*t};}}return{xVal,yVal:pts[pts.length-1][1]};};
  const handleMouseMove=e=>{const rect=e.currentTarget.getBoundingClientRect(),scaleX=W/rect.width,svgX=(e.clientX-rect.left)*scaleX;if(svgX<PL||svgX>W-PR){setCursorX(null);onCursorChange&&onCursorChange(null);return;}const{xVal,yVal}=interpY(svgX);setCursorX(svgX);onCursorChange&&onCursorChange({xVal,yVal});};
  const handleTouchMove=e=>{e.preventDefault();const rect=e.currentTarget.getBoundingClientRect(),scaleX=W/rect.width,svgX=(e.touches[0].clientX-rect.left)*scaleX;if(svgX<PL||svgX>W-PR){setCursorX(null);onCursorChange&&onCursorChange(null);return;}const{xVal,yVal}=interpY(svgX);setCursorX(svgX);onCursorChange&&onCursorChange({xVal,yVal});};
  const handleLeave=()=>{setCursorX(null);onCursorChange&&onCursorChange(null);};
  const cursorYVal=cursorX!=null?interpY(cursorX):null;
  return(<svg width="100%" height={H+18} viewBox={`0 0 ${W} ${H+18}`} style={{overflow:"visible",cursor:"crosshair"}} onMouseMove={handleMouseMove} onMouseLeave={handleLeave} onTouchMove={handleTouchMove} onTouchEnd={handleLeave}>
    <defs>
      <linearGradient id={gId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".22"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient>
      {/* Zoomed axes shrink xMax/yMax, so the curve can run past the plot box — clip it to the grid. */}
      <clipPath id={gId+"clip"}><rect x={PL} y={PT} width={gW} height={gH}/></clipPath>
    </defs>
    {yT.map((v,i)=><line key={i} x1={PL} y1={toY(v)} x2={W-PR} y2={toY(v)} stroke={C.border} strokeWidth="1"/>)}
    {xT.map((v,i)=><line key={i} x1={toX(v)} y1={PT} x2={toX(v)} y2={PT+gH} stroke={C.border} strokeWidth="1"/>)}
    <g clipPath={`url(#${gId}clip)`}>
      <path d={ap} fill={`url(#${gId})`}/><path d={lp} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
    </g>
    {cursorX!=null&&cursorYVal!=null&&(<g><line x1={cursorX} y1={PT} x2={cursorX} y2={PT+gH} stroke={C.text} strokeWidth="1" strokeDasharray="3,3" opacity="0.6"/><circle cx={cursorX} cy={Math.max(PT,Math.min(PT+gH,toY(Math.max(0,cursorYVal.yVal))))} r={4} fill={color} stroke={C.surface} strokeWidth="2"/></g>)}
    {yT.map((v,i)=><text key={i} x={PL-3} y={toY(v)+3} textAnchor="end" fill={C.textMute} fontSize="8" fontFamily="sans-serif">{fmt(v)}</text>)}
    {xT.map((v,i)=><text key={i} x={toX(v)} y={H+4} textAnchor="middle" fill={C.textMute} fontSize="8" fontFamily="sans-serif">{fmt(v)}</text>)}
    <text x={PL+gW/2} y={H+16} textAnchor="middle" fill={C.textMute} fontSize="9" fontFamily="sans-serif">{xLabel}</text>
    <text x={9} y={PT+gH/2} textAnchor="middle" fill={C.textMute} fontSize="9" fontFamily="sans-serif" transform={`rotate(-90,9,${PT+gH/2})`}>{yLabel}</text>
  </svg>);
}

function VectorCompass({label,value,velocity,maxVelocity,onChange,onVelocityChange}){
  const cx=45,cy=45,rMax=34;
  const safeMV=maxVelocity>0?maxVelocity:500;
  const velFrac=Math.min((velocity??0)/safeMV,1);
  const r=velFrac<0.05?5:rMax*velFrac;
  const rad=(value-90)*Math.PI/180,nx=cx+r*Math.cos(rad),ny=cy+r*Math.sin(rad);
  const dirs=["N","NE","E","SE","S","SW","W","NW"],cardinal=dirs[Math.round(value/45)%8];

  function handlePt(clientX,clientY,rect){
    const scale=rect.width/90;
    const dx=(clientX-rect.left)/scale-cx;
    const dy=(clientY-rect.top)/scale-cy;
    const dist=Math.sqrt(dx*dx+dy*dy);
    const angle=Math.round((Math.atan2(dy,dx)*180/Math.PI+90+360)%360);
    const newVelFrac=Math.min(dist/rMax,1);
    onChange(angle);
    onVelocityChange&&onVelocityChange(Math.round(newVelFrac*safeMV));
  }
  // Double-tap / double-click a compass to park it: heading 0 (straight at the enemy), speed 0.
  // The first tap of a double still moves the vector — harmless, since the reset lands on top of it
  // and the alternative is delaying every single tap by the double-tap window just to find out.
  const reset=()=>{onChange(0);onVelocityChange&&onVelocityChange(0);};
  const lastTap=useRef(0);
  const onClick=e=>{const rect=e.currentTarget.getBoundingClientRect();handlePt(e.clientX,e.clientY,rect);};
  const onDoubleClick=e=>{e.preventDefault();reset();};
  const onTouch=e=>{
    e.preventDefault();
    const now=Date.now();
    // Consume the timestamp on a match so a third tap starts a fresh pair rather than chaining.
    if(now-lastTap.current<300){lastTap.current=0;reset();return;}
    lastTap.current=now;
    const rect=e.currentTarget.getBoundingClientRect();handlePt(e.touches[0].clientX,e.touches[0].clientY,rect);
  };

  return(<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
    <span style={{fontSize:10,fontWeight:600,color:C.textMid}}>{label}</span>
    <svg width={90} height={90} style={{cursor:"crosshair",touchAction:"none"}} onClick={onClick} onDoubleClick={onDoubleClick} onTouchStart={onTouch}>
      <circle cx={cx} cy={cy} r={rMax+6} fill={C.surfaceAlt} stroke={C.border} strokeWidth="1"/>
      {[0.25,0.5,0.75,1.0].map(f=><circle key={f} cx={cx} cy={cy} r={rMax*f} fill="none" stroke={C.borderStrong} strokeWidth="0.5" strokeDasharray={f===1?"none":"2,4"}/>)}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={C.accent} strokeWidth="1.5" strokeLinecap="round" strokeDasharray="3,2"/>
      <circle cx={nx} cy={ny} r={4} fill={C.accent} stroke={C.surface} strokeWidth="1.5"/>
      <circle cx={cx} cy={cy} r={3} fill={C.textMid}/>
      {/* Enemy sits at the top (North) — up/down = toward/away, left/right = across */}
      <g>
        <circle cx={cx} cy={cy-rMax-9} r={3.2} fill={C.danger}/>
        <text x={cx} y={cy-rMax-13} textAnchor="middle" fill={C.danger} fontSize="6" fontFamily="sans-serif">enemy</text>
      </g>
      {[["S",cx,cy+rMax+13],["W",cx-rMax-10,cy+4],["E",cx+rMax+10,cy+4]].map(([l,x,y])=>(
        <text key={l} x={x} y={y} textAnchor="middle" fill={C.textMute} fontSize="7" fontFamily="sans-serif">{l}</text>
      ))}
    </svg>
    <div style={{textAlign:"center"}}>
      <div style={{fontSize:11,fontWeight:700,color:C.text}}>{value}deg {cardinal}</div>
      <div style={{fontSize:10,color:C.textMute}}>{velocity??0} m/s ({Math.round(velFrac*100)}%)</div>
    </div>
  </div>);
}

function TargetControls({targetProfile,setTargetProfile,targetAngle,setTargetAngle,selfAngle,setSelfAngle,targetVel,setTargetVel,selfVel,setSelfVel,transversalSpeed,tgtSig,setTgtSig,targetVelMax,setTargetVelMax,selfMaxVel,ship}){
  // Selecting a profile sets sig + speed and re-anchors the wheel's 100% reference to that speed.
  const pickProfile=(key)=>{const p=TARGET_PROFILES[key];setTargetProfile(key);setTgtSig(p.sig);if(p.vel!=null){setTargetVel(p.vel);setTargetVelMax(Math.max(p.vel,100));}};
  // Editing the speed field sets the exact speed AND re-anchors the wheel's 100% to it.
  const setSpeed=(v)=>{const n=Math.max(0,Number(v)||0);setTargetVel(n);if(n>0)setTargetVelMax(n);setTargetProfile("custom");};
  const sigVal = tgtSig==null ? "" : Math.round(tgtSig);
  const trans = Math.round(transversalSpeed);
  const transColor = trans<50?C.success:trans>400?C.danger:C.warning;
  const inputStyle={width:58,padding:"3px 5px",borderRadius:5,fontSize:12,fontWeight:700,textAlign:"center",background:C.surface,border:`1px solid ${C.border}`,color:C.text};
  return(<div style={{background:C.surfaceAlt,borderRadius:10,border:`1px solid ${C.border}`,padding:12,marginBottom:14}}>
    <div style={{fontSize:10,fontWeight:700,color:C.textMute,letterSpacing:.8,textTransform:"uppercase",marginBottom:8}}>Target Profile</div>
    <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
      {Object.entries(TARGET_PROFILES).filter(([k])=>k!=="fit").map(([key,p])=>(
        <button key={key} onClick={()=>pickProfile(key)} style={{padding:"5px 10px",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer",background:targetProfile===key?C.accentLight:C.surface,border:`1px solid ${targetProfile===key?C.accentBorder:C.border}`,color:targetProfile===key?C.accent:C.textMid}}>{p.label}</button>
      ))}
      {targetProfile==="custom"&&<span style={{padding:"5px 10px",borderRadius:6,fontSize:11,fontWeight:600,background:C.accentLight,border:`1px solid ${C.accentBorder}`,color:C.accent}}>Custom</span>}
    </div>
    {/* Editable sig + speed */}
    <div style={{display:"flex",gap:14,marginBottom:12,alignItems:"center"}}>
      <label style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:C.textMid}}>
        Sig radius
        <input type="number" inputMode="numeric" value={sigVal} placeholder="ideal" onChange={e=>{const v=e.target.value;setTgtSig(v===""?null:Math.max(0,Number(v)));setTargetProfile("custom");}} style={inputStyle}/>
        <span style={{fontSize:10,color:C.textMute}}>m</span>
      </label>
      <label style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:C.textMid}}>
        Speed
        <input type="number" inputMode="numeric" value={Math.round(targetVel)} onChange={e=>setSpeed(e.target.value)} style={inputStyle}/>
        <span style={{fontSize:10,color:C.textMute}}>m/s</span>
      </label>
    </div>
    <div style={{fontSize:10,fontWeight:700,color:C.textMute,letterSpacing:.8,textTransform:"uppercase",marginBottom:6}}>Flight Vectors</div>
    <div style={{fontSize:10,color:C.textMute,marginBottom:8}}>The enemy sits at the top of each compass. Up/down = toward/away (low transversal); left/right = across (high transversal). Double-tap a compass to reset it to 0 deg / 0 m/s.</div>
    <div style={{display:"flex",justifyContent:"space-around",alignItems:"center"}}>
      <VectorCompass label="Your Ship" value={selfAngle} velocity={selfVel} maxVelocity={selfMaxVel||500} onChange={setSelfAngle} onVelocityChange={setSelfVel}/>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
        <div style={{width:1,height:18,background:C.border}}/>
        <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:"4px 8px",textAlign:"center"}}>
          <div style={{fontSize:14,fontWeight:800,color:transColor}}>{trans}</div>
          <div style={{fontSize:8,color:C.textMute}}>m/s transversal</div>
        </div>
        <div style={{width:1,height:18,background:C.border}}/>
      </div>
      <VectorCompass label="Target" value={targetAngle} velocity={targetVel} maxVelocity={Math.max(targetVelMax,1)} onChange={setTargetAngle} onVelocityChange={setTargetVel}/>
    </div>
  </div>);
}

function GraphTab({ship,slots,skills,implants,boosters,drones,factorInReload,externalBursts,projectedEffects}){
  const[catKey,setCatKey]=useState("damage"),[yKey,setYKey]=useState("dps"),[xKey,setXKey]=useState("dist");
  const[targetProfile,setTargetProfile]=useState("ideal"),[targetAngle,setTargetAngle]=useState(45),[selfAngle,setSelfAngle]=useState(270);
  const[targetVel,setTargetVel]=useState(200),[selfVel,setSelfVel]=useState(0);
  // Stable 100%-reference for the target speed wheel (set by profile/field, NOT by dragging the wheel).
  const[targetVelMax,setTargetVelMax]=useState(1000);
  // Target sig radius (null = ideal/perfect tracking). Set by profile, editable by tapping.
  const[tgtSig,setTgtSig]=useState(null);
  const[cursor,setCursor]=useState(null);
  // Axis scale (zoom). 1 = auto-fit range from generateCurve; >1 zooms in (smaller max),
  // <1 zooms out (larger max). Applied to the auto max, so it survives fit/axis changes.
  const[xZoom,setXZoom]=useState(1),[yZoom,setYZoom]=useState(1);
  const ZOOM_STEPS=[0.5,0.75,1,1.5,2,3,4,6,8,12,16];
  const stepZoom=(z,dir)=>{const i=ZOOM_STEPS.findIndex(v=>Math.abs(v-z)<1e-9);
    const ni=Math.max(0,Math.min(ZOOM_STEPS.length-1,(i<0?2:i)+dir));return ZOOM_STEPS[ni];};
  // Real transversal: component of relative velocity perpendicular to the line of sight (m/s).
  // North (up) on the compass = toward/away from the target (radial); E/W = across (transversal).
  const transversalSpeed=Math.abs(selfVel*Math.sin(selfAngle*Math.PI/180)-targetVel*Math.sin(targetAngle*Math.PI/180));
  const cat=GRAPH_CONFIG.find(c=>c.key===catKey);
  const handleCatChange=key=>{const nc=GRAPH_CONFIG.find(c=>c.key===key);setCatKey(key);setYKey(nc.yAxes[0].key);setXKey(nc.xAxes[0].key);setCursor(null);setXZoom(1);setYZoom(1);};
  const validY=cat.yAxes.find(a=>a.key===yKey)?yKey:cat.yAxes[0].key;
  const validX=cat.xAxes.find(a=>a.key===xKey)?xKey:cat.xAxes[0].key;
  const yAxis=cat.yAxes.find(a=>a.key===validY),xAxis=cat.xAxes.find(a=>a.key===validX);
  const cs=calcFitStats(ship,slots,drones??[],skills,{implants,boosters,factorInReload,externalBursts,projectedWebMult:projectedEffects?.webMult,projectedNeutGJs:projectedEffects?.neutGJs,projectedDebuffs:projectedEffects?.debuffs,projectedBoosts:projectedEffects?.boosts,pilotSec:slots?.pilotSec,systemSecurity:slots?.systemSecurity})??{};
  // The fit's OWN outgoing projection (reps/webs/neuts/damps/ECM it applies to others) for the EWAR/Reps graphs.
  const ownProj=useMemo(()=>{
    const sn=ship?.name; if(!sn) return null;
    try{ return computeProjectedReps({name:sn,typeID:tidByName(sn)},slots,skills,{implants,boosters,drones}); }catch{ return null; }
  },[ship,slots,skills,implants,boosters,drones]);
  const{pts,xMax,yMax:autoYMax}=generateCurve(catKey,validY,validX,{targetProfile,shipVelFrac:selfVel/(ship?.maxVelocity||500),ship:ship??{},cs,ownProj,selfVel,targetVel,selfAngle,targetAngle,tgtSig,tgtSpeed:targetVel,xZoom});
  // xMax already reflects xZoom (the curve is generated across the zoomed domain, so it actually
  // extends to the new axis edge instead of stopping short). Y just rescales the axis.
  const yMax=autoYMax/yZoom;
  const baseHeadline=pts.length?pts[Math.floor(pts.length*.05)][1]:null;
  const displayVal=cursor!=null?cursor.yVal:baseHeadline;
  const displayX=cursor!=null?cursor.xVal:null;
  const fmt=v=>v==null?"--":v>=10000?`${(v/1000).toFixed(1)}k`:v>=100?v.toFixed(0):v.toFixed(1);
  return(<div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column"}}>
    <div style={{borderBottom:`1px solid ${C.border}`,padding:"8px 10px"}}>
      <div className="hs" style={{overflowX:"auto",display:"flex",gap:5,paddingBottom:2}}>
        {GRAPH_CONFIG.map(c=><button key={c.key} onClick={()=>handleCatChange(c.key)} style={{flexShrink:0,padding:"4px 9px",borderRadius:6,fontSize:10,fontWeight:700,cursor:"pointer",background:catKey===c.key?`${c.color}22`:C.surface,border:`1px solid ${catKey===c.key?c.color:C.border}`,color:catKey===c.key?c.color:C.textMid}}>{c.label}</button>)}
      </div>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,padding:"8px 10px",background:C.surfaceAlt,borderBottom:`1px solid ${C.border}`}}>
      <div><div style={{fontSize:9,fontWeight:700,color:C.textMute,letterSpacing:.8,textTransform:"uppercase",marginBottom:4}}>Axis Y</div><select value={validY} onChange={e=>{setYKey(e.target.value);setCursor(null);setYZoom(1);}} style={{width:"100%",padding:"5px 6px",borderRadius:6,fontSize:11,background:C.surface,border:`1px solid ${C.border}`,color:C.text}}>{cat.yAxes.map(a=><option key={a.key} value={a.key}>{a.label}</option>)}</select></div>
      <div><div style={{fontSize:9,fontWeight:700,color:C.textMute,letterSpacing:.8,textTransform:"uppercase",marginBottom:4}}>Axis X</div><select value={validX} onChange={e=>{setXKey(e.target.value);setCursor(null);setXZoom(1);}} disabled={cat.xAxes.length===1} style={{width:"100%",padding:"5px 6px",borderRadius:6,fontSize:11,background:C.surface,border:`1px solid ${C.border}`,color:C.text,opacity:cat.xAxes.length===1?.5:1}}>{cat.xAxes.map(a=><option key={a.key} value={a.key}>{a.label}</option>)}</select></div>
      {/* Axis scale (zoom): − widens the visible range, + zooms in. Tap the readout to reset to auto-fit. */}
      {[{ax:"Y",zoom:yZoom,setZoom:setYZoom,max:yMax},{ax:"X",zoom:xZoom,setZoom:setXZoom,max:xMax}].map(z=>{
        const atMin=z.zoom<=ZOOM_STEPS[0]+1e-9, atMax=z.zoom>=ZOOM_STEPS[ZOOM_STEPS.length-1]-1e-9;
        const btn=(dis)=>({flex:"0 0 26px",padding:"4px 0",borderRadius:6,fontSize:13,fontWeight:700,lineHeight:1,
          cursor:dis?"default":"pointer",background:C.surface,border:`1px solid ${C.border}`,color:dis?C.textMute:C.textMid,opacity:dis?.4:1});
        return(<div key={z.ax} style={{display:"flex",alignItems:"center",gap:4}}>
          <button onClick={()=>{z.setZoom(v=>stepZoom(v,-1));setCursor(null);}} disabled={atMin} style={btn(atMin)}>−</button>
          <button onClick={()=>{z.setZoom(1);setCursor(null);}} title="Reset to auto-fit"
            style={{flex:1,padding:"4px 0",borderRadius:6,fontSize:10,fontWeight:700,cursor:"pointer",background:z.zoom===1?C.surface:`${cat.color}22`,
              border:`1px solid ${z.zoom===1?C.border:cat.color}`,color:z.zoom===1?C.textMute:cat.color,whiteSpace:"nowrap",overflow:"hidden"}}>
            {z.ax} {fmt(z.max)}{z.zoom!==1?` · ${z.zoom}×`:""}
          </button>
          <button onClick={()=>{z.setZoom(v=>stepZoom(v,1));setCursor(null);}} disabled={atMax} style={btn(atMax)}>+</button>
        </div>);
      })}
    </div>
    {displayVal!=null&&<div style={{padding:"8px 14px 0",display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
      <div><span style={{fontSize:22,fontWeight:800,color:cat.color}}>{fmt(displayVal)}</span><span style={{fontSize:11,color:C.textMute,marginLeft:5}}>{yAxis?.label}</span></div>
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
    <div style={{padding:"4px 10px 0"}}><LineChart pts={pts} xMax={xMax} yMax={yMax} xLabel={xAxis?.label} yLabel={yAxis?.label} color={cat.color} onCursorChange={setCursor}/></div>
    {cat.showTargetControls&&<div style={{padding:"0 10px 12px"}}><TargetControls targetProfile={targetProfile} setTargetProfile={setTargetProfile} targetAngle={targetAngle} setTargetAngle={setTargetAngle} selfAngle={selfAngle} setSelfAngle={setSelfAngle} targetVel={targetVel} setTargetVel={setTargetVel} selfVel={selfVel} setSelfVel={setSelfVel} transversalSpeed={transversalSpeed} tgtSig={tgtSig} setTgtSig={setTgtSig} targetVelMax={targetVelMax} setTargetVelMax={setTargetVelMax} selfMaxVel={cs?.maxVelocityAB??cs?.maxVelocity??ship?.maxVelocity??500} ship={ship}/></div>}
  </div>);
}

// ═══ ACTIVE FIT BAR ════════════════════════════════════════════
export { GraphTab, GRAPH_CONFIG, generateCurve };
