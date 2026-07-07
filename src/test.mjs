/**
 * test.mjs — Node.js test harness for the dogma engine
 * 
 * Usage:  node test.mjs
 * From:   pyfa-mobile/src/ directory  (or adjust DATA_DIR below)
 *
 * Runs the "strong" Vargur fit and prints a comparison table against Pyfa All-Skills-V values.
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

// ── Paths ──────────────────────────────────────────────────────────────────
const __dirname   = path.dirname(fileURLToPath(import.meta.url));
// Try src/data/ first (production), fall back to same dir (dev/CI)
import { existsSync } from 'fs';
const DATA_DIR = existsSync(path.join(__dirname, 'data', 'dogma-types.json'))
  ? path.join(__dirname, 'data')
  : __dirname;
const ENGINE_PATH = pathToFileURL(path.join(__dirname, 'dogma-engine.js')).href;

// ── Load JSON data ─────────────────────────────────────────────────────────
const TYPES_DATA   = JSON.parse(readFileSync(path.join(DATA_DIR, 'dogma-types.json'),   'utf8'));
const EFFECTS_DATA = JSON.parse(readFileSync(path.join(DATA_DIR, 'dogma-effects.json'), 'utf8'));
const ATTRS_DATA   = JSON.parse(readFileSync(path.join(DATA_DIR, 'dogma-attrs.json'),   'utf8'));

// ── Import engine ──────────────────────────────────────────────────────────
const eng = await import(ENGINE_PATH);
const { initEngine, Fit } = eng;
// Note: TYPES, AID, typeIDByName are accessed via eng.* after initEngine() to get live bindings
initEngine(TYPES_DATA, EFFECTS_DATA, ATTRS_DATA);
// Now safe to alias — initEngine() has populated these
const TYPES        = eng.TYPES;
const AID          = eng.AID;
const typeIDByName = eng.typeIDByName;

// ── Helper: look up typeID by name ─────────────────────────────────────────
const tid = (name) => {
  const id = typeIDByName(name);
  if (!id) throw new Error(`Unknown type: "${name}"`);
  return id;
};

// ── Stacking formula (duplicated from calc.js for standalone use) ──────────
const PEAK_FRAC = Math.sqrt(0.25) * (1 - Math.sqrt(0.25));  // ≈ 0.25

// ── Build the "strong" Vargur fit ─────────────────────────────────────────
const fit = new Fit(28665);  // Vargur

// Skills (All-V profile matching Pyfa screenshot)
// Names must match Pyfa's "Proper Name" format (used by fit.setSkill)
const skills = {
  'CPU Management': 5, 'Power Grid Management': 5,
  'Weapon Upgrades': 5, 'Advanced Weapon Upgrades': 5,
  'Capacitor Management': 5, 'Capacitor Systems Operation': 5,
  'Shield Management': 5, 'Shield Operation': 5,
  'Repair Systems': 5, 'Hull Upgrades': 5, 'Mechanics': 5,
  'Gunnery': 5, 'Rapid Firing': 5, 'Surgical Strike': 5,
  'Large Projectile Turret': 5, 'Trajectory Analysis': 5, 'Motion Prediction': 5,
  'Large Autocannon Specialization': 5, 'Sharpshooter': 5,
  'Minmatar Battleship': 5, 'Marauders': 5,
  'Navigation': 5, 'Evasive Maneuvering': 5,
  'Long Range Targeting': 5, 'Target Management': 5, 'Signature Analysis': 5,
  'Ladar Sensor Compensation': 5,
  'Shield Rigging': 5, 'Armor Rigging': 5, 'Astronautic Rigging': 5,
  'Shield Compensation': 5,
  'High Speed Maneuvering': 5, 'Propulsion Jamming': 5,
  'Capacitor Emission Systems': 5,
};
for (const [name, level] of Object.entries(skills)) fit.setSkill(name, level);

// Modules (high → mid → low → rigs)
const activeModules = [
  { name: '800mm Repeating Cannon II',                    state: 'active' },
  { name: '800mm Repeating Cannon II',                    state: 'active' },
  { name: '800mm Repeating Cannon II',                    state: 'active' },
  { name: '800mm Repeating Cannon II',                    state: 'active' },
  { name: 'True Sansha Heavy Energy Neutralizer',         state: 'active' },
  { name: 'Bastion Module I',                             state: 'active' },
  { name: 'Corpus C-Type Heavy Energy Neutralizer',       state: 'active' },
  { name: 'Pithum C-Type Multispectrum Shield Hardener',  state: 'active' },
  { name: 'Shadow Serpentis 500MN Microwarpdrive',        state: 'active' },
  { name: 'Pithum C-Type Multispectrum Shield Hardener',  state: 'active' },
  { name: 'True Sansha Heavy Capacitor Booster',          state: 'active' },
  { name: 'Caldari Navy Warp Scrambler',                  state: 'active' },
  { name: 'Gist X-Type X-Large Shield Booster',          state: 'active' },
  { name: 'Domination Gyrostabilizer',                    state: 'online' },
  { name: 'Domination Gyrostabilizer',                    state: 'online' },
  { name: 'Domination Gyrostabilizer',                    state: 'online' },
  { name: 'Domination Gyrostabilizer',                    state: 'online' },
  { name: 'Domination Tracking Enhancer',                 state: 'online' },
  { name: 'Damage Control II',                            state: 'active' },
  { name: 'Large Core Defense Operational Solidifier II', state: 'online' },
  { name: 'Large Core Defense Operational Solidifier II', state: 'online' },
];
for (const { name, state } of activeModules) {
  try { fit.addModule(tid(name), state); }
  catch (e) { console.warn(`  ⚠ Module "${name}": ${e.message}`); }
}

// Implants (exactly matching the "strong" fit)
const implants = [
  'Mid-grade Crystal Alpha', 'Mid-grade Crystal Beta', 'Mid-grade Crystal Gamma',
  'Mid-grade Crystal Delta', 'Mid-grade Crystal Epsilon', 'Mid-grade Crystal Omega',
  "Eifyr and Co. 'Gunslinger' Motion Prediction MR-705",
  "Inherent Implants 'Squire' Capacitor Management EM-805",
  "Eifyr and Co. 'Gunslinger' Surgical Strike SS-905",
  "Eifyr and Co. 'Gunslinger' Large Projectile Turret LP-1005",
];
for (const name of implants) {
  try { fit.addImplant(tid(name)); }
  catch (e) { console.warn(`  ⚠ Implant "${name}": ${e.message}`); }
}

// Boosters
for (const bName of ["Agency 'Pyrolancea' DB9 Dose IV", "Strong Blue Pill Booster"]) {
  try { fit.addBooster(tid(bName)); }
  catch (e) { console.warn(`  ⚠ Booster "${bName}": ${e.message}`); }
}

// Calculate
fit.calculate();



// ── Read computed attributes from ship ────────────────────────────────────
const s = fit.ship;
const get = (attr) => s.get(attr);

// ── Stacking helper for resist display ────────────────────────────────────
const resist = (attr) => {
  const resonance = get(attr);
  return resonance == null ? null : Math.round((1 - resonance) * 1000) / 10;
};

// ── Module lookups for DPS / tank ─────────────────────────────────────────
const modules = fit._modules;
const findMod = (name) => modules.find(m => m.name === name);
const cannon   = findMod('800mm Repeating Cannon II');
const xlsb     = findMod('Gist X-Type X-Large Shield Booster');
const bastion  = findMod('Bastion Module I');

// DPS
const hailL  = TYPES[tid('Hail L')];
const hailEM  = hailL?.attrs?.emDamage      ?? 0;
const hailTh  = hailL?.attrs?.thermalDamage ?? 0;
const hailKin = hailL?.attrs?.kineticDamage ?? 0;
const hailExp = hailL?.attrs?.explosiveDamage ?? 0;
const chargeTotal = hailEM + hailTh + hailKin + hailExp;

const dmgMult  = cannon ? cannon.get('damageMultiplier') : 0;
const cycleMs  = cannon ? cannon.get('speed') : 0;
const volley   = dmgMult * chargeTotal * 4;
const dps      = cycleMs > 0 ? volley / (cycleMs / 1000) : 0;
// Debug: uncomment to diagnose DPS=0
// console.log('DPS debug: dmgMult=', dmgMult, 'chargeTotal=', chargeTotal, 'cycleMs=', cycleMs, 'hailKin=', hailKin, 'hailExp=', hailExp);

// Shield boost
const shieldBonus = xlsb ? xlsb.get('shieldBonus') : 0;
const xlsbDur     = xlsb ? xlsb.get('duration') : 4000;
const shieldRepPS = shieldBonus / (xlsbDur / 1000);

// EHP factors
const shieldHP = get('shieldCapacity');
const armorHP  = get('armorHP');
const hullHP   = get('hp');

function ehpFactor(em, th, kin, ex) {
  // Weighted EHP assuming equal damage from all types
  const avgResist = (em + th + kin + ex) / 4 / 100;
  return 1 / Math.max(0.0001, 1 - avgResist);
}

const shieldEM  = resist('shieldEmDamageResonance');
const shieldTh  = resist('shieldThermalDamageResonance');
const shieldKin = resist('shieldKineticDamageResonance');
const shieldExp = resist('shieldExplosiveDamageResonance');
const shieldEhpF = ehpFactor(shieldEM, shieldTh, shieldKin, shieldExp);

const shieldRepEHPS = shieldRepPS * shieldEhpF;

// ── Print comparison table ────────────────────────────────────────────────
const PYFA = {
  dps:        3160,     volley:    6549,   cycleMs:   2072.1,
  dmgMult:    23.09,
  shieldHP:   9750,     armorHP:   9800,
  shieldEM:   82.0,     shieldTh:  83.2,   shieldKin: 85.6,  shieldExp: 88.0,
  armorEM:    81.7,     armorTh:   65.4,   armorKin:  54.8,  armorExp:  45.2,
  totalEHP:   120000,
  shieldBoostEHPS: 8216,  xlsbDur: 2048,   xlsbBonusGJ: null,
  sensor:     48,
  capCapacity: 7323.8,
  capNet: 41.5,   // GJ/s net (inject - defensive drain, no passive regen)
  capStable: 53.8, // %
};

const WIDTH = 28;
const row = (label, ours, ref, unit = '') => {
  const oStr = ours == null ? 'N/A' : typeof ours === 'number' ? ours.toFixed(ours < 10 ? 3 : 1) : String(ours);
  const rStr = ref  == null ? '---' : typeof ref  === 'number' ? ref.toFixed(ref  < 10 ? 3 : 1)  : String(ref);
  const match = ref != null && typeof ours === 'number' && typeof ref === 'number'
    ? Math.abs(ours - ref) / Math.abs(ref) < 0.01 ? ' ✓'
      : Math.abs(ours - ref) / Math.abs(ref) < 0.05 ? ' ~'
      : ' ✗'
    : '';
  console.log(`  ${label.padEnd(WIDTH)} ${oStr.padStart(10)}${unit}   ${rStr.padStart(10)}${unit} ${match}`);
};

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  Vargur "strong" — Engine vs Pyfa All-Skills-V');
console.log('  ' + '─'.repeat(59));
console.log(`  ${'Stat'.padEnd(WIDTH)} ${'Engine'.padStart(10)}   ${'Pyfa'.padStart(10)}`);
console.log('  ' + '─'.repeat(59));
console.log('  FIREPOWER');
row('DPS',            dps,      PYFA.dps);
row('Volley',         volley,   PYFA.volley);
row('Cycle (ms)',     cycleMs,  PYFA.cycleMs, 'ms');
row('dmgMult (raw)',  dmgMult,  PYFA.dmgMult);
console.log('  TANK');
row('Shield HP',      shieldHP, PYFA.shieldHP, ' HP');
row('Shield EM%',     shieldEM, PYFA.shieldEM, '%');
row('Shield Th%',     shieldTh, PYFA.shieldTh, '%');
row('Shield Kin%',    shieldKin,PYFA.shieldKin,'%');
row('Shield Exp%',    shieldExp,PYFA.shieldExp,'%');
row('Armor HP',       armorHP,  PYFA.armorHP,  ' HP');
row('Armor EM%',      resist('armorEmDamageResonance'), PYFA.armorEM, '%');
row('Armor Th%',      resist('armorThermalDamageResonance'), PYFA.armorTh, '%');
row('Armor Kin%',     resist('armorKineticDamageResonance'), PYFA.armorKin, '%');
row('Armor Exp%',     resist('armorExplosiveDamageResonance'), PYFA.armorExp, '%');
row('Shield EHP/s',   shieldRepEHPS, PYFA.shieldBoostEHPS, ' EHP/s');
console.log('  RAW SHIELD BOOST');
// Turret range debug
const cannon800 = modules.find(m => m.name === '800mm Repeating Cannon II');

if (cannon800) {
  const hailTid = eng.typeIDByName('Hail L');
  const hailAttrs = eng.TYPES[hailTid]?.attrs;
  const opt  = cannon800.get('maxRange') * (hailAttrs?.weaponRangeMultiplier ?? 1) / 1000;
  const fall = cannon800.get('falloff')  * (hailAttrs?.fallofMultiplier ?? 1) / 1000;
  const trk  = cannon800.get('trackingSpeed') * (hailAttrs?.trackingSpeedMultiplier ?? 1);
  console.log(`  Turret: opt=${opt.toFixed(2)}km fall=${fall.toFixed(1)}km trk=${trk.toFixed(2)} (Pyfa: 4.09km 35.8km 6.43)`);
}
row('shieldBonus (GJ)',   shieldBonus, 2571.409);
row('XLSB duration (ms)', xlsbDur, PYFA.xlsbDur, 'ms');
row('Raw HP/s (HP/s)',    shieldRepPS, 1255.6);
// Passive shield regen
const shieldRechargeMs  = s.get('shieldRechargeRate');
const passiveShieldHP_s = shieldHP * 2.5 / (shieldRechargeMs / 1000);
const passiveShieldEHPs = passiveShieldHP_s * shieldEhpF;
row('Passive regen (EHP/s)',  passiveShieldEHPs, 93.6, ' EHP/s');
row('Shield recharge (s)',    shieldRechargeMs/1000, null, 's');
console.log('  MISC');
row('Sensor str.',    get('scanLadarStrength'), PYFA.sensor, ' Ladar');
row('Sig radius (m)', get('signatureRadius'), 2221.6, 'm');
// Align time: ship base mass + active propulsion module massAddition
const alignMass = (s.get('mass') ?? 0) + fit._modules
  .filter(m => (m.state === 'active' || m.state === 'overheated') && (m.get('massAddition') ?? 0) > 0)
  .reduce((sum, m) => sum + (m.get('massAddition') ?? 0), 0);
const alignS    = -Math.log(0.25) * s.get('agility') * alignMass / 1e6;
row('Align time (s)', alignS, 13.3, 's');
row('Cap capacity',   get('capacitorCapacity'), PYFA.capCapacity, ' GJ');
// Compute cap net in the same way calc.js does:
{
  const capR = s.get('rechargeRate') ?? 825000;
  const capC = get('capacitorCapacity');
  const peakRegen = capC * 2.5 / (capR / 1000);
  let fillPS = 0, drainPS = 0;
  for (const m of fit._modules) {
    if (!m || (m.state !== 'active' && m.state !== 'overheated')) continue;
    const cn = m.get('capacitorNeed') ?? 0;
    const ct = m.get('duration') ?? m.get('speed') ?? 0;
    const isInj = m.groupName === 'Capacitor Booster';
    if (!ct || (cn === 0 && !isInj)) continue;
    if (isInj) {
      // clip=1, reload=10000ms
      const bayC = m.getBase('capacity') ?? 128;
      const chargeVol = 96; // Navy 3200
      const clip = Math.max(1, Math.floor(bayC / chargeVol));
      const injAmt = 3200; // fixed for this fit
      fillPS += (clip * injAmt) / (clip * ct + 10000) * 1000;
    } else {
      drainPS += cn / (ct / 1000);
    }
  }
  const netGJs = fillPS - drainPS + peakRegen;
  console.log(`  Cap: fill=${fillPS.toFixed(1)} drain=${drainPS.toFixed(1)} regen=${peakRegen.toFixed(1)} net=+${netGJs.toFixed(1)} GJ/s  (Pyfa: +41.5)`);
}
console.log('═══════════════════════════════════════════════════════════════\n');
