import { useState, useEffect, useRef, useMemo } from "react";
import shipsData        from "./data/ships.json";
import modulesData      from "./data/modules.json";
import chargesData      from "./data/charges.json";
import dronesData       from "./data/drones.json";
import marketGroupsData from "./data/marketGroups.json";
import marketTreeData   from "./data/market-tree.json";
import mutaplasmidData  from "./data/mutaplasmids.json";
import TYPE_ICONS       from "./data/type-icons.json";
import { calcFitStats, computeCommandBursts, computeProjectedReps, calcRangeFactor, getModuleStats, layerEHP, peakRegen, calcAlignTime, calcLockTime, stackingPenalty, rangeFactor, calcTurretCTH, calcTurretMult, calcMissileFactor, SKILL_DEFAULTS, TYPES, tidByName, boosterSideEffectsFor, isT3Cruiser, subsystemsForHull, t3cSlotLayout, T3C_SUBSYSTEM_GROUPS, ATTR_ID_TO_NAME, simulateCapTrace } from "./calc.js";
import { DAMAGE_PROFILES } from "./data/damage-profiles.js";

// ── Mutaplasmid (abyssal module) indexes ─────────────────────────────────────
// mutaplasmidData[mutaTypeID] = { n:name, a:{attrID:[min,max]}, t:[baseTypeIDs], r:resultingType }
const MUTA_BY_TYPE = {};   // baseTypeID -> [mutaTypeID]
const MUTA_BY_NAME = {};   // lowercased mutaplasmid name -> mutaTypeID
for (const [mid, m] of Object.entries(mutaplasmidData ?? {})) {
  if (m.n) MUTA_BY_NAME[m.n.toLowerCase()] = mid;
  for (const t of (m.t ?? [])) (MUTA_BY_TYPE[t] ??= []).push(mid);
}
// Resolve the affected attributes for a (mutaplasmid, baseTypeID) as [{attrID, name, base, min, max}].
function mutaAttrRanges(mutaID, baseTypeID) {
  const m = mutaplasmidData?.[mutaID]; if (!m) return [];
  const baseAttrs = TYPES[baseTypeID]?.attrs ?? TYPES[String(baseTypeID)]?.attrs ?? {};
  const out = [];
  for (const [aid, [lo, hi]] of Object.entries(m.a ?? {})) {
    const name = ATTR_ID_TO_NAME[aid];
    if (!name) continue;
    const base = baseAttrs[name];
    if (base == null) continue;
    out.push({ attrID: aid, name, base, min: base * lo, max: base * hi });
  }
  return out;
}

// ── Market tree indexes (pyfa market browser structure) ──────────────────────
// marketTreeData: { g: {gid:{n:name, p:parent, i:representative item tid}}, t: {tid:[mgid, name, volume]} }
const MT_CHILDREN = {}, MT_ITEMS = {};
for (const [gid, g] of Object.entries(marketTreeData.g)) {
  if (g.p != null) (MT_CHILDREN[g.p] ??= []).push(Number(gid));
}
for (const [tid, [mgid, name, vol]] of Object.entries(marketTreeData.t)) {
  (MT_ITEMS[mgid] ??= []).push({ typeID: Number(tid), name, vol });
}
for (const arr of Object.values(MT_CHILDREN)) arr.sort((a, b) => marketTreeData.g[a].n.localeCompare(marketTreeData.g[b].n));
for (const arr of Object.values(MT_ITEMS)) arr.sort((a, b) => a.name.localeCompare(b.name));
const MT_ROOTS = Object.keys(marketTreeData.g).filter(g => marketTreeData.g[g].p == null).map(Number)
  .sort((a, b) => marketTreeData.g[a].n.localeCompare(marketTreeData.g[b].n));
const MT_ALL_ITEMS = Object.entries(marketTreeData.t).map(([tid, [mgid, name, vol]]) => ({ typeID: Number(tid), name, vol, mgid }));
import { DRONE_TYPES } from "./dogma-engine-init.js";

// Supplemental data — loaded at runtime, no build-time dependency
// If data-bundle.js is missing the app still works; features using this data just show empty
let moduleVariations = {}, shipTraits = {}, implantData = {};
let shipsByClass = {}, slotIcons = {}, raceIcons = {}, navIcons = {};
let _bundleReady = false;
const _bundleListeners = [];
import(/* @vite-ignore */ './data-bundle.js').then(m => {
  moduleVariations = m.moduleVariations ?? {};
  shipTraits       = m.shipTraits       ?? {};
  implantData      = m.implantData      ?? {};
  shipsByClass     = m.shipsByClass     ?? {};
  slotIcons        = m.slotIcons        ?? {};
  raceIcons        = m.raceIcons        ?? {};
  navIcons         = m.navIcons         ?? {};
  // The bundle's ship-browser list predates newer hulls (Lancer Dreadnoughts, etc.), so any ship it
  // doesn't know about was simply unselectable even though its stats were fully present in ships.json.
  // Backfill data-driven instead of maintaining a hardcoded list: every fittable hull in ships.json
  // that the bundle omits gets added under CCP's own group name from the type data (TYPES[].gn).
  // ships.json's own `hullClass` is NOT used as the class — it's wrong for 64 hulls (it files the Crow
  // under Tactical Destroyer, the Cenotaph under plain Battlecruiser); TYPES[].gn is authoritative.
  const _listedTypeIDs=new Set(Object.values(shipsByClass).flat().map(s=>s.typeID));
  for(const s of Object.values(shipsData)){
    if(!s?.typeID || !s?.name || _listedTypeIDs.has(s.typeID)) continue;
    const cls=TYPES[s.typeID]?.gn ?? s.hullClass;   // CCP group name; hullClass only as a last resort
    if(!cls) continue;
    if(!shipsByClass[cls]) shipsByClass[cls]=[];
    if(!shipsByClass[cls].some(x=>x.name===s.name||x.typeID===s.typeID)) shipsByClass[cls].push({name:s.name,typeID:s.typeID});
  }
  // Traits + descriptions for newer hulls absent from the bundle's shipTraits (parsed from type data).
  const _NEW_TRAITS={"85062":{"skills":[{"header":"Amarr Frigate bonuses (per skill level):","bonuses":[{"number":"10%","text":"bonus to Small Energy Turret optimal range"}]},{"header":"Caldari Frigate bonuses (per skill level):","bonuses":[{"number":"10%","text":"bonus to Light Missile and Rocket flight time"},{"number":"4%","text":"bonus to all shield resistances"}]},{"header":"Covert Ops bonuses (per skill level):","bonuses":[{"number":"15%","text":"bonus to Core and Combat Scanner Probe strength"},{"number":"10%","text":"reduction in Survey Probe flight time"},{"number":"15%","text":"bonus to warp speed and acceleration"}]},{"header":"Gallente Frigate bonuses (per skill level):","bonuses":[{"number":"7.5%","text":"bonus to Small Hybrid Turret tracking speed"}]},{"header":"Minmatar Frigate bonuses (per skill level):","bonuses":[{"number":"10%","text":"bonus to Small Projectile Turret falloff"}]}],"role":{"header":"Role Bonus:","bonuses":[{"number":"100%","text":"reduction in Cloaking Devices CPU requirement"},{"text":"10+ bonus to Relic and Data Analyzer virus strength"},{"text":"• Can fit Covert Ops Cloaking Device and Covert Cynosural Field Generator"},{"text":"• No targeting delay after Cloaking Device deactivation"},{"text":"• Cloak reactivation delay reduced to 5 seconds"},{"number":"150%","text":"bonus to Light Combat Drone damage and hitpoints"},{"text":"• Small Hybrid Turret, Small Projectile Turret, Small Energy Turret, Light Missile, and Rocket damage increased by a percentage equal to -7.5x pilot negative security status, with a floor of 0% and ceiling of 75%"},{"number":"60%","text":"bonus to warp speed and warp acceleration"}]},"desc":"Following an announcement that CONCORD itself had donated ships as prizes for the Independent Gaming Commission’s Alliance Tournament XX in YC126, a bid executed through a series of shell corporations saw principal sponsorship for the milestone 20th anniversary event shift to the Guristas. Securing a massive stream of profit and publicity for his organization through New Eden’s foremost capsuleer tournament, Korako ‘The Rabbit' Kosakami added further insult to injury by vandalizing the exterior of CONCORD’s donations and retooling them into extravagant prizes of his own design.\r\n\r\nTo keep his most potent modifications out of lawful hands, the Rabbit enlisted the aid of turncoat Caldari Navy Commander Esri Hakuzosu to crack and reverse the parameters of the Pacifier’s security status function-gating subsystem, mocking CONCORD by turning their own notoriously stringent pilot verification protocols against them. Joined with a host of other preposterously costly upgrades and alterations, the Sidewinder presents a vicious pinnacle of Guristas starship engineering."},"85229":{"skills":[{"header":"Amarr Cruiser bonuses (per skill level):","bonuses":[{"number":"7.5%","text":"bonus to Medium Energy Turret damage"},{"number":"10%","text":"bonus to Medium Energy Turret optimal range"}]},{"header":"Caldari Cruiser bonuses (per skill level):","bonuses":[{"number":"10%","text":"bonus to Rapid Light Missile, Heavy Missile and Heavy Assault Missile Launcher rate of fire"},{"number":"10%","text":"bonus to Heavy Missile and Heavy Assault Missile flight time"},{"number":"4%","text":"bonus to all shield resistances"}]},{"header":"Gallente Cruiser bonuses (per skill level):","bonuses":[{"number":"7.5%","text":"bonus to Medium Hybrid Turret damage"},{"number":"7.5%","text":"bonus to Medium Hybrid Turret tracking speed"}]},{"header":"Minmatar Cruiser bonuses (per skill level):","bonuses":[{"number":"7.5%","text":"bonus to Medium Projectile Turret rate of fire"},{"number":"10%","text":"bonus to Medium Projectile Turret falloff"}]},{"header":"Recon Ships bonuses (per skill level):","bonuses":[{"number":"15%","text":"bonus to warp speed and acceleration"}]}],"role":{"header":"Role Bonus:","bonuses":[{"number":"100%","text":"reduction in Cloaking Devices CPU requirement"},{"text":"• Can fit Covert Ops Cloaking Device, Cynosural Field Generator, and Covert Cynosural Field Generator modules"},{"text":"• Cloak reactivation delay reduced to 5 seconds"},{"number":"50%","text":"reduction in Cynosural Field Generator and Covert Cynosural Field Generator duration"},{"number":"80%","text":"reduction in Cynosural Field Generator and Covert Cynosural Field Generator liquid ozone consumption"},{"text":"• Can use Medium Micro Jump Drive modules"},{"number":"99%","text":"reduction in powergrid and cpu requirements for Micro Jump Drive modules"},{"number":"150%","text":"bonus to Medium Combat Drone damage and hitpoints"},{"text":"• Stasis Webifier optimal range increased by a percentage equal to -7.5x pilot negative security status, with a floor of 0% and ceiling of 75%"},{"text":"• Warp Scrambler and Warp Disruptor optimal range increased by a percentage equal to -3.75x pilot negative security status, with a floor of 0% and ceiling of 37.5%"}]},"desc":"Following an announcement that CONCORD itself had donated ships as prizes for the Independent Gaming Commission’s Alliance Tournament XX in YC126, a bid executed through a series of shell corporations saw principal sponsorship for the milestone 20th anniversary event shift to the Guristas. Securing a massive stream of profit and publicity for his organization through New Eden’s foremost capsuleer tournament, Korako ‘The Rabbit' Kosakami added further insult to injury by vandalizing the exterior of CONCORD’s donations and retooling them into extravagant prizes of his own design.\r\n\r\nTo keep his most potent modifications out of lawful hands, the Rabbit enlisted the aid of turncoat Caldari Navy Commander Esri Hakuzosu to crack and reverse the parameters of the Enforcer’s security status function-gating subsystem, mocking CONCORD by turning their own notoriously stringent pilot verification protocols against them. Joined with a host of other preposterously costly upgrades and alterations, the Cobra presents a lethal pinnacle of Guristas ship engineering."},"74316":{"skills":[{"header":"Heavy Assault Cruisers bonuses (per skill level):","bonuses":[{"number":"10%","text":"bonus to Heavy Missile and Heavy Assault Missile explosion velocity"},{"number":"10%","text":"bonus to Light Missile, Heavy Missile and Heavy Assault Missile Launcher rate of fire"}]},{"header":"Minmatar Cruiser bonuses (per skill level):","bonuses":[{"number":"10%","text":"bonus to Light Missile, Heavy Missile and Heavy Assault Missile damage"},{"number":"10%","text":"bonus to Shield Booster and Armor Repairer amount"}]}],"role":{"header":"Role Bonus:","bonuses":[{"number":"500%","text":"bonus to Stasis Webifying Drone Stasis Webifier effectiveness"},{"number":"500%","text":"bonus to Stasis Webifying Drone hitpoints"},{"number":"50%","text":"bonus to Stasis Webifying Drone max velocity"},{"text":"• Can fit Assault Damage Controls"}]},"desc":"The Bestla was originally the product of a development program that involved the eccentric and often clashing talents of Tapio Histvaari, Core Complexion's Chief of Missile Systems Development, and Hildara Rostavik, Core's Lead Designer of Autonomous Weapons. The program was an effort to cram as much missile firepower as possible into the Bestla heavy assault cruiser, and its Geri assault frigate counterpart, while also supporting the sophisticated control routines and bandwidth to operate stasis webification drones with massively uprated systems.\r\n\r\nDespite serious personality clashes between the Caldari missiles expert Histvaari and Minmatar drone designer Rostavik, the Bestla was brilliantly redesigned from its basic Rupture-hull format into an incredibly advanced, and incredibly expensive, heavy assault cruiser. While the performance of the Bestla's missiles and stasis drones was far above anything achieved in combination in such a compact format, the Republic Fleet balked at the prospect of paying for whole squadrons made up of the Bestla and the similarly expensive Geri. \r\n\r\nAlthough a few Bestlas are maintained by elite special tasks units of the Republic, a significant number of the initial production run were donated as prizes to the Independent Gaming Commission's Alliance Tournament XVIII by the Minmatar when the Republic became the principal sponsor of the event in YC124."},"85236":{"skills":[{"header":"Amarr Battleship bonuses (per skill level):","bonuses":[{"number":"15%","text":"bonus to Large Energy Turret damage"},{"number":"10%","text":"bonus to Large Energy Turret optimal range"}]},{"header":"Black Ops bonuses (per skill level):","bonuses":[{"number":"10%","text":"bonus to Warp Scrambler and Warp Disruptor optimal range"},{"number":"20%","text":"bonus to Stasis Webifier optimal range"},{"number":"10%","text":"bonus to warp speed and acceleration"}]},{"header":"Caldari Battleship bonuses (per skill level):","bonuses":[{"number":"12.5%","text":"bonus to Rapid Heavy Missile, Cruise Missile and Torpedo Launcher rate of fire"},{"number":"10%","text":"bonus to Cruise Missile and Torpedo flight time"},{"number":"4%","text":"bonus to all shield resistances"}]},{"header":"Gallente Battleship bonuses (per skill level):","bonuses":[{"number":"15%","text":"bonus to Large Hybrid Turret damage"},{"number":"7.5%","text":"bonus to Large Hybrid Turret tracking speed"}]},{"header":"Minmatar Battleship bonuses (per skill level):","bonuses":[{"number":"12.5%","text":"bonus to Large Projectile Turret rate of fire"},{"number":"10%","text":"bonus to Large Projectile Turret falloff"}]}],"role":{"header":"Role Bonus:","bonuses":[{"text":"• Can fit Cynosural Field Generator, Covert Cynosural Field Generator, and Covert Jump Portal Generator modules"},{"text":"• No targeting delay after Cloaking Device deactivation"},{"text":"• Cloak reactivation delay reduced to 5 seconds"},{"number":"100%","text":"increase to Microwarpdrive and Afterburner duration"},{"text":"• ECM Burst Jammer optimal range, falloff, and strength increased by a percentage equal to -7.5x pilot negative security status, with a floor of 0% and ceiling of 75%"},{"number":"75%","text":"reduction to effective distance traveled for jump fatigue"},{"number":"650%","text":"bonus to ship max velocity when using Cloaking Devices"},{"number":"100%","text":"bonus to Shield Extender hitpoints"},{"number":"50%","text":"bonus to Armor Plate hitpoints"},{"number":"5%","text":"additional bonus to Reinforced Bulkhead hitpoints"},{"number":"50%","text":"reduction in Cynosural Field Generator and Covert Cynosural Field Generator duration"}]},"desc":"Following an announcement that CONCORD itself had donated ships as prizes for the Independent Gaming Commission’s Alliance Tournament XX in YC126, a bid executed through a series of shell corporations saw principal sponsorship for the milestone 20th anniversary event shift to the Guristas. Securing a massive stream of profit and publicity for his organization through New Eden’s foremost capsuleer tournament, Korako ‘The Rabbit' Kosakami added further insult to injury by vandalizing the exterior of CONCORD’s donations and retooling them into extravagant prizes of his own design.\r\n\r\nTo keep his most potent modifications out of lawful hands, the Rabbit enlisted the aid of turncoat Caldari Navy Commander Esri Hakuzosu to crack and reverse the parameters of the Marshal’s security status function-gating subsystem, mocking CONCORD by turning their own notoriously stringent pilot verification protocols against them. Joined with a host of other preposterously costly upgrades and alterations, the Python presents a deadly pinnacle of Guristas starship engineering.\r\n\r\n“Virge Sarpati’s commissions precisely reflect the venom that sustains his organization, but that is all. Korako Kosakami is called “The Rabbit”, but he is the one who knows the serpent best. A snake is more than just its fangs. It is agile yet powerful, constricting or poisoning its prey before devouring them whole. That is why our ships are so perfectly named.”\r\n – Vepas Minimala"},"74141":{"skills":[{"header":"Assault Frigates bonuses (per skill level):","bonuses":[{"number":"7.5%","text":"bonus to Light Missile and Rocket Launcher rate of fire"},{"number":"7.5%","text":"bonus to Light Missile and Rocket explosion velocity"}]},{"header":"Minmatar Frigate bonuses (per skill level):","bonuses":[{"number":"7.5%","text":"bonus to Light Missile and Rocket damage"},{"number":"7.5%","text":"bonus to Shield Booster and Armor Repairer amount"}]}],"role":{"header":"Role Bonus:","bonuses":[{"number":"500%","text":"bonus to Stasis Webifying Drone Stasis Webifier effectiveness"},{"number":"250%","text":"bonus to Stasis Webifying Drone hitpoints"},{"number":"50%","text":"bonus to Stasis Webifying Drone max velocity"},{"number":"50%","text":"reduction in Microwarpdrive signature radius penalty"},{"text":"• Can fit Assault Damage Controls"}]},"desc":"The Geri was originally the product of a development program that involved the eccentric and often clashing talents of Tapio Histvaari, Core Complexion's Chief of Missile Systems Development, and Hildara Rostavik, Core's Lead Designer of Autonomous Weapons. The program was an effort to cram as much missile firepower as possible into the Bestla heavy assault cruiser, and its Geri assault frigate counterpart, while also supporting the sophisticated control routines and bandwidth to operate stasis webification drones with massively uprated systems.\r\n\r\nDespite serious personality clashes between the Caldari missiles expert Histvaari and Minmatar drone designer Rostavik, the Geri was brilliantly redesigned from its basic Rifter-hull format into an incredibly advanced, and incredibly expensive, assault frigate. While the performance of the Geri's missiles and stasis drones was far above anything achieved in combination in such a compact format, the Republic Fleet balked at the prospect of paying for whole squadrons made up of the Geri and the similarly expensive Bestla. \r\n\r\nAlthough a few Geris are maintained by elite special tasks units of the Republic, a significant number of the initial production run were donated as prizes to the Independent Gaming Commission's Alliance Tournament XVIII by the Minmatar when the Republic became the principal sponsor of the event in YC124."},"78414":{"skills":[{"header":"Assault Frigates bonuses (per skill level):","bonuses":[{"number":"10%","text":"bonus to Armor Repairer amount"},{"number":"10%","text":"bonus to Small Hybrid Turret tracking speed and optimal range"}]},{"header":"Gallente Frigate bonuses (per skill level):","bonuses":[{"number":"10%","text":"bonus to Small Hybrid Turret damage"},{"number":"10%","text":"bonus to Warp Scrambler and Warp Disruptor optimal range"},{"number":"10%","text":"bonus to the benefits of overheating Afterburners and Microwarpdrives"}]}],"role":{"header":"Role Bonus:","bonuses":[{"number":"100%","text":"reduction in Armor Plate mass penalty"},{"number":"50%","text":"reduction in module heat damage amount taken"},{"text":"• Can fit Assault Damage Controls"}]},"desc":"Following reports that the Federation government had commissioned a limited run of a novel assault frigate based on the Utu from Duvolle Labs as prizes for the Independent Gaming Commission's Alliance Tournament XIX in YC125, the CreoDron board leveled a freedom of information claim which quickly returned a surprising volume of documents. While the majority have been fully redacted, what little can be gleaned dates the design of the Shapash to a YC120 contract authorized by the FIO for a series of joint operations with Crux Special Tasks Group and the Ostrakon Agency classified under \"Project Trieste\".\r\n\r\nThe Shapash was developed by a provisional team under Duvolle's Advanced Manifold Theory Unit co-led by Rias Luisauir, prodigious R&D agent and engineer, and Progressive Plasma's Dr. Jinneth Duvolle, original co-founder of Duvolle Labs. Afforded a near-bottomless budget to design a platform suitable for locales where reinforcement would be impossible and return imperative, the two leads took full advantage of this unique opportunity to bring their most revolutionary and cost-prohibitive theories into reality as part of the designs.\r\n\r\nA reverse-ballast function devised by Luisauir, based on the micro jump drive's ultraweak force-compensated mass phase-tuning principle, negates armor plate mass gain by scaling microscale depleted vacuum volumes with the ship's mass in-flight, while a plasma cooling system designed by Dr. Jinneth boosts the operational threshold of hybrid turrets and armor repairers as well as the overload limit of propulsion modules. Combined with a substitution of the Utu's drone capabilities for potent hybrid hardpoints and the incorporation of assault frigate subsystems, the Shapash is a priceless force to be reckoned with."},"77726":{"skills":[{"header":"Gallente Cruiser bonuses (per skill level):","bonuses":[{"number":"20%","text":"bonus to Medium Hybrid Turret damage"},{"number":"10%","text":"bonus to Armor Repairer amount"},{"number":"25%","text":"bonus to Warp Scrambler and Warp Disruptor optimal range"}]},{"header":"Heavy Assault Cruisers bonuses (per skill level):","bonuses":[{"number":"10%","text":"bonus to Medium Hybrid Turret falloff"},{"number":"7.5%","text":"bonus to Medium Hybrid Turret tracking speed"}]}],"role":{"header":"Role Bonus:","bonuses":[{"number":"30%","text":"bonus to ship max velocity"},{"number":"100%","text":"reduction in Armor Plate mass penalty"},{"text":"• Can fit Assault Damage Controls"}]},"desc":"Following reports that the Federation government had commissioned a limited run of a novel heavy assault cruiser based on the Adrestia from Duvolle Labs as prizes for the Independent Gaming Commission's Alliance Tournament XIX in YC125, the CreoDron board leveled a freedom of information claim which quickly returned a surprising volume of documents. While the majority have been fully redacted, what little can be gleaned dates the design of the Cybele to a YC120 contract authorized by the FIO for a series of joint operations with Crux Special Tasks Group and the Ostrakon Agency classified under \"Project Trieste\".\r\n\r\nThe Cybele was developed by a provisional team under Duvolle's Advanced Manifold Theory Unit co-led by Rias Luisauir, prodigious R&D agent and engineer, and Progressive Plasma's Dr. Jinneth Duvolle, original co-founder of Duvolle Labs. Afforded a near-bottomless budget to design a platform suitable for locales where reinforcement would be impossible and return imperative, the two leads took full advantage of this unique opportunity to bring their most revolutionary and cost-prohibitive theories into reality as part of the designs.\r\n\r\nA reverse-ballast function devised by Luisauir, based on the micro jump drive's ultraweak force-compensated mass phase-tuning principle, negates armor plate mass gain by scaling microscale depleted vacuum volumes with the ship's mass in-flight, while a plasma cooling system designed by Dr. Jinneth boosts the operational threshold of hybrid turrets and armor repairers. Combined with an all-around upgrade to the Adrestia's core capabilities and electronics and the incorporation of heavy assault cruiser subsystems, the Cybele is a priceless force to be reckoned with."},"89807":{"skills":[{"header":"Caldari Battlecruiser bonuses (per skill level):","bonuses":[{"number":"5%","text":"bonus to Cruise Missile and Torpedo explosion velocity"},{"number":"5%","text":"bonus to Cruise Missile and Torpedo explosion radius"}]}],"role":{"header":"Role Bonus:","bonuses":[{"number":"95%","text":"reduction in Rapid Heavy Missile Launcher, Cruise Missile Launcher and Torpedo Launcher powergrid requirement"},{"number":"50%","text":"reduction in Rapid Heavy Missile Launcher, Cruise Missile Launcher and Torpedo Launcher CPU requirement"},{"text":"• Additional bonuses are available while one of three Tactical Modes are active. Modes may be switched no more than once every 10 seconds."},{"text":"• Primary Mode"},{"number":"250%","text":"bonus to lock range while Primary Mode is enabled"},{"number":"33.3%","text":"decrease in missile velocity while Primary Mode is enabled"},{"number":"1000%","text":"increase in missile flight time while Primary Mode is enabled"},{"number":"25%","text":"bonus to Rapid Heavy Missile Launcher, Cruise Missile Launcher and Torpedo Launcher rate of fire while Primary Mode is enabled"},{"text":"• Secondary Mode"},{"number":"50%","text":"decrease in missile flight time while Secondary Mode is enabled"},{"number":"50%","text":"bonus to Rapid Heavy Missile Launcher, Cruise Missile Launcher and Torpedo Launcher rate of fire while Secondary Mode is enabled"},{"text":"• Tertiary Mode"},{"number":"90%","text":"reduction in Micro Jump Drive reactivation delay while Tertiary Mode is enabled"},{"number":"25%","text":"bonus to ship inertia modifier while Tertiary Mode is enabled"},{"number":"50%","text":"bonus to Heavy Missile, Cruise Missile and Torpedo velocity while Tertiary Mode is enabled"},{"number":"25%","text":"bonus to Rapid Heavy Missile Launcher, Cruise Missile Launcher and Torpedo Launcher rate of fire while Tertiary Mode is enabled"}]},"desc":"The Anhinga is a battlecruiser with unprecedented firepower. Like the legendary ‘snake bird’ it’s named after, the Anhinga allows pilots to strike from the deep, catching their rivals off guard.\r\n\r\nThe Mountain faction made shocking allegations against the Hyasyoda corporation following the unveiling of the design, claiming to have proof linking Anhinga designers to Guristas pirates operating within the Caldari state. \r\n\r\n“This pirate infestation appears to be spread among several corporations, not just Hyasyoda,” claimed an official statement from the Home Guard.\r\n\r\nFollowing a series of high-level meetings behind closed doors, Hyasyoda agreed to withdraw their bid for a Navy contract, although they protested the lack of evidence on behalf of the Mountain faction. To smooth things over, the CEP decided to award a small number of the Anhinga to New Eden’s best pilots as awards for Alliance Tournament XXI."},"89808":{"skills":[{"header":"Caldari Tactical Destroyer bonuses (per skill level):","bonuses":[{"number":"6%","text":"bonus to Light Missile launcher and Rocket launcher rate of fire"},{"number":"15%","text":"reduction in missile launcher reload time"},{"number":"5%","text":"reduction in module heat damage amount taken"}]},{"header":"Command Destroyers bonuses (per skill level):","bonuses":[{"number":"5%","text":"reduction in Micro Jump Field Generator spool up time"},{"number":"2%","text":"bonus to Shield Command and Information Command Burst effect strength and duration"}]},{"header":"Misc bonus:","bonuses":[{"number":"33%","text":"bonus to Light Missile and Rocket damage"},{"number":"95%","text":"reduction in Scan Probe Launcher and Survey Probe Launcher CPU requirements"},{"text":"• Additional bonuses are available while one of three Tactical Destroyer Modes are active. Modes may be switched no more than once every 2 seconds."},{"text":"• Defense Mode"},{"number":"33.3%","text":"bonus to all shield resistances while Defense Mode is enabled"},{"number":"33.3%","text":"reduction in ship signature radius while Defense Mode is enabled"},{"number":"33.3%","text":"reduction in shield recharge time while Defense Mode is enabled"},{"text":"• Propulsion Mode"},{"number":"66.6%","text":"bonus to Afterburner and Microwarpdrive speed boost while Propulsion Mode is enabled"},{"number":"66.6%","text":"bonus to ship inertia modifier while Propulsion Mode is enabled"},{"text":"• Sharpshooter Mode"},{"number":"66.6%","text":"bonus to Light Missile velocity while Sharpshooter Mode is enabled"},{"number":"250%","text":"bonus to Rocket velocity while Sharpshooter Mode is enabled"},{"number":"33.3%","text":"bonus to Light Missile and Rocket damage while Sharpshooter Mode is enabled"},{"number":"100%","text":"bonus to sensor strength and targeting range while Sharpshooter Mode is enabled"},{"number":"66.6%","text":"increased resistances against hostile Sensor Dampeners and Weapon Disruptors while Sharpshooter Mode is enabled"}]}],"role":{"header":"Role Bonus:","bonuses":[{"number":"95%","text":"reduction in powergrid and CPU requirements for Command Bursts"},{"text":"• Can fit Micro Jump Field Generators"},{"text":"• Can use one Command Burst module"}]},"desc":"Inspired by ancient stories of a 'pirate bird,' the Skua allows pilots to unleash a barrage of long range missiles that mimic that relentlessness of its namesake.\r\n\r\nThe Mountain faction rallied against the Skua in the CEP, causing controversy. In an official statement on behalf of the Home Guard, Tanis Cheung claimed to have proof that Lai Dai had hired “allegedly former” Guristas pirates, and that the Skua was born of that “anti-Caldari” collaboration.\r\n\r\nIn response, the Skua was canceled. However, a handful of prototypes had already been manufactured. The CEP thought their power and nimbleness should be given to the best pilots in New Eden, so they were awarded to the winners of Alliance Tournament XXI."},"85086":{"skills":[{"header":"Caldari Battlecruiser bonuses (per skill level):","bonuses":[{"number":"7.5%","text":"bonus to Shield Booster amount"}]},{"header":"Minmatar Battlecruiser bonuses (per skill level):","bonuses":[{"number":"5%","text":"bonus to ship Stasis Webifier resistance"}]}],"role":{"header":"Role Bonus:","bonuses":[{"number":"125%","text":"bonus to Medium Projectile Turret and Heavy Assault Missile damage"},{"text":"• Can use one Command Burst module"},{"number":"50%","text":"bonus to Command Burst area of effect range"},{"number":"25%","text":"bonus to Medium Projectile Turret optimal range and falloff and Missile velocity"},{"text":"• Can fit one Medium Breacher Pod Launcher"},{"text":"• Can fit Covert Ops Cloaking Device"},{"number":"100%","text":"reduction in Cloaking Devices CPU requirement"},{"text":"• Cloak reactivation delay reduced to 15 seconds"},{"text":"• Immune to all Cargo Scanners"}]},"desc":"An amalgamation of Minmatar engineering, Caldari electronics, and cutting edge bioinformatic technology, the Cenotaph is perfectly engineered for surprise strikes, deep behind enemy lines.\r\n\r\nThe Deathless Custodians devised the Cenotaph specifically to house their Breacher Pod weaponry while supporting the Covert Ops technology capabilities required for their clandestine operations."},"85087":{"skills":[{"header":"Caldari Destroyer bonuses (per skill level):","bonuses":[{"number":"7.5%","text":"bonus to Shield Booster amount"}]},{"header":"Minmatar Destroyer bonuses (per skill level):","bonuses":[{"number":"5%","text":"bonus to ship Stasis Webifier resistance"}]}],"role":{"header":"Role Bonus:","bonuses":[{"number":"150%","text":"bonus to Small Projectile Turret and Rocket damage"},{"text":"• Can fit one Small Breacher Pod Launcher"},{"text":"• Can fit Covert Ops Cloaking Device"},{"number":"100%","text":"reduction in Cloaking Devices CPU requirement"},{"text":"• Cloak reactivation delay reduced to 15 seconds"},{"text":"• Immune to all Cargo Scanners"}]},"desc":"Developed by the Deathless Custodians in late YC126, the Tholos is a fusion of Thukker starship engineering, cutting-edge Caldari electronics, and breakthroughs in shipboard bioinformatic technology. This synergy beckoned into reality the perfect machine for the Circle’s preferred hit and run doctrine.\r\n\r\nThe Tholos boasts the capabilities to use both Breacher Pod Launchers and Covert Ops Cloaking Devices."}};
  for(const [tid,tr] of Object.entries(_NEW_TRAITS)){ if(!shipTraits[tid]) shipTraits[tid]=tr; }
  // Variations for module groups gaining newer faction/navy members (grouped by group+size,
  // since the precomputed bundle predates them). Override so existing members (e.g. T2 MGC) gain
  // the new siblings; each affected group's full variation list is rebuilt from current type data.
  const _NEW_VARIATIONS={"3606":[{"typeID":8639,"name":"Large Asymmetric Enduring Remote Shield Booster","meta":"Named"},{"typeID":8635,"name":"Large Murky Compact Remote Shield Booster","meta":"Named"},{"typeID":3606,"name":"Large Remote Shield Booster I","meta":"T1"},{"typeID":8641,"name":"Large S95a Scoped Remote Shield Booster","meta":"Named"},{"typeID":3608,"name":"Large Remote Shield Booster II","meta":"T2"},{"typeID":93838,"name":"Caldari Navy Large Remote Shield Booster","meta":"Faction"},{"typeID":93839,"name":"Republic Fleet Large Remote Shield Booster","meta":"Faction"}],"3608":[{"typeID":8639,"name":"Large Asymmetric Enduring Remote Shield Booster","meta":"Named"},{"typeID":8635,"name":"Large Murky Compact Remote Shield Booster","meta":"Named"},{"typeID":3606,"name":"Large Remote Shield Booster I","meta":"T1"},{"typeID":8641,"name":"Large S95a Scoped Remote Shield Booster","meta":"Named"},{"typeID":3608,"name":"Large Remote Shield Booster II","meta":"T2"},{"typeID":93838,"name":"Caldari Navy Large Remote Shield Booster","meta":"Faction"},{"typeID":93839,"name":"Republic Fleet Large Remote Shield Booster","meta":"Faction"}],"8635":[{"typeID":8639,"name":"Large Asymmetric Enduring Remote Shield Booster","meta":"Named"},{"typeID":8635,"name":"Large Murky Compact Remote Shield Booster","meta":"Named"},{"typeID":3606,"name":"Large Remote Shield Booster I","meta":"T1"},{"typeID":8641,"name":"Large S95a Scoped Remote Shield Booster","meta":"Named"},{"typeID":3608,"name":"Large Remote Shield Booster II","meta":"T2"},{"typeID":93838,"name":"Caldari Navy Large Remote Shield Booster","meta":"Faction"},{"typeID":93839,"name":"Republic Fleet Large Remote Shield Booster","meta":"Faction"}],"8639":[{"typeID":8639,"name":"Large Asymmetric Enduring Remote Shield Booster","meta":"Named"},{"typeID":8635,"name":"Large Murky Compact Remote Shield Booster","meta":"Named"},{"typeID":3606,"name":"Large Remote Shield Booster I","meta":"T1"},{"typeID":8641,"name":"Large S95a Scoped Remote Shield Booster","meta":"Named"},{"typeID":3608,"name":"Large Remote Shield Booster II","meta":"T2"},{"typeID":93838,"name":"Caldari Navy Large Remote Shield Booster","meta":"Faction"},{"typeID":93839,"name":"Republic Fleet Large Remote Shield Booster","meta":"Faction"}],"8641":[{"typeID":8639,"name":"Large Asymmetric Enduring Remote Shield Booster","meta":"Named"},{"typeID":8635,"name":"Large Murky Compact Remote Shield Booster","meta":"Named"},{"typeID":3606,"name":"Large Remote Shield Booster I","meta":"T1"},{"typeID":8641,"name":"Large S95a Scoped Remote Shield Booster","meta":"Named"},{"typeID":3608,"name":"Large Remote Shield Booster II","meta":"T2"},{"typeID":93838,"name":"Caldari Navy Large Remote Shield Booster","meta":"Faction"},{"typeID":93839,"name":"Republic Fleet Large Remote Shield Booster","meta":"Faction"}],"93838":[{"typeID":8639,"name":"Large Asymmetric Enduring Remote Shield Booster","meta":"Named"},{"typeID":8635,"name":"Large Murky Compact Remote Shield Booster","meta":"Named"},{"typeID":3606,"name":"Large Remote Shield Booster I","meta":"T1"},{"typeID":8641,"name":"Large S95a Scoped Remote Shield Booster","meta":"Named"},{"typeID":3608,"name":"Large Remote Shield Booster II","meta":"T2"},{"typeID":93838,"name":"Caldari Navy Large Remote Shield Booster","meta":"Faction"},{"typeID":93839,"name":"Republic Fleet Large Remote Shield Booster","meta":"Faction"}],"93839":[{"typeID":8639,"name":"Large Asymmetric Enduring Remote Shield Booster","meta":"Named"},{"typeID":8635,"name":"Large Murky Compact Remote Shield Booster","meta":"Named"},{"typeID":3606,"name":"Large Remote Shield Booster I","meta":"T1"},{"typeID":8641,"name":"Large S95a Scoped Remote Shield Booster","meta":"Named"},{"typeID":3608,"name":"Large Remote Shield Booster II","meta":"T2"},{"typeID":93838,"name":"Caldari Navy Large Remote Shield Booster","meta":"Faction"},{"typeID":93839,"name":"Republic Fleet Large Remote Shield Booster","meta":"Faction"}],"444":[{"typeID":6571,"name":"Basic Mining Survey Chipset","meta":"Named"},{"typeID":6569,"name":"ML-3 Compact Mining Survey Chipset","meta":"Named"},{"typeID":444,"name":"Mining Survey Chipset I","meta":"T1"},{"typeID":2333,"name":"Mining Survey Chipset II","meta":"T2"},{"typeID":94065,"name":"Republic Fleet Mining Survey Chipset","meta":"Faction"}],"2333":[{"typeID":6571,"name":"Basic Mining Survey Chipset","meta":"Named"},{"typeID":6569,"name":"ML-3 Compact Mining Survey Chipset","meta":"Named"},{"typeID":444,"name":"Mining Survey Chipset I","meta":"T1"},{"typeID":2333,"name":"Mining Survey Chipset II","meta":"T2"},{"typeID":94065,"name":"Republic Fleet Mining Survey Chipset","meta":"Faction"}],"6569":[{"typeID":6571,"name":"Basic Mining Survey Chipset","meta":"Named"},{"typeID":6569,"name":"ML-3 Compact Mining Survey Chipset","meta":"Named"},{"typeID":444,"name":"Mining Survey Chipset I","meta":"T1"},{"typeID":2333,"name":"Mining Survey Chipset II","meta":"T2"},{"typeID":94065,"name":"Republic Fleet Mining Survey Chipset","meta":"Faction"}],"6571":[{"typeID":6571,"name":"Basic Mining Survey Chipset","meta":"Named"},{"typeID":6569,"name":"ML-3 Compact Mining Survey Chipset","meta":"Named"},{"typeID":444,"name":"Mining Survey Chipset I","meta":"T1"},{"typeID":2333,"name":"Mining Survey Chipset II","meta":"T2"},{"typeID":94065,"name":"Republic Fleet Mining Survey Chipset","meta":"Faction"}],"94065":[{"typeID":6571,"name":"Basic Mining Survey Chipset","meta":"Named"},{"typeID":6569,"name":"ML-3 Compact Mining Survey Chipset","meta":"Named"},{"typeID":444,"name":"Mining Survey Chipset I","meta":"T1"},{"typeID":2333,"name":"Mining Survey Chipset II","meta":"T2"},{"typeID":94065,"name":"Republic Fleet Mining Survey Chipset","meta":"Faction"}],"1893":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"2363":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"2364":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"5849":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"13941":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"13943":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"14800":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"14802":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"14804":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"14806":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"14808":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"14810":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"14812":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"14814":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"15808":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"15810":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"23902":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"44111":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"88265":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"94058":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"94060":[{"typeID":5849,"name":"Extruded Compact Heat Sink","meta":"Named"},{"typeID":2363,"name":"Heat Sink I","meta":"T1"},{"typeID":2364,"name":"Heat Sink II","meta":"T2"},{"typeID":1893,"name":"'Basic' Heat Sink","meta":"Storyline"},{"typeID":23902,"name":"'Trebuchet' Heat Sink I","meta":"Storyline"},{"typeID":44111,"name":"Tahron's Custom Heat Sink","meta":"Storyline"},{"typeID":15808,"name":"Ammatar Navy Heat Sink","meta":"Faction"},{"typeID":13941,"name":"Dark Blood Heat Sink","meta":"Faction"},{"typeID":94060,"name":"Imperial Navy 'Disciple' Heat Sink","meta":"Faction"},{"typeID":94058,"name":"Imperial Navy 'Neophyte' Heat Sink","meta":"Faction"},{"typeID":15810,"name":"Imperial Navy Heat Sink","meta":"Faction"},{"typeID":13943,"name":"True Sansha Heat Sink","meta":"Faction"},{"typeID":14810,"name":"Ahremen's Modified Heat Sink","meta":"Officer"},{"typeID":14800,"name":"Brokara's Modified Heat Sink","meta":"Officer"},{"typeID":14812,"name":"Chelm's Modified Heat Sink","meta":"Officer"},{"typeID":14814,"name":"Draclira's Modified Heat Sink","meta":"Officer"},{"typeID":14806,"name":"Raysere's Modified Heat Sink","meta":"Officer"},{"typeID":14804,"name":"Selynne's Modified Heat Sink","meta":"Officer"},{"typeID":88265,"name":"Strategos' Modified Heat Sink","meta":"Officer"},{"typeID":14802,"name":"Tairei's Modified Heat Sink","meta":"Officer"},{"typeID":14808,"name":"Vizan's Modified Heat Sink","meta":"Officer"}],"1951":[{"typeID":6325,"name":"Fourier Compact Tracking Enhancer","meta":"Named"},{"typeID":1998,"name":"Tracking Enhancer I","meta":"T1"},{"typeID":1999,"name":"Tracking Enhancer II","meta":"T2"},{"typeID":1951,"name":"'Basic' Tracking Enhancer","meta":"Storyline"},{"typeID":14100,"name":"Domination Tracking Enhancer","meta":"Faction"},{"typeID":93913,"name":"Imperial Navy 'Atonement' Tracking Enhancer","meta":"Faction"},{"typeID":15965,"name":"Republic Fleet Tracking Enhancer","meta":"Faction"},{"typeID":14644,"name":"Gotan's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14642,"name":"Hakim's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14640,"name":"Mizuro's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14646,"name":"Tobias' Modified Tracking Enhancer","meta":"Officer"}],"1998":[{"typeID":6325,"name":"Fourier Compact Tracking Enhancer","meta":"Named"},{"typeID":1998,"name":"Tracking Enhancer I","meta":"T1"},{"typeID":1999,"name":"Tracking Enhancer II","meta":"T2"},{"typeID":1951,"name":"'Basic' Tracking Enhancer","meta":"Storyline"},{"typeID":14100,"name":"Domination Tracking Enhancer","meta":"Faction"},{"typeID":93913,"name":"Imperial Navy 'Atonement' Tracking Enhancer","meta":"Faction"},{"typeID":15965,"name":"Republic Fleet Tracking Enhancer","meta":"Faction"},{"typeID":14644,"name":"Gotan's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14642,"name":"Hakim's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14640,"name":"Mizuro's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14646,"name":"Tobias' Modified Tracking Enhancer","meta":"Officer"}],"1999":[{"typeID":6325,"name":"Fourier Compact Tracking Enhancer","meta":"Named"},{"typeID":1998,"name":"Tracking Enhancer I","meta":"T1"},{"typeID":1999,"name":"Tracking Enhancer II","meta":"T2"},{"typeID":1951,"name":"'Basic' Tracking Enhancer","meta":"Storyline"},{"typeID":14100,"name":"Domination Tracking Enhancer","meta":"Faction"},{"typeID":93913,"name":"Imperial Navy 'Atonement' Tracking Enhancer","meta":"Faction"},{"typeID":15965,"name":"Republic Fleet Tracking Enhancer","meta":"Faction"},{"typeID":14644,"name":"Gotan's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14642,"name":"Hakim's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14640,"name":"Mizuro's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14646,"name":"Tobias' Modified Tracking Enhancer","meta":"Officer"}],"6325":[{"typeID":6325,"name":"Fourier Compact Tracking Enhancer","meta":"Named"},{"typeID":1998,"name":"Tracking Enhancer I","meta":"T1"},{"typeID":1999,"name":"Tracking Enhancer II","meta":"T2"},{"typeID":1951,"name":"'Basic' Tracking Enhancer","meta":"Storyline"},{"typeID":14100,"name":"Domination Tracking Enhancer","meta":"Faction"},{"typeID":93913,"name":"Imperial Navy 'Atonement' Tracking Enhancer","meta":"Faction"},{"typeID":15965,"name":"Republic Fleet Tracking Enhancer","meta":"Faction"},{"typeID":14644,"name":"Gotan's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14642,"name":"Hakim's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14640,"name":"Mizuro's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14646,"name":"Tobias' Modified Tracking Enhancer","meta":"Officer"}],"14100":[{"typeID":6325,"name":"Fourier Compact Tracking Enhancer","meta":"Named"},{"typeID":1998,"name":"Tracking Enhancer I","meta":"T1"},{"typeID":1999,"name":"Tracking Enhancer II","meta":"T2"},{"typeID":1951,"name":"'Basic' Tracking Enhancer","meta":"Storyline"},{"typeID":14100,"name":"Domination Tracking Enhancer","meta":"Faction"},{"typeID":93913,"name":"Imperial Navy 'Atonement' Tracking Enhancer","meta":"Faction"},{"typeID":15965,"name":"Republic Fleet Tracking Enhancer","meta":"Faction"},{"typeID":14644,"name":"Gotan's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14642,"name":"Hakim's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14640,"name":"Mizuro's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14646,"name":"Tobias' Modified Tracking Enhancer","meta":"Officer"}],"14640":[{"typeID":6325,"name":"Fourier Compact Tracking Enhancer","meta":"Named"},{"typeID":1998,"name":"Tracking Enhancer I","meta":"T1"},{"typeID":1999,"name":"Tracking Enhancer II","meta":"T2"},{"typeID":1951,"name":"'Basic' Tracking Enhancer","meta":"Storyline"},{"typeID":14100,"name":"Domination Tracking Enhancer","meta":"Faction"},{"typeID":93913,"name":"Imperial Navy 'Atonement' Tracking Enhancer","meta":"Faction"},{"typeID":15965,"name":"Republic Fleet Tracking Enhancer","meta":"Faction"},{"typeID":14644,"name":"Gotan's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14642,"name":"Hakim's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14640,"name":"Mizuro's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14646,"name":"Tobias' Modified Tracking Enhancer","meta":"Officer"}],"14642":[{"typeID":6325,"name":"Fourier Compact Tracking Enhancer","meta":"Named"},{"typeID":1998,"name":"Tracking Enhancer I","meta":"T1"},{"typeID":1999,"name":"Tracking Enhancer II","meta":"T2"},{"typeID":1951,"name":"'Basic' Tracking Enhancer","meta":"Storyline"},{"typeID":14100,"name":"Domination Tracking Enhancer","meta":"Faction"},{"typeID":93913,"name":"Imperial Navy 'Atonement' Tracking Enhancer","meta":"Faction"},{"typeID":15965,"name":"Republic Fleet Tracking Enhancer","meta":"Faction"},{"typeID":14644,"name":"Gotan's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14642,"name":"Hakim's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14640,"name":"Mizuro's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14646,"name":"Tobias' Modified Tracking Enhancer","meta":"Officer"}],"14644":[{"typeID":6325,"name":"Fourier Compact Tracking Enhancer","meta":"Named"},{"typeID":1998,"name":"Tracking Enhancer I","meta":"T1"},{"typeID":1999,"name":"Tracking Enhancer II","meta":"T2"},{"typeID":1951,"name":"'Basic' Tracking Enhancer","meta":"Storyline"},{"typeID":14100,"name":"Domination Tracking Enhancer","meta":"Faction"},{"typeID":93913,"name":"Imperial Navy 'Atonement' Tracking Enhancer","meta":"Faction"},{"typeID":15965,"name":"Republic Fleet Tracking Enhancer","meta":"Faction"},{"typeID":14644,"name":"Gotan's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14642,"name":"Hakim's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14640,"name":"Mizuro's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14646,"name":"Tobias' Modified Tracking Enhancer","meta":"Officer"}],"14646":[{"typeID":6325,"name":"Fourier Compact Tracking Enhancer","meta":"Named"},{"typeID":1998,"name":"Tracking Enhancer I","meta":"T1"},{"typeID":1999,"name":"Tracking Enhancer II","meta":"T2"},{"typeID":1951,"name":"'Basic' Tracking Enhancer","meta":"Storyline"},{"typeID":14100,"name":"Domination Tracking Enhancer","meta":"Faction"},{"typeID":93913,"name":"Imperial Navy 'Atonement' Tracking Enhancer","meta":"Faction"},{"typeID":15965,"name":"Republic Fleet Tracking Enhancer","meta":"Faction"},{"typeID":14644,"name":"Gotan's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14642,"name":"Hakim's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14640,"name":"Mizuro's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14646,"name":"Tobias' Modified Tracking Enhancer","meta":"Officer"}],"15965":[{"typeID":6325,"name":"Fourier Compact Tracking Enhancer","meta":"Named"},{"typeID":1998,"name":"Tracking Enhancer I","meta":"T1"},{"typeID":1999,"name":"Tracking Enhancer II","meta":"T2"},{"typeID":1951,"name":"'Basic' Tracking Enhancer","meta":"Storyline"},{"typeID":14100,"name":"Domination Tracking Enhancer","meta":"Faction"},{"typeID":93913,"name":"Imperial Navy 'Atonement' Tracking Enhancer","meta":"Faction"},{"typeID":15965,"name":"Republic Fleet Tracking Enhancer","meta":"Faction"},{"typeID":14644,"name":"Gotan's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14642,"name":"Hakim's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14640,"name":"Mizuro's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14646,"name":"Tobias' Modified Tracking Enhancer","meta":"Officer"}],"93913":[{"typeID":6325,"name":"Fourier Compact Tracking Enhancer","meta":"Named"},{"typeID":1998,"name":"Tracking Enhancer I","meta":"T1"},{"typeID":1999,"name":"Tracking Enhancer II","meta":"T2"},{"typeID":1951,"name":"'Basic' Tracking Enhancer","meta":"Storyline"},{"typeID":14100,"name":"Domination Tracking Enhancer","meta":"Faction"},{"typeID":93913,"name":"Imperial Navy 'Atonement' Tracking Enhancer","meta":"Faction"},{"typeID":15965,"name":"Republic Fleet Tracking Enhancer","meta":"Faction"},{"typeID":14644,"name":"Gotan's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14642,"name":"Hakim's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14640,"name":"Mizuro's Modified Tracking Enhancer","meta":"Officer"},{"typeID":14646,"name":"Tobias' Modified Tracking Enhancer","meta":"Officer"}],"9944":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"10188":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"10190":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"11105":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"13945":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"15144":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"15146":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"15148":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"15150":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"15416":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"15895":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"22919":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"44113":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"44114":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"93998":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"94020":[{"typeID":9944,"name":"Magnetic Field Stabilizer I","meta":"T1"},{"typeID":11105,"name":"Vortex Compact Magnetic Field Stabilizer","meta":"Named"},{"typeID":10190,"name":"Magnetic Field Stabilizer II","meta":"T2"},{"typeID":10188,"name":"'Basic' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":22919,"name":"'Monopoly' Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44113,"name":"Kaatara's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":15416,"name":"Naiyon's Modified Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":44114,"name":"Torelle's Custom Magnetic Field Stabilizer","meta":"Storyline"},{"typeID":93998,"name":"Federation Navy 'Argyreos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":94020,"name":"Federation Navy 'Khryseos' Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15895,"name":"Federation Navy Magnetic Field Stabilizer","meta":"Faction"},{"typeID":13945,"name":"Shadow Serpentis Magnetic Field Stabilizer","meta":"Faction"},{"typeID":15144,"name":"Brynn's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15150,"name":"Cormack's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15148,"name":"Setele's Modified Magnetic Field Stabilizer","meta":"Officer"},{"typeID":15146,"name":"Tuvan's Modified Magnetic Field Stabilizer","meta":"Officer"}],"11359":[{"typeID":16451,"name":"Large Coaxial Compact Remote Armor Repairer","meta":"Named"},{"typeID":16449,"name":"Large I-ax Enduring Remote Armor Repairer","meta":"Named"},{"typeID":11359,"name":"Large Remote Armor Repairer I","meta":"T1"},{"typeID":16455,"name":"Large Solace Scoped Remote Armor Repairer","meta":"Named"},{"typeID":26914,"name":"Large Remote Armor Repairer II","meta":"T2"},{"typeID":23416,"name":"'Peace' Large Remote Armor Repairer","meta":"Storyline"},{"typeID":93841,"name":"Federation Navy Large Remote Armor Repairer","meta":"Faction"},{"typeID":93840,"name":"Imperial Navy Large Remote Armor Repairer","meta":"Faction"}],"16449":[{"typeID":16451,"name":"Large Coaxial Compact Remote Armor Repairer","meta":"Named"},{"typeID":16449,"name":"Large I-ax Enduring Remote Armor Repairer","meta":"Named"},{"typeID":11359,"name":"Large Remote Armor Repairer I","meta":"T1"},{"typeID":16455,"name":"Large Solace Scoped Remote Armor Repairer","meta":"Named"},{"typeID":26914,"name":"Large Remote Armor Repairer II","meta":"T2"},{"typeID":23416,"name":"'Peace' Large Remote Armor Repairer","meta":"Storyline"},{"typeID":93841,"name":"Federation Navy Large Remote Armor Repairer","meta":"Faction"},{"typeID":93840,"name":"Imperial Navy Large Remote Armor Repairer","meta":"Faction"}],"16451":[{"typeID":16451,"name":"Large Coaxial Compact Remote Armor Repairer","meta":"Named"},{"typeID":16449,"name":"Large I-ax Enduring Remote Armor Repairer","meta":"Named"},{"typeID":11359,"name":"Large Remote Armor Repairer I","meta":"T1"},{"typeID":16455,"name":"Large Solace Scoped Remote Armor Repairer","meta":"Named"},{"typeID":26914,"name":"Large Remote Armor Repairer II","meta":"T2"},{"typeID":23416,"name":"'Peace' Large Remote Armor Repairer","meta":"Storyline"},{"typeID":93841,"name":"Federation Navy Large Remote Armor Repairer","meta":"Faction"},{"typeID":93840,"name":"Imperial Navy Large Remote Armor Repairer","meta":"Faction"}],"16455":[{"typeID":16451,"name":"Large Coaxial Compact Remote Armor Repairer","meta":"Named"},{"typeID":16449,"name":"Large I-ax Enduring Remote Armor Repairer","meta":"Named"},{"typeID":11359,"name":"Large Remote Armor Repairer I","meta":"T1"},{"typeID":16455,"name":"Large Solace Scoped Remote Armor Repairer","meta":"Named"},{"typeID":26914,"name":"Large Remote Armor Repairer II","meta":"T2"},{"typeID":23416,"name":"'Peace' Large Remote Armor Repairer","meta":"Storyline"},{"typeID":93841,"name":"Federation Navy Large Remote Armor Repairer","meta":"Faction"},{"typeID":93840,"name":"Imperial Navy Large Remote Armor Repairer","meta":"Faction"}],"23416":[{"typeID":16451,"name":"Large Coaxial Compact Remote Armor Repairer","meta":"Named"},{"typeID":16449,"name":"Large I-ax Enduring Remote Armor Repairer","meta":"Named"},{"typeID":11359,"name":"Large Remote Armor Repairer I","meta":"T1"},{"typeID":16455,"name":"Large Solace Scoped Remote Armor Repairer","meta":"Named"},{"typeID":26914,"name":"Large Remote Armor Repairer II","meta":"T2"},{"typeID":23416,"name":"'Peace' Large Remote Armor Repairer","meta":"Storyline"},{"typeID":93841,"name":"Federation Navy Large Remote Armor Repairer","meta":"Faction"},{"typeID":93840,"name":"Imperial Navy Large Remote Armor Repairer","meta":"Faction"}],"26914":[{"typeID":16451,"name":"Large Coaxial Compact Remote Armor Repairer","meta":"Named"},{"typeID":16449,"name":"Large I-ax Enduring Remote Armor Repairer","meta":"Named"},{"typeID":11359,"name":"Large Remote Armor Repairer I","meta":"T1"},{"typeID":16455,"name":"Large Solace Scoped Remote Armor Repairer","meta":"Named"},{"typeID":26914,"name":"Large Remote Armor Repairer II","meta":"T2"},{"typeID":23416,"name":"'Peace' Large Remote Armor Repairer","meta":"Storyline"},{"typeID":93841,"name":"Federation Navy Large Remote Armor Repairer","meta":"Faction"},{"typeID":93840,"name":"Imperial Navy Large Remote Armor Repairer","meta":"Faction"}],"93840":[{"typeID":16451,"name":"Large Coaxial Compact Remote Armor Repairer","meta":"Named"},{"typeID":16449,"name":"Large I-ax Enduring Remote Armor Repairer","meta":"Named"},{"typeID":11359,"name":"Large Remote Armor Repairer I","meta":"T1"},{"typeID":16455,"name":"Large Solace Scoped Remote Armor Repairer","meta":"Named"},{"typeID":26914,"name":"Large Remote Armor Repairer II","meta":"T2"},{"typeID":23416,"name":"'Peace' Large Remote Armor Repairer","meta":"Storyline"},{"typeID":93841,"name":"Federation Navy Large Remote Armor Repairer","meta":"Faction"},{"typeID":93840,"name":"Imperial Navy Large Remote Armor Repairer","meta":"Faction"}],"93841":[{"typeID":16451,"name":"Large Coaxial Compact Remote Armor Repairer","meta":"Named"},{"typeID":16449,"name":"Large I-ax Enduring Remote Armor Repairer","meta":"Named"},{"typeID":11359,"name":"Large Remote Armor Repairer I","meta":"T1"},{"typeID":16455,"name":"Large Solace Scoped Remote Armor Repairer","meta":"Named"},{"typeID":26914,"name":"Large Remote Armor Repairer II","meta":"T2"},{"typeID":23416,"name":"'Peace' Large Remote Armor Repairer","meta":"Storyline"},{"typeID":93841,"name":"Federation Navy Large Remote Armor Repairer","meta":"Faction"},{"typeID":93840,"name":"Imperial Navy Large Remote Armor Repairer","meta":"Faction"}],"25561":[{"typeID":25565,"name":"Hypnos Compact Signal Distortion Amplifier I","meta":"T1"},{"typeID":25561,"name":"Signal Distortion Amplifier I","meta":"T1"},{"typeID":25563,"name":"Signal Distortion Amplifier II","meta":"T2"},{"typeID":94067,"name":"Caldari Navy Signal Distortion Amplifier","meta":"Faction"},{"typeID":85006,"name":"Dread Guristas Signal Distortion Amplifier","meta":"Faction"},{"typeID":85007,"name":"Hanaruwa's Modified Signal Distortion Amplifier","meta":"Officer"}],"25563":[{"typeID":25565,"name":"Hypnos Compact Signal Distortion Amplifier I","meta":"T1"},{"typeID":25561,"name":"Signal Distortion Amplifier I","meta":"T1"},{"typeID":25563,"name":"Signal Distortion Amplifier II","meta":"T2"},{"typeID":94067,"name":"Caldari Navy Signal Distortion Amplifier","meta":"Faction"},{"typeID":85006,"name":"Dread Guristas Signal Distortion Amplifier","meta":"Faction"},{"typeID":85007,"name":"Hanaruwa's Modified Signal Distortion Amplifier","meta":"Officer"}],"25565":[{"typeID":25565,"name":"Hypnos Compact Signal Distortion Amplifier I","meta":"T1"},{"typeID":25561,"name":"Signal Distortion Amplifier I","meta":"T1"},{"typeID":25563,"name":"Signal Distortion Amplifier II","meta":"T2"},{"typeID":94067,"name":"Caldari Navy Signal Distortion Amplifier","meta":"Faction"},{"typeID":85006,"name":"Dread Guristas Signal Distortion Amplifier","meta":"Faction"},{"typeID":85007,"name":"Hanaruwa's Modified Signal Distortion Amplifier","meta":"Officer"}],"85006":[{"typeID":25565,"name":"Hypnos Compact Signal Distortion Amplifier I","meta":"T1"},{"typeID":25561,"name":"Signal Distortion Amplifier I","meta":"T1"},{"typeID":25563,"name":"Signal Distortion Amplifier II","meta":"T2"},{"typeID":94067,"name":"Caldari Navy Signal Distortion Amplifier","meta":"Faction"},{"typeID":85006,"name":"Dread Guristas Signal Distortion Amplifier","meta":"Faction"},{"typeID":85007,"name":"Hanaruwa's Modified Signal Distortion Amplifier","meta":"Officer"}],"85007":[{"typeID":25565,"name":"Hypnos Compact Signal Distortion Amplifier I","meta":"T1"},{"typeID":25561,"name":"Signal Distortion Amplifier I","meta":"T1"},{"typeID":25563,"name":"Signal Distortion Amplifier II","meta":"T2"},{"typeID":94067,"name":"Caldari Navy Signal Distortion Amplifier","meta":"Faction"},{"typeID":85006,"name":"Dread Guristas Signal Distortion Amplifier","meta":"Faction"},{"typeID":85007,"name":"Hanaruwa's Modified Signal Distortion Amplifier","meta":"Officer"}],"94067":[{"typeID":25565,"name":"Hypnos Compact Signal Distortion Amplifier I","meta":"T1"},{"typeID":25561,"name":"Signal Distortion Amplifier I","meta":"T1"},{"typeID":25563,"name":"Signal Distortion Amplifier II","meta":"T2"},{"typeID":94067,"name":"Caldari Navy Signal Distortion Amplifier","meta":"Faction"},{"typeID":85006,"name":"Dread Guristas Signal Distortion Amplifier","meta":"Faction"},{"typeID":85007,"name":"Hanaruwa's Modified Signal Distortion Amplifier","meta":"Officer"}],"35770":[{"typeID":35770,"name":"Missile Guidance Enhancer I","meta":"T1"},{"typeID":35774,"name":"Pro-Nav Compact Missile Guidance Enhancer","meta":"Named"},{"typeID":35771,"name":"Missile Guidance Enhancer II","meta":"T2"},{"typeID":93908,"name":"Caldari Navy Missile Guidance Enhancer","meta":"Faction"},{"typeID":93909,"name":"Republic Fleet Missile Guidance Enhancer","meta":"Faction"}],"35771":[{"typeID":35770,"name":"Missile Guidance Enhancer I","meta":"T1"},{"typeID":35774,"name":"Pro-Nav Compact Missile Guidance Enhancer","meta":"Named"},{"typeID":35771,"name":"Missile Guidance Enhancer II","meta":"T2"},{"typeID":93908,"name":"Caldari Navy Missile Guidance Enhancer","meta":"Faction"},{"typeID":93909,"name":"Republic Fleet Missile Guidance Enhancer","meta":"Faction"}],"35774":[{"typeID":35770,"name":"Missile Guidance Enhancer I","meta":"T1"},{"typeID":35774,"name":"Pro-Nav Compact Missile Guidance Enhancer","meta":"Named"},{"typeID":35771,"name":"Missile Guidance Enhancer II","meta":"T2"},{"typeID":93908,"name":"Caldari Navy Missile Guidance Enhancer","meta":"Faction"},{"typeID":93909,"name":"Republic Fleet Missile Guidance Enhancer","meta":"Faction"}],"93908":[{"typeID":35770,"name":"Missile Guidance Enhancer I","meta":"T1"},{"typeID":35774,"name":"Pro-Nav Compact Missile Guidance Enhancer","meta":"Named"},{"typeID":35771,"name":"Missile Guidance Enhancer II","meta":"T2"},{"typeID":93908,"name":"Caldari Navy Missile Guidance Enhancer","meta":"Faction"},{"typeID":93909,"name":"Republic Fleet Missile Guidance Enhancer","meta":"Faction"}],"93909":[{"typeID":35770,"name":"Missile Guidance Enhancer I","meta":"T1"},{"typeID":35774,"name":"Pro-Nav Compact Missile Guidance Enhancer","meta":"Named"},{"typeID":35771,"name":"Missile Guidance Enhancer II","meta":"T2"},{"typeID":93908,"name":"Caldari Navy Missile Guidance Enhancer","meta":"Faction"},{"typeID":93909,"name":"Republic Fleet Missile Guidance Enhancer","meta":"Faction"}],"35788":[{"typeID":35789,"name":"Astro-Inertial Compact Missile Guidance Computer","meta":"Named"},{"typeID":35788,"name":"Missile Guidance Computer I","meta":"T1"},{"typeID":35790,"name":"Missile Guidance Computer II","meta":"T2"},{"typeID":94063,"name":"Caldari Navy Missile Guidance Computer","meta":"Faction"},{"typeID":94064,"name":"Republic Fleet Missile Guidance Computer","meta":"Faction"}],"35789":[{"typeID":35789,"name":"Astro-Inertial Compact Missile Guidance Computer","meta":"Named"},{"typeID":35788,"name":"Missile Guidance Computer I","meta":"T1"},{"typeID":35790,"name":"Missile Guidance Computer II","meta":"T2"},{"typeID":94063,"name":"Caldari Navy Missile Guidance Computer","meta":"Faction"},{"typeID":94064,"name":"Republic Fleet Missile Guidance Computer","meta":"Faction"}],"35790":[{"typeID":35789,"name":"Astro-Inertial Compact Missile Guidance Computer","meta":"Named"},{"typeID":35788,"name":"Missile Guidance Computer I","meta":"T1"},{"typeID":35790,"name":"Missile Guidance Computer II","meta":"T2"},{"typeID":94063,"name":"Caldari Navy Missile Guidance Computer","meta":"Faction"},{"typeID":94064,"name":"Republic Fleet Missile Guidance Computer","meta":"Faction"}],"94063":[{"typeID":35789,"name":"Astro-Inertial Compact Missile Guidance Computer","meta":"Named"},{"typeID":35788,"name":"Missile Guidance Computer I","meta":"T1"},{"typeID":35790,"name":"Missile Guidance Computer II","meta":"T2"},{"typeID":94063,"name":"Caldari Navy Missile Guidance Computer","meta":"Faction"},{"typeID":94064,"name":"Republic Fleet Missile Guidance Computer","meta":"Faction"}],"94064":[{"typeID":35789,"name":"Astro-Inertial Compact Missile Guidance Computer","meta":"Named"},{"typeID":35788,"name":"Missile Guidance Computer I","meta":"T1"},{"typeID":35790,"name":"Missile Guidance Computer II","meta":"T2"},{"typeID":94063,"name":"Caldari Navy Missile Guidance Computer","meta":"Faction"},{"typeID":94064,"name":"Republic Fleet Missile Guidance Computer","meta":"Faction"}]};
  for(const [tid,list] of Object.entries(_NEW_VARIATIONS)) moduleVariations[tid]=list;
  _bundleReady = true;
  _bundleListeners.forEach(fn => fn());
}).catch(() => { _bundleReady = true; _bundleListeners.forEach(fn => fn()); });

const GLOBAL_CSS=`.hs{-ms-overflow-style:none;scrollbar-width:none}.hs::-webkit-scrollbar{display:none}input{outline:none}select{outline:none}img.eve-icon{border-radius:4px;background:#1a1a1d;}`;
import { C } from "./theme.js";
import { eveIcon, eveRender } from "./lib/icons.js";
import { META_BY_MG, metaOf, META_COLORS, META_ORDER } from "./lib/meta.js";
import { ATTRIBUTE_IMPLANTS, HARDWIRING_IMPLANTS, BOOSTER_DATA } from "./data/static-tables.js";
import { GraphTab, GRAPH_CONFIG, generateCurve } from "./components/GraphTab.jsx";
const DMG={
  em: {label:"EM",  color:"#60a5fa"},
  th: {label:"Th",  color:"#ef4444"},
  kin:{label:"Kin", color:"#cbd5e1"},
  exp:{label:"Exp", color:"#f97316"},
};
const STATE_COLORS={offline:C.offline,online:C.online,active:C.active,overheated:C.overheat};
const STATE_LABELS={offline:"Offline",online:"Online",active:"Active",overheated:"Overheat"};
const MODULE_STATES=["offline","online","active","overheated"];
const calcTransversal=(a,b)=>{const d=Math.abs(a-b)%360,n=d>180?360-d:d;return Math.min(n,180-n);};

// ── Ship lookup ────────────────────────────────────────────────────
// ── Ship lookup ─────────────────────────────────────────────────────
// Fallback: build a ships.json-shaped object from dogma TYPES data for ships
// that are missing from ships.json (e.g. Naga). Fixes blank stats/slots.
function shipFromDogma(name){
  const tid=tidByName(name);
  const td=tid?(TYPES[tid]??TYPES[String(tid)]):null;
  if(!td)return null;
  const a=td.attrs??td.a??{};
  const sensors=[["Radar",a.scanRadarStrength],["Ladar",a.scanLadarStrength],["Magnetometric",a.scanMagnetometricStrength],["Gravimetric",a.scanGravimetricStrength]]
    .filter(([,v])=>v>0).sort((x,y)=>(y[1]??0)-(x[1]??0));
  const rz=k=>Math.round((1-(a[k]??1))*1000)/10;
  let race=null;
  for(const races of Object.values(SHIPS_BY_CLASS)){for(const[r,ships] of Object.entries(races)){if(ships.includes(name)){race=r;break;}}if(race)break;}
  return{
    typeID:tid,name,hullClass:td.groupName??td.gn??"",race,
    cpu:a.cpuOutput??0,pg:a.powerOutput??0,calibration:a.upgradeCapacity??400,
    hiSlots:a.hiSlots??0,medSlots:a.medSlots??0,lowSlots:a.lowSlots??0,rigSlots:a.rigSlots??a.upgradeSlotsLeft??0,
    turrets:a.turretSlotsLeft??0,launchers:a.launcherSlotsLeft??0,
    maxVelocity:a.maxVelocity??0,agility:a.agility??0,
    warpSpeed:a.baseWarpSpeed??(a.warpSpeedMultiplier??3),baseWarpSpeed:a.baseWarpSpeed??1,
    mass:a.mass??0,volume:a.volume??0,
    shieldHP:a.shieldCapacity??0,armorHP:a.armorHP??0,hullHP:a.hp??0,
    shieldRechargeRate:a.shieldRechargeRate??0,
    capCapacity:a.capacitorCapacity??0,capRechargeRate:a.rechargeRate??0,
    targetRange:a.maxTargetRange??0,scanRes:a.scanResolution??0,maxTargets:a.maxLockedTargets??0,
    sigRadius:a.signatureRadius??0,droneBay:a.droneCapacity??0,droneBandwidth:a.droneBandwidth??0,
    warpCapNeed:a.warpCapacitorNeed??0,
    sensorStrength:sensors[0]?.[1]??0,sensorType:sensors[0]?.[0]??"",
    resists:{
      shield:{em:rz("shieldEmDamageResonance"),th:rz("shieldThermalDamageResonance"),kin:rz("shieldKineticDamageResonance"),exp:rz("shieldExplosiveDamageResonance")},
      armor:{em:rz("armorEmDamageResonance"),th:rz("armorThermalDamageResonance"),kin:rz("armorKineticDamageResonance"),exp:rz("armorExplosiveDamageResonance")},
      hull:{em:rz("emDamageResonance"),th:rz("thermalDamageResonance"),kin:rz("kineticDamageResonance"),exp:rz("explosiveDamageResonance")},
    },
  };
}
function lookupShip(name){
  const found=Object.values(shipsData).find(s=>s.name===name);
  const ship=found?{...found}:(shipFromDogma(name)??{name});
  // Override hullClass from authoritative SHIPS_BY_CLASS (fixes Malediction as Tactical Destroyer bug)
  for(const[cls,races] of Object.entries(SHIPS_BY_CLASS)){
    for(const ships of Object.values(races)){
      if(ships.includes(name)){ship.hullClass=cls;break;}
    }
  }
  return ship;
}
const fmtN=n=>{if(n==null)return"-";if(n>=1e6)return`${(n/1e6).toFixed(2)}M`;if(n>=100000)return`${Math.round(n/1000)}k`;if(n>=1000){const k=n/1000;return`${k%1===0?k.toFixed(0):k.toFixed(1)}k`;}return String(Math.round(n));};
const calcEHP=(hp,res)=>{const avg=((res?.em??0)+(res?.th??0)+(res?.kin??0)+(res?.exp??0))/4;return avg<100?hp/(1-avg/100):hp;};
const resMult=(em,th,kin,exp)=>(1/(1-(em+th+kin+exp)/400)).toFixed(2)+"x";

// Light haptic tick for touch feedback (no-op on devices/browsers without the Vibration API).
// Light haptic tick. Prefers the native Capacitor Haptics plugin (real Taptic Engine on iOS,
// where the web Vibration API is unavailable) via the runtime bridge, so there's no build-time
// dependency on the plugin; falls back to navigator.vibrate on the web.
const haptic=(ms=10)=>{try{
  const H=(typeof window!=="undefined")&&window.Capacitor?.Plugins?.Haptics;
  if(H){H.impact({style:"LIGHT"});return;}
  navigator.vibrate?.(ms);
}catch(e){}};

// ── Hull classes ───────────────────────────────────────────────────
const RACE_COLORS={Caldari:"#38bdf8",Gallente:"#4ade80",Amarr:"#f59e0b",Minmatar:"#f97316"};
const RACES=["Caldari","Gallente","Amarr","Minmatar"];
const HULL_CLASSES=[
  {key:"Frigate",icon:"🔸",color:C.rig},{key:"Assault Frigate",icon:"🔸",color:C.rig},
  {key:"Interceptor",icon:"🔸",color:C.rig},{key:"Covert Ops",icon:"🔸",color:C.rig},
  {key:"Electronic Attack Ship",icon:"🔸",color:C.rig},{key:"Stealth Bomber",icon:"🔸",color:C.rig},
  {key:"Logistics Frigate",icon:"🔸",color:C.rig},{key:"Destroyer",icon:"🔹",color:C.mid},
  {key:"Tactical Destroyer",icon:"🔹",color:C.mid},{key:"Interdictor",icon:"🔹",color:C.mid},
  {key:"Cruiser",icon:"🔷",color:C.accent},{key:"Heavy Assault Cruiser",icon:"🔷",color:C.accent},
  {key:"Recon Ship",icon:"🔷",color:C.accent},{key:"Heavy Interdictor",icon:"🔷",color:C.accent},
  {key:"Logistics",icon:"🔷",color:C.accent},{key:"Flag Cruiser",icon:"🔷",color:C.accent},
  {key:"Battlecruiser",icon:"🔶",color:C.warning},{key:"Command Ship",icon:"🔶",color:C.warning},
  {key:"Attack Battlecruiser",icon:"🔶",color:C.warning},
  {key:"Battleship",icon:"🔺",color:C.danger},{key:"Black Ops",icon:"🔺",color:C.danger},{key:"Marauder",icon:"🔺",color:C.danger},
];
const SHIPS_BY_CLASS={
  "Frigate":{Caldari:["Condor","Merlin","Kestrel","Heron","Bantam"],Gallente:["Incursus","Atron","Tristan","Imicus","Navitas"],Amarr:["Punisher","Executioner","Tormentor","Magnate","Inquisitor"],Minmatar:["Rifter","Slasher","Probe","Breacher","Burst"]},
  "Assault Frigate":{Caldari:["Harpy","Hawk"],Gallente:["Enyo","Ishkur"],Amarr:["Retribution","Vengeance"],Minmatar:["Jaguar","Wolf"]},
  "Interceptor":{Caldari:["Crow","Raptor"],Gallente:["Ares","Taranis"],Amarr:["Crusader","Malediction"],Minmatar:["Claw","Stiletto"]},
  "Covert Ops":{Caldari:["Buzzard"],Gallente:["Helios"],Amarr:["Anathema"],Minmatar:["Cheetah"]},
  "Electronic Attack Ship":{Caldari:["Kitsune"],Gallente:["Keres"],Amarr:["Sentinel"],Minmatar:["Hyena"]},
  "Stealth Bomber":{Caldari:["Manticore"],Gallente:["Nemesis"],Amarr:["Purifier"],Minmatar:["Hound"]},
  "Logistics Frigate":{Caldari:["Bantam"],Gallente:["Navitas"],Amarr:["Inquisitor"],Minmatar:["Burst"]},
  "Destroyer":{Caldari:["Cormorant","Corax"],Gallente:["Catalyst","Algos"],Amarr:["Coercer","Dragoon"],Minmatar:["Thrasher","Talwar"]},
  "Tactical Destroyer":{Caldari:["Jackdaw"],Gallente:["Hecate"],Amarr:["Confessor"],Minmatar:["Svipul"]},
  "Interdictor":{Caldari:["Flycatcher"],Gallente:["Eris"],Amarr:["Heretic"],Minmatar:["Sabre"]},
  "Cruiser":{Caldari:["Caracal","Moa","Osprey","Blackbird"],Gallente:["Thorax","Vexor","Celestis","Exequror"],Amarr:["Omen","Maller","Arbitrator","Augoror"],Minmatar:["Rupture","Stabber","Bellicose","Scythe"]},
  "Heavy Assault Cruiser":{Caldari:["Cerberus","Eagle"],Gallente:["Deimos","Ishtar"],Amarr:["Sacrilege","Zealot"],Minmatar:["Vagabond","Muninn"]},
  "Recon Ship":{Caldari:["Falcon","Rook"],Gallente:["Arazu","Lachesis"],Amarr:["Pilgrim","Curse"],Minmatar:["Huginn","Rapier"]},
  "Heavy Interdictor":{Caldari:["Onyx"],Gallente:["Phobos"],Amarr:["Devoter"],Minmatar:["Broadsword"]},
  "Logistics":{Caldari:["Basilisk"],Gallente:["Oneiros"],Amarr:["Guardian"],Minmatar:["Scimitar"]},
  "Flag Cruiser":{Caldari:["Stork"],Gallente:["Squall"],Amarr:["Sovereign"],Minmatar:["Bifrost"]},
  "Battlecruiser":{Caldari:["Drake","Ferox"],Gallente:["Brutix","Myrmidon"],Amarr:["Harbinger","Prophecy"],Minmatar:["Hurricane","Cyclone"]},
  "Command Ship":{Caldari:["Nighthawk","Vulture"],Gallente:["Astarte","Eos"],Amarr:["Damnation","Absolution"],Minmatar:["Claymore","Sleipnir"]},
  "Attack Battlecruiser":{Caldari:["Naga"],Gallente:["Talos"],Amarr:["Oracle"],Minmatar:["Tornado"]},
  "Battleship":{Caldari:["Raven","Scorpion","Rokh","Raven Navy Issue"],Gallente:["Hyperion","Dominix","Megathron","Vindicator"],Amarr:["Apocalypse","Abaddon","Armageddon","Nightmare"],Minmatar:["Tempest","Typhoon","Maelstrom","Bhaalgorn"]},
  "Black Ops":{Caldari:["Widow"],Gallente:["Sin"],Amarr:["Redeemer"],Minmatar:["Panther"]},
  "Marauder":{Caldari:["Golem"],Gallente:["Kronos"],Amarr:["Paladin"],Minmatar:["Vargur"]},
};
const SAVED_FITS_SEED={
  "Hyperion":[{id:1,name:"PvP Blaster Hyperion",modified:"Jan 15, 2026"},{id:2,name:"Mission Runner",modified:"Jan 10, 2026"}],
  "Megathron":[{id:3,name:"Sniper Mega",modified:"Jan 8, 2026"}],
  "Drake":[{id:4,name:"PvE Shield Drake",modified:"Dec 22, 2025"}],
  "Rupture":[{id:5,name:"T1 PvP Rupture",modified:"Dec 15, 2025"}],
  "Ishtar":[{id:6,name:"Drone Ishtar L4",modified:"Dec 1, 2025"}],
  "Claymore":[{id:7,name:"Fleet Skirmish Claymore",modified:"Nov 20, 2025"}],
  "Sleipnir":[{id:8,name:"AC Sleipnir Roam",modified:"Nov 18, 2025"}],
};
const CMD_SHIP_FITS={
  "Claymore":{bursts:["Interdiction Maneuvers: +12.5% Velocity","Evasive Maneuvers: +12.5% Agility","Rapid Deployment: -12.5% Align Time"]},
  "Sleipnir":{bursts:["Interdiction Maneuvers: +12.5% Velocity","Evasive Maneuvers: +12.5% Agility"]},
  "Eos":{bursts:["Armor Energizing: +12.5% Armor Resist","Rapid Repair: +12.5% Armor Rep Amt","Geometrical Precision: -12.5% Sig Radius"]},
  "Astarte":{bursts:["Armor Energizing: +12.5% Armor Resist","Rapid Repair: +12.5% Armor Rep Amt"]},
  "Vulture":{bursts:["Shield Harmonizing: +12.5% Shield Resist","Active Shielding: -12.5% Shield Boost Cap"]},
  "Nighthawk":{bursts:["Shield Harmonizing: +12.5% Shield Resist","Active Shielding: -12.5% Shield Boost Cap"]},
};

// ── Module CPU/PG usage table (used until full calc engine) ────────
const MODULE_USAGE={
  "Neutron Blaster Cannon II":{cpu:34,pg:1440},
  "Caldari Navy X-Large Shield Booster":{cpu:72,pg:1},
  "Pith X-Type Thermal Dissipation Field":{cpu:30,pg:1},
  "Sensor Booster II":{cpu:27,pg:1},
  "Magnetic Field Stabilizer II":{cpu:30,pg:1},
  "Damage Control II":{cpu:30,pg:1},
  "Large Core Defense Field Purger I":{cpu:0,pg:0,cal:200},
  "Large Hybrid Collision Accelerator I":{cpu:0,pg:0,cal:200},
};

// ── Generate empty slots from ship data ────────────────────────────
// Pure display-row computation (shared by render and drag-reorder so they can't diverge).
// Only the high-slot section groups identical modules (same name + same ammo).
function computeDisplayRows(mods,secKey,grouped){
  if(!grouped||secKey!=="high")return mods.map(m=>({...m,count:1,groupIds:[m.id]}));
  const seen=new Map();
  mods.forEach(m=>{
    if(m.type==="empty"){seen.set(m.id,{...m,count:1,groupIds:[m.id]});return;}
    const key=m.mutaplasmid?`__abyssal_${m.id}`:(m.ammo?`${m.name}||${m.ammo}`:m.name);
    if(seen.has(key)){const e=seen.get(key);e.count++;e.groupIds.push(m.id);}
    else seen.set(key,{...m,count:1,groupIds:[m.id]});
  });
  return Array.from(seen.values());
}

function generateEmptySlots(ship,subsystems){
  const s=ship??{};
  const make=(prefix,label,count)=>Array.from({length:count??0},(_,i)=>({id:`${prefix}${i}`,name:`[Empty ${label} Slot]`,icon:null,type:"empty"}));
  const t3c=isT3Cruiser(s.name);
  if(t3c){
    // T3 cruisers: slot counts come from fitted subsystems. Subsystems live in their own 4-slot section.
    const subs=subsystems??[null,null,null,null];
    const layout=t3cSlotLayout(subs.filter(Boolean));
    return{
      subsystems:Array.from({length:4},(_,i)=>subs[i]??{id:`sub${i}`,name:`[Empty Subsystem Slot]`,icon:null,type:"empty"}),
      high:make("h","High",layout.hiSlots),
      mid: make("m","Mid", layout.medSlots),
      low: make("l","Low", layout.lowSlots),
      rigs:make("r","Rig", layout.rigSlots),
    };
  }
  return{
    high:make("h","High",s.hiSlots??0),
    mid: make("m","Mid", s.medSlots??0),
    low: make("l","Low", s.lowSlots??0),
    rigs:make("r","Rig", s.rigSlots??0),
  };
}

function parseEFT(text){
  const rawLines=text.replace(/\r/g,"").split("\n").map(l=>l.trim());
  if(!rawLines.length)return{error:"Empty text"};
  const hm=rawLines[0].match(/^\[(.+?),\s*(.+)\]$/);
  if(!hm)return{error:"Invalid EFT header — expected [Ship Name, Fit Name]"};
  const shipName=hm[1].trim(),fitName=hm[2].trim();
  const ship=Object.values(shipsData).find(s=>s.name===shipName);
  if(!ship)return{error:`Unknown ship: "${shipName}"`};

  const mods=[],drones=[],fighters=[],cargo=[],implantNames=[],boosterNames=[],subsystems=[];
  // ── Abyssal pre-pass: extract mutation blocks (appear at the bottom of pyfa exports) ──
  // Each block is 3 lines: "[N] BaseName" / "Mutaplasmid Name" / "attr value, attr value, ...".
  const abyssalByRef={}; const consumed=new Set();
  for(let i=1;i<rawLines.length;i++){
    const bh=rawLines[i].match(/^\[(\d+)\]\s+(.+)$/);
    if(!bh)continue;
    let j=i+1; while(j<rawLines.length&&!rawLines[j])j++;
    let k=j+1; while(k<rawLines.length&&!rawLines[k])k++;
    const mutaName=(rawLines[j]||"").trim(), attrLine=(rawLines[k]||"").trim();
    const mutaID=MUTA_BY_NAME[mutaName.toLowerCase()];
    if(mutaID&&/\s-?[\d.]/.test(attrLine)){
      const mutations={};
      for(const part of attrLine.split(",")){const mt=part.trim().match(/^([A-Za-z][A-Za-z0-9]*)\s+(-?[\d.]+)/);if(mt)mutations[mt[1]]=Number(mt[2]);}
      if(Object.keys(mutations).length){abyssalByRef[bh[1]]={mutaID,mutations};consumed.add(i);consumed.add(j);consumed.add(k);}
    }
  }
  for(let i=1;i<rawLines.length;i++){
    if(consumed.has(i))continue;
    let line=rawLines[i];
    if(!line)continue;
    if(/^\[.*slot\]$/i.test(line))continue;
    if(/^\[.*\]$/.test(line))continue;
    // Abyssal module reference marker, e.g. "Federation Navy 800mm Steel Plates [1]" or "...Paste [2]"
    let modRef=null;
    const refM=line.match(/^(.*\S)\s+\[(\d+)\]\s*$/);
    if(refM){line=refM[1].trim();modRef=refM[2];}
    // EFT state suffix: "ModuleName /OFFLINE" or "ModuleName, Ammo /OVERLOADED"
    let stateOverride=null;
    const stateMatch=line.match(/^(.+?)\s*\/(OFFLINE|ON|OVERLOADED|OVERHEATED)\s*$/i);
    if(stateMatch){
      line=stateMatch[1].trim();
      const tag=stateMatch[2].toUpperCase();
      if(tag==="OFFLINE")stateOverride="offline";
      else if(tag==="OVERLOADED"||tag==="OVERHEATED")stateOverride="overheated";
    }
    const qm=line.match(/^(.+)\s+x(\d+)$/i);
    if(qm){
      const itemName=qm[1].trim(),qty=parseInt(qm[2],10);
      const drone=Object.values(dronesData).find(d=>d.name===itemName);
      if(drone){drones.push({name:itemName,qty,drone});continue;}
      // Fighters (category 87): each EFT line is one squadron (the "xN" is the squadron size).
      // Aggregate repeated lines of the same fighter into a squadron count.
      const fTid=tidByName(itemName);
      if(fTid&&(TYPES[fTid]?.c??TYPES[fTid]?.category)===87){
        const ex=fighters.find(f=>f.name===itemName);
        if(ex)ex.qty+=1; else fighters.push({name:itemName,qty:1,typeID:fTid});
        continue;
      }
      // Resolve typeID + volume from TYPES (authoritative — charges.json lacks T2/faction ammo)
      const tid=tidByName(itemName);
      const vol=tid?(TYPES[tid]?.attrs?.volume??TYPES[tid]?.a?.['161']??0):0;
      cargo.push({name:itemName,qty,typeID:tid,vol});
      continue;
    }
    const comma=line.indexOf(",");
    const modName=comma>=0?line.slice(0,comma).trim():line.trim();
    const ammo=comma>=0?line.slice(comma+1).trim().replace(/\s*\(\d+\)$/,''):undefined;
    if(!modName)continue;
    // T3 cruiser subsystems (category 32): collect separately — they define the slot layout.
    const nameTid=tidByName(modName);
    if(nameTid&&(TYPES[nameTid]?.c??TYPES[nameTid]?.category)===32){
      subsystems.push({typeID:nameTid,name:modName});
      continue;
    }
    const _ab=modRef?abyssalByRef[modRef]:null;
    const modInfo=Object.values(modulesData).find(m=>m.name===modName);
    if(modInfo){mods.push({name:modName,typeID:modInfo.typeID,slot:modInfo.slot,charge:ammo||undefined,state:stateOverride,mutaplasmid:_ab?.mutaID,mutations:_ab?.mutations});continue;}
    // Fallback: module not in modulesData but exists in TYPES (e.g. probe launcher) — slot by group
    if(!modInfo&&nameTid){
      const td=TYPES[nameTid];
      if((td?.c??td?.category)===7){ // Module category
        mods.push({name:modName,typeID:nameTid,slot:guessSlotFromDogma(nameTid),charge:ammo||undefined,state:stateOverride,mutaplasmid:_ab?.mutaID,mutations:_ab?.mutations});
        continue;
      }
    }
    if(isBoosterName(modName)){boosterNames.push(modName);continue;}
    const implantSlot=IMPLANT_NAME_TO_SLOT.get(modName);
    if(implantSlot)implantNames.push({slot:implantSlot,name:modName});
  }
  return{shipName,fitName,ship,mods,drones,fighters,cargo,implantNames,boosterNames,subsystems};
}

// Determine a module's slot (high/med/low/rig) from its dogma effects when it's not in modulesData.
// EVE encodes slot via effects: 12=hiPower, 13=medPower, 11=loPower, 2663=rigSlot.
function guessSlotFromDogma(typeID){
  const e=TYPES[typeID]?.e??TYPES[typeID]?.effectIDs??[];
  if(e.includes(2663))return "rig";
  if(e.includes(12))return "high";
  if(e.includes(13))return "mid";
  if(e.includes(11))return "low";
  return "high"; // sensible default for launchers/turrets
}

function buildSlotsFromEFT(ship,parsedMods,subsystems){
  const slots=generateEmptySlots(ship,subsystems);
  const counters={high:0,mid:0,low:0,rigs:0};
  const slotKeyMap={high:"high",mid:"mid",low:"low",rig:"rigs",rigs:"rigs"};
  for(const mod of parsedMods){
    const secKey=slotKeyMap[mod.slot];
    if(!secKey)continue;
    const idx=counters[secKey];
    if(idx>=slots[secKey].length)continue;
    const modInfo=Object.values(modulesData).find(m=>m.name===mod.name);
    const takesCharges=moduleTakesCharges(mod.typeID,mod.name);
    const hasIntrinsicDmg=!!(modInfo?.emDmg||modInfo?.thDmg||modInfo?.kinDmg||modInfo?.expDmg);
    // Weapon = does damage (turrets/launchers). MGC/probe launchers take charges but aren't weapons.
    const isWeaponMod=(modInfo?.dmgMult!=null&&modInfo?.rof!=null)||hasIntrinsicDmg||
      (takesCharges&&/Launcher|Turret|Weapon/i.test(TYPES[mod.typeID]?.gn??TYPES[mod.typeID]?.groupName??''));
    const hasCharges=takesCharges||!!(modInfo?.chargeGroups?.length);
    const isCapBooster=modInfo?.groupName==="Capacitor Booster";
    const isRigMod=secKey==="rigs";
    const modType=isCapBooster?"capbooster":isWeaponMod?"weapon":isRigMod?"rig":"passive";
    const hasCycle=!!(modInfo?.duration&&modInfo.duration>0)||(modInfo?.capUse!=null&&modInfo.capUse>0)||!!(mod.typeID&&TYPES[mod.typeID]?.attrs?.duration>0);
    // Micro Jump Drives / Field Generators cycle but shouldn't count as "active" for stats — default online.
    const _gName=TYPES[mod.typeID]?.gn??TYPES[mod.typeID]?.groupName??'';
    const isMJD=/Micro Jump Drive|Micro Jump Field Generator/i.test(_gName);
    const defaultState=isRigMod?"online":isMJD?"online":(isWeaponMod||isCapBooster||hasCycle)?"active":"online";
    const state=mod.state??defaultState;
    // Compute maxCharges from module capacity and charge volume:
    let maxChargesVal = undefined;
    if(mod.charge && mod.typeID){
      const modTd = TYPES[mod.typeID]??TYPES[String(mod.typeID)];
      const modCapacity = modTd?.attrs?.capacity ?? modTd?.a?.['38'] ?? 0;
      const chargeTid = tidByName(mod.charge.replace(/\s*\(\d+\)$/, ''));
      const chargeVol = chargeTid ? (TYPES[chargeTid]?.attrs?.volume ?? TYPES[chargeTid]?.a?.['161'] ?? 1) : 1;
      maxChargesVal = modCapacity > 0 && chargeVol > 0 ? Math.floor(modCapacity / chargeVol) : undefined;
    }
    slots[secKey][idx]={...slots[secKey][idx],name:mod.name,typeID:mod.typeID,icon:null,type:modType,state,ammo:mod.charge,charges:maxChargesVal,maxCharges:maxChargesVal,optimal:modInfo?.optimal??undefined,falloff:modInfo?.falloff??undefined,tracking:modInfo?.tracking??undefined,mutaplasmid:mod.mutaplasmid??undefined,mutations:mod.mutations??undefined};
    counters[secKey]++;
  }
  return slots;
}

// ── Ammo/charges ───────────────────────────────────────────────────
const MODULE_VARS={
  "Neutron Blaster Cannon II":[{name:"Neutron Blaster Cannon I",meta:"T1"},{name:"Neutron Blaster Cannon II",meta:"T2"},{name:"'Arbalest' Neutron Blaster I",meta:"Named"},{name:"Dread Guristas Neutron Blaster",meta:"Faction"}],
  "Caldari Navy X-Large Shield Booster":[{name:"X-Large Shield Booster I",meta:"T1"},{name:"X-Large Shield Booster II",meta:"T2"},{name:"Caldari Navy X-Large Shield Booster",meta:"Faction"},{name:"Pith A-Type X-Large Shield Booster",meta:"Officer"}],
  "Magnetic Field Stabilizer II":[{name:"Magnetic Field Stabilizer I",meta:"T1"},{name:"Magnetic Field Stabilizer II",meta:"T2"},{name:"Federation Navy Magnetic Field Stabilizer",meta:"Faction"}],
};
const DMG_COLOR={EM:DMG.em.color,Thermal:DMG.th.color,Kinetic:DMG.kin.color,Explosive:DMG.exp.color};

// ── Implant data ───────────────────────────────────────────────────
const BOOSTER_DRUGS=[
  {name:"Blue Pill",effect:"Shield Boost Amount",icon:"💙",color:C.mid,variants:[{grade:"Synth",boost:"+10%",sideEffects:false},{grade:"Standard",boost:"+15%",sideEffects:true},{grade:"Improved",boost:"+20%",sideEffects:true},{grade:"Strong",boost:"+25%",sideEffects:true}]},
  {name:"Crash",effect:"Armor Repair Amount",icon:"🟠",color:C.warning,variants:[{grade:"Synth",boost:"+10%",sideEffects:false},{grade:"Standard",boost:"+15%",sideEffects:true},{grade:"Improved",boost:"+20%",sideEffects:true},{grade:"Strong",boost:"+25%",sideEffects:true}]},
  {name:"Drop",effect:"Armor HP",icon:"🟤",color:"#b45309",variants:[{grade:"Synth",boost:"+3%",sideEffects:false},{grade:"Standard",boost:"+4%",sideEffects:true},{grade:"Improved",boost:"+6%",sideEffects:true},{grade:"Strong",boost:"+8%",sideEffects:true}]},
  {name:"Exile",effect:"Armor Rep (Self-Only)",icon:"💚",color:C.rig,variants:[{grade:"Synth",boost:"+10%",sideEffects:false},{grade:"Standard",boost:"+15%",sideEffects:true},{grade:"Improved",boost:"+20%",sideEffects:true},{grade:"Strong",boost:"+25%",sideEffects:true}]},
  {name:"Mindflood",effect:"Capacitor Capacity",icon:"GJ",color:C.warning,variants:[{grade:"Synth",boost:"+5%",sideEffects:false},{grade:"Standard",boost:"+8%",sideEffects:true},{grade:"Improved",boost:"+12%",sideEffects:true},{grade:"Strong",boost:"+16%",sideEffects:true}]},
  {name:"Sooth Sayer",effect:"Shield HP",icon:"🔷",color:C.mid,variants:[{grade:"Synth",boost:"+3%",sideEffects:false},{grade:"Standard",boost:"+4%",sideEffects:true},{grade:"Improved",boost:"+6%",sideEffects:true},{grade:"Strong",boost:"+8%",sideEffects:true}]},
  {name:"X-Instinct",effect:"Signature Radius",icon:"🟢",color:C.rig,variants:[{grade:"Synth",boost:"-1.5%",sideEffects:false},{grade:"Standard",boost:"-2%",sideEffects:true},{grade:"Improved",boost:"-3%",sideEffects:true},{grade:"Strong",boost:"-4%",sideEffects:true}]},
  {name:"Frentix",effect:"Turret Optimal and Falloff",icon:"🔴",color:C.danger,variants:[{grade:"Synth",boost:"+5%",sideEffects:false},{grade:"Standard",boost:"+8%",sideEffects:true},{grade:"Improved",boost:"+12%",sideEffects:true},{grade:"Strong",boost:"+16%",sideEffects:true}]},
  {name:"Pyrolancea",effect:"Damage (All Types)",icon:"🔥",color:C.danger,variants:[{grade:"Synth",boost:"+3%",sideEffects:false},{grade:"Standard",boost:"+5%",sideEffects:true},{grade:"Improved",boost:"+7%",sideEffects:true},{grade:"Strong",boost:"+9%",sideEffects:true}]},
];

// ── EFT-import lookup helpers ──────────────────────────────────────
const BOOSTER_NAME_SET=new Set(Object.values(BOOSTER_DATA).flatMap(s=>Object.values(s).flat()));
// Agency 'X' YYn boosters (Overclocker SB7, Hardshell TB5, Pyrolancea DB3, etc.) aren't enumerated.
const AGENCY_BOOSTER_RE=/^Agency '/;
// Data-driven fallback: anything in the "Booster" group (303) is a booster, regardless of name.
// Catches seasonal/faction drugs (Republic Mobility, Federation Hardpoint, …) the name list omits.
// Implants share category 20 but sit in other groups, so group 303 cleanly excludes them.
const BOOSTER_GROUP_ID=303;
const isBoosterName=n=>{
  if(BOOSTER_NAME_SET.has(n)||AGENCY_BOOSTER_RE.test(n))return true;
  const t=tidByName(n);
  const g=t?(TYPES[t]?.g??TYPES[t]?.group??TYPES[t]?.groupID):null;
  return g===BOOSTER_GROUP_ID;
};
const IMPLANT_NAME_TO_SLOT=(()=>{const m=new Map();
  for(const dict of[ATTRIBUTE_IMPLANTS,HARDWIRING_IMPLANTS]){
    for(const[slotStr,sets]of Object.entries(dict)){
      const slot=parseInt(slotStr,10);
      for(const names of Object.values(sets))for(const n of names)m.set(n,slot);
    }
  }
  return m;})();

// ── Drone / cargo browser data ─────────────────────────────────────
const FIGHTER_CATALOG={"Light":{"Amarr":[{"name":"Equite I","tier":"T1","typeID":40358},{"name":"Templar I","tier":"T1","typeID":23055},{"name":"Equite II","tier":"T2","typeID":40552},{"name":"Templar II","tier":"T2","typeID":40556},{"name":"Imperial Navy Equite","tier":"Navy","typeID":83585},{"name":"Imperial Navy Templar","tier":"Navy","typeID":83579}],"Caldari":[{"name":"Dragonfly I","tier":"T1","typeID":23057},{"name":"Locust I","tier":"T1","typeID":40359},{"name":"Dragonfly II","tier":"T2","typeID":40557},{"name":"Locust II","tier":"T2","typeID":40554},{"name":"Caldari Navy Dragonfly","tier":"Navy","typeID":83582},{"name":"Caldari Navy Locust","tier":"Navy","typeID":83586}],"Gallente":[{"name":"Firbolg I","tier":"T1","typeID":23059},{"name":"Satyr I","tier":"T1","typeID":40360},{"name":"Firbolg II","tier":"T2","typeID":40558},{"name":"Satyr II","tier":"T2","typeID":40555},{"name":"Federation Navy Firbolg","tier":"Navy","typeID":83583},{"name":"Federation Navy Satyr","tier":"Navy","typeID":83587}],"Minmatar":[{"name":"Einherji I","tier":"T1","typeID":23061},{"name":"Gram I","tier":"T1","typeID":40361},{"name":"Einherji II","tier":"T2","typeID":40559},{"name":"Gram II","tier":"T2","typeID":40553},{"name":"Republic Fleet Einherji","tier":"Navy","typeID":83584},{"name":"Republic Fleet Gram","tier":"Navy","typeID":83589}]},"Heavy":{"Faction":[{"name":"Shadow","tier":"Navy","typeID":2948}],"Gallente":[{"name":"Antaeus I","tier":"T1","typeID":40364},{"name":"Cyclops I","tier":"T1","typeID":32325},{"name":"Antaeus II","tier":"T2","typeID":40562},{"name":"Cyclops II","tier":"T2","typeID":40563}],"Amarr":[{"name":"Ametat I","tier":"T1","typeID":40362},{"name":"Malleus I","tier":"T1","typeID":32340},{"name":"Ametat II","tier":"T2","typeID":40560},{"name":"Malleus II","tier":"T2","typeID":40561}],"Minmatar":[{"name":"Gungnir I","tier":"T1","typeID":40365},{"name":"Tyrfing I","tier":"T1","typeID":32342},{"name":"Gungnir II","tier":"T2","typeID":40564},{"name":"Tyrfing II","tier":"T2","typeID":40565}],"Caldari":[{"name":"Mantis I","tier":"T1","typeID":32344},{"name":"Termite I","tier":"T1","typeID":40363},{"name":"Mantis II","tier":"T2","typeID":40567},{"name":"Termite II","tier":"T2","typeID":40566}]},"Support":{"Amarr":[{"name":"Cenobite I","tier":"T1","typeID":37599},{"name":"Cenobite II","tier":"T2","typeID":40568},{"name":"Imperial Navy Cenobite","tier":"Navy","typeID":83591}],"Caldari":[{"name":"Scarab I","tier":"T1","typeID":40345},{"name":"Scarab II","tier":"T2","typeID":40569},{"name":"Caldari Navy Scarab","tier":"Navy","typeID":83592}],"Gallente":[{"name":"Siren I","tier":"T1","typeID":40346},{"name":"Siren II","tier":"T2","typeID":40570},{"name":"Federation Navy Siren","tier":"Navy","typeID":83593}],"Minmatar":[{"name":"Dromi I","tier":"T1","typeID":40347},{"name":"Dromi II","tier":"T2","typeID":40571},{"name":"Republic Fleet Dromi","tier":"Navy","typeID":83594}]}};
const CARGO_BROWSER={
  "Ammunition and Charges":[{name:"Antimatter Charge L",vol:0.025,priceM:0.0012,icon:"💊"},{name:"Void L",vol:0.025,priceM:0.0028,icon:"💊"},{name:"Null L",vol:0.025,priceM:0.0024,icon:"💊"},{name:"Cap Booster 400",vol:3.0,priceM:0.8,icon:"GJ"},{name:"Cap Booster 800",vol:6.0,priceM:1.6,icon:"GJ"},{name:"Navy Cap Booster 800",vol:6.0,priceM:4.2,icon:"GJ"}],
  "Consumables":[{name:"Nanite Repair Paste",vol:0.1,priceM:0.55,icon:"🔬"},{name:"Agency 'Overclocker' SB5",vol:0.1,priceM:0.20,icon:"🧪"},{name:"Synth Mindflood Booster",vol:0.1,priceM:0.50,icon:"💊"}],
  "Salvage":[{name:"Armor Plates",vol:0.5,priceM:0.015,icon:"🔩"},{name:"Burned Logic Circuit",vol:0.1,priceM:0.008,icon:"🔩"},{name:"Contaminated Nanite Compound",vol:0.1,priceM:0.025,icon:"🔩"}],
  "Minerals":[{name:"Tritanium",vol:0.01,priceM:0.000005,icon:"📦"},{name:"Mexallon",vol:0.01,priceM:0.00006,icon:"📦"},{name:"Zydrine",vol:0.01,priceM:0.0004,icon:"📦"},{name:"Megacyte",vol:0.01,priceM:0.006,icon:"📦"}],
  "Mobile Structures":[{name:"Mobile Depot",vol:50,priceM:1.2,icon:"🏗"},{name:"Mobile Tractor Unit",vol:100,priceM:6,icon:"🏗"}],
};

// ── Target profile stats for graph ────────────────────────────────
// Display units for warfare buff types (buffID → unit suffix). Most are percentages.
const WARFARE_BUFF_UNIT={3:" GJ/s",17:" m/s"};

// ═══ SDE DATA BUILDERS ═══════════════════════════════════════════
function buildMGChildren(){
  const map={};
  for(const[idStr,mg]of Object.entries(marketGroupsData)){
    const pk=String(mg.parent??"__root__");
    if(!map[pk])map[pk]=[];
    map[pk].push({id:Number(idStr),name:mg.name});
  }
  return map;
}
const MG_CHILDREN=buildMGChildren();
const MG_HIDDEN=new Set([685,681,1639]);
const SLOT_ROOT={high:9,mid:9,low:9,rigs:1111};

function buildModuleBrowser(slotType){
  const mods=Object.values(modulesData).filter(m=>m.slot===slotType);
  const metaOrder={T1:0,T2:1,Storyline:2,Faction:3,Deadspace:4,Officer:5,Abyssal:6};
  const byMG={};
  for(const m of mods){
    if(!byMG[m.marketGroupID])byMG[m.marketGroupID]=[];
    byMG[m.marketGroupID].push(m);
  }
  for(const k of Object.keys(byMG)){
    // sort by the authoritative meta group (bundle's own meta string is unreliable)
    byMG[k].sort((a,b)=>(META_ORDER[metaOf(a.typeID,a.meta)]??99)-(META_ORDER[metaOf(b.typeID,b.meta)]??99)||a.name.localeCompare(b.name));
  }
  function buildNode(mgId){
    if(MG_HIDDEN.has(mgId))return null;
    const children=(MG_CHILDREN[String(mgId)]??[]).sort((a,b)=>a.name.localeCompare(b.name)).map(c=>buildNode(c.id)).filter(Boolean);
    const mods=byMG[mgId]??[];
    if(children.length===0&&mods.length===0)return null;
    return{id:mgId,name:marketGroupsData[String(mgId)]?.name??"",children,mods:mods.map(m=>({name:m.name,meta:m.meta,cpu:m.cpu,pg:m.pg,typeID:m.typeID}))};
  }
  const rootId=SLOT_ROOT[slotType]??9;
  return(MG_CHILDREN[String(rootId)]??[]).sort((a,b)=>a.name.localeCompare(b.name)).map(c=>buildNode(c.id)).filter(Boolean);
}

function buildChargeBrowser(){
  const byCategory={};
  for(const c of Object.values(chargesData)){
    if(!byCategory[c.category])byCategory[c.category]=[];
    byCategory[c.category].push(c);
  }
  return Object.fromEntries(Object.entries(byCategory).sort(([a],[b])=>a.localeCompare(b)).map(([cat,items])=>[cat,items.sort((a,b)=>a.name.localeCompare(b.name))]));
}

// Complete charge index built from TYPES (category 8 = Charge). charges.json is missing many
// T2/faction/script charges, so we index the authoritative dogma data instead: groupID → [charges].
const CHARGES_BY_GROUP=(()=>{
  const m=new Map();
  for(const[tid,t]of Object.entries(TYPES)){
    if((t.c??t.category)!==8)continue; // Charge category
    const gid=t.g??t.groupID;
    if(gid==null)continue;
    const a=t.attrs??t.a??{};
    const entry={typeID:Number(tid),name:t.n??t.name,groupID:gid,
      chargeSize:(a.chargeSize??a['128']??null),
      volume:(a.volume??a['161']??null),
      meta:(a.metaLevel??a['633']??0),
      // display fields for the ammo browser:
      em:(a.emDamage??a['114']??0),th:(a.thermalDamage??a['118']??0),
      kin:(a.kineticDamage??a['117']??0),exp:(a.explosiveDamage??a['116']??0),
      capBonus:(a.capacitorBonus??a['67']??null)};
    if(!m.has(gid))m.set(gid,[]);
    m.get(gid).push(entry);
  }
  for(const arr of m.values())arr.sort((a,b)=>a.name.localeCompare(b.name));
  return m;
})();

function getCompatibleCharges(mod){
  // Read charge groups from authoritative TYPES dogma data (chargeGroup1-6, attrs 604-606/609/610/1389).
  const td=mod.typeID?(TYPES[mod.typeID]??TYPES[String(mod.typeID)]):
    Object.entries(TYPES).find(([,t])=>(t.n??t.name)===mod.name)?.[1];
  if(!td)return [];
  const a=td.attrs??td.a??{};
  const CG_KEYS=[['604','chargeGroup1'],['605','chargeGroup2'],['606','chargeGroup3'],
                 ['609','chargeGroup4'],['610','chargeGroup5'],['1389','chargeGroup6']];
  const chargeGroups=CG_KEYS.map(([id,nm])=>a[id]??a[nm]).filter(v=>v&&v>0).map(Number);
  if(chargeGroups.length===0)return [];
  const chargeSize=a['128']??a.chargeSize??null;
  const out=[];
  for(const gid of chargeGroups){
    for(const c of (CHARGES_BY_GROUP.get(gid)??[])){
      // chargeSize filter: skip only if both sides specify a size and they differ
      if(chargeSize!=null && c.chargeSize!=null && c.chargeSize!==chargeSize)continue;
      out.push(c);
    }
  }
  // dedupe by typeID, sort by name
  const seen=new Set();
  return out.filter(c=>seen.has(c.typeID)?false:(seen.add(c.typeID),true))
            .sort((x,y)=>x.name.localeCompare(y.name));
}

// True if a module accepts charges (reads chargeGroup1-6 from authoritative TYPES data).
// Used for module classification and charge-tab gating so any chargeable module works going forward.
function moduleTakesCharges(typeID,name){
  const td=typeID?(TYPES[typeID]??TYPES[String(typeID)]):
    Object.entries(TYPES).find(([,t])=>(t.n??t.name)===name)?.[1];
  if(!td)return false;
  const a=td.attrs??td.a??{};
  return [['604','chargeGroup1'],['605','chargeGroup2'],['606','chargeGroup3'],
          ['609','chargeGroup4'],['610','chargeGroup5'],['1389','chargeGroup6']]
    .some(([id,nm])=>(a[id]??a[nm])>0);
}

const TOP_DRONE_ORDER=["Combat Drones","Combat Utility Drones","Electronic Warfare Drones","Logistics Drones","Mining Drones","Salvage Drones"];
function getMGPath(mgID){
  const chain=[];let cur=Number(mgID);const visited=new Set();
  while(cur&&marketGroupsData[cur]&&!visited.has(cur)){visited.add(cur);chain.unshift(marketGroupsData[cur].name);cur=marketGroupsData[cur].parent;}
  return chain;
}
function buildDroneBrowser(){
  const metaOrder={T1:0,T2:1,Storyline:2,Faction:3,Deadspace:4,Officer:5,Abyssal:6};
  const sortFn=arr=>[...arr].sort((a,b)=>(META_ORDER[metaOf(a.typeID,a.meta)]??99)-(META_ORDER[metaOf(b.typeID,b.meta)]??99)||a.name.localeCompare(b.name));
  const tree={};
  for(const d of Object.values(dronesData)){
    const path=getMGPath(d.marketGroupID);
    const top=path.length>=2?path[1]:path[0]??"Other";
    const sub=path.length>=3?path[2]:null;
    if(!tree[top])tree[top]={};
    const key=sub??"__flat__";
    if(!tree[top][key])tree[top][key]=[];
    tree[top][key].push(d);
  }
  const result=[];const seen=new Set();
  for(const topGroup of TOP_DRONE_ORDER){
    if(!tree[topGroup])continue;seen.add(topGroup);
    const subMap=tree[topGroup];
    const subKeys=Object.keys(subMap).filter(k=>k!=="__flat__").sort((a,b)=>a.localeCompare(b));
    if(subKeys.length>0){
      const subGroups=subKeys.map(name=>({name,drones:sortFn(subMap[name])}));
      if(subMap["__flat__"]?.length)subGroups.push({name:"Other",drones:sortFn(subMap["__flat__"])});
      result.push({topGroup,subGroups});
    }else{
      result.push({topGroup,drones:sortFn(Object.values(subMap).flat())});
    }
  }
  for(const[topGroup,subMap]of Object.entries(tree)){
    if(seen.has(topGroup))continue;
    result.push({topGroup,drones:sortFn(Object.values(subMap).flat())});
  }
  return result;
}
const REAL_CHARGE_BROWSER=buildChargeBrowser();
const REAL_DRONE_BROWSER=buildDroneBrowser();
const REAL_MODULE_BROWSER={high:buildModuleBrowser("high"),mid:buildModuleBrowser("mid"),low:buildModuleBrowser("low"),rigs:buildModuleBrowser("rigs")};

// ═══ BOTTOM SHEET ════════════════════════════════════════════════
function BottomSheet({title,onClose,children,height="70vh"}){
  return(
    <div style={{position:"fixed",inset:0,zIndex:200,display:"flex",flexDirection:"column",justifyContent:"flex-end",alignItems:"center"}}>
      <div onClick={onClose} style={{position:"absolute",inset:0,background:"rgba(0,0,0,.65)"}}/>
      <div style={{position:"relative",width:"100%",maxWidth:430,background:C.surface,borderRadius:"16px 16px 0 0",maxHeight:height,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{width:36,height:4,background:C.border,borderRadius:99,margin:"10px auto 0"}}/>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderBottom:`1px solid ${C.border}`}}>
          <span style={{fontSize:14,fontWeight:700,color:C.text}}>{title}</span>
          <button onClick={onClose} style={{background:"none",border:"none",color:C.textMid,fontSize:20,cursor:"pointer",padding:"0 4px",lineHeight:1}}>x</button>
        </div>
        <div style={{flex:1,overflowY:"auto"}}>{children}</div>
      </div>
    </div>
  );
}
function AccordionSection({title,color,children,defaultOpen,indent}){
  const[open,setOpen]=useState(!!defaultOpen);
  return(
    <div style={{borderBottom:`1px solid ${C.border}`}}>
      <button onClick={()=>setOpen(o=>!o)} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:indent?"8px 14px 8px 22px":"11px 14px",background:indent?`${C.surfaceAlt}88`:"none",border:"none",cursor:"pointer"}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {color&&<div style={{width:8,height:8,borderRadius:99,background:color}}/>}
          <span style={{fontSize:indent?12:13,fontWeight:700,color:indent?C.textMid:C.text}}>{title}</span>
        </div>
        <span style={{color:C.textMute,fontSize:12}}>{open?"^":"v"}</span>
      </button>
      {open&&<div style={{paddingBottom:indent?2:8}}>{children}</div>}
    </div>
  );
}
function NumpadModal({label,initial,onConfirm,onClose}){
  const[val,setVal]=useState(String(initial));
  const press=d=>{if(d==="<")setVal(v=>v.length>1?v.slice(0,-1):"0");else if(d==="0"&&val==="0")return;else setVal(v=>v==="0"?d:v.length<9?v+d:v);};
  return(
    <BottomSheet title={`Set quantity - ${label}`} onClose={onClose} height="62vh">
      <div style={{padding:16}}>
        <div style={{fontSize:32,fontWeight:800,color:C.text,textAlign:"center",marginBottom:16,background:C.surfaceAlt,borderRadius:10,padding:"10px 0"}}>{Number(val).toLocaleString()}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:8}}>
          {["1","2","3","4","5","6","7","8","9","0","000","<"].map(d=>(
            <button key={d} onClick={()=>press(d)} style={{padding:"16px 0",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:10,color:C.text,fontSize:20,fontWeight:700,cursor:"pointer"}}>{d}</button>
          ))}
        </div>
        <button onClick={()=>{onConfirm(Number(val)||0);onClose();}} style={{width:"100%",padding:"12px 0",background:C.accent,border:"none",borderRadius:10,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>Confirm</button>
      </div>
    </BottomSheet>
  );
}

// ═══ RESOURCE STRIP ══════════════════════════════════════════════
function ResourceStrip({ship,slots,skills,implants,boosters,drones,factorInReload}){
  const cs=calcFitStats(ship,slots,drones??[],skills,{implants,boosters,factorInReload})??{};
  // Readout mode: tap any row to swap between "used / total" and remaining ("x left" / "x over").
  const[showRemaining,setShowRemaining]=useState(false);
  const fmtRes=v=>Number((v??0).toFixed(2)).toLocaleString();
  const resources=[
    {key:"cpu",label:"CPU",   used:cs.cpuUsed??0,  total:cs.cpuTotal??0,  unit:"tf",  warn:95},
    {key:"pg", label:"PG",    used:cs.pgUsed??0,   total:cs.pgTotal??0,   unit:"MW",  warn:95},
    {key:"cal",label:"Cal",   used:cs.calUsed??0,  total:cs.calTotal??400, unit:"pts", warn:95},
  ];
  // Hardpoint usage
  const turretsUsed=[...(slots?.high??[])].filter(s=>s.type!=="empty"&&Object.values(modulesData).find(m=>m.name===s.name)?.groupName==="Hybrid Weapon"||Object.values(modulesData).find(m=>m.name===s.name)?.groupName==="Energy Weapon"||Object.values(modulesData).find(m=>m.name===s.name)?.groupName==="Projectile Weapon").length;
  const launchUsed=[...(slots?.high??[])].filter(s=>s.type!=="empty"&&(Object.values(modulesData).find(m=>m.name===s.name)?.groupName??'').includes("Missile Launcher")).length;
  const turretsTotal=ship?.turrets??0, launchTotal=ship?.launchers??0;

  return(
    <div style={{background:C.surfaceAlt,borderRadius:10,border:`1px solid ${C.border}`,padding:"10px 12px",margin:"10px 10px 4px"}}>
      {/* Hardpoints */}
      {(turretsTotal>0||launchTotal>0)&&<div style={{display:"flex",gap:12,marginBottom:8,paddingBottom:8,borderBottom:`1px solid ${C.border}`}}>
        {turretsTotal>0&&<div style={{display:"flex",alignItems:"center",gap:4}}>
          <span style={{fontSize:10,color:C.high,fontWeight:700}}>T</span>
          <div style={{display:"flex",gap:2}}>{Array.from({length:turretsTotal},(_,i)=><div key={i} style={{width:8,height:8,borderRadius:2,background:(turretsUsed>i)?C.high:`${C.high}30`}}/>)}</div>
          <span style={{fontSize:10,color:C.textMute}}>{turretsUsed}/{turretsTotal}</span>
        </div>}
        {launchTotal>0&&<div style={{display:"flex",alignItems:"center",gap:4}}>
          <span style={{fontSize:10,color:C.mid,fontWeight:700}}>L</span>
          <div style={{display:"flex",gap:2}}>{Array.from({length:launchTotal},(_,i)=><div key={i} style={{width:8,height:8,borderRadius:2,background:(launchUsed>i)?C.mid:`${C.mid}30`}}/>)}</div>
          <span style={{fontSize:10,color:C.textMute}}>{launchUsed}/{launchTotal}</span>
        </div>}
      </div>}
      {resources.map((res,i)=>{
        const rawPct=res.total>0?(res.used/res.total)*100:0;
        const isOver=rawPct>100;
        const isCalRig=res.key==='cal';
        // Green under 100%, yellow→red when over. Cal: instantly red when over.
        const overFactor=isCalRig?1:Math.min((rawPct-100)/10,1);  // 0=just over, 1=fully red at 110%
        const barColor=isOver
          ? (isCalRig ? C.danger : `hsl(${Math.round(40*(1-overFactor))},85%,48%)`)  // 40°yellow→0°red
          : '#4ade80';  // green while under max
        const pct=Math.min(rawPct,100);
        const crit=isOver;
        return(
          <div key={res.key} onClick={()=>setShowRemaining(v=>!v)} title={showRemaining?"Tap for used / total":"Tap for remaining"}
               style={{marginBottom:(resources.length-1>i)?8:0,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
              <span style={{fontSize:11,fontWeight:600,color:C.textMid}}>{res.label}</span>
              {showRemaining
                ? (()=>{ const rem=(res.total??0)-(res.used??0); const over=rem<0;
                    return(<span style={{fontSize:10}}>
                      <span style={{fontWeight:700,color:over?C.danger:C.textMid}}>{fmtRes(Math.abs(rem))}</span>
                      <span style={{color:over?C.danger:C.textMute}}> {res.unit} {over?"over":"left"}</span>
                    </span>);
                  })()
                : <span style={{fontSize:10}}><span style={{fontWeight:700,color:crit?C.danger:C.textMid}}>{res.used.toLocaleString()}</span><span style={{color:C.textMute}}> / {res.total.toLocaleString()} {res.unit}</span>{crit&&<span style={{color:C.danger,marginLeft:4}}>!</span>}</span>}
            </div>
            <div style={{height:5,background:C.border,borderRadius:99,overflow:"hidden"}}><div style={{width:`${Math.min(rawPct,110)}%`,maxWidth:'100%',height:"100%",background:barColor,borderRadius:99}}/></div>
          </div>
        );
      })}
    </div>
  );
}

// ═══ MODULE BROWSER - drill-down navigation ══════════════════════
function SubsystemPickerSheet({ship,slotId,current,onSelect,onClose}){
  // Determine which subsystem group this slot is for (Core/Defensive/Offensive/Propulsion).
  const order=["Core","Defensive","Offensive","Propulsion"];
  const slotIdx=Number(String(slotId).replace(/\D/g,""))||0;
  const group=current?.subGroup??order[slotIdx]??"Core";
  const byGroup=subsystemsForHull(ship?.name);
  const options=byGroup[group]??[];
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:200,display:"flex",alignItems:"flex-end"}}>
      <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxHeight:"70vh",background:C.bg,borderTopLeftRadius:16,borderTopRightRadius:16,overflow:"hidden",display:"flex",flexDirection:"column"}}>
        <div style={{padding:"14px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{fontSize:14,fontWeight:700,color:C.text}}>{group} Subsystem</span>
          <button onClick={onClose} style={{background:"none",border:"none",color:C.textMute,fontSize:18,cursor:"pointer"}}>×</button>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:12}}>
          {options.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"24px 0",fontSize:13}}>No subsystems found</div>}
          {options.map(opt=>{
            const on=current?.typeID===opt.typeID;
            const shortName=opt.name.replace(`${ship?.name} ${group} - `,"");
            return(<div key={opt.typeID} onClick={()=>onSelect(opt)} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 12px",background:on?C.accentLight:C.surface,border:`1px solid ${on?C.accent:C.border}`,borderRadius:8,marginBottom:6,cursor:"pointer"}}>
              <img className="eve-icon" src={eveIcon(opt.typeID,32)} width={30} height={30} alt="" onError={e=>{e.target.style.display="none";}}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600,color:on?C.accent:C.text}}>{shortName}</div>
                <div style={{fontSize:10,color:C.textMute}}>{group} Subsystem</div>
              </div>
              {on&&<span style={{fontSize:11,color:C.accent,fontWeight:700}}>✓</span>}
            </div>);
          })}
        </div>
      </div>
    </div>
  );
}

function ModuleBrowserSheet({slotType,onSelect,onClose}){
  const[search,setSearch]=useState("");
  const[pasteOpen,setPasteOpen]=useState(false);
  const[pasteText,setPasteText]=useState("");
  const[pasteErr,setPasteErr]=useState(null);
  const doPaste=()=>{const parsed=parseAbyssal(pasteText);if(!parsed){setPasteErr("Could not parse. Expected: module name, then mutaplasmid name, then attr value pairs.");return;}onSelect(parsed);onClose();};
  const[navPath,setNavPath]=useState([]);
  const metaColor={T1:C.textMid,T2:C.accent,Storyline:C.warning,Faction:C.danger,Deadspace:"#f0abfc",Officer:"#f0abfc",Abyssal:C.high};
  const tree=REAL_MODULE_BROWSER[slotType]??[];

  const currentLevel=(()=>{
    let nodes=tree,currentNode=null;
    for(const id of navPath){
      currentNode=nodes.find(n=>n.id===id);
      if(!currentNode)return{nodes:[],mods:[]};
      nodes=currentNode.children;
    }
    return{nodes,mods:currentNode?.mods??[]};
  })();

  const countAll=n=>n.mods.length+n.children.reduce((s,c)=>s+countAll(c),0);

  const allMods=(()=>{
    const out=[];
    function collect(n){n.mods.forEach(m=>out.push(m));n.children.forEach(collect);}
    tree.forEach(collect);
    return out;
  })();
  const searchResults=search.trim().length>1?allMods.filter(m=>m.name.toLowerCase().includes(search.toLowerCase())).slice(0,60):null;

  const breadcrumb=(()=>{
    let nodes=tree,parts=[];
    for(const id of navPath){const n=nodes.find(n=>n.id===id);if(!n)break;parts.push(n.name);nodes=n.children;}
    return parts;
  })();

  function ModRow({mod}){
    const rowMeta=metaOf(mod.typeID,mod.meta);
    return(
      <div onClick={()=>{onSelect(mod);onClose();}} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",cursor:"pointer",borderBottom:`1px solid ${C.border}`}}>
        <div style={{flex:1,minWidth:0,display:"flex",alignItems:"center",gap:10}}>
          {mod.typeID&&<img className="eve-icon" src={eveIcon(mod.typeID,32)} width={28} height={28} alt="" onError={e=>{e.target.style.display="none";}}/>}
          <div style={{minWidth:0}}>
            <div style={{fontSize:14,fontWeight:500,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{mod.name}</div>
            {(mod.cpu>0||mod.pg>0)&&<div style={{fontSize:11,color:C.textMute,marginTop:1}}>{mod.cpu>0?`CPU ${mod.cpu} tf`:""}{mod.cpu>0&&mod.pg>0?" / ":""}{mod.pg>0?`PG ${mod.pg} MW`:""}</div>}
          </div>
        </div>
        <span style={{fontSize:11,color:META_COLORS[rowMeta]||C.textMute,background:C.border,borderRadius:99,padding:"2px 8px",fontWeight:700,flexShrink:0,marginLeft:10}}>{rowMeta}</span>
      </div>
    );
  }

  return(
    <BottomSheet title={`Add Module - ${slotType.charAt(0).toUpperCase()+slotType.slice(1)} Slot`} onClose={onClose} height="88vh">
      <div style={{padding:"8px 14px",borderBottom:`1px solid ${C.border}`}}>
        <div style={{display:"flex",alignItems:"center",gap:8,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px"}}>
          <span style={{fontSize:16,color:C.textMute}}>&#128269;</span>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search all modules..." style={{flex:1,background:"none",border:"none",color:C.text,fontSize:14}}/>
          {search&&<button onClick={()=>setSearch("")} style={{background:"none",border:"none",color:C.textMute,cursor:"pointer",fontSize:18,padding:0}}>x</button>}
        </div>
        <button onClick={()=>{setPasteOpen(o=>!o);setPasteErr(null);}} style={{marginTop:8,width:"100%",padding:"7px 0",background:pasteOpen?C.high+"22":C.surfaceAlt,border:`1px solid ${pasteOpen?C.high:C.border}`,borderRadius:8,color:pasteOpen?C.high:C.textMid,fontSize:11,fontWeight:700,cursor:"pointer"}}>⎘ Paste Abyssal Module</button>
        {pasteOpen&&<div style={{marginTop:8}}>
          <textarea value={pasteText} onChange={e=>{setPasteText(e.target.value);setPasteErr(null);}} placeholder={"Corpum B-Type Medium Energy Neutralizer\nUnstable Medium Energy Neutralizer Mutaplasmid\ncapacitorNeed 172.68, cpu 22.93, ..."} rows={4} style={{width:"100%",boxSizing:"border-box",background:C.surface,border:`1px solid ${pasteErr?C.danger:C.border}`,borderRadius:8,color:C.text,fontSize:11,padding:"8px 10px",fontFamily:"monospace",resize:"vertical"}}/>
          {pasteErr&&<div style={{fontSize:10,color:C.danger,marginTop:4}}>{pasteErr}</div>}
          <button onClick={doPaste} disabled={!pasteText.trim()} style={{marginTop:6,width:"100%",padding:"8px 0",background:pasteText.trim()?C.accent:C.surfaceAlt,border:"none",borderRadius:8,color:pasteText.trim()?"#fff":C.textMute,fontSize:12,fontWeight:700,cursor:pasteText.trim()?"pointer":"default"}}>Add to Fit</button>
        </div>}
      </div>
      {!searchResults&&navPath.length>0&&(
        <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderBottom:`1px solid ${C.border}`,background:C.surfaceAlt}}>
          <button onClick={()=>setNavPath(navPath.slice(0,-1))} style={{background:"none",border:"none",color:C.accent,fontSize:14,fontWeight:700,cursor:"pointer",padding:0}}>Back</button>
          <span style={{fontSize:12,color:C.textMute,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{breadcrumb.join(" / ")}</span>
        </div>
      )}
      {searchResults?(
        <div>
          {searchResults.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"32px 0",fontSize:14}}>No modules found</div>}
          {searchResults.map(mod=><ModRow key={mod.typeID??mod.name} mod={mod}/>)}
        </div>
      ):(
        <div>
          {currentLevel.mods.map(mod=><ModRow key={mod.typeID??mod.name} mod={mod}/>)}
          {currentLevel.nodes.map(node=>(
            <div key={node.id} onClick={()=>setNavPath([...navPath,node.id])} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px",cursor:"pointer",borderBottom:`1px solid ${C.border}`}}>
              <div>
                <div style={{fontSize:14,fontWeight:600,color:C.text}}>{node.name}</div>
                <div style={{fontSize:11,color:C.textMute,marginTop:2}}>{countAll(node)} modules</div>
              </div>
              <span style={{fontSize:20,color:C.textMute}}>{">"}</span>
            </div>
          ))}
          {currentLevel.nodes.length===0&&currentLevel.mods.length===0&&(
            <div style={{textAlign:"center",color:C.textMute,padding:"32px 0",fontSize:14}}>No modules for this slot type</div>
          )}
        </div>
      )}
    </BottomSheet>
  );
}

// ═══ MODULE MENU SHEET ═══════════════════════════════════════════
// Attribute formatting for the Info tab
const ATTR_UNIT = {
  cpu:' tf', power:' MW', cpuOutput:' tf', powerOutput:' MW',
  capacitorNeed:' GJ', capacitorBonus:' GJ', capacitorCapacity:' GJ', upgradeCost:' pts',
  maxRange:' m', falloff:' m', trackingSpeed:' rad/s', overloadRangeBonus:' %',
  hp:' HP', armorHP:' HP', shieldCapacity:' HP', shieldBonus:' HP',
  speed:' ms', duration:' ms', reloadTime:' ms',
  maxVelocity:' m/s', mass:' kg', volume:' m³',
  droneBandwidthUsed:' Mbit/s', signatureRadius:' m',
  heatDamage:' HP', damageMultiplier:'×',
  maxTargetRange:' m', scanResolution:' mm',
};
const RESIST_ATTRS = new Set(['armorEmDamageResonance','armorThermalDamageResonance','armorKineticDamageResonance','armorExplosiveDamageResonance','shieldEmDamageResonance','shieldThermalDamageResonance','shieldKineticDamageResonance','shieldExplosiveDamageResonance','hullEmDamageResonance','hullThermalDamageResonance','hullKineticDamageResonance','hullExplosiveDamageResonance']);
const HIDDEN_ATTRS = new Set(['skillPoints','skillTimeConstant','typeColorScheme','canBeJettisoned']);

function fmtAttrVal(name, val) {
  if (RESIST_ATTRS.has(name)) return `${((1-val)*100).toFixed(1)}%`;
  const unit = ATTR_UNIT[name] ?? '';
  const num = typeof val === 'number' ? (Number.isInteger(val) ? val : parseFloat(val.toFixed(4))) : val;
  return `${num}${unit}`;
}
function fmtAttrName(name) {
  // camelCase → Title Case With Spaces
  return name.replace(/([A-Z])/g,' $1').replace(/^./,s=>s.toUpperCase()).trim();
}

function ModuleInfoTab({typeID, mod}) {
  if (!typeID) return <div style={{padding:16,color:C.textMute,fontSize:12}}>No module selected</div>;
  const td = TYPES[typeID] ?? TYPES[String(typeID)];
  if (!td) return <div style={{padding:16,color:C.textMute,fontSize:12}}>No data available</div>;
  const attrs = td.attrs ?? td.a ?? {};
  const entries = Object.entries(attrs)
    .filter(([k]) => !HIDDEN_ATTRS.has(k) && typeof attrs[k] === 'number')
    .sort(([a],[b]) => a.localeCompare(b));
  return (
    <div style={{padding:'0 2px'}}>
      {entries.map(([name, val]) => (
        <div key={name} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:`1px solid ${C.border}`}}>
          <span style={{fontSize:11,color:C.textMid,maxWidth:'55%'}}>{fmtAttrName(name)}</span>
          <span style={{fontSize:11,fontWeight:600,color:C.text}}>{fmtAttrVal(name, val)}</span>
        </div>
      ))}
    </div>
  );
}

function ModuleVariationsTab({typeID, currentName, onSwap}) {
  const raw = typeID ? ((moduleVariations??{})[String(typeID)] ?? []) : [];
  // Resolve meta from CCP's metaGroupID rather than the bundle's (wrong) label, then re-sort:
  // the bundle had faction/storyline/deadspace/officer all coming through as "T2".
  const vars = raw.map(v=>({...v, meta: metaOf(v.typeID, v.meta)}))
                  .sort((a,b)=>(META_ORDER[a.meta]??99)-(META_ORDER[b.meta]??99)||a.name.localeCompare(b.name));
  if (!vars.length) return <div style={{padding:16,color:C.textMute,fontSize:12}}>No variation data available.</div>;
  return (
    <div>
      <div style={{fontSize:10,color:C.textMute,padding:'6px 0 8px'}}>Tap a variation to swap — {vars.length} variants</div>
      {vars.map(v => (
        <div key={v.typeID} onClick={()=>v.name!==currentName&&onSwap(v)}
          style={{display:'flex',alignItems:'center',gap:9,padding:'9px 4px',borderBottom:`1px solid ${C.border}`,cursor:v.name===currentName?'default':'pointer',background:v.name===currentName?C.accentLight:'transparent'}}>
          {v.typeID&&<img className="eve-icon" src={eveIcon(v.typeID,32)} width={28} height={28} alt="" onError={e=>{e.target.style.display="none";}}/>}
          <span style={{fontSize:12,color:v.name===currentName?C.accent:C.text,flex:1,minWidth:0}}>{v.name}</span>
          <span style={{fontSize:10,color:META_COLORS[v.meta]??C.textMid,background:`${C.border}88`,borderRadius:99,padding:'1px 7px',fontWeight:700,flexShrink:0}}>{v.meta}</span>
        </div>
      ))}
    </div>
  );
}


// ── Abyssal (mutaplasmid) module support ─────────────────────────────────────
const MUTA_ATTR_LABELS={capacitorNeed:"Activation Cost",cpu:"CPU",power:"Powergrid",maxRange:"Optimal Range",falloff:"Falloff",duration:"Cycle Time",energyNeutralizerAmount:"Neut Amount",speedFactor:"Speed Penalty",maxVelocityBonus:"Max Velocity Bonus",signatureRadiusBonus:"Sig Radius Penalty",signatureRadiusBonusPercent:"Sig Radius Bonus",armorDamageAmount:"Armor Repaired",shieldBonus:"Shield Repaired",reloadTime:"Reload Time",mass:"Mass",armorHpBonus:"Armor HP",shieldCapacityBonus:"Shield HP",massAddition:"Mass Addition",scanResolutionBonus:"Scan Res. Bonus",maxTargetRangeBonus:"Lock Range Bonus",trackingSpeedBonus:"Tracking Bonus",aoeCloudSizeBonus:"Expl. Radius Bonus",aoeVelocityBonus:"Expl. Velocity Bonus",explosionDelayBonus:"Flight Time Bonus",missileVelocityBonus:"Missile Velocity Bonus",warpScrambleRange:"Warp Disrupt Range",thermalDamage:"Thermal Dmg",kineticDamage:"Kinetic Dmg",emDamage:"EM Dmg",explosiveDamage:"Explosive Dmg",damageMultiplier:"Damage Multiplier",armorRepairPerCapacitor:"Rep / Cap",armorRepairPerTime:"Rep / Time"};
const mutaLabel=(name)=>MUTA_ATTR_LABELS[name]??name.replace(/([A-Z])/g," $1").replace(/^./,c=>c.toUpperCase());
const fmtMutaVal=(name,v)=>{ if(v==null) return "—"; if(/Range|maxRange|falloff/i.test(name)) return `${(v/1000).toFixed(2)} km`; if(/duration|reloadTime|explosionDelay/i.test(name)) return `${(v/1000).toFixed(2)} s`; if(/mass/i.test(name)) return `${Math.round(v).toLocaleString()} kg`; const a=Math.abs(v); return a>=100?v.toFixed(1):a>=1?v.toFixed(2):v.toFixed(4); };
// Serialize a mutated module to the standard abyssal paste format.
function abyssalToText(mod){
  const m=mutaplasmidData[mod.mutaplasmid]; if(!m) return mod.name;
  const ranges=mutaAttrRanges(mod.mutaplasmid,mod.typeID);
  const pairs=ranges.map(r=>`${r.name} ${(mod.mutations?.[r.name]??r.base)}`).join(", ");
  return `${TYPES[mod.typeID]?.n??mod.name}\n${m.n}\n${pairs}`;
}
// Parse the abyssal paste format → a module slot object (or null).
function parseAbyssal(text){
  const lines=text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  if(lines.length<3) return null;
  const baseName=lines[0], mutaName=lines[1];
  const baseTid=tidByName(baseName); if(!baseTid) return null;
  const mutaID=MUTA_BY_NAME[mutaName.toLowerCase()]; if(!mutaID) return null;
  const mutations={};
  for(const part of lines.slice(2).join(", ").split(",")){
    const mt=part.trim().match(/^([A-Za-z][A-Za-z0-9]*)\s+(-?[\d.]+)/);
    if(mt) mutations[mt[1]]=Number(mt[2]);
  }
  if(!Object.keys(mutations).length) return null;
  const td=TYPES[baseTid];
  const modType=(td?.c===7)?(/(Rig)/i.test(td?.gn||"")?"rig":"module"):"module";
  return {id:Date.now(),name:baseName,typeID:baseTid,type:modType,state:"active",mutaplasmid:mutaID,mutations};
}

function MutaplasmidEditor({mod,onUpdateMod}){
  const[copied,setCopied]=useState(false);
  const applicable=MUTA_BY_TYPE[mod.typeID]??MUTA_BY_TYPE[String(mod.typeID)]??[];
  const active=mod.mutaplasmid;
  if(!active){
    if(!applicable.length) return <div style={{padding:"16px",fontSize:12,color:C.textMute,textAlign:"center"}}>No mutaplasmids apply to this module.</div>;
    return(<div style={{padding:"10px 12px"}}>
      <div style={{fontSize:11,color:C.textMid,marginBottom:8}}>Apply a mutaplasmid to mutate this module's stats:</div>
      {applicable.map(mid=>{const m=mutaplasmidData[mid];return(
        <button key={mid} onClick={()=>{const ranges=mutaAttrRanges(mid,mod.typeID);const mutations={};for(const r of ranges)mutations[r.name]=r.base;onUpdateMod({...mod,mutaplasmid:mid,mutations});}}
          style={{display:"block",width:"100%",textAlign:"left",padding:"9px 11px",marginBottom:6,background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,fontSize:12,fontWeight:600,cursor:"pointer"}}>
          {m.n}<span style={{fontSize:9,color:C.textMute,marginLeft:6}}>{Object.keys(m.a||{}).length} attrs</span>
        </button>);})}
    </div>);
  }
  const m=mutaplasmidData[active];
  const ranges=mutaAttrRanges(active,mod.typeID);
  const setVal=(name,v)=>onUpdateMod({...mod,mutations:{...mod.mutations,[name]:v}});
  return(<div style={{padding:"10px 12px"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
      <span style={{fontSize:11,fontWeight:700,color:C.accent}}>{m.n}</span>
      <button onClick={()=>onUpdateMod({...mod,mutaplasmid:undefined,mutations:undefined})} style={{background:"none",border:`1px solid ${C.danger}`,color:C.danger,borderRadius:6,padding:"3px 8px",fontSize:10,fontWeight:700,cursor:"pointer"}}>Remove</button>
    </div>
    {ranges.map(r=>{
      const cur=mod.mutations?.[r.name]??r.base;
      const frac=r.max>r.min?(cur-r.min)/(r.max-r.min):0.5;
      const worse=cur<r.base, pct=((cur/r.base-1)*100);
      return(<div key={r.name} style={{marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:3}}>
          <span style={{fontSize:11,fontWeight:600,color:C.text}}>{mutaLabel(r.name)}</span>
          <span style={{fontSize:11,fontWeight:700,color:C.accent}}>{fmtMutaVal(r.name,cur)} <span style={{fontSize:9,color:Math.abs(pct)<0.1?C.textMute:(pct>0?C.rig:C.warning)}}>({pct>=0?"+":""}{pct.toFixed(0)}%)</span></span>
        </div>
        <input type="range" min={r.min} max={r.max} step={(r.max-r.min)/400||0.01} value={cur} onChange={e=>setVal(r.name,Number(e.target.value))} style={{width:"100%",accentColor:C.accent}}/>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:8,color:C.textMute}}><span>{fmtMutaVal(r.name,r.min)}</span><span>base {fmtMutaVal(r.name,r.base)}</span><span>{fmtMutaVal(r.name,r.max)}</span></div>
      </div>);
    })}
    <div style={{display:"flex",gap:8,marginTop:6}}>
      <button onClick={()=>{const ms={};for(const r of ranges)ms[r.name]=r.min+Math.random()*(r.max-r.min);onUpdateMod({...mod,mutations:ms});}} style={{flex:1,padding:"8px 0",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:7,color:C.textMid,fontSize:11,fontWeight:700,cursor:"pointer"}}>Random</button>
      <button onClick={()=>{const txt=abyssalToText(mod);try{navigator.clipboard?.writeText(txt);}catch{} setCopied(true);setTimeout(()=>setCopied(false),1500);}} style={{flex:1,padding:"8px 0",background:C.accent,border:"none",borderRadius:7,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>{copied?"Copied!":"Copy"}</button>
    </div>
  </div>);
}

function ModuleMenu({mod,onClose,onUpdateMod,onUpdateModLive,onRemove,onDuplicate}){
  const _hasMuta=(MUTA_BY_TYPE[mod.typeID]??MUTA_BY_TYPE[String(mod.typeID)]??[]).length>0||mod.mutaplasmid;
  const[tab,setTab]=useState("state");
  const[rahQuery,setRahQuery]=useState("");
  const _modTakesCharges=moduleTakesCharges(mod.typeID,mod.name);
  // Reactive Armor Hardener: gets a "Reactive" tab to choose its adaptation pattern.
  const _isRAH=((TYPES[mod.typeID]??TYPES[String(mod.typeID)])?.gn??(TYPES[mod.typeID]??TYPES[String(mod.typeID)])?.groupName)==="Armor Resistance Shift Hardener";
  const tabs=[...((mod.type==="weapon"||mod.type==="capbooster"||_modTakesCharges)?["state","charge","info","variations"]:["state","info","variations"]),...(_isRAH?["reactive"]:[]),...(_hasMuta?["mutate"]:[])];
  const tabLabel={state:"State",charge:"Charge",info:"Info",variations:"Variations",mutate:"Mutate",reactive:"Reactive"};
  // Determine valid states for this module type
  const _td=TYPES[mod.typeID];
  const _a=_td?.attrs??_td?.a??{};
  const _isCloak=(_td?.gn??_td?.groupName)==="Cloaking Device";
  const _canActivate=mod.type==="rig"?false:(_isCloak||!!(Number(_a.duration||_a['73']||0)||Number(_a.speed||_a['51']||0)||Number(_a.capacitorNeed||_a['6']||0)));
  const _canOverheat=Number((_td?.attrs??_td?.a??{})?.heatDamage??(_td?.attrs??_td?.a??{})?.['1211']??0)>0;
  const states=mod.type==="rig"?["online"]:_canActivate?(_canOverheat?MODULE_STATES:["offline","online","active"]):(["offline","online"]);
  const metaColor={T1:C.textMid,T2:C.accent,Deadspace:C.rig,Named:C.rig,Storyline:C.warning,Faction:C.danger,Officer:"#f0abfc"};
  const modData=Object.values(modulesData).find(m=>m.name===mod.name);
  return(
    <BottomSheet title={mod.name} onClose={onClose} height="78vh">
      <div style={{display:"flex",borderBottom:`1px solid ${C.border}`}}>
        {tabs.map(t=><button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:"8px 0",fontSize:11,fontWeight:700,background:"none",border:"none",cursor:"pointer",color:tab===t?C.accent:C.textMute,borderBottom:tab===t?`2px solid ${C.accent}`:"2px solid transparent"}}>{tabLabel[t]}</button>)}
      </div>
      <div style={{padding:14,overflowY:'auto',maxHeight:'60vh'}}>
        {tab==="state"&&(<div>
          <div style={{fontSize:11,color:C.textMute,marginBottom:10}}>Module State</div>
          <div style={{display:"flex",gap:8,marginBottom:20}}>
            {states.map(s=>(<button key={s} onClick={()=>{if(mod.state!==s)haptic();onUpdateMod({...mod,state:s});}} style={{flex:1,padding:"10px 0",borderRadius:8,border:`1px solid ${mod.state===s?STATE_COLORS[s]:C.border}`,background:mod.state===s?`${STATE_COLORS[s]}22`:"none",cursor:"pointer"}}>
              <div style={{width:8,height:8,borderRadius:99,background:STATE_COLORS[s],margin:"0 auto 4px"}}/>
              <span style={{fontSize:10,fontWeight:700,color:mod.state===s?STATE_COLORS[s]:C.textMute}}>{STATE_LABELS[s]}</span>
            </button>))}
          </div>
          {onDuplicate&&<button onClick={()=>{onDuplicate();onClose();}} style={{width:"100%",marginBottom:10,padding:"11px 0",background:C.accentLight,border:`1px solid ${C.accentBorder}`,borderRadius:8,color:C.accent,fontSize:13,fontWeight:700,cursor:"pointer"}}>Duplicate to Next Empty Slot</button>}
          <button onClick={()=>{onRemove();onClose();}} style={{width:"100%",padding:"11px 0",background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.3)",borderRadius:8,color:C.danger,fontSize:13,fontWeight:700,cursor:"pointer"}}>Remove Module</button>
        </div>)}
        {tab==="charge"&&(mod.type==="weapon"||mod.type==="capbooster"||_modTakesCharges)&&(<div>
          <div style={{fontSize:11,color:C.textMute,marginBottom:10}}>Select charge - applies to all grouped turrets</div>
          {getCompatibleCharges(mod).map(a=>{
            const col=DMG_COLOR[a.dmgType]||C.textMid;
            const total=a.em+a.th+a.kin+a.exp;
            return(<div key={a.typeID??a.name} onClick={()=>{const chargeVol=a.volume??(a.typeID?(TYPES[a.typeID]?.attrs?.volume??1):1);const modTd=TYPES[mod.typeID]??TYPES[String(mod.typeID)];const modCap=modTd?.attrs?.capacity??0;const nc=modCap>0&&chargeVol>0?Math.floor(modCap/chargeVol):undefined;onUpdateMod({...mod,ammo:a.name,charges:nc,maxCharges:nc});}} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 12px",background:mod.ammo===a.name?C.accentLight:C.surface,border:`1px solid ${mod.ammo===a.name?C.accentBorder:C.border}`,borderRadius:8,marginBottom:6,cursor:"pointer"}}>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:mod.ammo===a.name?C.accent:C.text}}>{a.name}</div>
                <div style={{fontSize:10,color:C.textMute,marginTop:2}}>
                  {a.capBonus!=null&&<span style={{color:C.rig,marginRight:8}}>+{a.capBonus} GJ</span>}
                  {a.dmgType&&<span style={{color:col,marginRight:8}}>{a.dmgType}</span>}
                  {total>0&&<span>{Math.round(total)} dmg/shot</span>}
                  {a.em==0&&a.th==0&&a.kin==0&&a.exp==0&&a.capBonus==null&&<span style={{color:C.textMute}}>No data</span>}
                </div>
              </div>
              {mod.ammo===a.name&&<span style={{color:C.accent}}>v</span>}
            </div>);
          })}
        </div>)}
        {tab==="info"&&(<div style={{overflowY:'auto',flex:1,padding:'0 2px'}}><ModuleInfoTab typeID={mod.typeID} mod={mod}/></div>)}
        {tab==="variations"&&(<ModuleVariationsTab typeID={mod.typeID} currentName={mod.name} onSwap={v=>{
          // Recompute charge count: variants can have different bay capacities (e.g. cap boosters)
          let nc=mod.charges;
          if(mod.ammo&&v.typeID){
            const newTd=TYPES[v.typeID]??TYPES[String(v.typeID)];
            const cap=newTd?.attrs?.capacity??0;
            const cTid=tidByName((mod.ammo||"").replace(/\s*\(\d+\)$/,""));
            const vol=cTid?(TYPES[cTid]?.attrs?.volume??1):1;
            nc=cap>0&&vol>0?Math.floor(cap/vol):undefined;
          }
          onUpdateMod({name:v.name,typeID:v.typeID,state:mod.state,ammo:mod.ammo,charges:nc,maxCharges:nc});onClose();}} />)}
        {tab==="mutate"&&(<div style={{overflowY:"auto",flex:1}}><MutaplasmidEditor mod={mod} onUpdateMod={onUpdateModLive||onUpdateMod}/></div>)}
        {tab==="reactive"&&(()=>{
          // mod.rahPattern: undefined/'fit' → Fit Pattern (follows Resistances-tab profile);
          // 'disable' → Do Not Adapt; {name,p} → adapt to a specific ammo/NPC damage split.
          const cur=mod.rahPattern;
          const isFit=cur==null||cur==="fit";
          const isDisable=cur==="disable";
          const curName=(cur&&cur.p)?cur.name:null;
          const Opt=({active,onClick,title,sub})=>(
            <div onClick={onClick} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"11px 12px",background:active?C.accentLight:C.surface,border:`1px solid ${active?C.accentBorder:C.border}`,borderRadius:8,marginBottom:6,cursor:"pointer"}}>
              <div><div style={{fontSize:13,fontWeight:600,color:active?C.accent:C.text}}>{title}</div>{sub&&<div style={{fontSize:10,color:C.textMute,marginTop:2}}>{sub}</div>}</div>
              {active&&<span style={{color:C.accent}}>v</span>}
            </div>);
          const Bar=({p})=>{const seg=[["em",C.em||"#6ba4ff"],["th",C.th||"#ff5b5b"],["kin",C.kin||"#b9b9b9"],["exp",C.exp||"#e0a44a"]];const v={em:p[0],th:p[1],kin:p[2],exp:p[3]};return(<div style={{display:"flex",height:5,borderRadius:3,overflow:"hidden",width:62,flexShrink:0}}>{seg.map(([k,c])=>v[k]>0?<div key={k} style={{flex:v[k],background:c}}/>:null)}</div>);};
          const q=rahQuery.trim().toLowerCase();
          return(<div>
            <div style={{fontSize:11,color:C.textMute,marginBottom:10}}>Reactive Armor Hardener adaptation</div>
            <Opt active={isFit} onClick={()=>onUpdateMod({...mod,rahPattern:"fit"})} title="Fit Pattern" sub="Adapts to the damage profile selected in the Resistances tab"/>
            <Opt active={isDisable} onClick={()=>onUpdateMod({...mod,rahPattern:"disable"})} title="Do Not Adapt" sub="Even 15% spread across all four armor resists"/>
            <div style={{fontSize:11,color:C.textMute,margin:"14px 0 8px"}}>Adapt to specific damage type</div>
            <input value={rahQuery} onChange={e=>setRahQuery(e.target.value)} placeholder="Search ammo or NPC…" style={{width:"100%",boxSizing:"border-box",padding:"9px 10px",marginBottom:8,background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,fontSize:12,outline:"none"}}/>
            {DAMAGE_PROFILES.map(cat=>{
              const items=cat.items.filter(it=>!q||it.n.toLowerCase().includes(q)||cat.cat.toLowerCase().includes(q));
              if(!items.length)return null;
              return(<div key={cat.cat} style={{marginBottom:8}}>
                <div style={{fontSize:10,fontWeight:700,color:C.textMute,textTransform:"uppercase",letterSpacing:0.5,margin:"6px 2px"}}>{cat.cat}</div>
                {items.map(it=>{
                  const active=curName===it.n;
                  return(<div key={it.n} onClick={()=>onUpdateMod({...mod,rahPattern:{name:it.n,p:it.p}})} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 12px",background:active?C.accentLight:C.surface,border:`1px solid ${active?C.accentBorder:C.border}`,borderRadius:8,marginBottom:5,cursor:"pointer"}}>
                    <span style={{fontSize:12,fontWeight:active?700:500,color:active?C.accent:C.text}}>{it.n}</span>
                    <Bar p={it.p}/>
                  </div>);
                })}
              </div>);
            })}
          </div>);
        })()}
      </div>
    </BottomSheet>
  );
}

function ImportFitSheet({onClose,onImport}){
  const[text,setText]=useState("");
  const[parsed,setParsed]=useState(null);
  const[err,setErr]=useState(null);
  const process=(t)=>{if(!t.trim()){setParsed(null);setErr(null);return;}const r=parseEFT(t);if(r.error){setParsed(null);setErr(r.error);}else{setParsed(r);setErr(null);}};
  const readClip=async()=>{try{const t=await navigator.clipboard.readText();setText(t);process(t);}catch{setErr("Clipboard access denied — paste manually below.");}};
  return(
    <BottomSheet title="Import EFT Fit" onClose={onClose} height="88vh">
      <div style={{padding:14}}>
        <div style={{fontSize:11,color:C.textMute,marginBottom:10}}>Paste a fit copied from Pyfa or the in-game fitting window.</div>
        <button onClick={readClip} style={{width:"100%",padding:"10px 0",background:C.accentLight,border:`1px solid ${C.accentBorder}`,borderRadius:8,color:C.accent,fontSize:13,fontWeight:700,cursor:"pointer",marginBottom:10}}>Read from Clipboard</button>
        <textarea value={text} onChange={e=>{setText(e.target.value);process(e.target.value);}} placeholder={"[Hyperion, My Fit]\nNeutron Blaster Cannon II, Caldari Navy Antimatter Charge L\nMagnetic Field Stabilizer II\n..."} style={{width:"100%",height:110,background:C.surfaceAlt,border:`1px solid ${err?C.danger:C.border}`,borderRadius:8,color:C.text,fontSize:11,padding:"8px 10px",boxSizing:"border-box",resize:"none",fontFamily:"monospace"}}/>
        {err&&<div style={{color:C.danger,fontSize:11,marginTop:6}}>{err}</div>}
        {parsed&&(<div style={{marginTop:12,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:10,padding:12,maxHeight:200,overflowY:"auto"}}>
          <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:2}}>{parsed.fitName}</div>
          <div style={{fontSize:11,color:C.textMid,marginBottom:8}}>
            {parsed.shipName} &middot; {parsed.mods.length} mod{parsed.mods.length!==1?"s":""}
            {parsed.drones.length>0&&<> &middot; {parsed.drones.length} drone type{parsed.drones.length!==1?"s":""}</>}
            {parsed.fighters?.length>0&&<> &middot; {parsed.fighters.reduce((s,f)=>s+f.qty,0)} fighter squadron{parsed.fighters.reduce((s,f)=>s+f.qty,0)!==1?"s":""}</>}
            {parsed.cargo.length>0&&<> &middot; {parsed.cargo.length} cargo</>}
            {parsed.implantNames.length>0&&<> &middot; {parsed.implantNames.length} implant{parsed.implantNames.length!==1?"s":""}</>}
            {parsed.boosterNames.length>0&&<> &middot; {parsed.boosterNames.length} booster{parsed.boosterNames.length!==1?"s":""}</>}
          </div>
          {parsed.mods.map((m,i)=>(<div key={i} style={{fontSize:11,padding:"2px 0",borderBottom:`1px solid ${C.border}`}}><span style={{color:C.text}}>{m.name}</span>{m.charge&&<span style={{color:C.textMute}}> &rsaquo; {m.charge}</span>}</div>))}
        </div>)}
        {parsed&&<button onClick={()=>{onImport(parsed);onClose();}} style={{width:"100%",marginTop:14,padding:"12px 0",background:C.accent,border:"none",borderRadius:8,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>Import "{parsed.fitName}"</button>}
      </div>
    </BottomSheet>
  );
}

// ═══ FIT TAB ════════════════════════════════════════════════════
function FitTab({ship,slots,setSlots,skills,implants,boosters,drones,factorInReload,externalBursts,projectedEffects,dmgProfile}){
  const _cs=(ship&&slots)?calcFitStats(ship,slots,drones??[],skills,{implants,boosters,factorInReload,externalBursts,projectedWebMult:projectedEffects?.webMult,projectedNeutGJs:projectedEffects?.neutGJs,projectedDebuffs:projectedEffects?.debuffs,damageProfile:dmgProfile?.p})??{}:{};
  const engineStatsByTypeID=new Map();
  if(_cs.slotEngineStats){for(const[slot,stats]of _cs.slotEngineStats){if(slot.typeID)engineStatsByTypeID.set(slot.typeID,stats);}}
  const[grouped,setGrouped]=useState(true);
  const[dragUI,setDragUI]=useState(null); // {secKey,fromIdx,overIdx} — visual state during pointer drag
  const dragInfo=useRef(null);             // live drag data (avoids re-render churn during move)
  const rowRefs=useRef({});                // `${secKey}:${rowIdx}` → row element (for hit-testing)
  const[expanded,setExpanded]=useState(["subsystems","high","mid","low","rigs"]);
  const[moduleMenu,setModuleMenu]=useState(null);
  const[emptySlot,setEmptySlot]=useState(null);

  // Drag-and-drop handler: swap two slot positions within a section
  // ── Drag-to-reorder (pointer events: works for both touch and mouse) ──────
  // Reorders by DISPLAY ROW (grouped rows move as a unit), then rebuilds the raw
  // slot array from the new row order via each row's groupIds.
  const reorderRows=(secKey,fromIdx,toIdx)=>{
    setSlots(prev=>{
      const rows=computeDisplayRows(prev[secKey],secKey,grouped);
      if(fromIdx<0||toIdx<0||fromIdx>=rows.length||toIdx>=rows.length||fromIdx===toIdx)return prev;
      const newRows=[...rows];
      const[mv]=newRows.splice(fromIdx,1);
      newRows.splice(toIdx,0,mv);
      const byId=new Map(prev[secKey].map(m=>[m.id,m]));
      return{...prev,[secKey]:newRows.flatMap(r=>r.groupIds.map(id=>byId.get(id)).filter(Boolean))};
    });
  };
  const startRowDrag=(secKey,fromIdx)=>e=>{
    e.preventDefault();e.stopPropagation();
    try{e.currentTarget.setPointerCapture(e.pointerId);}catch{}
    dragInfo.current={secKey,fromIdx,overIdx:fromIdx};
    setDragUI({secKey,fromIdx,overIdx:fromIdx});
  };
  const moveRowDrag=e=>{
    const d=dragInfo.current;if(!d)return;
    e.preventDefault();
    const y=e.clientY;
    let best=d.overIdx,bestDist=Infinity;
    for(const[key,el] of Object.entries(rowRefs.current)){
      if(!el||!key.startsWith(d.secKey+":"))continue;
      const idx=Number(key.split(":")[1]);
      const r=el.getBoundingClientRect();
      if(r.height===0)continue;
      const dist=Math.abs(y-(r.top+r.height/2));
      if(dist<bestDist){bestDist=dist;best=idx;}
    }
    if(best!==d.overIdx){d.overIdx=best;setDragUI({...d});}
  };
  const endRowDrag=()=>{
    const d=dragInfo.current;dragInfo.current=null;
    setDragUI(null);
    if(d&&d.overIdx!==d.fromIdx)reorderRows(d.secKey,d.fromIdx,d.overIdx);
  };

  const _isT3C = isT3Cruiser(ship?.name);
  const SECS=[
    ...(_isT3C?[{key:"subsystems",label:"Subsystems",color:C.accent}]:[]),
    {key:"high",label:"High Slots",color:C.high},{key:"mid",label:"Mid Slots",color:C.mid},{key:"low",label:"Low Slots",color:C.low},{key:"rigs",label:"Rigs",color:C.rig}];
  // T3 Destroyer tactical modes (Defense/Propulsion/Sharpshooter). Detect by hull class and
  // by the existence of "<Ship> <Mode> Mode" types. Default to Defense if none chosen yet.
  // Tactical modes. Standard T3Ds expose "<Ship> <Mode> Mode" types; the Skua reuses the Caldari
  // (Jackdaw) Defense/Sharpshooter/Propulsion modes, and the Anhinga has its own Primary/Secondary/
  // Tertiary modes. calc.js applies the actual bonuses; here we just drive the selector.
  const MODE_SETS = { Skua: ["Defense","Sharpshooter","Propulsion"], Anhinga: ["Primary","Secondary","Tertiary"] };
  const isT3D = ship?.hullClass === "Tactical Destroyer" && !!tidByName(`${ship.name} Defense Mode`);
  const shipModes = MODE_SETS[ship?.name] ?? (isT3D ? ["Defense","Sharpshooter","Propulsion"] : null);
  const tacticalMode = slots.tactical ?? (shipModes ? shipModes[0] : null);
  const setTacticalMode = (mode) => setSlots(prev => ({ ...prev, tactical: mode }));

  const updateMod=(secKey,modId,updated,keepOpen=false)=>{
    setSlots(prev=>{
      const sec=[...prev[secKey]],idx=sec.findIndex(m=>m.id===modId);
      if(idx<0)return prev;
      if(grouped&&secKey==="high"&&updated.ammo!==undefined){const origName=sec[idx].name;return{...prev,[secKey]:sec.map(m=>m.name===origName?{...m,...updated,id:m.id}:m)};}
      sec[idx]={...sec[idx],...updated};return{...prev,[secKey]:sec};
    });if(!keepOpen)setModuleMenu(null);
  };
  const removeMod=(secKey,modId)=>{
    const ship_=ship??{};
    const labels={high:"High",mid:"Mid",low:"Low",rigs:"Rig"};
    setSlots(prev=>({...prev,[secKey]:prev[secKey].map(m=>m.id===modId?{id:m.id,name:`[Empty ${labels[secKey]} Slot]`,icon:null,type:"empty"}:m)}));
  };
  const duplicateMod=(secKey,mod)=>{
    const empty=slots[secKey].find(m=>m.type==="empty");
    if(!empty)return;
    addMod(secKey,empty.id,{name:mod.name,typeID:mod.typeID,mutaplasmid:mod.mutaplasmid,mutations:mod.mutations?{...mod.mutations}:undefined});
    setModuleMenu(null);
  };
  const addMod=(secKey,id,modData)=>{
    const modInfo=Object.values(modulesData).find(m=>m.name===modData.name);
    const takesCharges=moduleTakesCharges(modData.typeID,modData.name);
    const hasIntrinsicDmg=!!(modInfo?.emDmg||modInfo?.thDmg||modInfo?.kinDmg||modInfo?.expDmg);
    const isWeaponMod=(modInfo?.dmgMult!=null&&modInfo?.rof!=null)||hasIntrinsicDmg||
      (takesCharges&&/Launcher|Turret|Weapon/i.test(TYPES[modData.typeID]?.gn??TYPES[modData.typeID]?.groupName??''));
    const hasCharges=takesCharges||!!(modInfo?.chargeGroups?.length);
    const isCapBooster=modInfo?.groupName==="Capacitor Booster";
    const isRigMod=secKey==="rigs";
    const modType=isCapBooster?"capbooster":isWeaponMod?"weapon":isRigMod?"rig":"passive";
    // Modules that cycle (weapons, active hardeners, repairers, prop mods, etc.) default to active
    const hasCycle=!!(modInfo?.duration&&modInfo.duration>0)||(modInfo?.capUse!=null&&modInfo.capUse>0);
    const defaultState=isRigMod?"online":(isWeaponMod||isCapBooster||hasCycle)?"active":"online";
    setSlots(prev=>({...prev,[secKey]:prev[secKey].map(m=>m.id===id?{...m,name:modData.name,icon:null,typeID:modData.typeID,type:modType,state:defaultState,ammo:undefined,charges:undefined,maxCharges:undefined,optimal:modInfo?.optimal??undefined,falloff:modInfo?.falloff??undefined,tracking:modInfo?.tracking??undefined,mutaplasmid:modData.mutaplasmid??undefined,mutations:modData.mutations??undefined}:m)}));
  };

  const getDisplayRows=(secKey)=>computeDisplayRows(slots[secKey]??[],secKey,grouped);
  const menuMod=moduleMenu?slots[moduleMenu.secKey].find(m=>m.id===moduleMenu.modId):null;

  return(
    <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column"}}>
      <ResourceStrip ship={ship} slots={slots} skills={skills} implants={implants} boosters={boosters} drones={drones} factorInReload={factorInReload}/>
      {shipModes&&(
        <div style={{display:"flex",gap:6,padding:"8px 10px 4px"}}>
          {shipModes.map((mode)=>{
            const on=tacticalMode===mode;
            return(<button key={mode} onClick={()=>setTacticalMode(mode)}
              style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:"9px 4px",borderRadius:8,cursor:"pointer",
                background:on?C.accentLight:C.surface,border:`1px solid ${on?C.accent:C.border}`}}>
              <span style={{fontSize:12,fontWeight:700,color:on?C.accent:C.text}}>{mode}</span>
            </button>);
          })}
        </div>
      )}
      <div style={{display:"flex",justifyContent:"flex-end",padding:"0 10px 4px"}}>
        <button onClick={()=>setGrouped(g=>!g)} style={{padding:"3px 10px",borderRadius:6,fontSize:10,fontWeight:700,background:grouped?C.accentLight:"none",border:`1px solid ${grouped?C.accentBorder:C.border}`,color:grouped?C.accent:C.textMute,cursor:"pointer"}}>{grouped?"Grouped":"Ungrouped"}</button>
      </div>
      <div style={{flex:1,padding:"0 10px 12px"}}>
        {SECS.map(sec=>{
          const rows=getDisplayRows(sec.key);
          return(<div key={sec.key} style={{marginBottom:6}}>
            <button onClick={()=>setExpanded(e=>e.includes(sec.key)?e.filter(k=>k!==sec.key):[...e,sec.key])} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",background:"none",border:"none",cursor:"pointer",padding:"7px 4px"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <img src={(slotIcons??{})[sec.key==="rigs"?"rig":sec.key]} style={{width:12,height:12,objectFit:"contain",filter:"brightness(10)",marginRight:2}} alt=""/>
                <span style={{fontSize:12,fontWeight:700,color:C.text}}>{sec.label}</span>
                <span style={{fontSize:10,color:C.textMute,background:C.border,borderRadius:99,padding:"1px 7px",fontWeight:600}}>{(slots[sec.key]??[]).length}</span>
              </div>
              <span style={{color:C.textMute,fontSize:11}}>{expanded.includes(sec.key)?"^":"v"}</span>
            </button>
            {expanded.includes(sec.key)&&rows.map((row,rowIdx)=>{
              if(row.type==="empty")return(
                <div key={row.id} ref={el=>{rowRefs.current[sec.key+":"+rowIdx]=el;}} onClick={()=>setEmptySlot({secKey:sec.key,id:row.id})} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",borderRadius:8,marginBottom:4,background:C.surface,border:`1px dashed ${C.borderStrong}`,cursor:"pointer"}}>
                  <div style={{width:30,height:30,borderRadius:7,background:C.surfaceAlt,border:`1px dashed ${C.borderStrong}`,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{color:C.borderStrong,fontSize:20}}>+</span></div>
                  <span style={{fontSize:13,color:C.textMute}}>{row.name}</span>
                  <span style={{marginLeft:"auto",fontSize:11,color:C.accent,fontWeight:600}}>Add module</span>
                </div>
              );
              const stateColor=STATE_COLORS[row.state]||C.textMid;
              const isDragSrc=dragUI?.secKey===sec.key&&dragUI?.fromIdx===rowIdx;
              const isDragOver=dragUI?.secKey===sec.key&&dragUI?.overIdx===rowIdx&&dragUI?.fromIdx!==rowIdx;
              return(
                <div key={row.id||row.name}
                ref={el=>{rowRefs.current[sec.key+":"+rowIdx]=el;}}
                onClick={()=>sec.key==="subsystems"?setEmptySlot({secKey:"subsystems",id:row.id}):setModuleMenu({secKey:sec.key,modId:row.id})}
                style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",borderRadius:8,marginBottom:4,cursor:"pointer",opacity:isDragSrc?0.45:1,background:isDragOver?C.accentLight:C.surface,border:`1px solid ${isDragSrc?C.accent:isDragOver?C.accentBorder:C.border}`,borderTop:isDragOver?`2px solid ${C.accent}`:undefined}}>
                  <div style={{width:6,height:6,borderRadius:99,background:stateColor,flexShrink:0,boxShadow:row.state==="overheated"?`0 0 6px ${stateColor}`:"none"}}/>
                  <div style={{width:30,height:30,borderRadius:7,flexShrink:0,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",background:`${sec.color}18`,border:`1px solid ${sec.color}35`,opacity:row.state==="offline"?0.4:1}}>
                    {row.typeID?<img className="eve-icon" src={eveIcon(row.typeID,32)} width={28} height={28} alt="" onError={e=>{e.target.style.display="none";}}/>:<span style={{fontSize:14}}>{row.icon||"?"}</span>}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:5}}>
                      {row.count>1&&<span style={{fontSize:9,fontWeight:800,color:sec.color,background:`${sec.color}20`,borderRadius:4,padding:"1px 5px"}}>{row.count}x</span>}
                      {row.mutaplasmid&&<span title="Abyssal (mutated) module" style={{fontSize:9,lineHeight:1,fontWeight:800,color:C.danger,background:`${C.danger}22`,border:`1px solid ${C.danger}`,borderRadius:4,padding:"2px 4px",flexShrink:0,display:"inline-flex",alignItems:"center"}}>▲</span>}
                      <span style={{fontSize:12,fontWeight:600,color:row.state==="offline"?C.textMute:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{sec.key==="subsystems"?(row.name||"").replace(/^.+?\s-\s/,""):row.name}</span>
                    </div>
                    <div style={{display:"flex",gap:8,marginTop:2}}>
                      {row.ammo&&<button title="Click to unload charge" onClick={e=>{e.stopPropagation();setSlots(prev=>{const s=[...prev[sec.key]];const si=s.findIndex(x=>x.id===row.id);if(si>=0)s[si]={...s[si],ammo:null,charges:undefined,maxCharges:undefined};return{...prev,[sec.key]:s};});}} style={{background:'none',border:'none',padding:'1px 3px',cursor:'pointer',borderRadius:3}}><span style={{fontSize:10,color:C.textMute}}>{(row.ammo||"").replace(/\s*\(\d+\)$/,"")} / {row.charges}/{row.maxCharges} ✕</span></button>}
                      {(()=>{
                        if(!row.typeID)return row.optimal>0||row.falloff>0?<span style={{fontSize:10,color:C.rig}}>{row.optimal}+{row.falloff} km</span>:null;
                        const eStats=engineStatsByTypeID.get(row.typeID);
                        if(eStats&&(eStats.optimal>0||eStats.falloff>0)){
                          const _fal=eStats.falloff>0?`+${eStats.falloff}`:'';
                          const _isOH=row.state==='overheated';
                          // heatedOptimal comes from calc and includes subsystem overload enhancements
                          // (e.g. Loki Core raises a web's heated range to 45.7km).
                          const _ohHint=(eStats.heatedOptimal!=null&&!_isOH)?<span style={{fontSize:9,color:C.overheat,marginLeft:3}}>OH:{eStats.heatedOptimal}km</span>:null;
                          return <span style={{fontSize:10,color:C.rig}}>{eStats.optimal}{_fal} km{_ohHint}</span>;
                        }
                        const a=TYPES[row.typeID]?.attrs??{};
                        const _ra=row.ammo?.replace(/\s*\(\d+\)$/,"");const ca=_ra?TYPES[tidByName(_ra)]?.attrs??{}:{};
                        const opt=Math.round((a.maxRange??0)*(ca.weaponRangeMultiplier??1)/1000*10)/10;
                        const fal=Math.round(((a.falloff??a.falloffEffectiveness??0))*(ca.fallofMultiplier??1)/1000*10)/10;
                        return (opt>0||fal>0)?<span style={{fontSize:10,color:C.rig}}>{opt}{fal>0?`+${fal}`:''} km</span>:null;
                      })()}
                      {(()=>{
                        if(!row.typeID)return row.tracking>0?<span style={{fontSize:10,color:C.warning}}>Tr {row.tracking}</span>:null;
                        const eSt=engineStatsByTypeID.get(row.typeID);
                        if(eSt?.tracking>0)return <span style={{fontSize:10,color:C.warning}}>Tr {eSt.tracking}</span>;
                        const a=TYPES[row.typeID]?.attrs??{};
                        const _ra=row.ammo?.replace(/\s*\(\d+\)$/,"");const ca=_ra?TYPES[tidByName(_ra)]?.attrs??{}:{};
                        const trk=Math.round((a.trackingSpeed??0)*(ca.trackingSpeedMultiplier??1)*1000)/1000;
                        return trk>0?<span style={{fontSize:10,color:C.warning}}>Tr {trk}</span>:null;
                      })()}
                      {(()=>{
                        const eAar=engineStatsByTypeID.get(row.typeID);
                        if(!eAar?.isAAR) return null;
                        const fmt=v=>v>=1000?`${(v/1000).toFixed(1)}k`:Math.round(v).toString();
                        if(eAar.hasPaste){
                          const dispHP=eAar.totalEHP??eAar.totalHP;
                          return <span style={{fontSize:10,color:'#a78bfa',marginLeft:2}}>{fmt(dispHP)}/{eAar.totalS}s</span>;
                        }
                        const ehps=eAar.ehpS??Math.round(eAar.repPerCycle/(eAar.cycleMs/1000));
                        return <span style={{fontSize:10,color:C.textMute,marginLeft:2}}>{fmt(ehps)} EHP/s</span>;
                      })()}
                      {(()=>{
                        const eAsb=engineStatsByTypeID.get(row.typeID);
                        if(!eAsb?.isASB) return null;
                        const fmt=v=>v>=1000?`${(v/1000).toFixed(1)}k`:Math.round(v).toString();
                        if(eAsb.hasCharges){
                          const dispHP=eAsb.totalEHP??eAsb.totalHP;
                          const reloadS=Math.round(eAsb.totalS_withReload-eAsb.totalS);
                          return <span style={{fontSize:10,color:'#a78bfa',marginLeft:2}}>{fmt(dispHP)} / {eAsb.totalS}s (+{reloadS}s)</span>;
                        }
                        return <span style={{fontSize:10,color:C.textMute,marginLeft:2}}>{fmt(eAsb.ehpS)} EHP/s</span>;
                      })()}
                      {(()=>{
                        const eRah=engineStatsByTypeID.get(row.typeID);
                        if(!eRah?.isRAH||!eRah.rahResistPct) return null;
                        // Current adapted resist split as four color-coded figures (EM / Th / Kin / Exp).
                        const pct=eRah.rahResistPct; // [em,th,kin,exp] percent
                        const cols=[DMG.em.color,DMG.th.color,DMG.kin.color,DMG.exp.color];
                        return(<span style={{display:"inline-flex",alignItems:"center",fontSize:10,fontWeight:700,marginLeft:2}}>
                          {pct.map((v,i)=>(<span key={i}>
                            {i>0&&<span style={{color:C.textMute,margin:"0 3px"}}>/</span>}
                            <span style={{color:cols[i]}}>{Number(v.toFixed(1))}%</span>
                          </span>))}
                        </span>);
                      })()}
                      {(()=>{
                        const eW=engineStatsByTypeID.get(row.typeID);
                        if(!eW?.isWDFG) return null;
                        const km=Math.round((eW.warpScrambleRange??0)/100)/10;
                        return <span style={{fontSize:10,color:C.rig,marginLeft:2}}>{km} km</span>;
                      })()}
                      {(()=>{
                        const eB=engineStatsByTypeID.get(row.typeID);
                        if(!eB?.isBreacher) return null;
                        if(eB.noPod) return <span style={{fontSize:10,color:C.textMute,marginLeft:2}}>load a pod</span>;
                        // pyfa format: total absolute / total %-of-HP "over" duration, resist-ignoring.
                        const fmtK=(n)=>n>=1000?(n/1000).toFixed(n>=10000?0:1).replace(/\.0$/,'')+"k":Math.round(n).toString();
                        return <span title={`Pure damage inflicted over time, minimum of absolute / relative.\nFull DPS from ${fmtK(eB.fullDpsHP)} target HP`}
                          style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:10,fontWeight:700,marginLeft:2,cursor:"help"}}>
                          <span style={{color:C.danger}}>{fmtK(eB.totalAbs)}/{Math.round(eB.totalPct)}%</span>
                          <span style={{color:C.textMute,fontWeight:400}}>over {Math.round(eB.durationS)}s</span>
                        </span>;
                      })()}
                    </div>
                  </div>
                  <div
                    onPointerDown={startRowDrag(sec.key,rowIdx)}
                    onPointerMove={moveRowDrag}
                    onPointerUp={endRowDrag}
                    onPointerCancel={endRowDrag}
                    onClick={e=>e.stopPropagation()}
                    title="Drag to reorder"
                    style={{touchAction:"none",cursor:"grab",flexShrink:0,padding:"6px 4px 6px 8px",marginRight:-4,color:C.textMute,fontSize:14,lineHeight:1,userSelect:"none",display:"flex",alignItems:"center"}}>
                    &#8801;
                  </div>
                </div>
              );
            })}
          </div>);
        })}
      </div>
      {menuMod&&<ModuleMenu mod={menuMod} onClose={()=>setModuleMenu(null)} onUpdateMod={u=>updateMod(moduleMenu.secKey,moduleMenu.modId,u)} onUpdateModLive={u=>updateMod(moduleMenu.secKey,moduleMenu.modId,u,true)} onRemove={()=>removeMod(moduleMenu.secKey,moduleMenu.modId)} onDuplicate={slots[moduleMenu.secKey]?.some(m=>m.type==="empty")?()=>duplicateMod(moduleMenu.secKey,menuMod):null}/>}
      {emptySlot&&emptySlot.secKey==="subsystems"&&(
        <SubsystemPickerSheet ship={ship} slotId={emptySlot.id}
          current={(slots.subsystems??[]).find(s=>s.id===emptySlot.id)}
          onSelect={sub=>{setSlots(prev=>{
            const subs=[...(prev.subsystems??[])];
            const idx=subs.findIndex(s=>s.id===emptySlot.id);
            if(idx>=0)subs[idx]={...subs[idx],name:sub.name,typeID:sub.typeID,type:"subsystem"};
            // Recompute slot layout from the new subsystem set; preserve filled module slots where possible.
            const layout=t3cSlotLayout(subs.filter(s=>s.typeID));
            const fit=(key,count)=>{const cur=prev[key]??[];const out=[];for(let i=0;i<count;i++)out.push(cur[i]??{id:`${key[0]}${i}`,name:`[Empty ${key==='mid'?'Mid':key==='rigs'?'Rig':key.charAt(0).toUpperCase()+key.slice(1)} Slot]`,icon:null,type:"empty"});return out;};
            return{...prev,subsystems:subs,high:fit("high",layout.hiSlots),mid:fit("mid",layout.medSlots),low:fit("low",layout.lowSlots),rigs:fit("rigs",layout.rigSlots)};
          });setEmptySlot(null);}}
          onClose={()=>setEmptySlot(null)}/>
      )}
      {emptySlot&&emptySlot.secKey!=="subsystems"&&<ModuleBrowserSheet slotType={emptySlot.secKey} onSelect={m=>addMod(emptySlot.secKey,emptySlot.id,m)} onClose={()=>setEmptySlot(null)}/>}
    </div>
  );
}

// ═══ STATS TAB ══════════════════════════════════════════════════
function StatsTab({ship,slots,skills,implants,boosters,drones,fighters,factorInReload,setFactorInReload,externalBursts,projectedReps,projectedEffects,dmgProfile,setDmgProfile}){
  // Per-section collapse state — all open by default.
  const [collapsed,setCollapsed]=useState({});
  const toggle=(k)=>setCollapsed(c=>({...c,[k]:!c[k]}));
  const isOpen=(k)=>!collapsed[k];
  // Firepower: which stat's damage-type split to show. Cap: toggle readouts.
  const [dmgSource,setDmgSource]=useState("weapon");
  const [capDeltaMode,setCapDeltaMode]=useState("net");
  const [peakMode,setPeakMode]=useState("regen");
  // Incoming damage profile is lifted to FittingsScreen (shared with the Fit tab's readouts).
  const [showProfilePicker,setShowProfilePicker]=useState(false);
  // The selected profile also drives any Reactive Armor Hardener set to "fit pattern" (damageProfile).
  const cs=calcFitStats(ship,slots,drones??[],skills,{implants,boosters,factorInReload,externalBursts,projectedWebMult:projectedEffects?.webMult,projectedNeutGJs:projectedEffects?.neutGJs,projectedDebuffs:projectedEffects?.debuffs,damageProfile:dmgProfile.p,fighters:(fighters??[]).map(f=>({name:f.name,qty:f.qty??1,active:f.active,abilities:f.abilities}))})??{};
  // Profile-weighted EHP: rawHP / Σ(profile_i × resonance_i), resonance = 1 - resist/100.
  const ehpForProfile=(rawHP,res)=>{
    const p=dmgProfile.p;
    const div=p[0]*(1-(res?.em??0)/100)+p[1]*(1-(res?.th??0)/100)+p[2]*(1-(res?.kin??0)/100)+p[3]*(1-(res?.exp??0)/100);
    return rawHP/Math.max(1e-4,div);
  };
  const r=cs.resists??ship?.resists??{};
  const fmtN=n=>(n==null||n===0)?"0":n>=1e6?`${(n/1e6).toFixed(2)}M`:n>=1000?`${(n/1000).toFixed(1)}k`:String(Math.round(n));
  const fmtF=n=>n==null?"0.0":n>=100?n.toFixed(0):n.toFixed(2);
  const fmtDps=n=>n==null||n<0.05?"0":n>=100?n.toFixed(0):n.toFixed(1);

  const card={background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,marginBottom:8,overflow:"hidden"};
  const hd={display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 12px",borderBottom:`1px solid ${C.border}`,background:C.surfaceAlt};
  const Row=({label,value,color,last})=>(<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 12px",borderBottom:last?"none":`1px solid ${C.border}`}}><span style={{fontSize:11,color:C.textMid}}>{label}</span><span style={{fontSize:11,fontWeight:600,color:color||C.text}}>{value}</span></div>);
  // Collapsible section header — click toggles open/closed; `right` is optional header-right content.
  const SectionHead=({id,title,right})=>(
    <div style={{...hd,cursor:"pointer",borderBottom:isOpen(id)?hd.borderBottom:"none"}} onClick={()=>toggle(id)}>
      <span style={{display:"flex",alignItems:"center",gap:6}}>
        <span style={{fontSize:10,color:C.textMute,transform:isOpen(id)?"rotate(90deg)":"none",transition:"transform 0.15s",display:"inline-block",width:10}}>▶</span>
        <span style={{fontSize:11,fontWeight:700,color:C.text}}>{title}</span>
      </span>
      {right}
    </div>
  );

  const shieldEHPp = ehpForProfile(cs.shieldHP??0, r.shield);
  const armorEHPp  = ehpForProfile(cs.armorHP??0,  r.armor);
  const hullEHPp   = ehpForProfile(cs.hullHP??0,   r.hull);
  const totalEHPp  = shieldEHPp + armorEHPp + hullEHPp;
  const layers=[
    {key:"shield",label:"Shield",hp:fmtN(cs.shieldHP??0),ehp:fmtN(shieldEHPp),
     em:r.shield?.em??0,th:r.shield?.th??0,kin:r.shield?.kin??0,exp:r.shield?.exp??0,
     regen:`${fmtF(cs.passiveShieldRegen??0)} HP/s`, repLabel:cs.shieldRepPS>0?`Boost: ${fmtF(cs.shieldRepPS)} HP/s`:""},
    {key:"armor", label:"Armor", hp:fmtN(cs.armorHP??0), ehp:fmtN(armorEHPp),
     em:r.armor?.em??0, th:r.armor?.th??0, kin:r.armor?.kin??0, exp:r.armor?.exp??0,
     regen:cs.armorRepPS>0?`Rep: ${fmtF(cs.armorRepEhpS??cs.armorRepPS)} EHP/s`:"", repLabel:""},
    {key:"hull",  label:"Hull",  hp:fmtN(cs.hullHP??0),  ehp:fmtN(hullEHPp),
     em:r.hull?.em??0,  th:r.hull?.th??0,  kin:r.hull?.kin??0,  exp:r.hull?.exp??0,
     regen:cs.hullRepPS>0?`Rep: ${fmtF(cs.hullRepPS)} HP/s`:"", repLabel:""},
  ];

  const weapDpsTotal  = fmtDps(cs.weaponDps?.total??0);
  const droneDpsTotal = fmtDps((cs.droneDps?.total??0) + (cs.fighterDps?.total??0));
  const totalDpsN     = fmtDps(cs.totalDps?.total??0);
  const totalVolleyN  = fmtDps(cs.totalVolley?.total??0);
  // Entropic disintegrators spool up: show min–max ranges for the spooled weapon/total.
  const hasSpool      = !!cs.hasSpoolWeapon;
  const weapDpsDisp   = hasSpool ? `${fmtDps(cs.weaponDps?.total??0)}-${fmtDps(cs.weaponDpsMax??0)}` : weapDpsTotal;
  const totalDpsDisp  = hasSpool ? `${fmtDps(cs.totalDps?.total??0)}-${fmtDps(cs.totalDpsMax??0)}`   : totalDpsN;
  const totalVolDisp  = hasSpool ? `${fmtDps(cs.totalVolley?.total??0)}-${fmtDps(cs.totalVolleyMax??0)}` : totalVolleyN;
  // Selected firepower stat's damage-type split (tap a column to switch). Fighters are lumped
  // with drones (as Pyfa does) in the "Drone" column.
  const _dfSplit = ['em','th','kin','exp','total'].reduce((o,k)=>{o[k]=(cs.droneDps?.[k]??0)+(cs.fighterDps?.[k]??0);return o;},{});
  const dmgSplit      = ({weapon:cs.weaponDps,drone:_dfSplit,total:cs.totalDps,volley:cs.totalVolley}[dmgSource])??{};
  const dmgSourceLabel= ({weapon:"Weapon",drone:"Drone",total:"Total",volley:"Volley"}[dmgSource]);
  // Cap: incoming GJ/s (peak regen + injector fill) and cap-battery neut resistance %.
  const capInGJs      = peakRegen(cs.capCapacity,cs.capRechargeMs)+(cs.capFillPS??0);
  const neutResistPct = (1-(cs.energyWarfareResist??1))*100;

  return(
    <div style={{flex:1,overflowY:"auto",padding:"10px 10px 20px"}}>
      {showProfilePicker&&<DamageProfileSheet current={dmgProfile} onSelect={setDmgProfile} onClose={()=>setShowProfilePicker(false)}/>}

      {/* Fit Validation */}
      {(()=>{
        const fr=n=>Math.abs(n)>=100?String(Math.round(Math.abs(n))):Math.abs(n).toFixed(1);
        const issues=[];
        if((cs.cpuUsed??0)>(cs.cpuTotal??0)+0.01) issues.push({sev:"err",msg:`CPU overloaded by ${fr(cs.cpuUsed-cs.cpuTotal)} tf`});
        if((cs.pgUsed??0)>(cs.pgTotal??0)+0.01) issues.push({sev:"err",msg:`Powergrid overloaded by ${fr(cs.pgUsed-cs.pgTotal)} MW`});
        if((cs.calUsed??0)>(cs.calTotal??0)+0.01) issues.push({sev:"err",msg:`Calibration exceeded by ${fr(cs.calUsed-cs.calTotal)} points`});
        const _dRec=(d)=>TYPES[d.typeID]??TYPES[tidByName(d.name)];
        const _dBW=(d)=>{const t=_dRec(d);return t?.attrs?.droneBandwidthUsed ?? t?.a?.droneBandwidthUsed ?? d.bandwidth ?? 5;};
        const _dVol=(d)=>{const t=_dRec(d);return t?.attrs?.volume ?? t?.a?.volume ?? d.volume ?? 5;};
        const bayUsed=(drones??[]).reduce((s,d)=>s+(d.qty??0)*_dVol(d),0);
        const bwUsed=(drones??[]).filter(d=>d.active).reduce((s,d)=>s+(d.qty??0)*_dBW(d),0);
        if((cs.droneBay??0)>0&&bayUsed>cs.droneBay+0.01) issues.push({sev:"err",msg:`Drone bay over capacity by ${fr(bayUsed-cs.droneBay)} m³`});
        if((cs.droneBandwidth??0)>0&&bwUsed>cs.droneBandwidth+0.01) issues.push({sev:"err",msg:`Drone bandwidth exceeded by ${fr(bwUsed-cs.droneBandwidth)} Mbit/s`});
        const hasErr=issues.some(i=>i.sev==="err");
        const accent=hasErr?C.danger:(issues.length?C.warning:C.success);
        return(
          <div style={{...card,border:`1px solid ${issues.length?accent:C.border}`}}>
            <SectionHead id="validation" title="Validation" right={<span style={{fontSize:11,fontWeight:700,color:accent}}>{issues.length?`${issues.length} issue${issues.length>1?"s":""}`:"Valid"}</span>}/>
            {isOpen("validation")&&(issues.length
              ?<div style={{padding:"2px 0"}}>{issues.map((it,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 12px",borderBottom:i<issues.length-1?`1px solid ${C.border}`:"none"}}>
                    <span style={{width:7,height:7,borderRadius:99,background:it.sev==="err"?C.danger:C.warning,flexShrink:0}}/>
                    <span style={{fontSize:11,color:C.text}}>{it.msg}</span>
                  </div>))}</div>
              :<div style={{padding:"8px 12px",fontSize:11,color:C.textMid,display:"flex",alignItems:"center",gap:8}}><span style={{color:C.success,fontWeight:800}}>✓</span> No fitting issues detected.</div>)}
          </div>
        );
      })()}

      {/* Resistances */}
      <div style={card}>
        <SectionHead id="resists" title="Resistances" right={<span style={{fontSize:11,color:C.textMute}}>EHP: <span style={{color:C.rig,fontWeight:700}}>{fmtN(totalEHPp)}</span></span>}/>
        {isOpen("resists")&&<div onClick={()=>setShowProfilePicker(true)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"5px 12px",borderBottom:`1px solid ${C.border}`,background:`${C.surfaceAlt}88`,cursor:"pointer"}}>
          <span style={{fontSize:10,color:C.textMute}}>Incoming damage</span>
          <span style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{display:"flex",gap:3}}>
              {[["em",dmgProfile.p[0]],["th",dmgProfile.p[1]],["kin",dmgProfile.p[2]],["exp",dmgProfile.p[3]]].map(([k,v])=>(<span key={k} style={{width:5,height:5,borderRadius:99,background:DMG[k].color,opacity:v>0.001?0.4+v*0.6:0.12}}/>))}
            </span>
            <span style={{fontSize:11,fontWeight:700,color:C.accent,borderBottom:`1px dotted ${C.accent}`}}>{dmgProfile.name}</span>
          </span>
        </div>}
        {isOpen("resists")&&<>
        <div style={{display:"grid",gridTemplateColumns:"52px 1fr 1fr 1fr 1fr 44px",padding:"5px 12px 4px",borderBottom:`1px solid ${C.border}`}}>
          <span/>{Object.values(DMG).map(d=><span key={d.label} style={{fontSize:10,fontWeight:700,color:d.color,textAlign:"center"}}>{d.label}</span>)}<span style={{fontSize:10,fontWeight:700,color:C.textMute,textAlign:"right"}}>EHP</span>
        </div>
        {layers.map((layer,li)=>(<div key={layer.key}>
          <div style={{display:"grid",gridTemplateColumns:"52px 1fr 1fr 1fr 1fr 44px",padding:"5px 12px",alignItems:"center",borderBottom:`1px solid ${C.border}`}}>
            <span style={{fontSize:10,fontWeight:600,color:C.textMid}}>{layer.label}</span>
            {[{v:layer.em,d:DMG.em},{v:layer.th,d:DMG.th},{v:layer.kin,d:DMG.kin},{v:layer.exp,d:DMG.exp}].map(({v,d})=>(
              <div key={d.label} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                <div style={{width:"80%",height:3,background:C.border,borderRadius:99,overflow:"hidden"}}><div style={{width:`${v}%`,height:"100%",background:d.color,borderRadius:99}}/></div>
                <span style={{fontSize:10,fontWeight:600,color:d.color}}>{typeof v === "number" ? v.toFixed(1) : v}%</span>
              </div>
            ))}
            <span style={{fontSize:10,fontWeight:700,color:C.text,textAlign:"right"}}>{layer.ehp}</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"52px 1fr auto",padding:"3px 12px",borderBottom:(layers.length-1>li)?`1px solid ${C.border}`:"none",background:`${C.surfaceAlt}88`}}>
            <span style={{fontSize:9,color:C.textMute}}>HP: {layer.hp}</span>
            <span style={{fontSize:9,color:C.textMute,textAlign:"center"}}>{layer.regen||layer.repLabel||""}</span>
            <span style={{fontSize:9,fontWeight:700,color:C.rig,textAlign:"right"}}>{ehpForProfile(1,{em:layer.em,th:layer.th,kin:layer.kin,exp:layer.exp}).toFixed(2)}x</span>
          </div>
        </div>))}
        </>}
      </div>

      {/* Recharge Rates */}
      <div style={card}>
        <SectionHead id="recharge" title="Recharge Rates"/>
        {isOpen("recharge")&&(() => {
            // Convert HP/s to EHP/s using the selected incoming damage profile.
            const avgR=(r)=>((r?.em??0)+(r?.th??0)+(r?.kin??0)+(r?.exp??0))/4;
            const toEhp=(hps,layer)=>hps*ehpForProfile(1,cs.resists?.[layer]);
            // Precomputed cs.*EhpS were derived with AVERAGE resists in calc; reweight to the profile
            // (preserves their paste-phase raw rep nuance, swaps only the resist weighting).
            const avgMultOf=(layer)=>{const a=avgR(cs.resists?.[layer]);return a>=100?1:1/(1-a/100);};
            const reweight=(ehpS,layer)=>ehpS*ehpForProfile(1,cs.resists?.[layer])/Math.max(1e-6,avgMultOf(layer));
            // AAR/ASB EhpS arrive already profile-weighted from calc.js (their ehpMult uses the same
            // damage profile); regular-repairer EhpS use layerEHP (average resist) and must be
            // reweighted to the profile. `profiled` flags which case applies so we don't double-count.
            const repEhp=(ehpS,layer,profiled)=>profiled?ehpS:reweight(ehpS,layer);
            const shieldEhpS=toEhp(cs.passiveShieldRegen??0,'shield');
            const shieldRepEhpS=cs.shieldRepEhpS>0?repEhp(cs.shieldRepEhpS,'shield',cs.shieldRepIsASB):toEhp(cs.shieldRepPS??0,'shield');
            // Use slotEngineStats-based EHP/s (Pyfa style: paste phase, with resists)
            const armorRepEhpS=cs.armorRepEhpS>0?repEhp(cs.armorRepEhpS,'armor',cs.armorRepIsAAR):toEhp(cs.armorRepPS??0,'armor');
            const hullRepEhpS=toEhp(cs.hullRepPS??0,'hull');
            // Sustained (cap-limited) rep — pyfa style. Only differs from peak when cap-unstable.
            const susShieldEhpS=cs.shieldRepSustainedEhpS!=null?repEhp(cs.shieldRepSustainedEhpS,'shield',cs.shieldRepIsASB):toEhp(cs.sustainedShieldRepPS??cs.shieldRepPS??0,'shield');
            const susArmorEhpS =cs.armorRepSustainedEhpS!=null?repEhp(cs.armorRepSustainedEhpS,'armor',cs.armorRepIsAAR):toEhp(cs.sustainedArmorRepPS??cs.armorRepPS??0,'armor');
            const susHullEhpS  =toEhp(cs.sustainedHullRepPS??cs.hullRepPS??0,'hull');
            // Incoming remote reps (projected) → EHP/s by own resists. Included in FULL in both peak and
            // sustained, independent of the supplying ship's capacitor stability.
            const incShield=toEhp(projectedReps?.shield??0,'shield');
            const incArmor =toEhp(projectedReps?.armor??0,'armor');
            const incHull  =toEhp(projectedReps?.hull??0,'hull');
            const hasInc=(incShield+incArmor+incHull)>0.05;
            // Does the layer show a rep value at all (local rep present OR incoming reps present)?
            const showShield=(cs.shieldRepPS??0)>0||incShield>0.05;
            const showArmor =(cs.armorRepPS??0)>0||incArmor>0.05;
            const showHull  =(cs.hullRepPS??0)>0||incHull>0.05;
            const peak=[
              {label:"Shield Regen", val:`${fmtF(shieldEhpS)} EHP/s`, color:C.mid},
              {label:"Shield Boost", val:showShield?`${fmtF(shieldRepEhpS+incShield)} EHP/s`:"0 EHP/s", color:C.mid},
              {label:"Armor Rep",    val:showArmor?`${fmtF(armorRepEhpS+incArmor)} EHP/s`:"0 EHP/s",   color:C.warning},
              {label:"Hull Rep",     val:showHull?`${fmtF(hullRepEhpS+incHull)} EHP/s`:"0 EHP/s",     color:C.danger},
            ];
            // Sustained row values, aligned to the same columns (regen has no sustained variant → blank).
            // Sustained includes the full incoming remote rep (supplier-cap-independent).
            const sustained=[
              null,
              showShield?`${fmtF(susShieldEhpS+incShield)} EHP/s`:null,
              showArmor ?`${fmtF(susArmorEhpS+incArmor)} EHP/s`:null,
              showHull  ?`${fmtF(susHullEhpS+incHull)} EHP/s`:null,
            ];
            // Show the sustained row only when any LOCAL rep is cap-throttled (sustained < peak).
            const showSustained = (
              ((cs.shieldRepPS??0)>0 && susShieldEhpS < shieldRepEhpS-0.05) ||
              ((cs.armorRepPS??0)>0  && susArmorEhpS  < armorRepEhpS-0.05) ||
              ((cs.hullRepPS??0)>0   && susHullEhpS   < hullRepEhpS-0.05)
            );
            return(<>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",borderBottom:showSustained?`1px solid ${C.border}`:"none"}}>
                {peak.map((rr,i,arr)=>(
                  <div key={rr.label} style={{padding:"8px 8px",textAlign:"center",borderRight:arr.length>(i+1)?`1px solid ${C.border}`:"none"}}>
                    <div style={{fontSize:9,fontWeight:700,color:C.textMute,marginBottom:4,textTransform:"uppercase",letterSpacing:0.5}}>{rr.label}</div>
                    <div style={{fontSize:12,fontWeight:700,color:rr.val.startsWith("0")?C.textMute:rr.color}}>{rr.val}</div>
                  </div>
                ))}
              </div>
              {showSustained&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",background:`${C.surfaceAlt}88`}}>
                {sustained.map((val,i)=>(
                  <div key={i} style={{padding:"5px 8px",textAlign:"center",borderRight:i<3?`1px solid ${C.border}`:"none"}}>
                    {i===0
                      ? <div style={{fontSize:8,fontWeight:700,color:C.textMute,textTransform:"uppercase",letterSpacing:0.5}}>Sustained</div>
                      : <div style={{fontSize:11,fontWeight:700,color:val?peak[i].color:C.textMute}}>{val??"—"}</div>}
                  </div>
                ))}
              </div>}
              {hasInc&&<div style={{padding:"5px 12px",background:`${C.surfaceAlt}88`,fontSize:10,color:C.textMute,display:"flex",gap:10,flexWrap:"wrap"}}>
                <span style={{fontWeight:700,color:C.rig}}>incl. remote:</span>
                {incShield>0.05&&<span><span style={{color:C.mid,fontWeight:700}}>+{fmtF(incShield)}</span> shield</span>}
                {incArmor>0.05&&<span><span style={{color:C.warning,fontWeight:700}}>+{fmtF(incArmor)}</span> armor</span>}
                {incHull>0.05&&<span><span style={{color:C.danger,fontWeight:700}}>+{fmtF(incHull)}</span> hull</span>}
                <span>EHP/s</span>
              </div>}
            </>);
          })()}
      </div>

      {/* Firepower */}
      <div style={card}>
        <SectionHead id="firepower" title="Firepower" right={
          <button onClick={e=>{e.stopPropagation();setFactorInReload&&setFactorInReload(v=>!v);}}
            style={{display:"flex",alignItems:"center",gap:5,padding:"2px 7px",borderRadius:6,fontSize:9,fontWeight:700,cursor:"pointer",
              background:factorInReload?C.accentLight:C.surface,border:`1px solid ${factorInReload?C.accent:C.border}`,color:factorInReload?C.accent:C.textMute}}>
            <span style={{width:7,height:7,borderRadius:"50%",background:factorInReload?C.accent:C.textMute,display:"inline-block"}}/>
            Reload
          </button>
        }/>
        {isOpen("firepower")&&<>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",borderBottom:`1px solid ${C.border}`}}>
          {[["Weapon DPS",weapDpsDisp,"weapon"],["Drone DPS",droneDpsTotal,"drone"],["Total DPS",totalDpsDisp,"total"],["Volley",totalVolDisp,"volley"]].map(([label,val,srcKey],i,arr)=>{
            const sel=dmgSource===srcKey;
            return(
            <div key={label} onClick={()=>setDmgSource(srcKey)} style={{padding:"8px 6px",textAlign:"center",borderRight:arr.length>(i+1)?`1px solid ${C.border}`:"none",cursor:"pointer",background:sel?C.accentLight:"transparent"}}>
              <div style={{fontSize:14,fontWeight:800,color:val==="0"?C.textMute:(sel?C.accent:C.text)}}>{val}</div>
              <div style={{fontSize:9,color:sel?C.accent:C.textMute,marginTop:1}}>{label}</div>
            </div>);
          })}
        </div>
        {hasSpool&&(cs.weaponSpoolTimeS??0)>0&&<div style={{padding:"5px 12px",background:`${C.surfaceAlt}88`,display:"flex",justifyContent:"space-between",fontSize:10,borderBottom:`1px solid ${C.border}`}}>
          <span style={{color:C.textMute}}>Spool-up time</span>
          <span style={{color:C.text,fontWeight:700}}>{fmtF(cs.weaponSpoolTimeS)}s</span>
        </div>}
        {(dmgSplit.total??0)>0&&<div style={{padding:"6px 12px",background:`${C.surfaceAlt}88`,display:"flex",gap:10,fontSize:10,alignItems:"center",flexWrap:"wrap"}}>
          <span style={{color:C.textMute,fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:.3}}>{dmgSourceLabel}</span>
          {[["EM",dmgSplit.em,DMG.em.color],["Thermal",dmgSplit.th,DMG.th.color],["Kinetic",dmgSplit.kin,DMG.kin.color],["Explosive",dmgSplit.exp,DMG.exp.color]].filter(([,v])=>(v??0)>0.05).map(([l,v,c])=>(
            <span key={l}><span style={{color:c,fontWeight:700}}>{fmtDps(v)}</span> <span style={{color:C.textMute}}>{l}</span></span>
          ))}
        </div>}
        </>}
      </div>

      {/* Remote Reps — text labels, same style as other sections */}
      {(cs.remoteRepModules?.length??0)>0&&(()=>{
        // Triglavian logistics: a Mutadaptive remote armor repairer spools its rep amount.
        const spoolRep = (cs.remoteRepModules||[]).find(m=>(m.spoolFactor??1)>1);
        const armorMax = spoolRep ? (cs.remoteArmorPS??0) - (spoolRep.repPS??0) + (spoolRep.repPSMax??0) : (cs.remoteArmorPS??0);
        // pyfa column order: Cap, Shield, Armor, Hull
        const cols=[
          {key:"cap",   label:"Cap",    unit:"GJ/s", val:cs.remoteCapPS??0,    color:C.rig},
          {key:"shield",label:"Shield", unit:"HP/s", val:cs.remoteShieldPS??0, color:C.mid},
          {key:"armor", label:"Armor",  unit:"HP/s", val:cs.remoteArmorPS??0,  color:C.warning,
            disp: spoolRep ? `${fmtF(cs.remoteArmorPS??0)}-${fmtF(armorMax)} HP/s` : null},
          {key:"hull",  label:"Hull",   unit:"HP/s", val:cs.remoteHullPS??0,   color:C.danger},
        ];
        return(
          <div style={card}>
            <SectionHead id="remotereps" title="Remote Reps"/>
            {isOpen("remotereps")&&<>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",borderBottom:spoolRep?`1px solid ${C.border}`:"none"}}>
              {cols.map((col,i)=>(
                <div key={col.key} style={{padding:"8px 6px",textAlign:"center",borderRight:i<cols.length-1?`1px solid ${C.border}`:"none"}}>
                  <div style={{fontSize:9,fontWeight:700,color:C.textMute,marginBottom:4,textTransform:"uppercase",letterSpacing:0.5}}>{col.label}</div>
                  <div style={{fontSize:12,fontWeight:700,color:col.val>0?col.color:C.textMute}}>{col.disp??`${fmtF(col.val)} ${col.unit}`}</div>
                </div>
              ))}
            </div>
            {spoolRep&&(spoolRep.spoolTimeS??0)>0&&<div style={{padding:"5px 12px",background:`${C.surfaceAlt}88`,display:"flex",justifyContent:"space-between",fontSize:10}}>
              <span style={{color:C.textMute}}>Spool-up time</span>
              <span style={{color:C.text,fontWeight:700}}>{fmtF(spoolRep.spoolTimeS)}s</span>
            </div>}
            </>}
          </div>
        );
      })()}

      {/* Cap */}
      <div style={card}>
        <SectionHead id="cap" title="Capacitor" right={(()=>{
          const fmtDur=(s)=>{if(s==null)return "?";s=Math.round(s);if(s<60)return s+"s";const m=Math.floor(s/60),sec=s%60;if(m<60)return sec?`${m}m ${sec}s`:`${m}m`;const h=Math.floor(m/60),mm=m%60;return mm?`${h}h ${mm}m`:`${h}h`;};
          return cs.capStable
            ?<span style={{fontSize:11,fontWeight:700,color:C.success}}>Stable at {((cs.capLevel??1)*100).toFixed(1)}%</span>
            :<span style={{fontSize:11,fontWeight:700,color:C.danger}}>Unstable - depleted in {fmtDur(cs.capTime)}</span>;
        })()}/>
        {isOpen("cap")&&<>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",borderBottom:`1px solid ${C.border}`}}>
          <div style={{padding:"7px 8px",textAlign:"center",borderRight:`1px solid ${C.border}`}}><div style={{fontSize:12,fontWeight:700,color:C.warning}}>{fmtN(cs.capCapacity??0)} GJ</div><div style={{fontSize:9,color:C.textMute}}>Capacity</div></div>
          <div onClick={()=>setCapDeltaMode(m=>m==="net"?"inout":"net")} style={{padding:"7px 8px",textAlign:"center",borderRight:`1px solid ${C.border}`,cursor:"pointer"}}>
            {capDeltaMode==="net"
              ?<><div style={{fontSize:12,fontWeight:700,color:cs.capDelta>=0?C.success:C.danger}}>{(cs.capDelta??0)>=0?"+":""}{fmtF(cs.capDelta??0)}</div><div style={{fontSize:9,color:C.textMute,borderBottom:`1px dotted ${C.textMute}`,display:"inline-block",lineHeight:1.3}}>Net GJ/s</div></>
              :<><div style={{fontSize:11,fontWeight:700,lineHeight:1.35}}><span style={{color:C.success}}>+{fmtF(capInGJs)}</span> <span style={{color:C.danger}}>-{fmtF(cs.capDrainPS??0)}</span></div><div style={{fontSize:9,color:C.textMute,borderBottom:`1px dotted ${C.textMute}`,display:"inline-block",lineHeight:1.3}}>In / Out GJ/s</div></>}
          </div>
          <div onClick={()=>setPeakMode(m=>m==="regen"?"neut":"regen")} style={{padding:"7px 8px",textAlign:"center",cursor:"pointer"}}>
            {peakMode==="regen"
              ?<><div style={{fontSize:12,fontWeight:700,color:C.textMid}}>{fmtF(peakRegen(cs.capCapacity,cs.capRechargeMs))} GJ/s</div><div style={{fontSize:9,color:C.textMute,borderBottom:`1px dotted ${C.textMute}`,display:"inline-block",lineHeight:1.3}}>Peak regen</div></>
              :<><div style={{fontSize:12,fontWeight:700,color:neutResistPct>0.05?C.rig:C.textMid}}>{neutResistPct.toFixed(1)}%</div><div style={{fontSize:9,color:C.textMute,borderBottom:`1px dotted ${C.textMute}`,display:"inline-block",lineHeight:1.3}}>Neut resist</div></>}
          </div>
        </div>
        <Row label="Recharge time" value={`${((cs.capRechargeMs??0)/1000).toFixed(0)} s`} last/>
        </>}
      </div>

      {/* Targeting & Misc */}
      <div style={card}>
        <SectionHead id="targeting" title="Targeting and Misc"/>
        {isOpen("targeting")&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr"}}>
          {[
            ["Targets",   String(Math.round(cs.maxTargets??0))],
            ["Speed", `${Math.round((cs.maxVelocityAB&&cs.maxVelocityAB!==cs.maxVelocity)?cs.maxVelocityAB:(cs.maxVelocity??0))} m/s`],
            ["Lock range",`${fmtF(cs.targetRange??0)} km`],
            ["Align",     `${fmtF(cs.alignTime??0)} s`],
            ["Scan res.", `${fmtN(cs.scanRes??0)} mm`],
            ["Signature", `${fmtN(cs.sigRadius??0)} m`],
            ["Sensor",    `${cs.sensorStrength??0} ${cs.sensorType??""}`],
            ["Warp",      `${fmtF(cs.warpSpeed??3)} AU/s`],
            ...(cs.droneBay>0?[["Drone range",`${fmtN(Math.round((cs.droneControlRange??0)/1000))} km`]]:[]),
            ["Cargo",     `${fmtN(cs.cargoCapacity??0)} m³`],
          ].map(([label,val],i,arr)=>{
            const bb=arr.length>(i+2)?`1px solid ${C.border}`:"none";
            const br=(i%2===0)?`1px solid ${C.border}`:"none";
            return(<div key={label} style={{padding:"5px 12px",fontSize:11,borderBottom:bb,borderRight:br,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{color:C.textMid}}>{label}</span><span style={{fontWeight:600,color:C.text}}>{val}</span>
            </div>);
          })}
        </div>}
      </div>
    </div>
  );
}

// ═══ GRAPH TAB ══════════════════════════════════════════════════
function ActiveFitBar({activeFit,onReturn}){
  if(!activeFit)return null;
  const ship=lookupShip(activeFit.ship);
  return(<div onClick={onReturn} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 14px",background:C.accentLight,borderBottom:`1px solid ${C.accentBorder}`,cursor:"pointer",flexShrink:0}}>
    <div style={{display:"flex",alignItems:"center",gap:9}}>
      {ship.typeID&&<img className="eve-icon" src={eveRender(ship.typeID,32)} width={28} height={28} alt="" style={{borderRadius:4}} onError={e=>{e.target.style.display="none";}}/>}
      <div><div style={{fontSize:11,fontWeight:700,color:C.accent,lineHeight:1.2}}>{activeFit.ship}</div><div style={{fontSize:10,color:C.textMid,marginTop:1}}>{activeFit.fitName}</div></div>
    </div>
    <div style={{display:"flex",alignItems:"center",gap:4}}><span style={{fontSize:11,fontWeight:600,color:C.accent}}>Return to Fit</span><span style={{fontSize:16,color:C.accent}}>{">"}</span></div>
  </div>);
}

// ═══ FITTINGS SCREEN ═══════════════════════════════════════════
function RecentFitsList({fitsDB, activeFit, loadFit}) {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem('pyfa_recent_open') !== '0'; } catch { return true; }
  });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem('pyfa_recent_open', next ? '1' : '0'); } catch {}
  };
  const recentFits = Object.entries(fitsDB)
    .flatMap(([ship, fits]) => fits.map(f => ({ship, fit:f})))
    .sort((a,b) => (b.fit.modified||0) - (a.fit.modified||0))
    .slice(0, 8);
  if (!recentFits.length) return null;
  return (
    <div style={{marginBottom:12}}>
      <div onClick={toggle} style={{display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',padding:'4px 0',marginBottom:open?6:0}}>
        <span style={{fontSize:11,fontWeight:700,color:C.textMute,textTransform:'uppercase',letterSpacing:.5}}>Recent Fits</span>
        <span style={{fontSize:11,color:C.textMute}}>{open ? '▲' : '▼'}</span>
      </div>
      {open && recentFits.map(({ship, fit}) => (
        <div key={fit.id} onClick={()=>loadFit(ship, fit.name)}
          style={{display:'flex',alignItems:'center',gap:10,padding:'9px 12px',borderRadius:8,cursor:'pointer',
                  background:activeFit?.fitName===fit.name&&activeFit?.ship===ship?C.accentLight:C.surface,
                  border:`1px solid ${activeFit?.fitName===fit.name&&activeFit?.ship===ship?C.accentBorder:C.border}`,marginBottom:4}}>
          <img src={eveIcon(Object.entries(shipsByClass||{}).flatMap(([,ships])=>ships).find(s=>s.name===ship)?.typeID,32)}
               style={{width:32,height:32,borderRadius:4,objectFit:'contain',background:C.surfaceAlt,flexShrink:0}} 
               onError={e=>e.target.style.display='none'} alt=""/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:12,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fit.name}</div>
            <div style={{fontSize:10,color:C.textMute,marginTop:1}}>{ship}</div>
          </div>
        </div>
      ))}
    </div>
  );
}


function ShipInfoSheet({ship, onClose}) {
  const [tab, setTab] = useState('traits');
  const traits = ship?.typeID ? ((shipTraits??{})[String(ship.typeID)] ?? {}) : {};
  const tabs = ['traits','description','attributes'];

  const TraitSection = ({header, bonuses}) => (
    <div style={{marginBottom:14}}>
      <div style={{fontSize:12,fontWeight:700,color:C.text,marginBottom:6}}>{header}</div>
      {(bonuses||[]).map((b,i) => (
        <div key={i} style={{display:'flex',gap:8,padding:'3px 0'}}>
          {b.number && <span style={{fontSize:12,fontWeight:700,color:C.accent,minWidth:44,flexShrink:0}}>{b.number}</span>}
          <span style={{fontSize:12,color:C.textMid}}>{b.text}</span>
        </div>
      ))}
    </div>
  );

  const attrs = {
    fitting: [
      ['CPU Output', `${ship?.cpu ?? '-'} tf`],
      ['Powergrid Output', `${ship?.pg ?? '-'} MW`],
      ['High Slots', ship?.highSlots ?? '-'],
      ['Mid Slots', ship?.midSlots ?? '-'],
      ['Low Slots', ship?.lowSlots ?? '-'],
      ['Rig Slots', ship?.rigSlots ?? '-'],
      ['Turret Hardpoints', ship?.turrets ?? '-'],
    ],
    structure: [
      ['Shield HP', `${ship?.shieldHP ?? '-'} HP`],
      ['Armor HP', `${ship?.armorHP ?? '-'} HP`],
      ['Hull HP', `${ship?.hullHP ?? '-'} HP`],
      ['Mass', ship?.mass ? `${(ship.mass/1e6).toFixed(2)}M kg` : '-'],
      ['Max Velocity', `${ship?.maxVelocity ?? '-'} m/s`],
      ['Drone Bay', `${ship?.droneBay ?? '-'} m³`],
      ['Drone Bandwidth', `${ship?.droneBW ?? '-'} Mbit/s`],
    ],
  };

  return (
    <div style={{position:'fixed',inset:0,zIndex:300,display:'flex',flexDirection:'column'}}
         onClick={onClose}>
      <div style={{flex:1,background:'rgba(0,0,0,.5)'}}/>
      <div style={{background:C.surface,borderRadius:'16px 16px 0 0',maxHeight:'85vh',
                   display:'flex',flexDirection:'column',boxShadow:'0 -8px 32px rgba(0,0,0,.5)'}}
           onClick={e=>e.stopPropagation()}>
        {/* Header */}
        <div style={{display:'flex',alignItems:'center',gap:12,padding:'16px 16px 12px',borderBottom:`1px solid ${C.border}`}}>
          <img src={eveIcon(ship?.typeID,64)}
               style={{width:48,height:48,borderRadius:8,background:'#0d0d1a',flexShrink:0}}
               onError={e=>e.target.style.opacity='0'} alt=""/>
          <div>
            <div style={{fontSize:16,fontWeight:700,color:C.text}}>{ship?.name}</div>
            <div style={{fontSize:11,color:C.textMute,marginTop:2}}>{ship?.groupName}</div>
          </div>
          <button onClick={onClose} style={{marginLeft:'auto',background:'none',border:'none',
            color:C.textMute,fontSize:20,cursor:'pointer',padding:'0 4px'}}>×</button>
        </div>
        {/* Tab bar */}
        <div style={{display:'flex',borderBottom:`1px solid ${C.border}`}}>
          {tabs.map(t => (
            <button key={t} onClick={()=>setTab(t)}
              style={{flex:1,padding:'9px 4px',background:'none',border:'none',cursor:'pointer',
                      fontSize:12,fontWeight:600,color:tab===t?C.accent:C.textMute,
                      borderBottom:tab===t?`2px solid ${C.accent}`:'2px solid transparent',
                      textTransform:'capitalize'}}>
              {t}
            </button>
          ))}
        </div>
        {/* Tab content */}
        <div style={{flex:1,overflowY:'auto',padding:'14px 16px'}}>
          {tab==='traits' && (
            <div>
              {traits.skills?.map((s,i) => <TraitSection key={i} header={s.header} bonuses={s.bonuses}/>)}
              {traits.role && <TraitSection header={traits.role.header||'Role Bonus:'} bonuses={traits.role.bonuses}/>}
              {traits.misc && <TraitSection header={traits.misc.header||'Misc:'} bonuses={traits.misc.bonuses}/>}
              {!traits.skills?.length && !traits.role && (
                <div style={{color:C.textMute,fontSize:13}}>No trait data available.</div>
              )}
            </div>
          )}
          {tab==='description' && (
            <div style={{fontSize:13,color:C.textMid,lineHeight:1.6}}>
              {traits.desc || 'No description available.'}
            </div>
          )}
          {tab==='attributes' && (
            <div>
              {Object.entries(attrs).map(([section, rows]) => (
                <div key={section} style={{marginBottom:16}}>
                  <div style={{fontSize:11,fontWeight:700,color:C.textMute,textTransform:'uppercase',
                    letterSpacing:.5,marginBottom:8}}>{section}</div>
                  {rows.filter(([,v]) => v !== '-' && v !== 'undefined').map(([label, val]) => (
                    <div key={label} style={{display:'flex',justifyContent:'space-between',
                      padding:'5px 0',borderBottom:`1px solid ${C.border}`}}>
                      <span style={{fontSize:12,color:C.textMid}}>{label}</span>
                      <span style={{fontSize:12,fontWeight:600,color:C.text}}>{val}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


function FittingsScreen({activeFit,setActiveFit,loadFit,view,setView,fitsDB,setFitsDB,slots,setSlots,setDrones,setFighters,fighters,setCargoItems,setImplants,setBoosters,setProjFits,setCmdFits,skills,implants,boosters,drones,factorInReload,setFactorInReload,externalBursts,projectedReps,projectedEffects,dmgProfile,setDmgProfile}){
  const[selectedClass,setSelectedClass]=useState(null);
  const[selectedShip,setSelectedShip]=useState(activeFit?.ship??null);
  const[fitSubTab,setFitSubTab]=useState("Fit");
  // Horizontal swipe between Fit / Stats / Graph. Only fires on horizontal-dominant swipes
  // past a threshold, so vertical scrolling and module drag-reorder are unaffected.
  const _SUBTABS=["Fit","Stats","Graph"];
  const _swipe=useRef({x:0,y:0});
  const _onSwipeStart=e=>{const t=e.touches[0];if(t)_swipe.current={x:t.clientX,y:t.clientY};};
  const _onSwipeEnd=e=>{const t=e.changedTouches[0];if(!t)return;const dx=t.clientX-_swipe.current.x,dy=t.clientY-_swipe.current.y;
    if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.6){const i=_SUBTABS.indexOf(fitSubTab);
      if(dx<0&&i<_SUBTABS.length-1){setFitSubTab(_SUBTABS[i+1]);haptic();}
      else if(dx>0&&i>0){setFitSubTab(_SUBTABS[i-1]);haptic();}}};
  const[search,setSearch]=useState("");
  const[nextId,setNextId]=useState(()=>Object.values(fitsDB).reduce((max,fits)=>fits.reduce((m,f)=>Math.max(m,f.id+1),max),20));
  const[editingFitId,setEditingFitId]=useState(null);
  const[editName,setEditName]=useState("");
  const[renamingFit,setRenamingFit]=useState(false);
  // showShipInfo moved to App() state
  const[newFitName,setNewFitName]=useState("");

  // Slots lifted here so StatsTab + GraphTab can read fitted modules
  const activeShip=activeFit?.ship?lookupShip(activeFit.ship):null;
  // slots/setSlots lifted to App root to persist across tab switches

  const saveRename=(ship,fitId)=>{
    const name=editName.trim()||"Unnamed Fit";
    const now=new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
    setFitsDB(prev=>({...prev,[ship]:prev[ship].map(f=>f.id===fitId?{...f,name,modified:now}:f)}));
    if(activeFit?.ship===ship&&activeFit?.fitName===fitsDB[ship]?.find(f=>f.id===fitId)?.name)
      setActiveFit(prev=>({...prev,fitName:name}));
    setEditingFitId(null);
  };

  const createNewFit=ship=>{
    const now=new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
    const emptySlots=generateEmptySlots(lookupShip(ship));
    const nf={id:nextId,name:"New Fit",modified:now,slots:emptySlots};
    setFitsDB(prev=>({...prev,[ship]:[...(prev[ship]||[]),nf]}));
    setNextId(n=>n+1);
    setActiveFit({ship,fitName:"New Fit"});
    setSlots(emptySlots);
    setDrones([]);setFighters([]);setCargoItems([]);setImplants(Array.from({length:10},(_,i)=>({slot:i+1,name:"[Empty]",bonus:null})));setBoosters([]);setProjFits([]);setCmdFits([]);
    setSelectedShip(ship);
    setView("active");
  };

  const searchResults=search.trim().length>1?(()=>{
    const q=search.toLowerCase(),results=[];
    Object.entries(shipsByClass||{}).forEach(([cls,ships])=>{
      ships.forEach(s=>{
        if(s.name.toLowerCase().includes(q))results.push({type:"ship",ship:s.name,hull:cls,race:"",color:C.rig});
        (fitsDB[s.name]||[]).forEach(fit=>{if(fit.name.toLowerCase().includes(q))results.push({type:"fit",ship:s.name,hull:cls,race:"",fitName:fit.name,modified:fit.modified,color:C.accent});});
      });
    });
    return results;
  })():null;

  // Browse view
  if(view==="browse")return(<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
    <div style={{padding:"8px 10px",borderBottom:`1px solid ${C.border}`,background:C.surface}}>
      <div style={{display:"flex",alignItems:"center",gap:8,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 10px"}}>
        <span style={{fontSize:14,color:C.textMute}}>&#128269;</span>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search ships or fit names..." style={{flex:1,background:"none",border:"none",color:C.text,fontSize:13}}/>
        {search&&<button onClick={()=>setSearch("")} style={{background:"none",border:"none",color:C.textMute,cursor:"pointer",fontSize:16,padding:0}}>x</button>}
      </div>
    </div>
    <div style={{flex:1,overflowY:"auto",padding:"8px 10px"}}>
      {!search&&<RecentFitsList fitsDB={fitsDB} activeFit={activeFit} loadFit={loadFit}/>}
      {searchResults&&(<>
        <div style={{fontSize:11,color:C.textMute,marginBottom:8}}>{searchResults.length} result{searchResults.length!==1?"s":""} for "{search}"</div>
        {searchResults.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"32px 0"}}>No ships or fits found</div>}
        {searchResults.map((rr,i)=>(<div key={i} onClick={()=>{setSelectedShip(rr.ship);setView(rr.type==="fit"?"active":"fits");if(rr.type==="fit")loadFit(rr.ship,rr.fitName);}} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,marginBottom:4,cursor:"pointer"}}>
          <img src={eveIcon((Object.values(shipsByClass||{}).flat().find(s=>s.name===rr.ship)||{}).typeID,32)} style={{width:28,height:28,borderRadius:4,objectFit:'contain',background:'#1a1a2e',flexShrink:0}} onError={e=>{e.target.style.background=rr.color;e.target.style.display='block';}} alt=""/>
          <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{rr.type==="fit"?rr.fitName:rr.ship}</div><div style={{fontSize:10,color:C.textMute,marginTop:1}}>{rr.ship} / {rr.hull} / {rr.race}</div></div>
          <span style={{fontSize:10,color:rr.type==="fit"?C.accent:C.textMute,background:rr.type==="fit"?C.accentLight:C.border,borderRadius:99,padding:"1px 7px",fontWeight:600,flexShrink:0}}>{rr.type==="fit"?"fit":"ship"}</span>
        </div>))}
      </>)}
      {!searchResults&&Object.entries(shipsByClass||{}).sort(([a],[b])=>a.localeCompare(b)).map(([cls, ships])=>{
        const fitCount=ships.reduce((s,sh)=>s+(fitsDB[sh.name]||[]).length,0);
        return (
          <div key={cls} onClick={()=>{setSelectedClass(cls);setView("class-ships");}}
            style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px",borderBottom:`1px solid ${C.border}`,cursor:"pointer",background:selectedClass===cls?C.accentLight:"transparent"}}>
            <span style={{fontSize:16}}>🚀</span>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:600,color:selectedClass===cls?C.accent:C.text}}>{cls}</div>
              <div style={{fontSize:10,color:C.textMute,marginTop:1}}>{ships.length} ships{fitCount>0?` · ${fitCount} fits`:""}</div>
            </div>
            <span style={{color:C.textMute,fontSize:16}}>{">"}</span>
          </div>
        );
      })}
    </div>
  </div>);

  // Class-ships view
  if(view==="class-ships"){
    const classShips=(shipsByClass[selectedClass]||[]).sort((a,b)=>a.name.localeCompare(b.name));
    return(<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderBottom:`1px solid ${C.border}`,background:C.surfaceAlt}}>
        <button onClick={()=>setView("browse")} style={{background:"none",border:"none",color:C.accent,fontSize:13,cursor:"pointer",fontWeight:600,padding:0}}>Back</button>
        <span style={{fontSize:16}}>🚀</span><span style={{fontSize:14,fontWeight:700,color:C.text,flex:1}}>{selectedClass}</span>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"8px 10px"}}>
        {classShips.map(s=>{
          const sfits=(fitsDB[s.name]||[]);
          return(<div key={s.typeID} style={{marginBottom:4}}>
            <div onClick={()=>{setSelectedShip(s.name);setView('fits');}} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",borderRadius:8,cursor:"pointer",background:selectedShip===s.name?C.accentLight:C.surface,border:`1px solid ${selectedShip===s.name?C.accentBorder:C.border}`}}>
              <img src={eveIcon(s.typeID,64)}
                   style={{width:40,height:40,borderRadius:4,objectFit:'contain',background:'#1a1a2e',flexShrink:0}}
                   onError={e=>{e.target.style.display='none';}} alt=""/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',alignItems:'center',gap:5}}>
                  {(raceIcons??{})[String(s.raceID)]&&<img src={raceIcons[String(s.raceID)]} style={{width:14,height:14,objectFit:'contain',flexShrink:0}} alt=""/>}
                  <span style={{fontSize:13,fontWeight:600,color:selectedShip===s.name?C.accent:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.name}</span>
                </div>
                <div style={{fontSize:10,color:C.textMute,marginTop:2}}>{sfits.length>0?`${sfits.length} fit${sfits.length!==1?'s':''}`:'No fits'}</div>
              </div>
            </div>
            {selectedShip===s.name&&sfits.length>0&&<div style={{paddingLeft:16,marginTop:2}}>
              {sfits.map(fit=>(<div key={fit.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 12px",borderRadius:6,cursor:"pointer",background:C.surfaceAlt,marginBottom:2,border:`1px solid ${activeFit?.fitName===fit.name&&activeFit?.ship===s.name?C.accentBorder:C.border}`}} onClick={()=>loadFit(s.name,fit.name)}>
                <div style={{flex:1}}><div style={{fontSize:12,fontWeight:600,color:activeFit?.fitName===fit.name&&activeFit?.ship===s.name?C.accent:C.text}}>{fit.name}</div><div style={{fontSize:10,color:C.textMute,marginTop:1}}>Modified {fit.modified}</div></div>
                <span style={{color:C.textMute,fontSize:13}}>{">"}</span>
              </div>))}
            </div>}
          </div>);
        })}
      </div>
    </div>);
  }

  // Fits list view
  if(view==="fits"){
    const fits=fitsDB[selectedShip]||[];
    return(<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderBottom:`1px solid ${C.border}`,background:C.surfaceAlt}}>
        <button onClick={()=>setView(selectedClass?"class-ships":"browse")} style={{background:"none",border:"none",color:C.accent,fontSize:13,cursor:"pointer",fontWeight:600,padding:0}}>Back</button>
        <span style={{fontSize:14,fontWeight:700,color:C.text,flex:1}}>{selectedShip}</span>
        <button onClick={()=>createNewFit(selectedShip)} style={{padding:"6px 12px",background:C.accent,border:"none",borderRadius:7,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>+ New Fit</button>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:12}}>
        {fits.length===0&&<div style={{textAlign:"center",color:C.textMute,marginTop:40,fontSize:13}}>No saved fits - tap + New Fit to start</div>}
        {fits.map(fit=>(<div key={fit.id} style={{display:"flex",alignItems:"center",gap:8,padding:"12px 14px",background:C.surface,border:`1px solid ${activeFit?.fitName===fit.name&&activeFit?.ship===selectedShip?C.accentBorder:C.border}`,borderRadius:10,marginBottom:8}}>
          <div style={{flex:1,minWidth:0,cursor:"pointer"}} onClick={()=>{if(editingFitId!==fit.id){loadFit(selectedShip,fit.name);setView("active");}}}>
            {editingFitId===fit.id
              ?<input autoFocus value={editName} onChange={e=>setEditName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveRename(selectedShip,fit.id);if(e.key==="Escape")setEditingFitId(null);}} onBlur={()=>saveRename(selectedShip,fit.id)} onClick={e=>e.stopPropagation()} style={{width:"100%",background:C.surfaceAlt,border:`1px solid ${C.accentBorder}`,borderRadius:6,padding:"4px 8px",color:C.text,fontSize:13,fontWeight:600,boxSizing:"border-box"}}/>
              :<div style={{fontSize:13,fontWeight:600,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{fit.name}</div>
            }
            <div style={{fontSize:11,color:C.textMute,marginTop:2}}>Modified {fit.modified}</div>
          </div>
          <button onClick={e=>{e.stopPropagation();setEditingFitId(fit.id);setEditName(fit.name);}} style={{width:28,height:28,borderRadius:6,background:editingFitId===fit.id?C.accentLight:C.surfaceAlt,border:`1px solid ${editingFitId===fit.id?C.accentBorder:C.border}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0}}>&#9998;</button>
          <button onClick={e=>{e.stopPropagation();if(window.confirm(`Delete fit "${fit.name}"?`)){setFitsDB(prev=>{const next={...prev,[selectedShip]:(prev[selectedShip]||[]).filter(f=>f.id!==fit.id)};if(!next[selectedShip].length)delete next[selectedShip];return next;});if(activeFit?.fitName===fit.name&&activeFit?.ship===selectedShip)setActiveFit(null);}}} style={{width:28,height:28,borderRadius:6,background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.25)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,color:C.danger,flexShrink:0,lineHeight:1}} title="Delete fit">&times;</button>
          <button onClick={()=>{loadFit(selectedShip,fit.name);setView("active");}} style={{width:28,height:28,borderRadius:6,background:C.surfaceAlt,border:`1px solid ${C.border}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,color:C.textMute,flexShrink:0}}>{">"}</button>
        </div>))}
      </div>
    </div>);
  }

  // Active fit view
  return(<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
    <div style={{background:C.surface,borderBottom:`1px solid ${C.border}`}}>
      <div style={{display:"flex",alignItems:"center",padding:"6px 12px 0",gap:8}}>
        <button onClick={()=>{setSelectedShip(activeFit?.ship??null);setView("fits");}} style={{background:"none",border:"none",color:C.accent,fontSize:12,cursor:"pointer",fontWeight:600,padding:"3px 0",flexShrink:0}}>Fits</button>
        <div style={{flex:1,minWidth:0}}>
          {renamingFit
            ?<input autoFocus value={newFitName} onChange={e=>setNewFitName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){const now=new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});setFitsDB(prev=>({...prev,[activeFit.ship]:(prev[activeFit.ship]||[]).map(f=>f.name===activeFit.fitName?{...f,name:newFitName.trim()||activeFit.fitName,modified:now}:f)}));setActiveFit(prev=>({...prev,fitName:newFitName.trim()||prev.fitName}));setRenamingFit(false);}if(e.key==="Escape")setRenamingFit(false);}} onBlur={()=>setRenamingFit(false)} style={{width:"100%",background:C.surfaceAlt,border:`1px solid ${C.accentBorder}`,borderRadius:6,padding:"3px 8px",color:C.text,fontSize:12,fontWeight:700,boxSizing:"border-box"}}/>
            :<button onClick={()=>{setNewFitName(activeFit?.fitName||"");setRenamingFit(true);}} style={{background:"none",border:"none",cursor:"pointer",textAlign:"center",padding:0,display:"flex",alignItems:"center",justifyContent:"center",gap:6,width:"100%"}}>
              <span style={{fontSize:12,fontWeight:700,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{activeFit?.fitName||"Unnamed Fit"}</span>
              <span style={{fontSize:10,color:C.textMute,flexShrink:0}}>&#9998;</span>
            </button>
          }
        </div>

      </div>
      <div style={{display:"flex"}}><div style={{width:60}}/>{["Fit","Stats","Graph"].map(t=><button key={t} onClick={()=>setFitSubTab(t)} style={{flex:1,padding:"7px 0",fontSize:13,fontWeight:600,background:"none",border:"none",cursor:"pointer",color:fitSubTab===t?C.accent:C.textMute,borderBottom:fitSubTab===t?`2px solid ${C.accent}`:"2px solid transparent"}}>{t}</button>)}</div>
    </div>
    <div onTouchStart={_onSwipeStart} onTouchEnd={_onSwipeEnd} style={{flex:1,display:"flex",flexDirection:"column",minHeight:0,overflow:"hidden"}}>
    {fitSubTab==="Fit"   &&<FitTab   ship={activeShip} slots={slots} setSlots={setSlots} skills={skills} implants={implants} boosters={boosters} drones={drones} factorInReload={factorInReload} externalBursts={externalBursts} projectedEffects={projectedEffects} dmgProfile={dmgProfile}/>}
    {fitSubTab==="Stats" &&<StatsTab ship={activeShip} slots={slots} skills={skills} implants={implants} boosters={boosters} drones={drones} fighters={fighters} factorInReload={factorInReload} setFactorInReload={setFactorInReload} externalBursts={externalBursts} projectedReps={projectedReps} projectedEffects={projectedEffects} dmgProfile={dmgProfile} setDmgProfile={setDmgProfile}/>}
    {fitSubTab==="Graph" &&<GraphTab ship={activeShip} slots={slots} skills={skills} implants={implants} boosters={boosters} drones={drones} factorInReload={factorInReload} externalBursts={externalBursts} projectedEffects={projectedEffects}/>}
    </div>
  </div>);
}

// ═══ CARGO SCREEN - drill-down browser ═════════════════════════
// ═══ MARKET BROWSER (pyfa market tree) ═════════════════════════
function CargoBrowserSheet({onAdd,onClose,slots}){
  const[search,setSearch]=useState("");
  const[path,setPath]=useState([]);        // drill path of market group ids
  const[fitCharges,setFitCharges]=useState(false);
  const cur=path.length?path[path.length-1]:null;
  const subGroups=cur==null?MT_ROOTS:(MT_CHILDREN[cur]??[]);
  const items=cur==null?[]:(MT_ITEMS[cur]??[]);
  const searchResults=search.trim().length>1
    ?MT_ALL_ITEMS.filter(i=>i.name.toLowerCase().includes(search.toLowerCase())).slice(0,60)
    :null;
  const crumb=path.map(g=>marketTreeData.g[g]?.n).filter(Boolean).join(" > ");

  // "Charges for Active Fit": union of compatible charges across all fitted modules (pyfa feature)
  const fitChargeList=(()=>{
    if(!fitCharges||!slots)return null;
    const seen=new Map();
    for(const sec of ["high","mid","low"]){
      for(const m of (slots[sec]??[])){
        if(m.type==="empty"||!m.name)continue;
        for(const c of getCompatibleCharges(m)){
          if(!seen.has(c.name)){
            const mt=marketTreeData.t[c.typeID];
            seen.set(c.name,{typeID:c.typeID,name:c.name,vol:c.volume??mt?.[2]??0.01,forMod:m.name});
          }
        }
      }
    }
    return Array.from(seen.values()).sort((a,b)=>a.name.localeCompare(b.name));
  })();

  function ItemRow({item}){
    return(<div onClick={()=>{onAdd({name:item.name,vol:item.vol??0,typeID:item.typeID});}}
      style={{display:"flex",alignItems:"center",gap:10,padding:"10px 16px",borderBottom:`1px solid ${C.border}`,cursor:"pointer"}}>
      <div style={{width:32,height:32,borderRadius:7,flexShrink:0,overflow:"hidden",background:C.surfaceAlt,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
        {item.typeID?<img className="eve-icon" src={eveIcon(item.typeID,32)} width={30} height={30} alt="" onError={e=>{e.target.style.display="none";}}/>:<span style={{fontSize:14}}>{item.icon||"?"}</span>}
      </div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:13,fontWeight:600,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{item.name}</div>
        <div style={{fontSize:10,color:C.textMute,marginTop:1}}>{item.vol!=null?`${item.vol} m3`:""}{item.forMod?` - fits ${item.forMod}`:""}</div>
      </div>
      <span style={{fontSize:11,color:C.accent,fontWeight:700,flexShrink:0}}>+ Add</span>
    </div>);
  }
  function GroupRow({gid}){
    const g=marketTreeData.g[gid];
    const nSub=(MT_CHILDREN[gid]??[]).length,nItems=(MT_ITEMS[gid]??[]).length;
    return(<div onClick={()=>setPath(p=>[...p,gid])} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 16px",cursor:"pointer",borderBottom:`1px solid ${C.border}`}}>
      <div style={{width:32,height:32,borderRadius:7,flexShrink:0,overflow:"hidden",background:C.surfaceAlt,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
        {g.i?<img className="eve-icon" src={eveIcon(g.i,32)} width={30} height={30} alt="" onError={e=>{e.target.style.display="none";}}/>:null}
      </div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:13,fontWeight:600,color:C.text}}>{g.n}</div>
        <div style={{fontSize:10,color:C.textMute,marginTop:1}}>{nSub>0?`${nSub} groups`:`${nItems} items`}</div>
      </div>
      <span style={{fontSize:18,color:C.textMute,flexShrink:0}}>{">"}</span>
    </div>);
  }

  return(<BottomSheet title="Add Cargo" onClose={onClose} height="86vh">
    <div style={{padding:"8px 14px",borderBottom:`1px solid ${C.border}`}}>
      <div style={{display:"flex",alignItems:"center",gap:8,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px"}}>
        <span style={{fontSize:16,color:C.textMute}}>&#128269;</span>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search market..." style={{flex:1,background:"none",border:"none",color:C.text,fontSize:14}}/>
        {search&&<button onClick={()=>setSearch("")} style={{background:"none",border:"none",color:C.textMute,cursor:"pointer",fontSize:18,padding:0}}>x</button>}
      </div>
    </div>
    {!searchResults&&!fitCharges&&path.length===0&&(
      <div style={{padding:"10px 14px",borderBottom:`1px solid ${C.border}`}}>
        <button onClick={()=>setFitCharges(true)} style={{width:"100%",padding:"10px 0",background:C.accentLight,border:`1px solid ${C.accentBorder}`,borderRadius:8,color:C.accent,fontSize:12,fontWeight:700,cursor:"pointer"}}>Charges for Active Fit</button>
      </div>
    )}
    {!searchResults&&(fitCharges||path.length>0)&&(
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderBottom:`1px solid ${C.border}`,background:C.surfaceAlt}}>
        <button onClick={()=>fitCharges?setFitCharges(false):setPath(p=>p.slice(0,-1))} style={{background:"none",border:"none",color:C.accent,fontSize:13,fontWeight:700,cursor:"pointer",padding:0}}>&laquo; Back</button>
        <span style={{fontSize:12,fontWeight:600,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{fitCharges?"Charges for Active Fit":crumb}</span>
      </div>
    )}
    <div style={{flex:1,overflowY:"auto"}}>
      {searchResults?(
        <div>{searchResults.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"32px 0"}}>No items found</div>}{searchResults.map(item=><ItemRow key={item.typeID} item={item}/>)}</div>
      ):fitCharges?(
        <div>{(fitChargeList??[]).length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"32px 0",fontSize:12}}>No charge-compatible modules fitted</div>}{(fitChargeList??[]).map(item=><ItemRow key={item.typeID??item.name} item={item}/>)}</div>
      ):(
        <div>
          {subGroups.map(gid=><GroupRow key={gid} gid={gid}/>)}
          {items.map(item=><ItemRow key={item.typeID} item={item}/>)}
        </div>
      )}
    </div>
  </BottomSheet>);
}

function CargoScreen({items,setItems,shipCapacity=1150,slots}){
  const[numpad,setNumpad]=useState(null);
  const[showCargoPicker,setShowCargoPicker]=useState(false);
  // Resolve any missing/zero volumes from TYPES (charges.json lacks T2/faction ammo)
  // Authoritative volume: always prefer the type data (resolved by typeID, else by name) over any
  // stored vol — old imported cargo may carry wrong volumes (e.g. ammo saved at 0.25 instead of 0.015).
  const volOf=it=>{
    const t=it.typeID??tidByName(it.name);
    const typeVol=t?(TYPES[t]?.attrs?.volume??TYPES[t]?.a?.['161']):undefined;
    return typeVol??(it.vol>0?it.vol:0);
  };
  const totalVol=items.reduce((s,i)=>s+i.qty*volOf(i),0).toFixed(1);
  const cap=Math.round(shipCapacity||0);
  const addItem=item=>{
    const ex=items.find(e=>e.name===item.name);
    if(ex){setItems(items.map(e=>e.name===item.name?{...e,qty:e.qty+1}:e));setNumpad({...ex,qty:ex.qty+1});return;}
    const ni={id:Date.now(),name:item.name,qty:1,vol:item.vol??volOf(item),icon:item.icon,typeID:item.typeID};
    setItems(prev=>[...prev,ni]);
    setNumpad(ni); // jump straight to quantity entry (ammo etc.)
  };
  return(<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",background:C.surfaceAlt,borderBottom:`1px solid ${C.border}`}}>
      <div><span style={{fontSize:12,fontWeight:700,color:C.text}}>Cargo Bay</span><span style={{fontSize:11,color:C.textMute,marginLeft:8}}>{totalVol} / {cap.toLocaleString()} m3</span></div>
      <button onClick={()=>setShowCargoPicker(true)} style={{padding:"5px 10px",background:C.accent,border:"none",borderRadius:6,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>+ Add</button>
    </div>
    <div style={{height:3,background:C.border}}><div style={{width:`${cap>0?Math.min((parseFloat(totalVol)/cap)*100,100):0}%`,height:"100%",background:parseFloat(totalVol)>cap?C.danger:C.accent}}/></div>
    <div style={{flex:1,overflowY:"auto",padding:12}}>
      {items.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"32px 0",fontSize:13}}>Cargo bay is empty</div>}
      {items.map(item=>(<div key={item.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,marginBottom:6}}>
        <div style={{width:32,height:32,borderRadius:7,background:C.surfaceAlt,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0,overflow:"hidden"}}>{(()=>{const tid=item.typeID??tidByName(item.name);return tid?<img className="eve-icon" src={eveIcon(tid,32)} width={30} height={30} alt="" onError={e=>{e.target.style.display="none";}}/>:<span style={{fontSize:14}}>📦</span>;})()}</div>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{item.name}</div><div style={{fontSize:10,color:C.textMute,marginTop:2}}>{(item.qty*volOf(item)).toFixed(1)} m3</div></div>
        <button onClick={()=>setNumpad(item)} style={{display:"flex",flexDirection:"column",alignItems:"center",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:7,padding:"5px 10px",cursor:"pointer"}}>
          <span style={{fontSize:14,fontWeight:800,color:C.text}}>{item.qty.toLocaleString()}</span>
          <span style={{fontSize:8,color:C.textMute,marginTop:1}}>tap to edit</span>
        </button>
      </div>))}
    </div>
    {numpad&&<NumpadModal label={numpad.name} initial={numpad.qty} onConfirm={qty=>setItems(items.map(i=>i.id===numpad.id?{...i,qty}:i))} onClose={()=>setNumpad(null)}/>}
    {showCargoPicker&&<CargoBrowserSheet slots={slots} onAdd={addItem} onClose={()=>setShowCargoPicker(false)}/>}
  </div>);
}

// ═══ DRONES SCREEN ══════════════════════════════════════════════
function DroneBrowserSheet({existingDrones,onAdd,onClose}){
  const[search,setSearch]=useState("");
  const[drillSub,setDrillSub]=useState(null);
  const allDrones=REAL_DRONE_BROWSER.flatMap(g=>g.subGroups?g.subGroups.flatMap(s=>s.drones):(g.drones??[]));
  const searchResults=search.trim().length>1?allDrones.filter(d=>d.name.toLowerCase().includes(search.toLowerCase())).slice(0,40):null;
  const drilledGroup=drillSub?REAL_DRONE_BROWSER.find(g=>g.topGroup===drillSub):null;

  function DroneRow({d}){
    const already=existingDrones.find(e=>e.name===d.name);
    return(<div onClick={()=>{onAdd(d);onClose();}} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",borderBottom:`1px solid ${C.border}`,cursor:"pointer",background:already?C.accentLight:"transparent"}}>
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
          {d.typeID&&<img className="eve-icon" src={eveIcon(d.typeID,32)} width={26} height={26} alt="" onError={e=>{e.target.style.display="none";}}/>}
          <span style={{fontSize:14,fontWeight:600,color:already?C.accent:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{d.name}</span>
          <span style={{fontSize:10,color:C.textMute,background:C.border,borderRadius:99,padding:"1px 6px",flexShrink:0}}>{d.meta}</span>
        </div>
        <div style={{display:"flex",gap:10,fontSize:11,color:C.textMute}}>
          {d.dps>0&&<span>DPS <span style={{color:C.danger,fontWeight:600}}>{d.dps}</span></span>}
          {d.dps===0&&d.dmgType&&<span style={{color:C.high}}>{d.dmgType}</span>}
          {d.range>0&&<span>Range {d.range}km</span>}
          {d.tracking&&d.tracking>0&&<span>Tr {d.tracking.toFixed(3)}</span>}
          {d.hp>0&&<span>HP {d.hp.toLocaleString()}</span>}
        </div>
      </div>
      {already?<span style={{color:C.accent,fontSize:12,fontWeight:700,marginLeft:10,flexShrink:0}}>+Add</span>:<span style={{color:C.textMute,fontSize:20,marginLeft:10,flexShrink:0}}>+</span>}
    </div>);
  }

  function renderBody(){
    if(searchResults){if(searchResults.length===0)return(<div style={{textAlign:"center",color:C.textMute,padding:"32px 0"}}>No drones found</div>);return searchResults.map(d=><DroneRow key={d.typeID??d.name} d={d}/>);}
    if(drillSub&&drilledGroup){
      if(drilledGroup.subGroups)return drilledGroup.subGroups.map(sub=>(<AccordionSection key={sub.name} title={`${sub.name} (${sub.drones.length})`}>{sub.drones.map(d=><DroneRow key={d.typeID??d.name} d={d}/>)}</AccordionSection>));
      return (drilledGroup.drones??[]).map(d=><DroneRow key={d.typeID??d.name} d={d}/>);
    }
    return REAL_DRONE_BROWSER.map(group=>{
      const count=group.subGroups?group.subGroups.reduce((s,sg)=>s+sg.drones.length,0):(group.drones?.length??0);
      if(group.subGroups?.length)return(<div key={group.topGroup} onClick={()=>setDrillSub(group.topGroup)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px",cursor:"pointer",borderBottom:`1px solid ${C.border}`}}><div><div style={{fontSize:14,fontWeight:600,color:C.text}}>{group.topGroup}</div><div style={{fontSize:11,color:C.textMute,marginTop:2}}>{count} drones</div></div><span style={{fontSize:20,color:C.textMute}}>{">"}</span></div>);
      return(<AccordionSection key={group.topGroup} title={`${group.topGroup} (${count})`}>{(group.drones??[]).map(d=><DroneRow key={d.typeID??d.name} d={d}/>)}</AccordionSection>);
    });
  }

  return(<BottomSheet title="Add Drone" onClose={onClose} height="88vh">
    <div style={{padding:"8px 14px",borderBottom:`1px solid ${C.border}`}}>
      <div style={{display:"flex",alignItems:"center",gap:8,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px"}}>
        <span style={{fontSize:16,color:C.textMute}}>&#128269;</span>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search drones..." style={{flex:1,background:"none",border:"none",color:C.text,fontSize:14}}/>
        {search&&<button onClick={()=>setSearch("")} style={{background:"none",border:"none",color:C.textMute,cursor:"pointer",fontSize:18,padding:0}}>x</button>}
      </div>
    </div>
    {!searchResults&&drillSub&&(<div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderBottom:`1px solid ${C.border}`,background:C.surfaceAlt}}><button onClick={()=>setDrillSub(null)} style={{background:"none",border:"none",color:C.accent,fontSize:14,fontWeight:700,cursor:"pointer",padding:0}}>Back</button><span style={{fontSize:13,fontWeight:600,color:C.text}}>{drillSub}</span></div>)}
    <div>{renderBody()}</div>
  </BottomSheet>);
}

function FighterBrowserSheet({onAdd,onClose}){
  const [cls,setCls]=useState("Light");
  const [q,setQ]=useState("");
  const tierColor={T1:C.textMid,T2:C.accent,Navy:C.warning};
  const classColor={Light:C.rig,Heavy:C.warning,Support:C.accent};
  const races=FIGHTER_CATALOG[cls]||{};
  const RACE_ORDER=["Amarr","Caldari","Gallente","Minmatar","Faction"];
  const ql=q.trim().toLowerCase();
  const anyMatch=RACE_ORDER.some(r=>races[r]?.some(f=>!ql||f.name.toLowerCase().includes(ql)));
  return(<BottomSheet title="Add Fighter" onClose={onClose} height="82vh">
    <div style={{display:"flex",gap:6,padding:"10px 12px 8px"}}>
      {["Light","Heavy","Support"].map(c=>(
        <button key={c} onClick={()=>setCls(c)} style={{flex:1,padding:"8px 0",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer",
          background:cls===c?classColor[c]+"22":"transparent",border:`1px solid ${cls===c?classColor[c]:C.border}`,color:cls===c?classColor[c]:C.textMid}}>{c}</button>
      ))}
    </div>
    <div style={{padding:"0 12px 8px"}}>
      <input value={q} onChange={e=>setQ(e.target.value)} placeholder={`Search ${cls.toLowerCase()} fighters…`} style={{width:"100%",boxSizing:"border-box",padding:"9px 11px",borderRadius:8,background:C.surfaceAlt,border:`1px solid ${C.border}`,color:C.text,fontSize:13,outline:"none"}}/>
    </div>
    {RACE_ORDER.filter(r=>races[r]).map(r=>{
      const list=races[r].filter(f=>!ql||f.name.toLowerCase().includes(ql));
      if(!list.length) return null;
      return(<div key={r}>
        <div style={{padding:"6px 16px",fontSize:10,fontWeight:800,color:C.textMute,textTransform:"uppercase",letterSpacing:0.5,background:C.surfaceAlt,borderBottom:`1px solid ${C.border}`}}>{r}</div>
        {list.map(f=>(
          <div key={f.typeID} onClick={()=>{onAdd({...f,cls});onClose();}} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"11px 16px",borderBottom:`1px solid ${C.border}`,cursor:"pointer"}}>
            <div style={{display:"flex",alignItems:"center",gap:9}}>
              <img className="eve-icon" src={eveIcon(f.typeID,32)} width={28} height={28} alt="" onError={e=>{e.target.style.visibility="hidden";}}/>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:C.text}}>{f.name}</div>
                <span style={{fontSize:9,fontWeight:800,color:classColor[cls],textTransform:"uppercase",letterSpacing:0.3}}>{cls} fighter</span>
              </div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:10,fontWeight:800,color:tierColor[f.tier]||C.textMid,background:`${tierColor[f.tier]||C.textMid}22`,borderRadius:4,padding:"2px 7px"}}>{f.tier}</span>
              <span style={{color:C.high,fontSize:18}}>+</span>
            </div>
          </div>
        ))}
      </div>);
    })}
    {!anyMatch&&<div style={{textAlign:"center",padding:"36px 20px",color:C.textMute,fontSize:13}}>No {cls.toLowerCase()} fighters match “{q}”.</div>}
  </BottomSheet>);
}

// Interactive booster side effects: data-driven from EVE booster penalty attrs.
// Values shown are skill-adjusted (Neurotoxin Recovery/Control V): e.g. Improved
// Exile = 22.5% chance of an 18.75% drawback. Toggling a drawback applies it to the fit.
function BoosterSideEffects({booster, onUpdate}) {
  // Use stored data-driven side effects, or rebuild from type data (migrates old saved boosters)
  const stored = booster.sideEffects;
  const se = (stored?.length && stored[0].key) ? stored : boosterSideEffectsFor(booster.name).map(s => {
    // carry over enabled flags by label if migrating
    const old = stored?.find(o => o.attr === s.label || o.label === s.label);
    return { ...s, enabled: old?.enabled ?? false };
  });
  if (!se.length) return null;
  const NEURO = 0.75; // Neurotoxin Control & Recovery at V: chance and magnitude × 0.75
  const chancePct = Math.round((se[0]?.chance ?? 0.3) * NEURO * 1000) / 10;
  const toggle = (i) => {
    const next = se.map((s, j) => j === i ? { ...s, enabled: !s.enabled } : s);
    onUpdate({ ...booster, sideEffects: next });
  };
  return (
    <div style={{padding:'6px 12px 8px',borderTop:`1px solid ${C.border}`,background:'rgba(245,158,11,0.05)'}}>
      <div style={{fontSize:9,fontWeight:700,color:C.warning,textTransform:'uppercase',letterSpacing:.5,marginBottom:5}}>
        Side effects ({chancePct}% chance each) - tap to simulate
      </div>
      <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
        {se.map((s,i)=>{
          const mag = Math.round(Math.abs(s.value) * NEURO * 100) / 100;
          const sign = s.value < 0 ? '-' : '+';
          return (
            <button key={s.key} onClick={()=>toggle(i)}
              style={{fontSize:10,fontWeight:s.enabled?700:500,cursor:'pointer',
                color:s.enabled?'#fff':C.danger,
                background:s.enabled?C.danger:'rgba(239,68,68,0.1)',
                border:`1px solid ${s.enabled?C.danger:'rgba(239,68,68,0.25)'}`,
                borderRadius:5,padding:'3px 8px'}}>
              {s.enabled?'[x] ':''}{sign}{mag}% {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DronesScreen({drones,setDrones,fighters,setFighters,fighterInfo=[],activeDroneDps=0,shipDroneBay=0,shipDroneBandwidth=0,shipFighter={cap:0,tubes:0,light:0,heavy:0,support:0}}){
  const[showDronePicker,setShowDronePicker]=useState(false);
  const[showFighterPicker,setShowFighterPicker]=useState(false);
  const _droneTypeRec=(d)=>{
    const tid = d.typeID ?? (d.name ? tidByName(d.name) : null);
    if(tid==null) return null;
    return TYPES[tid] ?? TYPES[String(tid)] ?? null;
  };
  const getDroneVol=(d)=>{const t=_droneTypeRec(d);return t?.attrs?.volume ?? d.volume ?? 5;};
  const getDroneBW=(d)=>{const t=_droneTypeRec(d);return t?.attrs?.droneBandwidthUsed ?? d.bandwidth ?? 5;};
  const bayUsed=drones.reduce((s,d)=>s+d.qty*getDroneVol(d),0);
  const addDrone=d=>{const ex=drones.find(e=>e.name===d.name);if(ex){setDrones(drones.map(e=>e.name===d.name?{...e,qty:e.qty+5}:e));return;}setDrones(prev=>{
      // Authoritative stats from TYPES (named attrs), resolved by typeID or name.
      const dtid = d.typeID ?? (d.name ? tidByName(d.name) : null);
      const dta = dtid!=null ? (TYPES[dtid]?.attrs ?? TYPES[String(dtid)]?.attrs ?? null) : null;
      const bw  = dta?.droneBandwidthUsed ?? d.bandwidth ?? 5;
      const vol = dta?.volume ?? d.volume ?? 5;
      const rng = dta?.maxRange ?? d.maxRange ?? d.range ?? 0;
      const fal = dta?.falloff  ?? d.falloff  ?? 0;
      const trk = dta?.trackingSpeed ?? d.tracking ?? 0;
      const vel = dta?.maxVelocity ?? d.maxVelocity ?? d.velocity ?? 0;
      const hp_ = dta?.hp ?? d.hp ?? 0;
      return [...prev,{id:Date.now(),name:d.name,size:d.size,qty:5,active:false,range:rng,falloff:fal,tracking:trk,velocity:vel,hp:hp_,dps:d.dps??0,bandwidth:bw,volume:vol,typeID:d.typeID}];
    });}
  const addFighter=f=>{setFighters(prev=>[...prev,{id:Date.now(),name:f.name,tier:f.tier,typeID:f.typeID,role:f.role||null,qty:1,active:true,abilities:{}}]);};
  const toggleFighterActive=id=>setFighters(fighters.map(f=>f.id===id?{...f,active:f.active===false?true:false}:f));
  // Toggle a fighter ability on/off (stores the explicit inverse of the current effective state).
  const toggleFighterAbility=(id,abilityKey,currentActive)=>setFighters(fighters.map(f=>
    f.id===id?{...f,abilities:{...(f.abilities||{}),[abilityKey]:!currentActive}}:f));
  const setFighterQty=(id,delta)=>setFighters(fighters.map(f=>f.id===id?{...f,qty:Math.max(1,(f.qty??1)+delta)}:f));
  const sizeColor=s=>s==="Light"?C.rig:s==="Medium"?C.accent:s==="Heavy"?C.warning:s==="Sentry"?C.high:C.textMid;
  // ── Fighter-bay accounting ────────────────────────────────────────────────
  const usesFighters = (shipFighter?.tubes ?? 0) > 0;
  const _ftrVol=(name)=>{const t=name?tidByName(name):null;const a=t!=null?(TYPES[t]?.attrs??TYPES[String(t)]?.attrs):null;return a?.volume??0;};
  const fighterBayUsed = fighters.reduce((s,f,i)=>{const sz=fighterInfo[i]?.sqSize ?? (()=>{const t=f.name?tidByName(f.name):null;return (t!=null?TYPES[t]?.attrs?.fighterSquadronMaxSize:0)??0;})();return s+(f.qty??1)*sz*_ftrVol(f.name);},0);
  const classOf=(f,i)=>fighterInfo[i]?.class ?? (()=>{const t=f.name?tidByName(f.name):null;const a=t!=null?TYPES[t]?.attrs:null;return a?.fighterSquadronIsHeavy?"Heavy":a?.fighterSquadronIsSupport?"Support":"Light";})();
  const squadTotals={Light:0,Heavy:0,Support:0}, squadActive={Light:0,Heavy:0,Support:0};
  fighters.forEach((f,i)=>{const c=classOf(f,i);const q=f.qty??1;if(squadTotals[c]!=null){squadTotals[c]+=q;if(f.active!==false)squadActive[c]+=q;}});
  const totalSquads = fighters.reduce((s,f)=>s+(f.qty??1),0);
  const activeSquads = fighters.reduce((s,f)=>s+(f.active!==false?(f.qty??1):0),0);
  const fighterDpsActive = fighterInfo.reduce((s,d)=>s+(d?.active!==false?(d?.dps||0):0),0);
  const fmtM3=v=>v>=1000?(v/1000).toFixed(1)+"k":Math.round(v);
  const CLASS_META=[{k:"Light",cap:shipFighter?.light??0,col:C.rig},{k:"Heavy",cap:shipFighter?.heavy??0,col:C.warning},{k:"Support",cap:shipFighter?.support??0,col:C.accent}];

  return(<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
    {!usesFighters ? (
    <div style={{padding:"10px 14px",background:C.surfaceAlt,borderBottom:`1px solid ${C.border}`}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
        <div>
        <span style={{fontSize:12,fontWeight:700,color:C.text}}>Drone Bay</span>
        <span style={{fontSize:11,color:C.textMute,marginLeft:8}}>{Math.round(bayUsed)} / {shipDroneBay} m³</span>
        <span style={{fontSize:11,color:C.textMute,marginLeft:12}}>BW:</span>
        <span style={{fontSize:11,color:C.textMute,marginLeft:4}}>{drones.filter(d=>d.active).reduce((s,d)=>s+d.qty*getDroneBW(d),0)} / {shipDroneBandwidth} Mbit/s</span>
      </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}><span style={{fontSize:11,color:C.danger,fontWeight:600}}>Active DPS: {activeDroneDps>=100?Math.round(activeDroneDps):activeDroneDps.toFixed(1)}</span><button onClick={()=>setShowDronePicker(true)} style={{padding:"5px 10px",background:C.accent,border:"none",borderRadius:6,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>+ Add</button></div>
      </div>
      <div style={{height:4,background:C.border,borderRadius:99,overflow:"hidden"}}><div style={{width:`${shipDroneBay>0?Math.min((bayUsed/shipDroneBay)*100,100):0}%`,height:"100%",background:bayUsed>shipDroneBay?C.danger:C.rig,borderRadius:99}}/></div>
    </div>
    ) : (
    <div style={{padding:"10px 14px",background:C.surfaceAlt,borderBottom:`1px solid ${C.border}`}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div style={{display:"flex",alignItems:"baseline",gap:8}}>
          <span style={{fontSize:12,fontWeight:700,color:C.text}}>Fighter Bay</span>
          <span style={{fontSize:11,color:fighterBayUsed>shipFighter.cap?C.danger:C.textMute}}>{fmtM3(fighterBayUsed)} / {fmtM3(shipFighter.cap)} m³</span>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <span style={{fontSize:11,color:C.high,fontWeight:700}}>{fighterDpsActive.toLocaleString()} DPS</span>
          <button onClick={()=>setShowFighterPicker(true)} style={{padding:"5px 10px",background:C.high+"22",border:`1px solid ${C.high}55`,borderRadius:6,color:C.high,fontSize:11,fontWeight:700,cursor:"pointer"}}>+ Add</button>
        </div>
      </div>
      <div style={{height:4,background:C.border,borderRadius:99,overflow:"hidden",marginBottom:9}}><div style={{width:`${shipFighter.cap>0?Math.min((fighterBayUsed/shipFighter.cap)*100,100):0}%`,height:"100%",background:fighterBayUsed>shipFighter.cap?C.danger:C.high,borderRadius:99}}/></div>
      {/* Launch tubes + per-class squadron slots, shown as segmented pips */}
      <div style={{display:"flex",gap:6}}>
        {[{label:"Tubes",used:activeSquads,cap:shipFighter.tubes,col:C.high},
          ...CLASS_META.filter(c=>c.cap>0).map(c=>({label:c.k,used:squadTotals[c.k],cap:c.cap,col:c.col}))
         ].map(chip=>{
          const over=chip.used>chip.cap, n=Math.max(chip.cap,chip.used,1);
          return(<div key={chip.label} style={{flex:1,minWidth:0,background:C.surface,border:`1px solid ${over?C.danger:C.border}`,borderRadius:8,padding:"6px 8px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
              <span style={{fontSize:8.5,fontWeight:800,letterSpacing:0.4,color:chip.col,textTransform:"uppercase"}}>{chip.label}</span>
              <span style={{fontSize:10,fontWeight:700,color:over?C.danger:C.text}}>{chip.used}/{chip.cap}</span>
            </div>
            <div style={{display:"flex",gap:2}}>
              {Array.from({length:n}).map((_,i)=>(<div key={i} style={{flex:1,height:4,borderRadius:2,background:i<chip.used?(i>=chip.cap?C.danger:chip.col):C.borderStrong}}/>))}
            </div>
          </div>);
        })}
      </div>
    </div>
    )}
    <div style={{flex:1,overflowY:"auto"}}>
      {!usesFighters&&(<>
      <div style={{display:"grid",gridTemplateColumns:"36px 1fr 60px 50px 50px 50px",gap:4,padding:"5px 12px",background:C.surfaceAlt,borderBottom:`1px solid ${C.border}`}}>
        {["","Name","Range","Track","DPS","HP"].map((h,i)=><span key={i} style={{fontSize:9,fontWeight:700,color:C.textMute,textAlign:i>1?"center":"left"}}>{h}</span>)}
      </div>
      {drones.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"32px 0",fontSize:13}}>No drones - tap + Add</div>}
      <div style={{padding:"8px 10px"}}>
        {drones.map(drone=>(<div key={drone.id} style={{background:C.surface,border:`1px solid ${drone.active?C.accentBorder:C.border}`,borderRadius:10,marginBottom:8,overflow:"hidden"}}>
          <div style={{display:"grid",gridTemplateColumns:"36px 1fr 60px 50px 50px 50px",gap:4,padding:"10px 12px",alignItems:"center"}}>
            <button onClick={()=>setDrones(drones.map(d=>d.id===drone.id?{...d,active:!d.active}:d))} style={{width:24,height:24,borderRadius:5,background:drone.active?C.accentLight:"none",border:`1px solid ${drone.active?C.accentBorder:C.borderStrong}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:drone.active?C.accent:""}}>{drone.active?"v":""}</button>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              {drone.typeID&&<img className="eve-icon" src={eveIcon(drone.typeID,32)} width={24} height={24} alt="" onError={e=>{e.target.style.display="none";}}/>}
              <div><div style={{fontSize:12,fontWeight:600,color:drone.active?C.text:C.textMid,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{drone.name}</div><span style={{fontSize:9,color:sizeColor(drone.size),fontWeight:700}}>{drone.size}</span></div>
            </div>
            {[(()=>{const _dta=typeof DRONE_TYPES!=='undefined'&&drone.typeID?DRONE_TYPES?.[String(drone.typeID)]?.a:null;const r=_dta?.maxRange??drone.range??0;const f=_dta?.falloff??drone.falloff??0;return r>0?`${(r/1000).toFixed(1)}${f>0?`+${(f/1000).toFixed(1)}`:''} km`:"-";})(),drone.tracking>0?drone.tracking.toFixed(3):"-",(()=>{const _dta=typeof DRONE_TYPES!=='undefined'&&drone.typeID?DRONE_TYPES?.[String(drone.typeID)]?.a:null;const v=_dta?.maxVelocity??drone.velocity??0;return v>0?`${Math.round(v)} m/s`:"-";})(),drone.hp>0?drone.hp.toLocaleString():"-"].map((v,i)=><span key={i} style={{fontSize:10,color:C.textMid,textAlign:"center"}}>{v}</span>)}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 12px 8px",borderTop:`1px solid ${C.border}`}}>
            <span style={{fontSize:10,color:C.textMute}}>Qty:</span>
            <button onClick={()=>setDrones(drones.map(d=>d.id===drone.id?{...d,qty:Math.max(0,d.qty-1)}:d))} style={{width:22,height:22,borderRadius:5,background:C.surfaceAlt,border:`1px solid ${C.border}`,color:C.text,cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center"}}>-</button>
            <span style={{fontSize:12,fontWeight:700,color:C.text,minWidth:24,textAlign:"center"}}>{drone.qty}</span>
            <button onClick={()=>setDrones(drones.map(d=>d.id===drone.id?{...d,qty:d.qty+1}:d))} style={{width:22,height:22,borderRadius:5,background:C.surfaceAlt,border:`1px solid ${C.border}`,color:C.text,cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
            {drone.active&&<span style={{fontSize:10,color:C.accent,marginLeft:4}}>Active</span>}
            <button onClick={()=>setDrones(drones.filter(d=>d.id!==drone.id))} style={{marginLeft:"auto",background:"none",border:"none",color:C.danger,cursor:"pointer",fontSize:13}}>x</button>
          </div>
        </div>))}
      </div>
      </>)}
      {usesFighters&&(<div style={{padding:"10px 10px 4px"}}>
        {fighters.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"40px 0",fontSize:13}}>No fighter squadrons — tap + Add</div>}
        {fighters.map((f,i)=>{
          const info=fighterInfo[i]||{};
          const abils=info.abilities||[];
          const isActive=f.active!==false;
          const kindColor=k=>k==="damage"?C.high:k==="speed"?C.accent:k==="tackle"?C.warning:C.textMid;
          return(<div key={f.id} style={{background:C.surface,border:`1px solid ${isActive?C.accentBorder:C.border}`,borderRadius:10,marginBottom:8,padding:"10px 12px",opacity:isActive?1:0.55}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{display:"flex",alignItems:"center",gap:9,flex:1}}>
                <button onClick={()=>toggleFighterActive(f.id)} title={isActive?"Active squadron (in space)":"Inactive (in tube)"}
                  style={{width:24,height:24,borderRadius:5,flexShrink:0,background:isActive?C.accentLight:"none",border:`1px solid ${isActive?C.accentBorder:C.borderStrong}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:isActive?C.accent:""}}>{isActive?"v":""}</button>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:600,color:C.text}}>{f.name} <span style={{fontSize:10,color:C.textMute,fontWeight:400}}>{info.class||f.tier}</span></div>
                  <div style={{display:"flex",gap:12,marginTop:3,fontSize:10,color:C.textMid,flexWrap:"wrap"}}>
                    <span>DPS <b style={{color:info.dps?C.high:C.textMute}}>{info.dps??0}</b></span>
                    <span>Speed <b style={{color:C.text}}>{info.speedActive??info.speed??0}</b>{info.burstFrom?<span style={{color:C.accent}}> m/s ({info.burstFrom})</span>:<span style={{color:C.textMute}}> m/s</span>}</span>
                    <span>EHP <b style={{color:C.text}}>{info.ehp?(info.ehp>=1000?(info.ehp/1000).toFixed(1)+"k":info.ehp):0}</b></span>
                    <span>Sqd <b style={{color:C.text}}>{info.sqSize||6}</b></span>
                  </div>
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <button onClick={()=>setFighterQty(f.id,-1)} style={{width:22,height:22,borderRadius:5,background:C.surfaceAlt,border:`1px solid ${C.border}`,color:C.text,cursor:"pointer",fontSize:13}}>-</button>
                <span style={{fontSize:11,color:C.text,minWidth:38,textAlign:"center"}}>×{f.qty??1} sq</span>
                <button onClick={()=>setFighterQty(f.id,1)} style={{width:22,height:22,borderRadius:5,background:C.surfaceAlt,border:`1px solid ${C.border}`,color:C.text,cursor:"pointer",fontSize:13}}>+</button>
                <button onClick={()=>setFighters(fighters.filter(x=>x.id!==f.id))} style={{marginLeft:4,background:"none",border:"none",color:C.danger,cursor:"pointer",fontSize:14}}>×</button>
              </div>
            </div>
            {abils.length>0&&<div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap",paddingLeft:33}}>
              {abils.map(ab=>{
                const col=kindColor(ab.kind);
                return(<button key={ab.key} onClick={()=>toggleFighterAbility(f.id,ab.key,ab.active)}
                  style={{display:"flex",alignItems:"center",gap:4,padding:"4px 9px",borderRadius:6,cursor:"pointer",fontSize:10,fontWeight:600,
                    background:ab.active?col+"22":"transparent",border:`1px solid ${ab.active?col+"88":C.borderStrong}`,color:ab.active?col:C.textMute}}>
                  {ab.label}{ab.kind==="damage"&&ab.active&&ab.dps?<span style={{opacity:0.8}}>· {ab.dps}</span>:null}
                </button>);
              })}
            </div>}
          </div>);
        })}
      </div>)}
    </div>
    {showDronePicker&&<DroneBrowserSheet existingDrones={drones} onAdd={addDrone} onClose={()=>setShowDronePicker(false)}/>}
    {showFighterPicker&&<FighterBrowserSheet onAdd={addFighter} onClose={()=>setShowFighterPicker(false)}/>}
  </div>);
}

// ═══ IMPLANTS - full Pyfa-style drill-down browser ════════════════
// Matches the module browser drill-down pattern
// Slot 1-5: Attribute enhancers, Slot 6-10: Hardwirings
const IMPLANT_SETS = {
  attribute:[
    {name:"Snake Set",desc:"Max Velocity",slots:{1:"Alpha",2:"Beta",3:"Gamma",4:"Delta",5:"Epsilon",6:"Zeta (Omega)"},
     grades:["Low-grade","Mid-grade","High-grade"],bonus:"+5/+10/+20% Max Velocity"},
    {name:"Ascendancy Set",desc:"Warp Speed",slots:{1:"Alpha",2:"Beta",3:"Gamma",4:"Delta",5:"Epsilon",6:"Omega"},
     grades:["Low-grade","Mid-grade","High-grade"],bonus:"+15/+25/+50% Warp Speed"},
    {name:"Slave Set",desc:"Armor HP",slots:{1:"Alpha",2:"Beta",3:"Gamma",4:"Delta",5:"Epsilon",6:"Omega"},
     grades:["Low-grade","Mid-grade","High-grade"],bonus:"+13/+22/+33% Armor HP"},
    {name:"Crystal Set",desc:"Shield Resists",slots:{1:"Alpha",2:"Beta",3:"Gamma",4:"Delta",5:"Epsilon"},
     grades:["Low-grade","Mid-grade","High-grade"],bonus:"+4/+6/+9% Shield Resists"},
    {name:"Halo Set",desc:"Signature Radius",slots:{1:"Alpha",2:"Beta",3:"Gamma",4:"Delta",5:"Epsilon"},
     grades:["Low-grade","Mid-grade","High-grade"],bonus:"-9/-12/-18% Signature Radius"},
    {name:"Attribute Enhancers",desc:"Core attributes",slots:{1:"Ocular Filter",2:"Memory Augmentation",3:"Neural Boost",4:"Cybernetic Subprocessor",5:"Social Adaptation Chip"},
     grades:["Basic","Standard","Improved","Enhanced","Basic (Attribute Set)"],bonus:"+1 to +5 attribute"},
  ],
  hardwiring:{
    6:["Zainou Deadeye GU-705 (+5% Turret Dmg)","Zainou Deadeye RR-605 (+5% ROF)","Inherent Implants Squire PG6 (+2% PG)","Inherent Implants Squire PG7 (+3% PG)","Inherent Implants Squire PG8 (+5% PG)","Eifyr Rogue SY-1 (+5% Velocity)","Inherent Implants Noble HG-1005 (+5% Shield HP)"],
    7:["Zainou Deadeye ZMT510 (+5% Tracking)","Inherent Implants Squire EE-603 (+3% Cap Rech)","Inherent Implants Squire EE-605 (+5% Cap Rech)","Eifyr Rogue AY-2 (+3% Armor Rep)","Zainou Gypsy BX-704 (+4% Drone Dmg)"],
    8:["Zainou Deadeye BX-804 (+4% Tracking)","Inherent Implants Lancer SB8 (+3% Velocity)","Eifyr Rogue AY-3 (+5% Armor Rep)","Eifyr Alchemist SY-1 (+5% Shield Boost)"],
    9:["Zainou Deadeye GU-905 (+5% Turret Dmg)","Zainou Gnome SK-705 (+5% Shield HP)","Inherent Implants Noble HG-1006 (+6% Armor HP)","Eifyr Rogue WS-615 (+5% Web)"],
    10:["Zainou Deadeye GU-705 (+5% Turret Dmg)","Eifyr Rogue WS-615 (+5% Web Strength)","Inherent Implants Squire PG10 (+5% PG)","Zainou Gypsy BX-805 (+5% Drone Dmg)"],
  },
};

function ImplantPicker({slot,current,onSelect,onClear,onClose}){
  const[search,setSearch]=useState("");
  const[drill,setDrill]=useState(null);
  
  const slotData=implantData?.[String(slot)];
  const groups=slotData?.groups??{};
  const groupNames=Object.keys(groups).sort();
  const drillItems=drill?groups[drill]??[]:[];
  
  // Search all items in this slot:
  const allItems=Object.values(groups).flat();
  const results=search.trim().length>1
    ? allItems.filter(i=>i.name.toLowerCase().includes(search.toLowerCase()))
    : null;

  const ItemRow=({item})=>(
    <div onClick={()=>{onSelect({name:item.name,typeID:item.typeID,slot,bonus:""});onClose();}}
      style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",
              borderBottom:`1px solid ${C.border}`,cursor:"pointer",
              background:current===item.name?C.accentLight:"transparent"}}>
      <div>
        <div style={{fontSize:13,fontWeight:600,color:current===item.name?C.accent:C.text}}>{item.name}</div>
        {item.metaGroupID>0&&<div style={{fontSize:10,color:C.textMute,marginTop:1}}>Meta {item.metaLevel??0}</div>}
      </div>
      {current===item.name?<span style={{color:C.accent}}>✓</span>:<span style={{color:C.textMute}}>+</span>}
    </div>
  );

  if(drill){
    return(<BottomSheet title={`Slot ${slot} › ${drill}`} onClose={()=>setDrill(null)} height="82vh">
      {drillItems.map(item=><ItemRow key={item.typeID} item={item}/>)}
    </BottomSheet>);
  }

  return(<BottomSheet title={`Slot ${slot} Implants`} onClose={onClose} height="82vh">
    {current&&current!=="[Empty]"&&(
      <div style={{padding:"10px 14px 0"}}>
        <div style={{padding:"9px 12px",background:C.accentLight,border:`1px solid ${C.accentBorder}`,borderRadius:8,marginBottom:4}}>
          <div style={{fontSize:10,color:C.textMute}}>Fitted</div>
          <div style={{fontSize:12,fontWeight:600,color:C.accent}}>{current}</div>
        </div>
        <button onClick={()=>{onClear();onClose();}} style={{width:"100%",padding:"8px 0",background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.3)",borderRadius:8,color:C.danger,fontSize:12,fontWeight:700,cursor:"pointer",marginBottom:8}}>Remove implant</button>
      </div>
    )}
    <div style={{padding:"10px 14px 4px"}}>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search implants..."
        style={{width:"100%",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",color:C.text,fontSize:13,boxSizing:"border-box"}}/>
    </div>
    {results
      ? results.map(item=><ItemRow key={item.typeID} item={item}/>)
      : groupNames.map(gn=>(
          <div key={gn} onClick={()=>setDrill(gn)}
            style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",borderBottom:`1px solid ${C.border}`,cursor:"pointer"}}>
            <div style={{fontSize:13,color:C.text}}>{gn}</div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:11,color:C.textMute}}>{groups[gn]?.length??0}</span>
              <span style={{color:C.textMute}}>›</span>
            </div>
          </div>
        ))
    }
  </BottomSheet>);
}

function ImplantsScreen({implants,setImplants}){
  const[loadouts,setLoadouts]=useState([]);
  const[picker,setPicker]=useState(null);
  const[savingName,setSavingName]=useState(false);
  const[newLoadoutName,setNewLoadoutName]=useState("");
  const[editingLoadout,setEditingLoadout]=useState(null);
  const[editLoadoutName,setEditLoadoutName]=useState("");
  const filled=implants.filter(i=>i.name!=="[Empty]").length;

  function saveLoadout(){
    if(!newLoadoutName.trim())return;
    setLoadouts(prev=>[...prev,{id:Date.now(),name:newLoadoutName.trim(),implants:[...implants]}]);
    setNewLoadoutName("");setSavingName(false);
  }
  function loadLoadout(lo){
    if(!lo.implants?.length){alert(`"${lo.name}" has no implants saved.`);return;}
    setImplants(lo.implants.map(i=>({...i})));
  }
  function renameLoadout(id){
    setLoadouts(prev=>prev.map(l=>l.id===id?{...l,name:editLoadoutName.trim()||l.name}:l));
    setEditingLoadout(null);setEditLoadoutName("");
  }
  function deleteLoadout(id){setLoadouts(prev=>prev.filter(l=>l.id!==id));}

  return(<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
    <div style={{padding:"10px 12px",background:C.surfaceAlt,borderBottom:`1px solid ${C.border}`}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
        <span style={{fontSize:11,fontWeight:700,color:C.textMute,letterSpacing:.6,textTransform:"uppercase"}}>{filled}/10 fitted</span>
        {savingName
          ?<div style={{display:"flex",alignItems:"center",gap:6}}>
            <input autoFocus value={newLoadoutName} onChange={e=>setNewLoadoutName(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter")saveLoadout();if(e.key==="Escape")setSavingName(false);}}
              placeholder="Loadout name..." style={{width:130,padding:"4px 8px",background:C.surface,border:`1px solid ${C.accentBorder}`,borderRadius:6,color:C.text,fontSize:11}}/>
            <button onClick={saveLoadout} style={{padding:"4px 10px",background:C.accent,border:"none",borderRadius:6,color:"#fff",fontSize:11,cursor:"pointer"}}>Save</button>
            <button onClick={()=>setSavingName(false)} style={{background:"none",border:"none",color:C.textMute,cursor:"pointer",fontSize:18,padding:0}}>x</button>
          </div>
          :<button onClick={()=>setSavingName(true)} style={{padding:"5px 10px",borderRadius:6,fontSize:11,fontWeight:700,cursor:"pointer",background:C.accentLight,border:`1px solid ${C.accentBorder}`,color:C.accent}}>+ Save Loadout</button>
        }
      </div>
      {loadouts.length>0&&<div className="hs" style={{overflowX:"auto",display:"flex",gap:6}}>
        {loadouts.map(l=>(
          <div key={l.id} style={{display:"flex",alignItems:"center",gap:3,flexShrink:0}}>
            {editingLoadout===l.id
              ?<input autoFocus value={editLoadoutName} onChange={e=>setEditLoadoutName(e.target.value)}
                 onKeyDown={e=>{if(e.key==="Enter")renameLoadout(l.id);if(e.key==="Escape")setEditingLoadout(null);}}
                 onBlur={()=>renameLoadout(l.id)}
                 style={{width:120,padding:"3px 7px",background:C.surface,border:`1px solid ${C.accentBorder}`,borderRadius:6,color:C.text,fontSize:11}}/>
              :<button onClick={()=>loadLoadout(l)}
                 style={{padding:"4px 10px",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer",background:C.surface,border:`1px solid ${C.border}`,color:C.textMid}}>
                {l.name} <span style={{color:C.textMute,fontSize:9}}>({l.implants?.filter(i=>i.name!=="[Empty]").length??0})</span>
              </button>
            }
            <button onClick={()=>{setEditingLoadout(l.id);setEditLoadoutName(l.name);}} style={{width:20,height:20,borderRadius:4,background:"none",border:"none",cursor:"pointer",fontSize:11,color:C.textMute,flexShrink:0}}>&#9998;</button>
            <button onClick={()=>deleteLoadout(l.id)} style={{width:20,height:20,borderRadius:4,background:"none",border:"none",cursor:"pointer",fontSize:11,color:C.danger,flexShrink:0}}>x</button>
          </div>
        ))}
      </div>}
    </div>
    <div style={{flex:1,overflowY:"auto",padding:12}}>
      {/* Slot groups */}
      {[{label:"Attribute Enhancers",slots:[1,2,3,4,5],color:C.accent},{label:"Hardwirings",slots:[6,7,8,9,10],color:C.high}].map(grp=>(
        <div key={grp.label} style={{marginBottom:14}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,padding:"0 2px"}}>
            <div style={{width:8,height:8,borderRadius:99,background:grp.color}}/>
            <span style={{fontSize:11,fontWeight:700,color:grp.color,letterSpacing:.4}}>{grp.label.toUpperCase()}</span>
          </div>
          {grp.slots.map(slotNum=>{
            const imp=implants.find(i=>i.slot===slotNum);
            const empty=!imp||imp.name==="[Empty]";
            return(<div key={slotNum} onClick={()=>setPicker(imp||{slot:slotNum,name:"[Empty]"})} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",background:C.surface,border:`1px solid ${empty?C.border:grp.color+"44"}`,borderRadius:8,marginBottom:5,cursor:"pointer"}}>
              <div style={{width:26,height:26,borderRadius:6,background:empty?C.surfaceAlt:`${grp.color}18`,border:`1px solid ${empty?C.borderStrong:grp.color+"44"}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <span style={{fontSize:10,fontWeight:800,color:empty?C.textMute:grp.color}}>{slotNum}</span>
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,fontWeight:empty?400:600,color:empty?C.textMute:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{empty?"Empty":imp.name}</div>
                {!empty&&imp.bonus&&<div style={{fontSize:10,color:C.rig,marginTop:1}}>{imp.bonus}</div>}
              </div>
              <span style={{fontSize:14,color:C.textMute}}>{">"}</span>
            </div>);
          })}
        </div>
      ))}
    </div>
    {picker&&<ImplantPicker slot={picker.slot} current={picker.name}
      onSelect={opt=>setImplants(prev=>prev.map(i=>i.slot===picker.slot?{...i,name:opt.name,bonus:opt.bonus??null}:i))}
      onClear={()=>setImplants(prev=>prev.map(i=>i.slot===picker.slot?{...i,name:"[Empty]",bonus:null}:i))}
      onClose={()=>setPicker(null)}/>}
  </div>);
}

// ═══ EFFECTS SCREEN - Boosters with side effects ════════════════
// Pyfa booster side effects: each grade has a % chance to apply a penalty
const BOOSTER_SIDE_EFFECTS = {
  "Blue Pill":     [{attr:"Shield Capacity",penalty:"-22.5%"},{attr:"Turret Optimal Range",penalty:"-22.5%"},{attr:"Cap Capacity",penalty:"-22.5%"},{attr:"Missile Explosion Velocity",penalty:"-22.5%"}],
  "Crash":         [{attr:"Capacitor Capacity",penalty:"-10%"},{attr:"Armor Repairer Duration",penalty:"+10%"}],
  "Drop":          [{attr:"Shield Capacity",penalty:"-10%"},{attr:"Capacitor Capacity",penalty:"-10%"}],
  "Exile":         [{attr:"Capacitor Capacity",penalty:"-10%"},{attr:"Armor Repairer Duration",penalty:"+10%"}],
  "Mindflood":     [{attr:"Shield Capacity",penalty:"-5%"},{attr:"Armor HP",penalty:"-5%"}],
  "Sooth Sayer":   [{attr:"Armor HP",penalty:"-5%"},{attr:"Capacitor Recharge",penalty:"-10%"}],
  "X-Instinct":    [{attr:"Velocity",penalty:"-5%"},{attr:"Agility",penalty:"+5%"}],
  "Frentix":       [{attr:"Tracking Speed",penalty:"-5%"},{attr:"Falloff",penalty:"-5%"}],
  "Pyrolancea":    [{attr:"Capacitor Capacity",penalty:"-5%"},{attr:"Shield HP",penalty:"-5%"}],
};
const GRADE_SIDE_EFFECT_CHANCE = {Synth:0,Standard:0.15,Improved:0.20,Strong:0.30};

function buildBoosterFromName(name){
  const grade=["Synth","Improved","Standard","Strong"].find(g=>name.startsWith(g))
              ||(name.includes("Synth")?"Synth":"Standard");
  const drugBase=name.replace(/^(Synth|Improved|Standard|Strong|Nugoehuvi Synth) /,"");
  const seKey=drugBase.replace(/ Booster$/,"");
  // Agency/AIR/event boosters (slot 11/14-17) have NO side effects:
  // Data-driven side effects from EVE booster penalty attrs (raw values; UI/calc apply Neurotoxin skills)
  const se=boosterSideEffectsFor(name);
  return{id:Date.now()+Math.random(),name,effect:drugBase,active:true,color:C.warning,
         sideEffects:se};
}

// Pyfa-style booster categories - organized by primary benefit
const BOOSTER_CATEGORIES=[
  {label:"Shield",      color:C.mid,     drugs:["Blue Pill","Sooth Sayer"]},
  {label:"Armor",       color:C.warning, drugs:["Crash","Exile","Drop"]},
  {label:"Agency",      color:"#8b5cf6", drugs:["Agency Booster (Slot 11)","Agency Booster (Slot 14)","Agency Booster (Slot 15)","Agency Booster (Slot 16)","Agency Booster (Slot 17)"]},
  {label:"Turret",      color:C.danger,  drugs:["Frentix","Pyrolancea"]},
  {label:"Cap/Nav",     color:C.rig,     drugs:["Mindflood","X-Instinct"]},
];

function BoosterPickerSheet({onAdd,onClose}){
  const[slotDrill,setSlotDrill]=useState(null);  // booster slot (1,2,3)
  const[catDrill,setCatDrill]=useState(null);    // drug category
  const[search,setSearch]=useState("");
  const gradeColor={Synth:C.rig,Standard:C.textMid,Improved:C.accent,Strong:C.danger};
  const gradeChance={Synth:0,Standard:0.15,Improved:0.20,Strong:0.30};
  const slotData=slotDrill?BOOSTER_DATA[slotDrill]??{}:{};
  const catNames=Object.keys(slotData);
  const drugs=catDrill?(slotData[catDrill]??[]):[];

  // All boosters flat for search
  const allBoosters=Object.values(BOOSTER_DATA).flatMap(s=>Object.values(s).flat());
  const searchResults=search.trim().length>1?allBoosters.filter(n=>n.toLowerCase().includes(search.toLowerCase())):null;

  const back=()=>{if(catDrill)setCatDrill(null);else if(slotDrill)setSlotDrill(null);};
  const breadcrumb=[slotDrill?`Slot ${slotDrill}`:null,catDrill].filter(Boolean).join(' > ');

  const addDrug=(name)=>{
    // Parse grade from name: "Synth X-Instinct Booster" -> grade="Synth"
    const grade=["Synth","Improved","Standard","Strong"].find(g=>name.startsWith(g))||"Standard";
    const drugBase=name.replace(/^(Synth|Improved|Standard|Strong|Nugoehuvi Synth) /,'');
    onAdd({id:Date.now(),name,effect:drugBase,active:true,color:C.warning,
           sideEffects:boosterSideEffectsFor(name)});
    onClose();
  };

  return(<BottomSheet title="Add Booster Drug" onClose={onClose} height="82vh">
    <div style={{padding:"8px 14px",borderBottom:`1px solid ${C.border}`}}>
      <div style={{display:"flex",alignItems:"center",gap:8,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 10px"}}>
        <span style={{fontSize:16,color:C.textMute}}>&#128269;</span>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search boosters..."
          style={{flex:1,background:"none",border:"none",color:C.text,fontSize:13}}/>
        {search&&<button onClick={()=>setSearch("")} style={{background:"none",border:"none",color:C.textMute,cursor:"pointer",fontSize:16}}>x</button>}
      </div>
    </div>
    {breadcrumb&&(
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderBottom:`1px solid ${C.border}`,background:C.surfaceAlt}}>
        <button onClick={back} style={{background:"none",border:"none",color:C.accent,fontSize:13,fontWeight:700,cursor:"pointer",padding:0}}>&laquo; Back</button>
        <span style={{fontSize:12,color:C.textMute}}>{breadcrumb}</span>
      </div>
    )}

    {/* Search results */}
    {searchResults&&<div style={{overflowY:"auto"}}>
      {searchResults.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"32px 0"}}>No boosters found</div>}
      {searchResults.map(n=>(
        <div key={n} onClick={()=>addDrug(n)}
          style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`,cursor:"pointer"}}>
          <div style={{fontSize:13,fontWeight:600,color:C.text}}>{n}</div>
        </div>
      ))}
    </div>}

    {/* Level 1: Booster slots */}
    {!searchResults&&!slotDrill&&[1,2,3,11,14,15,16,17].map(slot=>(
      <div key={slot} onClick={()=>setSlotDrill(slot)}
        style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px",cursor:"pointer",borderBottom:`1px solid ${C.border}`}}>
        <div>
          <div style={{fontSize:14,fontWeight:700,color:C.text}}>Slot {slot}</div>
          <div style={{fontSize:11,color:C.textMute,marginTop:2}}>{Object.keys(BOOSTER_DATA[slot]??{}).join(", ")}</div>
        </div>
        <span style={{color:C.textMute}}>{">"}</span>
      </div>
    ))}

    {/* Level 2: Drug categories in slot */}
    {!searchResults&&slotDrill&&!catDrill&&catNames.map(cat=>(
      <div key={cat} onClick={()=>setCatDrill(cat)}
        style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px",cursor:"pointer",borderBottom:`1px solid ${C.border}`}}>
        <div>
          <div style={{fontSize:14,fontWeight:600,color:C.text}}>{cat}</div>
          <div style={{fontSize:11,color:C.textMute,marginTop:2}}>{(slotData[cat]??[]).length} variant{(slotData[cat]??[]).length!==1?"s":""}</div>
          {BOOSTER_SIDE_EFFECTS[cat]&&<div style={{fontSize:10,color:C.warning,marginTop:2}}>! {BOOSTER_SIDE_EFFECTS[cat].length} side effect{BOOSTER_SIDE_EFFECTS[cat].length>1?"s":""}</div>}
        </div>
        <span style={{color:C.textMute}}>{">"}</span>
      </div>
    ))}

    {/* Level 3: Drug variants */}
    {!searchResults&&catDrill&&drugs.map(drugName=>(
      <div key={drugName} onClick={()=>addDrug(drugName)}
        style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <div style={{fontSize:13,fontWeight:600,color:C.text}}>{drugName}</div>
          {(()=>{
            const grade=["Synth","Improved","Standard","Strong"].find(g=>drugName.startsWith(g))||"Standard";
            const chance=gradeChance[grade]??0;
            return chance>0
              ?<div style={{fontSize:10,color:C.warning,marginTop:2}}>{Math.round(chance*100)}% side effect chance</div>
              :<div style={{fontSize:10,color:C.rig,marginTop:2}}>No side effects</div>;
          })()}
        </div>
        <span style={{color:C.textMute}}>+</span>
      </div>
    ))}
  </BottomSheet>);
}


function DamageProfileSheet({current,onSelect,onClose}){
  const[search,setSearch]=useState("");
  const[openCat,setOpenCat]=useState(()=>new Set(["Generic"]));
  const q=search.trim().toLowerCase();
  const cats=DAMAGE_PROFILES.map(g=>({cat:g.cat,items:g.items.filter(it=>!q||it.n.toLowerCase().includes(q)||g.cat.toLowerCase().includes(q))})).filter(g=>g.items.length);
  const toggleCat=(c)=>setOpenCat(s=>{const n=new Set(s);n.has(c)?n.delete(c):n.add(c);return n;});
  const Bar=({p})=>(<span style={{display:"flex",width:54,height:6,borderRadius:99,overflow:"hidden",border:`1px solid ${C.border}`,flexShrink:0}}>
    {[["em",p[0]],["th",p[1]],["kin",p[2]],["exp",p[3]]].map(([k,v])=><span key={k} style={{width:`${v*100}%`,background:DMG[k].color}}/>)}
  </span>);
  return(<BottomSheet title="Incoming Damage Profile" onClose={onClose} height="80vh">
    <div style={{padding:"8px 14px",borderBottom:`1px solid ${C.border}`}}>
      <div style={{display:"flex",alignItems:"center",gap:8,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"6px 10px"}}>
        <span style={{fontSize:14,color:C.textMute}}>&#128269;</span>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search profiles..." style={{flex:1,background:"none",border:"none",color:C.text,fontSize:13,outline:"none"}}/>
      </div>
    </div>
    {cats.map(g=>{const open=!!q||openCat.has(g.cat);return(<div key={g.cat}>
      <div onClick={()=>toggleCat(g.cat)} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 14px",background:C.surfaceAlt,borderBottom:`1px solid ${C.border}`,cursor:"pointer"}}>
        <span style={{fontSize:10,color:C.textMute,transform:open?"rotate(90deg)":"none",display:"inline-block",width:10}}>▶</span>
        <span style={{fontSize:11,fontWeight:700,color:C.text}}>{g.cat}</span>
        <span style={{fontSize:10,color:C.textMute}}>({g.items.length})</span>
      </div>
      {open&&g.items.map(it=>{const sel=current?.name===it.n;return(
        <div key={it.n} onClick={()=>{onSelect({name:it.n,p:it.p});onClose();}} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,padding:"9px 14px 9px 26px",borderBottom:`1px solid ${C.border}`,cursor:"pointer",background:sel?C.accentLight:"transparent"}}>
          <span style={{fontSize:12,fontWeight:sel?700:500,color:sel?C.accent:C.text}}>{it.n}</span>
          <Bar p={it.p}/>
        </div>);})}
    </div>);})}
  </BottomSheet>);
}

function FitPickerSheet({title,fitsDB,onSelect,onClose,filterFn}){
  const[search,setSearch]=useState("");
  const allFits=[];
  Object.entries(fitsDB).forEach(([ship,fits])=>fits.forEach(f=>{if(!filterFn||filterFn(ship,f))allFits.push({ship,fit:f});}));
  const filtered=search.trim()?allFits.filter(({ship,fit})=>ship.toLowerCase().includes(search.toLowerCase())||fit.name.toLowerCase().includes(search.toLowerCase())):allFits;
  return(<BottomSheet title={title} onClose={onClose} height="75vh">
    <div style={{padding:"8px 14px",borderBottom:`1px solid ${C.border}`}}>
      <div style={{display:"flex",alignItems:"center",gap:8,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:"6px 10px"}}>
        <span style={{fontSize:14,color:C.textMute}}>&#128269;</span>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search fits..." style={{flex:1,background:"none",border:"none",color:C.text,fontSize:13}}/>
      </div>
    </div>
    {filtered.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"32px 0",fontSize:13}}>No fits found</div>}
    {filtered.map(({ship,fit})=>(
      <div key={fit.id} onClick={()=>{onSelect(ship,fit);onClose();}} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 14px",borderBottom:`1px solid ${C.border}`,cursor:"pointer"}}>
        <div><div style={{fontSize:13,fontWeight:600,color:C.text}}>{fit.name}</div><div style={{fontSize:10,color:C.textMute,marginTop:2}}>{ship} / Modified {fit.modified}</div></div>
        <span style={{fontSize:14,color:C.textMute,flexShrink:0}}>{">"}</span>
      </div>
    ))}
  </BottomSheet>);
}

function EffectsScreen({fitsDB,boosters,setBoosters,projFits,setProjFits,cmdFits,setCmdFits}){
  const[section,setSection]=useState("boosters");
  const[showBoosterPicker,setShowBoosterPicker]=useState(false);
  const[showProjPicker,setShowProjPicker]=useState(false);
  const[showCmdPicker,setShowCmdPicker]=useState(false);
  const cmdShips=Object.keys(CMD_SHIP_FITS);

  return(<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
    <div style={{display:"flex",background:C.surface,borderBottom:`1px solid ${C.border}`}}>
      {[{tabId:"boosters",label:"Boosters"},{tabId:"projected",label:"Projected"},{tabId:"command",label:"Command"}].map(t=>(<button key={t.tabId} onClick={()=>setSection(t.tabId)} style={{flex:1,padding:"8px 0",fontSize:12,fontWeight:600,background:"none",border:"none",cursor:"pointer",color:section===t.tabId?C.accent:C.textMute,borderBottom:section===t.tabId?`2px solid ${C.accent}`:"2px solid transparent"}}>{t.label}</button>))}
    </div>
    {section==="boosters"&&(<div style={{flex:1,overflowY:"auto",padding:12}}>
      <div style={{fontSize:11,color:C.textMute,marginBottom:10}}>Toggle boosters to simulate their stat effects on this fit.</div>
      {boosters.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"24px 0",fontSize:13}}>No boosters added</div>}
      {boosters.map(b=>(<div key={b.id} style={{background:C.surface,border:`1px solid ${b.active?C.accentBorder:C.border}`,borderRadius:8,marginBottom:6,overflow:"hidden"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,padding:"11px 12px"}}>
          <button onClick={()=>setBoosters(boosters.map(x=>x.id===b.id?{...x,active:!x.active}:x))} style={{width:24,height:24,borderRadius:5,background:b.active?C.accentLight:"none",border:`1px solid ${b.active?C.accentBorder:C.borderStrong}`,cursor:"pointer",fontSize:11,fontWeight:700,color:b.active?C.accent:C.textMute}}>{b.active?"v":""}</button>
          <div style={{flex:1}}>
            <div style={{fontSize:12,fontWeight:600,color:b.active?C.text:C.textMid}}>{b.name}</div>
            <div style={{fontSize:10,color:C.rig,marginTop:1}}>{b.effect}</div>
          </div>
          <button onClick={()=>setBoosters(boosters.filter(x=>x.id!==b.id))} style={{background:"none",border:"none",color:C.danger,cursor:"pointer",fontSize:14}}>x</button>
        </div>
        <BoosterSideEffects booster={b} onUpdate={nb=>setBoosters(boosters.map(x=>x.id===b.id?nb:x))}/>
      </div>))}
      <button onClick={()=>setShowBoosterPicker(true)} style={{width:"100%",padding:"10px 0",background:C.surfaceAlt,border:`1px dashed ${C.border}`,borderRadius:8,color:C.textMid,fontSize:12,fontWeight:600,cursor:"pointer",marginTop:4}}>+ Add Booster</button>
      {showBoosterPicker&&<BoosterPickerSheet onAdd={b=>setBoosters(prev=>[...prev,b])} onClose={()=>setShowBoosterPicker(false)}/>}
    </div>)}
    {section==="projected"&&(<div style={{flex:1,overflowY:"auto",padding:12}}>
      <div style={{fontSize:11,color:C.textMute,marginBottom:12}}>Project another fit's effects onto this ship. Remote reps and EWAR scale with range. Modules use the source fit's active/overheated state.</div>
      {projFits.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"24px 0",fontSize:13}}>No projected fits applied</div>}
      {projFits.map((f,i)=>{
        const srcFit=fitsDB[f.ship]?.find(x=>x.name===f.fitName);
        const rangeKm=f.rangeKm??30;
        const eff=srcFit?computeProjectedReps({name:f.ship,typeID:tidByName(f.ship)},srcFit.slots,SKILL_DEFAULTS,{implants:srcFit.implants,boosters:srcFit.boosters}):{reps:[],webs:[],neuts:[]};
        const rf=(o,fo)=>calcRangeFactor(o,fo,rangeKm*1000,true);
        const totals={shield:0,armor:0,hull:0};
        for(const r of eff.reps)totals[r.kind]+=r.rawPS*rf(r.optimal,r.falloff);
        // Web speed multiplier (stacking-penalised) + total neut drain at this range
        const webMs=eff.webs.map(w=>1+(w.speedFactor*rf(w.optimal,w.falloff))/100);
        const webMult=webMs.length?stackingPenalty(webMs):1;
        const neutGJs=eff.neuts.reduce((s,n)=>s+n.gjPerSec*rf(n.optimal,n.falloff),0);
        const stk=(arr)=>arr.length?(stackingPenalty(arr.map(p=>1+p/100))-1)*100:0;
        const painterSig=stk((eff.painters||[]).map(p=>p.sigBonus*rf(p.optimal,p.falloff)));
        const dampLock=stk((eff.damps||[]).map(d=>d.lockBonus*rf(d.optimal,d.falloff)));
        const tdTrack=stk((eff.trackDisr||[]).map(t=>t.tracking*rf(t.optimal,t.falloff)));
        const gdRange=stk((eff.guideDisr||[]).map(g=>g.missileRange*rf(g.optimal,g.falloff)));
        const hasReps=totals.shield+totals.armor+totals.hull>0.5;
        const hasWeb=webMs.length>0, hasNeut=neutGJs>0.05;
        const hasPaint=Math.abs(painterSig)>0.5, hasDamp=Math.abs(dampLock)>0.5, hasTD=Math.abs(tdTrack)>0.5, hasGD=Math.abs(gdRange)>0.5;
        const hasAny=hasReps||hasWeb||hasNeut||hasPaint||hasDamp||hasTD||hasGD;
        const setRange=(km)=>setProjFits(projFits.map((p,j)=>j===i?{...p,rangeKm:Math.max(0,km)}:p));
        return(<div key={i} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 14px",marginBottom:8}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <div><div style={{fontSize:12,fontWeight:700,color:C.text}}>{f.fitName}</div><div style={{fontSize:10,color:C.textMute,marginTop:2}}>{f.ship}</div></div>
            <button onClick={()=>setProjFits(projFits.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:C.danger,cursor:"pointer",fontSize:14}}>x</button>
          </div>
          {/* Range control */}
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
            <span style={{fontSize:11,color:C.textMid,minWidth:42}}>Range</span>
            <input type="range" min={0} max={150} step={1} value={rangeKm} onChange={e=>setRange(Number(e.target.value))} style={{flex:1,accentColor:C.accent}}/>
            <input type="number" inputMode="numeric" value={rangeKm} onChange={e=>setRange(Number(e.target.value)||0)} style={{width:52,padding:"3px 5px",borderRadius:5,fontSize:12,fontWeight:700,textAlign:"center",background:C.surfaceAlt,border:`1px solid ${C.border}`,color:C.text}}/>
            <span style={{fontSize:10,color:C.textMute}}>km</span>
          </div>
          {/* Projected effects */}
          {hasAny?(
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {totals.shield>0&&<div style={{flex:1,minWidth:84,background:C.surfaceAlt,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:14,fontWeight:800,color:C.mid}}>{Math.round(totals.shield)}</div><div style={{fontSize:9,color:C.textMute}}>shield HP/s in</div></div>}
              {totals.armor>0&&<div style={{flex:1,minWidth:84,background:C.surfaceAlt,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:14,fontWeight:800,color:C.warning}}>{Math.round(totals.armor)}</div><div style={{fontSize:9,color:C.textMute}}>armor HP/s in</div></div>}
              {totals.hull>0&&<div style={{flex:1,minWidth:84,background:C.surfaceAlt,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:14,fontWeight:800,color:C.danger}}>{Math.round(totals.hull)}</div><div style={{fontSize:9,color:C.textMute}}>hull HP/s in</div></div>}
              {hasWeb&&<div style={{flex:1,minWidth:84,background:C.surfaceAlt,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:14,fontWeight:800,color:C.accent}}>-{Math.round((1-webMult)*100)}%</div><div style={{fontSize:9,color:C.textMute}}>your speed (web)</div></div>}
              {hasNeut&&<div style={{flex:1,minWidth:84,background:C.surfaceAlt,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:14,fontWeight:800,color:C.danger}}>{Math.round(neutGJs)}</div><div style={{fontSize:9,color:C.textMute}}>GJ/s neut</div></div>}
              {hasPaint&&<div style={{flex:1,minWidth:84,background:C.surfaceAlt,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:14,fontWeight:800,color:C.warning}}>+{Math.round(painterSig)}%</div><div style={{fontSize:9,color:C.textMute}}>your sig (paint)</div></div>}
              {hasDamp&&<div style={{flex:1,minWidth:84,background:C.surfaceAlt,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:14,fontWeight:800,color:C.accent}}>{Math.round(dampLock)}%</div><div style={{fontSize:9,color:C.textMute}}>your lock range</div></div>}
              {hasTD&&<div style={{flex:1,minWidth:84,background:C.surfaceAlt,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:14,fontWeight:800,color:C.accent}}>{Math.round(tdTrack)}%</div><div style={{fontSize:9,color:C.textMute}}>your tracking</div></div>}
              {hasGD&&<div style={{flex:1,minWidth:84,background:C.surfaceAlt,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:14,fontWeight:800,color:C.accent}}>{Math.round(gdRange)}%</div><div style={{fontSize:9,color:C.textMute}}>your missile range</div></div>}
            </div>
          ):<div style={{fontSize:11,color:C.textMute,paddingLeft:2}}>No reps, webs, or neuts on this fit (more EWAR coming soon)</div>}
        </div>);
      })}
      <button onClick={()=>setShowProjPicker(true)} style={{width:"100%",padding:"10px 0",background:C.surfaceAlt,border:`1px dashed ${C.border}`,borderRadius:8,color:C.textMid,fontSize:12,fontWeight:600,cursor:"pointer",marginTop:4}}>+ Add Projected Fit</button>
      {showProjPicker&&<FitPickerSheet title="Project a Fit" fitsDB={fitsDB} onSelect={(ship,fit)=>setProjFits(prev=>[...prev,{ship,fitName:fit.name,rangeKm:30}])} onClose={()=>setShowProjPicker(false)}/>}
    </div>)}
    {section==="command"&&(<div style={{flex:1,overflowY:"auto",padding:12}}>
      <div style={{fontSize:11,color:C.textMute,marginBottom:12}}>Apply command burst bonuses from a fleet support ship fit. Bursts use the source fit's modules, charges, and active state.</div>
      {cmdFits.length===0&&<div style={{textAlign:"center",color:C.textMute,padding:"24px 0",fontSize:13}}>No command fits applied</div>}
      {cmdFits.map((f,i)=>{
        const srcFit=fitsDB[f.ship]?.find(x=>x.name===f.fitName);
        const bursts=srcFit?computeCommandBursts({name:f.ship,typeID:tidByName(f.ship)},srcFit.slots,SKILL_DEFAULTS,{implants:srcFit.implants,boosters:srcFit.boosters}):[];
        return(<div key={i} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 14px",marginBottom:8}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}><div><div style={{fontSize:12,fontWeight:700,color:C.text}}>{f.fitName}</div><div style={{fontSize:10,color:C.textMute,marginTop:2}}>{f.ship}</div></div><button onClick={()=>setCmdFits(cmdFits.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:C.danger,cursor:"pointer",fontSize:14}}>x</button></div>
          {bursts.length===0&&<div style={{fontSize:11,color:C.textMute,paddingLeft:8}}>No active command bursts on this fit</div>}
          {bursts.map((b,j)=><div key={j} style={{fontSize:11,color:C.rig,paddingLeft:8,marginBottom:3}}>- {b.label}: {b.value>0?"+":""}{Math.round(b.value*10)/10}{WARFARE_BUFF_UNIT[b.buffID]||"%"}</div>)}
        </div>);
      })}
      <button onClick={()=>setShowCmdPicker(true)} style={{width:"100%",padding:"12px 0",background:C.accentLight,border:`1px solid ${C.accentBorder}`,borderRadius:8,color:C.accent,fontSize:13,fontWeight:700,cursor:"pointer"}}>+ Add Command Fit</button>
      {showCmdPicker&&<FitPickerSheet title="Select Command Ship Fit" fitsDB={fitsDB} onSelect={(ship,fit)=>setCmdFits(prev=>[...prev,{ship,fitName:fit.name}])} onClose={()=>setShowCmdPicker(false)}/>}
    </div>)}
  </div>);
}

// ═══ APP CHROME ════════════════════════════════════════════════
// ═══ SKILLS PANEL ═══════════════════════════════════════════════
const SKILL_GROUPS=[
  {label:"Engineering & Fitting",color:C.warning,skills:[
    {key:"cpuManagement",       label:"CPU Management",           desc:"+5% CPU output/lv"},
    {key:"powerGridManagement", label:"Power Grid Management",    desc:"+5% PG output/lv"},
    {key:"weaponUpgrades",      label:"Weapon Upgrades",          desc:"-5% turret/launcher CPU/lv"},
    {key:"advWeaponUpgrades",   label:"Adv. Weapon Upgrades",     desc:"-2% turret/launcher PG/lv"},
    {key:"energyManagement",    label:"Energy Management",        desc:"+5% cap capacity/lv"},
    {key:"energySystemsOp",     label:"Energy Systems Operation", desc:"-5% cap recharge time/lv"},
  ]},
  {label:"Shield",color:C.mid,skills:[
    {key:"shieldManagement", label:"Shield Management", desc:"+5% shield HP/lv"},
    {key:"shieldOperation",  label:"Shield Operation",  desc:"-5% shield recharge time/lv"},
  ]},
  {label:"Armor & Hull",color:C.warning,skills:[
    {key:"hullUpgrades", label:"Hull Upgrades", desc:"+5% armor HP/lv"},
    {key:"mechanic",     label:"Mechanic",       desc:"+5% hull HP/lv"},
  ]},
  {label:"Navigation",color:C.rig,skills:[
    {key:"navigation",         label:"Navigation",          desc:"+5% max velocity/lv"},
    {key:"evasiveManeuvering", label:"Evasive Maneuvering", desc:"+5% agility reduction/lv"},
  ]},
  {label:"Gunnery",color:C.danger,skills:[
    {key:"gunnery",            label:"Gunnery",             desc:"+2% turret ROF/lv"},
    {key:"rapidFiring",        label:"Rapid Firing",        desc:"+4% turret ROF/lv"},
    {key:"surgicalStrike",     label:"Surgical Strike",     desc:"+3% turret damage/lv"},
    {key:"sharpshooter",       label:"Sharpshooter",        desc:"+5% optimal range/lv"},
    {key:"trajectoryAnalysis", label:"Trajectory Analysis", desc:"+4% falloff range/lv"},
    {key:"motionPrediction",   label:"Motion Prediction",   desc:"+5% tracking speed/lv"},
  ]},
  {label:"Missiles",color:C.high,skills:[
    {key:"missileLaunchers", label:"Missile Launcher Operation", desc:"-2% launcher ROF/lv"},
    {key:"warheadUpgrades",  label:"Warhead Upgrades",           desc:"+2% missile damage/lv"},
  ]},
  {label:"Drones",color:C.rig,skills:[
    {key:"droneInterfacing", label:"Drone Interfacing", desc:"+20% drone damage/lv"},
  ]},
  {label:"Ship Command",color:C.high,skills:[
    {key:"minmatarBattleship",   label:"Minmatar Battleship",    desc:"+per-level ship bonus"},
    {key:"amarrBattleship",      label:"Amarr Battleship",        desc:"+per-level ship bonus"},
    {key:"gallenteBattleship",   label:"Gallente Battleship",     desc:"+per-level ship bonus"},
    {key:"caldariBattleship",    label:"Caldari Battleship",      desc:"+per-level ship bonus"},
    {key:"marauders",            label:"Marauders",               desc:"+per-level tracking/repair"},
    {key:"heavyAssaultCruisers", label:"Heavy Assault Cruisers",  desc:"+per-level bonus"},
  ]},
];

function SkillsPanel({skills,setSkills}){
  const setAll=lv=>setSkills(Object.fromEntries(Object.keys(SKILL_DEFAULTS).map(k=>[k,lv])));
  return(
    <div>
      <div style={{display:"flex",gap:8,marginBottom:14}}>
        <button onClick={()=>setAll(5)} style={{flex:1,padding:"8px 0",background:C.accentLight,border:`1px solid ${C.accentBorder}`,borderRadius:8,color:C.accent,fontSize:12,fontWeight:700,cursor:"pointer"}}>All V (Max)</button>
        <button onClick={()=>setAll(4)} style={{flex:1,padding:"8px 0",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,color:C.textMid,fontSize:12,fontWeight:700,cursor:"pointer"}}>All IV</button>
        <button onClick={()=>setAll(0)} style={{flex:1,padding:"8px 0",background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.25)",borderRadius:8,color:C.danger,fontSize:12,fontWeight:700,cursor:"pointer"}}>Clear All</button>
      </div>
      {SKILL_GROUPS.map(grp=>(
        <div key={grp.label} style={{marginBottom:10}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6,paddingBottom:4,borderBottom:`1px solid ${C.border}`}}>
            <div style={{width:8,height:8,borderRadius:99,background:grp.color}}/>
            <span style={{fontSize:11,fontWeight:700,color:C.text,textTransform:"uppercase",letterSpacing:.5}}>{grp.label}</span>
          </div>
          {grp.skills.map(sk=>(
            <div key={sk.key} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${C.border}22`}}>
              <div style={{flex:1,minWidth:0,marginRight:8}}>
                <div style={{fontSize:12,fontWeight:600,color:C.text}}>{sk.label}</div>
                <div style={{fontSize:10,color:C.textMute}}>{sk.desc}</div>
              </div>
              <div style={{display:"flex",gap:3,flexShrink:0}}>
                {[1,2,3,4,5].map(lv=>(
                  <button key={lv} onClick={()=>setSkills(prev=>({...prev,[sk.key]:lv}))}
                    style={{width:24,height:24,borderRadius:5,border:"none",cursor:"pointer",fontWeight:700,fontSize:11,
                      background:skills[sk.key]>=lv?grp.color:C.surfaceAlt,
                      color:skills[sk.key]>=lv?"#fff":C.textMute}}>
                    {lv}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
      <div style={{marginTop:10,padding:"10px 12px",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,fontSize:10,color:C.textMute}}>
        Ship hull bonuses (e.g. Raven missile damage, Drake resists) are not yet included — they require per-ship bonus data.
      </div>
    </div>
  );
}

function SettingsOverlay({onClose,skills,setSkills,factorInReload,setFactorInReload}){
  const[market,setMarket]=useState("evetycoon");
  const[section,setSection]=useState("skills");
  return(<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",zIndex:100,display:"flex",flexDirection:"column",justifyContent:"flex-end",alignItems:"center"}}>
    <div style={{width:"100%",maxWidth:430,background:C.surface,borderRadius:"16px 16px 0 0",maxHeight:"90vh",display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{width:36,height:4,background:C.border,borderRadius:99,margin:"10px auto 0"}}/>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",borderBottom:`1px solid ${C.border}`}}><span style={{fontSize:16,fontWeight:700,color:C.text}}>Settings</span><button onClick={onClose} style={{background:"none",border:"none",color:C.textMid,fontSize:20,cursor:"pointer",padding:"0 4px"}}>x</button></div>
      <div className="hs" style={{overflowX:"auto",display:"flex",gap:0,borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
        {[{key:"skills",label:"Skills"},{key:"esi",label:"ESI"},{key:"market",label:"Market"},{key:"implants",label:"Loadouts"},{key:"overrides",label:"Overrides"}].map(n=><button key={n.key} onClick={()=>setSection(n.key)} style={{flexShrink:0,padding:"9px 14px",fontSize:12,fontWeight:600,background:"none",border:"none",cursor:"pointer",color:section===n.key?C.accent:C.textMute,borderBottom:section===n.key?`2px solid ${C.accent}`:"2px solid transparent"}}>{n.label}</button>)}
      </div>
      <div style={{flex:1,overflowY:"auto",padding:16}}>
        {section==="skills"&&<SkillsPanel skills={skills} setSkills={setSkills}/>}
        {section==="esi"&&<div><div style={{background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:10,padding:14}}><div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:4}}>EVE ESI Connection</div><div style={{fontSize:11,color:C.textMute,marginBottom:10}}>Connect your EVE account to import skills, implants, and fits. Cloud fit sync coming soon.</div><div style={{marginBottom:10,padding:"8px 12px",background:C.surface,border:`1px dashed ${C.border}`,borderRadius:8,fontSize:11,color:C.textMute,textAlign:"center"}}>Not connected</div><button style={{width:"100%",padding:"10px 0",background:C.accent,border:"none",borderRadius:8,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Connect with EVE SSO</button></div></div>}
        {section==="market"&&<div>{[{key:"ceve",label:"ceve-market.org"},{key:"evetycoon",label:"EVE Tycoon"},{key:"fuzzwork",label:"Fuzzwork Market"}].map(m=>(<div key={m.key} onClick={()=>setMarket(m.key)} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",background:C.surface,border:`1px solid ${market===m.key?C.accentBorder:C.border}`,borderRadius:10,marginBottom:8,cursor:"pointer"}}><div style={{width:18,height:18,borderRadius:99,border:`2px solid ${market===m.key?C.accent:C.borderStrong}`,display:"flex",alignItems:"center",justifyContent:"center"}}>{market===m.key&&<div style={{width:8,height:8,borderRadius:99,background:C.accent}}/>}</div><span style={{fontSize:13,fontWeight:market===m.key?700:500,color:market===m.key?C.text:C.textMid}}>{m.label}</span></div>))}</div>}
        {section==="implants"&&<div>
          <div style={{fontSize:12,color:C.textMid,marginBottom:12}}>Manage your implant loadouts from the <strong>Implants</strong> tab - use the "Save Current" button to save, tap any loadout to load it.</div>
          <div style={{padding:"12px 14px",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:10,fontSize:11,color:C.textMute}}>Loadouts are saved per-session. Cloud sync via EVE SSO coming in a future update.</div>
        </div>}
        {section==="overrides"&&<div>{[["Max Velocity","1,240 m/s"],["Signature Radius","385 m"],["Align Time","11.2 s"],["Scan Resolution","108 mm"]].map(([label,ph])=>(<div key={label} style={{marginBottom:10}}><div style={{fontSize:11,color:C.textMid,marginBottom:4}}>{label}</div><input placeholder={ph} style={{width:"100%",padding:"8px 10px",background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:7,color:C.text,fontSize:12,boxSizing:"border-box"}}/></div>))}<button style={{width:"100%",marginTop:8,padding:"10px 0",background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.3)",borderRadius:8,color:C.danger,fontSize:12,fontWeight:600,cursor:"pointer"}}>Reset All Overrides</button></div>}
      </div>
      <div style={{flexShrink:0,padding:"10px 16px calc(10px + env(safe-area-inset-bottom, 0px))",borderTop:`1px solid ${C.border}`,background:C.surfaceAlt,fontSize:10,lineHeight:1.5,color:C.textMute,textAlign:"center"}}>
        Unofficial, fan-made tool — not affiliated with, endorsed by, or sponsored by CCP Games / Fenris Creations. EVE Online and all related materials are used with limited permission; all intellectual property belongs to CCP hf.
      </div>
    </div>
  </div>);
}

// ═══ EXPORT FIT MODAL ═══════════════════════════════════════════════
const EXPORT_PREFS_KEY = 'pyfa_export_prefs';
function ExportFitModal({activeFit, slots, implants, boosters, cargo, onClose}) {
  const _lsGet=()=>{try{return JSON.parse(localStorage.getItem(EXPORT_PREFS_KEY)||'{}');}catch{return {};}};
  const _p=_lsGet();
  const [incCharges,  setIncCharges]  = useState(_p.charges  ?? true);
  const [incImplants, setIncImplants] = useState(_p.implants ?? true);
  const [incBoosters, setIncBoosters] = useState(_p.boosters ?? true);
  const [incCargo,    setIncCargo]    = useState(_p.cargo    ?? false);
  const [copied,      setCopied]      = useState(false);

  const genEFT = () => {
    const ship = activeFit?.ship ?? 'Unknown';
    const name = activeFit?.fitName ?? 'Unnamed';
    const lines = [`[${ship}, ${name}]`];
    // Sections in EFT order: high, mid, low, rigs
    for (const sec of ['high', 'mid', 'low', 'rigs']) {
      for (const slot of (slots?.[sec] ?? [])) {
        if (!slot.typeID) { lines.push(''); continue; }
        const charge = incCharges && slot.ammo ? `, ${slot.ammo}` : '';
        lines.push(`${slot.name}${charge}`);
      }
      if (sec !== 'rigs') lines.push('');
    }
    if (incImplants && implants?.length) {
      lines.push('');
      for (const imp of implants) lines.push(imp.name ?? '');
    }
    if (incBoosters && boosters?.length) {
      lines.push('');
      for (const b of boosters) lines.push(b.name ?? '');
    }
    if (incCargo && cargo?.length) {
      lines.push('');
      for (const c of cargo) { const qty = c.qty > 1 ? ` x${c.qty}` : ''; lines.push(`${c.name}${qty}`); }
    }
    return lines.join('\n');
  };

  const doExport = () => {
    try { localStorage.setItem(EXPORT_PREFS_KEY, JSON.stringify({charges:incCharges,implants:incImplants,boosters:incBoosters,cargo:incCargo})); } catch(e) {}
    const txt = genEFT();
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(txt).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);}).catch(()=>{
        // Fallback for clipboard permission denied:
        const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);setCopied(true);setTimeout(()=>setCopied(false),2000);
      });
    } else {
      // HTTP fallback:
      const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);setCopied(true);setTimeout(()=>setCopied(false),2000);
    }
  };

  const CheckRow = ({label, val, setVal}) => (
    <div onClick={()=>setVal(v=>!v)} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 0',borderBottom:`1px solid ${C.border}`,cursor:'pointer'}}>
      <div style={{width:20,height:20,borderRadius:4,border:`2px solid ${val?C.accent:C.border}`,background:val?C.accent:'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,color:'#fff',fontSize:12,fontWeight:700}}>
        {val?'✓':''}
      </div>
      <span style={{fontSize:13,color:C.text}}>{label}</span>
    </div>
  );

  return (
    <div style={{position:'fixed',inset:0,zIndex:200,display:'flex',alignItems:'flex-end'}} onClick={onClose}>
      <div style={{width:'100%',background:C.surface,borderRadius:'16px 16px 0 0',padding:20,boxShadow:'0 -8px 32px rgba(0,0,0,.5)'}} onClick={e=>e.stopPropagation()}>
        <div style={{fontSize:15,fontWeight:700,color:C.text,marginBottom:4}}>Export EFT Fit</div>
        <div style={{fontSize:11,color:C.textMute,marginBottom:16}}>Select what to include in the exported fit text</div>
        <CheckRow label="Loaded Charges (e.g. Hail L)" val={incCharges} setVal={setIncCharges}/>
        <CheckRow label="Implants" val={incImplants} setVal={setIncImplants}/>
        <CheckRow label="Boosters" val={incBoosters} setVal={setIncBoosters}/>
        <CheckRow label="Cargo" val={incCargo} setVal={setIncCargo}/>
        <button onClick={doExport} style={{width:'100%',marginTop:16,padding:'14px',borderRadius:10,border:'none',background:copied?C.rig:C.accent,color:'#fff',fontSize:14,fontWeight:700,cursor:'pointer'}}>
          {copied ? '✓ Copied to clipboard!' : 'Copy EFT to Clipboard'}
        </button>
        <button onClick={onClose} style={{width:'100%',marginTop:8,padding:'10px',borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.textMute,fontSize:13,cursor:'pointer'}}>
          Cancel
        </button>
      </div>
    </div>
  );
}


function HamburgerMenu({onClose,onOpenSettings,onImportFit}){
  return(<div style={{position:"fixed",inset:0,zIndex:90}} onClick={onClose}>
    <div style={{position:"absolute",top:0,left:0,bottom:0,width:260,background:C.surface,borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",boxShadow:"4px 0 24px rgba(0,0,0,.5)"}} onClick={e=>e.stopPropagation()}>
      <div style={{padding:"20px 16px 12px",borderBottom:`1px solid ${C.border}`}}><div style={{fontSize:18,fontWeight:800,color:C.text,marginBottom:2}}>Pyfa Mobile</div><div style={{fontSize:11,color:C.textMute}}>EVE Online Fitting Tool</div></div>
      {[{icon:"&#128229;",label:"Import Fit",sub:"EFT from clipboard",action:"import"},{icon:"&#128228;",label:"Export Fit",sub:"Copy EFT to clipboard",action:"export"},{icon:"&#128176;",label:"Optimize Fit Price",sub:"Swap modules to reduce cost"},{icon:"&#9881;",label:"Settings",sub:"ESI, market, overrides",action:"settings"}].map(item=>(<button key={item.label} onClick={()=>{if(item.action==="settings"){onOpenSettings();onClose();}else if(item.action==="import"){onImportFit();onClose();}else if(item.action==="export"){if(onExportFit)onExportFit();onClose();}else onClose();}} style={{display:"flex",alignItems:"center",gap:12,padding:"14px 16px",background:"none",border:"none",cursor:"pointer",textAlign:"left",borderBottom:`1px solid ${C.border}`}}><span style={{fontSize:20}} dangerouslySetInnerHTML={{__html:item.icon}}/><div><div style={{fontSize:13,fontWeight:600,color:C.text}}>{item.label}</div><div style={{fontSize:11,color:C.textMute,marginTop:1}}>{item.sub}</div></div></button>))}
    </div>
  </div>);
}

function AppHeader({onHamburger,activeFit,onShipInfo}){
  const ship=activeFit?.ship?lookupShip(activeFit.ship):{};
  const shipName=activeFit?.ship??"Pyfa Mobile";
  const subLabel=ship.hullClass?`${ship.race??""} ${ship.hullClass}`.trim():"EVE Online Fitting Tool";
  return(<div style={{background:C.surface,borderBottom:`1px solid ${C.border}`,padding:"14px 14px 12px"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div>
        <div style={{fontSize:10,fontWeight:600,color:C.textMute,letterSpacing:.8,textTransform:"uppercase",marginBottom:2}}>Pyfa Mobile</div>
        <div style={{fontSize:19,fontWeight:700,color:C.text,lineHeight:1.2}}>{shipName}</div>
        <div style={{fontSize:12,color:C.textMid,marginTop:1}}>{subLabel}</div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <button onClick={onShipInfo} style={{width:52,height:52,borderRadius:11,background:C.surfaceAlt,border:`1px solid ${C.border}`,overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",cursor:onShipInfo?'pointer':'default',padding:0}}>
          {ship.typeID
            ?<img src={eveRender(ship.typeID,64)} width={52} height={52} alt="" style={{borderRadius:11}} onError={e=>{e.target.style.display="none";}}/>
            :<span style={{fontSize:26}}>&#128640;</span>
          }
        </button>
        <button onClick={onHamburger} style={{width:40,height:40,borderRadius:9,background:C.surfaceAlt,border:`1px solid ${C.border}`,color:C.text,fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1}}>&#9776;</button>
      </div>
    </div>
  </div>);
}

// Local pyfa booster-bottle icon (the equippable-booster emblem the EVE image server won't
// serve — it returns the crafting-material vial for booster typeIDs). new URL(..., import.meta.url)
// lets Vite fingerprint + bundle the asset for both dev and the built/Capacitor app.
const BOOSTER_ICON=new URL("../pyfa-master/imgs/icons/3211@2x.png",import.meta.url).href;

function BottomNav({active,onChange}){
  const tabs=[
    {key:"fittings",label:"Fittings",navKey:"fit"},
    {key:"cargo",   label:"Cargo",   navKey:"cargo"},
    {key:"drones",  label:"Drones",  navKey:"drones"},
    {key:"implants",label:"Implants",navKey:"implants"},
    {key:"effects", label:"Effects", navKey:"effects"},
  ];
  // High-res EVE item icons (served at 64px, crisp when scaled to 22px) in place of the
  // low-res bundle icons: Reactor Control Unit (Fittings), Expanded Cargohold (Cargo),
  // Hobgoblin II (Drones), Ocular Filter (Implants), Drop Booster (Effects).
  const NAV_ICON_TYPEIDS={fit:1353,cargo:1317,drones:24395,implants:10216};
  return(<div style={{display:"flex",background:C.surface,borderTop:`1px solid ${C.border}`,paddingBottom:"env(safe-area-inset-bottom, 0px)"}}>
    {tabs.map(t=>{const ovTid=NAV_ICON_TYPEIDS[t.navKey];const src=ovTid?eveIcon(ovTid,64):(navIcons?.[t.navKey]??'');const dim=active===t.key?1:0.5;return(<button key={t.key} onClick={()=>onChange(t.key)} style={{flex:1,padding:"7px 0 8px",background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
      <img src={t.navKey==="effects"?BOOSTER_ICON:src} width={22} height={22} alt="" style={{objectFit:"contain",opacity:dim}} onError={e=>{e.target.style.visibility="hidden";}}/>
      <span style={{fontSize:9,fontWeight:700,color:active===t.key?C.accent:C.textMute,letterSpacing:.3}}>{t.label}</span>
      {active===t.key&&<div style={{width:20,height:2,background:C.accent,borderRadius:99,marginTop:1}}/>}
    </button>);})}
  </div>);
}

// ═══ ROOT APP ══════════════════════════════════════════════════
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
  const[bottomTab,setBottomTab]=useState("fittings");
  const[showHamburger,setShowHamburger]=useState(false);
  const[showSettings,setShowSettings]=useState(false);
  const[fitsDB,setFitsDB]=useState(()=>{try{const s=localStorage.getItem("pyfa-fitsdb");if(s)return JSON.parse(s);}catch{}return SAVED_FITS_SEED;});
  const[activeFit,setActiveFit]=useState(()=>{try{const s=localStorage.getItem("pyfa-activefit");if(s)return JSON.parse(s);}catch{}return{ship:"Hyperion",fitName:"PvP Blaster Hyperion"};});
  const initialFit=(()=>{try{const db=JSON.parse(localStorage.getItem("pyfa-fitsdb")||"null");const af=JSON.parse(localStorage.getItem("pyfa-activefit")||"null");if(db&&af)return db[af.ship]?.find(f=>f.name===af.fitName)||null;}catch{}return null;})();
  const emptyImplants=()=>Array.from({length:10},(_,i)=>({slot:i+1,name:"[Empty]",bonus:null}));
  const[slots,setSlots]=useState(initialFit?.slots??generateEmptySlots(lookupShip("Hyperion")));
  const[drones,setDrones]=useState(initialFit?.drones??[]);
  const[fighters,setFighters]=useState(initialFit?.fighters??[]);
  // Incoming damage profile (shared: Stats resists/EHP + RAH, Fit-tab readouts, fighter EHP).
  const[dmgProfile,setDmgProfile]=useState({name:"Uniform",p:[0.25,0.25,0.25,0.25]});
  const[cargoItems,setCargoItems]=useState(initialFit?.cargo??[]);
  const[implants,setImplants]=useState(initialFit?.implants??emptyImplants());
  const[boosters,setBoosters]=useState(initialFit?.boosters??[]);
  // Projected fits (EWAR/remote reps) and command fits (burst projection), lifted to App level so
  // the stats/graph calc can consume them. Each entry references a saved fit + projection options.
  const[projFits,setProjFits]=useState(initialFit?.projFits??[]);
  const[cmdFits,setCmdFits]=useState(initialFit?.cmdFits??[]);
  const[skills,setSkills]=useState(()=>{try{const s=localStorage.getItem("pyfa-skills");if(s)return{...SKILL_DEFAULTS,...JSON.parse(s)};}catch{}return SKILL_DEFAULTS;});
  // Effective command-burst buffs projected from the selected command fits, applied to this fit.
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
  // Aggregate projected effects from projected fits at their ranges: remote reps (HP/s by layer),
  // a stacking-penalised web speed multiplier, and total neut cap drain (GJ/s).
  const projectedEffects=useMemo(()=>{
    const reps={shield:0,armor:0,hull:0};
    const webMults=[]; let neutGJs=0;
    // Collect per-effect debuff bonuses (range-scaled) for stacking.
    const col={sig:[],lock:[],scan:[],trk:[],topt:[],tfall:[],mrng:[],edly:[],avel:[],acld:[]};
    for(const pf of projFits){
      const fit=fitsDB[pf.ship]?.find(f=>f.name===pf.fitName);
      if(!fit)continue;
      const eff=computeProjectedReps({name:pf.ship,typeID:tidByName(pf.ship)},fit.slots,skills,{implants:fit.implants,boosters:fit.boosters});
      const rangeM=(pf.rangeKm??30)*1000;
      const rf=(o,fo)=>calcRangeFactor(o,fo,rangeM,true);
      for(const r of eff.reps)reps[r.kind]+=r.rawPS*rf(r.optimal,r.falloff);
      for(const w of eff.webs)webMults.push(1+(w.speedFactor*rf(w.optimal,w.falloff))/100);
      for(const n of eff.neuts)neutGJs+=n.gjPerSec*rf(n.optimal,n.falloff);
      for(const p of (eff.painters||[]))col.sig.push(p.sigBonus*rf(p.optimal,p.falloff));
      for(const d of (eff.damps||[])){col.lock.push(d.lockBonus*rf(d.optimal,d.falloff));col.scan.push(d.scanResBonus*rf(d.optimal,d.falloff));}
      for(const t of (eff.trackDisr||[])){const f=rf(t.optimal,t.falloff);col.trk.push(t.tracking*f);col.topt.push(t.optimalBonus*f);col.tfall.push(t.falloffBonus*f);}
      for(const g of (eff.guideDisr||[])){const f=rf(g.optimal,g.falloff);col.mrng.push(g.missileRange*f);col.edly.push(g.explosionDelay*f);col.avel.push(g.aoeVel*f);col.acld.push(g.aoeCloud*f);}
    }
    const webMult=webMults.length?stackingPenalty(webMults):1;
    const stackPct=(arr)=>arr.length?(stackingPenalty(arr.map(p=>1+p/100))-1)*100:0;
    const debuffs={sig:stackPct(col.sig),lockRange:stackPct(col.lock),scanRes:stackPct(col.scan),tracking:stackPct(col.trk),turretOptimal:stackPct(col.topt),turretFalloff:stackPct(col.tfall),missileRange:stackPct(col.mrng),explosionDelay:stackPct(col.edly),aoeVel:stackPct(col.avel),aoeCloud:stackPct(col.acld)};
    const hasDebuff=Object.values(debuffs).some(v=>Math.abs(v)>0.05);
    return {reps,webMult,neutGJs,debuffs:hasDebuff?debuffs:null};
  },[projFits,fitsDB,skills]);
  const projectedReps=projectedEffects.reps;
  // Real active-drone DPS (skills + hull bonuses), so the Drones window matches the Stats window.
  const activeDroneDps=useMemo(()=>{
    const shipName=activeFit?.ship;
    if(!shipName) return 0;
    try{
      const cs=calcFitStats({name:shipName,typeID:tidByName(shipName)},slots,drones??[],skills,{implants,boosters,externalBursts,projectedWebMult:projectedEffects?.webMult,projectedNeutGJs:projectedEffects?.neutGJs,projectedDebuffs:projectedEffects?.debuffs});
      return cs?.droneDps?.total ?? 0;
    }catch{ return 0; }
  },[activeFit,slots,drones,skills,implants,boosters,externalBursts,projectedEffects]);
  // Per-squadron computed detail (DPS, speed, EHP, ability states) for the fighter management UI.
  const fighterInfo=useMemo(()=>{
    const shipName=activeFit?.ship;
    if(!shipName||!(fighters?.length)) return [];
    try{
      const cs=calcFitStats({name:shipName,typeID:tidByName(shipName)},slots,drones??[],skills,{implants,boosters,externalBursts,damageProfile:dmgProfile?.p,fighters:fighters.map(f=>({name:f.name,qty:f.qty??1,active:f.active,abilities:f.abilities}))});
      return cs?.fighterDetails ?? [];
    }catch{ return []; }
  },[activeFit,slots,drones,skills,implants,boosters,fighters,dmgProfile]);
  const[factorInReload,setFactorInReload]=useState(()=>{try{return localStorage.getItem("pyfa-factor-reload")==="1";}catch{return false;}});
  const[fittingsView,setFittingsView]=useState("active");
  const[showShipInfo,setShowShipInfo]=useState(false);
  const[showImportFit,setShowImportFit]=useState(false);
  const[showExportFit,setShowExportFit]=useState(false);
  const loadFit=(ship,fitName)=>{
    const fit=fitsDB[ship]?.find(f=>f.name===fitName);
    setActiveFit({ship,fitName});
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
    // Build subsystem slot objects (4 slots, ordered Core/Defensive/Offensive/Propulsion).
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
  const returnToFit=()=>{setBottomTab("fittings");setFittingsView("active");};
  return(<div style={{background:C.bg,minHeight:"100vh",display:"flex",justifyContent:"center"}}>
    <style>{GLOBAL_CSS}</style>
    <div style={{width:"100%",maxWidth:430,minHeight:"100vh",display:"flex",flexDirection:"column",background:C.bg}}>
      <AppHeader onHamburger={()=>setShowHamburger(true)} activeFit={activeFit} onShipInfo={()=>setShowShipInfo(true)}/>
      {bottomTab!=="fittings"&&<ActiveFitBar activeFit={activeFit} onReturn={returnToFit}/>}
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        {bottomTab==="fittings"&&<FittingsScreen activeFit={activeFit} setActiveFit={setActiveFit} loadFit={loadFit} view={fittingsView} setView={setFittingsView} fitsDB={fitsDB} setFitsDB={setFitsDB} slots={slots} setSlots={setSlots} setDrones={setDrones} setFighters={setFighters} fighters={fighters} setCargoItems={setCargoItems} setImplants={setImplants} setBoosters={setBoosters} setProjFits={setProjFits} setCmdFits={setCmdFits} skills={skills} implants={implants} boosters={boosters} drones={drones} factorInReload={factorInReload} setFactorInReload={setFactorInReload} externalBursts={externalBursts} projectedReps={projectedReps} projectedEffects={projectedEffects} dmgProfile={dmgProfile} setDmgProfile={setDmgProfile}/>}
        {bottomTab==="cargo"   &&<CargoScreen items={cargoItems} setItems={setCargoItems} slots={slots} shipCapacity={(()=>{const t=tidByName(activeFit?.ship);return t&&TYPES[t]?(TYPES[t].attrs?.capacity??1150):1150;})()} />}
        {bottomTab==="drones"  &&<DronesScreen drones={drones} setDrones={setDrones} fighters={fighters} setFighters={setFighters} fighterInfo={fighterInfo} activeDroneDps={activeDroneDps} shipDroneBay={(()=>{const t=tidByName(activeFit?.ship);return t&&TYPES[t]?(TYPES[t].attrs?.droneCapacity??0):0;})()} shipDroneBandwidth={(()=>{const t=tidByName(activeFit?.ship);return t&&TYPES[t]?(TYPES[t].attrs?.droneBandwidth??0):0;})()} shipFighter={(()=>{const t=tidByName(activeFit?.ship);const a=t&&TYPES[t]?TYPES[t].attrs:null;return a?{cap:a.fighterCapacity??0,tubes:a.fighterTubes??0,light:a.fighterLightSlots??0,heavy:a.fighterHeavySlots??0,support:a.fighterSupportSlots??0}:{cap:0,tubes:0,light:0,heavy:0,support:0};})()} />}
        {bottomTab==="implants"&&<ImplantsScreen implants={implants} setImplants={setImplants}/>}
        {bottomTab==="effects" &&<EffectsScreen fitsDB={fitsDB} boosters={boosters} setBoosters={setBoosters} projFits={projFits} setProjFits={setProjFits} cmdFits={cmdFits} setCmdFits={setCmdFits}/>}
      </div>
      <BottomNav active={bottomTab} onChange={setBottomTab}/>
    </div>
    {showHamburger&&<HamburgerMenu onClose={()=>setShowHamburger(false)} onOpenSettings={()=>{setShowSettings(true);setShowHamburger(false);}} onImportFit={()=>setShowImportFit(true)} onExportFit={()=>setShowExportFit(true)}/>}
    {showShipInfo&&activeFit?.ship&&<ShipInfoSheet ship={lookupShip(activeFit.ship)??{name:activeFit.ship}} onClose={()=>setShowShipInfo(false)}/>}
    {showExportFit&&<ExportFitModal activeFit={activeFit} slots={slots} implants={implants} boosters={boosters} cargo={[]} onClose={()=>setShowExportFit(false)}/>}
    {showSettings &&<SettingsOverlay onClose={()=>setShowSettings(false)} skills={skills} setSkills={setSkills} factorInReload={factorInReload} setFactorInReload={setFactorInReload}/>}
    {showImportFit&&<ImportFitSheet onClose={()=>setShowImportFit(false)} onImport={importFit}/>}
  </div>);
}
