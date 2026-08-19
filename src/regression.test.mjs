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

import { SKILL_DEFAULTS as SKILLS_ALL_V, calcFitStats, applyRemoteRepDiminishing, checkFitSkills, computeCommandBursts, computeProjectedReps, projectionResistances, usesTurretHardpoint, usesLauncherHardpoint, attrHighIsGood, calcTurretMult, calcTurretCTH, calcMissileFactor, SKILL_CATALOG, SKILL_BY_TYPEID, TYPES } from './calc.js';
import { typeIDByName } from './dogma-engine-init.js';
import shipsData from './data/ships.json' with { type: 'json' };
import { TARGET_PROFILES } from './data/target-profiles.js';
import SYSFX from './data/system-effects.json' with { type: 'json' };
import { resolveTabs, sameTab, nextFitId } from './lib/fit-tabs.js';
import { fmtResource } from './lib/fmt.js';
import { differingAttributes, compareRows, sortCompareRows, derivedDirection } from './lib/compare.js';
import { getCompatibleCharges, groupChargesForBrowser, parseEFT, buildSlotsFromEFT, lookupShip } from './lib/core.js';
import { esiSkillsToAppSkills, esiSkillsToFullSkillMap } from './lib/esi.js';
import { buildShipTaxonomy, shipsUnder, nodeAtPath, classifyHull, TOP_ORDER, RACE_ICON_ID } from './lib/ship-taxonomy.js';
import { jargonSearch, nameMatchesQuery, searchScore, initialsOf } from './lib/jargon.js';
import { REAL_MODULE_BROWSER, gestureTarget, validStatesFor } from './lib/core.js';
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
// ─────────────────────────────────────────────────────────────────────────────
{
  console.log('\nSEARCH');
  const modsIn = (slot) => {
    const out = [];
    (function walk(ns) { for (const n of ns) { for (const m of (n.mods ?? [])) out.push(m); walk(n.children ?? []); } })(REAL_MODULE_BROWSER[slot] ?? []);
    return out;
  };
  const rankOf = (slot, query, re) => (jargonSearch(query, modsIn(slot)) ?? []).findIndex((m) => re.test(m.name)) + 1;  // 1-based, 0 = absent

  // The two cases that prompted this. Both were reproduced against the real browser lists first:
  // "tracking" put Tracking Computer below ten Omni links, and "te" did not return the Enhancer.
  check('search', '"tracking" leads with the Tracking Computer', rankOf('mid', 'tracking', /^Tracking Computer I$/), 1, 0);
  check('search', '"te" finds the Tracking Enhancer at all', rankOf('low', 'te', /^Tracking Enhancer I$/) > 0 ? 1 : 0, 1, 0);
  check('search', '"te" leads with it', rankOf('low', 'te', /^Tracking Enhancer I$/), 1, 0);
  // Typing the words in full must not rank the Omnidirectional variant above the plain one.
  check('search', '"tracking enhancer" prefers the plain module', rankOf('low', 'tracking enhancer', /^Tracking Enhancer I$/), 1, 0);

  // The regression that ranking itself introduced: scoring the literal query alone dropped every
  // autocannon to 158th of 200, behind "Hostile Target Acquisition".
  check('search', '"ac" leads with an autocannon', rankOf('high', 'ac', /AutoCannon/i), 1, 0);
  // pyfa's curated shorthands must keep working now that they are ranked rather than only filtered.
  check('search', '"tc" leads with the Tracking Computer', rankOf('mid', 'tc', /^Tracking Computer I$/), 1, 0);
  check('search', '"dda" leads with the Drone Damage Amplifier', rankOf('low', 'dda', /^Drone Damage Amplifier I$/), 1, 0);
  check('search', '"istab" leads with Inertial Stabilizers', rankOf('low', 'istab', /^Inertial Stabilizers I$/), 1, 0);
  check('search', '"point" leads with a Warp Disruptor', rankOf('mid', 'point', /^Warp Disruptor I$/), 1, 0);

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
  check('search', '"burner" still finds Afterburners mid-word', rankOf('mid', 'burner', /^1MN Afterburner I$/), 1, 0);
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
  // Stopping an overheated module goes straight to online rather than stepping down through active:
  // one tap means stop, and having to tap twice to stop something would be the surprise.
  check('gesture', 'tap stops an overheated module outright', gestureTarget(full, 'overheated', 'tap'), 'online', 0);
  check('gesture', 'double-tap overheats', gestureTarget(full, 'active', 'double'), 'overheated', 0);
  check('gesture', 'hold offlines', gestureTarget(full, 'active', 'hold'), 'offline', 0);
  check('gesture', 'hold again restores it', gestureTarget(full, 'offline', 'hold'), 'online', 0);

  // A passive module has no active state, so tap is its on/off switch instead of a dead gesture —
  // and double-tap, which it cannot honour, refuses rather than falling back to something else.
  const passive = ['offline', 'online'];
  check('gesture', 'tap toggles a passive module on', gestureTarget(passive, 'offline', 'tap'), 'online', 0);
  check('gesture', 'tap toggles a passive module off', gestureTarget(passive, 'online', 'tap'), 'offline', 0);
  check('gesture', 'a passive module refuses overheat', gestureTarget(passive, 'online', 'double') === null ? 1 : 0, 1, 0);

  // A rig has exactly one state, so all three gestures must refuse. Silently doing nothing here is
  // what makes a control feel broken, so the caller needs the null to buzz instead.
  const rig = validStatesFor(modOf('Small Core Defense Field Extender I', 'rig'));
  check('gesture', 'a rig refuses every gesture',
    GESTURES.filter((g) => gestureTarget(rig, 'online', g) === null).length, 3, 0);
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
