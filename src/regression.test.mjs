/**
 * regression.test.mjs — pyfa-validated baselines. Zero dependencies; run with:
 *
 *     node src/regression.test.mjs
 *
 * Exits 1 on any failure, so it can gate a PR in CI.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every number below was validated by hand against pyfa v2.68.0 with all skills at V. They are not
 * "whatever the code currently prints" — they are the correct answers, and several of them cost a
 * lot of digging to establish. If you change calc.js, dogma-engine.js or the dogma-*.json bundles
 * and one of these moves, you have broken something real. Do not "fix" the test to match new output
 * without re-validating against pyfa first.
 *
 * Tolerances are relative. Where a baseline differs slightly from pyfa's displayed figure, the pyfa
 * value is given in the comment and the tolerance covers the known rounding gap (pyfa rounds its
 * displayed repair/EHP numbers; our value is the more precise one).
 */

import { SKILL_DEFAULTS as SKILLS_ALL_V, calcFitStats, effectiveCycleMs, applyRemoteRepDiminishing, checkFitSkills, computeCommandBursts, computeProjectedReps, projectionResistances, usesTurretHardpoint, usesLauncherHardpoint, attrHighIsGood, calcTurretMult, calcTurretCTH, calcAngularSpeed, calcMissileFactor, formatStrengthValues, SKILL_CATALOG, SKILL_BY_TYPEID, ALPHA_SKILLS, itemSkillGap, TYPES } from './calc.js';
import { typeIDByName } from './dogma-engine-init.js';
import shipsData from './data/ships.json' with { type: 'json' };
import { TARGET_PROFILES } from './data/target-profiles.js';
import SYSFX from './data/system-effects.json' with { type: 'json' };
import { resolveTabs, sameTab, nextFitId } from './lib/fit-tabs.js';
import { fmtResource } from './lib/fmt.js';
import { differingAttributes, compareRows, sortCompareRows, derivedDirection, directionOf } from './lib/compare.js';
import { getCompatibleCharges, groupChargesForBrowser, defaultChargeFor, parseEFT, buildSlotsFromEFT, lookupShip, isMicroJumpDrive, fitCostRatioOf, fitCostFits } from './lib/core.js';
import { esiSkillsToAppSkills, esiSkillsToFullSkillMap } from './lib/esi.js';
import { resolvePilotSkills, describeSkillSheet, esiPilot, esiPilotId, PILOT_ALL_V, PILOT_ALPHA, PILOT_ME } from './lib/pilot.js';
import { buildShipTaxonomy, shipsUnder, nodeAtPath, classifyHull, TOP_ORDER, RACE_ICON_ID } from './lib/ship-taxonomy.js';
import { targetFitProfile } from './lib/graph-target.js';
import { byRecentlyModified, byNewestFitting } from './lib/fit-order.js';
import { jargonSearch, nameMatchesQuery, searchScore, initialsOf } from './lib/jargon.js';
import { browserMetaRank, metaOf } from './lib/meta.js';
import { REAL_MODULE_BROWSER, OFF_MARKET_MODULES, gestureTarget, validStatesFor, variantsOf, MUTA_BY_TYPE, mutaAttrRanges, snapToBase, droneAddQty, searchImplants, implantSetMembers, applyImplantSet, IMPLANT_NAME_TO_SLOT } from './lib/core.js';
const SYSTEM_EFFECTS = SYSFX.effects;

const tid = (n) => typeIDByName(n);
const M = (name, state, ammo) => ({ typeID: tid(name), state, ammo });
const EMPTY = { high: [], mid: [], low: [], rigs: [] };
const resistStr = (r) => [r.em, r.th, r.kin, r.exp].map((v) => v.toFixed(1)).join('/');

// The EVE client build these baselines were validated against (pyfa v2.68.0 / build 3424810).
// If the bundle is regenerated from a NEWER eve.db, some baselines will legitimately move — CCP
// rebalances things. That is a worklist, not a code regression. See CLAUDE.md -> "Upgrading eve.db".
//
// 2026-07-16 upgrade (build 3383521 -> 3424810): all 50 baselines passed UNCHANGED — none of the
// validated fits touch anything CCP moved in this SDE bump. What changed and was audited as a
// non-issue for this calculator (no code changes needed):
//   - Aralez (fighter) got a full stat rebalance (hp/mass/velocity/damage type/tracking/tech level).
//     Fighters are computed generically from their attributes, so this just flowed through.
//   - Support-fighter drones (Berserker/Valkyrie/Warrior SW-x00, 'Aergia' Hobgoblin SW-300) got
//     entityCruiseSpeed changes — an NPC/AI pursuit-speed attribute we don't read anywhere.
//   - 10 new short-duration event boosters (Clash/Volatile series) — no penalty attrs, no fitting
//     relevance; their bonus effects (virus strength, d-scan range) have no display surface here.
//   - Algos Navy Issue got a real drone HP/shield/armor role bonus (shipBonusGD2=10, effect 12908)
//     — we don't compute or display per-drone HP anywhere yet, so nothing to wire up.
//   - New effect 12924 (proximityDbuffTacticalDestroyerHPAddEffect) touches all 5 Tactical
//     Destroyers but its driving attribute is 0 on every hull — inert until CCP sets it via some
//     new site mechanic, not a static hull bonus.
//   - Breach Control module (SCARAB-pod damage resist) and the Imperial Navy 'Atonement' Tracking
//     Enhancer (laser cap-need reduction) are real but single ultra-niche items; deferred.
const VALIDATED_BUILD = '3424810';

let bundleVersion = null;
try {
  const { readFileSync } = await import('fs');
  const { fileURLToPath } = await import('url');
  const { join, dirname } = await import('path');
  bundleVersion = JSON.parse(readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'data', 'bundle-version.json'), 'utf8'));
} catch { /* pre-dates version stamping */ }

if (bundleVersion && bundleVersion.client_build !== VALIDATED_BUILD) {
  console.log('\n' + '!'.repeat(78));
  console.log(`  DATA VERSION MISMATCH`);
  console.log(`  bundle built from EVE client build ${bundleVersion.client_build} (SDE ${bundleVersion.sde_dump_date})`);
  console.log(`  baselines below were validated against build ${VALIDATED_BUILD}`);
  console.log('');
  console.log('  Failures below may be CCP REBALANCING, not code regressions. Do NOT simply update');
  console.log('  the expected values to whatever the code now prints — that turns validated baselines');
  console.log('  into "whatever we currently compute", which is worthless.');
  console.log('');
  console.log('  For each failure: open the fit in a pyfa of the SAME build, read the real number,');
  console.log('  and update the baseline WITH a justification in the commit message. If pyfa still');
  console.log('  agrees with the old value, you have found a real bug.');
  console.log('  Then bump VALIDATED_BUILD in this file.');
  console.log('!'.repeat(78));
} else if (bundleVersion) {
  console.log(`\ndata: EVE client build ${bundleVersion.client_build} (SDE ${bundleVersion.sde_dump_date}) — matches validated baselines`);
}

let passed = 0;
const failures = [];

function check(group, label, actual, expected, tol = 0.005) {
  let ok;
  if (typeof expected === 'string') {
    ok = actual === expected;
  } else {
    ok = Number.isFinite(actual) && Math.abs(actual - expected) <= Math.abs(expected) * tol;
  }
  if (ok) {
    passed++;
  } else {
    failures.push({ group, label, actual, expected });
  }
  const shown = typeof actual === 'number' ? actual.toFixed(1) : String(actual);
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(34)} ${shown.padStart(12)}   (expect ${expected})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. ASTARTE — RAH + command bursts + Asklepian implants + boosters
//    Exercises: RAH adapting to POST-burst resonances (two-pass), booster passive resists applied
//    UNPENALISED, and the Asklepian set multiplier (Alpha–Epsilon only — see CLAUDE.md).
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nASTARTE (RAH + bursts + Asklepian + boosters)');
  const fit = {
    high: [
      M('Heavy Neutron Blaster II', 'active', 'Void M'), M('Heavy Neutron Blaster II', 'active', 'Void M'),
      M('Heavy Neutron Blaster II', 'active', 'Void M'),
      M('Skirmish Command Burst II', 'active', 'Rapid Deployment Charge'),
      M('Armor Command Burst II', 'active', 'Armor Energizing Charge'),
      M('Heavy Neutron Blaster II', 'active', 'Void M'), M('Heavy Neutron Blaster II', 'active', 'Void M'),
    ],
    mid: [
      M('50MN Cold-Gas Enduring Microwarpdrive', 'active'),
      M('Medium Capacitor Booster II', 'active', 'Navy Cap Booster 800'),
      M('Federation Navy Stasis Webifier', 'active'), M('Dread Guristas Warp Scrambler', 'active'),
    ],
    low: [
      M('True Sansha Medium Armor Repairer', 'active'),
      M('Corelum A-Type Explosive Energized Membrane', 'online'),
      M('True Sansha Multispectrum Energized Membrane', 'online'),
      M('Reactive Armor Hardener', 'active'),
      M('Magnetic Field Stabilizer II', 'online'),
      M('True Sansha Medium Armor Repairer', 'active'),
    ],
    rigs: [M('Medium EM Armor Reinforcer II', 'online'), M('Medium Hybrid Burst Aerator II', 'online')],
  };
  const implants = [
    'Mid-grade Asklepian Alpha', 'Mid-grade Asklepian Beta', 'Mid-grade Asklepian Gamma',
    'Mid-grade Asklepian Delta', 'Mid-grade Asklepian Epsilon', 'Mid-grade Asklepian Omega',
    "Zainou 'Deadeye' Trajectory Analysis TA-705", "Zainou 'Deadeye' Medium Hybrid Turret MH-805",
    "Eifyr and Co. 'Gunslinger' Surgical Strike SS-905", 'Federation Navy Command Mindlink',
  ].map((name) => ({ name }));
  const boosters = [
    'Improved Exile Booster', 'Standard Drop Booster', "Agency 'Hardshell' TB9 Dose IV",
    'Republic Electronics Booster I', 'Republic Defense Booster II', 'Republic Mobility Booster I',
    'Federation Hardpoint Booster II',
  ].map((name) => ({ name, active: true }));
  const drones = [{ name: 'Warrior II', typeID: tid('Warrior II'), qty: 5, active: true }];

  const cs = calcFitStats({ typeID: tid('Astarte'), name: 'Astarte' }, fit, drones, null, { implants, boosters });
  check('astarte', 'weapon DPS', cs.weaponDps.total, 1200);
  check('astarte', 'armor resists (RAH active)', resistStr(cs.resists.armor), '82.8/83.2/90.6/83.0');
  check('astarte', 'shield resists', resistStr(cs.resists.shield), '4.0/60.8/85.0/50.0');
  check('astarte', 'hull resists', resistStr(cs.resists.hull), '35.7/34.3/33.0/33.0');
  // pyfa shows 1668.3; ours is 1671.0. The gap is pyfa rounding its displayed repair amount to 1132
  // when the true value is 1134.18 (see CLAUDE.md → Asklepian). 0.5% tolerance covers it.
  check('astarte', 'armor rep EHP/s', cs.armorRepEhpS, 1668.3, 0.005);
  check('astarte', 'scan resolution', cs.scanRes, 306);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. BANE — Lancer dreadnought doomsday (multi-tick beam weapon)
//    The lance deals damage PER TICK (doomsdayDamageDuration / doomsdayDamageCycleTime = 15 ticks),
//    spread across its 300s cycle. Volley is ONE tick. Getting this wrong costs ~1190 DPS.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nBANE (lancer doomsday — 15-tick beam)');
  const fit = {
    high: [
      M("'Azmaru' Electromagnetic Disruptive Lance", 'active'),
      M('XL Torpedo Launcher II', 'active', 'Scourge Rage XL Torpedo'),
      M('XL Torpedo Launcher II', 'active', 'Scourge Rage XL Torpedo'),
      M('XL Torpedo Launcher II', 'active', 'Scourge Rage XL Torpedo'),
      M('Siege Module II', 'active'), { type: 'empty' },
    ],
    mid: [
      M('Tracking Computer II', 'active', 'Optimal Range Script'),
      M('Heavy Capacitor Booster II', 'active', 'Navy Cap Booster 3200'),
      M('Capital F-RX Compact Capacitor Booster', 'active', 'Navy Cap Booster 3200'),
      M('Tracking Computer II', 'active', 'Optimal Range Script'),
    ],
    low: [
      M('Caldari Navy Ballistic Control System', 'online'), M('Caldari Navy Ballistic Control System', 'online'),
      M('Reactive Armor Hardener', 'active'),
      M('25000mm Rolled Tungsten Compact Plates', 'online'), M('25000mm Rolled Tungsten Compact Plates', 'online'),
      M('25000mm Steel Plates II', 'online'),
      M('Corelum C-Type Multispectrum Energized Membrane', 'online'),
      M('Corelum C-Type Multispectrum Energized Membrane', 'online'),
    ],
    rigs: [M('Capital Trimark Armor Pump I', 'online'), M('Capital Trimark Armor Pump I', 'online')],
  };
  const cs = calcFitStats({ typeID: tid('Bane'), name: 'Bane' }, fit, [], null, {});
  check('bane', 'weapon DPS (lance active)', cs.weaponDps.total, 13301);
  check('bane', 'volley (one lance tick)', cs.weaponVolley.total, 180870);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. MINOKAWA — Nirvana implant set + cap-booster hull bonus
//    Nirvana uses the FULL set product INCLUDING Omega (1.1^5 x 1.25). The Force Auxiliary C5 hull
//    bonus (+20%/level cap booster strength) targets the CHARGE's group, not the module's.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nMINOKAWA (Nirvana set + cap booster hull bonus)');
  const fit = {
    high: [
      M('Capital Remote Shield Booster II', 'active'), M('Capital Remote Shield Booster II', 'active'),
      M('Capital Murky Compact Remote Shield Booster', 'active'),
      M('Capital Murky Compact Remote Shield Booster', 'active'),
      M('Shield Command Burst II', 'active', 'Active Shielding Charge'),
      M('Triage Module II', 'active'),
    ],
    mid: [
      M('Multispectrum Shield Hardener II', 'active'), M('Capital Compact Pb-Acid Cap Battery', 'online'),
      M('Capital F-S9 Regolith Compact Shield Extender', 'online'),
      M('Multispectrum Shield Hardener II', 'active'), M('Capital Shield Extender II', 'online'),
      M('Capital F-S9 Regolith Compact Shield Extender', 'online'),
      M('Capital Capacitor Booster II', 'active', 'Navy Cap Booster 3200'),
    ],
    low: [
      M('True Sansha Power Diagnostic System', 'online'), M('True Sansha Power Diagnostic System', 'online'),
      M('True Sansha Power Diagnostic System', 'online'), M('Damage Control II', 'active'),
    ],
    rigs: [
      M('Capital Ancillary Current Router I', 'online'), M('Capital Ancillary Current Router I', 'online'),
      M('Capital EM Shield Reinforcer II', 'online'),
    ],
  };
  const implants = [
    'Mid-grade Nirvana Alpha', 'Mid-grade Nirvana Beta', 'Mid-grade Nirvana Gamma',
    'Mid-grade Nirvana Delta', 'Mid-grade Nirvana Epsilon', 'Mid-grade Nirvana Omega',
    "Zainou 'Gnome' Shield Management SM-705", "Zainou 'Gnome' Shield Emission Systems SE-805",
    "Zainou 'Gnome' Shield Operation SP-905", 'Shield Command Mindlink',
  ].map((name) => ({ name }));

  const cs = calcFitStats({ typeID: tid('Minokawa'), name: 'Minokawa' }, fit, [], null, { implants });
  check('minokawa', 'total EHP', cs.totalEHP, 3256400);            // pyfa displays 3.26M
  check('minokawa', 'shield HP (Nirvana full set)', cs.shieldHP, 623437);
  check('minokawa', 'cap delta GJ/s', cs.capDelta, -494.0, 0.01);  // pyfa: -494
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. RELOAD BONUSES — ship hull bonuses that reduce weapon reload time.
//    numShots is NOT a stored attribute; it must be derived from charge bay / charge volume.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nRELOAD BONUSES + clip size');
  const turret = (ship, gun, ammo) => {
    const cs = calcFitStats({ typeID: tid(ship), name: ship },
      { ...EMPTY, high: [M(gun, 'active', ammo)] }, [], null, { factorInReload: true });
    return cs.graphWeapons.find((w) => w.kind === 'turret' || w.kind === 'missile');
  };
  check('reload', 'Cynabal (Angel, projectile)', turret('Cynabal', '425mm AutoCannon II', 'Republic Fleet EMP L').reloadS * 1000, 2500, 0.001);
  check('reload', 'Machariel (Angel, projectile)', turret('Machariel', '800mm Repeating Cannon II', 'Republic Fleet EMP L').reloadS * 1000, 2500, 0.001);
  check('reload', 'Rupture (control: no bonus)', turret('Rupture', '425mm AutoCannon II', 'Republic Fleet EMP L').reloadS * 1000, 10000, 0.001);
  check('reload', 'Jackdaw (Caldari tac dest)', turret('Jackdaw', 'Light Missile Launcher II', 'Scourge Light Missile').reloadS * 1000, 2500, 0.001);
  check('reload', 'Laelaps (missile reload)', turret('Laelaps', 'Heavy Missile Launcher II', 'Scourge Heavy Missile').reloadS * 1000, 5000, 0.001);
  // Clip size drives BOTH the "factor in reload" DPS penalty and the damage-over-time graph.
  const blaster = turret('Astarte', 'Heavy Neutron Blaster II', 'Void M');
  check('reload', 'blaster clip (capacity/vol)', blaster.numShots, 80, 0);

  // The "factor in reload" toggle must actually change DPS.
  const gunFit = { ...EMPTY, high: [M('Heavy Neutron Blaster II', 'active', 'Void M')] };
  const off = calcFitStats({ typeID: tid('Astarte') }, gunFit, [], null, { factorInReload: false });
  const on = calcFitStats({ typeID: tid('Astarte') }, gunFit, [], null, { factorInReload: true });
  check('reload', 'reload toggle lowers DPS', on.weaponDps.total < off.weaponDps.total ? 1 : 0, 1, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. DATA BUNDLE INTEGRITY — CCP data that ships trimmed/empty and that we restored by hand.
//    If someone regenerates the bundles without re-applying these, fits silently go wrong.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nDATA BUNDLE INTEGRITY (restored CCP gaps)');
  // NOTE: initEngine() rewrites TYPES[].a from attribute IDs to attribute NAMES in place, so read
  // these by name. The effects bundle is read straight off disk — this is a file integrity check.
  const { TYPES } = await import('./dogma-engine-init.js');
  const { readFileSync } = await import('fs');
  const { fileURLToPath } = await import('url');
  const { join, dirname } = await import('path');
  const here = dirname(fileURLToPath(import.meta.url));
  const effects = JSON.parse(readFileSync(join(here, 'data', 'dogma-effects.json'), 'utf8'));
  const attrs   = JSON.parse(readFileSync(join(here, 'data', 'dogma-attrs.json'),   'utf8'));

  check('data', 'Angel reload attr on Cynabal', TYPES[17720]?.a?.angelCartelProjectileReloadingSpeed, -75, 0);
  check('data', 'effect 12887 modifier restored', (effects['12887']?.m ?? []).length, 1, 0);
  check('data', 'lance doomsdayDamageDuration', TYPES[77399]?.a?.doomsdayDamageDuration, 15000, 0);
  check('data', 'lance doomsdayDamageCycleTime', TYPES[77399]?.a?.doomsdayDamageCycleTime, 1000, 0);
  check('data', 'attr meta 2264 registered', attrs['2264'] ? 1 : 0, 1, 0);
  check('data', 'metaGroupID present (Faction)', TYPES[tid('True Sansha Medium Armor Repairer')]?.mg, 4, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. SALVATION — command carrier burst bonuses.
//    CCP ships FIVE effects empty here: the "Command Carriers" skill multiplier (12879) that scales
//    the hull bonus attrs by level, and the four per-discipline burst bonuses (12875-12878). Without
//    them the +5%/level to Armor/Information Command Burst strength applied at 1x instead of 5x —
//    7.70M EHP instead of pyfa's 8.06M. All five live in scripts/data-patches.json.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nSALVATION (command carrier — burst strength bonuses)');
  const fit = {
    high: [
      M('Fighter Support Unit I', 'online'), M('Fighter Support Unit I', 'online'),
      M('Integrated Sensor Array', 'online'),
      M('Armor Command Burst II', 'active', 'Armor Energizing Charge'),
      M('Armor Command Burst II', 'active', 'Armor Reinforcement Charge'),
      M('Information Command Burst II', 'active', 'Sensor Optimization Charge'),
    ],
    mid: [
      M('Capital Shield Extender II', 'online'), M('Capital Shield Extender II', 'online'),
      M('Pithum C-Type Multispectrum Shield Hardener', 'active'),
      M('Pithum C-Type Multispectrum Shield Hardener', 'active'),
    ],
    low: [
      M('25000mm Steel Plates II', 'online'), M('25000mm Steel Plates II', 'online'),
      M('25000mm Steel Plates II', 'online'), M('25000mm Steel Plates II', 'online'),
      M('Centii A-Type Multispectrum Coating', 'online'),
      M('Centii A-Type Multispectrum Coating', 'online'),
      M('Damage Control II', 'active'), M('Reactive Armor Hardener', 'active'),
    ],
    rigs: [M('Capital Trimark Armor Pump II', 'online'), M('Capital Trimark Armor Pump II', 'online')],
  };
  const cs = calcFitStats({ typeID: tid('Salvation'), name: 'Salvation' }, fit, [], null, {});
  check('salvation', 'total EHP', cs.totalEHP, 8057016, 0.001);
  check('salvation', 'armor resists (RAH)', resistStr(cs.resists.armor), '87.0/86.8/87.4/90.9');

  // Lock range is capped by the ship's maximumRangeCap attribute (750 km by default), NOT by a
  // hardcoded 300 km. An Integrated Sensor Array raises that cap to 1e9 — which is how a capital
  // locks past the normal limit. The magic number used to clamp this fit to 300 km.
  const withISA = { ...fit, high: [...fit.high, M('Integrated Sensor Array', 'online')] };
  const isa = calcFitStats({ typeID: tid('Salvation'), name: 'Salvation' }, withISA, [], null, {});
  check('salvation', 'lock range, ISA online', isa.targetRange, 560, 0.005);

  // With the ISA ACTIVE its ×12 multiplier (op4) and the Information Command Burst (op6) land in the
  // SAME stacking group: the multiplier takes slot 1, the burst slot 2 (×0.8691). Penalising each
  // operation in its own pool gave the burst full strength and produced 6718 km.
  const isaOn = { ...fit, high: [...fit.high, M('Integrated Sensor Array', 'active')] };
  const act = calcFitStats({ typeID: tid('Salvation'), name: 'Salvation' }, isaOn, [], null, {});
  check('salvation', 'lock range, ISA active', act.targetRange, 6457, 0.005);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. PRAXIS — deliberately awkward stress fit: mutated web, ancillary armor repairer on paste,
//    mixed projectile turrets + HAMs + smartbomb, 10 implants, 8 boosters.
//    It caught four real bugs: phantom shadow types, booster bonuses double-applying, an AAR that
//    REPLACED the other repairers instead of adding to them, and a missing hardpoint-booster missile
//    damage bonus (effect 12849 ships empty).
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nPRAXIS (stress fit: mutated web, AAR+paste, mixed weapons, 10 implants, 8 boosters)');
  const W = (n, s, a, mut) => ({ typeID: tid(n), state: s, ammo: a, ...(mut ? { mutations: mut } : {}) });
  const fit = {
    high: [W('650mm Artillery Cannon I','active','Depleted Uranium M'),
           W('650mm Medium Carbine Howitzer I','active','Carbonized Lead M'),
           W('650mm Medium Gallium Cannon','active','Republic Fleet Nuclear M'),
           W('650mm Medium Prototype Siege Cannon','active','Arch Angel Fusion M'),
           W("Hanaruwa's Modified Heavy Assault Missile Launcher",'active','Scourge Heavy Assault Missile'),
           W('Khanid Navy Heavy Assault Missile Launcher','active','Inferno Javelin Heavy Assault Missile'),
           W("'Concussion' Compact Large Graviton Smartbomb",'active')],
    mid: [W('500MN Quad LiF Restrained Microwarpdrive','active'),
          W('100MN Monopropellant Enduring Afterburner','online'),
          W('Tracking Disruptor II','active','Tracking Speed Disruption Script'),
          W("'Inception' Target Painter",'active'),
          W('True Sansha Stasis Webifier','active',null,
            { capacitorNeed:5.0, cpu:25.0, maxRange:18000.0, speedFactor:-55.0 }),
          W('Dark Blood Heavy Capacitor Booster','active','Navy Cap Booster 3200'),
          W('Xarasier X-Large Ancillary Shield Booster','active','Navy Cap Booster 400')],
    low: [W('Damage Control II','online'), W('Xarasier Reactive Armor Hardener','active'),
          W('Xarasier Large Ancillary Armor Repairer','active','Nanite Repair Paste'),
          W("Estamel's Modified Co-Processor",'online'),
          W("C3-X 'Hivaa Saitsuo' Ballistic Control System",'online'),
          W("C3-A 'Hivaa Saitsuo' Ballistic Control System",'online'),
          W('Imperial Navy Large Armor Repairer','active')],
    rigs: [W('Large Auxiliary Nano Pump II','online'), W('Large Auxiliary Thrusters II','online'),
           W('Large Polycarbon Engine Housing I','online')],
  };
  const drones = [{ name:'Acolyte II', typeID: tid('Acolyte II'), qty:5, active:false },
                  { name:'Federation Navy Hobgoblin', typeID: tid('Federation Navy Hobgoblin'), qty:5, active:true }];
  const implants = ['Mid-grade Wedge Alpha','Low-grade Virtue Beta','Low-grade Talon Gamma',
    'Low-grade Hydra Delta','Mid-grade Mimesis Epsilon',
    "Inherent Implants 'Squire' Capacitor Systems Operation EO-604",
    "Overmind 'Goliath' Drone Tuner T25-10S", "Inherent Implants 'Noble' Mechanic MC-806",
    "Zainou 'Gypsy' Electronic Warfare EW-905", "Zainou 'Gnome' Weapon Upgrades WU-1006"].map(name=>({name}));
  const boosters = ['Nugoehuvi Synth Blue Pill Booster','Strong Drop Booster','Standard Crash Booster',
    "Agency 'Hardshell' TB9 Dose IV",'Imperial Electronics Booster III','Imperial Defense Booster II',
    'Imperial Mobility Booster III','State Hardpoint Booster III'].map(name=>({name,active:true}));

  const cs = calcFitStats({ typeID: tid('Praxis'), name: 'Praxis' }, fit, drones, null, { implants, boosters });
  check('praxis', 'weapon DPS', cs.weaponDps.total, 185, 0.01);
  check('praxis', 'total DPS', cs.totalDps.total, 354, 0.01);
  check('praxis', 'volley', cs.totalVolley.total, 1735, 0.01);
  check('praxis', 'shield resists', resistStr(cs.resists.shield), '36.6/36.6/37.8/39.1');
  check('praxis', 'armor resists', resistStr(cs.resists.armor), '52.5/52.5/50.1/51.1');
  check('praxis', 'hull resists', resistStr(cs.resists.hull), '59.8/59.8/60.6/61.4');
  check('praxis', 'armor rep EHP/s (AAR+repper)', cs.armorRepEhpS, 695.3, 0.005);
  check('praxis', 'shield rep EHP/s', cs.shieldRepEhpS, 430.8, 0.005);
  check('praxis', 'cap delta', cs.capDelta, 47.5, 0.02);
  check('praxis', 'speed (MWD)', cs.maxVelocityAB ?? cs.maxVelocity, 896, 0.005);
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. REVELATION NAVY ISSUE — caught three bugs: the Amulet implant set was missing entirely,
//    crystal capNeedBonus (charge -> module, domain "otherID") was never applied, and the
//    LocationRequiredSkillModifier branch ignored the stacking exemptions (so the Siege Module's
//    damage bonus penalised the Heat Sink).
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nREVELATION NAVY ISSUE (Amulet set, Conflagration crystals, siege)');
  const fit = {
    high: [M('Dual Giga Pulse Laser II','active','Conflagration XL'),
           M('Capital Gremlin Compact Energy Neutralizer','active'),
           M('Dual Giga Pulse Laser II','active','Conflagration XL'),
           M('Siege Module II','active'),
           M('Capital Gremlin Compact Energy Neutralizer','active'),
           M('Dual Giga Pulse Laser II','active','Conflagration XL')],
    mid: [M('Capital F-RX Compact Capacitor Booster','active','Navy Cap Booster 3200'),
          M('Heavy Capacitor Booster II','active','Navy Cap Booster 3200'),
          M('Tracking Computer II','active','Optimal Range Script'),
          M('Tracking Computer II','active','Optimal Range Script')],
    low: [M('25000mm Steel Plates II','online'), M('25000mm Steel Plates II','online'),
          M('25000mm Rolled Tungsten Compact Plates','online'), M('Dark Blood Heat Sink','online'),
          M('Corpum B-Type Multispectrum Energized Membrane','online'),
          M('Corpus X-Type Thermal Armor Hardener','active'),
          M('Corpus X-Type EM Armor Hardener','active'), M('Damage Control II','active')],
    rigs: [M('Capital Trimark Armor Pump I','online'), M('Capital Trimark Armor Pump I','online'),
           M('Capital Trimark Armor Pump I','online')],
  };
  const implants = ['Mid-grade Amulet Alpha','Mid-grade Amulet Beta','Mid-grade Amulet Gamma',
    'Mid-grade Amulet Delta','Mid-grade Amulet Epsilon','Mid-grade Amulet Omega',
    "Eifyr and Co. 'Gunslinger' Motion Prediction MR-703",
    "Inherent Implants 'Squire' Capacitor Management EM-803",
    "Eifyr and Co. 'Gunslinger' Surgical Strike SS-903"].map(name=>({name}));
  const cs = calcFitStats({ typeID: tid('Revelation Navy Issue'), name: 'Revelation Navy Issue' },
                          fit, [], null, { implants });
  check('revnavy', 'total EHP (Amulet set)', cs.totalEHP, 5066076, 0.001);
  check('revnavy', 'weapon DPS', cs.weaponDps.total, 10960, 0.002);
  check('revnavy', 'volley', cs.weaponVolley.total, 84280, 0.002);
  check('revnavy', 'cap drain (crystal capNeed)', cs.capDrainPS, 178, 0.01);
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. BACKUP / RESTORE — this code decides what happens to a user's saved fits, and fits exist
//    ONLY in localStorage. A merge bug silently eats someone's work, so it is guarded here.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nBACKUP / RESTORE (merge must never lose a fit)');
  const { mergeFitsDB } = await import('./lib/backup-io.js');

  const mine = JSON.stringify({
    Astarte: [{ id: 1, name: 'Brawler' }, { id: 2, name: 'Kite' }],
    Rifter:  [{ id: 1, name: 'Solo' }],
  });
  const incoming = JSON.stringify({
    Astarte: [{ id: 1, name: 'Brawler' }, { id: 5, name: 'Blaster Boat' }],  // id AND name collide
    Bane:    [{ id: 1, name: 'Lance' }],
  });
  const m = JSON.parse(mergeFitsDB(mine, incoming));

  check('backup', 'no fit lost on merge', m.Astarte.length + m.Rifter.length + m.Bane.length, 6, 0);
  check('backup', 'colliding ids reassigned', new Set(m.Astarte.map((f) => f.id)).size, m.Astarte.length, 0);
  check('backup', 'duplicate name renamed', m.Astarte.filter((f) => f.name.startsWith('Brawler')).length, 2, 0);
  check('backup', 'existing fit untouched', m.Astarte.find((f) => f.id === 1)?.name === 'Brawler' ? 1 : 0, 1, 0);
  check('backup', 'new ship added', m.Bane?.[0]?.name === 'Lance' ? 1 : 0, 1, 0);
  // A corrupt or empty file must never wipe what's already there.
  check('backup', 'corrupt import keeps fits', JSON.parse(mergeFitsDB(mine, '{{garbage')).Astarte.length, 2, 0);
  check('backup', 'empty import keeps fits', JSON.parse(mergeFitsDB(mine, '{}')).Rifter.length, 1, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 9b. STORAGE MIGRATION — the boot-time schema upgrade must be idempotent, must reach the current
//     version, and (critically) must never throw on bad data. A throw here is the blank-page crash
//     the whole mechanism exists to prevent.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nSTORAGE MIGRATION (schema upgrade must be safe + idempotent)');
  const { runMigrations, SCHEMA_VERSION, SCHEMA_KEY, MIGRATIONS } = await import('./lib/storage-migrate.js');

  const s1 = runMigrations({ 'pyfa-fitsdb': '{"Astarte":[]}' }, { from: 0 });
  check('migrate', 'stamps current version', Number(s1[SCHEMA_KEY]), SCHEMA_VERSION, 0);
  check('migrate', 'preserves existing data', s1['pyfa-fitsdb'], '{"Astarte":[]}', 0);

  // Idempotent: running again from the stamped version changes nothing.
  const s2 = runMigrations({ ...s1 }, { from: SCHEMA_VERSION });
  check('migrate', 'idempotent re-run', JSON.stringify(s2), JSON.stringify(s1), 0);

  // Must not throw on garbage values, even mid-chain.
  let threw = 0;
  try { runMigrations({ 'pyfa-fitsdb': '{{corrupt', 'pyfa-skills': 'null' }, { from: 0 }); }
  catch { threw = 1; }
  check('migrate', 'never throws on corrupt data', threw, 0, 0);

  // Every migration slot up to current must be a function (an undefined hole would silently skip).
  const holes = Array.from({ length: SCHEMA_VERSION }, (_, i) => i)
    .filter((i) => typeof MIGRATIONS[i] !== 'function').length;
  check('migrate', 'no missing migration in chain', holes, 0, 0);

  // v1 -> v2: the Visviva -> Axis rename. A user updating from any earlier version must keep their
  // preferences and ESI tokens; losing them reads as "the update wiped my settings".
  const s3 = runMigrations({
    'pyfa-fitsdb': '{"Astarte":[]}',
    'visviva_pricehub': 'Amarr',
    'visviva_esi_chars': '[{"name":"Pilot"}]',
    'visviva-esi-active': '12345',
  }, { from: 1 });
  check('migrate', 'axis rename: pref carried over', s3['axis_pricehub'], 'Amarr', 0);
  check('migrate', 'axis rename: ESI tokens carried over', s3['axis_esi_chars'], '[{"name":"Pilot"}]', 0);
  check('migrate', 'axis rename: hyphen keys too', s3['axis-esi-active'], '12345', 0);
  check('migrate', 'axis rename: old key removed', 'visviva_pricehub' in s3 ? 1 : 0, 0, 0);
  check('migrate', 'axis rename: saved fits untouched', s3['pyfa-fitsdb'], '{"Astarte":[]}', 0);

  // A value already written under the new name is newer and must not be clobbered by the old one.
  const s4 = runMigrations({ 'visviva_pricehub': 'Amarr', 'axis_pricehub': 'Dodixie' }, { from: 1 });
  check('migrate', 'axis rename: new key wins', s4['axis_pricehub'], 'Dodixie', 0);

  // The rename must survive the whole chain from an unversioned install, not just from v1.
  const s5 = runMigrations({ 'visviva_pricehub': 'Hek' }, { from: 0 });
  check('migrate', 'axis rename: runs from v0 too', s5['axis_pricehub'], 'Hek', 0);

  // v2 -> v3: fit tags. Every saved fit gains a `tags` array, and a malformed one is normalized
  // rather than left for the UI to trip over.
  const s6 = runMigrations({ 'pyfa-fitsdb': '{"Rifter":[{"id":1,"name":"Solo"}]}' }, { from: 2 });
  check('migrate', 'v3: fit gains a tags array', Array.isArray(JSON.parse(s6['pyfa-fitsdb']).Rifter[0].tags) ? 1 : 0, 1, 0);
  const s7 = runMigrations({ 'pyfa-fitsdb': '{"Rifter":[{"id":1,"tags":["Doctrine"]}]}' }, { from: 2 });
  check('migrate', 'v3: existing tags survive', JSON.parse(s7['pyfa-fitsdb']).Rifter[0].tags.join(), 'Doctrine', 0);
  // A null fit in the array and a `tags` that isn't an array must both be survivable.
  const s8 = runMigrations({ 'pyfa-fitsdb': '{"Rifter":[{"id":1,"tags":"nope"},null]}' }, { from: 2 });
  check('migrate', 'v3: non-array tags normalized', Array.isArray(JSON.parse(s8['pyfa-fitsdb']).Rifter[0].tags) ? 1 : 0, 1, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 9c. FIT TAGS — the fit browser's cross-hull axis. A fit stores tag NAMES and colours live in a
//     separate registry, so the two can disagree; every function here has to survive that, plus a
//     fit that predates tags entirely. See src/lib/fit-tags.js.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nFIT TAGS (cross-hull grouping, name-keyed and self-healing)');
  const T = await import('./lib/fit-tags.js');
  const { normalizeTag, tagKey, tagsOf, hasTag, withTag, withoutTag, toggleTag,
          allTags, fitsWithTag, colorForTag, setTagColor, renameTag, removeTagEverywhere,
          mergeTagColors, TAG_PALETTE, MAX_TAG_LEN } = T;

  check('tags', 'normalize trims and collapses', normalizeTag('  TQ   Flykiller '), 'TQ Flykiller', 0);
  check('tags', 'normalize caps length', normalizeTag('x'.repeat(80)).length, MAX_TAG_LEN, 0);
  check('tags', 'tags match case-insensitively', tagKey('FlyKiller') === tagKey('flykiller') ? 1 : 0, 1, 0);

  // A fit saved before tags existed, and one whose tags were mangled, must both read as untagged
  // rather than throwing on render — that is the blank page the storage migration exists to prevent.
  check('tags', 'pre-tags fit reads untagged', tagsOf({ name: 'Old' }).length, 0, 0);
  check('tags', 'garbage tags read untagged', tagsOf({ tags: 'nope' }).length, 0, 0);
  check('tags', 'duplicates collapse case-insensitively', tagsOf({ tags: ['Flykiller', 'flykiller'] }).length, 1, 0);
  check('tags', 'first spelling is the one kept', tagsOf({ tags: ['Flykiller', 'FLYKILLER'] })[0], 'Flykiller', 0);

  const base = { id: 1, name: 'Jackdaw', modified: 'Aug 1, 2026' };
  const tagged = withTag(base, 'TQ Flykiller');
  check('tags', 'withTag adds', hasTag(tagged, 'TQ Flykiller') ? 1 : 0, 1, 0);
  check('tags', 'hasTag ignores case', hasTag(tagged, 'tq flykiller') ? 1 : 0, 1, 0);
  check('tags', 'adding twice is a no-op', tagsOf(withTag(tagged, 'TQ FLYKILLER')).length, 1, 0);
  // Filing a fit under a doctrine is not editing the fit, so the modified date must not move.
  check('tags', 'tagging leaves modified alone', tagged.modified, 'Aug 1, 2026', 0);
  check('tags', 'withoutTag removes', tagsOf(withoutTag(tagged, 'tq flykiller')).length, 0, 0);
  check('tags', 'toggle round-trips', tagsOf(toggleTag(toggleTag(base, 'A'), 'a')).length, 0, 0);
  check('tags', 'empty tag is refused', tagsOf(withTag(base, '   ')).length, 0, 0);

  const DB = {
    Jackdaw: [{ id: 1, name: 'Flykiller Jackdaw', tags: ['TQ Flykiller', 'WIP'] }],
    Bifrost: [{ id: 2, name: 'Skirm', tags: ['tq flykiller'] }],
    Rifter:  [{ id: 3, name: 'Solo' }],
  };
  const list = allTags(DB);
  check('tags', 'two distinct tags across the DB', list.length, 2, 0);
  check('tags', 'count merges spellings', list.find(t => t.key === 'tq flykiller')?.count, 2, 0);
  check('tags', 'tag list is alphabetical', list[0].name, 'TQ Flykiller', 0);

  // The whole point of the feature: one tag, fits from more than one hull.
  const cross = fitsWithTag(DB, 'TQ FLYKILLER');
  check('tags', 'tag spans hulls', cross.length, 2, 0);
  check('tags', 'cross-hull list is ship-sorted', cross[0]?.ship ?? 'none', 'Bifrost', 0);
  check('tags', 'untagged fits stay out', fitsWithTag(DB, 'WIP').length, 1, 0);

  // Colour is derived when the registry has nothing, so a lost or partial registry degrades to a
  // stable palette colour instead of a ghost reference.
  const auto = colorForTag('TQ Flykiller', {});
  check('tags', 'unregistered tag still gets a colour', TAG_PALETTE.includes(auto) ? 1 : 0, 1, 0);
  check('tags', 'derived colour is stable', colorForTag('tq flykiller', {}), auto, 0);
  const withColor = setTagColor({}, 'TQ Flykiller', '#123456');
  check('tags', 'registry overrides the palette', colorForTag('TQ FLYKILLER', withColor), '#123456', 0);
  check('tags', 'corrupt colour falls back', TAG_PALETTE.includes(colorForTag('X', { x: 'javascript:alert(1)' })) ? 1 : 0, 1, 0);

  // Renaming onto an EXISTING tag merges rather than leaving a fit carrying both.
  const merged = renameTag(DB, 'WIP', 'TQ Flykiller');
  check('tags', 'rename merges into existing', tagsOf(merged.Jackdaw[0]).length, 1, 0);
  check('tags', 'rename reaches every hull', fitsWithTag(renameTag(DB, 'TQ Flykiller', 'Doctrine'), 'Doctrine').length, 2, 0);
  check('tags', 'rename leaves other tags alone', hasTag(renameTag(DB, 'TQ Flykiller', 'Doctrine').Jackdaw[0], 'WIP') ? 1 : 0, 1, 0);

  const purged = removeTagEverywhere(DB, 'tq flykiller');
  check('tags', 'delete clears every hull', fitsWithTag(purged, 'TQ Flykiller').length, 0, 0);
  check('tags', 'delete keeps the fits', purged.Jackdaw.length, 1, 0);
  check('tags', 'delete spares other tags', hasTag(purged.Jackdaw[0], 'WIP') ? 1 : 0, 1, 0);

  // Restoring a backup by merge must not repaint a tag the user has since recoloured.
  const mc = mergeTagColors({ a: '#111111' }, { a: '#222222', b: '#333333' });
  check('tags', 'merge keeps my colour', mc.a, '#111111', 0);
  check('tags', 'merge adds unknown colour', mc.b, '#333333', 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. ASTRAHUS (structure) — caught two real engine bugs when structure support was added:
//    (a) character skills (Hull Upgrades/Shield Management/Mechanics, always trained to V in our
//        "all-5 reference character") were inflating a structure's shieldCapacity/armorHP/hp by
//        25% each — structures are corp assets, not personally piloted, and no character skill
//        should touch their stats at all. (b) domain='structureID' (the Structure-category
//        equivalent of domain='shipID') was being treated as a "projected onto an external
//        target" domain and silently ignored, which meant the Full/Low Power State HP multiplier
//        (Effect7008/7009 — a service module fitted forces a 4x HP multiplier onto the structure)
//        never applied. Both confirmed against pyfa's eos directly (scripts/oracle/oracle.py
//        astrahus_empty / astrahus_service_only) — this is not hand-derived, it's the same
//        oracle-cross-check method every other baseline here uses.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nASTRAHUS (structure — Full/Low Power State, no skill bonuses apply)');
  const ship = { typeID: tid('Astrahus'), name: 'Astrahus' };
  const csLowPower = calcFitStats(ship, EMPTY, [], null, {});
  check('astrahus', 'low power EHP (no service fitted)', csLowPower.totalEHP, 9000000, 0.001);
  check('astrahus', 'low power shield HP', csLowPower.shieldHP, 3600000, 0.001);
  check('astrahus', 'low power armor HP', csLowPower.armorHP, 1800000, 0.001);
  check('astrahus', 'low power hull HP', csLowPower.hullHP, 1800000, 0.001);

  // Standup Cloning Center I, not Market Hub: a Market Hub's canFitShipType list omits Astrahus
  // (a market genuinely requires a medium-or-larger structure), so that pairing was an illegal
  // fit even though it computed the right number. Every service module carries the same
  // serviceModuleFullPowerStateHitpointMultiplier of 4, so the baseline is unchanged.
  const fitFullPower = { high: [], mid: [], low: [], rigs: [], services: [M('Standup Cloning Center I', 'online')] };
  const csFullPower = calcFitStats(ship, fitFullPower, [], null, {});
  check('astrahus', 'full power EHP (service fitted)', csFullPower.totalEHP, 29250000, 0.001);
  check('astrahus', 'full power shield HP (x4)', csFullPower.shieldHP, 14400000, 0.001);
  check('astrahus', 'full power armor HP (x4)', csFullPower.armorHP, 7200000, 0.001);
  check('astrahus', 'hull HP unaffected by power state', csFullPower.hullHP, 1800000, 0.001);
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. AZBEL (structure — real user fit) — caught a third structure bug: structure-only "operation"
//    skills (Structure Missile/Electronic/Engineering Systems, the structure equivalent of Warhead
//    Upgrades / cap-cost-reduction skills) were never in our "all-5 reference character", so their
//    LocationGroupModifier bonuses to fitted missile launchers never applied (weaponDps came out
//    133.33 instead of pyfa's 146.7 — see CLAUDE.md gotcha #10 for the full writeup, including why
//    the earlier "skip ALL skill effects for structures" fix had to be narrowed).
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nAZBEL (structure — Structure Missile Systems skill must boost fitted launchers)');
  const ship = { typeID: tid('Azbel'), name: 'Azbel' };
  const fit = { high: [M('Standup Multirole Missile Launcher I', 'active', 'Standup Light Missile')], mid: [], low: [], rigs: [] };
  const cs = calcFitStats(ship, fit, [], null, {});
  check('azbel', 'weapon DPS (Structure Missile Systems applied)', cs.weaponDps.total, 146.7, 0.002);
  check('azbel', 'volley', cs.weaponVolley.total, 440.0, 0.001);

  // Missile RANGE is the mirror image of the DPS bug above: the personal missile skills must NOT
  // apply here. Missile Projection / Missile Bombardment (and MGCs, missile rigs, Zainou implants,
  // the Hydra set) are all gated in eos on the CHARGE requiring "Missile Launcher Operation";
  // Standup missiles require no skills at all, so the charge flies its base 95 s at its base
  // 15 km/s. Applying both skills anyway multiplied velocity AND flight time by 1.5 and gave
  // 3195 km. eos: missileMaxRangeData -> maxRange 1417.5005 km.
  const missile = [...cs.slotEngineStats.values()].find(s => s.isMissile);
  check('azbel', 'missile range km (no personal missile skills)', missile?.optimal, 1417.5, 0.001);
  check('azbel', 'charge velocity unmodified', missile?.velocity, 15000, 0.001);
  check('azbel', 'charge flight time unmodified (ms)', missile?.flightTime, 95000, 0.001);
}

// ─────────────────────────────────────────────────────────────────────────────
// 11b. STRUCTURE ORACLE SWEEP FINDINGS — four bugs the generated structure sweep caught
//      (scripts/oracle/gen_structure_fits.mjs -> oracle_batch.py -> oracle_compare.mjs). Every
//      expected value here is eos's, read straight off the sweep output.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nSTRUCTURE SWEEP (oracle-found)');

  // (1) Duplicate modifier entries. Effect 7098 (all 104 Outpost Conversion Rigs) carries three
  //     modifiers TWICE in CCP's data; the second landed in the same stacking pool at the penalised
  //     rank. initEngine now drops byte-identical duplicates. eos: scanResolution 130.
  //     (Fortizar base 40 x 3.25, where 3.25 = rig's 180% x the hull's 25% combat-rig role bonus.)
  {
    const ship = { typeID: tid('Fortizar'), name: 'Fortizar' };
    const fit = { high: [], mid: [], low: [], rigs: [M('Upwell A1F Outpost Rig', 'online')], services: [] };
    const cs = calcFitStats(ship, fit, [], null, {});
    check('struct', 'outpost rig scanRes (no double-apply)', cs.scanRes, 130, 0.001);
  }

  // (2) System security. Structure rig bonuses scale by hiSec/lowSec/nullSecModifier, which CCP
  //     models via `securityModifier`; our bundle froze it at the hisec value of 1. eos defaults to
  //     NULLSEC (x1.2), so Fit.systemSecurity does too.
  {
    const ship = { typeID: tid('Astrahus'), name: 'Astrahus' };
    const fit = { high: [], mid: [], low: [], rigs: [M('Standup M-Set Enhanced Targeting System II', 'online')], services: [] };
    const nul = calcFitStats(ship, fit, [], null, {});
    check('struct', 'sensor rig scanRes (nullsec)', nul.scanRes, 130, 0.001);
    check('struct', 'sensor rig lock range (nullsec)', nul.targetRange, 413, 0.001);
    // Hisec is the x1.0 case: the same rig is 20% weaker.
    const hi = calcFitStats(ship, fit, [], null, { systemSecurity: 'hisec' });
    check('struct', 'sensor rig scanRes (hisec, no x1.2)', hi.scanRes, 115, 0.001);
  }

  // (3) Structure weapon groups. 'Structure Doomsday Weapon' and 'Structure Area Denial Module' are
  //     the structure names for the intrinsic-damage branch that only knew 'Smart Bomb'/'Super
  //     Weapon', so both read 0 DPS. The PDB also carries no damage of its own — it comes from the
  //     charge, scaled by damageMultiplier.
  {
    const kee = { typeID: tid('Keepstar'), name: 'Keepstar' };
    const v = calcFitStats(kee, { high: [M('Standup Arcing Vorton Projector I', 'active')], mid: [], low: [], rigs: [], services: [] }, [], null, {});
    check('struct', 'Vorton Projector DPS', v.weaponDps.total, 7407.41, 0.001);
    check('struct', 'Vorton Projector volley (1 hit)', v.weaponVolley.total, 4000000, 0.001);

    const fort = { typeID: tid('Fortizar'), name: 'Fortizar' };
    const p = calcFitStats(fort, { high: [M('Standup Point Defense Battery I', 'active', 'Standup Flak Round I')], mid: [], low: [], rigs: [], services: [] }, [], null, {});
    check('struct', 'Point Defense Battery DPS (charge damage)', p.weaponDps.total, 83.33, 0.002);
    check('struct', 'Point Defense Battery volley', p.weaponVolley.total, 1000, 0.001);
  }

  // (4) Standup BCS double-count. The structure BCS's bonus is applied by the ENGINE (effect 6449 is
  //     real dogma), unlike the ship BCS which calc.js applies analytically — so counting it both
  //     ways squared it. Two BCS: 1.1956, not 1.1956². Only a MULTI-module fit shows this, which is
  //     why the one-module-per-fit sweep missed it and a real saved fit caught it.
  {
    const ship = { typeID: tid('Fortizar'), name: 'Fortizar' };
    const L = () => M('Standup Multirole Missile Launcher II', 'active', 'Standup Heavy Missile');
    const B = () => M('Standup Ballistic Control System II', 'online');
    const cs = calcFitStats(ship, { high: [L(), L()], mid: [], low: [B(), B()], rigs: [], services: [] }, [], null, {});
    check('struct', '2 launchers + 2 Standup BCS DPS', cs.weaponDps.total, 1617.02, 0.001);
    check('struct', '2 launchers + 2 Standup BCS volley', cs.weaponVolley.total, 3156.36, 0.001);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 11c. EWAR RESISTANCE — the multiplier a projection's TARGET applies to incoming ewar. eos reads it
//      in ModifiedAttributeDict.getResistance(); we had no concept of it, so projected dampeners
//      landed at full strength. Found by diffing two real saved fits whose lock range was ~4x low.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nEWAR RESISTANCE (projection targets)');
  // A Siege Module carries sensorDampenerResistanceBonus -70, so a sieged dread takes 30% of a
  // dampener's nominal strength. Verified against eos on saved fit #1179 (Phoenix Navy Issue).
  const dread = { typeID: tid('Phoenix Navy Issue'), name: 'Phoenix Navy Issue' };
  const sieged = projectionResistances(dread, { high: [M('Siege Module II', 'active')], mid: [], low: [], rigs: [] }, null);
  check('ewarres', 'sieged dread damp resistance', sieged.damp, 0.30, 0.001);
  check('ewarres', 'sieged dread weapon-disruption resistance', sieged.disrupt, 0.30, 0.001);
  const unsieged = projectionResistances(dread, { high: [], mid: [], low: [], rigs: [] }, null);
  check('ewarres', 'no siege -> no resistance', unsieged.damp, 1, 0.001);

  // A T3 destroyer's Sharpshooter mode divides ewar resistance by modeEwarResistancePostDiv (3).
  // Verified against eos on saved fit #28 (Jackdaw). Defense mode does NOT grant it.
  const jack = { typeID: tid('Jackdaw'), name: 'Jackdaw' };
  const sharp = projectionResistances(jack, { high: [], mid: [], low: [], rigs: [], tactical: 'Sharpshooter' }, null);
  check('ewarres', 'Jackdaw Sharpshooter damp resistance', sharp.damp, 1 / 3, 0.001);
  const defense = projectionResistances(jack, { high: [], mid: [], low: [], rigs: [], tactical: 'Defense' }, null);
  check('ewarres', 'Jackdaw Defense mode: no damp resistance', defense.damp, 1, 0.001);
}

// ─────────────────────────────────────────────────────────────────────────────
// 11d. COMMAND BURSTS ON A PROJECTION SOURCE — a boosted logi reps harder, and the buff lands on
//      CYCLE TIME, not amount: a Large Remote Shield Booster II keeps its 680 HP while its duration
//      drops 8000 ms -> 6680 ms under an Active Shielding burst. computeProjectedReps took no
//      externalBursts, so every boosted logi was understated by exactly that ratio.
//      Verified against eos on saved fit #1288 (a Basilisk self-projected with amount=2), whose
//      per-module rep rate is 101.80 HP/s boosted and 85.00 unboosted.
// -----------------------------------------------------------------------------
{
  console.log('\nCOMMAND BURSTS ON PROJECTION SOURCE');
  const basi = { typeID: tid('Basilisk'), name: 'Basilisk' };
  const slots = { high: [M('Large Remote Shield Booster II', 'active')], mid: [], low: [], rigs: [] };
  const plain = computeProjectedReps(basi, slots, null, {});
  check('projburst', 'unboosted remote shield rep HP/s', plain.reps[0]?.rawPS, 85.0, 0.002);
  // buff 11 = Active Shielding Charge; -16.5% duration is a Command Burst II at all-V.
  const boosted = computeProjectedReps(basi, slots, null,
    { externalBursts: [{ buffID: 11, value: -16.5 }] });
  check('projburst', 'boosted remote shield rep HP/s', boosted.reps[0]?.rawPS, 101.80, 0.002);
  check('projburst', 'ratio is the cycle-time ratio 8000/6680',
        boosted.reps[0].rawPS / plain.reps[0].rawPS, 8000 / 6680, 0.002);
}

// -----------------------------------------------------------------------------
// 11f. PROJECTED REMOTE CAPACITOR TRANSMITTERS — computeProjectedReps had no branch for the group
//      at all, so a projected Guardian/Basilisk showed no transmitters in the Projected tab and the
//      target received none of the capacitor they exist to deliver. Verified against eos: a Guardian
//      with two Large Remote Capacitor Transmitter II at all-V gives 351 GJ per 5000 ms cycle each,
//      i.e. 70.2 GJ/s per module and 140.4 GJ/s total, optimal 82,875 m with no falloff.
// -----------------------------------------------------------------------------
{
  console.log('\nPROJECTED REMOTE CAPACITOR TRANSMITTERS');
  const guardian = { typeID: tid('Guardian'), name: 'Guardian' };
  const slots = { high: [M('Large Remote Capacitor Transmitter II', 'active'),
                         M('Large Remote Capacitor Transmitter II', 'active')], mid: [], low: [], rigs: [] };
  const eff = computeProjectedReps(guardian, slots, null, {});
  check('projcap', 'two transmitters are collected', eff.caps?.length, 2, 0);
  check('projcap', 'GJ delivered per cycle', eff.caps?.[0]?.amount, 351, 0.002);
  check('projcap', 'cycle time (s)', eff.caps?.[0]?.cycleS, 5, 0.002);
  check('projcap', 'GJ/s per transmitter', eff.caps?.[0]?.gjPerSec, 70.2, 0.002);
  check('projcap', 'optimal range (m)', eff.caps?.[0]?.optimal, 82875, 0.002);
  check('projcap', 'total GJ/s from both',
        (eff.caps ?? []).reduce((a, c) => a + c.gjPerSec, 0), 140.4, 0.002);
  // Incoming transfer has to reach the capacitor sim, not just the list: it is the mirror of a
  // projected neut, so it lifts cap delta by exactly the GJ/s delivered.
  const base = calcFitStats(guardian, slots, [], null, {});
  const fed  = calcFitStats(guardian, slots, [], null, { projectedCapGJs: 140.4 });
  check('projcap', 'incoming cap raises cap delta by the transfer rate',
        fed.capDelta - base.capDelta, 140.4, 0.01);
}

// -----------------------------------------------------------------------------
// 11g. MICRO JUMP DRIVE SIGNATURE BLOOM — effect 4921 (microJumpDrive) ships EMPTY from CCP, so an
//      active MJD did nothing at all to the ship's signature and the sig bloom while it spools was
//      missing from every readout. pyfa hand-implements it (Effect4921: boostItemAttr
//      'signatureRadius' by 'signatureRadiusBonusPercent', which is 150 on every MJD). Patched via
//      scripts/data-patches.json. Verified against eos on a Megathron with a Large Micro Jump Drive:
//      380 m online, 950 m active.
// -----------------------------------------------------------------------------
{
  console.log('\nMICRO JUMP DRIVE SIG BLOOM');
  const mega = { typeID: tid('Megathron'), name: 'Megathron' };
  const mk = (state) => ({ high: [], mid: [M('Large Micro Jump Drive', state)], low: [], rigs: [] });
  const off = calcFitStats(mega, mk('online'), [], null, {});
  const on  = calcFitStats(mega, mk('active'), [], null, {});
  check('mjdsig', 'sig radius with MJD online', off.sigRadius, 380, 0.001);
  check('mjdsig', 'sig radius with MJD ACTIVE', on.sigRadius, 950, 0.001);
  check('mjdsig', 'bloom is +150%', on.sigRadius / off.sigRadius, 2.5, 0.001);
}

// -----------------------------------------------------------------------------
// 11e. ANCILLARY REMOTE REPS — these sit in their OWN dogma groups ('Ancillary Remote Shield
//      Booster' / 'Ancillary Remote Armor Repairer'), not the plain ones, so matching only the plain
//      group name dropped them from projections entirely. Verified against eos on saved fit #769: a
//      projected Osprey's four boosters are 78.86 / 89.38 / 124.86 / 39.43 HP/s and the ancillary
//      (the 124.86) was contributing zero, leaving the whole logi a third light.
// -----------------------------------------------------------------------------
{
  console.log('ANCILLARY REMOTE REPS');
  const osp = { typeID: tid('Osprey'), name: 'Osprey' };
  const shieldFit = { high: [M('Medium Ancillary Remote Shield Booster', 'active', 'Navy Cap Booster 50')],
                      mid: [], low: [], rigs: [] };
  const sh = computeProjectedReps(osp, shieldFit, null, {});
  check('ancrep', 'ancillary remote SHIELD booster is counted', sh.reps.length, 1, 0);
  check('ancrep', 'ancillary remote shield HP/s', sh.reps[0]?.rawPS, 96.484, 0.002);

  const gua = { typeID: tid('Guardian'), name: 'Guardian' };
  const armorFit = { high: [M('Small Ancillary Remote Armor Repairer', 'active', 'Nanite Repair Paste')],
                     mid: [], low: [], rigs: [] };
  const ar = computeProjectedReps(gua, armorFit, null, {});
  check('ancrep', 'ancillary remote ARMOR repairer is counted', ar.reps.length, 1, 0);
  // BASELINE CORRECTED 2026-08-02, and it was wrong the interesting way: this fixture loads Nanite
  // Repair Paste, and an Ancillary Remote Armor Repairer with a charge reps x3
  // (chargedArmorDamageMultiplier — eos saveddata/module.py). The projected path never applied it,
  // so the old 12.333 was simply what we happened to compute, recorded against a fixture whose
  // charge it ignored. eos for this exact fixture: amount 37.0, mult 3.0, duration 3000 -> 37.0 HP/s
  // with paste, 12.3333 without. Both branches are pinned now so the multiplier cannot go missing
  // again and cannot start applying to an unloaded module.
  check('ancrep', 'ancillary remote armor HP/s (paste x3)', ar.reps[0]?.rawPS, 37.0, 0.002);
  const arDry = computeProjectedReps(gua,
    { high: [M('Small Ancillary Remote Armor Repairer', 'active')], mid: [], low: [], rigs: [] }, null, {});
  check('ancrep', 'ancillary remote armor HP/s (no paste)', arDry.reps[0]?.rawPS, 12.3333, 0.002);

  // The projection SOURCE's tactical mode changes what it projects. calcFitStats and
  // projectionResistances applied it; computeProjectedReps did not, so a T3D projecting remote reps
  // repped as if it had no mode. eos: a Confessor's Defense Mode multiplies armorDamageAmount by
  // 4/3, so a Small Remote Armor Repairer II reads 85.3333 rather than its base 64 (over a 3000 ms
  // cycle -> 28.4444 HP/s vs 21.3333). eos defaults a modeless T3D to its first mode, as we do.
  const conf = { typeID: tid('Confessor'), name: 'Confessor' };
  const rrFit = (tactical) => ({ high: [M('Small Remote Armor Repairer II', 'active')],
                                 mid: [], low: [], rigs: [], tactical });
  check('ancrep', 'T3D source mode boosts projected reps',
        computeProjectedReps(conf, rrFit('Defense'), null, {}).reps[0]?.rawPS, 28.4444, 0.002);
  // A hull with no tactical mode is unaffected — guards against applying a mode to everything.
  check('ancrep', 'non-T3D source unchanged',
        computeProjectedReps(gua, { high: [M('Small Remote Armor Repairer II', 'active')],
                                    mid: [], low: [], rigs: [] }, null, {}).reps[0]?.rawPS, 21.3333, 0.002);
}

// -----------------------------------------------------------------------------
// 11h. LOCAL ANCILLARY ARMOR REPAIRER — the paste multiplier on the RAW HP/s.
//      The engine never folds chargedArmorDamageMultiplier into armorDamageAmount (it lives on the
//      charge), so the tank block has to multiply it in the way pyfa does. It did not, and the
//      Resistances tab's "Rep: n HP/s" therefore read the same loaded as empty — a third of what
//      the module reps. The EHP/s path was always right, because it recomputes the AAR from its own
//      block, which is exactly why this went unnoticed: the two numbers disagreed by 3x on the same
//      screen. Every figure below is eos's (scripts/oracle, fit.tank / fit.effectiveTank).
// -----------------------------------------------------------------------------
{
  console.log('\nLOCAL ANCILLARY ARMOR REPAIRER');
  const myrm = { typeID: tid('Myrmidon'), name: 'Myrmidon' };
  const repFit = (low) => ({ high: [], mid: [], low, rigs: [] });
  const aarPaste = calcFitStats(myrm, repFit([M('Medium Ancillary Armor Repairer', 'active', 'Nanite Repair Paste')]), [], null, {});
  const aarBare  = calcFitStats(myrm, repFit([M('Medium Ancillary Armor Repairer', 'active')]), [], null, {});
  const plain    = calcFitStats(myrm, repFit([M('Medium Armor Repairer II', 'active')]), [], null, {});
  check('aar', 'AAR on paste, raw HP/s', aarPaste.armorRepPS, 94.88, 1e-3);
  check('aar', 'AAR empty, raw HP/s', aarBare.armorRepPS, 31.62, 1e-3);
  // The ratio IS the multiplier — a check that survives any future rebalance of the base rep.
  check('aar', 'paste is worth exactly 3x', aarPaste.armorRepPS / aarBare.armorRepPS, 3, 1e-9);
  // A plain repper has no charge and must not pick up a multiplier from anywhere.
  check('aar', 'plain repairer unaffected, raw HP/s', plain.armorRepPS, 56.22, 1e-3);
  // EHP/s comes from a SEPARATE code path that subtracts the raw AAR contribution and re-adds its
  // own. Both sides now carry the multiplier, so they must still cancel exactly.
  // The AAR block rounds its EHP/s to 0.1 before returning it, so the expected values are eos's
  // exact ones and the tolerance is whatever that quantisation costs at this magnitude — NOT slack
  // for a real divergence. The plain repairer goes through an unrounded path and holds at 1e-3.
  check('aar', 'AAR on paste, EHP/s', aarPaste.armorRepEhpS, 140.56, 2e-3);
  check('aar', 'AAR empty, EHP/s', aarBare.armorRepEhpS, 46.85, 2e-3);
  check('aar', 'plain repairer, EHP/s', plain.armorRepEhpS, 83.29, 1e-3);
}

// -----------------------------------------------------------------------------
// 11h-2. ANCILLARY CLIP EHP — the one-shot pool a LOADED ancillary adds on top of the fit's EHP,
//        summed fit-wide so the Stats tab can offer "EHP + clip" without swiping to the fitting tab.
//        Every number here is the same paste/charge phase the module row already showed, so it is
//        anchored to 11h's eos-validated rep figures rather than being a new baseline of its own.
//        The gate is what needs guarding: this is a POOL, and only a loaded module has one.
// -----------------------------------------------------------------------------
{
  console.log('\nANCILLARY CLIP EHP');
  const myrm = { typeID: tid('Myrmidon'), name: 'Myrmidon' };
  const lows = (low) => ({ high: [], mid: [], low, rigs: [] });
  const AAR  = (state, ammo) => M('Medium Ancillary Armor Repairer', state, ammo);
  const clipOf = (ship, slots, opts) => calcFitStats(ship, slots, [], null, opts ?? {}).ancilClipEHP;

  // 8 paste cycles x 853.875 HP = 6831 raw, x 1/0.675 (uniform profile over the Myrmidon's armor
  // resonances 0.5/0.65/0.65/0.9) = 10120 EHP.
  const paste = calcFitStats(myrm, lows([AAR('active', 'Nanite Repair Paste')]), [], null, {});
  check('clip', 'AAR on paste, clip EHP', paste.ancilClipEHP, 10120, 1e-5);
  // Tied to 11h's eos-validated raw HP/s rather than standing alone: the pool IS the paste phase
  // (9 s x 8 cycles) of that rep, resist-weighted. Breaks if either the phase or the weighting moves.
  check('clip', 'clip is the paste phase of the validated rep',
        paste.ancilClipEHP / (paste.armorRepPS * 72), 1 / 0.675, 1e-4);
  // A pool exists only if the clip does. An AAR with no paste still reps — one cycle, off the ship's
  // own cap — so it has a RATE and no pool; counting it would inflate the headline on a fit that
  // cannot actually spend it.
  check('clip', 'unloaded AAR contributes no clip', clipOf(myrm, lows([AAR('active')])), 0, 0);
  // Nor does a module that is fitted and online but not cycling, matching every other output figure.
  check('clip', 'inactive AAR contributes no clip', clipOf(myrm, lows([AAR('online', 'Nanite Repair Paste')])), 0, 0);
  check('clip', 'plain repairer contributes no clip',
        clipOf(myrm, lows([M('Medium Armor Repairer II', 'active')])), 0, 0);
  check('clip', 'no ancillary, no clip', clipOf(myrm, lows([])), 0, 0);
  // Fit-wide sum, not the largest — same trap the AAR EHP/s path fell into once (see 11h).
  check('clip', 'two AARs sum',
        clipOf(myrm, lows([AAR('active', 'Nanite Repair Paste'), AAR('active', 'Nanite Repair Paste')])), 20240, 1e-5);

  // Shield side: a Caracal's ASB runs a clip of cap boosters, 9 x 146 HP = 1314 raw.
  const car  = { typeID: tid('Caracal'), name: 'Caracal' };
  const mids = (mid) => ({ high: [], mid, low: [], rigs: [] });
  const ASB  = (ammo) => M('Medium Ancillary Shield Booster', 'active', ammo);
  // Shield resonances 1/0.8/0.6/0.5 -> 0.725 under a uniform profile -> 1314 x 1.37931 = 1812.
  check('clip', 'ASB on cap boosters, clip EHP', clipOf(car, mids([ASB('Navy Cap Booster 50')])), 1812, 1e-5);
  check('clip', 'ASB running on capacitor contributes no clip', clipOf(car, mids([ASB(null)])), 0, 0);
  // The pool is weighted by the SELECTED incoming profile, which is the whole reason it may be added
  // to the Stats tab's own profile-weighted EHP. Under pure EM a Caracal's shield has 0% resist, so
  // the clip must fall back to its raw 1314 HP — if this reads 1812 the weighting was ignored and
  // the combined figure would be adding two differently-weighted numbers.
  check('clip', 'clip follows the incoming damage profile',
        clipOf(car, mids([ASB('Navy Cap Booster 50')]), { damageProfile: [1, 0, 0, 0] }), 1314, 1e-5);
}

// -----------------------------------------------------------------------------
// 12. SKILL REQUIREMENTS — the fit's green/red skill book. The catalog must cover every skill any
//     fittable item names as a requirement, or the check silently passes fits you cannot fly: the
//     engine's own SKILL_DEFAULTS knows nothing about Jury Rigging (on 279 rigs) or the racial
//     hull skills, because no dogma effect reads them.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nSKILL REQUIREMENTS');
  // Every requiredSkillN reference on a fittable type must resolve to a catalog entry.
  let refs = 0, unresolved = 0;
  for (const t of Object.values(TYPES)) {
    if (![6, 7, 8, 18, 32, 65, 66, 87].includes(t.c ?? t.category)) continue;
    const a = t.a ?? t.attrs ?? {};
    for (let i = 1; i <= 6; i++) {
      const s = a['requiredSkill' + i];
      if (!s) continue;
      refs++;
      if (!SKILL_BY_TYPEID.has(Number(s))) unresolved++;
    }
  }
  check('skills', 'catalog covers every requirement ref', unresolved, 0, 0);
  check('skills', 'catalog is non-trivial', SKILL_CATALOG.length > 300 ? 1 : 0, 1, 0);
  // Unique keys — a collision would make two skills share one level.
  check('skills', 'catalog keys unique', new Set(SKILL_CATALOG.map(e => e.key)).size, SKILL_CATALOG.length, 0);

  const caracal = { typeID: tid('Caracal'), name: 'Caracal' };
  const fit = { high: [M('Heavy Missile Launcher II', 'active', 'Scourge Fury Heavy Missile')], mid: [], low: [], rigs: [] };
  // Unset skills count as V, matching calcFitStats — a fresh install must not flag every fit.
  check('skills', 'all-V character can fly the fit', checkFitSkills(caracal, fit, [], [], {}).ok ? 1 : 0, 1, 0);

  // Heavy Missile Launcher II needs Missile Launcher Operation IV, but the loaded Scourge Fury
  // Heavy Missile needs it at V — so the requirement for the fit is V. The CHARGE's requirements
  // count too, and the strictest wins; checking the module alone would understate this by a level.
  const low = checkFitSkills(caracal, fit, [], [], { missileLaunchers: 3 });
  const mlo = low.missing.find(m => m.name === 'Missile Launcher Operation');
  check('skills', 'under-trained skill is reported', low.ok ? 1 : 0, 0, 0);
  check('skills', 'charge requirement wins (ammo needs V)', mlo?.required, 5, 0);
  check('skills', 'reports the level held', mlo?.have, 3, 0);
  // The ship itself contributes requirements too (Caldari Cruiser I for a Caracal).
  const noHull = checkFitSkills(caracal, { high: [], mid: [], low: [], rigs: [] }, [], [], { caldariCruiser: 0 });
  check('skills', 'hull requirement counted', noHull.missing.some(m => m.name === 'Caldari Cruiser') ? 1 : 0, 1, 0);

  // ── per-item gap, for the red book on a browser row ───────────────────────
  // The browsers mark ONE item at a time, so this is deliberately not the fit-level check: it must
  // not inherit a requirement from a charge the row knows nothing about. A Heavy Missile Launcher II
  // needs Missile Launcher Operation IV; the Scourge Fury ammo that pushes the FIT to V is a
  // separate row with its own mark.
  const hmlTid = tid('Heavy Missile Launcher II');
  const furyTid = tid('Scourge Fury Heavy Missile');
  check('skills', 'item gap: none at all V', itemSkillGap(hmlTid, {}).length, 0, 0);
  check('skills', 'item gap: launcher needs IV, not the ammo V',
        itemSkillGap(hmlTid, { missileLaunchers: 3 }).find(g => g.name === 'Missile Launcher Operation')?.required, 4, 0);
  check('skills', 'item gap: ammo asks V on its own row',
        itemSkillGap(furyTid, { missileLaunchers: 4 }).find(g => g.name === 'Missile Launcher Operation')?.required, 5, 0);
  check('skills', 'item gap: launcher clear at IV', itemSkillGap(hmlTid, { missileLaunchers: 4 }).length, 0, 0);
  check('skills', 'item gap: reports the level held',
        itemSkillGap(hmlTid, { missileLaunchers: 1 })[0]?.have, 1, 0);
  // An unset skill counts as V here too, so a fresh install shows no red books anywhere.
  check('skills', 'item gap: unset counts as V', itemSkillGap(furyTid, null).length, 0, 0);
  // Marking is driven by typeID, and every browser passes one straight from its row data. A row
  // with no typeID (an abyssal paste, a name-only implant) must render nothing rather than throw.
  check('skills', 'item gap: unknown type is silent', itemSkillGap(0, { missileLaunchers: 0 }).length, 0, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 12a. UNTRAINED SKILLS — everything below V. Two independent faults, both invisible at all skills
//      V, which is why the other 557 checks never saw them.
//
//   (a) The catalog only held skills that SKILL_DEFAULTS listed or that something names as a
//       requirement. ~30 more modify a fit without either — Thermodynamics, Fuel Conservation,
//       Guided Missile Precision, Advanced Armor Layering, the EWAR strength skills. calcFitStats
//       trains every skill it is not handed at V, so a skill outside the catalog could not be
//       lowered by any means: no preset, no ESI sync, no Settings row. It was pinned at V.
//   (b) `_applyEffect` substituted an attribute's DEFAULT whenever the source attribute read 0,
//       because the presence test used the numeric ID against a name-keyed table and so never
//       matched. An untrained Caldari Cruiser zeroes the Caracal's shipBonusCC — whose default is
//       +5 — so the launcher picked up a 5% rate-of-fire PENALTY out of nowhere.
//
// Every number here is eos's, via `scripts/oracle/oracle_untrained.py`. Before (b) was fixed the
// Caracal read 17.63 weapon DPS against eos's 16.75 with volley matching exactly — the classic
// "the divisor is wrong" signature.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nUNTRAINED SKILLS');
  const caracal = { typeID: tid('Caracal'), name: 'Caracal' };
  const abFit    = { high: [], mid: [M('10MN Afterburner II', 'active')], low: [], rigs: [] };
  const plateFit = { high: [], mid: [], low: [M('1600mm Steel Plates II', 'online')], rigs: [] };
  const hmlFit   = { high: [M('Heavy Missile Launcher II', 'active', 'Scourge Fury Heavy Missile')],
                     mid: [], low: [], rigs: [] };

  // Skills that reach the engine but that nothing requires. Naming them explicitly is what stops
  // someone "simplifying" the derivation back to SKILL_DEFAULTS ∪ requirements.
  for (const n of ['Thermodynamics', 'Fuel Conservation', 'Guided Missile Precision',
                   'Advanced Armor Layering', 'Cybernetics', 'Biology'])
    check('untrained', `${n} is settable`, SKILL_CATALOG.some(e => e.name === n) ? 1 : 0, 1, 0);
  // ...and the other half of the rule: a skill that touches no fit attribute stays OUT. Admitting
  // every category-16 type would pass the checks above while burying the panel in trade skills.
  for (const n of ['Trade', 'Reprocessing', 'Accounting'])
    check('untrained', `${n} stays out of the catalog`, SKILL_CATALOG.some(e => e.name === n) ? 1 : 0, 0, 0);

  // Teeth for (a): both of these read the all-V number until the skill becomes settable.
  check('untrained', 'Fuel Conservation V: AB cap drain',
        calcFitStats(caracal, abFit, [], {}, {}).capDrainPS, 3, 1e-5);
  check('untrained', 'Fuel Conservation 0 doubles it',
        calcFitStats(caracal, abFit, [], { fuelConservation: 0 }, {}).capDrainPS, 6, 1e-5);
  check('untrained', 'Armor Layering V: plated mass',
        calcFitStats(caracal, plateFit, [], {}, {}).mass, 14441250, 1e-5);
  check('untrained', 'Advanced Armor Layering 0 adds the rest',
        calcFitStats(caracal, plateFit, [], { armorLayering: 0, advancedArmorLayering: 0 }, {}).mass,
        15660000, 1e-5);

  // Teeth for (b), and for the two together: a wholly untrained character must match eos exactly.
  const ZERO = Object.fromEntries(SKILL_CATALOG.map(e => [e.key, 0]));
  const hz = calcFitStats(caracal, hmlFit, [], ZERO, {});
  check('untrained', 'zero-skill weapon DPS (eos)', hz.weaponDps?.total, 16.75, 1e-5);
  check('untrained', 'zero-skill mass (eos)', hz.mass, 11910000, 1e-5);
  check('untrained', 'zero-skill shield HP (eos)', hz.shieldHP, 1700, 1e-5);
  check('untrained', 'zero-skill EHP (eos)', hz.totalEHP, 6212.157602790644, 1e-5);
  const pz = calcFitStats(caracal, plateFit, [], ZERO, {});
  check('untrained', 'zero-skill plated mass (eos)', pz.mass, 15660000, 1e-5);
  check('untrained', 'zero-skill plated armor HP (eos)', pz.armorHP, 6000, 1e-5);
  check('untrained', 'zero-skill plated EHP (eos)', pz.totalEHP, 13323.268713901754, 1e-5);

  // ── the alpha clone preset ────────────────────────────────────────────────
  // ALPHA_SKILLS comes from eve.db's own alphaCloneSkills table (build-bundle.py -> alpha-clone.json),
  // and eos applies that same table itself (Skill.level mins against character.alphaClone), so this
  // is a like-for-like comparison of CCP's ceiling rather than of a transcription.
  const lv = Object.values(ALPHA_SKILLS);
  check('alpha', 'ceiling covers the whole catalog', lv.length, SKILL_CATALOG.length, 0);
  check('alpha', 'no level out of range', lv.filter(v => !Number.isInteger(v) || v < 0 || v > 5).length, 0, 0);
  check('alpha', 'ceiling is non-trivial', lv.filter(v => v > 0).length > 100 ? 1 : 0, 1, 0);
  // Alpha clones were race-locked when they launched in 2016 and have not been since December 2017.
  // eve.db carries ONE clone, so the four racial lines must read identically; if CCP ever re-splits
  // them, a single ceiling stops being a truthful preset and this is what says so.
  const racialCruisers = ['amarrCruiser', 'caldariCruiser', 'gallenteCruiser', 'minmatarCruiser'];
  check('alpha', 'racial cruisers all at IV',
        new Set(racialCruisers.map(k => ALPHA_SKILLS[k])).size === 1 ? ALPHA_SKILLS.caldariCruiser : -1, 4, 0);

  const ah = calcFitStats(caracal, hmlFit, [], ALPHA_SKILLS, {});
  check('alpha', 'alpha weapon DPS (eos)', ah.weaponDps?.total, 37.263845234257474, 1e-5);
  check('alpha', 'alpha shield HP (eos)', ah.shieldHP, 2040, 1e-5);
  check('alpha', 'alpha EHP (eos)', ah.totalEHP, 7647.955624177961, 1e-5);
  const ap = calcFitStats(caracal, plateFit, [], ALPHA_SKILLS, {});
  check('alpha', 'alpha plated mass (eos)', ap.mass, 15472500, 1e-5);
  check('alpha', 'alpha plated armor HP (eos)', ap.armorHP, 7500, 1e-5);
  check('alpha', 'alpha plated EHP (eos)', ap.totalEHP, 16536.844513066848, 1e-5);
}

// ─────────────────────────────────────────────────────────────────────────────
// 12b. T3 DESTROYER TACTICAL MODES — Skua and Anhinga.
//
// All 18 tactical modes are published=0, and build-bundle.py filtered fit_types on published, so
// the only modes in the bundle were 12 legacy ones that predated the generator. The Skua's and the
// Anhinga's could never arrive. Two separate bugs hid behind that:
//   - calc.js proxied the Skua to the JACKDAW's modes, on the belief it shipped none. It ships its
//     own (90060/90062/90064), so a Propulsion Skua read maxSpeed 2303 against eos's 2729.
//   - the Anhinga's mode bonuses were hand-transcribed into an ANHINGA_MODES table, every value of
//     which was exactly 1/<the mode's own PostDiv attribute>.
// Fixed by admitting group 1306 by ID (MODE_GROUP) and patching the 7 effects CCP ships empty
// (5560/12767/12794/12795/12796/12798/12799) into scripts/data-patches.json.
//
// Every number below is eos's, via `oracle.py skua_sharpshooter | skua_lml_propulsion |
// anhinga_primary` (specs live in that file, so they can be re-measured).
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nT3D TACTICAL MODES');
  // Expected missile range. Our model is a two-point distribution over flight-time quantization
  // (a missile flies a whole number of ticks); its MEAN is what eos's vel x flight represents.
  const missileRange = (cs) => {
    const g = (cs.graphWeapons ?? [])[0];
    return g ? g.lowerRange * (1 - g.higherChance) + g.higherRange * g.higherChance : 0;
  };
  const modeFit = (ship, tactical, mod, ammo, n = 1) => calcFitStats(
    { typeID: tid(ship), name: ship },
    { high: Array.from({ length: n }, () => M(mod, 'active', ammo)),
      mid: [], low: [], rigs: [], tactical },
    [], null, {});

  // Sharpshooter Skua: rocket charge velocity x3.5 (effect 12794). The mode ALSO carries a
  // vestigial modeMaxRangePostDiv=0.6 but NOT effect 6076 — reading the attribute without checking
  // the effect applied a phantom second bonus and gave 47 km.
  const skuaSS = modeFit('Skua', 'Sharpshooter', 'Rocket Launcher II', 'Scourge Rocket', 2);
  check('t3dmode', 'Skua sharpshooter rocket range (m)', missileRange(skuaSS), 35439, 0.005);
  check('t3dmode', 'Skua sharpshooter weapon DPS', skuaSS.weaponDps.total, 83.5, 0.01);

  // Propulsion Skua: its OWN mode, not the Jackdaw's. modeVelocityPostDiv 0.6 -> x1.667.
  const skuaProp = modeFit('Skua', 'Propulsion', 'Light Missile Launcher II', 'Scourge Light Missile');
  check('t3dmode', 'Skua propulsion light-missile range (m)', missileRange(skuaProp), 42188, 0.005);
  check('t3dmode', 'Skua propulsion lock range (km)', skuaProp.targetRange, 68.75, 0.005);

  // Primary Anhinga: flight time x11 (12796), launcher RoF x0.75 (12799), lock range x5 (6010).
  const anh = modeFit('Anhinga', 'Primary', 'Rapid Heavy Missile Launcher II', 'Scourge Heavy Missile');
  check('t3dmode', 'Anhinga primary missile range (m)', missileRange(anh), 461221, 0.005);
  check('t3dmode', 'Anhinga primary lock range (km)', anh.targetRange, 300, 0.005);
  check('t3dmode', 'Anhinga primary weapon DPS', anh.weaponDps.total, 76.5, 0.01);
  check('t3dmode', 'Anhinga primary volley', anh.weaponVolley.total, 204.9, 0.01);

  // The modes must be present at all — this is the data gap that started it.
  const modeTids = ['Skua Defense Mode', 'Skua Propulsion Mode', 'Skua Sharpshooter Mode',
                    'Anhinga Primary Mode', 'Anhinga Secondary Mode', 'Anhinga Tertiary Mode']
    .filter((n) => tid(n)).length;
  check('t3dmode', 'Skua/Anhinga mode items in bundle', modeTids, 6, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 12c. PROJECTED SENSOR MODULES — EWAR resistance from bursts, and boost stacking.
//
// Two bugs behind the same symptom (lock range far off eos on fits under command links):
//
//   - EWAR resistance is overwhelmingly a COMMAND BURST effect (buff 19, Electronic Hardening),
//     not a hull attribute. projectionResistances() built its own Fit and never applied bursts, so
//     it reported a flat 1.0 for every boosted fit and projected damps landed at full strength.
//   - Projected Remote Sensor Boosters were not modelled at all; and once added, they cannot be
//     multiplied onto the finished number, because a BONUS competes for stacking slots with the
//     target's own signal amps. eos puts them in one 'default' penalized group.
//
// eos-sourced numbers: `Module.getModifiedItemAttr('warfareBuff2Value')` on a Stork with an
// Information Command Burst II + Electronic Hardening Charge is -18.5625; and driving eos's own
// ModifiedAttributeDict (what Effect6427 does) —
//   Celestis + Signal Amplifier II            -> maxTargetRange 121875.0
//   ...then boostItemAttr('maxTargetRange', 36, stackingPenalties=True) -> 160743.8393
//   ...and  boostItemAttr('scanResolution', 30, stackingPenalties=True) ->    532.6859
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nPROJECTED SENSOR MODULES');
  const celestis = { typeID: tid('Celestis'), name: 'Celestis' };
  const celSlots = { high: [], mid: [], low: [M('Signal Amplifier II', 'online')], rigs: [] };

  const base = calcFitStats(celestis, celSlots, [], null, {});
  check('projsensor', 'Celestis + Signal Amp II lock (km)', base.targetRange, 121.875, 0.005);

  // A projected +36% must NOT be a flat x1.36 — the Signal Amplifier is already holding the first
  // stacking slot, so the booster takes it and pushes the amp to second. Flat multiplication gives
  // 165.75 km; eos gives 160.74.
  const boosted = calcFitStats(celestis, celSlots, [], null,
    { projectedBoosts: { lock: [36], scan: [30] } });
  check('projsensor', 'projected RSB lock, stacked (km)', boosted.targetRange, 160.7438, 0.005);
  check('projsensor', 'projected RSB scan resolution', boosted.scanRes, 532.6859, 0.005);
  check('projsensor', 'flat multiply would be wrong', boosted.targetRange < 165 ? 1 : 0, 1, 0);

  // Buff 19 has to reach projectionResistances, or every boosted fit reads as unresisted.
  const burstFit = { high: [M('Information Command Burst II', 'active', 'Electronic Hardening Charge')],
                     mid: [], low: [], rigs: [] };
  const bursts = computeCommandBursts({ typeID: tid('Stork'), name: 'Stork' }, burstFit, null, {});
  const noBurst = projectionResistances(celestis, celSlots, null, {});
  const withBurst = projectionResistances(celestis, celSlots, null, { externalBursts: bursts });
  check('projsensor', 'no burst -> no EWAR resistance', noBurst.damp, 1, 0);
  check('projsensor', 'Electronic Hardening damp resist', withBurst.damp, 0.814375, 0.0005);
  check('projsensor', 'Electronic Hardening disrupt resist', withBurst.disrupt, 0.814375, 0.0005);

  // disallowAssistance: the ship refuses ALL incoming remote ASSISTANCE (reps, remote sensor
  // boosters) while still taking EWAR normally. eos gates each assistance effect on this attribute.
  // Effect 3380 (Warp Disrupt Field Generator) ships EMPTY, so nothing set it and a bubbling HIC
  // happily accepted remote reps. Confirmed against eos: an ACTIVE Warp Disruption Field Generator
  // II on a Devoter gives ship.disallowAssistance = 1; merely ONLINE gives 0.
  //
  // Siege/Bastion/Triage all carry disallowAssistance = 0 in the current game and do NOT block
  // assistance — checked in eos directly. Do not add them.
  const devoter = { typeID: tid('Devoter'), name: 'Devoter' };
  const bubbled = (state) => ({ high: [M('Warp Disruption Field Generator II', state)], mid: [], low: [], rigs: [] });
  check('projsensor', 'active HIC bubble sets disallowAssistance',
        projectionResistances(devoter, bubbled('active'), null, {}).disallowAssistance ? 1 : 0, 1, 0);
  check('projsensor', 'online HIC bubble does not',
        projectionResistances(devoter, bubbled('online'), null, {}).disallowAssistance ? 1 : 0, 0, 0);
  check('projsensor', 'sieged dread still takes assistance',
        projectionResistances({ typeID: tid('Phoenix Navy Issue'), name: 'Phoenix Navy Issue' },
          { high: [M('Siege Module II', 'active')], mid: [], low: [], rigs: [] }, null, {}).disallowAssistance ? 1 : 0, 0, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 12d. FITTED-BUT-INERT: offline modules and switched-off implants.
//
// Two independent "it's there but it isn't on" bugs, both found in the saved-fit corpus.
//
//   - eos classifies a few effects as type='offline': they apply while the module is merely
//     FITTED, at any state. There is no data flag for this (eve.db's dgmeffects has no isOffline
//     column, and effectCategory for 854 is 0/passive), so OFFLINE_STATE_EFFECTS in
//     dogma-engine.js is transcribed from eos. A Stork with an OFFLINE Prototype Cloaking Device
//     read 594 scan resolution against eos's 296.875 — exactly 2x, the cloak's x0.5.
//   - An implant can sit in a fit but be switched OFF. Boosters already honoured `active`;
//     implants did not. A Cerberus whose Zainou 'Deadeye' Rapid Launch RL-1005 was disabled read
//     652.6 weapon DPS against eos's 620.0 — exactly the implant's +5% RoF (1/0.95).
//
// eos-sourced: Stork + offline Prototype Cloaking Device I -> scanResolution 296.875; Cerberus with
// 6x HAM II (Caldari Navy Scourge) + BCS II + 2x Caldari Navy BCS -> 620.0127 weapon DPS, and
// 652.6449 with the implant ACTIVE.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nFITTED-BUT-INERT (offline modules, disabled implants)');
  const stork = { typeID: tid('Stork'), name: 'Stork' };
  const cloaked = (state) => calcFitStats(stork,
    { high: [M('Prototype Cloaking Device I', state)], mid: [], low: [], rigs: [] }, [], null, {}).scanRes;
  check('inert', 'Stork bare scan resolution', calcFitStats(stork, EMPTY, [], null, {}).scanRes, 593.75, 0.005);
  check('inert', 'OFFLINE cloak still halves scan res', cloaked('offline'), 296.875, 0.005);
  check('inert', 'online cloak, same value', cloaked('online'), 296.875, 0.005);

  const cerb = { typeID: tid('Cerberus'), name: 'Cerberus' };
  const cerbSlots = {
    high: Array.from({ length: 6 }, () => M('Heavy Assault Missile Launcher II', 'active',
                                            'Caldari Navy Scourge Heavy Assault Missile')),
    mid: [],
    low: [M('Ballistic Control System II', 'online'),
          M('Caldari Navy Ballistic Control System', 'online'),
          M('Caldari Navy Ballistic Control System', 'online')],
    rigs: [],
  };
  const RL = "Zainou 'Deadeye' Rapid Launch RL-1005";
  const cerbDps = (implants) => calcFitStats(cerb, cerbSlots, [], null, { implants }).weaponDps.total;
  check('inert', 'Cerberus DPS, no implant', cerbDps([]), 620.0127, 0.005);
  check('inert', 'Rapid Launch implant ACTIVE', cerbDps([{ name: RL }]), 652.6449, 0.005);
  check('inert', 'Rapid Launch implant DISABLED', cerbDps([{ name: RL, active: false }]), 620.0127, 0.005);
}

// ─────────────────────────────────────────────────────────────────────────────
// 12e. MIMESIS implant set, and the Sidewinder's pilot-security bonus.
//
// MIMESIS is the FOURTH implant set (after Asklepian, Nirvana, Amulet) and had no handler. Unlike
// the others it boosts a WEAPON attribute: each member carries damageMultiplierBonusMaxModifier and
// damageMultiplierBonusPerCycleModifier, which effects 7232/7233 apply to Precursor Weapons — an
// entropic disintegrator's SPOOL (how far it ramps, how fast). Those two effects DO carry modifiers,
// so the un-amplified bonus was already applying; what was missing is the set multiplier, Effect7234
// (domain=charID), dispatcher-skipped exactly like the other three sets. FULL product including
// Omega: Mid-grade = 1.2^5 x 1.6 = 3.981312.
//
// THE SIDEWINDER's damage bonus scales with the pilot's (negative) security status. Effect 12165 was
// listed in SHIP_MISSILE_DMG *as well as* in the dedicated pilot-sec code, so the RAW attribute
// (-7.5%) was applied on top of the sec-scaled bonus (+75% at -10.0): 1.75 x 0.925 = 1.61875.
//
// All numbers from eos.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nMIMESIS SET + PILOT-SEC DAMAGE');
  const draugur = { typeID: tid('Draugur'), name: 'Draugur' };
  const dSlots = { high: [M('Veles Light Entropic Disintegrator', 'active', 'Meson Exotic Plasma S')],
                   mid: [], low: [], rigs: [] };
  const mimesis = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Omega']
    .map((x) => ({ name: `Mid-grade Mimesis ${x}` }));
  const bare = calcFitStats(draugur, dSlots, [], null, {});
  const withSet = calcFitStats(draugur, dSlots, [], null, { implants: mimesis });
  // Unspooled DPS must NOT move — Mimesis only touches the spool, not base damage.
  check('mimesis', 'unspooled DPS unchanged by set', withSet.weaponDps.total, bare.weaponDps.total, 0.0001);
  check('mimesis', 'unspooled DPS', bare.weaponDps.total, 92.5476, 0.005);
  // spoolFactor is 1 + damageMultiplierBonusMax; eos: 2.125 bare, 3.2578295827 with the set.
  check('mimesis', 'spool factor, no implants', bare.weaponSpoolFactor, 3.125, 0.0005);
  check('mimesis', 'spool factor, full Mid-grade set', withSet.weaponSpoolFactor, 4.2578295827, 0.0005);
  check('mimesis', 'full-spool DPS, no implants', bare.weaponDpsMax, 289.2113, 0.005);
  check('mimesis', 'full-spool DPS, full set', withSet.weaponDpsMax, 394.0520, 0.005);

  const sidewinder = { typeID: tid('Sidewinder'), name: 'Sidewinder' };
  const sSlots = {
    high: Array.from({ length: 4 }, () => M('True Sansha Light Missile Launcher', 'active',
                                            'Dread Guristas Scourge Light Missile')),
    mid: [],
    low: Array.from({ length: 3 }, () => M("Tobias' Modified Ballistic Control System", 'online')),
    rigs: [],
  };
  const swDps = (pilotSec) => calcFitStats(sidewinder, sSlots, [], null, { pilotSec }).weaponDps.total;
  check('pilotsec', 'Sidewinder DPS at 0.0 sec', swDps(0), 117.5967, 0.005);
  check('pilotsec', 'Sidewinder DPS at -5.0 sec', swDps(-5), 161.6954, 0.005);
  check('pilotsec', 'Sidewinder DPS at -10.0 sec', swDps(-10), 205.7942, 0.005);
}

// ─────────────────────────────────────────────────────────────────────────────
// 12f. The last four saved-fit divergences. All numbers from eos.
//
//  (a) SAVIOR is the FIFTH implant set. Like Mimesis it targets MODULES, so effect 8018 (duration +
//      capacitorNeed of anything requiring Remote Armor Repair Systems / Shield Emission Systems)
//      was already applying the raw bonus; only the set multiplier Effect8017 (domain=charID) was
//      dispatcher-skipped. It makes remote reps CYCLE FASTER.
//  (b) REMOTE-REP DIMINISHING RETURNS (eos Fit.__getAppliedRr). Incoming remote reps do not add up
//      linearly. Invisible on one logi; a Leshak under 14 projected Large Remote Armor Repairer IIs
//      gets a 0.951217 multiplier. Note eos truncates the cycle to whole SECONDS inside the curve
//      but uses the exact cycle for the final division — reproducing both is what lands the number.
//  (c) computeProjectedReps ignored the SOURCE's T3 CRUISER SUBSYSTEMS, so a projected Loki lost
//      every subsystem bonus — including its Offensive - Support Processor, which strengthens the
//      Shield Command Burst that shortens its remote shield boosters' cycle.
//  (d) Only BASTION's rate-of-fire bonus belongs to eos's 'postPerc' penalty group; SIEGE's is
//      unpenalised. We put every mode module's RoF there, so siege and overload penalised each
//      other and a sieged + overheated launcher lost 2.2% of its DPS.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nSAVIOR SET / RR CURVE / PROJECTED SUBSYSTEMS / SIEGE+OVERLOAD');

  // (a) eos: Nestor + Large Remote Armor Repairer II = 128.0 HP/s bare, 157.2849 with the set.
  const nestor = { typeID: tid('Nestor'), name: 'Nestor' };
  const rrFit = { high: [M('Large Remote Armor Repairer II', 'active')], mid: [], low: [], rigs: [] };
  const savior = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Omega']
    .map((x) => ({ name: `Mid-grade Savior ${x}` }));
  check('savior', 'remote armor rep, no implants',
        computeProjectedReps(nestor, rrFit, null, {}).reps[0]?.rawPS, 128.0, 0.002);
  check('savior', 'remote armor rep, full Mid-grade Savior',
        computeProjectedReps(nestor, rrFit, null, { implants: savior }).reps[0]?.rawPS, 157.2849, 0.002);

  // (b) eos _getAppliedArmorRr for 14 x (844.8 HP per 3.2554931 s) = 3455.7663, against a naive
  //     3633.0. A single source must come through untouched.
  const many = Array.from({ length: 14 }, () => ({ amount: 844.8, cycleS: 3.2554931 }));
  check('rrcurve', 'diminishing returns, 14 sources', applyRemoteRepDiminishing(many), 3455.7663, 0.0005);
  check('rrcurve', 'single source is unaffected',
        applyRemoteRepDiminishing([{ amount: 768, cycleS: 6 }]), 128.0, 0.0005);
  check('rrcurve', 'no sources', applyRemoteRepDiminishing([]), 0, 0);

  // (c) eos: Loki + Gistum A-Type Medium Remote Shield Booster + Shield Command Burst II (Active
  //     Shielding) = 66.6667 HP/s without subsystems, 67.8643 with them (burst -15% -> -16.5%).
  const loki = { typeID: tid('Loki'), name: 'Loki' };
  const lokiHigh = [M('Gistum A-Type Medium Remote Shield Booster', 'active'),
                    M('Shield Command Burst II', 'active', 'Active Shielding Charge')];
  const lokiSubs = ['Loki Core - Immobility Drivers', 'Loki Defensive - Adaptive Defense Node',
                    'Loki Offensive - Support Processor', 'Loki Propulsion - Wake Limiter']
    .map((n) => ({ name: n, typeID: tid(n) }));
  const lokiReps = (subsystems) => computeProjectedReps(loki,
    { high: lokiHigh, mid: [], low: [], rigs: [], subsystems }, null, {}).reps[0]?.rawPS;
  check('projsubs', 'projected Loki without subsystems', lokiReps([]), 66.6667, 0.002);
  check('projsubs', 'projected Loki WITH subsystems', lokiReps(lokiSubs), 67.8643, 0.002);

  // (d) eos cycle times for a Phoenix Navy Issue + Rapid Torpedo Launcher II. Overheat is -15% in
  //     BOTH columns; the bug made it -13.04% (= -15% x exp(-1/7.1289)) only when sieged.
  const phx = { typeID: tid('Phoenix Navy Issue'), name: 'Phoenix Navy Issue' };
  const phxCycle = (state, siege) => {
    const high = [M('Rapid Torpedo Launcher II', state, 'Caldari Navy Scourge Torpedo')];
    if (siege) high.push(M('Siege Module II', 'active'));
    const cs = calcFitStats(phx, { high, mid: [], low: [], rigs: [] }, [], null, {});
    return (cs.graphWeapons ?? []).find((w) => w.kind === 'missile').cycleS * 1000;
  };
  check('postperc', 'launcher cycle, active',            phxCycle('active', false),     17805.2985, 0.0005);
  check('postperc', 'launcher cycle, active + siege',    phxCycle('active', true),       3561.0597, 0.0005);
  check('postperc', 'launcher cycle, overheated',        phxCycle('overheated', false), 15134.5037, 0.0005);
  check('postperc', 'launcher cycle, overheated + siege', phxCycle('overheated', true),  3026.9007, 0.0005);
  // The overheat bonus must be the SAME -15% whether or not the ship is sieged.
  check('postperc', 'overheat is -15% sieged or not',
        (phxCycle('overheated', true) / phxCycle('active', true))
          / (phxCycle('overheated', false) / phxCycle('active', false)), 1, 0.0005);
}

// ─────────────────────────────────────────────────────────────────────────────
// 12g. TARGET RESIST PROFILES — outgoing damage weighted by what you are shooting.
//
// The counterpart to the incoming damage profile: that one weights EHP, this one weights DPS.
// The raw figures MUST stay unmitigated — the oracle diffs weaponDps against eos, which reports
// unmitigated damage, so folding resists into it would invalidate every comparison in the corpus.
// Resist-weighted values live under cs.effective and are identical to raw when no profile is set.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nTARGET RESIST PROFILES');
  const flat = TARGET_PROFILES.flatMap((g) => g.items);
  check('tgtres', 'profile table is populated', flat.length >= 190 ? 1 : 0, 1, 0);
  check('tgtres', 'every profile has 4 resists in [0,1]',
        flat.filter((p) => !Array.isArray(p.r) || p.r.length !== 4
                        || p.r.some((v) => !(v >= 0 && v <= 1))).length, 0, 0);

  // Pure-kinetic Scourge HAMs, so a target's kinetic resist is the only one that bites.
  const cerb = { typeID: tid('Cerberus'), name: 'Cerberus' };
  const slots = {
    high: Array.from({ length: 6 }, () => M('Heavy Assault Missile Launcher II', 'active',
                                            'Caldari Navy Scourge Heavy Assault Missile')),
    mid: [], low: Array.from({ length: 3 }, () => M('Ballistic Control System II', 'online')), rigs: [],
  };
  const raw = calcFitStats(cerb, slots, [], null, {});
  check('tgtres', 'damage is pure kinetic', raw.weaponDps.kin / raw.weaponDps.total, 1, 0.0001);
  check('tgtres', 'no profile → effective equals raw',
        raw.effective.weaponDps.total, raw.weaponDps.total, 0.0000001);

  // Asteroid Guristas: 30% kinetic resist → exactly 0.70x on a pure-kinetic fit.
  const gur = flat.find((p) => p.n === 'Guristas');
  const vsGur = calcFitStats(cerb, slots, [], null, { targetResists: gur.r });
  check('tgtres', 'Guristas kinetic resist is 30%', gur.r[2], 0.30, 0.0001);
  check('tgtres', 'effective DPS vs Guristas', vsGur.effective.weaponDps.total,
        raw.weaponDps.total * 0.70, 0.0001);
  check('tgtres', 'raw DPS is NOT mitigated', vsGur.weaponDps.total, raw.weaponDps.total, 0.0000001);
  check('tgtres', 'volley weighted the same way', vsGur.effective.weaponVolley.total,
        raw.weaponVolley.total * 0.70, 0.0001);
  // The graph reads volleyEff, so it has to be weighted too or the curve and the readout disagree.
  check('tgtres', 'graph volley is weighted', vsGur.graphWeapons[0].volleyEff.total,
        vsGur.graphWeapons[0].volley.kin * 0.70, 0.0001);

  // A resist on a damage type the fit does not deal must change nothing.
  const vsEm = calcFitStats(cerb, slots, [], null, { targetResists: [0.9, 0, 0, 0] });
  check('tgtres', 'irrelevant resist does nothing', vsEm.effective.weaponDps.total,
        raw.weaponDps.total, 0.0000001);
  // 100% resist across the board zeroes it.
  const vsAll = calcFitStats(cerb, slots, [], null, { targetResists: [1, 1, 1, 1] });
  check('tgtres', 'full resist zeroes effective DPS', vsAll.effective.weaponDps.total, 0, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 12h. ENVIRONMENT EFFECTS — the system a fit is sitting in.
//
// Wormhole class effects and metaliminal storms ("Effect Beacon", group 920). CCP ships no
// modifierInfo for any of them, so they are hand-coded in pyfa and transcribed into
// src/data/system-effects.json by scripts/build-system-effects.py; dogma-engine.js interprets the
// table. This was the last thing the oracle could not model — 13 saved fits used to be skipped.
//
// ORDER MATTERS: pyfa marks these runTime='early', so they run BEFORE module effects. The overload
// effects boost attributes (overloadHardeningBonus and friends) that a module's own overload effect
// then reads; applying the environment afterwards leaves the module reading the un-boosted value.
//
// eos reference, Rifter + 200mm AutoCannon II / Republic Fleet EMP S, all skills V.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nENVIRONMENT EFFECTS');
  const rifter = { typeID: tid('Rifter'), name: 'Rifter' };
  const base = { high: [M('200mm AutoCannon II', 'active', 'Republic Fleet EMP S')], mid: [], low: [], rigs: [] };
  const inSystem = (environment) => calcFitStats(rifter, { ...base, environment }, [], null, {});

  const none = inSystem(null);
  check('env', 'no environment: sig',      none.sigRadius,          35,      0.0005);
  check('env', 'no environment: armor HP', none.armorHP,            562.5,   0.0005);
  check('env', 'no environment: shield HP',none.shieldHP,           562.5,   0.0005);
  check('env', 'no environment: DPS',      none.weaponDps.total,    44.8063, 0.0005);

  // Wolf-Rayet: sig x0.5, armor HP x2, small projectile damage x3, shield resists worsened.
  const wr = inSystem('Class 6 Wolf Rayet Effects');
  check('env', 'Wolf-Rayet: sig halved',    wr.sigRadius,        17.5,     0.0005);
  check('env', 'Wolf-Rayet: armor HP x2',   wr.armorHP,          1125,     0.0005);
  check('env', 'Wolf-Rayet: shield HP same',wr.shieldHP,         562.5,    0.0005);
  check('env', 'Wolf-Rayet: DPS x3',        wr.weaponDps.total,  134.4189, 0.0005);

  // Pulsar: the mirror image — shield HP x2, sig x2, cap recharge faster, armor resists worsened.
  const pulsar = inSystem('Class 6 Pulsar Effects');
  check('env', 'Pulsar: shield HP x2',   pulsar.shieldHP,          1125,    0.0005);
  check('env', 'Pulsar: sig doubled',    pulsar.sigRadius,         70,      0.0005);
  check('env', 'Pulsar: armor HP same',  pulsar.armorHP,           562.5,   0.0005);
  check('env', 'Pulsar: DPS unchanged',  pulsar.weaponDps.total,   44.8063, 0.0005);

  // Metaliminal Plasma Firestorm: +armor HP and +turret damage, no sig change.
  const storm = inSystem('Weak Metaliminal Plasma Firestorm');
  check('env', 'Plasma storm: armor HP', storm.armorHP,          618.75,   0.0005);
  check('env', 'Plasma storm: DPS',      storm.weaponDps.total,  53.76756, 0.0005);
  check('env', 'Plasma storm: sig same', storm.sigRadius,        35,       0.0005);

  // An unknown name must be inert rather than throwing — saved fits outlive bundle regenerations.
  check('env', 'unknown system is inert', inSystem('Not A Real System').weaponDps.total,
        none.weaponDps.total, 0.0000001);

  // The generated table has to actually cover the common systems, or every check above could pass
  // while the table silently emptied.
  const covered = ['Class 6 Wolf Rayet Effects', 'Class 6 Pulsar Effects', 'Class 6 Black Hole Effects',
                   'Class 6 Magnetar Effects', 'Class 6 Red Giant Effects', 'Class 6 Cataclysmic Variable Effects',
                   'Weak Metaliminal Plasma Firestorm', 'Strong Metaliminal Electrical Storm']
    .filter((n) => {
      const t = TYPES[tid(n)];
      return t && (t.e ?? []).some((e) => SYSTEM_EFFECTS[e] || SYSTEM_EFFECTS[String(e)]);
    }).length;
  check('env', 'common systems have handlers', covered, 8, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 12i. GENOLUTION SET ORDERING, on a real abyssal-heavy fit. Numbers read from pyfa by the user.
//      An implant set does NOT hand a bonus to the ship — it multiplies each MEMBER'S OWN bonus
//      attribute, and the member's ordinary effect then carries the amplified value across. Getting
//      that order wrong leaves only one option, applying the difference as a second modifier, and a
//      second op6 COMPOUNDS instead of combining: CA-2's +1.5% CPU at a set product of 3.276 became
//      1.015 x 1.03414 rather than a single 1.04914.
//
//      The error is a fraction of a percent, which is exactly why it needs pinning — it is invisible
//      on every stat except this one, where the whole question is whether the last module fits.
//
//      This is also the suite's first MUTATED-module baseline: eight of these modules are abyssal,
//      so it doubles as proof that the EFT mutation blocks survive the parse into the engine. A
//      dropped mutation moves CPU/PG by tens of units, not hundredths.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nGENOLUTION SET / ABYSSAL FITTING');
  const CURSE = `[Curse, abucurse MOD v2 vs]

Federation Navy 800mm Steel Plates [1]
Corelum C-Type Multispectrum Energized Membrane
Corpum B-Type Multispectrum Energized Membrane
Medium Ancillary Armor Repairer, Nanite Repair Paste [2]

Corelum B-Type 50MN Microwarpdrive [3]
Tracking Disruptor II, Optimal Range Disruption Script
Tracking Disruptor II, Optimal Range Disruption Script
True Sansha Medium Capacitor Booster, Navy Cap Booster 800
Guidance Disruptor II, Missile Range Disruption Script
Guidance Disruptor II, Missile Range Disruption Script

Corpum A-Type Medium Energy Neutralizer [4]
Corpii A-Type Small Energy Neutralizer [5]
Corpum B-Type Medium Energy Neutralizer [6]
Corpii A-Type Small Energy Neutralizer [7]
Corpum C-Type Medium Energy Neutralizer [8]

Medium Egress Port Maximizer II
Medium Ancillary Current Router II


Caldari Navy Vespa x5
Infiltrator II x5
Vespa EC-600 x5


Genolution Core Augmentation CA-1
Genolution Core Augmentation CA-4
Genolution Core Augmentation CA-3
Genolution Core Augmentation CA-2
Low-grade Snake Epsilon
Eifyr and Co. 'Rogue' Navigation NN-605
Eifyr and Co. 'Rogue' Evasive Maneuvering EM-705
Zor's Custom Navigation Hyper-Link
Eifyr and Co. 'Gunslinger' Surgical Strike SS-903
Zainou 'Deadeye' Rapid Launch RL-1003

Antipharmakon Aeolis
Agency 'Overclocker' SB7 Dose III


[1] Federation Navy 800mm Steel Plates
  Gravid Medium Armor Plate Mutaplasmid
  armorHPBonusAdd 2961.0, cpu 22.90375, massAddition 720450.0, power 222.203
[2] Medium Ancillary Armor Repairer
  Unstable Medium Ancillary Armor Repairer Mutaplasmid
  armorDamageAmount 245.1708, capacitorNeed 111.104, cpu 32.4775, duration 11275.2, power 113.976, reloadTime 49992.0
[3] Corelum B-Type 50MN Microwarpdrive
  Unstable 50MN Microwarpdrive Mutaplasmid
  capacitorNeed 204.288, cpu 69.588, power 140.37, signatureRadiusBonus 373.24, speedFactor 525.5976
[4] Corpum A-Type Medium Energy Neutralizer
  Unstable Medium Energy Neutralizer Mutaplasmid
  capacitorNeed 190.8, cpu 18.954, energyNeutralizerAmount 155.376, maxRange 22017.6, power 237.6216
[5] Corpii A-Type Small Energy Neutralizer
  Unstable Small Energy Neutralizer Mutaplasmid
  capacitorNeed 51.012, cpu 9.351, energyNeutralizerAmount 62.986, maxRange 11116.8, power 12.3882
[6] Corpum B-Type Medium Energy Neutralizer
  Unstable Medium Energy Neutralizer Mutaplasmid
  capacitorNeed 172.68, cpu 22.93, energyNeutralizerAmount 187.452, maxRange 18228.0, power 185.787
[7] Corpii A-Type Small Energy Neutralizer
  Unstable Small Energy Neutralizer Mutaplasmid
  capacitorNeed 48.42, cpu 13.334, energyNeutralizerAmount 54.769, maxRange 12182.4, power 11.3256
[8] Corpum C-Type Medium Energy Neutralizer
  Unstable Medium Energy Neutralizer Mutaplasmid
  capacitorNeed 131.16, cpu 24.288, energyNeutralizerAmount 200.736, maxRange 16848.0, power 273.5582`;

  const p = parseEFT(CURSE);
  const ship = lookupShip(p.shipName);
  const slots = buildSlotsFromEFT(ship, p.mods, p.subsystems);
  const mutated = ['high', 'mid', 'low', 'rigs']
    .flatMap(k => slots[k] ?? []).filter(s => s?.mutaplasmid).length;
  check('geno', 'all eight abyssal modules kept their rolls', mutated, 8, 0);

  const st = calcFitStats(ship, slots, p.drones ?? [], SKILLS_ALL_V, {
    implants: p.implantNames ?? [],
    boosters: (p.boosterNames ?? []).map(n => ({ name: n })),
  });
  // Curse base 380 tf / 900 MW; CPU Management V and Power Grid Management V take those to 475 and
  // 1125; the Ancillary Current Router II adds 15% PG; CA-1/CA-2 each add 1.5% x 3.276.
  check('geno', 'cpu output', st.cpuTotal, 498.34, 1e-5);
  check('geno', 'pg output',  st.pgTotal, 1357.32, 1e-5);
  // What the user actually reads off the fitting bar, and the reason the hundredths matter.
  check('geno', 'cpu surplus', st.cpuTotal - st.cpuUsed, 3.51, 1e-3);
  check('geno', 'pg surplus',  st.pgTotal  - st.pgUsed,  4.09, 1e-3);

  // ── The per-item engine handles the info panel reads for its two value columns ──────────────
  // Keyed by slot id, which is rack-prefixed and so unique fit-wide. A mis-keyed map is invisible in
  // every aggregate stat above — the fit still computes — so it needs its own assertion.
  const filled = ['high','mid','low','rigs'].flatMap(k => slots[k] ?? []).filter(s => s?.typeID);
  check('geno', 'every fitted module has its engine item',
    filled.filter(s => st.fittedItems.get(s.id)?.typeID === s.typeID).length, filled.length, 0);

  // An abyssal roll is setBase()d, so the engine's BASE is the ROLLED value, not the stock item's.
  // That is what makes the panel's right-hand column read post-mutation/pre-fit-effect, exactly as
  // pyfa's does, with no special case anywhere downstream. 22.90375 is the roll written in the EFT
  // above; 25 is what the stock Federation Navy 800mm Steel Plates carries.
  const plateSlot = (slots.low ?? []).find(s => s.name === 'Federation Navy 800mm Steel Plates');
  const plate = st.fittedItems.get(plateSlot.id);
  check('geno', 'abyssal base IS the roll', plate.getBase('cpu'), 22.90375, 1e-9);
  check('geno', 'the stock type still says otherwise', TYPES[plate.typeID].a.cpu, 25, 0);

  // ...and `get()` is that base plus what the FIT does to it: Acceleration Control V (+25%) and
  // Zor's Custom Navigation Hyper-Link (speedFBonus 5), each in its own stacking group and so both
  // at full strength. Both columns from one object, which is the whole design.
  const mwdSlot = (slots.mid ?? []).find(s => s.name === 'Corelum B-Type 50MN Microwarpdrive');
  const mwd = st.fittedItems.get(mwdSlot.id);
  check('geno', 'mwd speedFactor base is the roll', mwd.getBase('speedFactor'), 525.5976, 1e-9);
  check('geno', 'mwd speedFactor current adds the fit on top',
    mwd.get('speedFactor'), 525.5976 * 1.25 * 1.05, 1e-9);
}

// ─────────────────────────────────────────────────────────────────────────────
// 12j. FITTED-ITEM ATTRIBUTES FOR THE INFO PANEL — subsystems and missile charges.
//
//      The panel shows current-vs-base from ONE engine item per fitted thing. Two of those things
//      do not fall out of the engine alone:
//
//      • Subsystem slots are only given their ids on the app's import path. A list handed straight
//        to buildSlotsFromEFT used to arrive with none, so all four collapsed onto the key
//        `undefined` and three subsystems became unreachable.
//      • A missile's flight time, velocity and damage are computed in THIS file, outside the engine
//        (calc.js reads charge attributes raw and builds its own multiplier chain for the skills the
//        engine cannot apply to a charge). So `_charge.get()` equals `_charge.getBase()` for exactly
//        the attributes a missile fit is read for, and the panel needs `fittedChargeStats` to say
//        anything true. The assertions below pin BOTH halves: that the engine alone is silent, and
//        that the override is not.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nFITTED-ITEM ATTRIBUTES (subsystems, missile charges)');
  const LOKI = `[Loki, info panel]

Heavy Missile Launcher II, Scourge Fury Heavy Missile

Loki Core - Augmented Nuclear Reactor
Loki Defensive - Adaptive Defense Node
Loki Offensive - Launcher Efficiency Configuration
Loki Propulsion - Intercalated Nanofibers
`;
  const p = parseEFT(LOKI);
  const ship = lookupShip(p.shipName);
  const slots = buildSlotsFromEFT(ship, p.mods, p.subsystems);
  const st = calcFitStats(ship, slots, [], SKILLS_ALL_V, {});

  const subIds = (slots.subsystems ?? []).map(s => s.id);
  check('panel', 'four subsystem slots, four distinct ids', new Set(subIds).size, 4, 0);
  check('panel', 'and they are the rack-prefixed ones', subIds.join(','), 'sub0,sub1,sub2,sub3', 0);
  check('panel', 'every subsystem resolves to its own engine item',
    (slots.subsystems ?? []).filter(s => s.typeID && st.fittedItems.get(s.id)?.typeID === s.typeID).length, 4, 0);

  const launcher = st.fittedItems.get('h0');
  const charge = launcher._charge;
  const ov = st.fittedChargeStats.get('h0');

  // What the engine can and cannot reach, stated exactly. It DOES carry the subsystem's +5%/lvl
  // missile velocity (effect 6923, a LocationRequiredSkillModifier filtered on the charge's missile
  // skill) — so the charge reads 4300 x 1.25. What it cannot carry is the SKILL half, because a
  // skill's ItemModifier cannot reach a charge; on flight time and damage, where the skills are the
  // only source here, it therefore has nothing to say at all.
  check('panel', 'engine carries the subsystem half of velocity',
    charge.get('maxVelocity'), 4300 * 1.25, 1e-9);
  check('panel', 'engine leaves charge flight time at base',
    charge.get('explosionDelay') - charge.getBase('explosionDelay'), 0, 0);
  check('panel', 'engine leaves charge damage at base',
    charge.get('kineticDamage') - charge.getBase('kineticDamage'), 0, 0);

  // calc.js rebuilds the whole chain from the RAW base, so its answer must carry BOTH halves:
  // Missile Projection V (+10%/lvl velocity) and Missile Bombardment V (+10%/lvl flight), both
  // unpenalized, plus that same subsystem +25% on velocity.
  check('panel', 'charge velocity current', ov.maxVelocity, 4300 * 1.5 * 1.25, 1e-9);
  check('panel', 'charge flight time current', ov.explosionDelay, 4875 * 1.5, 1e-9);
  // Heavy Missiles V (+5%/lvl) x Warhead Upgrades V (+2%/lvl) = 1.25 x 1.10.
  check('panel', 'charge damage current', ov.kineticDamage, 201 * 1.25 * 1.10, 1e-9);
  // The launcher carries no damageMultiplier, so the panel's four damage rows must add back up to
  // the fit's volley. This ties the override to a number the rest of the suite already validates —
  // a drifting multiplier chain cannot move one without the other.
  const ovDmg = ov.emDamage + ov.thermalDamage + ov.kineticDamage + ov.explosiveDamage;
  check('panel', 'charge damage rows sum to the fit volley', ovDmg, st.weaponVolley.total, 1e-9);

  // Application is overridden for the same reason, and it is the sharper case: the engine reaches a
  // charge through LocationRequiredSkillModifier only, so it carries this subsystem's +5%/lvl
  // explosion velocity (effect 6924) and NONE of the two skills, which are OwnerRequiredSkillModifier.
  // Target Navigation Prediction V is +10%/lvl and Guided Missile Precision V is -5%/lvl, both
  // unpenalized. eos, all skills V: 133.125 m/s and 180.75 m.
  check('panel', 'engine carries only the subsystem half of explosion velocity',
    charge.get('aoeVelocity'), 71 * 1.25, 1e-9);
  check('panel', 'charge explosion velocity current', ov.aoeVelocity, 71 * 1.5 * 1.25, 1e-9);
  check('panel', 'charge explosion radius current', ov.aoeCloudSize, 241 * 0.75, 1e-9);
  check('panel', 'and the engine has something to say about it',
    charge.get('aoeVelocity') > charge.getBase('aoeVelocity') ? 1 : 0, 1, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 13. ALL HULLS COMPUTE — every ship must produce stats without throwing.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nALL HULLS');
  let crashed = 0, total = 0;
  for (const s of Object.values(shipsData)) {
    total++;
    try {
      calcFitStats({ typeID: s.typeID, name: s.name }, EMPTY, [], null, {});
    } catch (e) {
      crashed++;
      if (crashed <= 3) console.log(`      CRASH: ${s.name} — ${e.message}`);
    }
  }
  check('hulls', 'hulls computing cleanly', total - crashed, total, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 13i. MODULE COMPARISON — the Variations tab's compare view (src/lib/compare.js)
//      All derived logic, and all of it silently wrong-able by a CCP rename or renumber: which
//      attributes differ, which numbered siblings collapse, and which direction counts as better.
//      The direction overrides are the sharpest edge — they deliberately CONTRADICT CCP's
//      highIsGood for the booster side-effect family, so nothing but a test pins them.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nMODULE COMPARISON');
  const ext = ['Large Shield Extender II', 'Large Shield Extender I', 'Large F-S9 Regolith Compact Shield Extender'].map(tid);
  const diff = differingAttributes(ext);
  // Only attributes that actually vary. Meta/tech level differ on every comparison by construction
  // and would crowd out the real ones, so they are excluded by name AND by pattern.
  //
  // ONE attribute, not three: this family also differs in cpu and power, and those are now drawn as
  // the powergrid/CPU glyph line above the attribute list — shown on every row whether or not they
  // changed, so ranking them here as well would spend two of the six rows saying it twice.
  check('cmp', 'shield extenders differ in exactly 1 comparable attr', diff.length, 1, 0);
  check('cmp', 'capacityBonus is the one', diff.includes('capacityBonus') ? 1 : 0, 1, 0);
  check('cmp', 'fitting cost never enters the attribute list',
        diff.some(k => ['cpu', 'power', 'upgradeCost'].includes(k)) ? 1 : 0, 0, 0);
  check('cmp', 'no meta/tech level leaks in', diff.some(k => /^(meta|tech)Level/i.test(k)) ? 1 : 0, 0, 0);

  const exile = ['Standard Exile Booster', 'Improved Exile Booster', 'Strong Exile Booster'].map(tid);
  const ed = differingAttributes(exile);
  // A booster ships boosterEffectChance1..5 all holding the same number; five rows for one fact.
  check('cmp', 'booster side-effect chances collapse to one', ed.filter(k => /^boosterEffectChance/.test(k)).length, 1, 0);
  // Six, not five: four side effects + bonus + chance is exactly six, and at five one fell off.
  check('cmp', 'all six Exile attributes fit', ed.length, 6, 0);

  const rows = compareRows(exile, exile[0]);
  const strong = rows.find(r => r.typeID === exile[2]);
  const stat = k => strong.stats.find(s => s.key === k);
  check('cmp', 'baseline row is flagged', rows.filter(r => r.isBaseline).length, 1, 0);
  // CCP flags every booster*Penalty highIsGood=1. They are also signed inconsistently — ArmorHP is
  // negative, MissileAOECloud positive, both meaning "worse" — so MAGNITUDE decides, not sign.
  check('cmp', 'stronger armor HP penalty reads worse', stat('boosterArmorHPPenalty').better ? 1 : 0, 0, 0);
  check('cmp', 'stronger explosion radius penalty reads worse', stat('boosterMissileAOECloudPenalty').better ? 1 : 0, 0, 0);
  check('cmp', 'higher side-effect chance reads worse', stat('boosterEffectChance1').better ? 1 : 0, 0, 0);
  check('cmp', 'bigger armor repair bonus reads better', stat('armorDamageAmountBonus').better ? 1 : 0, 1, 0);
  // aoeCloudSizeBonus is NEGATIVE when it helps, so a bigger magnitude is a stronger bonus.
  const crash = ['Standard Crash Booster', 'Strong Crash Booster'].map(tid);
  const cs2 = compareRows(crash, crash[0]).find(r => r.typeID === crash[1]);
  check('cmp', 'stronger explosion radius BONUS reads better',
        cs2.stats.find(s => s.key === 'aoeCloudSizeBonus').better ? 1 : 0, 1, 0);

  // Sorting: the fitted module is the thing every delta is measured from, so it stays pinned in
  // BOTH directions; unpriced rows sort as Infinity and must not float to the top when reversed.
  const prices = new Map([[ext[1], 1.2e6], [ext[2], 4.5e6]]);
  const er = compareRows(ext, ext[0]);
  const order = (by, dir) => sortCompareRows(er, { by, dir, prices }).map(r => r.typeID);
  check('cmp', 'baseline pinned first, price asc', order('price', 'asc')[0] === ext[0] ? 1 : 0, 1, 0);
  check('cmp', 'baseline pinned first, price desc', order('price', 'desc')[0] === ext[0] ? 1 : 0, 1, 0);
  check('cmp', 'cheapest first when ascending', order('price', 'asc')[1] === ext[1] ? 1 : 0, 1, 0);
  check('cmp', 'dearest first when descending', order('price', 'desc')[1] === ext[2] ? 1 : 0, 1, 0);
  check('cmp', 'meta sort keeps baseline pinned', order('meta', 'asc')[0] === ext[0] ? 1 : 0, 1, 0);

  // ── Direction DERIVED from the module's own effects ───────────────────────────────────────
  // The hand-kept lists could only ever be extended one reported bug at a time. This asks the
  // dogma data instead: the effect says which attribute the modifier changes, how, and on whom,
  // and the TARGET attribute's highIsGood then says whether that is an improvement.
  const egress = ['Large Egress Port Maximizer I', 'Large Egress Port Maximizer II'].map(tid);
  const eg2 = compareRows(egress, egress[0]).find(r => r.typeID === egress[1]);
  const estat = eg2.stats.find(s => s.key === 'capNeedBonus');
  // -15 -> -20: capNeedBonus drives capacitorNeed DOWN, and lower cap need is better.
  check('cmp', 'egress II cap need delta is negative', estat.delta, -5, 1e-9);
  check('cmp', 'deeper cap need reduction reads better', estat.better ? 1 : 0, 1, 0);

  // The counterexample that rules out a blanket "negative means magnitude" shortcut. A Capacitor
  // Power Relay's shieldBoostMultiplier is ALSO negative and also gets larger on better modules,
  // but it lowers shieldBonus — which is higher-is-better — so it is a DRAWBACK: -5 beats -11.
  const cpr = ['Capacitor Power Relay I', 'Capacitor Power Relay II'].map(tid);
  const cpr2 = compareRows(cpr, cpr[0]).find(r => r.typeID === cpr[1]);
  const cstat = cpr2.stats.find(s => s.key === 'shieldBoostMultiplier');
  check('cmp', 'cap relay II shield penalty is deeper', cstat.delta, -1, 1e-9);
  check('cmp', 'a deeper DRAWBACK reads worse', cstat.better ? 1 : 0, 0, 0);

  // CCP mis-flags the whole industry multiplier family highIsGood=1, which would have made every
  // structure rig's -20% manufacturing time read as a downgrade.
  const engRig = ['Standup M-Set Advanced Component Manufacturing Time Efficiency I',
                  'Standup M-Set Advanced Component Manufacturing Time Efficiency II'].map(tid);
  const er2 = compareRows(engRig, engRig[0]).find(r => r.typeID === engRig[1]);
  const erStat = er2.stats.find(s => s.key === 'attributeEngRigTimeBonus');
  check('cmp', 'eng rig II cuts more manufacturing time', erStat.delta < 0 ? 1 : 0, 1, 0);
  check('cmp', 'deeper manufacturing time cut reads better', erStat.better ? 1 : 0, 1, 0);

  // Hostile modifiers are deliberately NOT derived, and this is the case that forces it: a warp
  // scrambler's target attribute (warpScrambleStatus) is the ATTACKER's win condition, not the
  // victim's stat, so the "bad for them is good for me" inversion would call a strength-1
  // scrambler better than a strength-2. Asserted against derivedDirection directly — the attribute
  // is constant across the Warp Scrambler group, so it never reaches a comparison row to be seen.
  check('cmp', 'hostile modifiers are never derived',
        derivedDirection(tid('Warp Scrambler II'), 'warpScrambleStrength') === null ? 1 : 0, 1, 0);
  // ...while a self modifier on the very same module still resolves.
  check('cmp', 'self modifiers on the same module still derive',
        derivedDirection(tid('Warp Scrambler II'), 'capacitorNeed') === null ? 0 : 1, 0, 0);
  check('cmp', 'cap need reduction derives to smaller-is-better',
        derivedDirection(tid('Large Egress Port Maximizer II'), 'capNeedBonus') === false ? 1 : 0, 1, 0);

  // ── Signed EWAR bonuses: sign is the module CLASS, magnitude is the strength ──────────────
  // A Guidance Disruptor II's aoeVelocityBonus is −12 against a Guidance Disruptor I's −10 — more
  // negative because it cripples the target's missiles harder. CCP flags all of these highIsGood=1,
  // which read −12 as worse and coloured the STRONGER disruptor red.
  const gd = ['Guidance Disruptor I', 'Guidance Disruptor II'].map(tid);
  const gd2 = compareRows(gd, gd[0]).find(r => r.typeID === gd[1]);
  const gstat = k => gd2.stats.find(s => s.key === k);
  check('cmp', 'gd II explosion velocity delta is negative', gstat('aoeVelocityBonus').delta, -2, 1e-9);
  check('cmp', 'stronger explosion VELOCITY bonus reads better', gstat('aoeVelocityBonus').better ? 1 : 0, 1, 0);
  // Same family, opposite sign on the very same module — proof the rule is magnitude, not sign.
  check('cmp', 'gd II explosion radius delta is positive', gstat('aoeCloudSizeBonus').delta, 2, 1e-9);
  check('cmp', 'stronger explosion RADIUS bonus reads better', gstat('aoeCloudSizeBonus').better ? 1 : 0, 1, 0);
  // Stasis webs are the same rule again: −60 cripples harder than −50, so it is the better web.
  const web = ['Stasis Webifier I', 'Stasis Webifier II'].map(tid);
  const web2 = compareRows(web, web[0]).find(r => r.typeID === web[1]);
  const wstat = web2.stats.find(s => s.key === 'speedFactor');
  check('cmp', 'web II velocity delta is negative', wstat.delta, -10, 1e-9);
  check('cmp', 'stronger web reads better', wstat.better ? 1 : 0, 1, 0);
  // The SAME attribute is positive on prop mods, where bigger is also better — the magnitude rule
  // has to keep that right, not just flip the sign convention.
  const prop = ['5MN Microwarpdrive I', '5MN Microwarpdrive II'].map(tid);
  const prop2 = compareRows(prop, prop[0]).find(r => r.typeID === prop[1]);
  const pstat = prop2.stats.find(s => s.key === 'speedFactor');
  check('cmp', 'faster MWD still reads better', (pstat && pstat.delta > 0 && pstat.better) ? 1 : 0, 1, 0);
  // The mutaplasmid editor asks the SAME function, so a rolled attribute and a swapped variant
  // cannot disagree about which way is up. It used to ask CCP's highIsGood directly, which reads a
  // web rolled from -60 to -66 as the worse number — the exact case the magnitude rule exists for,
  // and one that only became visible when these sliders started working (their min/max came back
  // inverted, so the thumb was pinned). Both signs, and both directions on each.
  const webTid = tid('Stasis Webifier II'), batTid = tid('Small Cap Battery II');
  check('cmp', 'a stronger rolled web reads better', directionOf('speedFactor', -66, -60, webTid) ? 1 : 0, 1, 0);
  check('cmp', 'a weaker rolled web reads worse', directionOf('speedFactor', -54, -60, webTid) ? 1 : 0, 0, 0);
  check('cmp', 'a faster rolled MWD reads better', directionOf('speedFactor', 550, 500, tid('5MN Microwarpdrive II')) ? 1 : 0, 1, 0);
  // Negative base, but CCP flags this one lower-is-better, so a blanket "negative means flip" rule
  // would break it. -28 resists energy warfare harder than -20.
  check('cmp', 'a stronger rolled cap battery reads better', directionOf('energyWarfareResistanceBonus', -28, -20, batTid) ? 1 : 0, 1, 0);
  check('cmp', 'a weaker rolled cap battery reads worse', directionOf('energyWarfareResistanceBonus', -15, -20, batTid) ? 1 : 0, 0, 0);
  // Positive base, lower-is-better: a roll that costs more CPU is not an improvement.
  check('cmp', 'a costlier rolled CPU reads worse', directionOf('cpu', 30, 25, webTid) ? 1 : 0, 0, 0);
  // ── The ship info sheet's attribute keys ─────────────────────────────────────────────────
  // ShipInfoSheet's attributes tab colours a changed hull attribute green or red through this same
  // directionOf, keyed by a hand-typed dogma attribute NAME per row. A typo there does not throw and
  // does not blank the row: the name misses ATTR_NAME_TO_ID, highIsGood comes back undefined, and
  // directionOf quietly settles on lower-is-better — so a hull whose shield buffer went UP would
  // paint red. Every key that sheet uses is asserted here, with the verdict it must give, because
  // the failure is invisible by inspection and only ever shows up as a wrong colour.
  const tempestTid = tid('Tempest');
  const HULL_ATTR_DIR = {
    cpuOutput: 1, powerOutput: 1, upgradeCapacity: 1, capacitorCapacity: 1, rechargeRate: 0,
    maxTargetRange: 1, scanResolution: 1, maxLockedTargets: 1, maxVelocity: 1, agility: 0,
    warpSpeedMultiplier: 1, signatureRadius: 0, shieldCapacity: 1, armorHP: 1, hp: 1,
    droneCapacity: 1, droneBandwidth: 1,
    // One per sensor type — the sheet keys off the hull's own sensor, so all four must resolve.
    scanRadarStrength: 1, scanLadarStrength: 1, scanMagnetometricStrength: 1, scanGravimetricStrength: 1,
  };
  for (const [k, want] of Object.entries(HULL_ATTR_DIR))
    check('cmp', `hull ${k}: ${want ? 'higher' : 'lower'} is better`,
          directionOf(k, 2, 1, tempestTid) ? 1 : 0, want, 0);
  // `mass` is the one attribute in the sheet where CCP's own flag has to be overridden: it ships
  // highIsGood=1, and on a hull that is backwards — mass is what makes an align slow. compare.js
  // corrects it in LOWER_IS_BETTER_TARGETS, and these two pin that the correction reaches the DIRECT
  // attribute path and not only the effect path. It was consulted on the effect path alone at first,
  // which painted a plated hull's heavier mass green.
  check('cmp', 'hull mass: heavier is worse (CCP flag overridden)',
        directionOf('mass', 2, 1, tempestTid) ? 1 : 0, 0, 0);
  check('cmp', 'hull mass: lighter is better',
        directionOf('mass', 1, 2, tempestTid) ? 1 : 0, 1, 0);
  // Same correction, the other family it covers: the ~50 industry multipliers are all mis-flagged
  // highIsGood, when a rig's −20% exists to drive them down.
  check('cmp', 'industry time multiplier: lower is better',
        directionOf('attributeEquipmentManufactureTimeMultiplier', 0.8, 1, tempestTid) ? 1 : 0, 1, 0);

  // Heat absorption differs on nearly every meta variant and only matters while overheating, so it
  // outranked the attributes a disruptor is actually chosen for. Excluded by name.
  const gdAll = Object.keys(TYPES).filter(id => /Guidance Disruptor/i.test(TYPES[id].n ?? '')).map(Number);
  check('cmp', 'heat absorption never shown', differingAttributes(gdAll).includes('heatAbsorbtionRateModifier') ? 1 : 0, 0, 0);

  // ── NPC-facing attributes never belong in a fit comparison ───────────────────────────────
  // entityCapacitorLevelModifier{Small,Medium,Large} is how much capacitor an NPC is left with
  // after this neutraliser hits it — NPC AI data. No effect in the bundle references 1894–1897 and
  // eos never reads them, so it is inert; it still took TWO of six rows on every energy
  // neutraliser, displacing falloff — the one stat that separates the meta variants.
  const neuts = Object.keys(TYPES).filter(id => TYPES[id].gn === 'Energy Neutralizer' && /^Small /.test(TYPES[id].n ?? '')).map(Number);
  const nd = differingAttributes(neuts);
  check('cmp', 'NPC capacitor attrs never shown', nd.some(k => /^entityCapacitorLevel/.test(k)) ? 1 : 0, 0, 0);
  check('cmp', 'neut falloff is shown instead', nd.includes('falloffEffectiveness') ? 1 : 0, 1, 0);
  // Every stat a neutraliser is actually chosen on now leads the list.
  check('cmp', 'neut drain amount still leads', nd.includes('energyNeutralizerAmount') ? 1 : 0, 1, 0);

  // ── Command bursts: range is the faction hulls' whole selling point ───────────────────────
  // 'Vigilant' reaches 18 km against a T1/T2 burst's 15 km, and that row went missing because
  // canFitShipType1/2 (raw typeIDs, present on one variant and absent on the other → a perfect 1.0
  // spread) and warfareBuff2..4Value (identical siblings that never collapsed, since their index is
  // INFIX not suffix) took five of the six slots between them.
  const burst = ['Shield Command Burst I', 'Shield Command Burst II', '‘Vigilant’ Shield Command Burst'].map(tid);
  const bd = differingAttributes(burst);
  check('cmp', 'burst range is shown', bd.includes('maxRange') ? 1 : 0, 1, 0);
  check('cmp', 'no typeID whitelists leak in', bd.some(k => /^canFitShip/.test(k)) ? 1 : 0, 0, 0);
  check('cmp', "CCP's FAKE placeholder is excluded", bd.includes('commandBurstDbuffEffectStrengthFAKE') ? 1 : 0, 0, 0);
  check('cmp', 'infix-numbered buff siblings collapse to one', bd.filter(k => /^warfareBuff\d+Value$/.test(k)).length, 1, 0);
  const vig = compareRows(burst, burst[0]).find(r => r.typeID === burst[2]);
  check('cmp', 'Vigilant burst reaches 3 km further', vig.stats.find(s => s.key === 'maxRange').delta, 3000, 1e-9);
  check('cmp', 'longer burst range reads better', vig.stats.find(s => s.key === 'maxRange').better ? 1 : 0, 1, 0);

  // ── An ABYSSAL baseline is compared on its ROLL, not the base item ────────────────────────
  // A mutated module keeps its base typeID, so `compareRows(vars, typeID)` silently measured every
  // delta against the unrolled Stasis Webifier II — the one set of numbers the user already knows
  // does not describe what is fitted. Stock SW II is 10 km / -60; this roll is 14.2 km / -63.2.
  const webVars = variantsOf(tid('Stasis Webifier II')).map(v => v.typeID).filter(Boolean);
  const roll = { speedFactor: -63.2, maxRange: 14200 };
  const rolled = compareRows(webVars, tid('Stasis Webifier II'), { baselineMutations: roll });
  const swI = rolled.find(r => r.typeID === tid('Stasis Webifier I'));
  check('cmp', 'range delta is vs the ROLL, not the base item', swI.stats.find(s => s.key === 'maxRange').delta, -4200, 1e-9);
  check('cmp', 'web strength delta is vs the ROLL', swI.stats.find(s => s.key === 'speedFactor').delta, 13.2, 1e-6);
  // Without this the fitted module appears to differ from ITSELF by exactly the roll.
  check('cmp', 'the rolled row reads zero deltas against itself',
        rolled.find(r => r.isBaseline).stats.every(s => s.delta === 0) ? 1 : 0, 1, 0);
  check('cmp', 'the rolled row reports its rolled value',
        rolled.find(r => r.isBaseline).stats.find(s => s.key === 'maxRange').value, 14200, 1e-9);
  // The UNROLLED item is the one swap guaranteed to be relevant — a bad roll is often worse than the
  // module it was made from — and it was the only variant the list could not offer, because it
  // shares its typeID with the baseline and was deduped away. It now comes back as a second row.
  const stock = rolled.filter(r => r.isStockBase);
  check('cmp', 'the unmutated base item gets its own row', stock.length, 1, 0);
  check('cmp', 'the stock row is not the baseline', stock[0].isBaseline ? 1 : 0, 0, 0);
  check('cmp', 'the stock row keeps the base typeID', stock[0].typeID === tid('Stasis Webifier II') ? 1 : 0, 1, 0);
  // Stock SW II is 10 km / -60 against the roll's 14.2 km / -63.2, so reverting costs range AND
  // strength — the deltas are what tell you the roll was worth keeping.
  check('cmp', 'stock range delta vs the roll', stock[0].stats.find(s => s.key === 'maxRange').delta, -4200, 1e-9);
  check('cmp', 'stock web strength delta vs the roll', stock[0].stats.find(s => s.key === 'speedFactor').delta, 3.2, 1e-6);
  check('cmp', 'reverting to a weaker web reads worse', stock[0].stats.find(s => s.key === 'speedFactor').better ? 1 : 0, 0, 0);
  // Only ever with a roll: an ordinary comparison must not sprout a duplicate row.
  check('cmp', 'no roll means no stock row', compareRows(webVars, tid('Stasis Webifier II')).some(r => r.isStockBase) ? 1 : 0, 0, 0);
  // A rolled attribute the whole family AGREES on (every webifier cycles in 5000 ms) is still a
  // real difference now, so it has to reach the displayed list — which it only can if the mutated
  // baseline scores as a candidate in differingAttributes.
  const durRoll = compareRows(webVars, tid('Stasis Webifier II'), { baselineMutations: { duration: 4200 } });
  check('cmp', 'a rolled attribute constant across the family still shows',
        durRoll.find(r => r.typeID === tid('Stasis Webifier I')).stats.find(s => s.key === 'duration')?.delta, 800, 1e-9);
  // Unmutated behaviour must be untouched: no roll, no extra candidate, same three attributes.
  check('cmp', 'no roll leaves the comparison exactly as before',
        differingAttributes(webVars).join(',') === 'capacitorNeed,maxRange,speedFactor' ? 1 : 0, 1, 0);
}

// 13l. COMMAND BURSTS FROM A LINK FIT - whose skills fly the booster?
//      A Vargur under a Sleipnir's shield links, validated against pyfa by hand:
//      146,000 EHP / 84.3-85.4-87.5-89.6 shield resists / 12,163.6 EHP/s shield boost.
//
//      The bug this pins: externalBursts was computed with the LOCAL pilot's skills, while the
//      Effects tab has always DISPLAYED the same list at all V. The two agreed only while every
//      skill was unset (and so defaulted to V) - the moment a real character was synced from ESI
//      they diverged, and this fit read 141.9k EHP with the card beside it still saying 22.5%.
//      A command fit is someone else's ship; the local sheet has no business scaling it.
{
  console.log('\nCOMMAND BURSTS FROM A LINK FIT');
  const VARGUR = `[Vargur, strong]
Domination Gyrostabilizer
Domination Gyrostabilizer
Domination Gyrostabilizer
Domination Gyrostabilizer
Domination Tracking Enhancer
Damage Control II

Pithum C-Type Multispectrum Shield Hardener
Shadow Serpentis 500MN Microwarpdrive
Pithum C-Type Multispectrum Shield Hardener
True Sansha Heavy Capacitor Booster, Navy Cap Booster 3200
Caldari Navy Warp Scrambler
Gist X-Type X-Large Shield Booster

800mm Repeating Cannon II, Hail L
800mm Repeating Cannon II, Hail L
True Sansha Heavy Energy Neutralizer
Bastion Module I
Corpus C-Type Heavy Energy Neutralizer
800mm Repeating Cannon II, Hail L
800mm Repeating Cannon II, Hail L

Large Core Defense Operational Solidifier II
Large Core Defense Operational Solidifier II


Mid-grade Crystal Alpha
Mid-grade Crystal Beta
Mid-grade Crystal Gamma
Mid-grade Crystal Delta
Mid-grade Crystal Epsilon
Mid-grade Crystal Omega
Eifyr and Co. 'Gunslinger' Motion Prediction MR-705
Inherent Implants 'Squire' Capacitor Management EM-805
Eifyr and Co. 'Gunslinger' Surgical Strike SS-905
Eifyr and Co. 'Gunslinger' Large Projectile Turret LP-1005

Strong Blue Pill Booster
Agency 'Pyrolancea' DB9 Dose IV`;
  const SLEIPNIR = `[Sleipnir, shield links]
50MN Quad LiF Restrained Microwarpdrive

Skirmish Command Burst II, Evasive Maneuvers Charge /offline
Skirmish Command Burst II, Interdiction Maneuvers Charge /offline
Skirmish Command Burst II, Rapid Deployment Charge /offline
Shield Command Burst II, Active Shielding Charge
Shield Command Burst II, Shield Extension Charge
Shield Command Burst II, Shield Harmonizing Charge

Medium Command Processor I


Republic Fleet Command Mindlink`;
  const buildFit = (eft) => {
    const p = parseEFT(eft);
    const ship = lookupShip(p.shipName);
    return { p, ship, slots: buildSlotsFromEFT(ship, p.mods, p.subsystems) };
  };
  const V = buildFit(VARGUR), S = buildFit(SLEIPNIR);
  const bursts = computeCommandBursts(S.ship, S.slots, SKILLS_ALL_V, { implants: S.p.implantNames ?? [] });
  const buff = (id) => bursts.find(b => b.buffID === id)?.value ?? 0;
  // Shield Harmonizing (10), Active Shielding (11) and Shield Extension (12), all 22.5% with a
  // Republic Fleet Command Mindlink. This is the number the Effects tab prints on the card.
  check('burst', 'shield harmonizing burst strength', buff(10), -22.5, 1e-9);
  check('burst', 'active shielding burst strength',   buff(11), -22.5, 1e-9);
  check('burst', 'shield extension burst strength',   buff(12),  22.5, 1e-9);

  const stats = (eb) => calcFitStats(V.ship, V.slots, [], SKILLS_ALL_V,
    { implants: V.p.implantNames ?? [], boosters: (V.p.boosterNames ?? []).map(n => ({ name: n })), externalBursts: eb });
  const linked = stats(bursts);
  // pyfa, read by hand. Tolerances are that readout's precision, not slack.
  check('burst', 'Vargur EHP under shield links', linked.totalEHP, 146000, 0.005);
  check('burst', 'shield EM resist under links',  linked.resists.shield.em,  84.3, 0.002);
  check('burst', 'shield TH resist under links',  linked.resists.shield.th,  85.4, 0.002);
  check('burst', 'shield KIN resist under links', linked.resists.shield.kin, 87.5, 0.002);
  check('burst', 'shield EXP resist under links', linked.resists.shield.exp, 89.6, 0.002);
  check('burst', 'shield boost EHP/s under links', linked.shieldRepEhpS, 12163.6, 1e-4);
  // ...and the links must actually be doing something, or everything above passes trivially.
  const bare = stats(null);
  check('burst', 'links raise EHP materially', linked.totalEHP > bare.totalEHP * 1.15 ? 1 : 0, 1, 0);

  // The SOURCE fit names who flies it. App.jsx resolves a projection/command source through the SAME
  // resolver and the SAME fallback as the fit being edited, so a saved fit reads identically either
  // way: the skills it was last edited under are the skills it keeps when something projects it.
  // An untagged link fit therefore follows the app-wide sheet, and a tagged one overrides it.
  const srcBurst = (pilot, appSkills, id) => {
    const sk = resolvePilotSkills(pilot, { appSkills, fallback: appSkills });
    const bs = computeCommandBursts(S.ship, { ...S.slots, pilot }, sk, { implants: S.p.implantNames ?? [] });
    return bs.find(b => b.buffID === id)?.value ?? 0;
  };
  check('burst', 'untagged link fit follows the app sheet', srcBurst(undefined, SKILLS_ALL_V, 12), 22.5, 1e-9);
  // ...and a tagged one does NOT. An alpha cannot train Shield Command at all (section 13t pins
  // shieldCommand === 0), so the same hull with the same modules must boost strictly less.
  check('burst', 'alpha-flown link fit boosts less',
    srcBurst(PILOT_ALPHA, SKILLS_ALL_V, 12) < 22.5 ? 1 : 0, 1, 0);
  check('burst', 'alpha-flown link fit still boosts',
    srcBurst(PILOT_ALPHA, SKILLS_ALL_V, 12) > 0 ? 1 : 0, 1, 0);
  // The tag beats the sheet in BOTH directions - an all-V tag on an alpha's sheet is the mirror of
  // the check above, and it is the one that fails if a tagged source silently falls through.
  check('burst', 'allV tag overrides an alpha app sheet', srcBurst(PILOT_ALL_V, ALPHA_SKILLS, 12), 22.5, 1e-9);
  check('burst', 'untagged follows an alpha app sheet too',
    srcBurst(undefined, ALPHA_SKILLS, 12) < 22.5 ? 1 : 0, 1, 0);
  // ...and it reaches the boosted fit, not just the card.
  check('burst', 'weaker links give the Vargur less EHP',
    stats(computeCommandBursts(S.ship, S.slots, ALPHA_SKILLS, { implants: S.p.implantNames ?? [] })).totalEHP
      < linked.totalEHP ? 1 : 0, 1, 0);
}

// 13o. HOW MANY OF A GROUP MAY RUN AT ONCE (calcFitStats().groupLimits)
//      The Fit tab refuses to activate a second MWD, or to online a second Command Burst, off these
//      numbers. They must come from the ENGINE, not the raw type attribute: CCP's base for a burst is
//      maxGroupOnline/Active 1, raised to 2 by a Command Ship's role bonus (effect 2251), to 3 on a
//      command carrier (6619), and by +1 per Command Processor rig (6766). Read the base attribute
//      instead and the standard three-link Bifrost — which carries two Command Processors for exactly
//      this reason — gets called illegal. Prop mods are the same mechanic at the other extreme:
//      maxGroupActive 1 with NO online limit, so several may be fitted and online but only one runs.
{
  console.log('\nGROUP LIMITS (maxGroupOnline / maxGroupActive)');
  const limits = (shipName, mods) =>
    calcFitStats(lookupShip(shipName), { high: mods.high ?? [], mid: mods.mid ?? [], low: mods.low ?? [], rigs: mods.rigs ?? [] },
      [], SKILLS_ALL_V).groupLimits ?? {};
  const BURST = [M('Skirmish Command Burst II', 'active'), M('Skirmish Command Burst II', 'active')];
  const PROC  = [M('Small Command Processor I', 'online'), M('Small Command Processor I', 'online')];

  const bare = limits('Bifrost', { high: BURST });
  check('grouplim', 'bare Bifrost onlines one burst', bare['Command Burst']?.online, 1, 0);
  check('grouplim', 'bare Bifrost activates one burst', bare['Command Burst']?.active, 1, 0);
  // The fit the rule exists for: two Command Processors buy the third link.
  const proc = limits('Bifrost', { high: BURST, rigs: PROC });
  check('grouplim', 'two Command Processors buy three links', proc['Command Burst']?.online, 3, 0);
  // Role bonuses, which are a different mechanism from the rig and must both be live.
  check('grouplim', 'Command Ship runs two bursts',
    limits('Damnation', { high: [M('Armor Command Burst II', 'active')] })['Command Burst']?.online, 2, 0);
  check('grouplim', 'command carrier runs three bursts',
    limits('Salvation', { high: [M('Armor Command Burst II', 'active')] })['Command Burst']?.online, 3, 0);

  // Prop mods: one ACTIVE, any number online. A nonzero online cap here would offline the second
  // prop mod on every fit that carries an MWD and an afterburner, which is a legal, common setup.
  const prop = limits('Rifter', { mid: [M('5MN Quad LiF Restrained Microwarpdrive', 'active'),
                                        M('1MN Monopropellant Enduring Afterburner', 'online')] });
  check('grouplim', 'one propulsion module active', prop['Propulsion Module']?.active, 1, 0);
  check('grouplim', 'propulsion modules have no online cap', prop['Propulsion Module']?.online ?? 0, 0, 0);

  // maxGroupFitted — the third sibling, and the one that must be read RAW. It is a fitting
  // restriction, not a state ceiling, so `groupOverFitted` reports the violation instead of the UI
  // quietly switching something off.
  const over = (shipName, mods) =>
    calcFitStats(lookupShip(shipName), { high: mods.high ?? [], mid: mods.mid ?? [], low: mods.low ?? [], rigs: mods.rigs ?? [] },
      [], SKILLS_ALL_V).groupOverFitted ?? [];
  const dcLim = limits('Rifter', { low: [M('Damage Control II', 'online')] });
  check('grouplim', 'Damage Control caps at one fitted', dcLim['Damage Control']?.fitted, 1, 0);
  check('grouplim', 'one Damage Control is legal', over('Rifter', { low: [M('Damage Control II', 'online')] }).length, 0, 0);
  const twoDC = over('Rifter', { low: [M('Damage Control II', 'online'), M('Damage Control II', 'online')] });
  check('grouplim', 'two Damage Controls is one violation', twoDC.length, 1, 0);
  check('grouplim', 'the violation names the group', twoDC[0]?.group === 'Damage Control' ? 1 : 0, 1, 0);
  check('grouplim', 'the violation counts the modules', twoDC[0]?.count, 2, 0);
  // Not everything capped is capped at ONE — a hardcoded 1 would call three accelerators illegal.
  const HYPER = M('Limited Hyperspatial Accelerator', 'online');
  check('grouplim', 'Hyperspatial Accelerators cap at three',
    limits('Rifter', { low: [HYPER] })['Warp Accelerator']?.fitted, 3, 0);
  check('grouplim', 'three Hyperspatial Accelerators are legal', over('Rifter', { low: [HYPER, HYPER, HYPER] }).length, 0, 0);
  check('grouplim', 'a fourth Hyperspatial Accelerator is caught', over('Rifter', { low: [HYPER, HYPER, HYPER, HYPER] }).length, 1, 0);
  // Rigs count too, and are a rack the state-based limits never had to walk.
  const HIGGS = M('Small Higgs Anchor I', 'online');
  check('grouplim', 'two Higgs Anchors is a violation', over('Rifter', { rigs: [HIGGS, HIGGS] }).length, 1, 0);
  // A group with no cap must never be reported, however many are fitted.
  check('grouplim', 'uncapped groups never violate',
    over('Rifter', { low: [M('Gyrostabilizer II', 'online'), M('Gyrostabilizer II', 'online'), M('Gyrostabilizer II', 'online')] }).length, 0, 0);
}

// 13m. OVERHEAT PREVIEW UNDER LINKS - the "OH: n km" hint must not lie
//      A module row previews its overheated range while the module is still cold. That preview is
//      a HYPOTHETICAL modifier, and on a penalised attribute a new modifier does not just scale
//      the current value - it takes a stacking slot and demotes everything weaker by a rank.
//
//      Validated by hand: a Loki with Domination webs under a Sleipnir's Interdiction Maneuvers
//      link reads 45.1 km cold and 63.3 km overheated. The old preview multiplied 45.1 by the full
//      45% overload bonus and promised 65.5 km, because it ignored that overheating pushes the
//      33.75% burst into the second slot (x0.8691).
{
  console.log('\nOVERHEAT PREVIEW UNDER LINKS');
  const LOKI = `[Loki, web test]
Loki Core - Immobility Drivers
Loki Defensive - Adaptive Defense Node
Loki Offensive - Support Processor
Loki Propulsion - Intercalated Nanofibers

Damage Control II

Domination Stasis Webifier
Domination Stasis Webifier
5MN Y-T8 Compact Microwarpdrive
`;
  const SLEIP = `[Sleipnir, skirmish]
50MN Quad LiF Restrained Microwarpdrive

Skirmish Command Burst II, Interdiction Maneuvers Charge

Medium Command Processor I


Republic Fleet Command Mindlink`;
  const mk = (eft) => { const p = parseEFT(eft); const ship = lookupShip(p.shipName);
    return { p, ship, slots: buildSlotsFromEFT(ship, p.mods, p.subsystems) }; };
  const L = mk(LOKI), S = mk(SLEIP);
  const bursts = computeCommandBursts(S.ship, S.slots, SKILLS_ALL_V, { implants: S.p.implantNames ?? [] });
  check('oh', 'interdiction maneuvers burst strength', bursts.find(b => b.buffID === 21)?.value ?? 0, 33.75, 1e-9);

  // Returns the first stasis web's {optimal, heatedOptimal} at the given module state.
  const web = (state, eb) => {
    const slots = JSON.parse(JSON.stringify(L.slots));
    for (const sl of slots.mid) if (/Stasis Webifier/.test(sl.name || '')) sl.state = state;
    const ses = calcFitStats(L.ship, slots, [], SKILLS_ALL_V, eb ? { externalBursts: eb } : {}).slotEngineStats;
    for (const [sl, v] of (ses instanceof Map ? ses.entries() : Object.entries(ses || {})))
      if (v && v.optimal != null && /Stasis/.test(sl?.name || '')) return v;
    return null;
  };

  const cold = web('active', bursts), hot = web('overheated', bursts);
  check('oh', 'linked web cold range', cold.optimal, 45.1, 1e-4);
  check('oh', 'linked web overheated range', hot.optimal, 63.3, 1e-4);
  // THE invariant: what the hint promises is what toggling overheat actually delivers.
  check('oh', 'preview equals the real overheated value', cold.heatedOptimal, hot.optimal, 1e-9);
  // ...and it is not simply the old naive multiply, which is what regressing would restore.
  check('oh', 'preview is not the naive multiply',
        Math.abs(cold.heatedOptimal - cold.optimal * 1.45) > 1 ? 1 : 0, 1, 0);

  // With nothing else in the pool the overload IS the only modifier, so the correct answer and the
  // naive one coincide - the fix must not disturb the ordinary case.
  const cold2 = web('active', null), hot2 = web('overheated', null);
  check('oh', 'unlinked web cold range', cold2.optimal, 33.8, 1e-4);
  check('oh', 'unlinked preview equals real overheated', cold2.heatedOptimal, hot2.optimal, 1e-9);
  check('oh', 'unlinked preview still matches the naive multiply',
        Math.abs(cold2.heatedOptimal - cold2.optimal * 1.45) < 0.15 ? 1 : 0, 1, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 13k. ESI SKILL SYNC — a character's sheet must be AUTHORITATIVE
//      ESI's /skills/ lists only what is TRAINED; an untrained skill is absent. In this app an
//      absent skill key means level V (calcFitStats' default, so a fresh install isn't all-red).
//      Merging the partial map over existing state therefore left every untrained skill at V —
//      a real synced character came back with Ice Harvesting Drone Specialization V.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nESI SKILL SYNC');
  // A deliberately sparse character: two trained skills, nothing else.
  const resp = { skills: [
    { skill_id: tid('Gunnery'), trained_skill_level: 5 },
    { skill_id: tid('Drones'),  trained_skill_level: 3 },
  ] };
  const partial = esiSkillsToAppSkills(resp);
  const full = esiSkillsToFullSkillMap(resp);
  check('esi', 'partial map holds only what is trained', Object.keys(partial).length, 2, 0);
  check('esi', 'full map covers the whole catalog', Object.keys(full).length, SKILL_CATALOG.length, 0);
  check('esi', 'trained levels survive', full.gunnery, 5, 0);
  check('esi', 'partial levels survive', full.drones, 3, 0);
  // The exact skill from the report. Absent from ESI => must read 0, not fall through to V.
  check('esi', 'untrained skill reads 0, not V', full.iceHarvestingDroneSpecialization, 0, 0);
  check('esi', 'nothing is left unset', Object.values(full).some(v => v == null) ? 1 : 0, 0, 0);
  check('esi', 'only the trained ones are non-zero', Object.values(full).filter(v => v > 0).length, 2, 0);
  // skill_id -> key now resolves through SKILL_CATALOG's own typeIDs, so every catalog skill is
  // reachable from an ESI response. The old name-based path missed four to name typos.
  const unreachable = SKILL_CATALOG.filter(e => !e.typeID).length;
  check('esi', 'every catalog skill has a typeID to match on', unreachable, 0, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 13t. PER-FIT PILOT — which character's sheet a fit is calculated with.
//      `slots.pilot` names it; resolvePilotSkills turns that name into a skill map. The FALLBACK is
//      the load-bearing part: it is passed in by the caller because it differs by ROLE. The fit you
//      are editing falls back to the app-wide skill sheet; a projection/command SOURCE fit falls
//      back to all V (someone else's ship — your sheet has no business scaling their logi, which is
//      the 13l Vargur/Sleipnir baseline). Both were the behaviour before pilots existed, so an
//      untagged fit must resolve to its caller's fallback and calculate exactly as it always did.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nPER-FIT PILOT');
  const me = { gunnery: 2 };
  const cached = { '95465499': { gunnery: 4 } };
  const other = { gunnery: 1 };
  const R = (p, fb = SKILLS_ALL_V) => resolvePilotSkills(p, { appSkills: me, esiSkills: cached, fallback: fb });

  // An unset pilot is every fit saved before this existed, so it MUST take the caller's fallback.
  check('pilot', 'undefined pilot falls back', R(undefined, other) === other ? 1 : 0, 1, 0);
  check('pilot', 'null pilot falls back', R(null, other) === other ? 1 : 0, 1, 0);
  check('pilot', 'empty string falls back', R('', other) === other ? 1 : 0, 1, 0);
  check('pilot', 'unknown pilot string falls back', R('nonsense', other) === other ? 1 : 0, 1, 0);
  // Same input, two roles, two answers — this is what preserves both existing behaviours at once.
  check('pilot', 'the fallback is the caller\'s, not a constant',
        R(undefined, me) === me && R(undefined, SKILLS_ALL_V) === SKILLS_ALL_V ? 1 : 0, 1, 0);

  check('pilot', 'allV resolves to SKILL_DEFAULTS', R(PILOT_ALL_V, other) === SKILLS_ALL_V ? 1 : 0, 1, 0);
  check('pilot', 'me resolves to the app sheet', R(PILOT_ME, other) === me ? 1 : 0, 1, 0);
  check('pilot', 'me with no app sheet falls back',
        resolvePilotSkills(PILOT_ME, { appSkills: null, fallback: other }) === other ? 1 : 0, 1, 0);
  check('pilot', 'alpha resolves to the alpha ceiling', R(PILOT_ALPHA, other) === ALPHA_SKILLS ? 1 : 0, 1, 0);
  check('pilot', 'esi:<id> resolves to that character\'s cached sheet',
        R(esiPilot('95465499'), other)?.gunnery, 4, 0);
  // A character connected on another device, or one that has never been synced, has no cached map.
  // Guessing (or resolving to an empty object, which calcFitStats would train back to V) would be a
  // silent wrong answer, so it falls back like any other unresolvable pilot.
  check('pilot', 'unsynced esi character falls back', R(esiPilot('1'), other) === other ? 1 : 0, 1, 0);
  check('pilot', 'a non-object cache entry falls back',
        resolvePilotSkills(esiPilot('7'), { esiSkills: { 7: 'nope' }, fallback: other }) === other ? 1 : 0, 1, 0);
  check('pilot', 'esiPilotId round-trips', esiPilotId(esiPilot('42')) === '42' ? 1 : 0, 1, 0);
  check('pilot', 'esiPilotId is null for a preset', esiPilotId(PILOT_ALPHA) === null ? 1 : 0, 1, 0);

  // ALPHA semantics, restated here because the picker offers it as a pilot and it is the one preset
  // whose skills are NOT a uniform level: a skill absent from CCP's ceiling is 0, never V. Shield /
  // Armored / Information Command are absent entirely and Leadership caps at III.
  check('pilot', 'alpha: absent skill is 0 not V', ALPHA_SKILLS.shieldCommand, 0, 0);
  check('pilot', 'alpha: Leadership caps below V', ALPHA_SKILLS.leadership < 5 ? 1 : 0, 1, 0);
  // Teeth that the pilot actually reaches the engine: the same Caracal, two pilots, two DPS figures
  // (both already validated against eos in section 12a).
  const carPilot = { typeID: tid('Caracal'), name: 'Caracal' };
  const hml = { high: [M('Heavy Missile Launcher II', 'active', 'Scourge Fury Heavy Missile')],
                mid: [], low: [], rigs: [] };
  const dpsWith = p => calcFitStats(carPilot, hml, [],
    resolvePilotSkills(p, { appSkills: ALPHA_SKILLS, fallback: SKILLS_ALL_V }), {}).weaponDps?.total;
  // eos: scripts/oracle, Caracal + one HML II with Fury, Character(level 5).
  check('pilot', 'allV pilot flies at all V', dpsWith(PILOT_ALL_V), 44.601791333817474, 1e-5);
  check('pilot', 'alpha pilot flies at the alpha ceiling', dpsWith(PILOT_ALPHA), 37.263845234257474, 1e-5);
  check('pilot', 'no pilot takes the fallback, not the app sheet', dpsWith(undefined), 44.601791333817474, 1e-5);

  // describeSkillSheet — the words the pilot picker and the snapshot card put on a sheet. The trap
  // it exists to avoid: an UNSET skill is V, so a fresh install (SKILL_DEFAULTS, with every
  // requirement-only skill simply absent) must read "All Skills V" and not "Custom".
  const charList = [{ characterId: 95465499, characterName: 'Rex Mikakka' }];
  const rexSheet = Object.fromEntries(SKILL_CATALOG.map(e => [e.key, e.key === 'gunnery' ? 4 : 0]));
  const D = (s, cache = { '95465499': rexSheet }) =>
    describeSkillSheet(s, { esiSkills: cache, characters: charList });

  check('pilot', 'the default sheet reads as all V', D(SKILLS_ALL_V), 'All Skills V');
  check('pilot', 'a sheet with every catalog skill at V reads as all V',
        D(Object.fromEntries(SKILL_CATALOG.map(e => [e.key, 5]))), 'All Skills V');
  check('pilot', 'an empty sheet reads as all V — unset is V', D({}), 'All Skills V');
  check('pilot', 'a synced sheet names its character', D(rexSheet), 'Rex Mikakka');
  // The name must come from the SHEET matching, not from a character merely being connected.
  check('pilot', 'a character connected but not matched is not named',
        D({ ...rexSheet, gunnery: 3 }), 'Custom');
  check('pilot', 'an uncached character cannot be named', D(rexSheet, {}), 'Custom');
  check('pilot', 'the alpha ceiling is named', D(ALPHA_SKILLS), 'Alpha');
  check('pilot', 'a hand-edited sheet is Custom', D({ ...SKILLS_ALL_V, gunnery: 3 }), 'Custom');
}

// ─────────────────────────────────────────────────────────────────────────────
// 13m. ESI FITTING IMPORT/EXPORT — the flag scheme
//      ESI's fitting `flag` is a STRING enum ("HiSlot0", "Cargo", "DroneBay"), not the classic
//      numeric inventory flag (HiSlot0=27) that pyfa's service/port/esi.py still sends. Reading
//      pyfa instead of CCP's published schema meant every module failed the slot lookup and was
//      dropped, so an imported fit arrived as a bare hull with the right name.
//      Schema: https://esi.evetech.net/meta/openapi.json (CharactersCharacterIdFittingsGet).
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nESI FITTING FLAGS');
  const { esiFittingToImportShape, slotsToEsiFitting } = await import('./lib/esi-fits.js');
  const mk = (items) => esiFittingToImportShape({ fitting_id: 1, name: 'T', description: '', ship_type_id: tid('Rifter'), items });

  const modern = mk([
    { flag: 'HiSlot2', quantity: 1, type_id: tid('Small Energy Neutralizer II') },
    { flag: 'HiSlot0', quantity: 1, type_id: tid('200mm AutoCannon II') },
    { flag: 'HiSlot1', quantity: 1, type_id: tid('200mm AutoCannon II') },
    { flag: 'MedSlot0', quantity: 1, type_id: tid('5MN Y-T8 Compact Microwarpdrive') },
    { flag: 'LoSlot0', quantity: 1, type_id: tid('Damage Control II') },
    { flag: 'RigSlot0', quantity: 1, type_id: tid('Small Projectile Burst Aerator II') },
    { flag: 'Cargo', quantity: 100, type_id: tid('Republic Fleet EMP S') },
    { flag: 'DroneBay', quantity: 2, type_id: tid('Warrior II') },
    { flag: 'Invalid', quantity: 1, type_id: tid('Damage Control II') },
  ]);
  check('esifit', 'string flags place every module', modern.mods.length, 6, 0);
  check('esifit', 'string DroneBay is read', modern.drones.length, 1, 0);
  check('esifit', 'string Cargo is read', modern.cargo.length, 1, 0);
  check('esifit', 'Invalid entries are discarded', modern.mods.filter(m => m.name === 'Damage Control II').length, 1, 0);
  // ESI returns items in no order; the slot index is what puts them back where the pilot had them.
  const built = buildSlotsFromEFT(modern.ship, modern.mods, undefined);
  check('esifit', 'slot index orders the rack', built.high[2].name, 'Small Energy Neutralizer II', 0);
  check('esifit', 'first high slot is the gun', built.high[0].name, '200mm AutoCannon II', 0);
  check('esifit', 'rig placed in the rig rack', built.rigs[0].name, 'Small Projectile Burst Aerator II', 0);

  // A fitting file written by an older tool still carries the numeric scheme.
  const legacy = mk([
    { flag: 27, quantity: 1, type_id: tid('200mm AutoCannon II') },
    { flag: 19, quantity: 1, type_id: tid('5MN Y-T8 Compact Microwarpdrive') },
    { flag: 11, quantity: 1, type_id: tid('Damage Control II') },
    { flag: 5,  quantity: 10, type_id: tid('Republic Fleet EMP S') },
    { flag: 87, quantity: 2, type_id: tid('Warrior II') },
  ]);
  check('esifit', 'numeric flags still import', legacy.mods.length, 3, 0);
  check('esifit', 'numeric DroneBay still imports', legacy.drones.length, 1, 0);

  // Export must EMIT the strings — numbers are rejected by the live endpoint.
  const out = slotsToEsiFitting(tid('Rifter'), 'T', { high: built.high, mid: built.mid, low: built.low, rigs: built.rigs, services: [] },
                                [{ name: 'Warrior II', qty: 2, typeID: tid('Warrior II') }], [], []);
  check('esifit', 'export emits no numeric flags', out.items.filter(i => typeof i.flag !== 'string').length, 0, 0);
  check('esifit', 'export numbers the high rack', out.items.filter(i => /^HiSlot\d$/.test(i.flag)).length, 3, 0);
  check('esifit', 'export names the drone bay', out.items.filter(i => i.flag === 'DroneBay').length, 1, 0);
  // Round-trip: what we send must come back as the same fit.
  const round = esiFittingToImportShape({ ...out, fitting_id: 2 });
  check('esifit', 'round-trip keeps every module', round.mods.length, 6, 0);

  // T3 cruiser subsystems ride their own flag range and are placed by group, not by index.
  const t3 = esiFittingToImportShape({ fitting_id: 3, name: 'T', description: '', ship_type_id: tid('Legion'), items: [
    { flag: 'SubSystemSlot0', quantity: 1, type_id: tid('Legion Core - Augmented Antimatter Reactor') },
    { flag: 'SubSystemSlot1', quantity: 1, type_id: tid('Legion Defensive - Augmented Plating') },
  ] });
  check('esifit', 'subsystem flags are recognised', t3.subsystems.length, 2, 0);
  const t3out = slotsToEsiFitting(tid('Legion'), 'T', { high: [], mid: [], low: [], rigs: [], services: [],
    subsystems: [{ typeID: tid('Legion Core - Augmented Antimatter Reactor') }] }, [], [{ name: 'Warrior II', qty: 1, typeID: tid('Warrior II') }], []);
  check('esifit', 'subsystem exports as SubSystemSlot0', t3out.items.filter(i => i.flag === 'SubSystemSlot0').length, 1, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 13n. TRAIT TEXT — hulls, structures AND T3 subsystems
//      build-bundle.py generates ship-traits.json from eve.db's invtraits. It filtered on HULL_CATS
//      alone, so all 48 subsystems came out empty — and a T3 cruiser's real bonuses live on the
//      SUBSYSTEM, not the hull, which made the numbers deciding the fit unreachable in the UI.
//      Values below are read off pyfa's own Traits tab for the same item.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nTRAITS');
  const traits = (await import('./data/ship-traits.json', { with: { type: 'json' } })).default;
  const at = n => traits[String(tid(n))] ?? {};

  const legion = at('Legion Offensive - Liquid Crystal Magnifiers');
  check('traits', 'subsystem carries a per-skill-level section', legion.skills?.length ?? 0, 1, 0);
  check('traits', 'subsystem skill header', legion.skills?.[0]?.header ?? '', 'Amarr Offensive Systems bonuses (per skill level):', 0);
  check('traits', 'subsystem lists all three skill bonuses', legion.skills?.[0]?.bonuses?.length ?? 0, 3, 0);
  check('traits', 'leading percentage is split out for colouring', legion.skills?.[0]?.bonuses?.[1]?.number ?? '', '10%', 0);
  check('traits', 'bonus text keeps the rest of the line', legion.skills?.[0]?.bonuses?.[1]?.text ?? '', 'bonus to Medium Energy Turret damage', 0);
  check('traits', 'subsystem carries a role bonus', legion.role?.bonuses?.length ?? 0, 5, 0);
  check('traits', "role bonus keeps CCP's bulleted base-stat notes", legion.role?.bonuses?.[2]?.text ?? '', '• +7 High Slots, +6 Turret Hardpoints', 0);

  // Every subsystem, not just the one that was checked by hand — the generator either includes the
  // category or it does not, so a partial result means something subtler is wrong than a bad filter.
  let subs = 0, subsWithTraits = 0;
  for (const [id, td] of Object.entries(TYPES)) {
    if ((td.c ?? td.category) !== 32) continue;
    subs++;
    if (traits[id]?.skills?.length || traits[id]?.role) subsWithTraits++;
  }
  check('traits', 'every subsystem has trait bonuses', subs - subsWithTraits, 0, 0);
  check('traits', 'subsystems are actually present', subs > 0 ? 1 : 0, 1, 0);

  // Descriptions stay in type-descriptions.json for subsystems — one source per string. Hulls keep
  // theirs here, next to their bonuses, which is the split the info panel is built around.
  check('traits', 'subsystem carries no duplicate description', legion.desc === undefined ? 1 : 0, 1, 0);
  check('traits', 'hull still carries its description', (at('Legion').desc ?? '').length > 0 ? 1 : 0, 1, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 13j. CHARGE BROWSER — which charges a module offers, and in what order
//      All three of these are corrections to CCP's own filing, so nothing in the data will keep
//      them right on its own: civilian ammo sits in a group it does not belong to, cap boosters
//      are graded by a number in their name, and T2 turret ammo comes in a short/long pair that a
//      pure range sort pushes to opposite ends of the list.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nCHARGE BROWSER');
  const chargesFor = (name) => getCompatibleCharges({ typeID: tid(name), name });
  const familiesFor = (name) => groupChargesForBrowser(chargesFor(name)).map(g => g.family);
  const civ = (name) => chargesFor(name).filter(c => /^civilian\b/i.test(c.name)).length;

  // CCP files all four civilian turret ammos in group 86 "Frequency Crystal" at chargeSize 1,
  // whatever weapon they are for — so every small energy turret offered autocannon, blaster and
  // railgun ammo. Civilian Scourge Light Missile does the same to launchers.
  check('chg', 'no civilian ammo on a beam laser', civ('Small Focused Beam Laser I'), 0, 0);
  check('chg', 'no civilian ammo on a pulse laser', civ('Small Focused Pulse Laser I'), 0, 0);
  check('chg', 'no civilian ammo on a launcher', civ('Light Missile Launcher II'), 0, 0);
  // ...but a civilian MODULE keeps it. This is the difference between a rule and a blanket delete,
  // and the only module in the game that can actually load one (the four civilian turrets carry no
  // chargeGroup at all — they take no ammo).
  check('chg', 'civilian launcher keeps its civilian missile', civ('Civilian Light Missile Launcher'), 1, 0);

  // T2 turret ammo leads. One is the shortest-ranged charge in the list and the other the longest,
  // so a pure range sort put the pair at opposite ends — Gleam first, Aurora dead last.
  const beam2 = familiesFor('Small Focused Beam Laser II');
  check('chg', 'beam laser T2 crystals lead', beam2.slice(0, 2).join(',') === 'Gleam S,Aurora S' ? 1 : 0, 1, 0);
  const ac2 = familiesFor('200mm AutoCannon II');
  check('chg', 'autocannon T2 ammo leads', ac2.slice(0, 2).join(',') === 'Hail S,Barrage S' ? 1 : 0, 1, 0);
  // The range rule still governs everything after the T2 pair.
  const t1Ranges = groupChargesForBrowser(chargesFor('200mm AutoCannon II')).filter(g => !g.t2Turret).map(g => g.range);
  check('chg', 'non-T2 turret ammo still sorts by range',
        t1Ranges.every((v, i) => i === 0 || v >= t1Ranges[i - 1]) ? 1 : 0, 1, 0);

  // Missiles are ordered by DAMAGE TYPE, not range, and the T2-first rule must not reach them —
  // Fury/Precision live inside their damage family, not as families of their own.
  check('chg', 'missile damage-type order untouched',
        familiesFor('Heavy Missile Launcher II').join(',') === 'Mjolnir (EM),Inferno (Thermal),Scourge (Kinetic),Nova (Explosive)' ? 1 : 0, 1, 0);

  // Cap booster sizes are a number in the NAME, so the families sorted as strings: 100, 150, 200,
  // 3200, 25, 400, 50, 75, 800.
  const caps = groupChargesForBrowser(chargesFor('Heavy Capacitor Booster II'));
  check('chg', 'cap boosters run largest first', caps[0].family === 'Cap Booster 3200' ? 1 : 0, 1, 0);
  check('chg', 'cap boosters run smallest last', caps[caps.length - 1].family === 'Cap Booster 25' ? 1 : 0, 1, 0);
  const capSizes = caps.map(g => g.capSize);
  check('chg', 'cap booster sizes strictly descending',
        capSizes.every((v, i) => i === 0 || v < capSizes[i - 1]) ? 1 : 0, 1, 0);

  // A module that names a chargeSize takes THAT size and nothing else — eos's rule, and a charge
  // carrying no size of its own fails it rather than being treated as universal. Cap Booster 25 and
  // Navy Cap Booster 25 are the only sizeless charges in the game, and they were being offered to
  // every ancillary shield booster: an X-Large ASB listed a 149-charge clip of them, which the game
  // does not allow (400 is its smallest) and which reads as a ~900k EHP ancillary pool on the fit.
  const named = (name) => chargesFor(name).map(c => c.name).sort().join(', ');
  check('chg', 'X-Large ASB takes only its own size',
        named('X-Large Ancillary Shield Booster'),
        'Cap Booster 400, Cap Booster 800, Navy Cap Booster 400, Navy Cap Booster 800', 0);
  check('chg', 'Capital ASB takes only its own size',
        named('Capital Ancillary Shield Booster'), 'Cap Booster 3200, Navy Cap Booster 3200', 0);
  const has25 = (name) => chargesFor(name).filter(c => /Cap Booster 25$/.test(c.name)).length;
  check('chg', 'no sizeless charge on a sized ASB', has25('X-Large Ancillary Shield Booster'), 0, 0);
  // The Small ASB's chargeSize is 0, which means "unrestricted", not "size zero" — it really does
  // take a 25. Gating on `size != null` instead of `size > 0` would empty its list entirely.
  check('chg', 'Small ASB still takes the sizeless 25s', has25('Small Ancillary Shield Booster'), 2, 0);
  // Capacitor Boosters proper carry no chargeSize, so the rule must not reach them: a Heavy Cap
  // Booster loading a 25 is legal and useful.
  check('chg', 'capacitor booster unaffected', has25('Heavy Capacitor Booster II'), 2, 0);
  // Every ASB is known for a 9-charge clip; the auto-loaded default has to survive the filter.
  for (const sz of ['Small', 'Medium', 'Large', 'X-Large', 'Capital']) {
    check('chg', `${sz} ASB auto-loads 9 charges`,
          defaultChargeFor(tid(`${sz} Ancillary Shield Booster`))?.qty ?? 0, 9, 0);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 13h. MWD TARGET PROFILES — the graph's "MWD" toggle
//      TARGET_PROFILES in GraphTab.jsx carries mwdSig/mwdVel for Frigate/Cruiser/Battleship. Those
//      are DERIVED: every fittable hull in the class, given the size-appropriate T2 MWD, run active
//      at all skills V, and MEDIANED. Re-derived here so a CCP rebalance of hull signatures or
//      speeds surfaces as a failure instead of quietly making the profiles unrepresentative.
//      Tolerance is 3% — the shipped constants are rounded to the nearest 5 m / 10 m/s.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nMWD TARGET PROFILES');
  // Must match TARGET_PROFILES in src/components/GraphTab.jsx.
  const EXPECTED = {
    Frigates:    { mwd: '5MN Microwarpdrive II',   sig: 200,  vel: 3050 },
    Cruisers:    { mwd: '50MN Microwarpdrive II',  sig: 690,  vel: 1870 },
    Battleships: { mwd: '500MN Microwarpdrive II', sig: 2300, vel: 1040 },
  };
  const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const tax = buildShipTaxonomy();
  for (const [top, exp] of Object.entries(EXPECTED)) {
    const hulls = shipsUnder(nodeAtPath(tax, [top]));
    const mwdID = tid(exp.mwd);
    const sigs = [], vels = [];
    for (const h of hulls) {
      const cs = calcFitStats({ typeID: h.typeID, name: h.name },
        { high: [], mid: [{ typeID: mwdID, state: 'active' }], low: [], rigs: [] }, [], null, {});
      // A hull that cannot run the MWD would report its bare speed and drag the median; there are
      // currently none, so a shift here is itself the signal worth investigating.
      const v = cs?.maxVelocityAB ?? cs?.maxVelocity ?? 0;
      if (!cs?.sigRadius || !(v > 0)) continue;
      sigs.push(cs.sigRadius); vels.push(v);
    }
    check('mwdprof', `${top}: hull count is sane`, hulls.length === sigs.length ? 1 : 0, 1, 0);
    check('mwdprof', `${top}: median sig with MWD`, median(sigs), exp.sig, 0.03);
    check('mwdprof', `${top}: median velocity with MWD`, median(vels), exp.vel, 0.03);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 13h-2. A SAVED FIT AS THE GRAPH'S TARGET
//      targetFitProfile() reduces a saved fit to the two things the application maths asks of a
//      target — signature radius and speed — each in a prop-mod-running and a prop-mod-idle variant,
//      so a scrambler in your own fit has something real to switch off. It does NOT read resists;
//      those stay owned by Stats > Firepower.
//
//      What is actually at stake here is the STATE FORCING. calc.js only counts an ACTIVE prop mod
//      towards maxVelocityAB, and only an active microwarpdrive blooms signatureRadius — so reading
//      the fit as saved would hand back whichever variant its owner happened to leave it in, and the
//      MWD toggle would move the numbers on one saved fit and not another for no visible reason.
//      Both directions are pinned: forcing ON must lift a fit saved with its MWD idle, and forcing
//      OFF must drop one saved with it running, to the SAME pair.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nGRAPH TARGET FIT');
  const mwdID = tid('50MN Microwarpdrive II');
  const cruiser = 'Rupture';
  const mk = (state) => ({ slots: { high: [], mid: [{ typeID: mwdID, state }], low: [], rigs: [] } });
  const onSaved  = targetFitProfile(cruiser, mk('active'), null);
  const offSaved = targetFitProfile(cruiser, mk('online'), null);
  check('gtgt', 'a fit resolves to a target profile', onSaved && offSaved ? 1 : 0, 1, 0);
  // The state the fit was SAVED in must not survive into the answer.
  check('gtgt', 'saved-active and saved-idle agree on the MWD-on speed', onSaved.mwd.vel, offSaved.mwd.vel, 1e-9);
  check('gtgt', 'saved-active and saved-idle agree on the MWD-on sig',   onSaved.mwd.sig, offSaved.mwd.sig, 1e-9);
  check('gtgt', 'saved-active and saved-idle agree on the MWD-off speed', onSaved.noMwd.vel, offSaved.noMwd.vel, 1e-9);
  check('gtgt', 'saved-active and saved-idle agree on the MWD-off sig',   onSaved.noMwd.sig, offSaved.noMwd.sig, 1e-9);
  // ...and the two variants must actually differ, or the MWD toggle is a control that does nothing.
  check('gtgt', 'MWD raises speed', onSaved.mwd.vel > onSaved.noMwd.vel * 3 ? 1 : 0, 1, 0);
  check('gtgt', 'MWD blooms signature', onSaved.mwd.sig > onSaved.noMwd.sig * 3 ? 1 : 0, 1, 0);
  check('gtgt', 'hasProp is set', onSaved.hasProp ? 1 : 0, 1, 0);
  // The MWD-off pair is the BARE HULL, which is a number CCP publishes — so this is an absolute
  // baseline, not a self-consistency check that would survive the whole function being wrong.
  const bare = calcFitStats({ typeID: tid(cruiser), name: cruiser },
                            { high: [], mid: [], low: [], rigs: [] }, [], null, {});
  check('gtgt', 'MWD-off speed is the bare hull', onSaved.noMwd.vel, Math.round(bare.maxVelocity), 1e-9);
  check('gtgt', 'MWD-off sig is the bare hull',   onSaved.noMwd.sig, bare.sigRadius, 1e-9);
  // A fit with no prop mod at all: both variants collapse, and hasProp says so rather than leaving
  // the UI offering a toggle that silently changes nothing.
  const noProp = targetFitProfile(cruiser, { slots: { high: [], mid: [], low: [], rigs: [] } }, null);
  check('gtgt', 'no prop mod: hasProp is false', noProp.hasProp ? 1 : 0, 0, 0);
  check('gtgt', 'no prop mod: the two variants collapse', noProp.mwd.vel, noProp.noMwd.vel, 1e-9);
  // Nonsense in, null out — the caller renders the reference as stale instead of crashing the graph.
  check('gtgt', 'an unknown ship yields null', targetFitProfile('Not A Ship', mk('active'), null) === null ? 1 : 0, 1, 0);
  check('gtgt', 'a fit with no slots yields null', targetFitProfile(cruiser, {}, null) === null ? 1 : 0, 1, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 13h-3. FIT PICKER ORDER — the flat "pick a fit" lists, sorted most-recent-first
//      The target-fit / projection / command pickers flatten every hull's fits into one list, where
//      `fitsDB`'s object key order is whichever hull first had a fit saved to it and means nothing.
//      Two hazards the comparator has to survive, both already documented in RecentFitsList: the
//      field is a display STRING, and it is DAY-GRANULAR so today's fits all tie.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nFIT PICKER ORDER');
  const F = (ship, name, modified) => ({ ship, fit: { name, modified } });
  const order = rows => rows.slice().sort(byRecentlyModified).map(r => r.fit.name).join(',');

  // Newest first, across hulls — the whole point of flattening the list.
  check('order', 'most recently modified comes first',
        order([F('Rifter', 'old', 'Jan 3, 2026'), F('Caracal', 'new', 'Aug 6, 2026'),
               F('Rupture', 'mid', 'May 1, 2026')]), 'new,mid,old');
  // A month name is not a number: sorting the raw strings puts "Aug" before "Jan" before "May", which
  // is alphabetical and looks plausible enough to ship. This is the same date set, and the expected
  // order is the one only a real parse produces.
  check('order', 'the dates are parsed, not compared as text',
        order([F('A', 'jan', 'Jan 3, 2026'), F('B', 'aug', 'Aug 6, 2026'), F('C', 'may', 'May 1, 2026')]),
        'aug,may,jan');
  // Same day is the COMMON case — a session's worth of edits all carry today's date. Falling back to
  // the name keeps the list stable instead of leaving it in the arbitrary order the sort replaced.
  check('order', 'same-day fits fall back to name',
        order([F('X', 'zulu', 'Aug 6, 2026'), F('Y', 'alpha', 'Aug 6, 2026'), F('Z', 'mike', 'Aug 6, 2026')]),
        'alpha,mike,zulu');
  // An old backup or a pre-tags fit has nothing usable here. Sorting it to the bottom is a choice:
  // treated as 0 it would parse as 1970 — no, worse, `Date.parse(undefined)` is NaN and a NaN
  // comparator return leaves the array in whatever order the engine's sort happened to visit.
  // Named so the ALPHABETICAL order is the wrong one: if the parse returns NaN the subtraction is
  // NaN, `if (d)` treats that as falsy, and the undated fit rides the name tiebreak to the top —
  // passing a check whose undated row happened to sort late by name anyway.
  check('order', 'an undated fit sorts last',
        order([F('A', 'aaa-undated', undefined), F('B', 'zzz-dated', 'Jan 3, 2026')]), 'zzz-dated,aaa-undated');
  check('order', 'an unparseable date sorts last',
        order([F('A', 'aaa-junk', 'sometime last tuesday'), F('B', 'zzz-dated', 'Jan 3, 2026')]), 'zzz-dated,aaa-junk');
  check('order', 'undated fits still order among themselves',
        order([F('A', 'beta', null), F('B', 'alpha', null)]), 'alpha,beta');

  // ESI's fittings payload carries NO timestamp — CCP's schema is exactly {description, fitting_id,
  // items, name, ship_type_id} — so Import from EVE orders by the id, which the server assigns on
  // save and which ascends. Verified against https://esi.evetech.net/meta/openapi.json.
  const ids = rows => rows.slice().sort(byNewestFitting).map(r => String(r.fitting_id)).join(',');
  check('order', 'ESI fittings list newest save first', ids([{fitting_id:3},{fitting_id:9},{fitting_id:5}]), '9,5,3');
  check('order', 'a fitting with no id sorts last', ids([{fitting_id:2},{name:'x'}]), '2,undefined');
}

// ─────────────────────────────────────────────────────────────────────────────
// 13i. WARP SCRAMBLERS vs DISRUPTORS — the damage graph applies your own ewar to the target
//      The graph shuts the target's MWD off inside scrambler range, so it needs to know which of
//      your tackle modules actually blocks a prop mod. CCP files scramblers AND disruptors under
//      groupName 'Warp Scrambler', so the group cannot tell them apart and neither can the name.
//      `activationBlockedStrenght` (CCP's spelling) is the attribute that does the blocking and is
//      absent on a disruptor — that is the discriminator, and this pins it.
//
//      Range must be ENGINE-computed, not the module's base 9 km: the Mordu's hulls are the whole
//      reason a scram reaches far enough for this to change a graph, and a hardcoded 9000 would
//      silently draw the Orthrus's own signature trick out of existence.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nWARP SCRAMBLERS (damage graph tackle)');
  const mid = (n, state = 'active') => ({ typeID: tid(n), name: n, state });
  const scramsOf = (shipName, mods) => computeProjectedReps(
    { typeID: tid(shipName), name: shipName },
    { high: [], mid: mods, low: [], rigs: [] }, null, {}).scrams;

  check('scram', 'a scrambler is collected', scramsOf('Orthrus', [mid('Warp Scrambler II')]).length, 1, 0);
  check('scram', 'a DISRUPTOR is not', scramsOf('Orthrus', [mid('Warp Disruptor II')]).length, 0, 0);
  check('scram', 'an offline scrambler is not', scramsOf('Orthrus', [mid('Warp Scrambler II', 'offline')]).length, 0, 0);
  // 9 km base × the Orthrus's 1.5 warp-scrambler range bonus at all V.
  check('scram', 'Orthrus scram range is hull-bonused', scramsOf('Orthrus', [mid('Warp Scrambler II')])[0].optimal, 13500, 1e-9);
  check('scram', 'an unbonused hull gets the base range', scramsOf('Rifter', [mid('Warp Scrambler II')])[0].optimal, 9000, 1e-9);
  // Tackle is hard-edged: full strength to maxRange, nothing past it. A falloff would smear the
  // MWD-off transition the graph draws as a step.
  check('scram', 'tackle carries no falloff', scramsOf('Rifter', [mid('Warp Scrambler II')])[0].falloff, 0, 0);
  {
    // The new branch sits in the same if/else chain as webs and painters, so it is exactly the
    // shape of edit that can swallow a neighbour. All three still come back from one fit.
    const r = computeProjectedReps({ typeID: tid('Orthrus'), name: 'Orthrus' },
      { high: [], mid: [mid('Warp Scrambler II'), mid('Stasis Webifier II'), mid('Target Painter II')], low: [], rigs: [] }, null, {});
    check('scram', 'webs and painters survive alongside it',
          r.scrams.length === 1 && r.webs.length === 1 && r.painters.length === 1 ? 1 : 0, 1, 0);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 13g. MIXED CAP-FREE / CAP-USING SHIELD BOOSTERS — sustained tank
//      A Phoenix Navy Issue carrying a Capital Ancillary Shield Booster on cap booster charges
//      (cap-FREE) alongside a CONCORD Capital Shield Booster (cap-HUNGRY), on a fit that is not cap
//      stable. The sustained EHP/s used to be forced equal to peak whenever ANY ancillary booster
//      ran on charges, which declared the cap-hungry booster sustainable too — and because the UI
//      only shows the sustained row when it is BELOW peak, the row disappeared on exactly the fits
//      that need it. Baseline read from pyfa v2.68.0, all skills V.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nMIXED SHIELD BOOSTERS (sustained tank)');
  const pni = { typeID: tid('Phoenix Navy Issue'), name: 'Phoenix Navy Issue' };
  const slots = {
    low: [M('Caldari Navy Ballistic Control System', 'online'), M('Caldari Navy Ballistic Control System', 'online'),
          M('Caldari Navy Ballistic Control System', 'online'), M('Damage Control II', 'online'),
          M('Dread Guristas Co-Processor', 'online')],
    mid: [M('CONCORD Capital Shield Booster', 'active'),
          M('Dread Guristas Multispectrum Shield Hardener', 'active'), M('Dread Guristas Multispectrum Shield Hardener', 'active'),
          M('Gist X-Type Shield Boost Amplifier', 'online'), M('Republic Fleet Target Painter', 'active'),
          M('Capital Ancillary Shield Booster', 'active', 'Navy Cap Booster 3200'),
          M('Capital Capacitor Booster II', 'active', 'Navy Cap Booster 3200'),
          M('Missile Guidance Computer II', 'active', 'Missile Range Script')],
    high: [M("'YF-12a' Compact Large Plasma Smartbomb", 'active'), M('Siege Module II', 'active'),
           M('Rapid Torpedo Launcher II', 'active', 'Inferno Javelin Torpedo'),
           M('Rapid Torpedo Launcher II', 'active', 'Mjolnir Javelin Torpedo'),
           M('Rapid Torpedo Launcher II', 'active', 'Nova Javelin Torpedo')],
    rigs: [M('Capital EM Shield Reinforcer I', 'online'), M('Capital Warhead Flare Catalyst I', 'online'),
           M('Capital Warhead Rigor Catalyst I', 'online')],
  };
  const cs = calcFitStats(pni, slots, [], null, {});
  // NB: check()'s tolerance is RELATIVE, so 1e-5 here is ±0.001%, not ±1e-5 absolute. Loose enough
  // to absorb the 1-decimal rounding these baselines were read at, tight enough to actually pin them.
  const TOL = 1e-5;
  check('pni', 'not cap stable (precondition)', cs.capStable ? 1 : 0, 0, 0);
  check('pni', 'peak shield boost EHP/s', cs.shieldRepEhpS, 63773.5, TOL);
  check('pni', 'SUSTAINED shield boost EHP/s (pyfa 53136.1)', cs.shieldRepSustainedEhpS, 53136.1, TOL);
  // Sustained must be strictly below peak, or the UI hides the row — the actual reported symptom.
  check('pni', 'sustained is below peak, so the row renders', cs.shieldRepSustainedEhpS < cs.shieldRepEhpS - 0.05 ? 1 : 0, 1, 0);
  // The cap-FREE ancillary booster keeps its full rep; only the cap-using CONCORD booster is
  // throttled. Asserting the split, not just the total, is what distinguishes a correct model from
  // a ratio that happens to land on the right number.
  check('pni', 'raw peak shield rep HP/s', cs.shieldRepPS, 12830.6, TOL);
  check('pni', 'raw sustained shield rep HP/s', cs.sustainedShieldRepPS, 10690.4, TOL);
}

// ─────────────────────────────────────────────────────────────────────────────
// 13f. ATTRIBUTE DIRECTION — which way is "better", for the abyssal editor's delta colouring
//      Green in the mutaplasmid editor means BETTER, not BIGGER, and the direction comes from CCP's
//      own `highIsGood` (dgmattribs -> `h`) rather than a list of ours. These pin the cases where
//      bigger is WORSE, because those are the ones a hand-written list would miss and because an
//      eve.db upgrade could silently flip one.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nATTRIBUTE DIRECTION');
  const AID_OF = { capacitorNeed: 6, cpu: 50, power: 30, duration: 73, reloadTime: 1795,
                   signatureRadiusBonus: 554, signatureRadiusAdd: 983, massAddition: 796,
                   hullEmDamageResonance: 974, siegeLocalLogisticsDurationBonus: 2346,
                   speedMultiplier: 204,
                   damageMultiplier: 64, armorHP: 265, maxVelocity: 37, maxRange: 54,
                   trackingSpeed: 160, shieldBonus: 68, falloff: 158 };
  const lower = ['capacitorNeed', 'cpu', 'power', 'duration', 'reloadTime', 'signatureRadiusBonus',
                 'signatureRadiusAdd', 'massAddition', 'hullEmDamageResonance',
                 'siegeLocalLogisticsDurationBonus', 'speedMultiplier'];
  const higher = ['damageMultiplier', 'armorHP', 'maxVelocity', 'maxRange', 'trackingSpeed',
                  'shieldBonus', 'falloff'];
  for (const n of lower)  check('attrdir', `${n}: lower is better`,  attrHighIsGood(AID_OF[n]) ? 1 : 0, 0, 0);
  for (const n of higher) check('attrdir', `${n}: higher is better`, attrHighIsGood(AID_OF[n]) ? 1 : 0, 1, 0);
  // An attribute the bundle has never heard of must not crash the readout, and defaults to the
  // majority case (bigger is better) — which is what the editor assumed before the flag was used.
  check('attrdir', 'unknown attribute defaults to higher-is-better', attrHighIsGood(999999) ? 1 : 0, 1, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 13m. BASE DETENT — the mutaplasmid editor's sliders snap onto the unrolled base
//      The slider steps in 400ths, so landing exactly on the base by dragging is luck, and Revert
//      is all-or-nothing; the detent is how ONE attribute goes back. The two things worth pinning
//      are the ones real mutaplasmid data can break on an eve.db upgrade: a detent so wide it
//      swallows an endpoint (that end of the slider becomes undraggable), and the 138 ranges whose
//      base is not on the slider at all.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nMUTAPLASMID BASE DETENT');
  check('detent', 'the base itself is unchanged', snapToBase(10, 10, 5, 15), 10, 0);
  check('detent', 'just inside the zone snaps to base', snapToBase(10.19, 10, 5, 15), 10, 0);
  check('detent', 'just outside the zone is left alone', snapToBase(10.21, 10, 5, 15), 10.21, 1e-9);
  check('detent', 'below the base snaps up to it', snapToBase(9.81, 10, 5, 15), 10, 0);
  // A mutaplasmid that can only make an attribute worse leaves the base off the track entirely.
  check('detent', 'a base off the track never snaps', snapToBase(7, 5, 7, 9), 7, 0);
  // Degenerate range: no span, so nothing to measure a proportion against — must not snap or NaN.
  check('detent', 'a zero-width range never snaps', snapToBase(4, 4.5, 4, 4), 4, 0);

  // Property sweep over every (mutaplasmid, base type, attribute) the game actually ships.
  let offTrack = 0, endSwallowed = 0, stepEscapes = 0, seen = 0, backwards = 0;
  const negBase = new Map();
  const done = new Set();
  for (const [baseTid, mids] of Object.entries(MUTA_BY_TYPE))
    for (const mid of mids)
      for (const r of mutaAttrRanges(mid, baseTid)) {
        const k = `${mid}:${baseTid}:${r.name}`;
        if (done.has(k)) continue;
        done.add(k);
        const span = r.max - r.min;
        // `lo`/`hi` are multipliers and only order the result while the base is positive, so a
        // negative base (webifier speedFactor, cap battery energyWarfareResistanceBonus) used to
        // hand back max < min. An <input type=range> clamps that to a single point per spec, which
        // killed the slider silently — the typed box still worked, so nothing read as broken.
        if (span < 0) backwards++;
        if (!(span > 0)) continue;
        seen++;
        if (r.base < 0) negBase.set(r.name, (negBase.get(r.name) ?? 0) + 1);
        if (r.base < r.min || r.base > r.max) {
          offTrack++;
          // Off the track, the detent must be inert — otherwise a drag jumps to a value the
          // mutaplasmid cannot produce.
          if (snapToBase(r.min, r.base, r.min, r.max) !== r.min) endSwallowed++;
          continue;
        }
        // An endpoint must stay draggable. `base === min` (633 ranges — the mutaplasmid only
        // improves the attribute) is fine: the detent and the endpoint are the same value.
        for (const end of [r.min, r.max])
          if (end !== r.base && snapToBase(end, r.base, r.min, r.max) === r.base) endSwallowed++;
        // ...and the detent must be wider than the slider's own step, or it can be stepped over.
        if (snapToBase(r.base + span / 400, r.base, r.min, r.max) !== r.base) stepEscapes++;
      }
  check('detent', 'every mutaplasmid range was swept', seen > 20000 ? 1 : 0, 1, 0);
  check('detent', 'no range comes back min-above-max', backwards, 0, 0);
  check('detent', 'no slider endpoint is swallowed', endSwallowed, 0, 0);
  check('detent', 'one step off base always snaps back', stepEscapes, 0, 0);
  check('detent', 'ranges with the base off the track', offTrack, 138, 0);

  // A NEGATIVE base is what tells the editor to draw that slider mirrored: the attribute's MAGNITUDE
  // is its strength, so in raw ascending order the strong end lands on the left. Only three families
  // are stored that way, and the rule is applied per-RANGE rather than per-attribute name because
  // `speedFactor` is in both camps — a webifier's is -60, a microwarpdrive's is +500, and mirroring
  // the MWD too would put its fast end on the left.
  //
  // Pinned as an exact set so a bundle regen that adds a fourth family, or flips one of these
  // positive, surfaces here instead of as a silently backwards slider. Sorted for stability.
  check('detent', 'attributes whose base is stored negative', [...negBase.keys()].sort().join(','),
    'energyWarfareResistanceBonus,siegeLocalLogisticsDurationBonus,speedFactor', 0);
  // ...and the MWD side of that split really is present, or the per-range test is untested.
  const mwdSpeed = mutaAttrRanges(MUTA_BY_TYPE[tid('50MN Microwarpdrive II')]?.[0], tid('50MN Microwarpdrive II'))
    .find((r) => r.name === 'speedFactor');
  check('detent', 'a microwarpdrive keeps a positive speedFactor base', mwdSpeed?.base > 0 ? 1 : 0, 1, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 13n. IMPLANT SETS — the "+ Set" button, which shipped doing nothing at all
//      Both entry points (the cross-slot search and the per-slot picker) route through one handler,
//      and that handler was written `set => fitSet(set)` — a const arrow calling itself. Every press
//      blew the stack. It was invisible because the whole feature lived inside a component and had
//      no coverage; the mapping is now a pure function in core.js, which is what these check.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nIMPLANT SETS');
  const emptyRows = () => Array.from({ length: 10 }, (_, i) => ({ slot: i + 1, name: '[Empty]', bonus: null }));
  const snake = implantSetMembers('High-grade Snake Alpha');
  check('implantset', 'a member resolves its whole set', snake?.members.length ?? 0, 6, 0);
  check('implantset', 'the set is named without the Greek letter', snake?.setName, 'High-grade Snake', 0);
  // Any member finds the same set, not just Alpha — the row that carries the button is whichever one
  // the search happened to return.
  check('implantset', 'Omega resolves the same set as Alpha',
    implantSetMembers('High-grade Snake Omega')?.setName, 'High-grade Snake', 0);
  check('implantset', 'a non-set implant offers no set', implantSetMembers('Ocular Filter - Basic') === null ? 1 : 0, 1, 0);

  // The bug itself: this call used to recurse until the stack gave out.
  const fitted = applyImplantSet(emptyRows(), snake);
  check('implantset', 'fitting a set fills its six slots',
    fitted.filter((i) => i.name !== '[Empty]').length, 6, 0);
  check('implantset', 'every slot lands the right member',
    fitted.slice(0, 6).every((i, n) => i.name === snake.members[n].name) ? 1 : 0, 1, 0);
  check('implantset', 'the hardwiring slots are left alone',
    fitted.slice(6).every((i) => i.name === '[Empty]') ? 1 : 0, 1, 0);
  check('implantset', 'the list keeps its ten slots in order',
    fitted.map((i) => i.slot).join(',') , '1,2,3,4,5,6,7,8,9,10', 0);

  // A set overwrites the attribute enhancers it covers but must not touch a hardwiring the user
  // fitted by hand — the two occupy disjoint slots and a set only ever claims 1-6.
  const withHardwiring = emptyRows().map((i) => (i.slot === 8 ? { ...i, name: 'Zainou Deadeye' } : i));
  check('implantset', 'a hand-fitted hardwiring survives a set',
    applyImplantSet(withHardwiring, snake)[7].name, 'Zainou Deadeye', 0);
  // Swapping one set for another replaces all six rather than merging the two.
  const swapped = applyImplantSet(fitted, implantSetMembers('High-grade Crystal Alpha'));
  check('implantset', 'a second set replaces the first',
    swapped.slice(0, 6).filter((i) => i.name.includes('Snake')).length, 0, 0);
  // Purity: React state is compared by reference, so mutating in place would fit the set and then
  // fail to redraw it.
  const before = emptyRows();
  applyImplantSet(before, snake);
  check('implantset', 'the input list is not mutated', before[0].name, '[Empty]', 0);

  // Sweep every set the game ships, so a bundle regen that renames a grade or drops a member shows
  // up here rather than as a "+ Set" that half-fills the slots.
  let badSets = 0, seenSets = new Set();
  for (const [name] of IMPLANT_NAME_TO_SLOT) {
    const set = implantSetMembers(name);
    if (!set || seenSets.has(set.setName)) continue;
    seenSets.add(set.setName);
    const out = applyImplantSet(emptyRows(), set);
    // Each member must land in exactly the slot the data gave it, and nothing may be left over.
    if (out.filter((i) => i.name !== '[Empty]').length !== set.members.length) badSets++;
    if (!set.members.every((m) => out[m.slot - 1].name === m.name)) badSets++;
  }
  check('implantset', 'every implant set in the bundle', seenSets.size, 55, 0);
  check('implantset', 'every set fits cleanly into its slots', badSets, 0, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 13e. IDEAL TARGET PROFILE — perfect damage application
//      The graph's "Ideal" preset is a stationary target with an effectively infinite signature
//      (IDEAL_SIG in GraphTab.jsx), rather than a short-circuit branch that skipped the application
//      math. That branch ignored its tgtSig argument, so the "Target sig. radius" X axis drew a flat
//      line whenever Ideal was selected. These checks pin the two things that make the replacement
//      safe: every ship applies FULL damage at IDEAL_SIG regardless of either ship's speed, and the
//      result is bit-identical to the branch that was removed.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nIDEAL TARGET PROFILE');
  const IDEAL_SIG = 1e15;   // must match GraphTab.jsx
  // The deleted branch, verbatim: range falloff only, no tracking term.
  const perfect = (w, d) => calcTurretMult(w.falloff > 0
    ? Math.pow(0.5, Math.pow(Math.max(0, d - w.optimal) / w.falloff, 2))
    : (d <= w.optimal ? 1 : 0));
  const real = (w, d, atkSpeed, tgtSpeed) => calcTurretMult(calcTurretCTH({
    atkSpeed, atkAngle: 90, atkRadius: 120, optimal: w.optimal, falloff: w.falloff,
    tracking: w.tracking, optimalSigRadius: w.optimalSigRadius, distance: d,
    tgtSpeed, tgtAngle: 90, tgtRadius: 0, tgtSig: IDEAL_SIG }));
  // Worst tracking in the game (beam) and a short-range brawler, at every interesting distance,
  // with both ships stationary and both at speed.
  const guns = [
    { optimal: 78000, falloff: 24000, tracking: 0.0021, optimalSigRadius: 400 },  // Dual Giga Beam II
    { optimal:  9000, falloff: 12500, tracking: 0.0189, optimalSigRadius: 400 },  // Neutron Blaster II
    { optimal:   900, falloff:  5000, tracking: 0.396,  optimalSigRadius:  40 },  // 125mm Gatling II
    { optimal: 20000, falloff:     0, tracking: 0.02,   optimalSigRadius: 400 },  // no-falloff case
  ];
  let worstDelta = 0;
  for (const w of guns)
    for (const d of [0, 1, 1000, 9000, 20000, 80000, 150000])
      for (const [a, t] of [[0, 0], [500, 0], [0, 5000], [900, 1400]])
        worstDelta = Math.max(worstDelta, Math.abs(perfect(w, d) - real(w, d, a, t)));
  check('ideal', 'IDEAL_SIG reproduces perfect application exactly', worstDelta, 0, 0);
  // Inside optimal a turret applies slightly MORE than paper DPS — wrecking shots. Not a bug.
  check('ideal', 'in-optimal turret multiplier (wrecking shots)', calcTurretMult(1), 1.01505, 1e-9);
  // Missiles: the explosion-radius and explosion-velocity terms both pin at 1, at any target speed.
  let worstMissile = 0;
  for (const m of [[100, 69, 5.3], [450, 71, 5.55], [40, 170, 4.6]])
    for (const v of [0, 100, 500, 1400, 5000])
      worstMissile = Math.max(worstMissile, Math.abs(1 - calcMissileFactor(m[0], m[1], m[2], v, IDEAL_SIG)));
  check('ideal', 'missiles apply fully at IDEAL_SIG, any target speed', worstMissile, 0, 0);
  // And the sig axis is not degenerate: a small target must still be mitigated, or the axis is
  // decorative. This is what the removed branch got wrong.
  check('ideal', 'a 40m frigate still mitigates a torpedo', calcMissileFactor(450, 71, 5.55, 0, 40) < 0.1 ? 1 : 0, 1, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 13c-2. VECTOR COMPASS FRAME — the two heading wheels share ONE frame
//      Transversal is a single subtraction across one axis, so an attacker angle and a target angle
//      only mean anything measured the same way round. The Target wheel used to draw its zero at its
//      own enemy marker, 180 deg out of the frame its number is read in, so two arrows aligned on
//      screen — a stern chase — computed as a head-on pass.
//
//      The wheels live in JSX the suite cannot import, so what is pinned here is the property the
//      drawing has to express: same heading and same speed is zero transversal, and a 180 deg flip of
//      one side is emphatically not free. If the second group ever reads zero, the two wheels can be
//      drawn in opposite frames again without anything noticing.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nVECTOR COMPASS FRAME');
  const D = { r: 0, dist: 1000 };
  const ang = (aSpd, aDeg, tSpd, tDeg) => calcAngularSpeed(aSpd, aDeg, D.r, D.dist, tSpd, tDeg, D.r);
  // Parallel flight, any heading: the sin terms are identical and cancel exactly.
  let worstParallel = 0;
  for (const a of [0, 37, 90, 151, 204, 270, 342])
    worstParallel = Math.max(worstParallel, ang(1000, a, 1000, a));
  check('vec', 'equal heading + equal speed = no transversal', worstParallel, 0, 0);
  // Head-on across the line of sight: the components oppose and add up.
  check('vec', 'opposed beam runs add up', ang(1000, 90, 1000, 270), 2, 1e-9);
  // The bug, stated as a number: reading one wheel 180 deg out turns the user's own low-transversal
  // pair into a near-worst-case one. 204 deg is the heading off the report that found this.
  check('vec', 'flipping one wheel 180 deg is not free', ang(1000, 204, 1000, 204 + 180), 2 * Math.abs(Math.sin(204 * Math.PI / 180)), 1e-9);
  // Radial flight contributes nothing from either side — the frame's zero is along the line of sight.
  check('vec', 'closing head-on has no transversal', ang(5000, 0, 5000, 0), 0, 0);
  check('vec', 'a stern chase has no transversal', ang(5000, 180, 5000, 180), 0, 0);
  // pyfa's _calcAngularSpeed, hand-evaluated: |2000·sin(30) − 500·sin(150)| / (100 + 1000 + 50).
  check('vec', 'matches pyfa\'s angular speed', calcAngularSpeed(2000, 30, 100, 1000, 500, 150, 50), 750 / 1150, 1e-9);
}

// ─────────────────────────────────────────────────────────────────────────────
// 13d. RESOURCE NUMBER FORMATTING — the resource strip's CPU/PG/Cal readouts
//      The first four rows are pyfa's own renderings, read off its fitting panel; the point of
//      four SIGNIFICANT digits rather than a fixed decimal count is that 19678 and 20843 stay
//      distinguishable, which a blanket .toFixed(1) ("19.7k"/"20.8k") loses.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nRESOURCE FORMATTING');
  const f = (v, e) => check('fmt', `${v} -> ${e}`, fmtResource(v) === e ? 1 : 0, 1, 0, fmtResource(v));
  f(1362.0, '1.362k');
  f(1363.8, '1.364k');
  f(19678.0, '19.68k');
  f(20843.8, '20.84k');
  f(595.25, '595.3');       // still four digits when there is room for the decimal
  f(400, '400');            // a round total drops its trailing zeros
  f(0, '0');
  f(5000, '5k');
  f(1.5, '1.5');
  f(999960, '1M');          // rounding must promote the unit, not render "1000k"
  f(2_500_000, '2.5M');
  f(NaN, '0');
}

// ─────────────────────────────────────────────────────────────────────────────
// 13c. HARDPOINT CLASSIFICATION — the resource strip's turret/launcher dots
//      Hardpoint usage is CCP's turretFitted (42) / launcherFitted (40) marker effects and nothing
//      else — the rule pyfa's Module.__calculateHardpoint uses. Group names and weapon class are
//      NOT the signal, and each wrong guess cost a real slot: a hand-written list of three turret
//      groups let an entropic disintegrator use no turret hardpoint on a Vedmak, and "is a missile
//      weapon" (effect 101 useMissiles) gave a Scan Probe Launcher a launcher hardpoint on a Legion.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nHARDPOINTS');
  const eff = (n) => TYPES[tid(n)]?.e;
  const turret = (n) => usesTurretHardpoint(eff(n)) ? 1 : 0;
  const launcher = (n) => usesLauncherHardpoint(eff(n)) ? 1 : 0;
  check('hardpt', 'entropic disintegrator is a turret', turret('Heavy Entropic Disintegrator II'), 1, 0);
  check('hardpt', 'mining laser is a turret', turret('Miner II'), 1, 0);
  check('hardpt', 'hybrid is a turret', turret('Neutron Blaster Cannon II'), 1, 0);
  check('hardpt', 'energy is a turret', turret('Dual Giga Beam Laser II'), 1, 0);
  check('hardpt', 'projectile is a turret', turret('800mm Repeating Cannon II'), 1, 0);
  check('hardpt', 'a launcher is NOT a turret', turret('Heavy Missile Launcher II'), 0, 0);
  check('hardpt', 'ship launcher counts as a launcher', launcher('Heavy Missile Launcher II'), 1, 0);
  // CCP names structure launcher groups "Structure <kind> Missile Launcher", so a "Missile Launcher"
  // prefix test misses them — the marker effect catches them anyway.
  check('hardpt', 'structure launcher counts as a launcher', launcher('Standup Multirole Missile Launcher I'), 1, 0);
  // The three that carry useMissiles but NO launcherFitted. Probe launchers were the reported bug;
  // bomb and defender launchers are the same mistake wearing a "Missile Launcher" group name.
  check('hardpt', 'scan probe launcher uses NO launcher hardpoint', launcher('Expanded Probe Launcher II'), 0, 0);
  check('hardpt', 'survey probe launcher uses NO launcher hardpoint', launcher('Survey Probe Launcher II'), 0, 0);
  check('hardpt', 'bomb launcher uses NO launcher hardpoint', launcher('Bomb Launcher I'), 0, 0);
  check('hardpt', 'defender launcher uses NO launcher hardpoint', launcher('Defender Launcher I'), 0, 0);
  check('hardpt', 'a probe launcher is not a turret either', turret('Expanded Probe Launcher II'), 0, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 13a. FIT TAB IDENTITY — duplicate tabs / several tabs highlighted at once
//      One fit with no `id` poisoned the nextId reducer to NaN (Math.max(m, undefined + 1)), and
//      NaN is sticky, so every fit created afterwards carried id NaN. The tab dedupe then used
//      `t.id != null`, which is TRUE for NaN, and NaN === NaN is FALSE — so a fit never matched its
//      own tab and every open appended another copy. All the copies share a name, and the strip
//      marks a tab active by ship+name, so they all lit up together.
//
//      Pure logic, so it is checked directly rather than through the React tree.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nFIT TAB IDENTITY');
  // The nextId reducer, as FittingsScreen computes it.
  const nextId = (db) => Object.values(db).flat().map((f) => f?.id)
    .filter((id) => Number.isFinite(id)).reduce((m, id) => Math.max(m, id + 1), 20);
  check('tabs', 'a fit with no id cannot poison nextId', nextId({ A: [{ id: 3 }, { name: 'no id' }] }), 20, 0);
  check('tabs', 'nextId still advances past the highest id', nextId({ A: [{ id: 41 }, { id: 7 }] }), 42, 0);

  // The dedupe predicate from loadFit.
  const sameTab = (t, fit, fitName) =>
    Number.isFinite(t.id) && Number.isFinite(fit.id) ? t.id === fit.id : t.name === fitName;
  const nanFit = { id: NaN, name: 'My Fit' };
  let tabs = [];
  for (let i = 0; i < 5; i++) if (!tabs.some((t) => sameTab(t, nanFit, 'My Fit'))) tabs.push({ id: nanFit.id, name: 'My Fit' });
  check('tabs', 'opening a NaN-id fit 5x makes ONE tab', tabs.length, 1, 0);
  // A finite id must still win over the name, so renaming a fit keeps its single tab.
  check('tabs', 'a renamed fit still matches by id',
        sameTab({ id: 7, name: 'Old Name' }, { id: 7, name: 'New Name' }, 'New Name') ? 1 : 0, 1, 0);
  // ...and two different fits must never collapse into one tab.
  check('tabs', 'different fits stay distinct',
        sameTab({ id: 7, name: 'A' }, { id: 8, name: 'B' }, 'B') ? 1 : 0, 0, 0);

  // resolveTabs heals a strip that was already corrupted and persisted.
  const db = { Rifter: [{ id: NaN, name: 'My Fit' }] };
  const stored = Array.from({ length: 6 }, () => ({ ship: 'Rifter', id: NaN, name: 'My Fit' }));
  check('tabs', 'a saved duplicate strip collapses on load', resolveTabs(stored, db).length, 1, 0);

  // Restoring a backup allocated fit ids PER SHIP, so the first fit of every ship got id 1. Harmless
  // in every per-ship list, fatal in the one place that flattens the DB: the projected/command fit
  // pickers key their rows on fit.id, and duplicate React keys stopped the list re-rendering when
  // the search box was typed into — the reported "search does nothing in the app". The counter is
  // DB-wide now, so a flattened view can rely on ids being unique.
  const { mergeFitsDB } = await import('./lib/backup-io.js');
  const restored = JSON.parse(mergeFitsDB('{}', JSON.stringify({
    Rifter: [{ name: 'a' }, { name: 'b' }],
    Orthrus: [{ name: 'c' }],
    Drake: [{ name: 'd' }, { name: 'e' }],
  })));
  const ids = Object.values(restored).flat().map((f) => f.id);
  check('tabs', 'restored fits get ids unique across SHIPS', new Set(ids).size, ids.length, 0);
  // Merging a second backup must not reissue ids the first one already used.
  const twice = JSON.parse(mergeFitsDB(JSON.stringify(restored), JSON.stringify({ Orthrus: [{ name: 'f' }] })));
  const ids2 = Object.values(twice).flat().map((f) => f.id);
  check('tabs', 'a second restore keeps ids unique', new Set(ids2).size, ids2.length, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 13d. EFT IMPORT — Discord code fences
//      A fit pasted out of Discord arrives wrapped in ```. Stripping whole fence LINES was not
//      enough on a phone: a fence sharing the header's line, a single-backtick wrap, or a blank
//      line between the fence and the header all left the import failing, because the header was
//      read from index 0 specifically. Backticks now come off both ends of every line and the
//      header is SEARCHED for. Each case here is a paste shape that used to need hand-editing.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nEFT CODE FENCES');
  const BODY = '[Legion, Test]\nHeat Sink II\n';
  const F = '```';
  const ok = (eft) => { const r = parseEFT(eft); return r.error ? 0 : (r.shipName === 'Legion' && r.mods.length === 1 ? 1 : 0); };
  check('eft', 'unfenced still imports',            ok(BODY), 1, 0);
  check('eft', 'plain fence',                       ok(`${F}\n${BODY}${F}`), 1, 0);
  check('eft', 'fence with a language tag',         ok(`${F}eft\n${BODY}${F}`), 1, 0);
  check('eft', 'blank line before the fence',       ok(`\n${F}\n${BODY}${F}`), 1, 0);
  check('eft', 'blank line after the fence',        ok(`${F}\n\n${BODY}${F}`), 1, 0);
  check('eft', 'fence on the header line',          ok(`${F}[Legion, Test]\nHeat Sink II\n${F}`), 1, 0);
  check('eft', 'fence closing the last line',       ok(`${F}[Legion, Test]\nHeat Sink II${F}`), 1, 0);
  check('eft', 'single-backtick inline wrap',       ok('`' + BODY + '`'), 1, 0);
  check('eft', 'CRLF inside a fence',               ok(`${F}\r\n[Legion, Test]\r\nHeat Sink II\r\n${F}`), 1, 0);
  check('eft', 'chat prose above the fit',          ok(`someone: try this\n${F}\n${BODY}${F}`), 1, 0);
  // ...and it must still REJECT, or every check above passes on a parser that accepts anything.
  check('eft', 'non-fit text is still rejected',    ok('hello there'), 0, 0);
  check('eft', 'empty text is still rejected',      ok(''), 0, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 13b. SPOOL-UP (entropic disintegrators, Mutadaptive remote reps)
//      The damage/reps-over-time graphs draw a RAMP, so the spool numbers feeding them have to be
//      right or the curve is decoration. eos's calculateSpoolup (SpoolType.CYCLES) is the rule:
//      after N COMPLETED cycles the bonus is min(max, N * step) — so the first shot lands unspooled
//      and the cap is first reached on the shot fired after ceil(max/step) cycles.
//
//      weaponSpoolTimeS used to subtract one cycle, which both disagreed with eos AND with this
//      file's own Mutadaptive rep path. Pinned here so the two stay consistent.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nSPOOL-UP');
  const ved = { typeID: tid('Vedmak'), name: 'Vedmak' };
  const fit = { high: [M('Heavy Entropic Disintegrator II', 'active', 'Baryon Exotic Plasma M')], mid: [], low: [], rigs: [] };
  const cs = calcFitStats(ved, fit, [], null, {});
  // Heavy Entropic Disintegrator: damageMultiplierBonusMax 2.125, perCycle 0.07.
  check('spool', 'full-spool damage multiplier', cs.weaponSpoolFactor, 3.125, 0.0001);
  check('spool', 'max-spool DPS is base x factor', cs.weaponDpsMax, cs.weaponDps.total * 3.125, 0.0001);
  const w = (cs.graphWeapons ?? []).find((x) => (x.spoolMax ?? 0) > 0);
  check('spool', 'graph weapon carries spoolMax', w?.spoolMax ?? 0, 2.125, 0.0001);
  check('spool', 'graph weapon carries spoolPerCycle', w?.spoolPerCycle ?? 0, 0.07, 0.0001);
  // ceil(2.125 / 0.07) = 31 cycles; eos reports cycles * cycleTime, NOT (cycles-1) * cycleTime.
  const cycles = Math.ceil(2.125 / 0.07);
  check('spool', 'cycles to full spool', cycles, 31, 0);
  // calcFitStats rounds this to 1 dp on the way out, so compare like for like: 31 x 3.96 = 122.76
  // is reported as 122.8. The pre-fix value was (31-1) x 3.96 = 118.8, a full cycle short.
  check('spool', 'spool time is cycles x cycle', cs.weaponSpoolTimeS,
        Math.round(cycles * (w?.cycleS ?? 0) * 10) / 10, 0.0001);

  // The cumulative-damage curve the graph draws, recomputed here independently. A Vedmak firing for
  // 120 s lands 31 volleys whose multipliers sum to 31 + 0.07*(0+1+...+30) = 63.55 — so total damage
  // is 63.55 volleys, not the 31 a flat line would show.
  const volley = (() => { const v = w.volley; return v.em + v.th + v.kin + v.exp; })();
  let multSum = 0, t = 0, n = 0;
  while (t <= 120 + 1e-9 && n < 10000) { multSum += 1 + Math.min(w.spoolMax, n * w.spoolPerCycle); n++; t += w.cycleS; }
  check('spool', 'volleys in a 120s window', n, 31, 0);
  check('spool', 'summed spool multiplier over 120s', multSum, 63.55, 0.0001);
  check('spool', 'cumulative damage is ~2x the flat line', multSum / n, 2.0500, 0.001);

  // Mutadaptive remote reps ramp the same way, and the projected rep record must carry it or the
  // reps-over-time graph flattens back out.
  const rod = { typeID: tid('Rodiva'), name: 'Rodiva' };
  const rfit = { high: [M('Heavy Mutadaptive Remote Armor Repairer II', 'active')], mid: [], low: [], rigs: [] };
  const rr = computeProjectedReps(rod, rfit, null, {}).reps[0];
  check('spool', 'projected rep carries spoolMax', rr?.spoolMax ?? 0, 1.5, 0.0001);
  check('spool', 'projected rep carries spoolPerCycle', rr?.spoolPerCycle ?? 0, 0.1, 0.0001);
  check('spool', 'rep cycles to full spool', Math.ceil(1.5 / 0.1), 15, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 13m. MISSILE GUIDANCE COMPUTERS/ENHANCERS — the bonus must be read ENGINE-COMPUTED
//      Issue #46: a heated MGC changed nothing. The range block built its stacking pool from
//      `TYPES[typeID].attrs`, freezing missileVelocityBonus/explosionDelayBonus at the base 5.5 —
//      so the overheat boost (+15%, effect 6144) was invisible, and the loaded script had to be
//      re-applied by hand. Same read also dropped ENHANCERS entirely: an MGE carries no duration,
//      cap cost or heat damage, so it can never be 'active', and the pool required isActive().
//      pyfa reads both back with getModifiedItemAttr, so reading the engine value fixes both and
//      makes the manual script maths unnecessary.
//      Baselines are eos's own `module.maxRange` (scripts/oracle), all skills V.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nMISSILE GUIDANCE (issue #46)');
  const jack = { typeID: tid('Jackdaw'), name: 'Jackdaw' };
  const mgc = (state) => M('Missile Guidance Computer II', state, 'Missile Range Script');
  // Velocity, not `optimal`: range is stored quantized to 0.1 km, which at ~30 km is a 0.16%
  // step — looser than the tolerance needed to pin these apart. Velocity and flight time are the
  // quantities the pool actually feeds, and they are whole numbers.
  const missile = (mid, low) => {
    const cs = calcFitStats(jack, {
      high: Array.from({ length: 5 }, () => M('Light Missile Launcher II', 'active', 'Mjolnir Fury Light Missile')),
      mid, low, rigs: [],
    }, [], null, {});
    for (const st of cs.slotEngineStats.values()) if (st.isMissile) return st;
    return {};
  };
  const TOL = 1e-4;
  const bare = missile([], []);
  check('mgc', 'bare Jackdaw missile velocity (eos 5625.00)', bare.velocity, 5625, TOL);
  check('mgc', 'bare Jackdaw flight time ms (eos 5625.00)', bare.flightTime, 5625, TOL);
  const mge = missile([], [M('Missile Guidance Enhancer II', 'online')]);
  check('mgc', 'MGE II online applies at all: velocity (eos 5962.50)', mge.velocity, 5963, TOL);
  check('mgc', 'MGE II online applies at all: flight ms (eos 5962.50)', mge.flightTime, 5963, TOL);
  const hot = missile([mgc('overheated'), mgc('overheated')], []);
  const cold = missile([mgc('active'), mgc('active')], []);
  check('mgc', '2x MGC II + range script, active (eos 6840.67)', cold.velocity, 6841, TOL);
  check('mgc', '2x MGC II + range script, OVERHEATED (eos 7033.23)', hot.velocity, 7033, TOL);
  check('mgc', 'overheated flight time ms (eos 7033.23)', hot.flightTime, 7033, TOL);
  // The reported symptom was that the two were EQUAL, so assert the inequality directly rather
  // than relying on the absolute baselines alone.
  check('mgc', 'overheating an MGC actually extends range', hot.velocity > cold.velocity ? 1 : 0, 1, 0);
  // The Precision Script zeroes the range bonus rather than reversing it, overheated or not.
  const prec = (state) => M('Missile Guidance Computer II', state, 'Missile Precision Script');
  check('mgc', 'precision script leaves velocity at the bare value',
        missile([prec('overheated'), prec('overheated')], []).velocity, 5625, TOL);
}

// ─────────────────────────────────────────────────────────────────────────────
// 13t. MISSILE APPLICATION — explosion velocity and explosion radius
//      A fitted missile reported its BARE type value on every fit: a Caracal's Scourge Fury read
//      71 m/s and 241 m with all skills at V. `_applyEffect` walks OwnerRequiredSkillModifier over
//      modules and drones but never over a module's loaded CHARGE, and almost every application
//      bonus in the game — the Target Navigation Prediction and Guided Missile Precision SKILLS,
//      the Warhead Flare/Rigor Catalyst RIGS, a Golem's or Nighthawk's HULL bonus, the Zainou
//      'Deadeye' implants, Crash — arrives through exactly that func. Opening the engine path is
//      not the fix: `engineChargeMult` and the warhead/hardwiring chains exist because it is shut,
//      so widening it double-counts missile DAMAGE (22 baselines move, a Cerberus by 37%). calc.js
//      rebuilds the chain from base instead, which also puts the rigs in the SAME stacking pool as
//      the Guidance Computer — what pyfa does, since Effect1590/1472/6135 all penalise in module
//      context and leave skills, implants and boosters alone.
//      Every number below is eos's, all skills V (scripts/oracle).
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nMISSILE APPLICATION (explosion velocity / radius)');
  const app = (eft, opts = {}) => {
    const p = parseEFT(eft);
    const ship = lookupShip(p.shipName);
    const st = calcFitStats(ship, buildSlotsFromEFT(ship, p.mods, p.subsystems), [], null, {
      implants: (opts.implants ?? []).map(n => ({ name: n })),
      boosters: opts.boosters ?? [],
    });
    const g = (st.graphWeapons ?? [])[0] ?? {};
    return { vel: g.explosionVelocity, rad: g.explosionRadius };
  };
  const TOL = 1e-5;
  const CH = 'Heavy Missile Launcher II, Scourge Fury Heavy Missile';
  // The bare case IS the bug: 71 x 1.5 (Target Navigation Prediction V) and 241 x 0.75 (Guided
  // Missile Precision V). Both skills were missing entirely, so this failed at the base values.
  const bare = app(`[Caracal, x]\n\n\n${CH}\n`);
  check('aoe', 'bare Caracal explosion velocity (eos 106.500)', bare.vel, 106.5, TOL);
  check('aoe', 'bare Caracal explosion radius (eos 180.750)', bare.rad, 180.75, TOL);
  // The shared-pool case. Alone each is unpenalised, so it cannot tell the pools apart; together
  // the weaker of the two must be cut to exp(-1/7.1289) = 0.8691 strength. Penalising them in
  // separate pools gives 121.412 here, ~2% adrift on a very ordinary fit.
  const mgc = app(`[Caracal, x]\n\nMissile Guidance Computer II, Missile Precision Script\n\n${CH}\n`);
  const rig = app(`[Caracal, x]\n\n\n${CH}\n\nMedium Warhead Rigor Catalyst II\n`);
  const both = app(`[Caracal, x]\n\nMissile Guidance Computer II, Missile Precision Script\n\n${CH}\n\nMedium Warhead Rigor Catalyst II\n`);
  check('aoe', 'MGC II precision, radius (eos 150.926)', mgc.rad, 150.92578125, TOL);
  check('aoe', 'Warhead Rigor Catalyst II, radius (eos 144.600)', rig.rad, 144.6, TOL);
  check('aoe', 'MGC + Rigor share ONE stacking pool (eos 123.864)', both.rad, 123.86399537345128, TOL);
  // Hull bonuses, all OwnerRequiredSkillModifier and so all invisible to the engine's charge.
  check('aoe', 'Caracal Navy Issue radius (eos 135.562)', app(`[Caracal Navy Issue, x]\n\n\n${CH}\n`).rad, 135.5625, TOL);
  check('aoe', 'Nighthawk HAM velocity (eos 130.500)',
    app(`[Nighthawk, x]\n\n\nHeavy Assault Missile Launcher II, Scourge Rage Heavy Assault Missile\n`).vel, 130.5, TOL);
  check('aoe', 'Golem cruise radius (eos 425.250)',
    app(`[Golem, x]\n\n\nCruise Missile Launcher II, Scourge Fury Cruise Missile\n`).rad, 425.25, TOL);
  // Implants and boosters: unpenalised, and read raw off the type rather than from the engine.
  const imp = app(`[Caracal, x]\n\n\n${CH}\n`,
    { implants: ["Zainou 'Deadeye' Target Navigation Prediction TN-905", "Zainou 'Deadeye' Guided Missile Precision GP-805"] });
  check('aoe', 'TN-905 + GP-805 velocity (eos 111.825)', imp.vel, 111.825, TOL);
  check('aoe', 'TN-905 + GP-805 radius (eos 171.712)', imp.rad, 171.7125, TOL);
  check('aoe', 'Strong Crash radius (eos 126.525)',
    app(`[Caracal, x]\n\n\n${CH}\n`, { boosters: [{ name: 'Strong Crash Booster' }] }).rad, 126.525, TOL);
  // A booster DOWNSIDE is a pyfa `boosterSideEffect` — off unless the user switches it on. Walking
  // the booster's effects picked Blue Pill's -30% explosion velocity up unconditionally.
  const bp = 'Strong Blue Pill Booster';
  check('aoe', 'Blue Pill side effect is OFF by default (eos 106.500)',
    app(`[Caracal, x]\n\n\n${CH}\n`, { boosters: [{ name: bp }] }).vel, 106.5, TOL);
  // Switched on it is -30% scaled by Neurotoxin Recovery V (-5%/lvl magnitude), so -22.5%, not -30%.
  // eos agrees to the last bit: 82.53750000000001 with se.active = True on effect 2749.
  check('aoe', 'and applies when switched on, Neurotoxin-scaled (eos 82.538)', app(`[Caracal, x]\n\n\n${CH}\n`,
    { boosters: [{ name: bp, sideEffects: [{ key: 'boosterAOEVelocityPenalty', value: -30, enabled: true }] }] }).vel,
    106.5 * 0.775, TOL);
  // Structures. A Standup missile has an EMPTY `rs`, so every skill-filtered source rejects it on
  // its own — no MLO gate needed — while the structure guidance modules and rigs, which filter on
  // the charge's GROUP, still reach it. Both halves have to hold at once.
  const SL = 'Standup Multirole Missile Launcher I, Standup Light Missile';
  const azb = app(`[Azbel, x]\n\n\n${SL}\n`);
  check('aoe', 'Azbel Standup Light Missile velocity (eos 200.000)', azb.vel, 200, TOL);
  check('aoe', 'Azbel Standup Light Missile radius (eos 100.000)', azb.rad, 100, TOL);
  check('aoe', 'Standup MGE II reaches it by group (eos 94.000)',
    app(`[Azbel, x]\nStandup Missile Guidance Enhancer II\n\n${SL}\n`).rad, 94, TOL);
  check('aoe', 'Standup M-Set Missile Precision II, velocity (eos 284.000)',
    app(`[Azbel, x]\n\n\n${SL}\n\nStandup M-Set Missile Precision II\n`).vel, 284, TOL);
}

// ─────────────────────────────────────────────────────────────────────────────
// 13p. MODULE STRENGTH READOUTS — the bare figure on an EWAR/support row
//      Two things are being pinned. First the DISTINCT-MAGNITUDE rule: a module that moves several
//      attributes by the same amount reads as one number, one that moves them differently lists
//      each. Second, and more important, that the group table is neither too narrow nor too broad.
//      Keying it off attribute PRESENCE instead of the group name is the tempting shortcut and it
//      is wrong — `speedFactor` defaults to 1, so every propulsion module in the game resolves it,
//      which is what the microwarpdrive check below exists to catch.
//      All values engine-resolved at all skills V; a Praxis is used because it bonuses none of it.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nMODULE STRENGTH READOUTS');
  const S = (vals, unit) => String(formatStrengthValues(vals, unit));
  check('str', 'equal magnitudes collapse to one figure', S([-17.19, -17.19, -17.19]), '17.2%');
  check('str', 'different magnitudes list ascending', S([15, 7.5, 15]), '7.5/15%');
  // A Missile Guidance Computer raises missile velocity +8.25% and shrinks explosion radius
  // -8.25%: one strength written twice, so signs must not split it into two figures.
  check('str', 'opposite signs are one magnitude', S([-9, -9, -12, 12]), '9/12%');
  // Rounds BEFORE deduping. Two attributes reached by different multiplication chains land one ULP
  // apart — 0.1*3 is not 0.3 — and deduping the raw doubles leaves both, printing "0.3/0.3%".
  // (Do not "simplify" this to a hand-typed pair like 17.19 / 17.190000000000001: those parse to
  // the SAME double, so the check silently has no teeth. Verified by reverting the fix.)
  check('str', 'float dust does not split a figure', S([0.3, 0.1 * 3]), '0.3%');
  check('str', 'all-zero produces nothing at all', S([0, 0, 0]), 'null');

  const praxis = { typeID: tid('Praxis'), name: 'Praxis' };
  const rows = {
    neut:    M('Small Energy Neutralizer II', 'active'),
    nos:     M('Small Energy Nosferatu II', 'active'),
    rtc:     M('Remote Tracking Computer II', 'active'),
    td:      M('Tracking Disruptor II', 'active'),
    tdScr:   M('Tracking Disruptor II', 'active', 'Tracking Speed Disruption Script'),
    gdPrec:  M('Guidance Disruptor II', 'active', 'Missile Precision Script'),
    paint:   M('Target Painter II', 'active'),
    sebo:    M('Sensor Booster II', 'active'),
    seboIdle:M('Sensor Booster II', 'online'),
    seboOff: M('Sensor Booster II', 'offline'),
    tc:      M('Tracking Computer II', 'active'),
    mgc:     M('Missile Guidance Computer II', 'active'),
    web:     M('Stasis Webifier II', 'active'),
    scram:   M('Warp Scrambler II', 'active'),
    disr:    M('Warp Disruptor II', 'active'),
    mwd:     M('50MN Microwarpdrive II', 'active'),
    te:      M('Tracking Enhancer II', 'online'),
    sigamp:  M('Signal Amplifier II', 'online'),
    dc:      M('Damage Control II', 'online'),
  };
  const cs = calcFitStats(praxis, {
    high: [rows.neut, rows.nos, rows.rtc],
    mid:  [rows.td, rows.tdScr, rows.gdPrec, rows.paint, rows.sebo, rows.seboIdle, rows.seboOff, rows.tc, rows.mgc,
           rows.web, rows.scram, rows.disr, rows.mwd],
    low:  [rows.te, rows.sigamp, rows.dc],
    rigs: [],
  }, [], null, {});
  const st = k => cs.slotEngineStats.get(rows[k]) ?? {};
  const txt = k => String(st(k).strengthText);

  check('str', 'unscripted TD II is ONE figure', txt('td'), '21.5%');            // 17.19 x 1.25 (Signal Suppression V)
  check('str', 'a script doubles it and keeps it one', txt('tdScr'), '43%');     // the other two attrs are zeroed
  check('str', 'Remote Tracking Computer II', txt('rtc'), '7.5/15%');
  check('str', 'Sensor Booster II', txt('sebo'), '30/48%');
  // A split figure has to name its parts — "30/48%" alone cannot say which number is which. Listed
  // ascending, in the same order as the figures. Two attributes sharing a value (targeting range
  // and scan resolution, both 30%) both appear, mapping to the one figure they produced.
  check('str', 'Sensor Booster II names each figure', String(st('sebo').strengthDetail),
        'targeting range 30%, scan resolution 30%, sensor strength 48%');
  check('str', 'Remote Tracking Computer II names each figure', String(st('rtc').strengthDetail),
        'optimal 7.5%, falloff 15%, tracking 15%');
  // One figure covering SEVERAL attributes names them instead of listing values — scripting a
  // disruptor zeroes the attributes it doesn't boost rather than changing the number, so "30%" is
  // identical on a precision-scripted and an unscripted module and only the names tell them apart.
  check('str', 'precision-scripted GD is one figure', txt('gdPrec'), '30%');
  check('str', 'precision-scripted GD names both effects', String(st('gdPrec').strengthAttrs),
        'explosion velocity and explosion radius');
  check('str', 'an unscripted TD names all three', String(st('td').strengthAttrs),
        'optimal, falloff and tracking');
  // ...but never both forms at once: values-with-names supersedes names-only.
  check('str', 'a split figure carries no name-only list', String(st('sebo').strengthAttrs), 'undefined');
  check('str', 'a single-attribute module carries neither', String(st('paint').strengthAttrs), 'undefined');
  // Per-cycle amount AND sustained rate, both on the row. The amount is what you compare between two
  // modules of the same size; the rate is what decides the cap war, and it used to be tooltip-only —
  // which on a phone is a tap away. The cycle stays because it is the third quantity, not a repeat:
  // it is what tells you how long you have to hold the target.
  check('str', 'Small Energy Neutralizer II', txt('neut'), '55 GJ/6s (9.2 GJ/s)');
  check('str', 'neut GJ per second', st('neut').strengthPerSec, 9.2, 1e-9);
  check('str', 'Small Energy Nosferatu II', txt('nos'), '10 GJ/2.5s (4 GJ/s)');
  // Tackle carries warpScrambleStrength and would read "2 pts", but the figure is fixed per module
  // and already implied by the name, so it is left off the row on purpose. Asserted so it cannot
  // drift back in as a side effect of widening the table.
  check('str', 'a warp scrambler shows no strength', txt('scram'), 'undefined');
  check('str', 'a warp disruptor shows no strength', txt('disr'), 'undefined');
  // A web has BOTH; the strength is merged into the range entry rather than replacing it, and
  // returning early on the strength would silently have dropped the range the row already showed.
  check('str', 'a web keeps its strength', txt('web'), '60%');
  check('str', 'a web keeps its range too', st('web').optimal, 10, 1e-9);
  // The whole reason the table is keyed by group name. An MWD carries speedFactor and would be
  // read as a 500%-strength stasis web by anything that dispatched on the attribute.
  check('str', 'a microwarpdrive is NOT a stasis web', txt('mwd'), 'undefined');
  check('str', 'a Damage Control has no strength', txt('dc'), 'undefined');
  // A module that is fitted but not currently running still shows what it would do; gating the
  // readout on 'active' (as the rest of section 8b does) blanks it the moment you turn it off.
  check('str', 'an idle module still reads', txt('seboIdle'), '30/48%');
  check('str', 'an OFFLINE module reads nothing', txt('seboOff'), 'undefined');
  // Only effects that land on ANOTHER ship get a readout. A local tracking computer, tracking
  // enhancer, missile guidance computer or signal amplifier is already fully visible in this fit's
  // own turret/missile/targeting figures, so restating it on the row is noise. Their REMOTE
  // counterparts are in (see rtc above). The local Sensor Booster is a deliberate exception.
  check('str', 'a local Tracking Computer shows nothing', txt('tc'), 'undefined');
  check('str', 'a Tracking Enhancer shows nothing', txt('te'), 'undefined');
  check('str', 'a Missile Guidance Computer shows nothing', txt('mgc'), 'undefined');
  check('str', 'a Signal Amplifier shows nothing', txt('sigamp'), 'undefined');

  // Range, falloff and tracking belong to the module AS FITTED — skills, rigs, tracking enhancers
  // and the loaded ammo all reach a gun whether or not it is currently cycling — so STOPPING a
  // turret must not move any of them. They used to: only the active-weapon pass wrote these, so a
  // merely-online turret got no slotEngineStats entry, and the row silently fell back to raw type
  // attributes. A 1400mm Howitzer II loaded with Domination EMP L read "24+35 km / Tr 0.9" (the
  // bare, skill-less type data) beside its true "37.5+99.7 km / Tr 1.2".
  //
  // Reported as a GESTURE bug, not a wrong number, which is why it is worth a comment: the false
  // figures are short enough to fit on one line where the real ones wrap to two, so the row shrank
  // the instant the first tap stopped the gun and the state dot slid out from under the second tap
  // of a double-tap-to-overheat. It never reproduced on a desktop viewport, where nothing wraps.
  //
  // Asserted as an active/online EQUALITY rather than against typed-in numbers, so the check keeps
  // its teeth through any rebalance: it is the invariant, not the value, that is being pinned.
  const tempest = { typeID: tid('Tempest'), name: 'Tempest' };
  const gunAt = state => {
    const g = M('1400mm Howitzer Artillery II', state, 'Domination EMP L');
    return calcFitStats(tempest, { high: [g], mid: [], low: [M('Gyrostabilizer II', 'online')], rigs: [] },
      [], null, {}).slotEngineStats.get(g) ?? {};
  };
  const gunOn = gunAt('online'), gunAct = gunAt('active');
  check('str', 'a stopped turret still reports its optimal', gunOn.optimal, gunAct.optimal, 1e-9);
  check('str', 'a stopped turret still reports its falloff', gunOn.falloff, gunAct.falloff, 1e-9);
  check('str', 'a stopped turret still reports its tracking', gunOn.tracking, gunAct.tracking, 1e-9);
  // And the numbers really are the buffed ones, rather than raw type data that happens to agree on
  // both sides — an equality check alone would still pass if BOTH states fell back to the base.
  // The bare type carries 24 km of optimal; Sharpshooter V takes it to 30.
  check('str', 'that optimal is the fitted one, not the base', gunOn.optimal > 24 ? 1 : 0, 1, 0);

  // Same invariant for a MISSILE launcher, which needed a separate fix: the turret repair above
  // works by reading the module's `maxRange`, and a launcher has none — its range is the loaded
  // charge's velocity × flight time, computed only in the active-weapon pass. So a stopped launcher
  // got no entry at all and its row showed no range whatsoever, rather than a wrong one.
  const caracal = { typeID: tid('Caracal'), name: 'Caracal' };
  const lnchAt = state => {
    const l = M('Heavy Missile Launcher II', state, 'Scourge Fury Heavy Missile');
    const cs = calcFitStats(caracal, { high: [l], mid: [], low: [M('Ballistic Control System II', 'online')], rigs: [] },
      [], null, {});
    return { st: cs.slotEngineStats.get(l) ?? {}, dps: cs.weaponDps.total, guns: cs.graphWeapons.length };
  };
  const lnchOn = lnchAt('online'), lnchAct = lnchAt('active');
  check('str', 'a stopped launcher still reports its range', lnchOn.st.optimal, lnchAct.st.optimal, 1e-9);
  check('str', 'that range is a real number, not absent', lnchOn.st.optimal > 0 ? 1 : 0, 1, 0);
  check('str', 'a stopped launcher still reports missile velocity', lnchOn.st.velocity, lnchAct.st.velocity, 1e-9);
  check('str', 'a stopped launcher still reports explosion radius', lnchOn.st.explosionRadius, lnchAct.st.explosionRadius, 1e-9);
  // ...and the range chain running while stopped must not leak into anything that is a claim about
  // OUTPUT. A launcher you have switched off shoots nothing, and contributes no weapon to the graph.
  check('str', 'a stopped launcher deals no dps', lnchOn.dps, 0, 0);
  check('str', 'a stopped launcher is not a graph weapon', lnchOn.guns, 0, 0);
  check('str', 'a firing launcher still deals dps', lnchAct.dps > 0 ? 1 : 0, 1, 0);
  check('str', 'a firing launcher is still a graph weapon', lnchAct.guns, 1, 0);

  // Remote assistance. Every amount below is eos's own `getModifiedItemAttr` on the same Guardian at
  // all skills V, read via scripts/oracle. Two Guardians because it only has six high slots and the
  // ancillary/mutadaptive variants sit in their OWN dogma groups — a per-group table has to be shown
  // reaching all of them, since a missing group reads as a blank row rather than a wrong number.
  const guardian = { typeID: tid('Guardian'), name: 'Guardian' };
  const rr = {
    rarmor:  M('Large Remote Armor Repairer II', 'active'),
    rcap:    M('Large Remote Capacitor Transmitter II', 'active'),
    ararPaste: M('Small Ancillary Remote Armor Repairer', 'active', 'Nanite Repair Paste'),
    ararBare:  M('Small Ancillary Remote Armor Repairer', 'active'),
    rshield: M('Large Remote Shield Booster II', 'active'),
    rhull:   M('Large Remote Hull Repairer II', 'active'),
  };
  const mut = M('Heavy Mutadaptive Remote Armor Repairer I', 'active');
  const csRR = calcFitStats(guardian, {
    high: [rr.rarmor, rr.rcap, rr.ararPaste, rr.ararBare, rr.rshield, rr.rhull], mid: [], low: [], rigs: [],
  }, [], null, {});
  const csMut = calcFitStats(guardian, { high: [mut], mid: [], low: [], rigs: [] }, [], null, {});
  const sr = k => csRR.slotEngineStats.get(rr[k]) ?? {};

  check('str', 'Large Remote Armor Repairer II', String(sr('rarmor').strengthText), '512 HP/6s (85.3 HP/s)');
  check('str', 'remote armor rep HP per second', sr('rarmor').strengthPerSec, 85.3, 1e-9);
  // The per-second unit travels with the figure. It was hardcoded to GJ back when neuts and nos were
  // the only per-cycle rows, which would have printed "85.3 GJ/s" for an armor repairer. Now that the
  // rate is on the row rather than in the tooltip, that mistake would be visible on every logi fit.
  check('str', 'remote rep names HP, not GJ', String(sr('rarmor').strengthPerSecUnit), 'HP');
  check('str', 'remote cap transmitter still names GJ', String(sr('rcap').strengthPerSecUnit), 'GJ');
  check('str', 'Large Remote Capacitor Transmitter II', String(sr('rcap').strengthText), '351 GJ/5s (70.2 GJ/s)');
  check('str', 'Large Remote Shield Booster II', String(sr('rshield').strengthText), '680 HP/8s (85 HP/s)');
  check('str', 'Large Remote Hull Repairer II', String(sr('rhull').strengthText), '230 HP/6s (38.3 HP/s)');
  check('str', 'Heavy Mutadaptive Remote Armor Repairer I unspooled',
        String((csMut.slotEngineStats.get(mut) ?? {}).strengthText), '392 HP/6s (65.3 HP/s)');
  // eos (module.py getRepAmount) keys the x3 purely on "a charge is loaded" — an ARAR takes nothing
  // but paste. The bare attribute is 37; printing that would understate a loaded one by two thirds.
  // The rate is multiplied too, which is the half a tooltip-only figure let slide unnoticed.
  check('str', 'a paste-loaded ARAR reps x3', String(sr('ararPaste').strengthText), '111 HP/3s (37 HP/s)');
  check('str', 'an unloaded ARAR reps its bare amount', String(sr('ararBare').strengthText), '37 HP/3s (12.3 HP/s)');
  check('str', 'paste-loaded ARAR HP per second', sr('ararPaste').strengthPerSec, 37, 1e-9);
}

// ─────────────────────────────────────────────────────────────────────────────
// 13r. UNROUNDED TARGETING FIGURES — calcFitStats rounds the Targeting & Misc block for display, and
//      `cs.exact` carries the originals so the panel can reveal them on tap.
//
//      This is not cosmetic. Align time is quantised to whole server ticks in game, so the two extra
//      digits decide whether a fit warps off before a bubble closes; a fit reading "4.00" that is
//      really 4.003 will be trimmed as though it were already under the wire. Reported from the field.
//
//      Both halves are asserted: that `exact` carries MORE than the rounded field (or the bag is
//      pointless), and that it is the SAME quantity — rounding it must reproduce the rounded field
//      exactly, or the panel would reveal a different number rather than a finer one.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nUNROUNDED TARGETING FIGURES');
  const vigil = lookupShip('Vigil');
  const cs = calcFitStats(vigil, {high:[],mid:[],low:[],rigs:[]}, [], null, {});
  const x = cs.exact ?? {};

  check('exa', 'align time is carried unrounded', x.alignTime, 3.254159657405609, 1e-9);
  check('exa', 'the displayed align time rounds to 2dp', cs.alignTime, 3.25, 0);
  // Same quantity, fewer digits — not a separately-computed number that could drift.
  check('exa', 'rounding the exact align reproduces the display',
        Math.round(x.alignTime * 100) / 100, cs.alignTime, 0);
  // Lock range rounds UP here, so the panel overstates it by 50 m until the cell is tapped. Pinned
  // because a rounding that only ever went down would make this whole feature much less interesting.
  check('exa', 'lock range is carried unrounded', x.targetRange, 81.25, 1e-9);
  check('exa', 'and the display rounds it UP', cs.targetRange, 81.3, 0);
  // Every field the panel can reveal must actually be in the bag. A missing key is silent in the UI
  // (the cell just stops being tappable), which is exactly the kind of quiet regression this catches.
  for (const k of ['alignTime','warpSpeed','sigRadius','scanRes','targetRange','sensorStrength',
                   'maxVelocity','maxVelocityAB'])
    check('exa', `exact.${k} is a finite number`, String(Number.isFinite(x[k])), 'true');
  // Scan resolution genuinely IS whole on this hull. The panel compares the two strings and drops
  // the tap when they match, so an integer here is correct rather than a missing value.
  check('exa', 'a whole figure stays whole', x.scanRes, 700, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 13q. DRONE AUTO-ADD QUANTITY — tapping a drone in the browser used to drop in a hardcoded five,
//      inactive. Reported from the field: a Vigil (5 Mbit/s bandwidth, 5 m³ bay) can fly exactly ONE
//      light drone, so the screen opened five deep with the bandwidth bar already red.
//
//      The two budgets cap independently and mean different things — bandwidth is what can be IN
//      SPACE, the bay is what is CARRIED — so a hull can legitimately hold more than it can launch,
//      and the quantity has to respect the smaller while the ACTIVE flag follows bandwidth alone.
// ─────────────────────────────────────────────────────────────────────────────
{
  // Light drone: 5 Mbit/s, 5 m³. Medium: 10/10. Heavy: 25/25. Sentry: 25 Mbit/s but 25 m³.
  const LIGHT={bandwidth:5,volume:5}, MED={bandwidth:10,volume:10}, HEAVY={bandwidth:25,volume:25};

  // The reported fit, exactly. Vigil: droneCapacity 5, droneBandwidth 5.
  const vigil=droneAddQty({...LIGHT,bwFree:5,bayFree:5});
  check('drn', 'a Vigil takes ONE light drone, not five', vigil.qty, 1, 0);
  check('drn', 'and that one is launched', String(vigil.active), 'true');

  // The case the hardcoded five was right for, and which must not regress.
  const vexor=droneAddQty({...LIGHT,bwFree:75,bayFree:125});
  check('drn', 'a Vexor still takes a full flight of five', vexor.qty, 5, 0);
  check('drn', 'a Vexor flight launches', String(vexor.active), 'true');

  // Five is a CEILING, not a target: a Vexor has bandwidth for 15 lights and bay for 25, but no
  // pilot flies more than five, so the extra room must not pull more in.
  check('drn', 'five is a ceiling', droneAddQty({...LIGHT,bwFree:1000,bayFree:1000}).qty, 5, 0);

  // Bandwidth binds below the bay: a Vexor's 75 Mbit/s is three heavies, its 125 m³ is five.
  const heavies=droneAddQty({...HEAVY,bwFree:75,bayFree:125});
  check('drn', 'bandwidth caps heavies below what the bay holds', heavies.qty, 3, 0);
  check('drn', 'and all three launch', String(heavies.active), 'true');

  // ...and the bay binds below bandwidth the other way round. An Ishtar-shaped case: plenty of
  // bandwidth left, but the bay is nearly full. Whichever is smaller has to win, both ways, or the
  // fix just moves the red bar from one gauge to the other.
  const cramped=droneAddQty({...MED,bwFree:50,bayFree:20});
  check('drn', 'the bay caps below bandwidth', cramped.qty, 2, 0);
  check('drn', 'a bay-capped stack still launches', String(cramped.active), 'true');

  // No room at all — bandwidth already spent on another flight. One still goes in, as a spare, but
  // it must NOT come in active or it immediately overruns the bandwidth the user just allocated.
  const spare=droneAddQty({...HEAVY,bwFree:0,bayFree:125});
  check('drn', 'a drone with no bandwidth left still gets added', spare.qty, 1, 0);
  check('drn', 'but it is not launched', String(spare.active), 'false');

  // Already OVER bandwidth (a restored fit can be), which floors negative. Same answer, and the
  // clamp is what stops a negative or zero quantity reaching the drone list.
  const over=droneAddQty({...HEAVY,bwFree:-30,bayFree:125});
  check('drn', 'an over-bandwidth fit still adds one', over.qty, 1, 0);
  check('drn', 'and does not launch it', String(over.active), 'false');

  // Bay full, bandwidth free. The spare has nowhere to go, but refusing the tap outright would
  // leave the user unable to swap flights without deleting first.
  check('drn', 'a full bay still adds one', droneAddQty({...LIGHT,bwFree:75,bayFree:0}).qty, 1, 0);

  // A hull with NO drone bay at all. Every gauge reads zero; nothing may divide by it or return 0.
  const noBay=droneAddQty({...LIGHT,bwFree:0,bayFree:0});
  check('drn', 'a hull with no drone bay adds one, idle', noBay.qty, 1, 0);
  check('drn', 'no-bay drone is not launched', String(noBay.active), 'false');

  // Salvage/mining drones and the like carry no bandwidth figure in some data paths; a zero divisor
  // must fall through to the ceiling rather than producing Infinity or NaN.
  const free=droneAddQty({bandwidth:0,volume:0,bwFree:75,bayFree:125});
  check('drn', 'a zero-cost drone falls back to the ceiling', free.qty, 5, 0);
  check('drn', 'and launches', String(free.active), 'true');

  // The top-up path passes Infinity for an inactive stack, since spares cost no bandwidth. Guard
  // that it stays finite and bay-bound rather than returning Infinity into a quantity.
  check('drn', 'topping up a stowed stack is bay-bound', droneAddQty({...MED,bwFree:Infinity,bayFree:30}).qty, 3, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 13s. CROSS-SLOT IMPLANT SEARCH — the picker's search only ever saw one slot's items, so a player
//      who knew the implant but not the slot had to open slots until one of them had it.
//      searchImplants spans all ten and returns each hit tagged with the slot it fills.
//
//      The ORDER is the load-bearing part and cannot come from the module browser's machinery:
//      every grade of a set implant carries the SAME metaGroupID 4 / metaLevel 9, so browserMetaRank
//      cannot separate High from Low, and jargonSearch's tie-break on name LENGTH puts Beta before
//      Alpha. Slot-ascending, then grade best-first, is what lays a set out Alpha..Omega.
{
  // core.js fills implantData from a LAZY dynamic import that cannot resolve under Node (it pulls a
  // JSON module without an import attribute), so the list is built here the way core.js builds it.
  const bundle = (await import('./data-bundle.js')).implantData ?? {};
  const ALL = [];
  for (const [slot, sd] of Object.entries(bundle))
    for (const items of Object.values(sd?.groups ?? {}))
      for (const it of items) ALL.push({ ...it, slot: Number(slot) });

  check('imps', 'the bundle carries every implant', ALL.length, 836, 0);

  // One character is ambiguous enough to match most of 836 items; filtering there is noise, not help.
  check('imps', 'a one-character query does not search', String(searchImplants('a', ALL)), 'null', 0);
  check('imps', 'an empty query does not search', String(searchImplants('   ', ALL)), 'null', 0);

  const amulet = searchImplants('amulet', ALL);
  check('imps', 'amulet finds all three grades of all six slots', amulet.length, 18, 0);
  check('imps', 'and leads with the slot-1 High-grade', amulet[0].name, 'High-grade Amulet Alpha', 0);
  check('imps', 'then Mid', amulet[1].name, 'Mid-grade Amulet Alpha', 0);
  check('imps', 'then Low', amulet[2].name, 'Low-grade Amulet Alpha', 0);
  // Beta before Alpha was the exact failure of ranking by name length, so pin the handover.
  check('imps', 'and only then slot 2', amulet[3].name, 'High-grade Amulet Beta', 0);
  const slotsAsc = amulet.every((x, i) => i === 0 || x.slot >= amulet[i - 1].slot);
  check('imps', 'slots never go backwards', String(slotsAsc), 'true', 0);
  check('imps', 'the set spans slots 1-6', `${amulet[0].slot}-${amulet[amulet.length - 1].slot}`, '1-6', 0);

  // Ascendancy has no Low grade, so a hardcoded three-per-slot assumption would overcount it.
  check('imps', 'ascendancy has only two grades', searchImplants('ascendancy', ALL).length, 12, 0);

  // The whole point of the feature: a hardwiring answers which slot it goes in without opening any.
  const hw = searchImplants('deadeye', ALL);
  check('imps', 'deadeye is a hardwiring family', hw.length, 60, 0);
  check('imps', 'and lives in the hardwiring slots', String(hw.every(x => x.slot >= 6)), 'true', 0);

  // Every result must name a real slot, or the row cannot fit itself anywhere.
  const badSlot = searchImplants('grade', ALL).filter(x => !(x.slot >= 1 && x.slot <= 10));
  check('imps', 'every hit carries a valid slot', badSlot.length, 0, 0);

  check('imps', 'a nonsense query finds nothing', searchImplants('qqzzxx', ALL).length, 0, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 15. MINING YIELD — every figure below is eos's, to full float precision (scripts/oracle,
//     `fit.minerYield` / `fit.droneYield` / `fit.minerDrain` / `fit.droneDrain`).
//
//     Two things here are easy to break and invisible when they are:
//     - A mining CRYSTAL modifies its parent MODULE via domain otherID (Effect1200), the same shape
//       as Conflagration's capNeedBonus. The engine does not iterate charges as effect sources, so
//       without explicit handling the crystal silently does nothing — and a Modulated Strip Miner II
//       at 120 m3/cycle instead of 216 just looks like a low number, not like a bug. The crystals
//       check is therefore the load-bearing one: it is ~2.3x the bare figure.
//     - eos measures WASTE against the PRE-crit yield and folds the crit bonus in afterwards, so
//       drain is not simply yield x (1 + wasteChance). Getting that order wrong shifts waste by the
//       3.75% crit factor, which is small enough to look like rounding.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nMINING (eos oracle: minerYield / droneYield / drain)');
  const CRYS = 'Simple Asteroid Mining Crystal Type A II';
  const mining = (ship, fit, drones = []) =>
    calcFitStats({ typeID: tid(ship), name: ship }, fit, drones, null, {}).mining;

  const crys = mining('Hulk', {
    high: [M('Modulated Strip Miner II', 'active', CRYS), M('Modulated Strip Miner II', 'active', CRYS)],
    low: [M('Mining Laser Upgrade II', 'online'), M('Mining Laser Upgrade II', 'online'), M('Mining Laser Upgrade II', 'online')],
  });
  check('mining', 'Hulk + T2 crystals + 3 MLU', crys.totalM3S, 41.702510, 1e-5);
  check('mining', 'Hulk + crystals waste', crys.wasteM3S, 15.113392, 1e-5);

  const bare = mining('Hulk', { high: [M('Modulated Strip Miner II', 'active'), M('Modulated Strip Miner II', 'active')] });
  check('mining', 'Hulk, no crystals', bare.totalM3S, 17.889994, 1e-5);
  check('mining', 'Hulk, no crystals waste', bare.wasteM3S, 5.862745, 1e-5);

  check('mining', 'Venture, 2x Miner II',
    mining('Venture', { high: [M('Miner II', 'active'), M('Miner II', 'active')] }).totalM3S, 8.105469, 1e-5);
  check('mining', 'Venture, 2x Gas Cloud Harvester II',
    mining('Venture', { high: [M('Gas Cloud Harvester II', 'active'), M('Gas Cloud Harvester II', 'active')] }).totalM3S, 6.666667, 1e-5);

  const proc = mining('Procurer', { high: [M('Strip Miner I', 'active')] },
    [{ name: 'Mining Drone II', typeID: tid('Mining Drone II'), qty: 2, active: true }]);
  check('mining', 'Procurer strip miner', proc.moduleM3S, 5.944010, 1e-5);
  check('mining', 'Procurer 2x Mining Drone II', proc.droneM3S, 2.268750, 1e-5);
  check('mining', 'Procurer total', proc.totalM3S, 8.212760, 1e-5);

  // An OFFLINE miner mines nothing, and a fit with no mining modules must report a clean zero —
  // the Stats card is gated on totalM3S > 0, so a stray non-zero puts a Mining panel on a combat fit.
  check('mining', 'offline strip miner yields nothing',
    mining('Hulk', { high: [M('Modulated Strip Miner II', 'offline')] }).totalM3S, 0, 0);
  check('mining', 'non-mining fit reports zero',
    mining('Rifter', { high: [M('200mm AutoCannon II', 'active', 'Republic Fleet EMP S')] }).totalM3S, 0, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 14. SHIP BROWSER TAXONOMY — the nested browse menu is derived, not hand-listed, so the failure
//     mode is a hull that quietly falls out of the tree and becomes unreachable in the UI (which
//     is exactly what data-bundle.js's stale `shipsByClass` did to Command Carriers and Lancer
//     Dreadnoughts — four hulls each, zero entries). These assert total coverage rather than
//     specific numbers, so an eve.db upgrade that adds hulls passes as long as they land somewhere.
//
//     Race comes from the REQUIRED SKILL, not from data-bundle's raceID: every hull carries its
//     racial skill, including the ones the legacy bundle has never heard of.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nSHIP BROWSER TAXONOMY');
  const tree = buildShipTaxonomy();
  const placed = tree.flatMap(shipsUnder);
  const ids = new Set(placed.map((s) => s.typeID));
  const STRUCT = new Set(['Citadel', 'Engineering Complex', 'Refinery']);
  const expected = Object.entries(TYPES).filter(([, t]) => {
    const c = t.c ?? t.category;
    return (c === 6 && t.gn && t.gn !== 'Capsule') || (c === 65 && STRUCT.has(t.gn));
  });
  const missing = expected.filter(([id]) => !ids.has(Number(id))).map(([, t]) => t.n);
  if (missing.length) console.log(`      UNREACHABLE: ${missing.slice(0, 8).join(', ')}`);
  check('taxo', 'every fittable hull is reachable', placed.length - missing.length, expected.length, 0);
  check('taxo', 'no hull appears twice', ids.size, placed.length, 0);

  // A node lists ships or lists children, never both — the UI renders one or the other.
  let mixed = 0;
  const walk = (n) => { if (n.ships && n.children) mixed++; (n.children ?? []).forEach(walk); };
  tree.forEach(walk);
  check('taxo', 'no node mixes ships and children', mixed, 0, 0);

  check('taxo', 'top level matches the specified order', tree.map((n) => n.label).join('|'), TOP_ORDER.join('|'), 0);

  // Supercarriers share the Standard Carriers node with carriers — they are not an advanced tier.
  const gCarrier = nodeAtPath(tree, ['Capital Ships', 'Carriers', 'Standard Carriers', 'Gallente']);
  const gNames = (gCarrier?.ships ?? []).map((s) => s.name);
  check('taxo', 'Thanatos is a standard Gallente carrier', gNames.includes('Thanatos') ? 1 : 0, 1, 0);
  check('taxo', 'Nyx sits beside it, not under an advanced tier', gNames.includes('Nyx') ? 1 : 0, 1, 0);

  // Command Carriers / Lancer Dreadnoughts are the hulls the legacy bundle drops entirely.
  check('taxo', 'Command Carriers present', shipsUnder(nodeAtPath(tree, ['Capital Ships', 'Carriers', 'Command Carriers']) ?? {}).length, 4, 0);
  check('taxo', 'Lancer Dreadnoughts present', shipsUnder(nodeAtPath(tree, ['Capital Ships', 'Dreadnoughts', 'Lancer Dreadnoughts']) ?? {}).length, 4, 0);

  // Tier classification: pirate hulls require TWO racial skills, navy ones require one plus mg=4.
  const cls = (n) => classifyHull(TYPES[tid(n)], tid(n));
  check('taxo', 'Machariel is pirate faction', cls('Machariel').tier, 'pirate', 0);
  check('taxo', 'Raven Navy Issue is navy faction', cls('Raven Navy Issue').tier, 'navy', 0);
  // The Rokh carries no metaGroupID at all — "not 4" has to be the test, never "is 1".
  check('taxo', 'Rokh is a standard battleship', cls('Rokh').tier, 'standard', 0);
  check('taxo', 'Leshak is precursor', cls('Leshak').tier, 'precursor', 0);
  check('taxo', 'Thunderchild is EDENCOM', cls('Thunderchild').tier, 'edencom', 0);

  // Race bucket comes from invtypes.factionID, NOT from the required skill. The skill says what you
  // have to train, not who built the hull — every case below is one the skill gets wrong.
  const at = (n) => {
    let found = null;
    const walk = (node, p) => {
      if (node.ships?.some((s) => s.name === n)) found ??= [...p, node.label].join(' > ');
      (node.children ?? []).forEach((c) => walk(c, [...p, node.label]));
    };
    tree.forEach((t) => walk(t, []));
    return found ?? 'NOT PLACED';
  };
  // Requires "Gallente Carrier" but is a Serpentis hull.
  check('taxo', 'Vendetta is pirate, not Gallente', at('Vendetta'), 'Capital Ships > Carriers > Standard Carriers > Pirate Faction', 0);
  // Requires TWO racial skills, so the tier is right but the race bucket was Amarr.
  check('taxo', 'Revenant is pirate, not Amarr', at('Revenant'), 'Capital Ships > Carriers > Standard Carriers > Pirate Faction', 0);
  check('taxo', 'Loggerhead is pirate, not Caldari', at('Loggerhead'), 'Capital Ships > Force Auxiliaries > Pirate Faction', 0);
  // No racial skill at all — these two used to land in a nameless "Other" bucket.
  check('taxo', 'Python is pirate', at('Python'), 'Battleships > Advanced Battleships > Black Ops > Pirate Faction', 0);
  check('taxo', 'Marshal is CONCORD', at('Marshal'), 'Battleships > Advanced Battleships > Black Ops > CONCORD', 0);
  // ORE-ness appears nowhere in the Outrider's skill list.
  check('taxo', 'Outrider is ORE', at('Outrider'), 'Destroyers > Advanced Destroyers > Command Destroyers > ORE', 0);
  // Special edition comes from CCP's OWN market group (Ships / Special Edition Ships), plus hulls
  // with no market group at all and the non-racial shuttles. Not from the name or the metaGroup.
  check('taxo', 'Echelon is special edition, not CONCORD navy', at('Echelon'), 'Special Edition Ships > Frigates', 0);
  check('taxo', 'Guardian-Vexor is special edition', at('Guardian-Vexor'), 'Special Edition Ships > Cruisers', 0);
  // The only ship in the game with no marketGroupID at all.
  check('taxo', 'Stratios Emergency Responder is special edition', at('Stratios Emergency Responder'), 'Special Edition Ships > Cruisers', 0);
  check('taxo', 'Leopard is a special edition shuttle', at('Leopard'), 'Special Edition Ships > Shuttles', 0);
  // CCP files this one under "Faction Shuttles", not Special Edition; metaGroupID 3/4 separates the
  // novelty shuttles from the four racial ones without naming any hull.
  check('taxo', "Goru's Shuttle is a special edition shuttle", at("Goru's Shuttle"), 'Special Edition Ships > Shuttles', 0);
  check('taxo', 'Shuttles left with only the racial four', shipsUnder(tree.find((n) => n.label === 'Shuttles')).length, 4, 0);
  check('taxo', 'Corvettes left with only the racial four', shipsUnder(tree.find((n) => n.label === 'Corvettes')).length, 4, 0);

  // ...but the Alliance Tournament hulls carry the SAME special-edition flag and must NOT move: an
  // AT Assault Frigate is still an Assault Frigate and is fitted as one. Only groups where a
  // special hull has no natural home are redirected.
  check('taxo', 'Utu stays an Assault Frigate', at('Utu'), 'Frigates > Advanced Frigates > Assault Frigates > Gallente', 0);
  check('taxo', 'Skua stays a Tactical Destroyer', at('Skua'), 'Destroyers > Advanced Destroyers > Tactical Destroyers > Caldari', 0);
  // Flagged special edition by CCP, but it is a mining hull first — the mining rule runs before.
  check('taxo', 'Perseverance stays with the mining hulls', at('Perseverance'), 'Mining Barges > Mining Destroyers', 0);

  // A non-empire racial SKILL beats the factionID. CCP tags the Upwell haulers factionID 500027
  // (EDENCOM) even though they require "Upwell Hauler", so a faction-first rule filed them next to
  // the Thunderchild. The EDENCOM combat hulls require "EDENCOM <class>", which is what separates
  // the two families.
  check('taxo', 'Deluge is Upwell, not EDENCOM', at('Deluge'), 'Haulers and Industrial Ships > Advanced Haulers > Blockade Runners > Upwell', 0);
  check('taxo', 'Torrent is Upwell, not EDENCOM', at('Torrent'), 'Haulers and Industrial Ships > Advanced Haulers > Deep Space Transports > Upwell', 0);
  check('taxo', 'Avalanche is Upwell, not EDENCOM', at('Avalanche'), 'Capital Ships > Freighters > Standard Freighters > Upwell', 0);
  check('taxo', 'Thunderchild is still EDENCOM', at('Thunderchild'), 'Battleships > Faction Battleships > EDENCOM', 0);

  // The empire hulls must NOT move.
  check('taxo', 'Thanatos still Gallente', at('Thanatos'), 'Capital Ships > Carriers > Standard Carriers > Gallente', 0);
  check('taxo', 'Rokh still standard Caldari', at('Rokh'), 'Battleships > Standard Battleships > Caldari', 0);

  // data-bundle.js's raceIcons keys are NOT SDE raceIDs: 135 is ORE's gold hexagon and 512 is the
  // Triglavian red glyph (decoded from the PNGs). Reading them as raceIDs put ORE's logo on every
  // Triglavian category and left ORE with none.
  check('taxo', 'ORE icon key', String(RACE_ICON_ID.ORE), '135', 0);
  check('taxo', 'Triglavian icon key', String(RACE_ICON_ID.Triglavian), '512', 0);
  const iconKeys = new Set(Object.keys((await import('./data-bundle.js')).raceIcons ?? {}));
  const missingIcon = Object.entries(RACE_ICON_ID).filter(([, v]) => !iconKeys.has(String(v))).map(([k]) => k);
  if (missingIcon.length) console.log(`      NO ICON IN BUNDLE: ${missingIcon.join(', ')}`);
  check('taxo', 'every mapped race icon exists', missingIcon.length, 0, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 14b. HULL IDENTITY ON THE FIT ITSELF — the header subtitle reads `${race} ${hullClass}` off
//      lookupShip(), and those two fields used to come from the ships.json row and a hardcoded
//      SHIPS_BY_CLASS table. Both are stale: ships.json calls the Draugur an "Unknown Attack
//      Battlecruiser", and the table files the Bifrost and Stork (Command Destroyers) as "Flag
//      Cruisers". They are derived from TYPES[].gn + classifyHull now, so the subtitle and the
//      browser cannot describe the same hull differently. The sweep is the real check — a named
//      example only catches the hull someone happened to notice.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nHULL IDENTITY');
  const hulls = Object.entries(TYPES).filter(([, t]) => (t.c ?? t.category) === 6 && t.gn && t.gn !== 'Capsule');
  const wrong = [];
  for (const [id, t] of hulls) {
    const s = lookupShip(t.n);
    if (s?.hullClass !== t.gn || s?.race !== classifyHull(t, id).race) wrong.push(t.n);
  }
  if (wrong.length) console.log(`      DISAGREES WITH CCP: ${wrong.slice(0, 8).join(', ')}`);
  check('hull', 'every hull class/race matches the type data', wrong.length, 0, 0);

  const sub = (n) => { const s = lookupShip(n); return `${s.race ?? ''} ${s.hullClass ?? ''}`.trim(); };
  check('hull', 'Draugur is a Triglavian Command Destroyer', sub('Draugur'), 'Triglavian Command Destroyer', 0);
  check('hull', 'Bifrost is not a Flag Cruiser', sub('Bifrost'), 'Minmatar Command Destroyer', 0);
  // The hull SHIPS_BY_CLASS existed to fix. It has to survive the table's removal.
  check('hull', 'Malediction is still an Interceptor', sub('Malediction'), 'Amarr Interceptor', 0);
  // A real Attack Battlecruiser must keep the label the Draugur wrongly borrowed.
  check('hull', 'Naga is still an Attack Battlecruiser', sub('Naga'), 'Caldari Attack Battlecruiser', 0);
  // No racial skill and no mapped faction: the subtitle drops the race rather than saying "Unknown".
  check('hull', 'Gnosis has no race to show', sub('Gnosis'), 'Combat Battlecruiser', 0);

  // hullClass and race were never the only stale fields on a ships.json row — they were just the
  // ones someone noticed. Three more, all now taken from the dogma bundle in lookupShip, all swept
  // rather than spot-checked for the reason the comment above gives.
  //
  // MASS: 317 of ships.json's 423 rows carry mass 0 (and volume 0), the Vargur among them. It read
  // "0.00M kg" on the hull's own attributes sheet next to a correct 150.00M current, and GraphTab's
  // align-time fallback (`cs?.mass ?? ship.mass`) would have taken the 0 rather than skipping past
  // it. No ship in EVE is massless, so this needs no tolerance for a legitimate zero.
  const massless = [], volumeless = [];
  for (const [, t] of hulls) {
    const s = lookupShip(t.n);
    if (!(s?.mass > 0)) massless.push(t.n);
    if (!(s?.volume > 0)) volumeless.push(t.n);
  }
  if (massless.length) console.log(`      MASSLESS: ${massless.slice(0, 8).join(', ')}`);
  check('hull', 'every hull has a mass', massless.length, 0, 0);
  check('hull', 'every hull has a volume', volumeless.length, 0, 0);
  check('hull', 'Vargur mass (kg)', lookupShip('Vargur').mass, 150e6, 1e-9);

  // SENSOR TYPE: ships.json calls 62 Minmatar hulls "Laser", which is not one of the four sensor
  // types EVE has — the Minmatar sensor is LADAR. The Stats tab prints this string verbatim beside
  // the strength ("20 Laser" on a Vargur), and the ship attributes sheet builds a dogma attribute
  // NAME out of it, where "Laser" resolves to nothing at all.
  const SENSORS = new Set(['Radar', 'Ladar', 'Magnetometric', 'Gravimetric']);
  const badSensor = [], mismatched = [];
  for (const [, t] of hulls) {
    const s = lookupShip(t.n);
    const a = t.attrs ?? t.a ?? {};
    const carried = [...SENSORS].filter(k => (a[`scan${k}Strength`] ?? 0) > 0);
    if (!carried.length) continue;              // structures/special hulls with no sensor at all
    if (!SENSORS.has(s?.sensorType)) { badSensor.push(`${t.n}:${s?.sensorType}`); continue; }
    // The strength must be the one belonging to the type it claims — the two used to be able to
    // disagree, since they came from different places (Cenotaph read 25 against the type's 15).
    if (Math.abs((a[`scan${s.sensorType}Strength`] ?? 0) - (s?.sensorStrength ?? 0)) > 1e-9)
      mismatched.push(t.n);
  }
  if (badSensor.length) console.log(`      NOT A SENSOR TYPE: ${badSensor.slice(0, 8).join(', ')}`);
  check('hull', 'every sensor type is one of CCP\'s four', badSensor.length, 0, 0);
  check('hull', 'every sensor strength matches its type', mismatched.length, 0, 0);
  check('hull', 'the Minmatar sensor is Ladar, not Laser', String(lookupShip('Vargur').sensorType), 'Ladar', 0);
  check('hull', 'Cenotaph sensor strength is the type data\'s', lookupShip('Cenotaph').sensorStrength, 15, 1e-9);
}

// ─────────────────────────────────────────────────────────────────────────────
// 15. SEARCH RANKING AND INITIALISMS — jargonSearch used to FILTER only, so results came back in
//     market-tree order. That put ten Omnidirectional Tracking Links above the plain Tracking
//     Computer for "tracking", and `te` (an initialism, matching no substring of "Tracking
//     Enhancer") could not find that module AT ALL. Ranking is the fix; the trap it introduces is
//     that a curated jargon expansion must still outrank an incidental literal hit — `ac` means
//     autocannon, and the letters "ac" appear only in unrelated names like "…Acquisition".
//     Positions, not scores, are asserted: the score tiers are an implementation detail, "the thing
//     you searched for is at the top" is the contract.
//
//     Within one relevance tier the order is the module BROWSER's meta order (T2, T1, Storyline,
//     Faction, Deadspace, Officer), not name length. Length was a proxy for it and interleaved the
//     tiers — a search for "web" ran T1, T2, T1, Faction, Faction, T1 because "Civilian Stasis
//     Webifier" is shorter than "Dark Blood Stasis Webifier". So the "leads with" checks below name
//     the T2 variant: that is the module you are usually reaching for, and it is the same item the
//     tree would have put first had you navigated to it instead.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nSEARCH');
  // The corpus the search box actually sees: the market tree PLUS the modules CCP does not sell,
  // which have no market node to hang under. Mirrors `allMods` in ui.jsx.
  const modsIn = (slot) => {
    const out = [];
    (function walk(ns) { for (const n of ns) { for (const m of (n.mods ?? [])) out.push(m); walk(n.children ?? []); } })(REAL_MODULE_BROWSER[slot] ?? []);
    return out.concat(OFF_MARKET_MODULES[slot] ?? []);
  };
  const rankOf = (slot, query, re) => (jargonSearch(query, modsIn(slot)) ?? []).findIndex((m) => re.test(m.name)) + 1;  // 1-based, 0 = absent

  // The two cases that prompted this. Both were reproduced against the real browser lists first:
  // "tracking" put Tracking Computer below ten Omni links, and "te" did not return the Enhancer.
  check('search', '"tracking" leads with the Tracking Computer', rankOf('mid', 'tracking', /^Tracking Computer II$/), 1, 0);
  check('search', '"te" finds the Tracking Enhancer at all', rankOf('low', 'te', /^Tracking Enhancer I$/) > 0 ? 1 : 0, 1, 0);
  check('search', '"te" leads with it', rankOf('low', 'te', /^Tracking Enhancer II$/), 1, 0);
  // Typing the words in full must not rank the Omnidirectional variant above the plain one.
  check('search', '"tracking enhancer" prefers the plain module', rankOf('low', 'tracking enhancer', /^Tracking Enhancer II$/), 1, 0);
  // Both metas of the module you asked for still beat every Omnidirectional link, which is the
  // ordering complaint that created this section in the first place.
  check('search', '"tracking" keeps both Tracking Computers above the Omni links',
        rankOf('mid', 'tracking', /^Tracking Computer I$/) < rankOf('mid', 'tracking', /^Omnidirectional Tracking Link/) ? 1 : 0, 1, 0);

  // The regression that ranking itself introduced: scoring the literal query alone dropped every
  // autocannon to 158th of 200, behind "Hostile Target Acquisition".
  check('search', '"ac" leads with an autocannon', rankOf('high', 'ac', /AutoCannon/i), 1, 0);
  // pyfa's curated shorthands must keep working now that they are ranked rather than only filtered.
  check('search', '"tc" leads with the Tracking Computer', rankOf('mid', 'tc', /^Tracking Computer II$/), 1, 0);
  check('search', '"dda" leads with the Drone Damage Amplifier', rankOf('low', 'dda', /^Drone Damage Amplifier II$/), 1, 0);
  check('search', '"istab" leads with Inertial Stabilizers', rankOf('low', 'istab', /^Inertial Stabilizers II$/), 1, 0);
  check('search', '"point" leads with a Warp Disruptor', rankOf('mid', 'point', /^Warp Disruptor II$/), 1, 0);
  // A MULTI-WORD query used to score only the whole string, which matches no name — so all 53 hits
  // tied at the 100 floor and the order fell through to name length, leading with eight Capital
  // SHIELD Boosters. Needs both halves of the fix: tokenised scoring, and "cap" reading as capacitor
  // rather than as a prefix of "capital".
  check('search', '"cap booster" ranks capacitor boosters above capital shield boosters',
        rankOf('mid', 'cap booster', /Capacitor Booster/) < rankOf('mid', 'cap booster', /Capital Shield Booster/) ? 1 : 0, 1, 0);
  // ...and the shorthand must not hijack the word typed in full.
  check('search', '"capital shield booster" still leads with it', rankOf('mid', 'capital shield booster', /^Capital Shield Booster II$/), 1, 0);

  // The two ordering rules, asserted as PROPERTIES rather than fixed lists so they hold for queries
  // nobody wrote a case for. Both are about the same thing — results should read as blocks of
  // alternatives — and both were violated by the old flat sort.
  const groupOf = (m) => TYPES[m.typeID]?.gn ?? m.name;
  // 1. A dogma group is CONTIGUOUS. "tracking" used to alternate computer/disruptor/computer.
  const groupBreaks = (slot, query) => {
    const res = jargonSearch(query, modsIn(slot)) ?? [];
    const seen = new Set();
    let bad = 0;
    for (let i = 0; i < res.length; i++) {
      const g = groupOf(res[i]);
      if (i > 0 && g === groupOf(res[i - 1])) continue;
      if (seen.has(g)) bad++;                       // group resumed after something else interrupted
      seen.add(g);
    }
    return bad;
  };
  // 2. Inside a group the browser meta rank never goes backwards.
  const metaOutOfOrder = (slot, query) => {
    const res = jargonSearch(query, modsIn(slot)) ?? [];
    let bad = 0;
    for (let i = 1; i < res.length; i++) {
      const a = res[i - 1], b = res[i];
      if (groupOf(a) !== groupOf(b)) continue;
      if (browserMetaRank(b.typeID, b.meta) < browserMetaRank(a.typeID, a.meta)) bad++;
    }
    return bad;
  };
  for (const [slot, q] of [['mid', 'web'], ['mid', 'tracking'], ['low', 'dda'], ['high', 'ac'], ['low', 'istab'], ['high', 'civilian']]) {
    check('search', `"${q}" keeps each module group contiguous`, groupBreaks(slot, q), 0, 0);
    check('search', `"${q}" is meta-ordered within each group`, metaOutOfOrder(slot, q), 0, 0);
  }
  // The reported case, in full: T2 first, then the T1s, then the faction ones — no interleaving.
  check('search', '"web" runs Stasis Webifier II then I', rankOf('mid', 'web', /^Stasis Webifier II$/), 1, 0);
  check('search', '"web" puts Stasis Webifier I second', rankOf('mid', 'web', /^Stasis Webifier I$/), 2, 0);
  check('search', '"web" ranks every T1 above every Faction webifier',
        rankOf('mid', 'web', /^X5 Enduring Stasis Webifier$/) < rankOf('mid', 'web', /^Dark Blood Stasis Webifier$/) ? 1 : 0, 1, 0);
  // Grouping must not cost the searched-for module its lead: the Tracking Computer block wins on its
  // one name-prefix hit even though most of its members score below every Tracking Disruptor.
  check('search', '"tracking" runs the Computers before the Disruptors',
        rankOf('mid', 'tracking', /^Tracking Computer I$/) < rankOf('mid', 'tracking', /^Tracking Disruptor II$/) ? 1 : 0, 1, 0);

  // Hull initialisms — the feature this section was added for. ONI is deliberately ambiguous in
  // game chat too, so BOTH hulls must come back rather than the search picking one.
  const hulls = Object.values(TYPES).filter((t) => (t.c ?? t.category) === 6 && t.n).map((t) => t.n);
  const shipHits = (q) => hulls.filter((n) => nameMatchesQuery(n, q))
                               .sort((a, b) => searchScore(b, q) - searchScore(a, q) || a.length - b.length);
  check('search', 'initials of Omen Navy Issue', initialsOf('Omen Navy Issue'), 'oni', 0);
  check('search', 'ONI finds both Navy Issue hulls', shipHits('oni').slice(0, 2).join('|'), 'Omen Navy Issue|Osprey Navy Issue', 0);
  check('search', 'RSI finds the Raven State Issue', shipHits('rsi')[0], 'Raven State Issue', 0);
  check('search', 'VNI finds the Vexor Navy Issue', shipHits('vni')[0], 'Vexor Navy Issue', 0);
  check('search', 'TFI covers all four Fleet Issue hulls', shipHits('tfi').filter((n) => /Fleet Issue$/.test(n)).length, 4, 0);
  // A full name must still beat the longer hull that contains it — "raven" is not Raven Navy Issue.
  check('search', 'an exact hull name outranks its variants', shipHits('raven')[0], 'Raven', 0);
  check('search', 'substring search still works', shipHits('ishtar')[0], 'Ishtar', 0);

  // The MID-WORD gate, asserted in BOTH directions. A long query must keep matching inside a compound
  // word: every one of the 70 hits for "burner" is mid-word in "Afterburner", so a regression here
  // EMPTIES the search rather than merely reordering it. A short one must not, which is what stopped
  // "te" returning 939 modules with the Enhancer buried in them.
  const nMatch = (slot, q, re) => modsIn(slot).filter((m) => nameMatchesQuery(m.name, q) && re.test(m.name)).length;
  check('search', '"burner" still finds Afterburners mid-word', rankOf('mid', 'burner', /^1MN Afterburner II$/), 1, 0);
  // A Stasis Grappler is a different module (short range, sig-scaled) and must not answer "web",
  // though pyfa's jargon table expands it to both. Its expansion outscored the literal hit, so the
  // grapplers led a search for "web" — they are now excluded outright, not merely deranked.
  check('search', '"web" returns no Stasis Grapplers', nMatch('mid', 'web', /Grappler/i), 0, 0);
  check('search', '"webifier" returns no Stasis Grapplers', nMatch('mid', 'webifier', /Grappler/i), 0, 0);
  // ...and the shorthands that mean the grappler still reach it, so this is a narrowing, not a loss.
  check('search', '"sg" still finds a Stasis Grappler', nMatch('mid', 'sg', /Grappler/i) > 0 ? 1 : 0, 1, 0);

  // ── OFF-MARKET MODULES ──────────────────────────────────────────────────────
  // The browser tree is CCP's market tree, so a module CCP does not sell has no node to live under
  // and was absent from the search corpus entirely — a Civilian Light Missile Launcher could only be
  // got into a fit by pasting EFT. Asserted by PROPERTY, not by a hand-listed set, because the point
  // is total coverage: every fittable non-abyssal module reachable, however the bundle is regenerated.
  const allOffMarket = Object.values(OFF_MARKET_MODULES).flat();
  check('search', 'off-market modules exist to backfill', allOffMarket.length > 0 ? 1 : 0, 1, 0);
  // Exactly once, across every slot: a module both in the tree and backfilled would list twice.
  check('search', 'no module is offered twice',
        allOffMarket.filter((m) => modsIn('high').concat(modsIn('mid'), modsIn('low'), modsIn('rigs'))
          .filter((x) => x.typeID === m.typeID).length !== 1).length, 0, 0);
  // Abyssal base types stay OUT: a mutated module is reached by rolling a mutaplasmid onto its source
  // module, and the bare base type has no rolled attributes to show.
  check('search', 'no Abyssal base type is offered', allOffMarket.filter((m) => metaOf(m.typeID, m.meta) === 'Abyssal').length, 0, 0);
  // Every one carries a real slot effect. guessSlotFromDogma DEFAULTS to "high", so a sweep that
  // trusted it would rake every unfittable category-7 type into the high-slot list.
  const SLOT_EFFECTS = [2663, 6306, 12, 13, 11];
  check('search', 'every off-market module has a real slot effect',
        allOffMarket.filter((m) => !SLOT_EFFECTS.some((e) => (TYPES[m.typeID]?.e ?? []).includes(e))).length, 0, 0);
  // Coverage: nothing fittable, published and non-abyssal is left unreachable in either list.
  const unreachable = Object.entries(TYPES).filter(([tidStr, t]) => {
    const id = Number(tidStr);
    if ((t.c ?? t.category) !== 7 || !t.n) return false;
    if (!SLOT_EFFECTS.some((e) => (t.e ?? []).includes(e))) return false;
    if (metaOf(id, null) === 'Abyssal') return false;
    return !['high', 'mid', 'low', 'rigs'].some((s) => modsIn(s).some((m) => m.typeID === id));
  });
  check('search', 'every fittable ship module is reachable', unreachable.length, 0, 0);

  // The reported gap, by name. Civilian gear is the visible half of it — only 4 of the 15 civilian
  // modules are on the market, so 11 were missing and the Civilian Miner looked like the only one.
  check('search', '"civilian" finds the Light Missile Launcher', rankOf('high', 'civilian', /^Civilian Light Missile Launcher$/) > 0 ? 1 : 0, 1, 0);
  check('search', '"lml" finds the Civilian launcher', rankOf('high', 'lml', /^Civilian Light Missile Launcher$/) > 0 ? 1 : 0, 1, 0);
  check('search', '"civilian" returns more than the Miner', nMatch('high', 'civilian', /^Civilian /), 9, 0);
  // ...and the half nobody would have reported: navy Bastion modules, officer drops, the Integrated
  // Sensor Array the Salvation baseline in section 5 is built on.
  check('search', '"bastion" finds the navy variants', nMatch('high', 'bastion', /Navy Bastion|Fleet Bastion/), 4, 0);
  check('search', 'the Integrated Sensor Array is reachable', rankOf('high', 'integrated sensor array', /^Integrated Sensor Array$/), 1, 0);
  check('search', '"cannon" still finds AutoCannons mid-word', nMatch('high', 'cannon', /AutoCannon/i) > 0 ? 1 : 0, 1, 0);
  check('search', '"te" no longer drags in mid-word noise', nMatch('low', 'te', /Setele|Co-Processor|Diagnostic/i), 0, 0);
  check('search', '"ac" no longer matches Tractor Beam', nMatch('high', 'ac', /Tractor Beam/i), 0, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 16. MODULE STATE GESTURES
//
// The state dot on a fit row is a control: tap = run/stop, double-tap = overheat, hold = offline.
// Two things are worth pinning. First that the gestures are TOTAL — every gesture from every legal
// state either lands on another legal state or refuses (null); anything else is a dot that puts a
// module into a state the engine will not honour. Second REACHABILITY: from wherever a module
// currently is, every other state it can legally hold is reachable using only these three gestures.
// That is what makes the dot self-sufficient as the only control on the row — a gesture set that can
// strand you (hold offlines but nothing brings it back) would send you to the module menu the dot
// exists to replace. Reachability is the right property here and self-inverse is NOT: applying a
// gesture from a THIRD state can't return you to where you started without remembering the trip
// (tap from `overheated` lands on `online`, and tapping again runs it, correctly).
//
// `validStatesFor` is driven off real module types rather than hand-written lists, so a bundle regen
// that changes an attribute shows up here instead of being assumed away.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nMODULE STATE GESTURES');
  const GESTURES = ['tap', 'double', 'hold'];
  const modOf = (name, type) => ({ typeID: tid(name), name, type: type ?? 'module' });

  // Four modules chosen for their SHAPES, not their stats: a heat-capable active module (all four
  // states), an activatable one that cannot overheat, a passive one (offline/online only), and a rig
  // (online only — no gesture does anything).
  // Damage Control II is the passive one, which is worth stating because it reads like an active
  // module: it carries no duration, no cycle and no cap cost, so it has never had an active state in
  // the module menu either.
  const shapes = [
    ['Heavy Neutron Blaster II', 'weapon', 4],
    ['Capital Gas Compressor I', 'module', 3],
    ['Damage Control II', 'module', 2],
    ['Small Core Defense Field Extender I', 'rig', 1],
  ];
  for (const [name, type, want] of shapes)
    check('gesture', `${name}: ${want} legal state(s)`, validStatesFor(modOf(name, type)).length, want, 0);

  // TOTALITY. Every (module, state, gesture) triple resolves to a legal state or to a refusal.
  let illegal = 0, transitions = 0;
  for (const [name, type] of shapes) {
    const states = validStatesFor(modOf(name, type));
    for (const cur of states) for (const g of GESTURES) {
      const next = gestureTarget(states, cur, g);
      if (next === null) continue;
      transitions++;
      if (!states.includes(next)) illegal++;
    }
  }
  check('gesture', 'no gesture reaches an illegal state', illegal, 0, 0);
  check('gesture', 'the gestures do something', transitions > 0 ? 1 : 0, 1, 0);

  // REACHABILITY. Walk the gesture graph from every legal state and require it to cover the rest of
  // them. What this catches is a SINK — a state with no way out — which is the failure that would
  // force you back into the module menu. `offline` is the state at risk: it has two exits (hold
  // restores it, tap runs it), so no single simplification strands you there, but a handler written
  // as "hold always offlines" plus "tap only toggles a running module" does, and that pairing is a
  // coherent enough design to be worth a guard.
  let unreachable = 0;
  for (const [name, type] of shapes) {
    const states = validStatesFor(modOf(name, type));
    for (const start of states) {
      const seen = new Set([start]), queue = [start];
      while (queue.length) {
        const cur = queue.shift();
        for (const g of GESTURES) {
          const next = gestureTarget(states, cur, g);
          if (next !== null && !seen.has(next)) { seen.add(next); queue.push(next); }
        }
      }
      unreachable += states.filter((s) => !seen.has(s)).length;
    }
  }
  check('gesture', 'every state is reachable from every other', unreachable, 0, 0);

  // The specific mapping the gestures were asked for, on a full four-state module.
  const full = validStatesFor(modOf('Heavy Neutron Blaster II', 'weapon'));
  check('gesture', 'tap runs an online module', gestureTarget(full, 'online', 'tap'), 'active', 0);
  check('gesture', 'tap stops an active module', gestureTarget(full, 'active', 'tap'), 'online', 0);
  // Tapping a hot module cools it — one step down to active, not all the way to stopped. Tap is the
  // undo for the double-tap that overheated it, so it has to land where that started.
  check('gesture', 'tap cools an overheated module to active', gestureTarget(full, 'overheated', 'tap'), 'active', 0);
  // Tap never offlines, on ANY shape from ANY state — hold is the only way off, so a mis-tap cannot
  // silently drop a module out of the fit's stats. Swept over every shape rather than asserted on the
  // four-state module alone, where it is vacuous: the shape that can get this wrong is the passive
  // one, whose only "stop" would have to be offline.
  let tapOfflines = 0;
  for (const [name, type] of shapes) {
    const states = validStatesFor(modOf(name, type));
    tapOfflines += states.filter((s) => gestureTarget(states, s, 'tap') === 'offline').length;
  }
  check('gesture', 'no tap on any module shape offlines it', tapOfflines, 0, 0);
  check('gesture', 'double-tap overheats', gestureTarget(full, 'active', 'double'), 'overheated', 0);
  check('gesture', 'hold offlines', gestureTarget(full, 'active', 'hold'), 'offline', 0);
  check('gesture', 'hold again restores it', gestureTarget(full, 'offline', 'hold'), 'online', 0);

  // A passive module has no active state, so the only thing tap could "stop" it into is offline —
  // and tap does not offline. It therefore brings the module online and then refuses, rather than
  // becoming a second, shorter offline gesture on exactly the modules (an EANM) where a stray tap is
  // most costly. Double-tap, which it cannot honour either, refuses instead of falling back.
  const passive = ['offline', 'online'];
  check('gesture', 'tap runs a passive module', gestureTarget(passive, 'offline', 'tap'), 'online', 0);
  check('gesture', 'tap refuses to offline a passive module',
    gestureTarget(passive, 'online', 'tap') === null ? 1 : 0, 1, 0);
  check('gesture', 'a passive module refuses overheat', gestureTarget(passive, 'online', 'double') === null ? 1 : 0, 1, 0);

  // A rig has exactly one state, so all three gestures must refuse. Silently doing nothing here is
  // what makes a control feel broken, so the caller needs the null to buzz instead.
  const rig = validStatesFor(modOf('Small Core Defense Field Extender I', 'rig'));
  check('gesture', 'a rig refuses every gesture',
    GESTURES.filter((g) => gestureTarget(rig, 'online', g) === null).length, 3, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 16b. MICRO JUMP DRIVES DEFAULT TO ONLINE, NOT ACTIVE
//
// Every other cycling module starts running when you fit it, which is the right default for a
// hardener or a repairer — but an MJD is a one-shot escape, not something you sit there cycling. Left
// active it charges the fit ~1000 GJ of cap it will never actually spend, so the cap column reads
// wrong on any fit carrying one.
//
// The bug was DRIFT between the two places a module's default state is decided: buildSlotsFromEFT
// (EFT paste and ESI import) already forced them online, and the in-app module browser did not — so
// the same fit read differently depending on how it was built. The rule now lives in ONE exported
// predicate that both call, and this section pins the predicate rather than either call site.
//
// Matching on the group name alone is not enough: the three capital MJDs are filed under "Capital
// Mobility Modules", so the type name is tested too. Anchoring that at the end is what keeps out the
// "Micro Jump Drive Operation" skill and the "Mobile Micro Jump Unit" / "Tournament Micro Jump Unit"
// deployables — none of which is ever fitted to a slot.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nMICRO JUMP DRIVE DEFAULT STATE');

  for (const n of ['Medium Micro Jump Drive', 'Large Micro Jump Drive', 'Capital Micro Jump Drive',
                   'Xarasier Medium Micro Jump Drive', 'Xarasier Large Micro Jump Drive',
                   'Xarasier Capital Micro Jump Drive', 'Micro Jump Field Generator',
                   'Capital Micro Jump Field Generator'])
    check('mjd', `${n} is an MJD`, isMicroJumpDrive(tid(n)) ? 1 : 0, 1, 0);

  // The near misses, each a different way the match could over-reach: a SKILL whose name starts with
  // the module's, two DEPLOYABLES that do the same job from a can, and the prop mods an MJD sits
  // beside in the mid rack and which must keep starting active.
  for (const n of ['Micro Jump Drive Operation', 'Mobile Micro Jump Unit', 'Tournament Micro Jump Unit',
                   '500MN Microwarpdrive II', '1MN Afterburner II', 'Damage Control II'])
    check('mjd', `${n} is not`, isMicroJumpDrive(tid(n)) ? 1 : 0, 0, 0);

  // Swept over the whole bundle, not just the names above: a regex written against a handful of names
  // can quietly swallow a group, and the count is what notices. Eight is every fittable MJD there is.
  let matched = 0;
  for (const id in TYPES) if (isMicroJumpDrive(id)) matched++;
  check('mjd', 'exactly the 8 fittable MJDs match', matched, 8, 0);

  // End to end through the import path, which is the half that was already correct — it is here so a
  // change to the shared predicate cannot fix one site and break the other.
  const eft = `[Megathron, MJD test]

Large Micro Jump Drive
500MN Quad LiF Restrained Microwarpdrive
`;
  const p = parseEFT(eft);
  const slots = buildSlotsFromEFT(lookupShip(p.shipName), p.mods, p.subsystems);
  const stateOf = (name) => slots.mid.find((m) => m.name === name)?.state;
  check('mjd', 'an imported MJD arrives online', stateOf('Large Micro Jump Drive'), 'online', 0);
  // The control: the module beside it in the same rack still starts running, so "online" is a rule
  // about MJDs and not a regression in the cycling default itself.
  check('mjd', 'an imported MWD still arrives active',
    stateOf('500MN Quad LiF Restrained Microwarpdrive'), 'active', 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 16c. FITTING GO/NO-GO — base costs measured against engine-computed headroom
//
// A user reported the Variations tab marking a swap as fitting, then going over CPU when he made it.
// It was a unit mismatch, not a rounding one: `used`/`total` come from calcFitStats and already carry
// skills, hull bonuses and engineering rigs, while the cost printed against each variant is
// deliberately its BASE attribute — which is what show-info says and what he wants to read. Backing
// the fitted module out at its BASE cost therefore frees room the fit never had.
//
// The Scimitar makes it plain because its role bonus halves remote shield booster CPU. The fit below
// is his, and it is already over: 568.5 tf used against 556.25 available. Swapping the third Pithum
// (base 78, charged 39) for a Gistum (base 61, charged 30.5) takes it to 560 — still over. The old
// arithmetic asked `61 <= 556.25 - 568.5 + 78`, i.e. is there 65.75 tf of room, and said yes.
//
// The fix is `fitCostFits`, which scales BOTH the incoming cost and the displaced one by the group's
// multiplier before comparing. Both checks below are kept, the old form beside the new, because the
// bug is only visible as the disagreement between them.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nFITTING GO/NO-GO (base cost vs engine headroom)');

  const scimEFT = (third) => `[Scimitar, nano rtc xlasb]

Damage Control II
True Sansha Capacitor Power Relay
True Sansha Power Diagnostic System
True Sansha Power Diagnostic System

50MN Cold-Gas Enduring Microwarpdrive
Multispectrum Shield Hardener II
Republic Fleet Large Shield Extender
Shadow Serpentis Remote Tracking Computer
X-Large Ancillary Shield Booster, Navy Cap Booster 400

Pithum C-Type Medium Remote Shield Booster
Pithum C-Type Medium Remote Shield Booster
${third}
Gistum C-Type Medium Remote Shield Booster

Medium Capacitor Control Circuit II
Medium Capacitor Control Circuit II
`;
  const scimStats = (third) => {
    const p = parseEFT(scimEFT(third));
    const ship = lookupShip(p.shipName);
    return calcFitStats(ship, buildSlotsFromEFT(ship, p.mods, p.subsystems), [], null, {});
  };
  const PITHUM = 'Pithum C-Type Medium Remote Shield Booster';
  const GISTUM = 'Gistum C-Type Medium Remote Shield Booster';
  const before = scimStats(PITHUM);
  const after  = scimStats(GISTUM);

  // The fit as he had it, and as it reads after the swap. Both over the 556.25 tf the hull provides,
  // which is what makes "won't fit" the right answer and the old mark a lie rather than a rounding
  // disagreement. These three matched his device to the decimal.
  check('gono', 'Scimitar cpuTotal', before.cpuTotal, 556.25, 1e-9);
  check('gono', 'cpuUsed with 3 Pithum', before.cpuUsed, 568.5, 1e-9);
  check('gono', 'cpuUsed after swapping one for a Gistum', after.cpuUsed, 560, 1e-9);

  // The multiplier itself. 0.5 is the Scimitar's role bonus to Shield Emission Systems CPU; the two
  // controls are there because a map that returned 0.5 for everything would pass the check above.
  const ratios = before.fitCostRatios;
  const hr = { pg:  {used:before.pgUsed,  total:before.pgTotal},
               cpu: {used:before.cpuUsed, total:before.cpuTotal},
               cal: {used:before.calUsed, total:before.calTotal}, ratios };
  check('gono', 'remote shield boosters are charged half CPU', fitCostRatioOf(hr, tid(PITHUM))?.cpu, 0.5, 1e-9);
  check('gono', 'the MWD is charged full CPU', fitCostRatioOf(hr, tid('50MN Cold-Gas Enduring Microwarpdrive'))?.cpu, 1, 1e-9);
  // Not every reduction is a hull bonus: Shield Upgrades takes 25% off a shield extender's POWERGRID
  // and nothing off its CPU, so the two resources have to be tracked apart.
  const ext = fitCostRatioOf(hr, tid('Republic Fleet Large Shield Extender'));
  check('gono', 'shield extender powergrid is skill-reduced', ext?.pg, 0.75, 1e-9);
  check('gono', 'shield extender CPU is not', ext?.cpu, 1, 1e-9);

  // The bug and the fix, side by side, on the exact swap he made. `m = 1` is the arithmetic that
  // shipped; anything that makes the second of these come out true has reintroduced it.
  const baseCpuOf = (n) => TYPES[tid(n)]?.attrs?.cpu ?? TYPES[String(tid(n))]?.a?.cpu;
  check('gono', 'Pithum base CPU', baseCpuOf(PITHUM), 78, 1e-9);
  check('gono', 'Gistum base CPU', baseCpuOf(GISTUM), 61, 1e-9);
  check('gono', 'unscaled, the swap wrongly reads as fitting',
    fitCostFits(hr.cpu, baseCpuOf(GISTUM), baseCpuOf(PITHUM), 1) ? 1 : 0, 1, 0);
  check('gono', 'scaled, the swap correctly reads as not fitting',
    fitCostFits(hr.cpu, baseCpuOf(GISTUM), baseCpuOf(PITHUM), fitCostRatioOf(hr, tid(PITHUM)).cpu) ? 1 : 0, 0, 0);
  // Powergrid on the same swap is unaffected and must stay a yes — the fix is not "flag more things".
  check('gono', 'the same swap still fits on powergrid',
    fitCostFits(hr.pg, TYPES[tid(GISTUM)].attrs.power, TYPES[tid(PITHUM)].attrs.power, 1) ? 1 : 0, 1, 0);

  // The BROWSER case: an empty slot, so nothing is displaced and `base` is 0. A 78 tf module charged
  // 39 fits in 50 tf of room; unscaled it would be turned away. The null ratio is the fallback for a
  // group nothing is fitted from yet — it errs toward flagging early, which is the old behaviour.
  const room = {used: 0, total: 50};
  check('gono', 'browser: a half-price module fits the room it really needs',
    fitCostFits(room, 78, 0, 0.5) ? 1 : 0, 1, 0);
  check('gono', 'browser: at face value it would not',
    fitCostFits(room, 78, 0, 1) ? 1 : 0, 0, 0);
  check('gono', 'browser: an unknown group falls back to face value',
    fitCostFits(room, 78, 0, fitCostRatioOf(hr, tid('Large Shield Booster II'))?.cpu) ? 1 : 0, 0, 0);
  // No headroom at all is "no opinion", not "won't fit" — the browser can be opened without a fit.
  check('gono', 'no headroom means no mark', fitCostFits(null, 78, 0, 1) === null ? 1 : 0, 1, 0);

  // ── Why ONE ratio per group is enough to colour a whole variant family ──
  // The Variations tab derives the multiplier from the FITTED module and scales every row by it.
  // That is only sound while all members of a family are charged the same fraction, which they are:
  // fitting-reduction modifiers filter on dogma group and on required skills, and neither varies
  // across a family. It holds even where a family straddles two groups — the Medium Ancillary Remote
  // Shield Booster is its own group and still takes the Scimitar's 0.5.
  //
  // Swept rather than asserted on one pair, because the thing that would break it is a future bonus
  // filtered on something finer (meta level, tech level), and that would show up on some members and
  // not others. If this ever fails, the tab has to stop sharing a ratio — not have the count updated.
  for (const [hull, rack, seed] of [['Scimitar', 'high', PITHUM],
                                    ['Megathron', 'high', 'Heavy Neutron Blaster II'],
                                    ['Guardian',  'high', 'Large Remote Armor Repairer II']]) {
    const ship = lookupShip(hull);
    const fam = variantsOf(tid(seed));
    const seen = new Set();
    for (const v of fam) {
      const cs = calcFitStats(ship, {...EMPTY, [rack]: [{typeID: v.typeID, state: 'online'}]}, [], null, {});
      const r = fitCostRatioOf({ratios: cs.fitCostRatios}, v.typeID);
      if (r) seen.add(`${r.cpu.toFixed(6)}/${r.pg.toFixed(6)}`);
    }
    check('gono', `${hull}: ${fam.length} ${seed} variants share one fitting multiplier`, seen.size, 1, 0);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 17. MODULE REACTIVATION DELAY — a bomber's bomb DPS, and the skill-prescale ordering
//
// A user reported a Hound with one Bomb Launcher II reading 580 DPS against pyfa's 74.8. Two
// independent bugs stacked up, and either one alone still gives a plausible-looking wrong number:
//
//   1. `moduleReactivationDelay` was read NOWHERE in the codebase. A bomb launcher is forced idle
//      for 67.5 s between 10 s cycles, so it fires once every 77.5 s — but DPS, cap use and the
//      damage-over-time graph all divided by the raw cycle. That alone is the reported 580. 56 types
//      carry the attribute (cloaks, cynos, Assault Damage Controls, MJDs, Interdiction Nullifiers,
//      Warp Core Stabilizers), so this was never only about bombs — hence the cap checks below.
//   2. Bomb Deployment's PRESCALE effect (8469, which multiplies the skill's own bonus attr by
//      attr 280 = skillLevel) is listed AFTER its consumer (3036), so the -10%/lvl arrived flat
//      instead of x5 and left the delay at 121.5 s. A scan found 35 modifiers across ~24 skills in
//      the same shape, so the fix is a general ordering pass in the engine, not a Bomb Deployment
//      case — and no other baseline in this suite moves, which is what says it is safe.
//
// eos: getWeaponDps() 74.83870967741936 (identical with factorReload on or off — the 10 s reload
// hides entirely inside the 67.5 s idle), volley 5800.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nMODULE REACTIVATION DELAY');

  // The cycle model itself, ported from eos's Module.getCycleParameters(). The reload only shows up
  // when it is LONGER than the forced idle, because the two run concurrently — that branch is the
  // one that reads like a bug when you skim it.
  check('delay', 'delay adds to the cycle', effectiveCycleMs(10000, 67500), 77500, 0);
  check('delay', 'no delay reduces to cycle + reload/clip', effectiveCycleMs(10000, 0, 4, 10000), 12500, 0);
  check('delay', 'reload hides inside a longer delay', effectiveCycleMs(10000, 67500, 4, 10000), 77500, 0);
  // Reload longer than the delay: the delay covers the non-boundary cycles, the reload the last one.
  check('delay', 'a longer reload wins at the clip boundary', effectiveCycleMs(10000, 2000, 4, 10000), 14000, 0);
  check('delay', 'no delay and no clip is just the cycle', effectiveCycleMs(10000), 10000, 0);

  const hound = calcFitStats({ typeID: tid('Hound'), name: 'Hound' },
    { high: [M('Bomb Launcher II', 'active', 'Concussion Bomb')], mid: [], low: [], rigs: [] }, [], null, {});
  check('delay', 'Hound bomb DPS', hound.weaponDps.total, 74.83870967741936, 1e-9);
  check('delay', 'Hound bomb volley', hound.weaponVolley.total, 5800, 0);
  // 75 s base, -50% at Bomb Deployment V. Reading 67.5 here is what proves BOTH the skill being
  // trained and the prescale running before its consumer: untrained gives 135 s, and trained but
  // mis-ordered gives 121.5 s. It also proves the delay reached the graph, which divides by it.
  check('delay', 'trained + prescaled bomb launcher idle (s)', hound.graphWeapons[0].delayS, 67.5, 1e-9);

  // Cap is spent once per ACTIVATION, so the same divisor governs cap use — and these two modules
  // are the reason this is not a weapons-only fix. eos capUse: 0.2186 and 1.0423 GJ/s.
  const capOf = (name, rack) => calcFitStats({ typeID: tid('Rifter'), name: 'Rifter' },
    { high: [], mid: [], low: [], rigs: [], [rack]: [M(name, 'active')] }, [], null, {}).capDrainPS;
  check('delay', 'Assault Damage Control II cap use GJ/s', capOf('Assault Damage Control II', 'low'), 0.2185792349726776, 1e-9);
  check('delay', 'Medium Micro Jump Drive cap use GJ/s', capOf('Medium Micro Jump Drive', 'mid'), 1.0423280423280423, 1e-9);
}

// ─────────────────────────────────────────────────────────────────────────────
// 18. FIGHTER SKILLS — read from the pilot's sheet, and gated on the fighter requiring them
//
// Fighters never enter the dogma engine (calc.js composes their multipliers by hand), so the skill
// levels and the skill FILTERS both have to be applied there. Neither was:
//
//   1. A single `lvl = 5` stood in for Fighters, Drone Interfacing, the racial Fighter
//      Specialization, Heavy Fighters, Drone Navigation and Drone Durability. Correct for the all-V
//      default and wrong for every other pilot, which is why no baseline here could catch it — a
//      character synced from ESI at Drone Interfacing IV still read fighter DPS as if at V.
//   2. eos gates every fighter bonus on the FIGHTER requiring the skill, and a Standup (structure)
//      fighter requires nothing at all — the same rule as structure charges taking no missile
//      skills. Ungated, we handed them Fighters V and Drone Interfacing V anyway.
//
// Found by a skill-sensitivity sweep (scripts/oracle/skill_sweep.py) that zeroes one skill at a
// time in both engines and compares how far each stat moves — a skill we ignore shows up as a zero
// delta against a live one, which comparing all-V totals can never reveal.
//
// eos numbers below come from that harness. Note that in eos one Fighter object IS one squadron
// (`amount` is fighters WITHIN it), so nine squadrons is nine appended objects, not amount=9.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nFIGHTER SKILLS');

  const carrier = (fighter, skills) => calcFitStats(
    { typeID: tid('Thanatos'), name: 'Thanatos' },
    { high: [], mid: [M('Networked Sensor Array', 'active')], low: [M('Capital Armor Repairer II', 'active')], rigs: [] },
    [], skills, { fighters: [{ typeID: tid(fighter), name: fighter, qty: 9, active: true }] },
  ).fighterDps.total;
  const lower = (key) => ({ ...SKILLS_ALL_V, [key]: 0 });

  // All V is unchanged by the fix — that is the point, and it is what made the bug invisible.
  check('fighter', 'Thanatos + 9 Firbolg I, all V', carrier('Firbolg I', null), 4718.973214285713, 1e-9);
  check('fighter', 'Drone Interfacing 0 (-1/3)', carrier('Firbolg I', lower('droneInterfacing')), 3145.9821428571436, 1e-9);
  check('fighter', 'Fighters 0 (-1/5)', carrier('Firbolg I', lower('fighters')), 3775.1785714285716, 1e-9);

  // The racial specialization is named by the fighter, not guessed from "T2 and light": a Firbolg II
  // asks for the Gallente one, so the Amarr one must leave it alone. A T1 Firbolg asks for neither.
  check('fighter', 'Thanatos + 9 Firbolg II, all V', carrier('Firbolg II', null), 5733.823660714287, 1e-9);
  check('fighter', 'Gallente Fighter Spec 0', carrier('Firbolg II', lower('gallenteFighterSpecialization')), 5212.566964285713, 1e-9);
  check('fighter', 'Amarr Fighter Spec 0 (wrong race, inert)', carrier('Firbolg II', lower('amarrFighterSpecialization')), 5733.823660714287, 1e-9);
  check('fighter', 'Gallente Fighter Spec 0 on a T1 fighter (inert)', carrier('Firbolg I', lower('gallenteFighterSpecialization')), 4718.973214285713, 1e-9);

  // Standup fighters carry an EMPTY required-skill list, so no personal skill reaches them. Zeroing
  // the two that dominate a ship fighter's damage must not move this number at all.
  const sotiyo = (skills) => calcFitStats({ typeID: tid('Sotiyo'), name: 'Sotiyo' },
    { high: [], mid: [], low: [], rigs: [] }, [], skills,
    { fighters: [{ typeID: tid('Standup Templar II'), name: 'Standup Templar II', qty: 1, active: true }] },
  ).fighterDps.total;
  check('fighter', 'Sotiyo + Standup Templar II', sotiyo(null), 555.8142857142857, 1e-9);
  check('fighter', 'Standup ignores Drone Interfacing', sotiyo(lower('droneInterfacing')), 555.8142857142857, 1e-9);
  check('fighter', 'Standup ignores Fighters', sotiyo(lower('fighters')), 555.8142857142857, 1e-9);
}

// ─────────────────────────────────────────────────────────────────────────────
// 19. MAX ACTIVE DRONES — the limit bandwidth cannot express
//
// Drone bandwidth is not a drone count, and on most drone boats it is the looser of the two: a
// Vexor's 75 Mbit flies seven mediums, the game flies five. Nothing in the app knew the count limit
// existed, so a fit could be drawn with more drones in space than it can legally launch.
//
// It cannot be read off the engine. BOTH contributing effects target domain='charID' — the pilot,
// not the ship — which the dispatcher skips, so ship.get('maxActiveDrones') is 0 for every hull in
// the game. calc.js therefore composes it by hand, exactly as it does the fighter skills above, and
// these checks are what stop that hand-rolled copy drifting.
//
// The pieces, both confirmed against eos (Effect918 / the Drones skill handler in eos/effects.py):
//   * the DRONES skill carries maxActiveDroneBonus = 1 and grants that per level, so all-V is 5;
//   * the Guardian-Vexor — the ONLY type in the bundle carrying effect 918 — adds shipBonusGC2,
//     +1 per Gallente Cruiser level, which reaches calc.js already pre-scaled by that skill.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nMAX ACTIVE DRONES');

  const maxDrones = (ship, skills) => calcFitStats({ typeID: tid(ship), name: ship },
    { high: [], mid: [], low: [], rigs: [] }, [], skills, {}).maxActiveDrones;

  check('drones', 'Vexor, all V', maxDrones('Vexor', null), 5, 0);
  check('drones', 'Rifter (no drone bay at all)', maxDrones('Rifter', null), 5, 0);

  // The Ishtar is the check with teeth for "bandwidth is not the limit": it carries 125 Mbit — the
  // same as the Guardian-Vexor and more than the Vexor — and still flies five.
  check('drones', 'Ishtar flies 5 despite 125 Mbit', maxDrones('Ishtar', null), 5, 0);

  // The one exception in the game. Five from the skill, five from the hull.
  check('drones', 'Guardian-Vexor, all V', maxDrones('Guardian-Vexor', null), 10, 0);

  // Read from the pilot, not hardcoded — an ESI-synced character at Drones III launches three. The
  // hull bonus is scaled by GALLENTE CRUISER, not by Drones, so it stays at 5 while the base falls.
  const dronesIII = { ...SKILLS_ALL_V, drones: 3 };
  check('drones', 'Vexor at Drones III', maxDrones('Vexor', dronesIII), 3, 0);
  check('drones', 'Guardian-Vexor at Drones III', maxDrones('Guardian-Vexor', dronesIII), 8, 0);
  check('drones', 'Guardian-Vexor at Gallente Cruiser III',
        maxDrones('Guardian-Vexor', { ...SKILLS_ALL_V, gallenteCruiser: 3 }), 8, 0);
}

// 20. ABYSSAL DRONE FIT — a real pyfa export (Alligator + a rolled Caldari Navy Vespa), exercising
//     the abyssal-drone feature end to end: parseEFT reads the drone's mutaplasmid block, calcFitStats
//     applies the roll, and the Alligator's own +500%/+250% drone role bonuses (Effect5821/7184-7186,
//     both OwnerRequiredSkillModifier off "Medium Drone Operation", unpenalised) stack with Drone
//     Interfacing, DDA IIs and the Dread Guristas DDA on top of it.
//
//     droneDps first came out ~10% under a hand-read pyfa screenshot (469.2 vs "516"), and a
//     hand-built oracle script matched our WRONG number byte-for-byte — a false-confirming match,
//     because both were built under the same missing-skill assumption. The real gap: "Mutated Drone
//     Specialization" (typeID 60515), a skill that exists ONLY to buff abyssal drones and was
//     entirely unwired — not in SKILL_DEFAULTS, so the engine's skill pass never saw it at all.
//
//     Worse, even with the skill added, `requiresSkill()` alone would still have missed it. A
//     mutated drone's SDE identity is swapped to a size-specific placeholder type (pyfa:
//     getItemWithBaseItemAttribute) — "Medium Mutated Drone" (60479) for this Vespa — whose OWN
//     requiredSkillN list is ["Drones","Medium Drone Operation","Mutated Drone Specialization"],
//     one entry longer than the real Caldari Navy Vespa's (31874: ["Medium Drone Operation","Drones"]).
//     We mutate the base item's attributes in place rather than swapping typeID, so `requiresSkill()`
//     (dogma-engine.js) now special-cases it: a mutated drone requires "Mutated Drone Specialization"
//     regardless of what its base type's requiredSkillN says. Every other drone skill (Drone
//     Interfacing, Medium Drone Operation, the racial specializations) was unaffected — those are all
//     already on the real Vespa's own requirement list.
//
//     Confirmed by pyfa's Attributes/Affected-by tabs on the real fit: "Mutated Drone Specialization:
//     Damage Modifier * 1.10" (2%/level × V), a row the un-fixed engine could never produce since the
//     skill wasn't loaded at all. 29.325 (our old, wrong damageMultiplier) × 1.10 = 32.26 ≈ pyfa's
//     displayed "32.3x" — and 469.2 × 1.10 = 516.1, exactly the screenshot's "516". droneDps is now
//     516.1250766743026, volley 2064.5003066972104. maxVelocityAB (5622) and alignTime (36.69) were
//     already exact matches and are pinned alongside as a sanity check that the rest of the fit (MWD,
//     rigs, implants, boosters) is unaffected by the drone roll.
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nABYSSAL DRONE FIT (Alligator)');

  const ALLIGATOR_EFT = `[Alligator, AIRCRAFT CARRIER copy]

Drone Damage Amplifier II
Drone Damage Amplifier II
Dread Guristas Drone Damage Amplifier
True Sansha Power Diagnostic System

500MN Y-T8 Compact Microwarpdrive
Sentient Drone Navigation Computer
Sentient Drone Navigation Computer
Sensor Booster II, Targeting Range Script
Sentient Omnidirectional Tracking Link, Tracking Speed Script
Sentient Omnidirectional Tracking Link, Tracking Speed Script

Skirmish Command Burst II, Rapid Deployment Charge
Drone Link Augmentor II
Drone Link Augmentor II
Drone Link Augmentor II
Drone Link Augmentor II
Small Remote Shield Booster II
[Empty High slot]

Medium Ancillary Current Router II
Medium Drone Durability Enhancer II
Medium Ionic Field Projector I


Caldari Navy Vespa x2 [1]


High-grade Snake Alpha
High-grade Snake Beta
High-grade Snake Gamma
High-grade Snake Delta
High-grade Snake Epsilon
High-grade Snake Omega
Eifyr and Co. 'Rogue' Evasive Maneuvering EM-705
Zor's Custom Navigation Hyper-Link
Eifyr and Co. 'Gunslinger' Surgical Strike SS-905
Skirmish Command Mindlink

Strong Mindflood Booster
Agency 'Overclocker' SB7 Dose III


[1] Caldari Navy Vespa
  Exigent Medium Drone Durability Mutaplasmid
  armorHP 336.0, damageMultiplier 1.6, falloff 3300.0, hp 300.0, maxRange 4800.0, maxVelocity 2308.2, shieldCapacity 1084.0, trackingSpeed 0.778
`;

  const p = parseEFT(ALLIGATOR_EFT);
  const ship = lookupShip(p.shipName);
  const slots = buildSlotsFromEFT(ship, p.mods, p.subsystems);
  check('alligator', 'drone parsed with its roll', p.drones?.[0]?.mutaplasmid, '60474', 0);

  const st = calcFitStats(ship, slots, p.drones ?? [], SKILLS_ALL_V, {
    implants: p.implantNames ?? [],
    boosters: (p.boosterNames ?? []).map(n => ({ name: n, active: true })),
  });

  // Hard baselines — match pyfa's "Mutated Drone Specialization" damage row and the original
  // screenshot's 516 DPS / 2065 volley (see comment above).
  check('alligator', 'drone DPS', st.droneDps.total, 516.1250766743026, 1e-5);
  check('alligator', 'drone volley', st.droneVolley.total, 2064.5003066972104, 1e-5);
  check('alligator', 'maxVelocityAB (MWD)', st.maxVelocityAB, 5622, 0);
  check('alligator', 'align time', st.alignTime, 36.69, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(72));
if (failures.length === 0) {
  console.log(`ALL ${passed} REGRESSION CHECKS PASSED`);
  process.exit(0);
} else {
  console.log(`${passed} passed, ${failures.length} FAILED:\n`);
  for (const f of failures) console.log(`  ✗ [${f.group}] ${f.label}: got ${f.actual}, expected ${f.expected}`);
  console.log('\nThese baselines are validated against pyfa v2.68.0. A failure means the code');
  console.log('regressed — do NOT update the expected values without re-checking against pyfa.');
  process.exit(1);
}
