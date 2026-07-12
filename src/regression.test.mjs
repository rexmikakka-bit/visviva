/**
 * regression.test.mjs — pyfa-validated baselines. Zero dependencies; run with:
 *
 *     node src/regression.test.mjs
 *
 * Exits 1 on any failure, so it can gate a PR in CI.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every number below was validated by hand against pyfa v2.67.0 with all skills at V. They are not
 * "whatever the code currently prints" — they are the correct answers, and several of them cost a
 * lot of digging to establish. If you change calc.js, dogma-engine.js or the dogma-*.json bundles
 * and one of these moves, you have broken something real. Do not "fix" the test to match new output
 * without re-validating against pyfa first.
 *
 * Tolerances are relative. Where a baseline differs slightly from pyfa's displayed figure, the pyfa
 * value is given in the comment and the tolerance covers the known rounding gap (pyfa rounds its
 * displayed repair/EHP numbers; our value is the more precise one).
 */

import { calcFitStats } from './calc.js';
import { typeIDByName } from './dogma-engine-init.js';
import shipsData from './data/ships.json' with { type: 'json' };

const tid = (n) => typeIDByName(n);
const M = (name, state, ammo) => ({ typeID: tid(name), state, ammo });
const EMPTY = { high: [], mid: [], low: [], rigs: [] };
const resistStr = (r) => [r.em, r.th, r.kin, r.exp].map((v) => v.toFixed(1)).join('/');

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
// 6. ALL HULLS COMPUTE — every ship must produce stats without throwing.
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
  console.log('\nThese baselines are validated against pyfa v2.67.0. A failure means the code');
  console.log('regressed — do NOT update the expected values without re-checking against pyfa.');
  process.exit(1);
}
