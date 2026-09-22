// EVE 24.01 landed on 2026-09-22; pyfa's newest build is still v2.68.0 (2026-07-07) and carries
// 24.00 data. This overlay lets the app fly the rebalanced hulls in the meantime, WITHOUT touching
// the generated bundles, which stay a faithful copy of the build the regression baselines were
// validated against. See src/data/balance-overlay.json for the transcription and its confidence.
//
// It is deliberately INERT UNDER NODE. The regression suite is our only check that the engine still
// agrees with pyfa, and pyfa cannot agree with numbers CCP shipped after pyfa's last release — so a
// suite running against overlaid data would be comparing 24.01 output to 24.00 expectations and
// calling the difference a regression. Node is where we compare against the reference; the browser
// is where someone flies a ship. The overlay belongs only in the second.
import OVERLAY from '../data/balance-overlay.json' with { type: 'json' };

const MASS_ATTR = '4', INERTIA_ATTR = '70';
export { OVERLAY as BALANCE_OVERLAY };

// There is deliberately no way to turn this off in the app. Off would mean showing the numbers from
// before the patch, and CCP has already shipped the patch — so the "safe" setting would be the one
// that disagrees with the live game. The only runtime that opts out is Node.
export function balanceOverlayApplies(){
  return typeof window!=='undefined';
}

// Mass changes carry their inertia with them. CCP said align times were held constant but published
// only the new masses, and align time is proportional to mass x inertia, so the inertia that keeps
// the product fixed is the one CCP must have used. Reading the old mass before overwriting it also
// makes a second call a no-op, since the ratio is then 1.
function applyAttrs(type,attrs){
  const oldMass=type.a?.[MASS_ATTR];
  for(const [attrID,value] of Object.entries(attrs))type.a[attrID]=value;
  const newMass=type.a?.[MASS_ATTR];
  if(attrs[MASS_ATTR]!=null&&oldMass>0&&newMass>0&&type.a[INERTIA_ATTR]!=null)
    type.a[INERTIA_ATTR]=type.a[INERTIA_ATTR]*oldMass/newMass;
}

// Mutates the bundles in place, before initEngine reads them. Returns what it changed so a caller
// can show it and a test can assert on it. Unknown type IDs are skipped rather than thrown on: this
// file is hand-written against one client build, and the honest failure when the bundle moves on is
// to apply less, not to take the app down on boot.
export function applyBalanceOverlay(types,effects,overlay=OVERLAY){
  const changed=[],skipped=[];
  for(const [effectID,def] of Object.entries(overlay.effects??{}))
    effects[effectID]={c:def.c,m:def.m};
  for(const [typeID,entry] of Object.entries(overlay.types??{})){
    const type=types[typeID];
    if(!type){skipped.push(entry._name??typeID);continue;}
    type.a??={};
    applyAttrs(type,entry.attrs??{});
    if(entry.removeEffects?.length)
      type.e=(type.e??[]).filter(id=>!entry.removeEffects.includes(id));
    for(const id of entry.addEffects??[])
      if(!(type.e??=[]).includes(id))type.e.push(id);
    changed.push(entry._name??typeID);
  }
  return {patch:overlay.patch,changed,skipped};
}

// The info sheet's Traits tab prints CCP's own bonus wording out of ship-traits.json, which is
// generated from eve.db and so still quotes 24.00 — patching only the attribute leaves a Deimos
// whose falloff is computed at 15% and advertised at 10%. Every op states the text and number it
// expects to replace, so it silently does nothing rather than double-patching once a regenerated
// bundle already says the new thing. Mutates in place, like applyBalanceOverlay.
export function applyTraitOverlay(traits,overlay=OVERLAY){
  const changed=[],skipped=[];
  for(const [typeID,entry] of Object.entries(overlay.types??{})){
    if(!entry.traits?.length) continue;
    const tr=traits[typeID];
    for(const op of entry.traits){
      const label=`${entry._name??typeID}: ${op.find??op.addText}`;
      const section=(tr?.skills??[]).find(s=>(s.header??'').startsWith(op.section));
      if(!section?.bonuses){skipped.push(label);continue;}
      if(op.find!=null){
        const bonus=section.bonuses.find(b=>b.text===op.find&&b.number===op.fromNumber);
        if(!bonus){skipped.push(label);continue;}
        if(op.toNumber!=null)bonus.number=op.toNumber;
        if(op.toText!=null)bonus.text=op.toText;
      }else{
        if(section.bonuses.some(b=>b.text===op.addText))continue;
        section.bonuses.push({number:op.addNumber,text:op.addText});
      }
      changed.push(label);
    }
  }
  return {changed,skipped};
}
