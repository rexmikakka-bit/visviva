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

import { calcFitStats, applyRemoteRepDiminishing, checkFitSkills, computeCommandBursts, computeProjectedReps, projectionResistances, SKILL_CATALOG, SKILL_BY_TYPEID, TYPES } from './calc.js';
import { typeIDByName } from './dogma-engine-init.js';
import shipsData from './data/ships.json' with { type: 'json' };
import { TARGET_PROFILES } from './data/target-profiles.js';
import SYSFX from './data/system-effects.json' with { type: 'json' };
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
