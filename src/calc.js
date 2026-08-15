/**
 * calc.js  –  EVE Online fitting stats, powered by Pyfa's dogma engine
 *
 * This file replaces the hand-coded formula approach with Pyfa's actual
 * attribute calculation system (ModifiedAttributeDict + effect dispatch).
 *
 * Architecture:
 *   dogma-engine.js – data-driven dogma calculator (replaces pyfa-engine + pyfa-effects)
 *   calc.js         – this file: builds a Fit, runs calculate(), extracts stats
 *
 * The public API (calcFitStats, getModuleStats, layerEHP, etc.) is unchanged
 * so App.jsx requires no modifications.
 */

import { Fit, TYPES, typeIDByName, AID, EFFECTS_DATA, ATTR_META, DRONE_TYPES } from './dogma-engine-init.js';
// Attribute ID → name map (inverse of AID), for abyssal/mutaplasmid attribute resolution.
export const ATTR_ID_TO_NAME = {};
for (const [name, id] of Object.entries(AID)) ATTR_ID_TO_NAME[id] = name;
let _droneNameIdx = null;
function getDroneByName(name) {
  if (!_droneNameIdx) {
    _droneNameIdx = {};
    for (const [tid, d] of Object.entries(DRONE_TYPES ?? {})) _droneNameIdx[d.n] = { tid, ...d };
  }
  return name ? _droneNameIdx[name] ?? null : null;
}
export { TYPES, EFFECTS_DATA };
// No EFFECTS import — dogma-engine reads dogma-effects.json internally

// Normalize TYPES to use numeric keys (JSON.parse always produces string keys)

// ─────────────────────────────────────────────────────────────────────────────
// Skill defaults  (all 5)
// ─────────────────────────────────────────────────────────────────────────────
export const SKILL_DEFAULTS = {
  // Fitting
  cpuManagement:5, powerGridManagement:5,
  energyGridUpgrades:5, weaponUpgrades:5, advWeaponUpgrades:5,
  energyManagement:5, energySystemsOp:5,
  // Shield / armor / hull
  shieldManagement:5, shieldOperation:5, shieldUpgrades:5, repairSystems:5, hullUpgrades:5, mechanic:5,
  // Navigation
  navigation:5, evasiveManeuvering:5, spaceshipCommand:5, accelerationControl:5, highSpeedManeuvering:5, afterburner:5,
  longRangeTargeting:5, targetManagement:5, signatureAnalysis:5, ladarSensorCompensation:5, gravimetricSensorCompensation:5,
  magnetometricSensorCompensation:5, radarSensorCompensation:5,
  shieldRigging:5, armorRigging:5, energyWeaponRigging:5, projectileWeaponRigging:5, hybridWeaponRigging:5, astronauticsRigging:5, launcherRigging:5, droneRigging:5, electronicSuperiority:5, droneSharpshooting:5, droneAvionics:5, droneNavigationComputer:5, astronauticRigging:5,
  shieldCompensation:5,
  // Racial shield compensation skills boost shield resistance amplifier effectiveness (+5%/lvl)
  emShieldCompensation:5, thermalShieldCompensation:5, kineticShieldCompensation:5, explosiveShieldCompensation:5,
  // Armor compensation skills (scale passive armor hardener effectiveness):
  emArmorCompensation:5, thermalArmorCompensation:5, kineticArmorCompensation:5, explosiveArmorCompensation:5,
  highSpeedManeuvering:5, propulsionJamming:5, capacitorEmissionSystems:5,
  shieldEmissionSystems:5, remoteArmorRepairSystems:5, remoteHullRepairSystems:5,
  // Gunnery
  gunnery:5, rapidFiring:5, surgicalStrike:5, sharpshooter:5, trajectoryAnalysis:5,
  motionPrediction:5,
  // Turret parent skills
  largeProjectileTurret:5, largeHybridTurret:5, largeEnergyTurret:5,
  mediumProjectileTurret:5, mediumHybridTurret:5, mediumEnergyTurret:5,
  smallProjectileTurret:5, smallHybridTurret:5, smallEnergyTurret:5,
  // T2 spec skills
  largeAutocannonSpec:5, largeArtillerySpec:5, largeBlasterSpec:5, largeRailgunSpec:5,
  largeBeamLaserSpec:5, largePulseLaserSpec:5,
  mediumAutocannonSpec:5, mediumArtillerySpec:5, mediumBlasterSpec:5, mediumRailgunSpec:5,
  mediumBeamLaserSpec:5, mediumPulseLaserSpec:5,
  smallAutocannonSpec:5, smallArtillerySpec:5, smallBlasterSpec:5, smallRailgunSpec:5,
  smallBeamLaserSpec:5, smallPulseLaserSpec:5,
  // Missiles
  missileLaunchers:5, warheadUpgrades:5,
  // Engine-applied missile RoF / support skills (filtered by Missile Launcher Operation)
  rapidLaunch:5, missileProjection:5, missileBombardment:5,
  // Charge damage skills (+5%/lvl to missiles requiring them)
  lightMissiles:5, rockets:5, heavyMissiles:5, cruiseMissiles:5, torpedoes:5, autoTargetingMissiles:5,
  heavyAssaultMissiles:5, xlCruiseMissiles:5,
  heavyMissileSpec:5, heavyAssaultMissileSpec:5, cruiseMissileSpec:5,
  torpedoSpec:5, lightMissileSpec:5, rocketSpec:5,
  xlCruiseMissileSpec:5, xlTorpedoSpec:5, xlTorpedoes:5,
  // Drone
  droneInterfacing:5, drones:5, lightDroneOperation:5, mediumDroneOperation:5,
  heavyDroneOperation:5, droneAvionics:5,
  amarrDroneSpecialization:5, caldariDroneSpecialization:5,
  gallenteDroneSpecialization:5, minmatarDroneSpecialization:5,
  // Racial battleship / marauder
  minmatarBattleship:5, amarrBattleship:5, gallenteBattleship:5, caldariBattleship:5,
  marauders:5, heavyAssaultCruisers:5,
  // Command / Leadership (command burst range: Leadership + Fleet Command + Wing Command)
  leadership:5, fleetCommand:5, wingCommand:5,
  skirmishCommand:5, armoredCommand:5, informationCommand:5, shieldCommand:5,
  skirmishCommandSpecialist:5, armoredCommandSpecialist:5, informationCommandSpecialist:5, shieldCommandSpecialist:5,
  commandBurstSpecialist:5,
  // Command Ships (tid=23950) scales eliteBonusCommandShips1/2/3 on the ship via ItemModifier.
  // Racial Battlecruiser skills scale shipBonusGBC1/2, shipBonusMBC1/2, etc. on the ship.
  commandShips:5,
  gallenteBattlecruiser:5, amarrBattlecruiser:5, caldariBattlecruiser:5, minmatarBattlecruiser:5,
  // Gunnery support: controlledBursts reduces turret cap need -5%/level (Effect 287)
  controlledBursts:5,
  // Biology/booster skills: Neurotoxin Control -5%/lvl side effect chance,
  // Neurotoxin Recovery -5%/lvl side effect magnitude
  neurotoxinControl:5, neurotoxinRecovery:5,
  // T3 Destroyer hull skills (pre-scale per-level ship bonus attrs, like the BC skills)
  amarrTacticalDestroyer:5, caldariTacticalDestroyer:5, gallenteTacticalDestroyer:5, minmatarTacticalDestroyer:5,
  // T3 cruiser subsystem skills (scale subsystemBonus* attrs per level, like hull-bonus skills)
  amarrCoreSystems:5, caldariCoreSystems:5, gallenteCoreSystems:5, minmatarCoreSystems:5,
  amarrDefensiveSystems:5, caldariDefensiveSystems:5, gallenteDefensiveSystems:5, minmatarDefensiveSystems:5,
  amarrOffensiveSystems:5, caldariOffensiveSystems:5, gallenteOffensiveSystems:5, minmatarOffensiveSystems:5,
  amarrPropulsionSystems:5, caldariPropulsionSystems:5, gallentePropulsionSystems:5, minmatarPropulsionSystems:5,
  // Structure-only skills (corp/structure "operation" skills, not personal ship-piloting skills —
  // these boost FITTED structure modules/charges, unlike Hull Upgrades/Shield Management/Mechanics
  // which must NOT apply to a structure's own hull stats; see dogma-engine.js's _isStructureFit
  // guard). Structure Missile Systems: +2%/lvl structure missile/guided-bomb charge damage (same
  // shape as Warhead Upgrades for ships). Structure Electronic/Engineering Systems: cap-cost
  // reduction for structure EWAR/energy-neutralizer modules. Structure Doomsday Operation:
  // doomsday weapon cycle-time reduction.
  structureMissileSystems:5, structureElectronicSystems:5, structureEngineeringSystems:5, structureDoomsdayOperation:5,
};

// Skill name normalisation (App.jsx uses camelCase, Pyfa uses "Proper Name")
// The engine stores skills by their EVE display name. These two maps translate.
export const SKILL_CAMEL_TO_PYFA = {
  cpuManagement:'CPU Management', powerGridManagement:'Power Grid Management',
  energyGridUpgrades:'Energy Grid Upgrades',
  weaponUpgrades:'Weapon Upgrades', advWeaponUpgrades:'Advanced Weapon Upgrades',
  energyManagement:'Capacitor Management', energySystemsOp:'Capacitor Systems Operation',
  shieldManagement:'Shield Management', shieldOperation:'Shield Operation', shieldUpgrades:'Shield Upgrades',
  repairSystems:'Repair Systems', hullUpgrades:'Hull Upgrades', mechanic:'Mechanics',
  navigation:'Navigation', evasiveManeuvering:'Evasive Maneuvering', spaceshipCommand:'Spaceship Command', accelerationControl:'Acceleration Control', highSpeedManeuvering:'High Speed Maneuvering', afterburner:'Afterburner',
  longRangeTargeting:'Long Range Targeting', targetManagement:'Target Management',
  signatureAnalysis:'Signature Analysis',
  ladarSensorCompensation:'Ladar Sensor Compensation', gravimetricSensorCompensation:'Gravimetric Sensor Compensation',
  magnetometricSensorCompensation:'Magnetometric Sensor Compensation', radarSensorCompensation:'Radar Sensor Compensation',
  shieldRigging:'Shield Rigging', armorRigging:'Armor Rigging', energyWeaponRigging:'Energy Weapon Rigging', projectileWeaponRigging:'Projectile Weapon Rigging', hybridWeaponRigging:'Hybrid Weapon Rigging', astronauticsRigging:'Astronautics Rigging', launcherRigging:'Launcher Rigging', droneRigging:'Drone Rigging', electronicSuperiority:'Electronic Superiority', droneSharpshooting:'Drone Sharpshooting', droneAvionics:'Drone Avionics', droneNavigationComputer:'Drone Navigation Computer', astronauticRigging:'Astronautic Rigging',
  shieldCompensation:'Shield Compensation',
  emShieldCompensation:'EM Shield Compensation', thermalShieldCompensation:'Thermal Shield Compensation',
  kineticShieldCompensation:'Kinetic Shield Compensation', explosiveShieldCompensation:'Explosive Shield Compensation',
  emArmorCompensation:'EM Armor Compensation', thermalArmorCompensation:'Thermal Armor Compensation',
  kineticArmorCompensation:'Kinetic Armor Compensation', explosiveArmorCompensation:'Explosive Armor Compensation',
  highSpeedManeuvering:'High Speed Maneuvering',
  propulsionJamming:'Propulsion Jamming',
  capacitorEmissionSystems:'Capacitor Emission Systems',
  shieldEmissionSystems:'Shield Emission Systems', remoteArmorRepairSystems:'Remote Armor Repair Systems', remoteHullRepairSystems:'Remote Hull Repair Systems',
  gunnery:'Gunnery', rapidFiring:'Rapid Firing', surgicalStrike:'Surgical Strike',
  sharpshooter:'Sharpshooter', trajectoryAnalysis:'Trajectory Analysis',
  motionPrediction:'Motion Prediction',
  largeProjectileTurret:'Large Projectile Turret', largeHybridTurret:'Large Hybrid Turret',
  largeEnergyTurret:'Large Energy Turret',
  mediumProjectileTurret:'Medium Projectile Turret', mediumHybridTurret:'Medium Hybrid Turret',
  mediumEnergyTurret:'Medium Energy Turret',
  smallProjectileTurret:'Small Projectile Turret', smallHybridTurret:'Small Hybrid Turret',
  smallEnergyTurret:'Small Energy Turret',
  largeAutocannonSpec:'Large Autocannon Specialization',
  largeArtillerySpec:'Large Artillery Specialization',
  largeBlasterSpec:'Large Blaster Specialization', largeRailgunSpec:'Large Railgun Specialization',
  largeBeamLaserSpec:'Large Beam Laser Specialization',
  largePulseLaserSpec:'Large Pulse Laser Specialization',
  mediumAutocannonSpec:'Medium Autocannon Specialization',
  mediumArtillerySpec:'Medium Artillery Specialization',
  mediumBlasterSpec:'Medium Blaster Specialization', mediumRailgunSpec:'Medium Railgun Specialization',
  mediumBeamLaserSpec:'Medium Beam Laser Specialization',
  mediumPulseLaserSpec:'Medium Pulse Laser Specialization',
  smallAutocannonSpec:'Small Autocannon Specialization',
  smallArtillerySpec:'Small Artillery Specialization',
  smallBlasterSpec:'Small Blaster Specialization', smallRailgunSpec:'Small Railgun Specialization',
  smallBeamLaserSpec:'Small Beam Laser Specialization',
  smallPulseLaserSpec:'Small Pulse Laser Specialization',
  missileLaunchers:'Missile Launcher Operation', warheadUpgrades:'Warhead Upgrades',
  rapidLaunch:'Rapid Launch', missileProjection:'Missile Projection', missileBombardment:'Missile Bombardment',
  lightMissiles:'Light Missiles', rockets:'Rockets', heavyMissiles:'Heavy Missiles',
  cruiseMissiles:'Cruise Missiles', torpedoes:'Torpedoes', autoTargetingMissiles:'Auto-Targeting Missiles',
  heavyAssaultMissiles:'Heavy Assault Missiles', xlCruiseMissiles:'XL Cruise Missiles',
  heavyMissileSpec:'Heavy Missile Specialization',
  heavyAssaultMissileSpec:'Heavy Assault Missile Specialization',
  cruiseMissileSpec:'Cruise Missile Specialization', torpedoSpec:'Torpedo Specialization',
  lightMissileSpec:'Light Missile Specialization', rocketSpec:'Rocket Specialization',
  droneInterfacing:'Drone Interfacing', drones:'Drones',
  lightDroneOperation:'Light Drone Operation', mediumDroneOperation:'Medium Drone Operation',
  heavyDroneOperation:'Heavy Drone Operation', droneAvionics:'Drone Avionics',
  amarrDroneSpecialization:'Amarr Drone Specialization',
  caldariDroneSpecialization:'Caldari Drone Specialization',
  gallenteDroneSpecialization:'Gallente Drone Specialization',
  minmatarDroneSpecialization:'Minmatar Drone Specialization',
  minmatarBattleship:'Minmatar Battleship', amarrBattleship:'Amarr Battleship',
  gallenteBattleship:'Gallente Battleship', caldariBattleship:'Caldari Battleship',
  marauders:'Marauders', heavyAssaultCruisers:'Heavy Assault Cruisers',
  commandShips:'Command Ships',
  gallenteBattlecruiser:'Gallente Battlecruiser',
  amarrBattlecruiser:'Amarr Battlecruiser',
  caldariBattlecruiser:'Caldari Battlecruiser',
  minmatarBattlecruiser:'Minmatar Battlecruiser',
  controlledBursts:'Controlled Bursts',
  skirmishCommand:'Skirmish Command', armoredCommand:'Armored Command',
  informationCommand:'Information Command',
  skirmishCommandSpecialist:'Skirmish Command Specialist',
  shieldCommand:'Shield Command', shieldCommandSpecialist:'Shield Command Specialist',
  armoredCommandSpecialist:'Armored Command Specialist',
  informationCommandSpecialist:'Information Command Specialist',
  commandBurstSpecialist:'Command Burst Specialist',
  // Command burst AOE range skills (Effect 6769: areaOfEffectBonus → maxRange).
  // These were missing, so the engine never received them → burst range showed hull bonus only.
  leadership:'Leadership', fleetCommand:'Fleet Command', wingCommand:'Wing Command',
  // Fixed names (audit found these resolving to nonexistent types):
  electronicSuperiority:'Electronic Superiority Rigging',
  droneNavigationComputer:'Drone Navigation',
  astronauticRigging:'Astronautics Rigging',
  neurotoxinControl:'Neurotoxin Control',
  neurotoxinRecovery:'Neurotoxin Recovery',
  amarrTacticalDestroyer:'Amarr Tactical Destroyer',
  caldariTacticalDestroyer:'Caldari Tactical Destroyer',
  gallenteTacticalDestroyer:'Gallente Tactical Destroyer',
  minmatarTacticalDestroyer:'Minmatar Tactical Destroyer',
  amarrCoreSystems:'Amarr Core Systems', caldariCoreSystems:'Caldari Core Systems', gallenteCoreSystems:'Gallente Core Systems', minmatarCoreSystems:'Minmatar Core Systems',
  amarrDefensiveSystems:'Amarr Defensive Systems', caldariDefensiveSystems:'Caldari Defensive Systems', gallenteDefensiveSystems:'Gallente Defensive Systems', minmatarDefensiveSystems:'Minmatar Defensive Systems',
  amarrOffensiveSystems:'Amarr Offensive Systems', caldariOffensiveSystems:'Caldari Offensive Systems', gallenteOffensiveSystems:'Gallente Offensive Systems', minmatarOffensiveSystems:'Minmatar Offensive Systems',
  amarrPropulsionSystems:'Amarr Propulsion Systems', caldariPropulsionSystems:'Caldari Propulsion Systems', gallentePropulsionSystems:'Gallente Propulsion Systems', minmatarPropulsionSystems:'Minmatar Propulsion Systems',
  structureMissileSystems:'Structure Missile Systems', structureElectronicSystems:'Structure Electronic Systems', structureEngineeringSystems:'Structure Engineering Systems', structureDoomsdayOperation:'Structure Doomsday Operation',
  // These four had no entry, so `SKILL_CAMEL_TO_PYFA[k] ?? k` fell through to the camelCase key,
  // which matches no real type — the skill silently did nothing when set to anything below V (the
  // all-V fallback in calcFitStats masked it at max skills, which is why it never showed up in the
  // regression suite). Note CCP's group name is "DroneS Rigging", plural.
  droneRigging:'Drones Rigging', xlTorpedoes:'XL Torpedoes',
  xlCruiseMissileSpec:'XL Cruise Missile Specialization', xlTorpedoSpec:'XL Torpedo Specialization',
};

// ─────────────────────────────────────────────────────────────────────────────
// Utility functions (preserved from original calc.js for compatibility)
// ─────────────────────────────────────────────────────────────────────────────
export function stackingPenalty(mults) {
  const bonuses  = mults.filter(v => v > 1).sort((a,b) => b - a);
  const penalties= mults.filter(v => v < 1).sort((a,b) => a - b);
  let r = 1;
  for (const lst of [bonuses, penalties])
    lst.forEach((v, i) => r *= 1 + (v - 1) * Math.exp(-(i * i) / 7.1289));
  return r;
}

export function rangeFactor(optKm, fallKm, distKm, restricted = true) {
  if (!optKm && !fallKm) return 0;
  if (distKm <= optKm) return restricted ? 1.0 : 1.0;
  if (!fallKm) return 0;
  const x = (distKm - optKm) / fallKm;
  return 0.5 ** (x * x);
}

export function calcLockTime(scanRes, sigRadius) {
  if (!scanRes || !sigRadius) return null;
  return 40000 / (scanRes * Math.pow(sigRadius, 1.4));
}

export function peakRegen(capacityHP, rechargeRateMs) {
  // EVE formula: peak rate = capacity × (√f - f) × 10/T, max at f=0.25 → factor 2.5
  if (!capacityHP || !rechargeRateMs) return 0;
  return capacityHP * 2.5 / (rechargeRateMs / 1000);
}

export function calcAlignTime(agility, mass) {
  if (!agility || !mass) return 0;
  return -Math.log(0.25) * agility * mass / 1e6;
}

export function layerEHP(hp, resists) {
  // resists values are in 0-100 percent range (App.jsx convention)
  const avg = ((resists.em ?? 0) + (resists.th ?? 0) + (resists.kin ?? 0) + (resists.exp ?? 0)) / 4 / 100;
  return hp / Math.max(0.0001, 1 - avg);
}

export function simulateCap(modules, capCapacity, capRechargeMs, tMaxSec = 21600) {
  if (!modules.length || !capCapacity) return { stable: true, level: 1, time: null };
  // EVE cap regen formula: dCap/dt = capacity × (√f - f) × 10 / rechargeTime
  const regenPerSec = (lvl) => capCapacity * ((Math.sqrt(lvl) - lvl) * 10) / (capRechargeMs / 1000);
  let cap = capCapacity, t = 0;
  // Track oscillation band (matching Pyfa's cap_stable_low / cap_stable_high)
  let capLowest = capCapacity;     // minimum cap seen after any activation
  let capLowestPre = capCapacity;  // minimum cap seen just BEFORE an activation
  const WARMUP_MS = 120000;        // 2 min warmup before tracking
  const heap = modules.map(m => ({ ...m, next: 0, _shots: 0 }));
  heap.sort((a, b) => a.next - b.next);
  for (let iter = 0; iter < 200000; iter++) {
    const m = heap[0];
    const dt = Math.max(0, m.next - t);
    // dt is in MILLISECONDS; regenPerSec is GJ per SECOND — convert.
    cap = Math.min(capCapacity, cap + regenPerSec(cap / capCapacity) * dt / 1000);
    t = m.next;
    if (t > tMaxSec * 1000) break;
    // Track pre-activation cap (local min before module fires)
    if (t > WARMUP_MS) capLowestPre = Math.min(capLowestPre, cap);
    if (m.isInjector) {
      if (m.clipSize > 0 && m._shots >= m.clipSize) {
        m._shots = 0;
        m.next = t + m.reloadMs;
      } else {
        cap = Math.min(capCapacity, cap - m.capNeedGJ);
        m._shots++;
        m.next = t + m.cycleMs;
      }
    } else {
      // capNeedGJ is positive (cost in GJ) — cap must have enough to activate
      if (cap < m.capNeedGJ) return { stable: false, level: cap / capCapacity, time: t / 1000 };
      cap -= m.capNeedGJ;
      // Handle clip/reload for limited-ammo modules (e.g. Ancillary Armor Repairer with paste)
      if (m.clipSize > 0) {
        m._shots++;
        if (m._shots >= m.clipSize) {
          m._shots = 0;
          m.next = t + m.cycleMs + (m.reloadMs || 0);
        } else {
          m.next = t + m.cycleMs;
        }
      } else {
        m.next = t + m.cycleMs;
      }
    }
    // Track post-activation cap
    if (t > WARMUP_MS) capLowest = Math.min(capLowest, cap);
    heap.sort((a, b) => a.next - b.next);
  }
  // Stable level = midpoint of oscillation band (matches Pyfa's (low + high) / 2 / capMax)
  const stableLevel = Math.min(1, (capLowest + capLowestPre) / 2 / capCapacity);

  // NOTE: an analytical "drain > fill && equilibrium > 80% → unstable" check used to live here.
  // It existed only to compensate for a regen-unit bug (regen applied 1000× too fast, so the
  // simulation could never drain). With regen corrected, the discrete simulation is physically
  // accurate: unstable fits die naturally with a true simulated lifetime, and fits that
  // genuinely stabilize at a high equilibrium are correctly reported stable.
  return { stable: true, level: stableLevel, time: null };
}

// simulateCapTrace — capacitor-over-time trajectory for the cap graph, using the SAME discrete
// event model as simulateCap (so the graph agrees with the stability/lifetime readout). Modules
// that can't afford their activation cost skip that cycle (realistic cap-out: expensive modules
// stop firing, cheap ones keep going, the injector keeps pulsing), which yields the true drain
// curve and low-end oscillation instead of a smooth average.
export function simulateCapTrace(modules, capCapacity, capRechargeMs, { tMaxSec = 300, sampleDt = 0.5 } = {}) {
  const pts = [];
  if (!capCapacity) return pts;
  const regenPerSec = (lvl) => capCapacity * ((Math.sqrt(Math.max(0, lvl)) - Math.max(0, lvl)) * 10) / (capRechargeMs / 1000);
  let cap = capCapacity;
  const evs = (modules || []).map(m => ({ ...m, next: 0, _shots: 0 }));
  const dtMs = Math.max(50, sampleDt * 1000);
  const tMaxMs = tMaxSec * 1000;
  for (let tm = 0; tm <= tMaxMs + 1e-6; tm += dtMs) {
    // Continuous recharge over this step (uses cap at the start of the step).
    cap = Math.min(capCapacity, cap + regenPerSec(cap / capCapacity) * (dtMs / 1000));
    // Fire every module/injector event scheduled up to now.
    for (const m of evs) {
      let guard = 0;
      while (m.next <= tm && guard++ < 10000) {
        if (m.isInjector) {
          if (m.clipSize > 0 && m._shots >= m.clipSize) { m._shots = 0; m.next += m.reloadMs; }
          else { cap = Math.min(capCapacity, cap - m.capNeedGJ); m._shots++; m.next += m.cycleMs; }
        } else if (cap >= m.capNeedGJ) {
          cap -= m.capNeedGJ;
          if (m.clipSize > 0) {
            m._shots++;
            if (m._shots >= m.clipSize) { m._shots = 0; m.next += m.cycleMs + (m.reloadMs || 0); }
            else m.next += m.cycleMs;
          } else m.next += m.cycleMs;
        } else {
          // Not enough cap to activate — skip this cycle (module fails to fire), try again next cycle.
          m.next += m.cycleMs;
        }
      }
    }
    pts.push([tm / 1000, cap]);
  }
  return pts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Name → typeID index (built once from TYPES)
// ─────────────────────────────────────────────────────────────────────────────
let _nameIdx = null;
function getNameIdx() {
  if (!_nameIdx) {
    _nameIdx = {};
    for (const [tid, t] of Object.entries(TYPES)) { if (t.n) _nameIdx[t.n] = Number(tid); if (t.name) _nameIdx[t.name] = Number(tid); }
  }
  return _nameIdx;
}
export function tidByName(name) { return getNameIdx()[name] ?? null; }

// ── Skill catalog + fit skill requirements ──────────────────────────────────
// Two DIFFERENT sets of skills matter, and conflating them is the trap here:
//   • the ones the dogma engine reads (SKILL_DEFAULTS, ~167) — these change your numbers;
//   • the ones fittable items name as REQUIREMENTS (~316 more) — these decide whether you can
//     fly the fit at all. A rig requires Jury Rigging, which no engine effect reads; a Caracal
//     requires Caldari Cruiser. Neither was in SKILL_DEFAULTS, so a requirement check built only
//     from that set would call almost every fit flyable.
// The catalog is the union, keyed by the existing camelCase key where one exists and by a
// camelised type name otherwise (verified collision-free across all 357).
const REQ_SKILL_SLOTS = [1, 2, 3, 4, 5, 6];
const _camelSkillKey = s => String(s).replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
  .map((w, i) => i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()).join('');
// Categories that can appear on a fit and therefore contribute skill requirements.
const FITTABLE_CATS = new Set([6, 7, 8, 18, 32, 65, 66, 87]);

export const SKILL_CATALOG = (() => {
  const keyByTid = new Map();
  for (const k of Object.keys(SKILL_DEFAULTS)) {
    const tid = tidByName(SKILL_CAMEL_TO_PYFA[k] ?? k);
    if (tid) keyByTid.set(Number(tid), k);
  }
  const tids = new Set(keyByTid.keys());
  for (const t of Object.values(TYPES)) {
    if (!FITTABLE_CATS.has(t.c ?? t.category)) continue;
    const a = t.a ?? t.attrs ?? {};
    for (const i of REQ_SKILL_SLOTS) { const s = a['requiredSkill' + i]; if (s) tids.add(Number(s)); }
  }
  const out = [];
  for (const tid of tids) {
    const t = TYPES[String(tid)];
    if (!t?.n) continue;
    out.push({ key: keyByTid.get(tid) ?? _camelSkillKey(t.n), typeID: tid, name: t.n, group: t.gn ?? 'Other' });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
})();
export const SKILL_BY_TYPEID = new Map(SKILL_CATALOG.map(e => [e.typeID, e]));
// Register the derived keys so a level set on a requirement-only skill actually reaches the engine
// (`fit.setSkill(SKILL_CAMEL_TO_PYFA[k] ?? k, lvl)` would otherwise pass the camel key, which
// matches no real skill name, and the all-V fallback would silently put it back to 5).
for (const e of SKILL_CATALOG) if (!SKILL_CAMEL_TO_PYFA[e.key]) SKILL_CAMEL_TO_PYFA[e.key] = e.name;

/** Direct skill requirements of one type, as [{typeID, level}]. */
export function requiredSkillsFor(typeID) {
  const a = TYPES[String(typeID)]?.a ?? TYPES[String(typeID)]?.attrs ?? {};
  const out = [];
  for (const i of REQ_SKILL_SLOTS) {
    const s = a['requiredSkill' + i];
    if (s) out.push({ typeID: Number(s), level: a['requiredSkill' + i + 'Level'] ?? 1 });
  }
  return out;
}

/**
 * Which skills a fit needs but the character lacks.
 * Unset skills count as level V — the same convention calcFitStats uses, so a fresh install with
 * no skills configured reads as flyable rather than showing every fit as broken.
 * Returns { ok, missing: [{ key, name, group, required, have, items:[names] }] } sorted by name.
 */
export function checkFitSkills(ship, slots, drones = [], fighters = [], skills = null) {
  const need = new Map();  // skill typeID -> { required, items:Set }
  const add = (typeID, itemName) => {
    if (!typeID) return;
    for (const { typeID: sk, level } of requiredSkillsFor(typeID)) {
      const e = need.get(sk) ?? { required: 0, items: new Set() };
      e.required = Math.max(e.required, level);
      if (itemName) e.items.add(itemName);
      need.set(sk, e);
    }
  };
  if (ship?.typeID) add(ship.typeID, ship.name);
  const sections = ['high', 'mid', 'low', 'rigs', 'subsystems', 'services'];
  for (const sec of sections) {
    for (const s of (slots?.[sec] ?? [])) {
      if (!s?.typeID || s.type === 'empty') continue;
      add(s.typeID, s.name);
      const ammo = (s.ammo || '').replace(/\s*\(\d+\)$/, '');
      if (ammo) add(tidByName(ammo), ammo);
    }
  }
  for (const d of (drones ?? [])) add(d.typeID ?? tidByName(d.name), d.name);
  for (const f of (fighters ?? [])) add(f.typeID ?? tidByName(f.name), f.name);

  const missing = [];
  for (const [skTid, { required, items }] of need) {
    const entry = SKILL_BY_TYPEID.get(skTid);
    if (!entry) continue;                       // unknown skill type — cannot judge, so don't claim a failure
    const have = skills?.[entry.key] ?? 5;
    if (have >= required) continue;
    missing.push({ key: entry.key, name: entry.name, group: entry.group, required, have, items: [...items] });
  }
  missing.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: missing.length === 0, missing };
}

// ── T3 Cruiser subsystem helpers ────────────────────────────────────────────
// T3 cruisers (Strategic Cruisers) get ALL their slots from 4 subsystems
// (Core/Defensive/Offensive/Propulsion). Each subsystem carries slot modifiers.
export const T3C_SUBSYSTEM_GROUPS = {
  Core:'Core Subsystem', Defensive:'Defensive Subsystem',
  Offensive:'Offensive Subsystem', Propulsion:'Propulsion Subsystem',
};
export function isT3Cruiser(shipName) {
  const tid = shipName ? (typeIDByName(shipName) ?? tidByName(shipName)) : null;
  const gn = tid ? (TYPES[tid]?.gn ?? TYPES[tid]?.groupName) : null;
  return gn === 'Strategic Cruiser';
}
// List all subsystems for a hull's race, grouped by subsystem type.
// e.g. subsystemsForHull('Loki') → { Core:[...], Defensive:[...], Offensive:[...], Propulsion:[...] }
export function subsystemsForHull(shipName) {
  const out = { Core:[], Defensive:[], Offensive:[], Propulsion:[] };
  if (!shipName) return out;
  const prefix = shipName + ' '; // subsystems are named "<Hull> <Type> - <Variant>"
  for (const [tid, t] of Object.entries(TYPES)) {
    if ((t.c ?? t.category) !== 32) continue;            // category 32 = Subsystem
    const name = t.n ?? t.name;
    if (!name || !name.startsWith(prefix)) continue;
    const gn = t.gn ?? t.groupName ?? '';
    const slot = Object.entries(T3C_SUBSYSTEM_GROUPS).find(([,g]) => g === gn)?.[0];
    if (slot) out[slot].push({ typeID: Number(tid), name });
  }
  for (const k of Object.keys(out)) out[k].sort((a,b)=>a.name.localeCompare(b.name));
  return out;
}
// Compute the hull slot layout from a list of fitted subsystems (array of {name}|{typeID}).
// Returns { hiSlots, medSlots, lowSlots, turrets, launchers, rigSlots }.
export function t3cSlotLayout(subsystems) {
  const layout = { hiSlots:0, medSlots:0, lowSlots:0, turrets:0, launchers:0, rigSlots:0 };
  for (const s of (subsystems || [])) {
    if (!s) continue;
    const tid = s.typeID ?? typeIDByName(s.name) ?? tidByName(s.name);
    const a = tid ? (TYPES[tid]?.attrs ?? TYPES[tid]?.a ?? {}) : {};
    layout.hiSlots   += a.hiSlotModifier        ?? a['1374'] ?? 0;
    layout.medSlots  += a.medSlotModifier        ?? a['1375'] ?? 0;
    layout.lowSlots  += a.lowSlotModifier        ?? a['1376'] ?? 0;
    layout.turrets   += a.turretHardPointModifier   ?? a['1368'] ?? 0;
    layout.launchers += a.launcherHardPointModifier ?? a['1369'] ?? 0;
    // Rig slots: T3 cruisers always have 3 (the Core subsystem doesn't carry rigSlots; it's a hull constant)
  }
  layout.rigSlots = 3; // Strategic Cruisers always have 3 rig slots
  return layout;
}

// ─────────────────────────────────────────────────────────────────────────────
// Booster side effects — data-driven from EVE booster penalty attributes.
// Each combat booster carries booster*Penalty attrs (raw, e.g. -25) plus
// boosterEffectChance1..5 (raw, e.g. 0.30). Displayed/applied values are
// reduced by Neurotoxin Recovery (-5%/lvl magnitude) and Neurotoxin Control
// (-5%/lvl chance): Improved Exile at both V → 22.5% chance of 18.75% penalty.
// ─────────────────────────────────────────────────────────────────────────────
export const BOOSTER_PENALTY_INFO = {
  boosterArmorHPPenalty:            { label:'Armor Capacity',            kind:'ship',     attr:'armorHP' },
  boosterShieldCapacityPenalty:     { label:'Shield Capacity',           kind:'ship',     attr:'shieldCapacity' },
  boosterCapacitorCapacityPenalty:  { label:'Capacitor Capacity',        kind:'ship',     attr:'capacitorCapacity' },
  boosterMaxVelocityPenalty:        { label:'Velocity',                  kind:'ship',     attr:'maxVelocity' },
  boosterTurretTrackingPenalty:     { label:'Turret Tracking',           kind:'turret',   attr:'trackingSpeed' },
  boosterTurretOptimalRangePenalty: { label:'Turret Optimal Range',      kind:'turret',   attr:'maxRange' },
  boosterTurretFalloffPenalty:      { label:'Turret Falloff',            kind:'turret',   attr:'falloff' },
  boosterMissileVelocityPenalty:    { label:'Missile Velocity',          kind:'launcher', attr:'maxVelocity' },
  boosterAOEVelocityPenalty:        { label:'Missile Explosion Velocity',kind:'launcher', attr:'aoeVelocity' },
  boosterMissileAOECloudPenalty:    { label:'Missile Explosion Radius',  kind:'launcher', attr:'aoeCloudSize' },
  boosterShieldBoostAmountPenalty:  { label:'Shield Boost Amount',       kind:'group',    attr:'shieldBonus',       groups:['Shield Booster','Ancillary Shield Booster'] },
  boosterArmorRepairAmountPenalty:  { label:'Armor Repair Amount',       kind:'group',    attr:'armorDamageAmount', groups:['Armor Repair Unit','Ancillary Armor Repairer'] },
};

/** Build the raw side-effect list for a booster by name from EVE type data.
 *  Returns [{key, label, value, chance, enabled:false}] with RAW (unskilled) values. */
export function boosterSideEffectsFor(name) {
  const tid = typeIDByName(name) ?? tidByName(name);
  const attrs = tid && TYPES[tid] ? (TYPES[tid].attrs ?? TYPES[tid].a ?? {}) : null;
  if (!attrs) return [];
  const out = [];
  let i = 0;
  for (const [key, info] of Object.entries(BOOSTER_PENALTY_INFO)) {
    const v = attrs[key];
    if (v == null || v === 0) continue;
    i++;
    const chance = attrs[`boosterEffectChance${i}`] ?? attrs.boosterEffectChance1 ?? 0.3;
    out.push({ key, label: info.label, value: v, chance, enabled: false });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Weapon identification helpers
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Warfare buff definitions for command bursts. Derived from CCP's dbuffcollections.
// Each entry: { ship:[attrNames] } applies the buff (PostPercent) to those SHIP attrs;
// { skill:[{attr,skill}] } applies to MODULES requiring that skill; { group:[{attr,groupID}] }
// applies to modules in that group. Effective % = burst.warfareBuff1Value (engine-modified by
// mindlink/skills) × charge.warfareBuff1Multiplier. One general handler covers every burst type.
// ─────────────────────────────────────────────────────────────────────────────
const WARFARE_BUFFS = {
  // Shield bursts
  10: { ship: ['shieldEmDamageResonance','shieldThermalDamageResonance','shieldKineticDamageResonance','shieldExplosiveDamageResonance'] },
  11: { skill: [ {attr:'capacitorNeed',skill:'Shield Operation'},{attr:'duration',skill:'Shield Operation'},
                 {attr:'capacitorNeed',skill:'Shield Emission Systems'},{attr:'duration',skill:'Shield Emission Systems'},
                 {attr:'capacitorNeed',skill:'Capital Shield Emission Systems'},{attr:'duration',skill:'Capital Shield Emission Systems'} ] },
  12: { ship: ['shieldCapacity'] },
  // Armor bursts
  13: { ship: ['armorEmDamageResonance','armorThermalDamageResonance','armorKineticDamageResonance','armorExplosiveDamageResonance'] },
  14: { skill: [ {attr:'capacitorNeed',skill:'Repair Systems'},{attr:'duration',skill:'Repair Systems'},
                 {attr:'capacitorNeed',skill:'Remote Armor Repair Systems'},{attr:'duration',skill:'Remote Armor Repair Systems'},
                 {attr:'capacitorNeed',skill:'Capital Remote Armor Repair Systems'},{attr:'duration',skill:'Capital Remote Armor Repair Systems'} ] },
  15: { ship: ['armorHP'] },
  // Information bursts
  16: { ship: ['scanResolution'] },
  // Electronic Superiority — extends EWAR module range + strength by module group (ECM/Damp/Disruptor/Painter).
  // {a:attrID, g:groupID}; applied by numeric attr ID to active modules of that group on the receiving fit.
  17: { groupMods: [
    {a:54,g:201},{a:54,g:208},{a:54,g:291},{a:54,g:379},
    {a:238,g:201},{a:239,g:201},{a:240,g:201},{a:241,g:201},
    {a:309,g:208},{a:566,g:208},
    {a:349,g:291},{a:351,g:291},{a:547,g:291},{a:596,g:291},{a:767,g:291},{a:847,g:291},{a:848,g:291},
    {a:554,g:379},
    {a:2044,g:201},{a:2044,g:208},{a:2044,g:291},{a:2044,g:379},
  ] },
  18: { ship: ['scanRadarStrength','scanLadarStrength','scanMagnetometricStrength','scanGravimetricStrength'] },
  19: { ship: ['sensorDampenerResistance','weaponDisruptionResistance'] },
  26: { ship: ['maxTargetRange'] },
  // Skirmish bursts
  20: { ship: ['signatureRadius'] },
  21: { skill: [ {attr:'maxRange',skill:'Propulsion Jamming'} ] },
  22: { skill: [ {attr:'speedFactor',skill:'Afterburner'},{attr:'speedFactor',skill:'High Speed Maneuvering'} ] },
  60: { ship: ['agility'] },
  // Weapon disruption bursts (turret)
  28: { skill: [ {attr:'maxRange',skill:'Gunnery'} ] },
  29: { skill: [ {attr:'falloff',skill:'Gunnery'} ] },
  30: { skill: [ {attr:'trackingSpeed',skill:'Gunnery'} ] },
  // Weapon disruption bursts (missile)
  31: { skill: [ {attr:'maxVelocity',skill:'Missile Launcher Operation'} ] },
  32: { skill: [ {attr:'explosionDelay',skill:'Missile Launcher Operation'} ] },
  33: { skill: [ {attr:'aoeVelocity',skill:'Missile Launcher Operation'} ] },
  34: { skill: [ {attr:'aoeCloudSize',skill:'Missile Launcher Operation'} ] },
};

// Extract every warfare buff from a burst module + its charge. Charges can carry up to FOUR buffs
// (warfareBuff1ID..warfareBuff4ID), e.g. Evasive Maneuvers gives both sig radius (20) AND agility (60).
// Effective value per buff = module's warfareBuffNValue (engine-modified by skills/mindlink) × charge multiplier.
function extractChargeBursts(fitItem, cAttrs) {
  const out = [];
  for (let n = 1; n <= 4; n++) {
    const buffID = cAttrs[`warfareBuff${n}ID`] ?? 0;
    if (!buffID) continue;
    const value = (fitItem.get(`warfareBuff${n}Value`) ?? 0) * (cAttrs[`warfareBuff${n}Multiplier`] ?? 1);
    if (value !== 0) out.push({ buffID, value });
  }
  return out;
}

// ── Damage-application math for the graph (ported from pyfa) ─────────────────
// Range strength factor (eos/calc.py calculateRangeFactor). restrictedRange=false for turrets.
export function calcRangeFactor(optimal, falloff, distance, restricted = true) {
  if (distance == null) return 1;
  if (falloff > 0) {
    if (restricted && distance > optimal + 3 * falloff) return 0;
    return Math.pow(0.5, Math.pow(Math.max(0, distance - optimal) / falloff, 2));
  }
  return distance <= optimal ? 1 : 0;
}
// Angular speed between attacker and target (rad/s).
export function calcAngularSpeed(atkSpeed, atkAngleDeg, atkRadius, distance, tgtSpeed, tgtAngleDeg, tgtRadius) {
  if (distance == null) return 0;
  const a = atkAngleDeg * Math.PI / 180, t = tgtAngleDeg * Math.PI / 180;
  const ctc = atkRadius + distance + tgtRadius;
  const trans = Math.abs(atkSpeed * Math.sin(a) - tgtSpeed * Math.sin(t));
  if (ctc === 0) return trans === 0 ? 0 : Infinity;
  return trans / ctc;
}
// Tracking factor component of chance-to-hit.
export function calcTrackingFactor(tracking, optimalSigRadius, angularSpeed, tgtSig) {
  if (!tracking || !tgtSig) return 0;
  return Math.pow(0.5, Math.pow((angularSpeed * optimalSigRadius) / (tracking * tgtSig), 2));
}
// Full turret chance-to-hit (range × tracking). Turrets fire at any range (restricted=false).
export function calcTurretCTH(p) {
  const ang = calcAngularSpeed(p.atkSpeed, p.atkAngle, p.atkRadius, p.distance, p.tgtSpeed, p.tgtAngle, p.tgtRadius);
  const rf = calcRangeFactor(p.optimal, p.falloff, p.distance, false);
  const tf = calcTrackingFactor(p.tracking, p.optimalSigRadius, ang, p.tgtSig);
  return rf * tf;
}
// Turret average damage multiplier given chance-to-hit (eve-uni Damage formula).
export function calcTurretMult(cth) {
  const wreckingChance = Math.min(cth, 0.01);
  const wreckingPart = wreckingChance * 3;
  const normalChance = cth - wreckingChance;
  let normalPart = 0;
  if (normalChance > 0) {
    const avgDamageMult = (0.01 + cth) / 2 + 0.49;
    normalPart = normalChance * avgDamageMult;
  }
  return normalPart + wreckingPart;
}
// Missile/drone-missile application factor (sig + speed based).
export function calcMissileFactor(atkEr, atkEv, atkDrf, tgtSpeed, tgtSig) {
  const factors = [1];
  if (atkEr > 0) factors.push(tgtSig / atkEr);
  if (tgtSpeed > 0) factors.push(Math.pow((atkEv * tgtSig) / (atkEr * tgtSpeed), atkDrf));
  return Math.min(...factors);
}

const TURRET_GROUPS  = new Set(['Projectile Weapon','Hybrid Weapon','Energy Weapon','Precursor Weapon','Mining Laser','Vorton Projector']);

// Round away float representation error before ceil/floor (mirrors pyfa's floatUnerr). Without this,
// e.g. 1.8/0.12 = 15.0000000000000018 → ceil → 16 instead of the correct 15.
function floatUnerr(value) {
  if (value === 0 || !isFinite(value)) return value;
  const keepDigits = 7; // ~half of float64's ~15 significant digits, like pyfa
  const roundFactor = keepDigits - Math.ceil(Math.log10(Math.abs(value)));
  const f = Math.pow(10, roundFactor);
  return Math.round(value * f) / f;
}

// Spool cycle count to reach full spool: ceil(max/perCycle), float-error corrected.
function spoolCyclesToMax(max, perCycle) {
  if (!max || !perCycle) return 0;
  return Math.ceil(floatUnerr(max / perCycle));
}

// Mutadaptive Remote Armor Repairers (Triglavian logistics: Rodiva/Zarmazd) spool their rep amount,
// like entropic disintegrators spool damage. The repairMultiplierBonusMax/PerCycle attrs aren't in
// the bundled TYPES data, so map them by typeID here. rep ramps base → base×(1+max) over
// ceil(max/perCycle) cycles. Values from CCP dogma (attrs 2797/2796).
const MUTADAPTIVE_SPOOL = {
  49770: { max: 1.5, perCycle: 0.1  }, // Heavy Mutadaptive Remote Armor Repairer I
  49771: { max: 1.5, perCycle: 0.1  }, // Heavy Mutadaptive Scoped Remote Armor Repairer
  49772: { max: 1.5, perCycle: 0.1  }, // Heavy Mutadaptive Compact Remote Armor Repairer
  49773: { max: 1.5, perCycle: 0.1  }, // Heavy Mutadaptive Remote Armor Repairer II
  49774: { max: 1.8, perCycle: 0.12 }, // Perun Heavy Mutadaptive Remote Armor Repairer
};
// Missile launchers are identified primarily by effect 101 (useMissiles — CCP's own activation
// marker for "this fires missiles", present on every launcher, ship or structure) rather than a
// hardcoded list. The group-name prefix check is a defensive fallback for when effect data isn't
// available (e.g. group-name-only lookups) — it does NOT cover structures: ship groups read
// "Missile Launcher <Kind>" (Light, Heavy, Heavy Assault, Rocket, Cruise, Torpedo, Rapid
// Light/Heavy/Torpedo, XL Cruise/Torpedo, Citadel, Defender, Bomb) but structure groups read
// "Structure <Kind> Missile Launcher" — CCP put the category name first instead of "Missile
// Launcher", so the prefix never matches. A structure launcher's weaponDps silently came out 0
// until this was found (2026-08-01) — see CLAUDE.md's structure fitting section.
function isMissileLauncherGroup(g, effectIDs) {
  if (effectIDs && effectIDs.includes(101)) return true;
  return typeof g === 'string' && g.startsWith('Missile Launcher');
}

// Exported: the hardpoint counters in the UI need the SAME answer the engine uses. They used to
// carry their own list of three group names ('Hybrid Weapon', 'Energy Weapon', 'Projectile Weapon'),
// which silently omitted Precursor Weapons — an entropic disintegrator occupied no turret hardpoint
// on a Vedmak — along with Mining Lasers and Vorton Projectors.
export function isTurret(groupName)   { return TURRET_GROUPS.has(groupName); }
export function isLauncher(groupName, effectIDs) { return isMissileLauncherGroup(groupName, effectIDs); }

// "Is this a missile weapon" and "does this consume a launcher hardpoint" are DIFFERENT questions,
// and conflating them cost a Legion a launcher slot: a Scan Probe Launcher carries effect 101
// (useMissiles) like every launcher does, so isLauncher() called it one. pyfa keys hardpoint usage
// on its own pair of marker effects instead — 42 turretFitted / 40 launcherFitted, see
// Module.__calculateHardpoint — and nothing else. That also correctly frees Bomb and Defender
// launchers (group name starts "Missile Launcher", but neither takes a hardpoint) while still
// catching structure launchers, whose group names don't match any prefix.
const EFF_TURRET_FITTED = 42, EFF_LAUNCHER_FITTED = 40;
export function usesTurretHardpoint(effectIDs)   { return Array.isArray(effectIDs) && effectIDs.includes(EFF_TURRET_FITTED); }
export function usesLauncherHardpoint(effectIDs) { return Array.isArray(effectIDs) && effectIDs.includes(EFF_LAUNCHER_FITTED); }

/**
 * Is a BIGGER value of this attribute better for the pilot?
 *
 * This is CCP's own `highIsGood` flag, read straight out of `dgmattribs` by build-bundle.py and
 * shipped as `h` on every attribute — so it refreshes with the bundle and needs no hand-maintained
 * list. That matters: of the 49 attributes a mutaplasmid can roll, 19 are lower-is-better, and the
 * non-obvious ones (the four hull damage resonances, `siegeLocalLogisticsDurationBonus`,
 * `energyWarfareResistanceBonus`) are exactly the ones a hand-written list would get wrong.
 *
 * Defaults to TRUE for an unknown attribute — the majority case, and what the UI assumed before.
 */
export function attrHighIsGood(attrID) {
  const meta = ATTR_META[attrID] ?? ATTR_META[String(attrID)];
  return meta?.h !== 0;
}
function isShieldBooster(g)    { return g === 'Shield Booster' || g === 'Capital Shield Booster' || g === 'Ancillary Shield Booster'; }
function isArmorRepairer(g)    { return g === 'Armor Repair Unit' || g === 'Capital Armor Repair Unit' || g === 'Ancillary Armor Repairer'; }

// ─────────────────────────────────────────────────────────────────────────────
// Module state helpers
// ─────────────────────────────────────────────────────────────────────────────
const isOnline    = s => s !== 'offline';
const isActive    = s => s === 'active' || s === 'overheated';
const isOverheated = s => s === 'overheated';

// ─────────────────────────────────────────────────────────────────────────────
// Character-level skill RoF/damage bonuses (applied AFTER engine)
// These are effects on Skill objects in Pyfa; we compute them analytically.
// ─────────────────────────────────────────────────────────────────────────────
function turretSkillMults(sk) {
  // Turret RoF skills: Gunnery (-2%/lv), Rapid Firing (-4%/lv)
  // These multiply speed (cycle time): lower speed = faster RoF
  const rofMult   = (1 - 0.02 * (sk.gunnery ?? 0)) * (1 - 0.04 * (sk.rapidFiring ?? 0));
  // Turret damage: Surgical Strike +3%/lv
  const dmgMult   = 1 + 0.03 * (sk.surgicalStrike ?? 0);
  // Tracking: Motion Prediction +5%/lv
  const trkMult   = 1 + 0.05 * (sk.motionPrediction ?? 0);
  // Optimal: Sharpshooter +5%/lv
  const optMult   = 1 + 0.05 * (sk.sharpshooter ?? 0);
  // Falloff: Trajectory Analysis +4%/lv
  const fallMult  = 1 + 0.04 * (sk.trajectoryAnalysis ?? 0);
  return { rofMult, dmgMult, trkMult, optMult, fallMult };
}

function missileLauncherSkillMult(sk) {
  // Missile Launcher Operation: -2%/lv cycle
  return 1 - 0.02 * (sk.missileLaunchers ?? 0);
}

function missileDmgSkillMult(sk) {
  // Warhead Upgrades: +2%/lv
  return 1 + 0.02 * (sk.warheadUpgrades ?? 0);
}

// Parent turret skill damage bonus (Effect408 family): +5%/lv for projectile/hybrid, 0 for laser

// Turret specialization skills: +2%/lv on T2 weapons only
// Keyed by the specialization skill name that the weapon's requiredSkills list contains.
const SPEC_SKILL_DMG = {
  'Large Autocannon Specialization':   { skill:'largeAutocannonSpec',  pct:2 },
  'Large Artillery Specialization':    { skill:'largeArtillerySpec',   pct:2 },
  'Large Blaster Specialization':      { skill:'largeBlasterSpec',     pct:2 },
  'Large Railgun Specialization':      { skill:'largeRailgunSpec',     pct:2 },
  'Large Beam Laser Specialization':   { skill:'largeBeamLaserSpec',   pct:2 },
  'Large Pulse Laser Specialization':  { skill:'largePulseLaserSpec',  pct:2 },
  'Medium Autocannon Specialization':  { skill:'mediumAutocannonSpec', pct:2 },
  'Medium Artillery Specialization':   { skill:'mediumArtillerySpec',  pct:2 },
  'Medium Blaster Specialization':     { skill:'mediumBlasterSpec',    pct:2 },
  'Medium Railgun Specialization':     { skill:'mediumRailgunSpec',    pct:2 },
  'Medium Beam Laser Specialization':  { skill:'mediumBeamLaserSpec',  pct:2 },
  'Medium Pulse Laser Specialization': { skill:'mediumPulseLaserSpec', pct:2 },
  'Small Autocannon Specialization':   { skill:'smallAutocannonSpec',  pct:2 },
  'Small Artillery Specialization':    { skill:'smallArtillerySpec',   pct:2 },
  'Small Blaster Specialization':      { skill:'smallBlasterSpec',     pct:2 },
  'Small Railgun Specialization':      { skill:'smallRailgunSpec',     pct:2 },
  'Small Beam Laser Specialization':   { skill:'smallBeamLaserSpec',   pct:2 },
  'Small Pulse Laser Specialization':  { skill:'smallPulseLaserSpec',  pct:2 },
};

const PARENT_TURRET_DMG = {
  'Projectile Weapon': { skill:'largeProjectileTurret',  pct:5 },
  'Hybrid Weapon':     { skill:'largeHybridTurret',      pct:5 },
  'Energy Weapon':     { skill:'largeEnergyTurret',      pct:0 },
  'Precursor Weapon':  { skill:'largeEnergyTurret',      pct:0 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Charge (ammo) lookup — returns basic damage profile from pyfa-types.json
// ─────────────────────────────────────────────────────────────────────────────
// Ship-hull missile damage bonuses (Pyfa filteredChargeBoost effects, not data-driven).
// effectID -> [shipBonusAttr, damageType, filterSkillIndex]; fit.ship.get(attr) is already
// prescaled by the racial/elite class skill, applied as a percent per damage type to charges
// requiring the filter skill. Generated from Pyfa eos/effects.py.
const SHIP_MD_SK=['Cruise Missiles','Heavy Assault Missiles','Heavy Missiles','Light Missiles','Missile Launcher Operation','Rockets','Torpedoes','XL Cruise Missiles','XL Torpedoes','Auto-Targeting Missiles'];
// NOTE: effect 12165 (ATFrigDmgBonus, Sidewinder & kin) is deliberately NOT in this table. It is
// a PILOT-SECURITY bonus: the magnitude is ATFrigDmgBonus x the pilot's (negative) sec status,
// not the raw attribute. It had an entry here too, so the raw -7.5% was applied on top of the
// sec-scaled +75% -- 1.75 x 0.925 -- and a -10.0 sec Sidewinder read 190.4 weapon DPS against
// eos's 205.8. The sec-scaled half lives with the other pilot-sec code further down.
const SHIP_MISSILE_DMG={898:['shipBonusCF','kin',4],899:['shipBonusCC','kin',4],1862:['shipBonusCF2','em',4],1863:['shipBonusCF2','th',4],1864:['shipBonusCF2','exp',4],3234:['shipBonusAF','exp',5],3235:['shipBonusAF','kin',5],3236:['shipBonusAF','th',5],3237:['shipBonusAF','em',5],4248:['subsystemBonusCaldariOffensive2',['kin'],[1,2,3]],4393:['eliteBonusCovertOps2','th',6],4394:['eliteBonusCovertOps2','em',6],4395:['eliteBonusCovertOps2','exp',6],4396:['eliteBonusCovertOps2','kin',6],4975:['shipBonusATF2','kin',4],5000:['rookieMissileKinDamageBonus','kin',4],5079:['shipBonusCF2','kin',4],5221:['shipBonusRole7','em',1],5222:['shipBonusRole7','kin',1],5223:['shipBonusRole7','th',1],5224:['shipBonusRole7','exp',1],5225:['shipBonusRole7','em',2],5226:['shipBonusRole7','exp',2],5227:['shipBonusRole7','kin',2],5228:['shipBonusRole7','th',2],5234:['shipBonusCF2',['exp'],[3,5]],5237:['shipBonusCF2',['kin'],[3,5]],5240:['shipBonusCF2',['th'],[3,5]],5243:['shipBonusCF2',['em'],[3,5]],5305:['shipBonusCD1','kin',3],5306:['shipBonusCD1','kin',5],5319:['shipBonusMD1','exp',3],5320:['shipBonusMD1','exp',5],5339:['shipBonusCBC1','kin',1],5340:['shipBonusCBC1','kin',2],5383:['shipBonusCC','em',4],5384:['shipBonusCC','th',4],5385:['shipBonusCC','exp',4],5386:['shipBonusCC2','kin',4],5539:['shipBonusAC','kin',2],5540:['shipBonusAC','em',2],5541:['shipBonusAC','th',2],5542:['shipBonusAC','exp',2],5628:['shipBonusMB','em',0],5629:['shipBonusMB','th',0],5630:['shipBonusMB','kin',0],5631:['shipBonusMB','exp',0],5632:['shipBonusMB','exp',6],5633:['shipBonusMB','em',6],5634:['shipBonusMB','th',6],5635:['shipBonusMB','kin',6],5636:['shipBonusMB','em',2],5637:['shipBonusMB','th',2],5638:['shipBonusMB','kin',2],5639:['shipBonusMB','exp',2],5733:['eliteBonusViolatorsRole1','exp',2],5734:['eliteBonusViolatorsRole1','kin',2],5735:['eliteBonusViolatorsRole1','em',2],5736:['eliteBonusViolatorsRole1','th',2],5811:['shipBonusGB2','kin',4],5812:['shipBonusGB2','th',4],5814:['shipBonusGF','kin',4],5815:['shipBonusGF','th',4],5825:['shipBonusGC2','kin',4],5826:['shipBonusGC2','th',4],5862:['shipBonusCB','em',4],5863:['shipBonusCB','kin',4],5864:['shipBonusCB','th',4],5865:['shipBonusCB','exp',4],6307:['shipBonusMD1','th',4],6308:['shipBonusMD1','em',4],6309:['shipBonusMD1','kin',4],6310:['shipBonusMD1','exp',4],6326:['shipBonusCD1','th',4],6327:['shipBonusCD1','em',4],6328:['shipBonusCD1','kin',4],6329:['shipBonusCD1','exp',4],6350:['shipBonus3CF',['kin'],[3,5]],6351:['shipBonusCC3','kin',4],6360:['shipBonusMF2',['em','kin','th'],5],6361:['shipBonus3MF','exp',5],7031:['shipBonusCBC2','kin',2],7032:['shipBonusCBC2','th',2],7033:['shipBonusCBC2','em',2],7034:['shipBonusCBC2','exp',2],7035:['shipBonusCBC2','exp',1],7036:['shipBonusCBC2','em',1],7037:['shipBonusCBC2','th',1],7038:['shipBonusCBC2','kin',1],8096:['shipBonusCD2','kin',4],11750:['shipBonusGBC1','kin',1],11751:['shipBonusGBC1','th',1],11752:['shipBonusGBC1','kin',2],11753:['shipBonusGBC1','th',2],11942:['shipBonusGD1','kin',4],11943:['shipBonusGD1','th',4],12051:['shipBonusUH2','em',4],12052:['shipBonusUH2','th',4],12053:['shipBonusUH2','exp',4],12054:['shipBonusUH2','kin',4],12058:['shipBonusUFreighter2','em',4],12060:['shipBonusUFreighter2','th',4],12061:['shipBonusUFreighter2','exp',4],12062:['shipBonusUFreighter2','kin',4],12069:['shipBonusUFreighter3','all',9],12190:['shipBonusRole2','all',5],12191:['shipBonusRole2','all',1],4635:['eliteBonusViolatorsRole1','all',[0,6]],4643:['shipBonusAC','all',1],5514:['eliteBonusCommandShips2','all',1],5521:['eliteBonusCommandShips2','all',2],6083:['shipBonusRole7','all',[3,5]],6088:['shipBonusMC2','all',1],6093:['shipBonusMC2','all',2],6096:['shipBonusMC2','all',3],7055:['shipBonusRole7','all',[0,2,6]],11070:['shipBonusCF','all',4],11411:['shipBonusMC2','all',4],11421:['shipBonusAB','all',6],11422:['shipBonusAB','all',0],11423:['shipBonusAB','all',2],11513:['shipBonusMF2','all',4],12892:['shipBonusMBC2','all',2],12893:['shipBonusMBC2','all',1],12812:['shipBonusCD1',['em','th','exp'],[3,5]],12813:['shipBonusCD2',['kin'],[3,5]],12807:['shipBonusAD1','all',[3,5]]};
const SUBSYS_MISSILE_DMG={4248:['subsystemBonusCaldariOffensive2','kin',['Light Missiles','Heavy Missiles','Heavy Assault Missiles']],};

// Ship-hull missile RANGE bonuses (Pyfa filteredChargeBoost on maxVelocity / explosionDelay,
// not data-driven). effectID -> [shipBonusAttr, 'vel'|'flight', filterSkillIdx]. Ship bonuses
// are unpenalized. Generated from Pyfa eos/effects.py.
const SHIP_MR_SK=['Cruise Missiles','Heavy Assault Missiles','Heavy Missiles','Light Missiles','Missile Launcher Operation','Rockets','Torpedoes'];
const SHIP_MISSILE_RANGE={784:['maxFlightTimeBonus','flight',4],891:['shipBonusCB3','vel',0],892:['shipBonusCB3','vel',6],1024:['shipBonusCC2','vel',2],1230:['shipBonusRole7','vel',4],1234:['shipBonusRole7','vel',3],1764:['speedFactor','vel',4],2561:['eliteBonusGunship1','vel',4],2809:['shipBonusCC2','vel',1],3355:['eliteBonusHeavyInterdictors1','vel',2],3356:['eliteBonusHeavyInterdictors1','vel',1],4331:['subsystemBonusCaldariOffensive3','vel',2],4377:['shipBonusGF2','vel',6],4378:['shipBonusMF2','vel',6],4379:['shipBonus2AF','vel',6],4380:['shipBonusCF2','vel',6],4384:['eliteBonusReconShip1','vel',2],4385:['eliteBonusReconShip1','vel',1],4413:['shipBonusGF','flight',6],4415:['shipBonusMF','flight',6],4416:['shipBonusCF','flight',6],4417:['shipBonusAF','flight',6],4637:['shipBonusCB3','vel',0],5080:['shipBonusCF','vel',4],5153:['shipBonusRole7','vel',5],5213:['rookieRocketVelocity','vel',5],5214:['rookieLightMissileVelocity','vel',3],5402:['shipBonusABC2','vel',1],5403:['shipBonusABC2','vel',2],5411:['shipBonusCD1','vel',4],5552:['eliteBonusHeavyGunship1','vel',2],5553:['eliteBonusHeavyGunship1','vel',1],5644:['shipBonusCC2','vel',1],5867:['shipBonusRole8','flight',4],6110:['missileVelocityBonus','vel',4],6111:['explosionDelayBonus','flight',4],6175:['roleBonusCBC','vel',4],6866:['shipBonusCF','flight',5],6874:['shipBonusCC2','flight',2],6881:['shipBonusCB','flight',6],6923:['subsystemBonusMinmatarOffensive','vel',2],8025:['hydraMissileFlightTimeBonus','flight',4],8070:['eliteBonusCommandShips2','vel',2]};

function chargeProfile(chargeName) {
  if (!chargeName) return null;
  const tid = typeIDByName(chargeName) ?? tidByName(chargeName);
  if (!tid) return null;
  const td  = TYPES[tid];
  if (!td)  return null;
  const a   = td.attrs;
  // TYPES stores attrs as numeric ID keys — map to named for calcs
  const _em  = a['114'] ?? a.emDamage        ?? 0;
  const _th  = a['118'] ?? a.thermalDamage   ?? 0;
  const _kin = a['117'] ?? a.kineticDamage   ?? 0;
  const _exp = a['116'] ?? a.explosiveDamage ?? 0;
  return {
    em:  _em, th: _th, kin: _kin, exp: _exp,
    get total() { return this.em + this.th + this.kin + this.exp; },
    // Missile-specific
    explosionRadius:   a.explosionRadius   ?? 0,
    explosionVelocity: a.explosionVelocity ?? 0,
    maxVelocity:       a.maxVelocity       ?? 0,
    mass:              a.mass              ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Missile damage factor (signature/velocity reduction)
// ─────────────────────────────────────────────────────────────────────────────
function missileFactor(charge, targetSigRadius, targetVelocity, missileVelocity) {
  if (!charge || !targetSigRadius) return 1;
  const { explosionRadius, explosionVelocity } = charge;
  if (!explosionRadius || !explosionVelocity) return 1;
  const sigFactor = targetSigRadius / explosionRadius;
  const velFactor = explosionVelocity / Math.max(1, targetVelocity) * (sigFactor < 1 ? sigFactor : 1);
  return Math.min(1, sigFactor, velFactor);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export: calcFitStats
// ─────────────────────────────────────────────────────────────────────────────
// Lazily-built list of every published skill name (category 16). Memoized after first build.
// The app's reference character is "All 5" (matching pyfa), so every skill is trained to L5.
// Hand-curated SKILL_DEFAULTS only covered ~1/3 of skills, which caused hull/weapon/drone
// bonuses to silently under-apply whenever a relevant skill was absent. Training all skills
// from the data removes that entire class of bug for current and future content.
let _allSkills = null;
function getAllSkills() {
  if (_allSkills) return _allSkills;
  const out = [];
  for (const tid in TYPES) {
    const t = TYPES[tid];
    if (!t) continue;
    if ((t.c ?? t.category) === 16 && t.n) out.push(t.n);
  }
  // Only memoize once TYPES is actually populated (avoids caching an empty list pre-init).
  if (out.length > 0) _allSkills = out;
  return out;
}

// Build a command ship's fit and extract each active Command Burst's effective buff value
// (warfareBuff1Value × charge multiplier — already engine-modified by the command ship's skills,
// mindlink, command processors). Returns [{buffID, value, label}] for projection onto another fit.
export function computeCommandBursts(ship, slots, skills = SKILL_DEFAULTS, opts = {}) {
  if (!ship || !slots) return [];
  const sk = { ...SKILL_DEFAULTS, ...skills };
  const shipTypeID = ship.typeID ?? tidByName(ship.name);
  if (!shipTypeID || !TYPES[shipTypeID]) return [];
  const fit = new Fit(shipTypeID);
  for (const [camel, level] of Object.entries(sk)) fit.setSkill(SKILL_CAMEL_TO_PYFA[camel] ?? camel, level);
  for (const skillName of getAllSkills()) if (fit._skills?.[skillName] == null) fit.setSkill(skillName, 5);
  const allSlots = [...(slots.high ?? []), ...(slots.mid ?? []), ...(slots.low ?? []), ...(slots.rigs ?? []), ...(slots.services ?? [])];
  // `!s.orphan` — a module stranded by a subsystem swap is KEPT in the rack so the user does not
  // lose it, but the ship genuinely no longer has that slot, so it must not contribute CPU, PG,
  // DPS or tank. Excluded here rather than at the UI, so every consumer of these stats agrees.
  const modItems = allSlots.filter(s => s.typeID && s.type !== 'empty' && !s.orphan).map(slot => {
    const m = fit.addModule(slot.typeID, slot.state ?? 'active', slot.mutations);
    if (slot.ammo) { const chName = slot.ammo.replace(/\s*\(\d+\)$/, ''); const chTid = typeIDByName(chName) ?? tidByName(chName); if (chTid && TYPES[chTid]) fit.setCharge(m, chTid); }
    return { slot, fitItem: m };
  });
  for (const imp of (opts.implants ?? [])) { if (!imp.name || imp.name === '[Empty]' || imp.active === false) continue; const tid = typeIDByName(imp.name) ?? tidByName(imp.name) ?? imp.typeID; if (tid && TYPES[tid]) fit.addImplant(tid); }
  for (const bst of (opts.boosters ?? [])) { if (!bst.name || bst.active === false) continue; const tid = bst.typeID ?? typeIDByName(bst.name) ?? tidByName(bst.name); if (tid && TYPES[tid]) fit.addBooster(tid); }
  fit.calculate();
  const bursts = [];
  for (const { slot, fitItem } of modItems) {
    if (!fitItem || !isActive(slot.state)) continue;
    if (fitItem.groupName !== 'Command Burst') continue;
    const chargeName = (slot.ammo || '').replace(/\s*\(\d+\)$/, '');
    const chargeTid = chargeName ? (typeIDByName(chargeName) ?? tidByName(chargeName)) : null;
    const cAttrs = chargeTid ? (TYPES[chargeTid]?.attrs || {}) : {};
    const buffID = cAttrs.warfareBuff1ID ?? 0;
    if (!chargeName) continue;
    for (const eb of extractChargeBursts(fitItem, cAttrs)) {
      if (!WARFARE_BUFFS[eb.buffID]) continue;
      bursts.push({ buffID: eb.buffID, value: eb.value, label: chargeName });
    }
  }
  return bursts;
}

// Build a fit and extract its active remote shield/armor repairers: rep-per-second (with the source
// module's overheat state already applied by the engine) and optimal/falloff range. For projecting
// remote assistance onto another fit, scaled by distance.
// T3 Destroyer tactical mode. `slots.tactical` = 'Defense' | 'Propulsion' | 'Sharpshooter'; the mode
// is a real dogma type named "<Ship> <Mode> Mode" whose effects apply hull PostDiv bonuses — one of
// which (modeEwarResistancePostDiv) feeds projectionResistances below, so both callers must set the
// mode the same way. Returns the mode typeID, or null.
function applyTacticalMode(fit, ship, slots) {
  if (!ship?.name) return null;
  // Every T3D carries its OWN mode items. The Skua used to be proxied to the Jackdaw's modes on the
  // belief that it shipped none — it does (90060/90062/90064); they were simply absent from the
  // bundle, because all 18 tactical modes are published=0 and build-bundle.py filtered on published.
  // The proxy therefore applied the WRONG hull's mode (Skua maxSpeed 2303 vs eos 2729). See
  // MODE_GROUP in scripts/build-bundle.py.
  //
  // Default mode when the fit names none: the first one this hull actually has. Most T3Ds call it
  // "Defense"; the Anhinga's are Primary/Secondary/Tertiary.
  const MODE_NAMES = ['Defense', 'Primary'];
  const modeTid = (n) => typeIDByName(`${ship.name} ${n} Mode`) ?? tidByName(`${ship.name} ${n} Mode`);
  const modeName = slots?.tactical ?? MODE_NAMES.find((n) => modeTid(n)) ?? null;
  if (!modeName) return null;
  const tid = modeTid(modeName);
  if (tid) fit.setShipMode(tid);
  return tid ?? null;
}

// Super-weapon effects that immobilise the ship and which CCP ships with an EMPTY modifier list, so
// the engine cannot apply them and calc.js must. Deliberately NOT a range: 6201/6474 sit far from
// the doomsday block, and the neighbouring immobilisers (cyno, jump portals, clone vat, industrial
// core) DO carry modifiers and are already handled by the engine.
const IMMOBILISING_SUPERWEAPON_EFFECTS = new Set([4489, 4490, 4491, 4492, 6201, 6474]);

// ── Command (warfare) bursts — shared by calcFitStats and computeProjectedReps ───────────────
// EVE does NOT stack same-type warfare buffs from different sources: only the strongest of each
// type applies, which is why these are collected into a buffID -> strongest map first.
function collectBursts(modItems, externalBursts) {
  const burstByType = new Map();  // buffID -> strongest value
  const addBurst = (buffID, value) => {
    if (!buffID || !value) return;
    const cur = burstByType.get(buffID);
    if (cur == null || Math.abs(value) > Math.abs(cur)) burstByType.set(buffID, value);
  };
  for (const { slot, fitItem } of modItems) {
    if (!fitItem || !isActive(slot.state)) continue;
    if (fitItem.groupName !== 'Command Burst') continue;
    const chargeName = (slot.ammo || '').replace(/\s*\(\d+\)$/, '');
    const chargeTid = chargeName ? (typeIDByName(chargeName) ?? tidByName(chargeName)) : null;
    const cAttrs = chargeTid ? (TYPES[chargeTid]?.attrs || {}) : {};
    for (const eb of extractChargeBursts(fitItem, cAttrs)) addBurst(eb.buffID, eb.value);
  }
  for (const eb of (externalBursts ?? [])) addBurst(eb.buffID, eb.value);
  return burstByType;
}

// Module-targeted warfare buffs, by group or by required skill. Ship-attribute buffs are applied
// separately in calcFitStats (they must land before the HP/resist snapshot); a projection SOURCE
// only needs its MODULES boosted, since all we read off it is rep amounts and cycle times.
function applyModuleBursts(burstByType, modItems) {
  for (const [buffID, eff] of burstByType) {
    const def = WARFARE_BUFFS[buffID];
    if (!def || !eff) continue;
    // Group-targeted buffs (e.g. Electronic Superiority): apply by numeric attr ID to modules of the group.
    if (def.groupMods) {
      for (const { a, g } of def.groupMods) {
        for (const { slot: s2, fitItem: m } of modItems) {
          if (!m || !isActive(s2.state)) continue;
          if (TYPES[m.typeID]?.g === g) m.attrs.applyMod(a, 6, eff, false);
        }
      }
      continue;
    }
    if (!def.skill) continue;
    // Apply each (attr, skill) target to modules requiring that skill (stacking-penalised PostPercent).
    for (const { attr, skill } of def.skill) {
      const aid = AID[attr];
      if (aid == null) continue;
      for (const { slot: s2, fitItem: m } of modItems) {
        if (!m || !isActive(s2.state)) continue;
        const rsArr = TYPES[m.typeID]?.rs ?? [];
        if (rsArr.includes(skill)) m.attrs.applyMod(aid, 6, eff, false);
      }
    }
  }
}

// ── EWAR resistance of the TARGET of a projection ───────────────────────────
// Incoming projected effects are scaled by a resistance attribute on the ship being hit — eos does
// this in ModifiedAttributeDict.getResistance(), which looks up the effect's resistanceID and reads
// that attribute off the target. Baseline is 1 (no resistance); a Siege/Bastion module sets
// sensorDampenerResistanceBonus -70 (→ 0.30) and a T3 destroyer's Sharpshooter mode divides by
// modeEwarResistancePostDiv 3 (→ 0.3333).
//
// CRUCIAL: the resistance multiplies each SOURCE MODULE's bonus BEFORE stacking, not the stacked
// total afterwards — stack(b·r) ≠ stack(b)·r. Applying it after gave a sieged Phoenix Navy Issue
// 25.9 km lock range against eos's 95.1; per-module it reproduces eos exactly.
const EWAR_RESIST_ATTRS = {
  damp:     'sensorDampenerResistance',   // remote sensor dampeners  → lock range / scan res
  web:      'stasisWebifierResistance',   // stasis webifiers         → velocity
  neut:     'energyWarfareResistance',    // energy neutralisers      → capacitor
  painter:  'targetPainterResistance',    // target painters          → signature
  disrupt:  'weaponDisruptionResistance', // tracking/guidance disruptors
};

/** The projection-resistance multipliers of a fit, keyed as in EWAR_RESIST_ATTRS. All default to 1. */
export function projectionResistances(ship, slots, skills = SKILL_DEFAULTS, opts = {}) {
  const out = Object.fromEntries(Object.keys(EWAR_RESIST_ATTRS).map(k => [k, 1]));
  const shipTypeID = ship?.typeID ?? tidByName(ship?.name);
  if (!shipTypeID || !TYPES[shipTypeID] || !slots) return out;
  try {
    const sk = { ...SKILL_DEFAULTS, ...skills };
    const fit = new Fit(shipTypeID);
    for (const [camel, level] of Object.entries(sk)) fit.setSkill(SKILL_CAMEL_TO_PYFA[camel] ?? camel, level);
    for (const skillName of getAllSkills()) if (fit._skills?.[skillName] == null) fit.setSkill(skillName, 5);
    const modItems = [];
    for (const sec of ['high', 'mid', 'low', 'rigs', 'services']) {
      for (const s of (slots[sec] ?? [])) {
        if (!s?.typeID || s.type === 'empty') continue;
        const m = fit.addModule(s.typeID, s.state ?? 'active', s.mutations);
        if (s.ammo) {
          const chName = s.ammo.replace(/\s*\(\d+\)$/, '');
          const chTid = typeIDByName(chName) ?? tidByName(chName);
          if (chTid && TYPES[chTid]) fit.setCharge(m, chTid);
        }
        modItems.push({ slot: s, fitItem: m });
      }
    }
    applyTacticalMode(fit, ship, slots);
    fit.calculate();
    // EWAR resistance is overwhelmingly a COMMAND BURST effect, not a hull attribute: buff 19
    // (Electronic Hardening Charge) is what gives sensorDampenerResistance/weaponDisruptionResistance
    // at all on most hulls. Reading the attributes straight off a freshly calculated Fit therefore
    // returned a flat 1.0 — no resistance — for every boosted fit, and every projected sensor damp
    // hit at full strength. A Celestis under an Information Command Burst read 26.5 km of lock range
    // against eos's 48.5. calcFitStats already applies these; this function has to as well.
    const burstByType = collectBursts(modItems, opts.externalBursts);
    for (const [buffID, eff] of burstByType) {
      const def = WARFARE_BUFFS[buffID];
      if (!def?.ship || !eff) continue;
      for (const attrName of def.ship) {
        const aid = AID[attrName];
        if (aid != null) fit.ship.attrs.applyMod(aid, 6, eff, false);
      }
    }
    for (const [key, attr] of Object.entries(EWAR_RESIST_ATTRS)) {
      const v = fit.ship.get(attr);
      if (Number.isFinite(v) && v > 0) out[key] = v;
    }
    // Not a resistance, but it comes off the same computed target fit and every caller that wants
    // resistances also needs it: with disallowAssistance set, the ship refuses ALL incoming remote
    // assistance (reps, remote sensor boosters, remote tracking computers) while still taking EWAR
    // normally. eos gates each assistance effect on exactly this attribute. In the current game the
    // only common source is an ACTIVE HIC bubble (Warp Disrupt Field Generator, effect 3380) —
    // Siege/Bastion/Triage all carry disallowAssistance=0 and do NOT block assistance.
    out.disallowAssistance = !!fit.ship.get('disallowAssistance');
  } catch { /* resistances are an optimisation on top of a correct-enough default of 1 */ }
  return out;
}

// Remote-repair DIMINISHING RETURNS (eos Fit.__getAppliedRr). Incoming remote reps do not simply
// add up: past a few thousand HP/s each source is scaled down, which is what stops a wall of logi
// from being linearly better. Applies to all three layers (hull/armor/shield), independently.
//
//   totalRaw = Σ amount_i / int(cycle_i)          <- int() on the cycle, in SECONDS, is deliberate
//   mod_i    = 7000 + (amount_i / int(cycle_i)) * 20
//   mult_i   = 1 - ((rrps_i + mod_i) / (totalRaw + mod_i) - 1)²
//   applied  = Σ mult_i * amount_i / cycle_i      <- exact cycle here, not the truncated one
//
// eos's own comment on the truncation: "for considerations of RR diminishing returns cycle time is
// rounded this way". The mixed truncated/exact cycle is not a typo — reproducing it is what makes
// the numbers land: a Leshak under 14 projected Large Remote Armor Repairer IIs gets a 0.951217
// multiplier, 3455.77 HP/s rather than the naive 3633.0.
//
// Below a few thousand HP/s the multiplier is ~1, which is why single-logi fits never showed this.
export function applyRemoteRepDiminishing(entries) {
  if (!entries || !entries.length) return 0;
  const RR_ADDITION = 7000, RR_MULTIPLIER = 20;
  // eos divides by int(cycle) and would raise on a sub-second cycle; no remote rep has one, but
  // fall back to the exact cycle rather than dividing by zero.
  const trunc = (c) => (Math.trunc(c) || c);
  let totalRaw = 0;
  for (const e of entries) totalRaw += e.amount / trunc(e.cycleS);
  let applied = 0;
  for (const e of entries) {
    const rrps = e.amount / trunc(e.cycleS);
    const mod = RR_ADDITION + rrps * RR_MULTIPLIER;
    const mult = 1 - ((rrps + mod) / (totalRaw + mod) - 1) ** 2;
    applied += mult * e.amount / e.cycleS;
  }
  return applied;
}

// ── Target resist profiles (outgoing damage) ────────────────────────────────
// The mirror image of the incoming damage profile: that one says what is hitting YOU and weights
// EHP, this one says how resistant the thing you are SHOOTING is and weights DPS. Values are
// RESIST FRACTIONS per damage type, [em, th, kin, exp], matching src/data/target-profiles.js.
//
// Everything the app reports stays RAW; the resist-weighted figures are exposed alongside under
// `effective`. Keeping both matters for more than tidiness — the oracle diffs our raw DPS against
// eos, and eos reports unmitigated damage, so folding resists into weaponDps would make every
// comparison in the corpus wrong.
export const NO_TARGET_RESISTS = [0, 0, 0, 0];
export function applyTargetResists(dmg, r) {
  if (!dmg) return dmg;
  const res = (Array.isArray(r) && r.length === 4) ? r : NO_TARGET_RESISTS;
  const em = (dmg.em ?? 0) * (1 - res[0]), th = (dmg.th ?? 0) * (1 - res[1]);
  const kin = (dmg.kin ?? 0) * (1 - res[2]), exp = (dmg.exp ?? 0) * (1 - res[3]);
  return { em, th, kin, exp, total: em + th + kin + exp };
}

export function computeProjectedReps(ship, slots, skills = SKILL_DEFAULTS, opts = {}) {
  if (!ship || !slots) return [];
  const sk = { ...SKILL_DEFAULTS, ...skills };
  const shipTypeID = ship.typeID ?? tidByName(ship.name);
  if (!shipTypeID || !TYPES[shipTypeID]) return [];
  const fit = new Fit(shipTypeID);
  for (const [camel, level] of Object.entries(sk)) fit.setSkill(SKILL_CAMEL_TO_PYFA[camel] ?? camel, level);
  for (const skillName of getAllSkills()) if (fit._skills?.[skillName] == null) fit.setSkill(skillName, 5);
  const allSlots = [...(slots.high ?? []), ...(slots.mid ?? []), ...(slots.low ?? []), ...(slots.rigs ?? []), ...(slots.services ?? [])];
  const modItems = allSlots.filter(s => s.typeID && s.type !== 'empty' && !s.orphan).map(slot => {
    const m = fit.addModule(slot.typeID, slot.state ?? 'active', slot.mutations);
    if (slot.ammo) { const chName = slot.ammo.replace(/\s*\(\d+\)$/, ''); const chTid = typeIDByName(chName) ?? tidByName(chName); if (chTid && TYPES[chTid]) fit.setCharge(m, chTid); }
    return { slot, fitItem: m };
  });
  for (const imp of (opts.implants ?? [])) { if (!imp.name || imp.name === '[Empty]' || imp.active === false) continue; const tid = typeIDByName(imp.name) ?? tidByName(imp.name) ?? imp.typeID; if (tid && TYPES[tid]) fit.addImplant(tid); }
  for (const bst of (opts.boosters ?? [])) { if (!bst.name || bst.active === false) continue; const tid = bst.typeID ?? typeIDByName(bst.name) ?? tidByName(bst.name); if (tid && TYPES[tid]) fit.addBooster(tid); }
  // Remote-rep drones (Armor/Shield/Hull Maintenance Bots) projected from the source ship also rep
  // the target — often a logi frigate's entire rep output is its flight of maintenance bots. Build
  // them before calculate() so the rep amount is engine-resolved; keep qty parallel. Only launched
  // (active) drones rep, matching the DPS path.
  const anyDroneActive = (opts.drones ?? []).some(d => typeof d.active === 'boolean');
  const droneItems = [];
  for (const drone of (opts.drones ?? [])) {
    if (anyDroneActive && drone.active !== true) continue;
    const dtid = drone.typeID ?? (typeIDByName(drone.name) ?? tidByName(drone.name));
    if (dtid && TYPES[dtid]) droneItems.push({ item: fit.addDrone(dtid), qty: drone.qty ?? drone.count ?? 1, name: drone.name ?? TYPES[dtid].n });
  }
  // The system the SOURCE is sitting in affects what it projects too (a Wolf-Rayet logi reps the
  // same, but a storm changes its damage). Cheap to thread through and wrong to omit.
  if (opts.environment) {
    const envTid = typeof opts.environment === 'number' ? opts.environment
      : (typeIDByName(opts.environment) ?? tidByName(opts.environment));
    if (envTid && TYPES[envTid]) fit.setEnvironment(envTid);
  }
  // The SOURCE's T3 CRUISER subsystems. `allSlots` above deliberately lists the racks; subsystems
  // are a separate collection and were simply missing here, so a projected Loki/Legion/Tengu/Proteus
  // lost every subsystem bonus it has. A logi Loki's remote shield boosters cycled 5854 ms instead
  // of 5715 (its Offensive - Support Processor shortens them), repping 2.4% light.
  if (Array.isArray(slots.subsystems) && slots.subsystems.length) {
    const subTids = slots.subsystems
      .map(s => s && (s.typeID ?? typeIDByName(s.name) ?? tidByName(s.name)))
      .filter(Boolean);
    if (subTids.length) fit.setSubsystems(subTids);
  }
  // The SOURCE's tactical mode changes what it projects. calcFitStats and projectionResistances both
  // applied it; this function did not, so a T3D projecting remote reps repped as if it had no mode
  // at all — a Confessor in Defense Mode (x1.3333 armorDamageAmount) projected 43.6 HP/s instead of
  // 58.1. eos defaults a modeless T3D to its first mode, which applyTacticalMode also does.
  applyTacticalMode(fit, ship, slots);
  fit.calculate();
  // Command bursts on the SOURCE of a projection. A logi under a Shield Command Burst reps harder,
  // and the buff lands on cycle TIME rather than amount: a Basilisk's Large Remote Shield Booster
  // keeps its 680 HP but its duration drops 8000 ms -> 6680 ms, i.e. +19.8% HP/s. Reading the
  // source's modules without its own bursts understated every boosted logi by exactly that.
  // Own Command Burst modules are picked up from modItems; opts.externalBursts carries links from
  // other fits. Only MODULE buffs matter here — nothing reads the source ship's own HP or resists.
  applyModuleBursts(collectBursts(modItems, opts.externalBursts), modItems);
  const reps = [];
  const caps = [];    // projected Remote Capacitor Transmitters: {gjPerSec, optimal, falloff}
  const webs = [];
  const neuts = [];
  const painters = [];   // {sigBonus, optimal, falloff}
  const damps = [];      // {lockBonus, scanResBonus, optimal, falloff}
  const sensorBoosts = []; // projected Remote Sensor Booster: {lockBonus, scanResBonus, optimal, falloff}
  const trackDisr = [];  // {tracking, optimal:rangeBonus, falloff:falloffBonus, opt, fall}
  const guideDisr = [];  // {missileRange, explosionDelay, aoeVel, aoeCloud, opt, fall}
  const ecm = [];        // {strength, optimal, falloff}
  for (const { slot, fitItem } of modItems) {
    if (!fitItem || !isActive(slot.state)) continue;
    const gn = fitItem.groupName;
    const optimal = fitItem.get('maxRange') ?? 0;
    const falloff = fitItem.get('falloffEffectiveness') ?? 0;
    const dur = (fitItem.get('duration') ?? 1) / 1000;
    // ANCILLARY remote reps sit in their OWN groups ('Ancillary Remote Shield Booster' /
    // 'Ancillary Remote Armor Repairer'), not the plain ones — so matching only the plain group name
    // dropped them silently. A projected Osprey's Medium Ancillary Remote Shield Booster contributed
    // 0 instead of 124.86 HP/s, and every logi carrying one under-repped by a third. The amount is
    // engine-computed, so the charge bonus (cap booster / nanite paste) is already baked in.
    if (gn === 'Remote Shield Booster' || gn === 'Ancillary Remote Shield Booster') {
      const amt = fitItem.get('shieldBonus') ?? 0;
      if (amt > 0) reps.push({ kind: 'shield', name: slot.name, rawPS: amt / dur, amount: amt, cycleS: dur, optimal, falloff });
    } else if (gn === 'Remote Armor Repairer' || gn === 'Mutadaptive Remote Armor Repairer'
               || gn === 'Ancillary Remote Armor Repairer') {
      // An Ancillary Remote Armor Repairer loaded with Nanite Repair Paste reps x3 (eos:
      // saveddata/module.py, `if group == 'Ancillary Remote Armor Repairer' and self.charge`). The
      // LOCAL ancillary path already did this; the projected one did not, so a spider-repping pair
      // of Confessors counted the remote AAR at a third of its output.
      // eos keys purely on "a charge is loaded" — an ARAR takes nothing but paste.
      const isAncillary = gn === 'Ancillary Remote Armor Repairer';
      const pasteMult = (isAncillary && slot.ammo) ? (fitItem.get('chargedArmorDamageMultiplier') || 3) : 1;
      const amt = (fitItem.get('armorDamageAmount') ?? 0) * pasteMult;
      // Mutadaptive reppers (Rodiva/Zarmazd) ramp their rep amount cycle by cycle, exactly like an
      // entropic disintegrator ramps damage. Carried on the record so the reps-over-time graph can
      // draw the ramp; `amount` stays the UNSPOOLED per-cycle figure.
      //
      // Read from the engine, not from the MUTADAPTIVE_SPOOL table above: attributes 2797/2796 are
      // in the bundle after all (that table's comment says they are not — it predates a bundle
      // regen), and going through the engine means hull/skill modifiers apply and a new mutadaptive
      // module works without being added to a list.
      const rSpoolMax = fitItem.get('repairMultiplierBonusMax') ?? 0;
      const rSpoolPer = fitItem.get('repairMultiplierBonusPerCycle') ?? 0;
      if (amt > 0) reps.push({ kind: 'armor', name: slot.name, rawPS: amt / dur, amount: amt, cycleS: dur, optimal, falloff,
                               spoolMax: rSpoolMax, spoolPerCycle: rSpoolPer });
    } else if (gn === 'Remote Hull Repairer') {
      const amt = fitItem.get('structureDamageAmount') ?? 0;
      if (amt > 0) reps.push({ kind: 'hull', name: slot.name, rawPS: amt / dur, amount: amt, cycleS: dur, optimal, falloff });
    } else if (gn === 'Remote Capacitor Transmitter') {
      // Cap transfer was simply missing from this dispatch, so a projected Guardian/Basilisk showed
      // no transmitters at all and the target received none of the capacitor they are the entire
      // point of. `powerTransferAmount` is GJ delivered per cycle.
      //
      // It is ASSISTANCE, so like remote reps it is refused by disallowAssistance and is NOT reduced
      // by the target's EWAR resistance. Unlike reps it gets no diminishing-returns curve — eos's
      // __getAppliedRr covers hull/armor/shield only, and nothing scales incoming cap.
      const amt = fitItem.get('powerTransferAmount') ?? 0;
      if (amt > 0) caps.push({ name: slot.name, gjPerSec: amt / dur, amount: amt, cycleS: dur, optimal, falloff });
    } else if (gn === 'Stasis Web' || gn === 'Stasis Grappler') {
      const sf = fitItem.get('speedFactor') ?? 0;
      if (sf < 0) webs.push({ name: slot.name, speedFactor: sf, optimal, falloff });
    } else if (gn === 'Energy Neutralizer' || gn === 'Energy Nosferatu') {
      const amt = fitItem.get('energyNeutralizerAmount') ?? fitItem.get('powerTransferAmount') ?? 0;
      if (amt > 0) neuts.push({ name: slot.name, gjPerSec: amt / dur, optimal, falloff });
    } else if (gn === 'Target Painter') {
      const sig = fitItem.get('signatureRadiusBonus') ?? 0;
      if (sig > 0) painters.push({ name: slot.name, sigBonus: sig, optimal, falloff });
    } else if (gn === 'Sensor Dampener') {
      const lr = fitItem.get('maxTargetRangeBonus') ?? 0;
      const sr = fitItem.get('scanResolutionBonus') ?? 0;
      if (lr < 0 || sr < 0) damps.push({ name: slot.name, lockBonus: lr, scanResBonus: sr, optimal, falloff });
    } else if (gn === 'Remote Sensor Booster') {
      // The friendly mirror image of a damp (eos Effect6427): same two attributes, positive, same
      // stacking pool. It is ASSISTANCE, so unlike a damp it is NOT reduced by the target's EWAR
      // resistance. Missing it entirely is why a Machariel with a Scimitar's remote sensor booster
      // projected onto it read 180 km of lock range against eos's 300.
      const lr = fitItem.get('maxTargetRangeBonus') ?? 0;
      const sr = fitItem.get('scanResolutionBonus') ?? 0;
      if (lr > 0 || sr > 0) sensorBoosts.push({ name: slot.name, lockBonus: lr, scanResBonus: sr, optimal, falloff });
    } else if (gn === 'Weapon Disruptor') {
      const trk = fitItem.get('trackingSpeedBonus') ?? 0;
      const mv  = fitItem.get('missileVelocityBonus') ?? 0;
      if (trk < 0 || (fitItem.get('maxRangeBonus') ?? 0) < 0 && mv === 0) {
        trackDisr.push({ name: slot.name, tracking: trk, optimalBonus: fitItem.get('maxRangeBonus') ?? 0, falloffBonus: fitItem.get('falloffBonus') ?? 0, optimal, falloff });
      }
      if (mv < 0 || (fitItem.get('explosionDelayBonus') ?? 0) !== 0) {
        guideDisr.push({ name: slot.name, missileRange: mv, explosionDelay: fitItem.get('explosionDelayBonus') ?? 0, aoeVel: fitItem.get('aoeVelocityBonus') ?? 0, aoeCloud: fitItem.get('aoeCloudSizeBonus') ?? 0, optimal, falloff });
      }
    } else if (gn === 'ECM') {
      const sb = Math.max(
        fitItem.get('scanGravimetricStrengthBonus') ?? 0,
        fitItem.get('scanLadarStrengthBonus') ?? 0,
        fitItem.get('scanMagnetometricStrengthBonus') ?? 0,
        fitItem.get('scanRadarStrengthBonus') ?? 0,
      );
      if (sb > 0) ecm.push({ name: slot.name, strength: sb, optimal, falloff });
    }
  }
  // Logistic-drone reps. All maintenance bots share groupName 'Logistic Drone'; the layer is
  // whichever rep-amount attribute is populated (armor/shield/structureDamageAmount all default to 0,
  // so a >0 test cleanly picks it without a presence check). Drones orbit the ship they assist, so
  // their reps apply at full strength regardless of the projection range (huge optimal, no falloff).
  for (const { item, qty, name } of droneItems) {
    if (!item || item.groupName !== 'Logistic Drone') continue;
    const dur = (item.get('duration') ?? 0) / 1000;
    if (dur <= 0) continue;
    const amt = { armor: item.get('armorDamageAmount') ?? 0, shield: item.get('shieldBonus') ?? 0, hull: item.get('structureDamageAmount') ?? 0 };
    for (const kind of ['armor', 'shield', 'hull']) {
      if (amt[kind] > 0) reps.push({ kind, name, rawPS: (amt[kind] / dur) * qty, optimal: 1e9, falloff: 0 });
    }
  }
  return { reps, caps, webs, neuts, painters, damps, sensorBoosts, trackDisr, guideDisr, ecm };
}

export function calcFitStats(ship, slots, drones = [], skills = SKILL_DEFAULTS, opts = {}) {
  if (!ship || !slots) return null;

  const sk = { ...SKILL_DEFAULTS, ...skills };
  // An implant can be left in the fit but switched OFF (pyfa exposes Implant.active, and eos then
  // ignores it — boosters already honoured this, implants did not). Filter once here so every
  // downstream loop (engine implants, damage multipliers, missile-range consumables) agrees.
  const implants       = (opts.implants ?? []).filter((i) => i && i.active !== false);
  const boosters       = opts.boosters ?? [];
  // Resists of whatever this fit is shooting, [em,th,kin,exp] as fractions. Absent → all zero,
  // which makes every `effective` figure identical to its raw counterpart.
  const _tgtRes = (Array.isArray(opts.targetResists) && opts.targetResists.length === 4)
    ? opts.targetResists : NO_TARGET_RESISTS;
  const factorInReload = !!opts.factorInReload;

  // ── 1. Find ship typeID ───────────────────────────────────────────────────
  const shipTypeID = ship.typeID ?? tidByName(ship.name);
  if (!shipTypeID || !TYPES[shipTypeID]) return null;

  // ── 2. Build Fit ──────────────────────────────────────────────────────────
  const fit = new Fit(shipTypeID);

  // Set skill levels (translate camelCase → Pyfa "Proper Name")
  for (const [camel, level] of Object.entries(sk)) {
    const pyfa = SKILL_CAMEL_TO_PYFA[camel] ?? camel;
    fit.setSkill(pyfa, level);
  }

  // Systemic: ensure EVERY ship-class skill (Spaceship Command group) is trained.
  // Ship hull bonuses (shipBonus*/eliteBonus*) are pre-scaled by the relevant racial/elite
  // ship skill level in the engine's skill pass; if that skill isn't set, the bonus stays at
  // its unscaled per-level value and damage/range/etc. silently under-apply. Rather than
  // hand-listing each ship's skills, train all of them at L5 (the "All 5" character pyfa uses
  // as reference). Explicit user levels above already take precedence (set first).
  // Systemic: ensure EVERY skill is trained (L5), matching the "All 5" reference character.
  // Ship hull bonuses, weapon/drone damage, range, and RoF all depend on skills being present;
  // a missing skill silently drops its bonus. Training all skills from the data (rather than a
  // hand-curated subset) makes any fit calculate at the All-5 baseline. Explicit user levels set
  // in the loop above take precedence (we only fill skills not already specified).
  for (const skillName of getAllSkills()) {
    if (fit._skills?.[skillName] == null) fit.setSkill(skillName, 5);
  }

  // Collect all slots
  const allSlots = [
    ...(slots.high ?? []), ...(slots.mid  ?? []),
    ...(slots.low  ?? []), ...(slots.rigs ?? []),
    ...(slots.services ?? []),
  ];
  const activeSlots = allSlots.filter(s => s.typeID && s.type !== 'empty' && !s.orphan);

  // Add modules — keep reference to module FitItem aligned with slot index
  const modItems = activeSlots.map(slot => {
    const m = fit.addModule(slot.typeID, slot.state ?? 'active', slot.mutations);
    // Load the charge into the engine so charge-targeted effects (ship/subsystem missile damage
    // bonuses, etc.) apply to its damage attributes, read back during DPS calc.
    if (slot.ammo) {
      const chName = slot.ammo.replace(/\s*\(\d+\)$/, '');
      const chTid  = typeIDByName(chName) ?? tidByName(chName);
      if (chTid && TYPES[chTid]) fit.setCharge(m, chTid);
    }
    // Reactive Armor Hardener adaptation setting (Effect4928): 'disable' (do not adapt),
    // {p:[em,th,kin,exp]} (adapt to a specific ammo/NPC split), or undefined → "fit pattern".
    if (slot.rahPattern !== undefined) m._rahPattern = slot.rahPattern;
    return { slot, fitItem: m };
  });

  // Add implants — App.jsx stores {slot, name, bonus}, engine needs typeID
  for (const imp of implants) {
    if (!imp.name || imp.name === '[Empty]') continue;
    // Prefer name-based lookup — stored typeIDs may be from old data
    const tid = typeIDByName(imp.name) ?? tidByName(imp.name) ?? imp.typeID;
    if (tid && TYPES[tid]) fit.addImplant(tid);
  }
  // Add boosters — App.jsx stores {id, name, effect, active}, engine needs typeID
  for (const bst of boosters) {
    if (!bst.name || bst.active === false) continue;
    const tid = bst.typeID ?? typeIDByName(bst.name) ?? tidByName(bst.name);
    if (tid && TYPES[tid]) fit.addBooster(tid);
  }

  // ── 2b. T3 Destroyer tactical mode ────────────────────────────────────────
  const tacticalModeTid = applyTacticalMode(fit, ship, slots);
  // ENVIRONMENT — wormhole class effect / metaliminal storm / event beacon the fit is sitting in.
  // Accepted as a typeID or a name; stored on the fit as slots.environment so it persists and is
  // covered by undo, with opts.environment as an override for programmatic callers (the oracle).
  const _envRaw = opts.environment ?? slots.environment ?? null;
  let environmentTid = null;
  if (_envRaw) {
    environmentTid = typeof _envRaw === 'number' ? _envRaw
      : (typeIDByName(_envRaw) ?? tidByName(_envRaw));
    if (environmentTid && TYPES[environmentTid]) fit.setEnvironment(environmentTid);
    else environmentTid = null;
  }
  // Anhinga's Primary/Secondary/Tertiary modes DO exist as dogma types (90061/90063/90065) whose
  // effects are all PostDiv (attr / value); the per-field multipliers below are 1/value of those:
  //   ROF PostDiv → rofMult (cycle); MissileFlightTime PostDiv → missileFlight (explosionDelay);
  //   MissileMaxVelocity PostDiv → missileVel; MaxTargetRange PostDiv → lockRange; Agility PostDiv
  //   → agility (inertia). Default = Primary (matches the UI default).
  // (The Anhinga's mode bonuses used to be hand-transcribed into an ANHINGA_MODES table here,
  // because its mode ITEMS were missing from the bundle — every value in that table was exactly
  // 1/<the mode's own PostDiv attribute>. The items are now generated (see MODE_GROUP in
  // scripts/build-bundle.py) and their effects patched in, so lock range (6010), agility (6016)
  // and launcher rate of fire (12799) come from the engine like every other hull's. Missile
  // velocity and flight time still have to be applied by hand — but data-driven off the mode
  // type, not a table — because this file reads charge attributes raw; see MODE_MISSILE_VEL.)

  // ── 2c. T3 Cruiser subsystems ─────────────────────────────────────────────
  // slots.subsystems = array of {name} for the 4 fitted subsystems (Core/Defensive/
  // Offensive/Propulsion). Each is a real dogma type whose effects apply hull bonuses
  // and fitting reductions. Pass their typeIDs to the engine.
  if (Array.isArray(slots.subsystems) && slots.subsystems.length) {
    const subTids = slots.subsystems
      .map(s => s && (s.typeID ?? typeIDByName(s.name) ?? tidByName(s.name)))
      .filter(Boolean);
    if (subTids.length) fit.setSubsystems(subTids);
  }

  // Add drones to the engine so they go through the full effect chain (Drone Interfacing,
  // ship/subsystem drone-damage bonuses, drone damage amplifiers, etc.). We keep a parallel
  // list of their FitItems so DPS can read engine-resolved damage instead of raw type data.
  // Only drones marked active (launched into space) contribute DPS, matching pyfa — drones
  // sitting in the bay deal 0. If NO drone carries an explicit `active` field (legacy fits or
  // programmatic callers), treat all as active so DPS isn't silently zeroed.
  const anyActiveFlag = drones.some(d => typeof d.active === 'boolean');
  const droneItems = [];
  for (const drone of drones) {
    const dtid = drone.typeID ?? (typeIDByName(drone.name) ?? tidByName(drone.name));
    const isActive = anyActiveFlag ? (drone.active === true) : true;
    if (dtid && TYPES[dtid]) {
      const di = fit.addDrone(dtid);
      droneItems.push({ item: di, qty: drone.qty ?? drone.count ?? 1, active: isActive });
    } else {
      droneItems.push({ item: null, qty: drone.qty ?? drone.count ?? 1, raw: drone, active: isActive });
    }
  }

  // ── 3. Run the engine ─────────────────────────────────────────────────────
  // Incoming damage profile (from the Resistances tab) drives any Reactive Armor Hardener set
  // to "fit pattern". Proportions [em,th,kin,exp]; engine defaults to uniform if absent.
  if (Array.isArray(opts.damageProfile)) fit._damageProfile = opts.damageProfile;
  // Pilot security status drives CONCORD/AT-frigate hull bonuses (dogma-engine section 5g).
  fit._pilotSec = opts.pilotSec ?? 0;
  // SYSTEM security (where a structure is anchored) is unrelated to pilot security: it scales
  // structure rig bonuses by 1.0 in hisec vs 1.2 in low/null/wspace. Defaults to nullsec inside
  // Fit, matching eos — pass 'hisec' to model a hisec structure.
  if (opts.systemSecurity) fit.systemSecurity = opts.systemSecurity;
  fit.calculate();

  // ── Booster side effects (user-toggled) ───────────────────────────────────
  // Each active booster may carry sideEffects: [{key, value, chance, enabled}].

  // Enabled penalties are applied to the fit, scaled by Neurotoxin Recovery
  // (-5%/lvl magnitude). They are direct mods (not stacking penalized), matching
  // how the engine treats booster effects.
  {
    const recoveryMult = 1 - 0.05 * (sk.neurotoxinRecovery ?? 0);
    for (const b of boosters) {
      if (!b?.name || b.active === false) continue;
      for (const se of (b.sideEffects ?? [])) {
        if (!se?.enabled || !se.key) continue;
        const info = BOOSTER_PENALTY_INFO[se.key];
        if (!info) continue;
        const val = (se.value ?? 0) * recoveryMult;   // e.g. -25 × 0.75 = -18.75
        if (!val) continue;
        const aid = AID[info.attr] ?? info.attr;
        if (info.kind === 'ship') {
          fit.ship.attrs.applyMod(aid, 6, val, true);
        } else {
          for (const { slot, fitItem } of modItems) {
            if (!fitItem || !isActive(slot.state)) continue;
            const gn = fitItem.groupName ?? '';
            const match =
              info.kind === 'turret'   ? TURRET_GROUPS.has(gn) :
              info.kind === 'launcher' ? gn.includes('Launcher') :
              info.kind === 'group'    ? info.groups.includes(gn) : false;
            if (match) fitItem.attrs.applyMod(aid, 6, val, true);
          }
        }
      }
    }
  }


  // ── 4. Read ship attributes ───────────────────────────────────────────────
  const s = fit.ship;

  const burstByType = collectBursts(modItems, opts.externalBursts);

  // RAH burst-ordering: an active RAH must adapt to POST-command-burst armor resonances (matches pyfa).
  // The engine runs the RAH inside calculate(), before these bursts are applied — so when an armor
  // resonance burst (buff 13) coincides with an active RAH, re-run calculate() with the burst value
  // handed to the engine's RAH handler (it applies buff 13 before adapting). We then skip our own
  // buff-13 application below to avoid double-counting (the engine already put it on ship.attrs).
  let engineAppliedArmorBurst = false;
  const armorBurstEff = burstByType.get(13);
  if (armorBurstEff) {
    const hasActiveRAH = modItems.some(({ slot, fitItem }) =>
      fitItem && isActive(slot.state) && (fitItem.effectIDs ?? []).includes(4928));
    if (hasActiveRAH) {
      fit._rahArmorBurstEff = armorBurstEff;
      fit.calculate();
      fit._rahArmorBurstEff = undefined;
      engineAppliedArmorBurst = true;
    }
  }

  // Apply ship-attribute buffs (resonances, HP, sig, agility, sensor strength, scan res, etc.)
  // BEFORE we snapshot resists/HP below. Module-targeted buffs are applied later.
  for (const [buffID, eff] of burstByType) {
    if (buffID === 13 && engineAppliedArmorBurst) continue; // already on ship.attrs from the RAH pass
    const def = WARFARE_BUFFS[buffID];
    if (!def || !def.ship || !eff) continue;
    for (const attrName of def.ship) {
      const aid = AID[attrName];
      if (aid != null) s.attrs.applyMod(aid, 6, eff, false);
    }
  }

  // Projected Remote Sensor Boosters. These have to go through the attribute pool rather than be
  // multiplied onto the finished number, because they are BONUSES and therefore compete for
  // stacking slots with the target's own signal amplifiers and Sensor Optimization burst — eos puts
  // all of them in one 'default' penalized group. A projected +72% on a Celestis that already had a
  // Signal Amplifier II (+30%) and an Information Command Burst (+46.4%) is worth ×1.53, not ×1.72;
  // multiplying afterwards gave 70.6 km against eos's 62.9. Projected DAMPS are still applied
  // post-hoc as opts.projectedDebuffs, and that stays correct: eos chains penalties separately from
  // bonuses, so a pure-penalty chain never competes with the ship's own bonuses.
  for (const b of (opts.projectedBoosts?.lock ?? [])) {
    if (b && AID.maxTargetRange != null) s.attrs.applyMod(AID.maxTargetRange, 6, b, false);
  }
  for (const b of (opts.projectedBoosts?.scan ?? [])) {
    if (b && AID.scanResolution != null) s.attrs.applyMod(AID.scanResolution, 6, b, false);
  }

  // HP — engine now applies all skill multipliers (Shield Management, Hull Upgrades, Mechanic)
  let shieldHP = s.get('shieldCapacity');
  let armorHP  = s.get('armorHP');
  let hullHP   = s.get('hp');

  // Resists — engine has fully computed these including DC, Bastion, hardeners, implants
  // App.jsx expects 0-100 percent range (calcEHP/resMult divide by 100 internally)
  const r = (res) => (1 - res) * 100;
  const effectiveResists = {
    shield: {
      em:  r(s.get('shieldEmDamageResonance')),
      th:  r(s.get('shieldThermalDamageResonance')),
      kin: r(s.get('shieldKineticDamageResonance')),
      exp: r(s.get('shieldExplosiveDamageResonance')),
    },
    armor: {
      em:  r(s.get('armorEmDamageResonance')),
      th:  r(s.get('armorThermalDamageResonance')),
      kin: r(s.get('armorKineticDamageResonance')),
      exp: r(s.get('armorExplosiveDamageResonance')),
    },
    hull: {
      em:  r(s.get('emDamageResonance')),
      th:  r(s.get('thermalDamageResonance')),
      kin: r(s.get('kineticDamageResonance')),
      exp: r(s.get('explosiveDamageResonance')),
    },
  };

  // ── 5. Navigation ─────────────────────────────────────────────────────────
  // Engine now applies Navigation/Evasive Maneuvering skill boosts
  let maxVelocity = s.get('maxVelocity');
  // Projected stasis webs reduce velocity (caller supplies the combined stacking-penalised multiplier).
  if (opts.projectedWebMult != null && opts.projectedWebMult < 1) maxVelocity *= opts.projectedWebMult;
  // Immobilising super weapons: an active one boosts maxVelocity by its speedFactor of -100, i.e.
  // to a dead stop. eos implements each as boostItemAttr('maxVelocity', speedFactor).
  //
  // ONLY the effects CCP ships EMPTY belong here. The other modules with this behaviour (cyno
  // generators 2857, jump portals 2152/3674, clone vat 2858, capital industrial core 4575) carry
  // real modifiers in our bundle, so the ENGINE already applies them — listing those too would
  // immobilise twice. Verified per-effect against the bundle rather than assumed.
  //   4489-4492  racial titan doomsdays ('Judgment', 'Oblivion', 'Aurora Ominae', 'Gjallarhorn')
  //   6201       the four Reapers
  //   6474       Gravitational Transportation Field Oscillator  (a Komodo read 360 m/s vs eos's 0)
  for (const { slot, fitItem } of modItems) {
    if (!fitItem || !isActive(slot.state)) continue;
    if (!(fitItem.effectIDs ?? []).some(e => IMMOBILISING_SUPERWEAPON_EFFECTS.has(e))) continue;
    const sf = fitItem.get('speedFactor') ?? 0;
    if (sf) maxVelocity *= Math.max(0, 1 + sf / 100);
  }
  let agility     = s.get('agility');
  let mass        = s.get('mass');
  let sigRadius   = s.get('signatureRadius');
  // Projected target painter raises signature radius (caller pre-stacks multiple painters).
  if (opts.projectedDebuffs?.sig) sigRadius *= (1 + opts.projectedDebuffs.sig / 100);

  // MWD/AB: apply manually (not yet in effects.py)
  // Command bursts: apply every active burst's MODULE-targeted buff (rep duration/cap, prop speed,
  // tackle range, weapon disruption) to modules requiring the buff's skill. The prop-speed buff
  // (Rapid Deployment, Buff 22) applies to the prop module's speedFactor via the generic skill-target
  // loop below as a stacking-penalised PostPercent — so an OVERHEATED prop mod's overload speedFactor
  // bonus (also penalised, eos effect 3181) pushes the burst to the second slot (×0.8691). Reading the
  // engine-computed speedFactor in the speed calc then gets the penalty for free; applying the burst as
  // a separate unpenalised multiply overstated speed ~2.2% on every overheated-prop command-burst fit.
  applyModuleBursts(burstByType, modItems);

  // Projected EWAR debuffs (target painter, sensor dampener, weapon disruptors). Caller pre-stacks
  // each effect, so apply as direct PostPercent mods. Ship attrs hit the hull; weapon attrs hit modules.
  const pd = opts.projectedDebuffs;
  if (pd) {
    if (pd.lockRange) s.attrs.applyMod(AID['maxTargetRange'],  6, pd.lockRange, true);
    if (pd.scanRes)   s.attrs.applyMod(AID['scanResolution'],  6, pd.scanRes, true);
    if (pd.tracking || pd.turretOptimal || pd.turretFalloff) {
      for (const { slot: s2, fitItem: m } of modItems) {
        if (!m || !isActive(s2.state)) continue;
        const rs = TYPES[m.typeID]?.rs ?? [];
        if (rs.includes('Gunnery')) {
          if (pd.tracking)      m.attrs.applyMod(AID['trackingSpeed'], 6, pd.tracking, true);
          if (pd.turretOptimal) m.attrs.applyMod(AID['maxRange'],      6, pd.turretOptimal, true);
          if (pd.turretFalloff) m.attrs.applyMod(AID['falloff'],       6, pd.turretFalloff, true);
        }
      }
    }
    // Guidance disruption (missile range + application) is applied directly in the missile range calc.
  }

  let abMwdSpeed = maxVelocity;
  for (const { slot, fitItem } of modItems) {
    if (!fitItem || !isActive(slot.state)) continue;
    const gn = fitItem.groupName;
    if (gn === 'Propulsion Module' || gn === 'Afterburner' || gn === 'Microwarpdrive') {
      // Engine already applies Acceleration Control (+25%/5lv) and Zor's implant (+5%)
      // to speedFactor via LocationGroupModifier Effect 1176 (groupID=46).
      const speedFactor_    = fitItem.get('speedFactor') ?? 0;
      const speedBoostFact_ = fitItem.get('speedBoostFactor') ?? 0;
      if (speedFactor_ && speedBoostFact_) {
        // s.get('mass') already includes the prop's massAddition (the engine adds it as a modAdd
        // BEFORE the hull's mass multipliers, so a Higgs Anchor's +100% correctly applies to it).
        const totalMass = s.get('mass') ?? mass;
        // speedFactor_ already carries any active Rapid Deployment burst (Buff 22), stacking-penalised
        // by the engine against an overheated prop mod's overload speedFactor bonus.
        // Pyfa formula: boostItemAttr('maxVelocity', speedFactor * thrust / mass)
        // → maxVelocity *= (1 + speedFactor * thrust / mass / 100)
        abMwdSpeed = maxVelocity * (1 + speedFactor_ * speedBoostFact_ / totalMass / 100);
      }
    }
  }

  // NOTE: shield extender signatureRadiusAdd is applied by the ENGINE (in the post-skill pass,
  // before the MWD sig bloom), so the engine's signatureRadius already includes it correctly,
  // e.g. (70 + 7) × 5.1 = 392.7. Do NOT re-add it here — that double-counts the extender.

  // ── 6. Engineering (CPU / PG) ─────────────────────────────────────────────
  // Engine applies CPU/PG skill boosts (CPU Management, Power Grid Management)
  const cpuTotal = s.get('cpuOutput');
  const pgTotal  = s.get('powerOutput');

  // Engine applies Weapon Upgrades CPU reduction and AWU PG reduction via Effect581/1638
  let cpuUsed = 0, pgUsed = 0, calUsed = 0;
  for (const { slot, fitItem } of modItems) {
    if (!fitItem || !isOnline(slot.state)) continue;
    cpuUsed += (fitItem.get('cpu')         ?? 0);
    pgUsed  += (fitItem.get('power')       ?? 0);
    calUsed += (fitItem.get('upgradeCost') ?? 0);
  }

  // ── 7. Capacitor ──────────────────────────────────────────────────────────
  // Engine applies Energy Management/Systems Op skill boosts
  const capCapacity   = s.get('capacitorCapacity');
  const capRechargeMs = s.get('rechargeRate');

  let capDrainPS = 0, capFillPS = 0;
  const capModules = [];

  // Helpers shared by all clip-fed modules (cap boosters, AAR/ASB).
  // chargeVolOf: resolve loaded charge volume in m³ from slot.ammo (strips "(N)" count suffix).
  const chargeVolOf = (ammo, dfltVol) => {
    const nm  = (ammo || '').replace(/\s*\(\d+\)$/, '');
    const tid = nm ? (typeIDByName(nm) ?? tidByName(nm)) : null;
    return tid && TYPES[tid] ? (TYPES[tid].attrs?.['161'] ?? TYPES[tid].attrs?.volume ?? dfltVol) : dfltVol;
  };
  // clipSizeOf: floor(bay / (chargeVol × chargeRate)), clamped to min.
  // chargeRate uses || (not ??): the attr has no name in dogma-attrs.json so getBase
  // resolves to 0 — dfltRate must win over that. Cap boosters consume 1 charge/cycle.
  const clipSizeOf = (fitItem, ammo, { dfltVol, dfltRate = 1, min = 0 } = {}) => {
    const bay  = fitItem.getBase('capacity')   ?? 0;
    const rate = fitItem.getBase('chargeRate') || dfltRate;
    const vol  = chargeVolOf(ammo, dfltVol);
    const n = bay > 0 && vol > 0 && rate > 0 ? Math.floor(bay / (vol * rate)) : 0;
    return Math.max(min, n);
  };

  for (const { slot, fitItem } of modItems) {
    if (!fitItem || !isActive(slot.state)) continue;
    const cn = fitItem.get('capacitorNeed') ?? 0;
    // NOTE: Controlled Bursts (Effect 287, skill filter = Gunnery) does NOT apply to T2 turrets:
    // Gunnery is not in their direct required-skills list, and the dogma filter checks direct
    // requirements only. Verified against Pyfa: its cap drain matches ours without CB applied.
    // CRITICAL: use || not ?? — turrets return duration=0 (attr default), and 0 ?? x = 0 (nullish
    // coalescing won't fall through to 'speed'). With ||, 0 falls through to fitItem.get('speed').
    const ct = fitItem.get('duration') || fitItem.get('speed') || 0;
    const isInjector = fitItem.groupName === 'Capacitor Booster';
    if (!ct || (cn === 0 && !isInjector)) continue;
    // Cap boosters: get the charge's capacitorBonus from the ENGINE-COMPUTED charge, not the raw type
    // data — hull bonuses can modify it (e.g. the Minokawa's +20%/level Force Auxiliary C5 bonus
    // doubles a Navy Cap Booster 3200 to 6400 at level 5). Reading TYPES[] here ignored those bonuses.
    const injAmt = (() => {
      if (!isInjector || !slot.ammo) return 0;
      const live = fitItem._charge?.get?.('capacitorBonus');
      if (live != null && live > 0) return live;
      const _s=slot.ammo; const cTid = _s?(typeIDByName(_s)??tidByName(_s)??typeIDByName(_s.replace(/\s*\(\d+\)$/,''))??tidByName(_s.replace(/\s*\(\d+\)$/,''))):null;
      const cAttrs = cTid ? TYPES[cTid]?.attrs : null;
      return cAttrs?.['67'] ?? cAttrs?.capacitorBonus ?? cAttrs?.capacity ?? 0;
    })();
    // Ancillary Shield Boosters loaded with Cap Booster charges run off the charges, NOT ship cap.
    const isAncillaryShieldBooster = fitItem.groupName === 'Ancillary Shield Booster';
    const loadedCapCharge = (() => {
      if (!isAncillaryShieldBooster || !slot.ammo) return false;
      const _s = slot.ammo.replace(/\s*\(\d+\)$/, '');
      const cTid = typeIDByName(_s) ?? tidByName(_s);
      const g = cTid ? (TYPES[cTid]?.g ?? TYPES[cTid]?.groupID) : null;
      return g === 87; // Capacitor Booster Charge group
    })();
    if (isInjector) {
      // Account for reload: effective rate = (clipSize × injAmt) / (clipSize × cycleMs + reloadMs)
      const reloadMs2 = fitItem.getBase('reloadTime') ?? 10000;
      const clipSz    = clipSizeOf(fitItem, slot.ammo, { dfltVol: 96, min: 1 });
      capFillPS += (clipSz * injAmt) / (clipSz * ct + reloadMs2) * 1000;
    } else if (cn > 0 && !loadedCapCharge) {
      // Drain uses raw cycle for ALL non-injector modules, including AAR/ASB. Pyfa's capacitor
      // model treats ancillary reps as continuously cycling (no reload gap): its displayed cap
      // delta and "Lasts" time both reverse-calculate to unaveraged AAR drain. Match that.
      capDrainPS += cn / (ct / 1000);
    }
    capModules.push({
      cycleMs: Math.max(1, ct),
      capNeedGJ: isInjector ? -injAmt : (loadedCapCharge ? 0 : cn),
      // Cap booster: clip = floor(bay / chargeVol), min 1 — pyfa models injector reloads.
      // AAR/ASB: clip 0 = continuous cycling, matching pyfa's cap simulation.
      clipSize: isInjector ? clipSizeOf(fitItem, slot.ammo, { dfltVol: 96, min: 1 }) : 0,
      reloadMs: isInjector ? 10000 : 0,
      isInjector,
    });
  }
  // Projected energy neutralizers: continuous external cap drain (affects cap delta and stability).
  if (opts.projectedNeutGJs > 0) {
    capDrainPS += opts.projectedNeutGJs;
    capModules.push({ cycleMs: 250, capNeedGJ: opts.projectedNeutGJs * 0.25, clipSize: 0, reloadMs: 0, isInjector: false });
  }
  // Projected remote capacitor transmitters: the mirror image — continuous external cap FILL. A
  // negative capNeedGJ is how the simulator already models an injector, so incoming transfer rides
  // the same path and lands in cap delta and stability without a second mechanism.
  if (opts.projectedCapGJs > 0) {
    capFillPS += opts.projectedCapGJs;
    capModules.push({ cycleMs: 250, capNeedGJ: -opts.projectedCapGJs * 0.25, clipSize: 0, reloadMs: 0, isInjector: false });
  }
  const capSim = simulateCap(capModules, capCapacity, capRechargeMs);

  // Cap booster injectors, exposed for the capacitor graph's discrete injection (sawtooth) sim.
  // capFillPS already folds in their AVERAGED contribution; capInjectorFillPS lets the graph
  // subtract that average and instead apply real periodic injections (with clip + reload gaps).
  const capInjectors = capModules
    .filter(m => m.isInjector && m.capNeedGJ < 0)
    .map(m => ({ amount: -m.capNeedGJ, cycleS: Math.max(0.05, m.cycleMs / 1000),
                 clipSize: Math.max(1, m.clipSize || 1), reloadS: (m.reloadMs || 10000) / 1000 }));
  const capInjectorFillPS = capInjectors.reduce(
    (s, i) => s + (i.clipSize * i.amount) / (i.clipSize * i.cycleS + i.reloadS), 0);

  // ── 8. Weapons — all skill bonuses now applied by engine ──────────────────

  let weaponDps    = { em:0, th:0, kin:0, exp:0, total:0 };
  let weaponVolley = { em:0, th:0, kin:0, exp:0, total:0 };
  const slotEngineStats = new Map();  // slot → { optimal, falloff, tracking, cycleMs, dmgMult }
  const graphWeapons = [];  // per-weapon hit-math data for the damage graph

  // Tracking for graph tab — read from engine now (skills applied there)
  // These are approximations for the graph overlay; engine values are the ground truth
  let optMultOut  = 1 + 0.05 * (sk.sharpshooter        ?? 0);
  let trkMultOut  = 1 + 0.05 * (sk.motionPrediction     ?? 0);
  let fallMultOut = 1 + 0.04 * (sk.trajectoryAnalysis   ?? 0);
  let effectiveDmgMultBonus = 0;
  let weaponSpoolFactor = 1;    // max-spool damage multiplier vs unspooled (1 = no spool weapon)
  let weaponSpoolTimeS  = 0;    // seconds to reach full spool (entropic disintegrators)
  let _spoolCycles      = 0;    // ceil(max/step); turned into a time once cycleMs is final
  // Only the spooling weapon's OWN damage ramps — smartbombs/other guns on the same hull do not.
  // Track the spooling contribution separately so weapon*Max spools only this portion, not the total.
  let spoolBaseVolley   = 0;
  let spoolBaseDps      = 0;
  // Per-damage-type versions of the same, needed to resist-weight the max-spool figure: the scalar
  // totals above cannot be split back into em/th/kin/exp once summed.
  const spoolBaseDpsT    = { em:0, th:0, kin:0, exp:0 };
  const spoolBaseVolleyT = { em:0, th:0, kin:0, exp:0 };

  for (const { slot, fitItem } of modItems) {
    if (!fitItem || !isActive(slot.state)) continue;
    const gn = fitItem.groupName;

    // 'Structure Doomsday Weapon' / 'Structure Area Denial Module' are the structure-side names for
    // exactly this shape — intrinsic damage on a fixed cycle. They were missing, so an Arcing Vorton
    // Projector read 0 DPS against eos's 7407.4 and a Point Defense Battery 0 against 83.3.
    // Same failure mode as the structure missile launchers: this branch keys on ship-side group
    // names, and CCP's structure groups are named differently. Found by the structure oracle sweep.
    if (gn === 'Smart Bomb' || gn === 'Super Weapon' ||
        gn === 'Structure Doomsday Weapon' || gn === 'Structure Area Denial Module') {
      // Smartbombs (AoE) and doomsday super weapons deal intrinsic damage each cycle (no charge). The
      // engine applies duration reductions (Energy Pulse Weapons / titan RoF) and any damage bonuses.
      //
      // Beam-type super weapons (Lancer lances, titan Reapers, the Bosonic Field Generator) don't land
      // their damage once: they tick every doomsdayDamageCycleTime for doomsdayDamageDuration, so the
      // em/th/kin/exp attrs are damage PER TICK. Total damage per activation = perTick × ticks, spread
      // across the module's `duration`. Single-hit weapons (titan doomsdays, every smartbomb) have no
      // tick attrs → ticks = 1, so their maths is unchanged.
      // Volley stays at one tick's damage, which is what pyfa reports.
      // e.g. 'Azmaru' lance: 25,500/tick × 15 ticks ÷ 300 s = 1,275 DPS (was 85 with ticks assumed 1).
      const durS = (fitItem.get('duration') ?? 0) / 1000;
      if (durS > 0) {
        const beamDurMs   = fitItem.get('doomsdayDamageDuration')  ?? 0;
        const beamCycleMs = fitItem.get('doomsdayDamageCycleTime') ?? 0;
        const ticks = (beamDurMs > 0 && beamCycleMs > 0)
          ? Math.max(1, Math.floor(beamDurMs / beamCycleMs))
          : 1;
        // Most weapons in this branch carry their damage on the MODULE. The Point Defense Battery
        // doesn't: it takes a charge and carries only a damageMultiplier, so read the charge and
        // scale. Read the ENGINE-computed charge, not raw type data, or hull/skill bonuses to the
        // charge are lost (CLAUDE.md gotcha #5).
        const _self = ['emDamage','thermalDamage','kineticDamage','explosiveDamage']
          .map(a => fitItem.get(a) || 0);
        const _useCharge = _self.every(v => v === 0) && fitItem._charge;
        const _mult = _useCharge ? (fitItem.get('damageMultiplier') ?? 1) : 1;
        const _src = _useCharge
          ? ['emDamage','thermalDamage','kineticDamage','explosiveDamage']
              .map(a => (fitItem._charge.get(a) || 0) * _mult)
          : _self;
        const [dEm, dTh, dKin, dExp] = _src;
        weaponDps.em  += dEm*ticks/durS;  weaponVolley.em  += dEm;
        weaponDps.th  += dTh*ticks/durS;  weaponVolley.th  += dTh;
        weaponDps.kin += dKin*ticks/durS; weaponVolley.kin += dKin;
        weaponDps.exp += dExp*ticks/durS; weaponVolley.exp += dExp;
        weaponDps.total    += (dEm+dTh+dKin+dExp)*ticks/durS;
        weaponVolley.total += dEm+dTh+dKin+dExp;
      }

    } else if (isTurret(gn)) {
      // Engine applies ALL: ship hull bonuses, gyrostabs, Bastion ROF, gunnery skills,
      // parent turret skill damage, surgical strike, spec skills.
      const totalDmgMult = fitItem.get('damageMultiplier');

      // Entropic disintegrators (Precursor Weapons) spool up: damage ramps from base to
      // base × (1 + damageMultiplierBonusMax) over ceil(max/perCycle) cycles. Capture the spool
      // factor and spool-up time so the firepower display can show a min–max range.
      const spoolMax = fitItem.get('damageMultiplierBonusMax') ?? 0;
      const spoolPerCycle = fitItem.get('damageMultiplierBonusPerCycle') ?? 0;
      if (spoolMax > 0 && spoolPerCycle > 0) {
        weaponSpoolFactor = Math.max(weaponSpoolFactor, 1 + spoolMax);
        const spoolCycles = spoolCyclesToMax(spoolMax, spoolPerCycle);
        // NOTE: the spool TIME is deliberately not computed here. `fitItem.get('speed')` at this
        // point is the pre-charge cycle time, and charge modifiers are applied to `cycleMs` further
        // down — using the raw value put a Vedmak's spool-up at 122.8s against a true 122.76s.
        // Spool advances once per REAL cycle, so the time is computed where cycleMs is final.
        _spoolCycles = Math.max(_spoolCycles, spoolCycles);
      }

      effectiveDmgMultBonus = Math.max(effectiveDmgMultBonus, totalDmgMult);

      // Cycle time — engine applied Bastion ROF, gyrostab ROF, gunnery skill ROF, rapid firing
      let cycleMs = fitItem.get('speed');

      // Apply charge modifiers to turret attributes (Effects 596/599/600):
      // ammo modifies: maxRange, falloff, trackingSpeed
      const _ammo=(slot.ammo||'').replace(/\s*\(\d+\)$/,''); const chargeTid = _ammo ? (typeIDByName(_ammo) ?? tidByName(_ammo)) : null;
      // chargeAttrs: TYPES stores numeric keys — map to named properties for turret math
      const _cRaw = chargeTid && TYPES[chargeTid] ? TYPES[chargeTid].attrs : null;
      const chargeAttrs = _cRaw ? {
        weaponRangeMultiplier:    _cRaw['120']  ?? _cRaw.weaponRangeMultiplier    ?? 1,
        fallofMultiplier:         _cRaw['517']  ?? _cRaw.fallofMultiplier         ?? 1,
        trackingSpeedMultiplier:  _cRaw['244']  ?? _cRaw.trackingSpeedMultiplier  ?? 1,
      } : null;
      // Charge range/falloff/tracking multipliers are now applied by the engine (charge forwarding),
      // so read the engine-resolved values directly rather than re-multiplying here.
      const turretOpt  = fitItem.get('maxRange');
      const turretFall = fitItem.get('falloff');
      const turretTrk  = fitItem.get('trackingSpeed');

      const charge = chargeProfile(slot.ammo);
      if (charge && charge.total > 0) {
        // numShots (shots per clip before reload) isn't a stored attr — derive it from the module's
        // charge bay ÷ charge volume, same as any clip. reloadTime is engine-computed, so ship reload
        // bonuses (Jackdaw/Skua tactical destroyers, Angel Cartel projectile hulls, etc.) are baked in.
        const numShots = clipSizeOf(fitItem, slot.ammo, { dfltVol: 0.0125, min: 1 });
        let reloadMs = 0;
        if (factorInReload && numShots > 0) {
          reloadMs = (fitItem.get('reloadTime') ?? 5000);
        }
        const effCycleMs = numShots > 0
          ? (numShots * cycleMs + reloadMs) / numShots
          : cycleMs;

        const dps = (type) => charge[type] * totalDmgMult / (effCycleMs / 1000);
        const vol = (type) => charge[type] * totalDmgMult;
        weaponDps.em   += dps('em');   weaponVolley.em   += vol('em');
        weaponDps.th   += dps('th');   weaponVolley.th   += vol('th');
        weaponDps.kin  += dps('kin');  weaponVolley.kin  += vol('kin');
        weaponDps.exp  += dps('exp');  weaponVolley.exp  += vol('exp');
        const slotDpsTotal = dps('em')+dps('th')+dps('kin')+dps('exp');
        const slotVolTotal = vol('em')+vol('th')+vol('kin')+vol('exp');
        weaponDps.total  += slotDpsTotal;
        weaponVolley.total += slotVolTotal;
        // Record this weapon's contribution to the spool base only if it actually spools, so the
        // max-spool display ramps this weapon alone and leaves co-fitted non-spool guns at base.
        if (spoolMax > 0 && spoolPerCycle > 0) {
          spoolBaseDps += slotDpsTotal; spoolBaseVolley += slotVolTotal;
          for (const t of ['em','th','kin','exp']) { spoolBaseDpsT[t] += dps(t); spoolBaseVolleyT[t] += vol(t); }
        }
      }
      // Store ammo-adjusted range stats for display
      slotEngineStats.set(slot, {
        optimal:      Math.round(turretOpt  / 1000 * 10) / 10,
        falloff:      Math.round(turretFall / 1000 * 10) / 10,
        tracking:     Math.round(turretTrk * 1000) / 1000,
        cycleMs:      Math.round(cycleMs),
        dmgMult:      totalDmgMult,
      });

      // Per-weapon graph data (turret hit math). Base volley = full damage per cycle, no hit mult.
      const _charge = chargeProfile(slot.ammo);
      if (_charge && _charge.total > 0) {
        // cycleMs is final here (charge modifiers applied), so this is the cycle the weapon
        // actually fires at — the one spool advances on.
        if (_spoolCycles > 0) weaponSpoolTimeS = Math.max(weaponSpoolTimeS, _spoolCycles * (cycleMs / 1000));
        graphWeapons.push({
          kind: 'turret',
          volley: { em:_charge.em*totalDmgMult, th:_charge.th*totalDmgMult,
                    kin:_charge.kin*totalDmgMult, exp:_charge.exp*totalDmgMult },
          cycleS: cycleMs / 1000,
          optimal: turretOpt, falloff: turretFall, tracking: turretTrk,
          optimalSigRadius: fitItem.get('optimalSigRadius') ?? 40000,
          spoolMax: fitItem.get('damageMultiplierBonusMax') ?? 0,
          spoolPerCycle: fitItem.get('damageMultiplierBonusPerCycle') ?? 0,
          numShots: clipSizeOf(fitItem, slot.ammo, { dfltVol: 0.0125, min: 1 }),
          reloadS: (fitItem.get('reloadTime') ?? 0) / 1000,
        });
      }

    } else if (isLauncher(gn, fitItem.effectIDs)) {
      // Engine applied: MLO skill ROF, ship hull bonuses, Bastion ROF.
      // IMPORTANT: missiles scale charge damage by missileDamageMultiplier (attr 212) —
      // this is the attr that BCS (Effect763), missile damage skills, and ship damage
      // bonuses all modify. damageMultiplier (attr 64) is for turrets and stays ~1 here.
      const engineDmgMult = fitItem.get('missileDamageMultiplier') ?? fitItem.get('damageMultiplier') ?? 1;
      let cycleMs = fitItem.get('speed') ?? fitItem.get('duration') ?? 0;
      if (!cycleMs) continue;
      // Missile specialization RoF (Effect 1851 selfRof): -2%/lvl to launcher cycle for the
      // specialization skill the launcher requires (e.g. T2 LML → Light Missile Specialization).
      // eos-handled (no dogma modifier data), so apply analytically like the damage bonuses.
      {
        const MISSILE_SPECS = {
          'Light Missile Specialization':'lightMissileSpec', 'Rocket Specialization':'rocketSpec',
          'Heavy Missile Specialization':'heavyMissileSpec', 'Heavy Assault Missile Specialization':'heavyAssaultMissileSpec',
          'Cruise Missile Specialization':'cruiseMissileSpec', 'Torpedo Specialization':'torpedoSpec',
          // XL Cruise (eff 6577) and XL Torpedo (eff 6578) specializations ARE engine-applied
          // (LocationRequiredSkillModifier on RoF), unlike the inert sub-cap specs — so they are
          // deliberately omitted here to avoid double-counting the cycle bonus.
        };
        const lrs = TYPES[fitItem.typeID]?.rs ?? [];
        for (const [skillName, camel] of Object.entries(MISSILE_SPECS)) {
          if (lrs.includes(skillName)) { cycleMs *= 1 - 0.02 * (sk[camel] ?? 0); break; }
        }
      }

      const charge = chargeProfile(slot.ammo);
      if (charge && charge.total > 0) {
        // ── Missile damage multiplier chain (engine leaves missileDamageMultiplier=1 because
        //    the contributing effects are charID-domain / eos-handled, not dogma modifiers).
        //    Pyfa model: charge base damage × (1 + charge-skill bonuses) × launcher mult chain. ──
        const chName = (slot.ammo || '').replace(/\s*\(\d+\)$/, '');
        const chTid  = chName ? (typeIDByName(chName) ?? tidByName(chName)) : null;
        const chRs   = chTid ? (TYPES[chTid]?.rs ?? []) : [];
        // (a) Charge damage skills: +5%/lvl per missile-size skill the charge requires
        //     (Light Missiles, Rockets, Heavy Missiles, Cruise Missiles, Torpedoes, HAMs, XL).
        // Each missile-size damage skill is a SEPARATE multiplier in eos (two +25% skills → ×1.5625,
        // not ×1.5). Matters only when a charge requires two damage skills (Auto-Targeting missiles
        // require both Heavy Missiles AND Auto-Targeting Missiles); single-skill charges are unchanged.
        let chargeSkillMult = 1;
        const MISSILE_DMG_SKILLS = {
          'Light Missiles':'lightMissiles', 'Rockets':'rockets', 'Heavy Missiles':'heavyMissiles',
          'Cruise Missiles':'cruiseMissiles', 'Torpedoes':'torpedoes', 'Auto-Targeting Missiles':'autoTargetingMissiles',
          'Heavy Assault Missiles':'heavyAssaultMissiles', 'XL Cruise Missiles':'xlCruiseMissiles', 'XL Torpedoes':'xlTorpedoes',
        };
        for (const [skillName, camel] of Object.entries(MISSILE_DMG_SKILLS)) {
          if (chRs.includes(skillName)) chargeSkillMult *= 1 + 0.05 * (sk[camel] ?? 0);
        }
        // (b) Warhead Upgrades: +2%/lvl to missile damage. eos gates this on the charge requiring
        //     "Missile Launcher Operation" (effects 1595/1596/1597/1657), so Defender Missiles — which
        //     require only "Defender Missiles" — get NO warhead bonus.
        const warheadBonus = chRs.includes('Missile Launcher Operation') ? 0.02 * (sk.warheadUpgrades ?? 0) : 0;
        // (c) BCS (Ballistic Control System): missileDamageMultiplierBonus, stacking-penalized.
        //     Read the module's RESOLVED value (fi2.get) so mutated/abyssal BCS are honored,
        //     falling back to raw type data.
        const bcsFactors = [];
        for (const { slot: s2, fitItem: fi2 } of modItems) {
          if (!fi2 || !isOnline(s2.state)) continue;
          // STRUCTURE weapon upgrades (category 66) are already applied by the ENGINE: the Standup
          // BCS's effect 6449 is a real dogma modifier (ship hiddenMissileDamageMultiplier -> charge
          // damage), unlike the ship BCS whose effect is eos-handled and leaves the engine at 1.
          // `engineChargeMult` below picks the engine's contribution up from the charge, so counting
          // these analytically too squares the bonus — a Fortizar with 2 Standup BCS read 1.1956²
          // instead of 1.1956 (weapon DPS 1933.3 against eos's 1617.0). Found by diffing a real
          // saved structure fit; the one-module-per-fit sweep cannot catch it, because a BCS alone
          // has no weapon to boost.
          if ((TYPES[fi2.typeID]?.c ?? TYPES[fi2.typeID]?.category) === 66) continue;
          const b = fi2.get?.('missileDamageMultiplierBonus') ?? TYPES[fi2.typeID]?.attrs?.missileDamageMultiplierBonus;
          if (b && b !== 1) bcsFactors.push(b);
        }
        const bcsMult = stackingPenalty
          ? bcsFactors.sort((a,b)=>b-a).reduce((f,v,i)=>f*(1+(v-1)*Math.exp(-(i*i)/7.1289)),1)
          : bcsFactors.reduce((f,v)=>f*v,1);
        // (d) Ship-hull missile damage bonuses — table-driven, per damage type, for ALL hulls
        //     (e.g. ONI shipBonusCC +100% EM/Th/Exp and shipBonusCC3 +125% kinetic, Caracal/Cerb
        //     /Orthrus/Jackdaw, etc.). fit.ship.get(attr) is already class-skill-prescaled. Applied
        //     per type below so mixed-type missiles stay correct.
        const shipMd = { em: 1, th: 1, kin: 1, exp: 1 };
        {
          const shipEffs = TYPES[fit.ship.typeID]?.e ?? TYPES[fit.ship.typeID]?.effectIDs ?? [];
          for (const eid of shipEffs) {
            const spec = SHIP_MISSILE_DMG[eid];
            if (!spec) continue;
            const _sk = Array.isArray(spec[2]) ? spec[2] : [spec[2]];
            if (!_sk.some(i => chRs.includes(SHIP_MD_SK[i]))) continue;
            const bonus = fit.ship.get(spec[0]) ?? 0;
            if (bonus) {
              const f = 1 + bonus / 100;
              const tys = spec[1] === 'all' ? ['em','th','kin','exp'] : (Array.isArray(spec[1]) ? spec[1] : [spec[1]]);
              for (const ty of tys) shipMd[ty] *= f;
            }
          }
          // Sidewinder & kin (Effect12165, ATFrigDmgBonus): the rocket/light-missile CHARGE-damage
          // half of the pilot-security bonus. Engine handles the small-turret half; charges are out
          // of its reach. sec clamped [-10,0]; bonus = ship ATFrigDmgBonus × sec (neg×neg → positive).
          if (shipEffs.includes(12165) && (chRs.includes('Rockets') || chRs.includes('Light Missiles'))) {
            const negSec = Math.max(-10, Math.min(0, fit._pilotSec ?? 0));
            const b = (fit.ship.get('ATFrigDmgBonus') ?? 0) * negSec;
            if (b) { const f = 1 + b / 100; shipMd.em *= f; shipMd.th *= f; shipMd.kin *= f; shipMd.exp *= f; }
          }
          // T3C offensive subsystems carry a missile charge-damage bonus the engine can't apply
          // (OwnerRequiredSkillModifier → charge). Read the raw per-level bonus off the fitted
          // subsystem and scale by its subsystem skill (assumed V → ×5).
          for (const si of (fit._subsystems || [])) {
            if (!si) continue;
            const seffs = TYPES[si.typeID]?.e ?? [];
            for (const eid of seffs) {
              const sp = SUBSYS_MISSILE_DMG[eid];
              if (!sp) continue;
              if (!sp[2].some(sk => chRs.includes(sk))) continue;
              const bonus = si.get(sp[0]) ?? 0;
              if (bonus) {
                if (sp[1] === 'all') { const f = 1 + bonus / 100; shipMd.em *= f; shipMd.th *= f; shipMd.kin *= f; shipMd.exp *= f; }
                else shipMd[sp[1]] *= 1 + bonus / 100;
              }
            }
          }
        }
        // (e) Combat booster missile damage bonus (e.g. Agency 'Pyrolancea' +7%): charID-domain
        //     OwnerRequiredSkillModifier on Missile Launcher Operation (skill 3319) the engine skips.
        let boosterDmgMult = 1;
        if (chRs.includes('Missile Launcher Operation')) {
          for (const b of boosters) {
            if (!b?.name || b.active === false) continue;
            const bTid = typeIDByName(b.name) ?? tidByName(b.name);
            const bA = bTid ? TYPES[bTid]?.attrs : null;
            // damageMultiplierBonus present + booster has missile-damage effects (1595..1657)
            const dmgB = bA?.damageMultiplierBonus;
            const eff = bTid ? (TYPES[bTid]?.effectIDs ?? TYPES[bTid]?.e ?? []) : [];
            if (dmgB && eff.includes(1595)) boosterDmgMult *= 1 + dmgB / 100;
            // Seasonal "Hardpoint" boosters (State/Imperial/Republic/Federation) use a DIFFERENT attr
            // and effect: boosterMissileDamageBonusPostPercent (6125) via effect 12849, which CCP ships
            // with an empty modifier list. Without this a Praxis running a State Hardpoint Booster III
            // lost its +6% missile damage (87.6 vs pyfa's 92.5 missile DPS).
            const misB = bA?.boosterMissileDamageBonusPostPercent;
            if (misB && eff.includes(12849)) boosterDmgMult *= 1 + misB / 100;
          }
        }
        // (f) Engine-resolved charge-damage bonuses (ship/subsystem effects that target the charge
        //     directly, e.g. Legion Offensive +25% missile damage). The engine applies these to the
        //     loaded _charge item; capture them as a ratio vs the charge's base damage so they
        //     compose with the skill-based manual chain without double-counting skills (which the
        //     engine doesn't apply to charges).
        let engineChargeMult = 1;
        if (fitItem._charge && chTid) {
          const baseA = TYPES[chTid]?.attrs ?? {};
          const baseTot = (baseA.emDamage??0)+(baseA.thermalDamage??0)+(baseA.kineticDamage??0)+(baseA.explosiveDamage??0);
          if (baseTot > 0) {
            const engTot = (fitItem._charge.get('emDamage')??0)+(fitItem._charge.get('thermalDamage')??0)
                         + (fitItem._charge.get('kineticDamage')??0)+(fitItem._charge.get('explosiveDamage')??0);
            if (engTot > 0) engineChargeMult = engTot / baseTot;
          }
        }
        // (g) Missile-damage hardwiring implants (e.g. Zainou 'Snapshot' HM-705, +5% heavy missile
        //     damage). Each carries an OwnerRequiredSkillModifier on the charge's em/th/kin/exp damage
        //     (attrs 114/116/117/118), filtered by a missile-type skill the charge requires — so, like
        //     the BCS/warhead terms, the engine can't reach the charge and we apply it analytically.
        //     All four damage-type effects carry the same damageMultiplierBonus, so apply ONCE per
        //     implant (op6, its own stacking group; at most one such implant fits per missile type).
        let implantDmgMult = 1;
        const DMG_ATTRS = new Set([114, 116, 117, 118]);
        for (const imp of implants) {
          if (!imp?.name) continue;
          const iTid = typeIDByName(imp.name) ?? tidByName(imp.name) ?? imp.typeID;
          const iT = iTid ? TYPES[iTid] : null;
          if (!iT) continue;
          const iEffs = iT.e ?? iT.effectIDs ?? [];
          let impBonus = 0;
          outer: for (const eid of iEffs) {
            const mods = EFFECTS_DATA[eid]?.m;
            if (!mods) continue;
            for (const m of mods) {
              if (m.func !== 'OwnerRequiredSkillModifier' || !DMG_ATTRS.has(m.modifiedAttributeID)) continue;
              const skName = m.skillTypeID != null ? TYPES[m.skillTypeID]?.n : null;
              if (!skName || !chRs.includes(skName)) continue;
              const attrName = ATTR_META[m.modifyingAttributeID]?.n;
              impBonus = attrName ? (iT.attrs?.[attrName] ?? 0) : 0;
              if (impBonus) break outer;
            }
          }
          if (impBonus) implantDmgMult *= 1 + impBonus / 100;
        }
        const skillDmgMult = chargeSkillMult * (1 + warheadBonus) * bcsMult * boosterDmgMult * engineChargeMult * implantDmgMult;
        // T3D Sharpshooter mode charge-damage bonus is now applied by the engine to the loaded
        // charge (captured in engineChargeMult below), so no separate manual factor is needed.
        const modeDmgFactor = 1;
        // engineDmgMult: launcher's damageMultiplier after all bonuses
        // __chargeDmg* attrs: boosts to charge damage from skills/ship bonuses (filteredChargeBoost)
        //   These are accumulations on the launcher item from skill/hull effect translation
        const chBoostKin = fitItem.get('__chargeDmgKin') ?? 0;
        const chBoostTh  = fitItem.get('__chargeDmgTh')  ?? 0;
        const chBoostEm  = fitItem.get('__chargeDmgEm')  ?? 0;
        const chBoostExp = fitItem.get('__chargeDmgExp') ?? 0;
        // Apply charge damage boosts additively (they were boosted as % via filteredItemBoost)
        // filteredItemBoost on a __charge attr: item.attrs.boost(attr, val) → multiply by (1+val/100)
        const chEm  = charge.em  * (1 + chBoostEm  / 100) * shipMd.em;
        const chTh  = charge.th  * (1 + chBoostTh  / 100) * shipMd.th;
        const chKin = charge.kin * (1 + chBoostKin / 100) * shipMd.kin;
        const chExp = charge.exp * (1 + chBoostExp / 100) * shipMd.exp;
        const totalChargeHp = chEm + chTh + chKin + chExp;
        const totalDmg = totalChargeHp * engineDmgMult * skillDmgMult * modeDmgFactor;
        // Missile launchers don't expose numShots; the clip is launcher cargo capacity ÷ charge
        // volume (e.g. RLML 0.3 m³ / 0.015 = 20). This drives the reload penalty — small for normal
        // launchers (large clips), large for Rapid launchers (small clip + ~35 s reload).
        const _lCap = fitItem.get('capacity') ?? TYPES[fitItem.typeID]?.attrs?.capacity ?? 0;
        const _chVol = chTid ? (TYPES[chTid]?.attrs?.volume ?? 0) : 0;
        const numShots = (_lCap > 0 && _chVol > 0) ? Math.floor(_lCap / _chVol) : (fitItem.get('numShots') ?? 0);
        let reloadMs = 0;
        if (factorInReload && numShots > 0) reloadMs = fitItem.get('reloadTime') ?? 10000;
        const effCycleMs = numShots > 0 ? (numShots * cycleMs + reloadMs) / numShots : cycleMs;
        const dps = totalDmg / (effCycleMs / 1000);
        const vol = totalDmg;
        const safeTot = totalChargeHp || 1;
        weaponDps.em   += dps*(chEm /safeTot); weaponVolley.em   += vol*(chEm /safeTot);
        weaponDps.th   += dps*(chTh /safeTot); weaponVolley.th   += vol*(chTh /safeTot);
        weaponDps.kin  += dps*(chKin/safeTot); weaponVolley.kin  += vol*(chKin/safeTot);
        weaponDps.exp  += dps*(chExp/safeTot); weaponVolley.exp  += vol*(chExp/safeTot);
        weaponDps.total  += dps;
        weaponVolley.total += vol;

        // ── Missile range + explosion stats (pyfa-exact, verified vs Affected-By panel) ──
        // range = velocity × flightTime. Modifier model:
        //   • Skills (Projection +10%/lvl vel, Bombardment +10%/lvl flight): UNPENALIZED
        //   • Sharpshooter mode velocity (modeMaxRangePostDiv): UNPENALIZED
        //   • Implants (Toxot +8% flight via maxFlightTimeBonus): UNPENALIZED
        //   • MGC modules + rigs: share ONE stacking-penalized pool per attribute (vel pool, flight pool)
        //   • MGC bonus is DOUBLED by the Range Script (missileVelocityBonus/explosionDelayBonus 5.5 → 11),
        //     and zeroed/negated by the Precision Script.
        // Verified: 2×MGC(range script) + 2×Hydraulic → vel 14474 (pyfa 14471);
        //           2×MGC(range script) + Rocket Fuel → flight 8135ms (pyfa 8130).
        const chTidR = chTid;
        const chA = chTidR ? (TYPES[chTidR]?.attrs ?? {}) : {};
        const baseVel    = chA.maxVelocity ?? 0;
        const baseFlight = chA.explosionDelay ?? 0;     // ms
        const baseAoeVel = chA.aoeVelocity ?? 0;
        const baseAoeRad = chA.aoeCloudSize ?? 0;
        const reqMLO = chRs.includes('Missile Launcher Operation');
        const penalize = (arr) => arr.sort((a,b)=>b-a).reduce((f,v,i)=>f*(1+v/100*Math.exp(-(i*i)/7.1289)),1);

        // Skills — unpenalized
        const skillVel    = 1 + 0.10 * (sk.missileProjection ?? 0);
        const skillFlight = 1 + 0.10 * (sk.missileBombardment ?? 0);

        // Build the shared penalized pools (MGC modules + rigs together).
        const velPool = [], flightPool = [];
        for (const { slot: s2, fitItem: fi2 } of modItems) {
          if (!fi2 || !isActive(s2.state)) continue;
          const g2 = fi2.groupName ?? '';
          if (g2 !== 'Missile Guidance Computer' && g2 !== 'Missile Guidance Enhancer') continue;
          const a2 = TYPES[fi2.typeID]?.attrs ?? {};
          let vB = a2.missileVelocityBonus ?? 0;   // 5.5 for MGC II
          let fB = a2.explosionDelayBonus ?? 0;    // 5.5 for MGC II
          // Script (Computer only): *BonusBonus multiplies the bonus magnitude. Range +100 → ×2; Precision −100 → 0.
          if (g2 === 'Missile Guidance Computer' && s2.ammo) {
            const scTid = typeIDByName(s2.ammo) ?? tidByName(s2.ammo);
            const scA = scTid ? (TYPES[scTid]?.attrs ?? {}) : {};
            const vBB = scA.missileVelocityBonusBonus; // -100 (precision) or +100 (range)
            const fBB = scA.explosionDelayBonusBonus;
            if (vBB != null) vB *= 1 + vBB / 100;
            if (fBB != null) fB *= 1 + fBB / 100;
          }
          if (vB > 0) velPool.push(vB);
          if (fB > 0) flightPool.push(fB);
        }
        for (const { slot: s3, fitItem: fi3 } of modItems) {
          if (!fi3 || !isOnline(s3.state)) continue;
          const a3 = TYPES[fi3.typeID]?.attrs ?? {};
          const e3 = TYPES[fi3.typeID]?.e ?? [];
          if (e3.includes(1764) && a3.speedFactor)        velPool.push(a3.speedFactor);        // Hydraulic Bay Thrusters → velocity
          if (e3.includes(784)  && a3.maxFlightTimeBonus) flightPool.push(a3.maxFlightTimeBonus); // Rocket Fuel Cache → flight
        }
        // Siege module's siegeTorpedoVelocityBonus (+150%) targets charges requiring Torpedoes.
        // Pyfa applies it with stackingPenalties=True (filteredChargeBoost on maxVelocity), so it
        // shares the stacking pool with MGC/rig bonuses. Read from any active module that carries
        // the attr (Siege Module I/II, Triage variants).
        if (chRs.includes('Torpedoes')) {
          for (const { slot: s4, fitItem: fi4 } of modItems) {
            if (!fi4 || !isActive(s4.state)) continue;
            const tvb = TYPES[fi4.typeID]?.attrs?.siegeTorpedoVelocityBonus;
            if (tvb) velPool.push(tvb);
          }
        }
        const poolVel    = penalize(velPool);
        const poolFlight = penalize(flightPool);

        // Implants & boosters — unpenalized. Antipharmakon Toxot is a BOOSTER (category 20,
        // boosterDuration attr) giving +8% flight via maxFlightTimeBonus; other implants may give
        // missile velocity. Read flight/velocity bonuses from both sources.
        let implFlight = 1, implVel = 1;
        const applyConsumable = (name, active) => {
          if (!name || active === false) return;
          const cTid = typeIDByName(name) ?? tidByName(name);
          const cA = cTid ? (TYPES[cTid]?.attrs ?? {}) : {};
          if (cA.maxFlightTimeBonus)  implFlight *= 1 + cA.maxFlightTimeBonus / 100;
          if (cA.missileVelocityBonus) implVel   *= 1 + cA.missileVelocityBonus / 100;
          // Missile Projection implants (e.g. Zainou 'Deadeye' MP-xxx) carry their velocity bonus as
          // speedFactor gated by Effect1764, not missileVelocityBonus.
          const cE = cTid ? (TYPES[cTid]?.e ?? TYPES[cTid]?.effectIDs ?? []) : [];
          if (cE.includes(1764) && cA.speedFactor) implVel *= 1 + cA.speedFactor / 100;
        };
        for (const imp of implants) applyConsumable(imp?.name, true);
        for (const bst of boosters) applyConsumable(bst?.name, bst?.active);
        // Hydra implant set: set-amplified missile flight time (range). The engine applies this to the
        // charge's explosionDelay, but this range block recomputes flight from base × its own chain, so
        // mirror it here. Effective per-member bonus = raw × product(implantSetHydra), applied multiplicatively.
        {
          const hydraA = implants
            .map(i => TYPES[typeIDByName(i.name) ?? tidByName(i.name)]?.attrs)
            .filter(a => a && a.implantSetHydra != null);
          if (hydraA.length >= 2) {
            const setProduct = hydraA.reduce((p, a) => p * (a.implantSetHydra ?? 1), 1);
            for (const a of hydraA) {
              const raw = a.hydraMissileFlightTimeBonus ?? 0;
              if (raw) implFlight *= 1 + raw * setProduct / 100;
            }
          }
        }

        // T3D tactical-mode missile velocity / flight time — unpenalized.
        //
        // These MUST be applied here rather than left to the engine. The engine does apply them
        // (effects 6076/12794/12795/12796/12798, all PostDiv onto the CHARGE's maxVelocity /
        // explosionDelay), but this range calculation reads the charge's attributes RAW off
        // TYPES[chTid] and builds its own multiplier chain — so an engine-applied charge modifier
        // is invisible here. Same split as the hull missile bonuses (see SHIP_MISSILE_DMG).
        //
        // Keyed by EFFECT, not by attribute presence. The Skua's Sharpshooter mode still carries a
        // vestigial modeMaxRangePostDiv=0.6 from before CCP split that bonus into the two per-skill
        // ones, but it does NOT carry effect 6076 — so the attribute is dead weight and eos ignores
        // it. Reading attributes alone applied both and put a Sharpshooter Skua's rockets at 78 km
        // against eos's 35 km. Each entry also carries its own charge-skill filter, as pyfa's
        // handlers do.
        const MODE_MISSILE_VEL = [   // [effect, mode attribute, required charge skill]
          [6076,  'modeMaxRangePostDiv',                          'Missile Launcher Operation'],
          [12798, 'modeAnhingaMissileMaxVelocityPostDiv',          'Missile Launcher Operation'],
          [12794, 'modeRocketMissileMaxVelocityBonusPostDivSkua',  'Rockets'],
          [12795, 'modeLightMissileMaxVelocityBonusPostDivSkua',   'Light Missiles'],
        ];
        const MODE_MISSILE_FLIGHT = [
          [12796, 'modeAnhingaMissileFlightTimePostDiv',           'Missile Launcher Operation'],
        ];
        const modeDiv = (table) => {
          let mult = 1;
          if (!tacticalModeTid) return mult;
          const mA = TYPES[tacticalModeTid]?.attrs ?? {};
          const mE = TYPES[tacticalModeTid]?.e ?? [];
          for (const [eid, attr, skill] of table) {
            const v = mA[attr];
            if (v && v !== 1 && mE.includes(eid) && chRs.includes(skill)) mult *= 1 / v;
          }
          return mult;
        };
        const modeVel    = modeDiv(MODE_MISSILE_VEL);
        const modeFlight = modeDiv(MODE_MISSILE_FLIGHT);

        // T3 cruiser subsystem missile bonuses (e.g. Loki Offensive: +5%/lvl missile velocity via
        // subsystemBonus → maxVelocity, requiring the Missiles skill). Read the skill-scaled bonus
        // off the fitted subsystem item and apply unpenalized, like a hull role bonus.
        let subsysVel = 1, subsysFlight = 1;
        if (Array.isArray(slots.subsystems)) {
          for (const ssItem of fit._subsystems ?? []) {
            // The offensive subsystem's missile-velocity bonus (subsystemBonus*Offensive, skill-scaled
            // by the engine) feeds maxVelocity via E6923 for charges requiring the Missiles skill.
            const velB = ssItem.get('subsystemBonusMinmatarOffensive')
                      ?? ssItem.get('subsystemBonusCaldariOffensive')
                      ?? ssItem.get('subsystemBonusGallenteOffensive')
                      ?? ssItem.get('subsystemBonusAmarrOffensive');
            const ssEff = TYPES[ssItem.typeID]?.e ?? [];
            if (velB && ssEff.includes(6923) && reqMLO) subsysVel *= 1 + velB / 100;
          }
        }

        // Ship-hull missile range bonuses (e.g. Orthrus shipBonusRole7 +200% velocity and
        // shipBonusRole8 −50% flight → ~1.5× range). Table-driven for ALL hulls, unpenalized,
        // filtered by the charge's required missile skill.
        let shipVel = 1, shipFlight = 1;
        {
          const shipEffs = TYPES[fit.ship.typeID]?.e ?? TYPES[fit.ship.typeID]?.effectIDs ?? [];
          for (const eid of shipEffs) {
            const spec = SHIP_MISSILE_RANGE[eid];
            if (!spec || !chRs.includes(SHIP_MR_SK[spec[2]])) continue;
            const bonus = fit.ship.get(spec[0]) ?? 0;
            if (bonus) { if (spec[1] === 'vel') shipVel *= 1 + bonus / 100; else shipFlight *= 1 + bonus / 100; }
          }
        }

        // ── The charge-skill gate ────────────────────────────────────────────────────
        // EVERY personal missile range bonus — the Missile Projection / Missile Bombardment
        // skills, Missile Guidance Computers/Enhancers, Hydraulic Bay Thruster and Rocket Fuel
        // Cache rigs, Zainou 'Deadeye' implants, the Antipharmakon Toxot booster, and the Hydra
        // implant set — is gated in eos on the CHARGE requiring "Missile Launcher Operation"
        // (`filteredChargeBoost(lambda mod: mod.charge.requiresSkill('Missile Launcher Operation'),
        // ...)`). Every single one of those handlers uses that identical predicate.
        //
        // STRUCTURE missiles (Standup Light/Heavy/Cruise Missile, Standup XL Cruise, Standup
        // Super-heavy Torpedo) declare NO required skills at all — `rs` is empty — so none of
        // these reach them: an Azbel's Standup Light Missile flies its base 95 s at its base
        // 15 km/s. We applied them unconditionally, which multiplied both velocity and flight
        // time by 1.5 and put the Azbel at 3195 km against pyfa's 1417.5 km.
        //
        // modeVel / subsysVel / shipVel are already skill-filtered at their own sites.
        const gate = v => (reqMLO ? v : 1);
        const velMult    = gate(skillVel)    * gate(poolVel)    * modeVel * gate(implVel)    * subsysVel * shipVel;
        const flightMult = gate(skillFlight) * gate(poolFlight) * modeFlight * gate(implFlight) * subsysFlight * shipFlight;
        let finalVel    = baseVel * velMult;
        let finalFlight = baseFlight * flightMult; // ms
        let aoeVel = baseAoeVel, aoeRad = baseAoeRad;
        // Projected guidance disruptor: cut missile range (velocity + flight) and worsen application
        // (lower explosion velocity, larger explosion radius). Values pre-stacked by the caller.
        const gd = opts.projectedDebuffs;
        if (gd) {
          if (gd.missileRange)   finalVel    *= (1 + gd.missileRange   / 100);
          if (gd.explosionDelay) finalFlight *= (1 + gd.explosionDelay / 100);
          if (gd.aoeVel)         aoeVel      *= (1 + gd.aoeVel  / 100);
          if (gd.aoeCloud)       aoeRad      *= (1 + gd.aoeCloud / 100);
        }
        // pyfa three-zone missile range model. Missiles travel in whole-second ticks; a fractional
        // flight time leaves a partial last tick, producing a step-down at the very end of the range:
        //   • full damage out to lowerRange (floor(flightTime) seconds of travel)
        //   • higherChance × damage between lowerRange and higherRange (ceil(flightTime))
        //   • zero beyond higherRange
        const shipRadiusM = s.get('radius') ?? 0;
        const chMass    = fitItem._charge?.get('mass')    ?? chA.mass    ?? 0;
        const chAgility = fitItem._charge?.get('agility') ?? chA.agility ?? 0;
        const chDRF     = fitItem._charge?.get('aoeDamageReductionFactor') ?? chA.aoeDamageReductionFactor ?? 0;
        // Flight time gets a small ship-radius bonus (missiles spawn at the ship centre).
        const flightTimeS = finalFlight / 1000 + (finalVel > 0 ? shipRadiusM / finalVel : 0);
        const rangeForTime = (ft) => {
          const accelTime = Math.min(ft, chMass * chAgility / 1000000);
          return finalVel / 2 * accelTime + finalVel * (ft - accelTime);
        };
        const lowerTime  = Math.floor(flightTimeS);
        const higherTime = Math.ceil(flightTimeS);
        const lowerRange  = Math.max(0, rangeForTime(lowerTime)  - shipRadiusM);
        const higherRange = Math.max(0, rangeForTime(higherTime) - shipRadiusM);
        const higherChance = flightTimeS - lowerTime;
        const missileRange = lowerRange * (1 - higherChance) + higherRange * higherChance; // expected (display)
        slotEngineStats.set(slot, {
          isMissile: true,
          optimal:  Math.round(missileRange / 1000 * 10) / 10,
          falloff:  0,
          velocity: Math.round(finalVel),
          flightTime: Math.round(finalFlight),
          explosionVelocity: Math.round(aoeVel),
          explosionRadius:   Math.round(aoeRad),
        });
        // Per-weapon graph data (missile application + three-zone range). Volley split by damage type.
        if (totalChargeHp > 0 && vol > 0) {
          graphWeapons.push({
            kind: 'missile',
            volley: { em: vol*(chEm/safeTot), th: vol*(chTh/safeTot), kin: vol*(chKin/safeTot), exp: vol*(chExp/safeTot) },
            cycleS: cycleMs / 1000,
            lowerRange, higherRange, higherChance,
            explosionRadius: aoeRad, explosionVelocity: aoeVel, aoeDamageReductionFactor: chDRF,
            numShots, reloadS: (fitItem.get('reloadTime') ?? 0) / 1000,
          });
        }
      }
    }
  }

  // ── 8b. Non-turret active modules with range + AAR paste stats ──────────────────────
  // Incoming damage profile (from the Resistances tab) for EHP-weighted ancillary rep readouts;
  // defaults to uniform. Armor resonances already include any RAH adaptation (applied in calculate()).
  const dmgP = Array.isArray(opts.damageProfile) ? opts.damageProfile : [0.25, 0.25, 0.25, 0.25];
  for (const { slot, fitItem } of modItems) {
    if (!fitItem || !isActive(slot.state)) continue;
    if (slotEngineStats.has(slot)) continue;

    // AAR detection: module name contains 'Ancillary Armor Repairer'
    const modName = slot.name ?? '';
    // Detect AAR by name OR by checking if the module has armorDamageAmount + reloadTime (AAR signature)
    // Exclude REMOTE reps: an "Ancillary Remote Armor Repairer" also carries armorDamageAmount +
    // a 60s reload + paste capacity, so the attr heuristic below would wrongly bucket it as LOCAL
    // self-rep (Augoror logi came out at 130 EHP/s of phantom self-tank; eos correctly shows 0).
    const isRemoteRep = (fitItem.groupName ?? '').includes('Remote');
    const isAAR = !isRemoteRep && (modName.includes('Ancillary Armor Repairer') ||
      (fitItem && (fitItem.get('armorDamageAmount') ?? 0) > 0 && (fitItem.get('reloadTime') ?? 0) >= 60000 && (fitItem.get('capacity') ?? 0) > 0));
    if (isAAR) {
      const baseRep    = fitItem.get('armorDamageAmount') ?? 0;
      const cycleMs    = fitItem.get('duration') ?? fitItem.get('speed') ?? 15000;
      const reloadMs   = fitItem.get('reloadTime') ?? 60000;
      const hasPaste   = slot.ammo === 'Nanite Repair Paste';
      // chargedArmorDamageMultiplier (attr1886) not stored in our TYPES → always falls back to 3
      const pasteMult  = (fitItem.get('chargedArmorDamageMultiplier') || 3);
      // Standard AARs always have 8 paste cycles (capacity/0.01 total paste / chargeRate per cycle)
      // chargeRate (attr56) not in our TYPES, so derive from capacity: Small=1,Med=4,Large=8
      const capacity   = fitItem.get('capacity') ?? 0.64;
      const PASTE_VOLUME = 0.01;  // Nanite Repair Paste volume in m³
      const PASTE_CYCLES = 8;     // All standard AARs: 8 cycles on full paste
      const repPerCycle  = hasPaste ? baseRep * pasteMult : baseRep;
      const rawTotalHP   = repPerCycle * (hasPaste ? PASTE_CYCLES : 1);
      // Pyfa shows EHP (with armor resists) over paste phase only (no reload in denominator).
      // EHP multiplier weighted by the selected incoming damage profile; the armor resonances
      // here already include any Reactive Armor Hardener adaptation (applied during calculate()).
      const rEM  = s.get('armorEmDamageResonance')  ?? 1;
      const rTH  = s.get('armorThermalDamageResonance') ?? 1;
      const rKIN = s.get('armorKineticDamageResonance') ?? 1;
      const rEXP = s.get('armorExplosiveDamageResonance') ?? 1;
      const _div = dmgP[0]*rEM + dmgP[1]*rTH + dmgP[2]*rKIN + dmgP[3]*rEXP;
      const ehpMult = _div > 0.0001 ? 1 / _div : 1;
      const totalEHP = rawTotalHP * ehpMult;
      // Paste phase time only (Pyfa style: no reload). With no paste loaded an AAR reps its base
      // amount over a SINGLE cycle continuously — divide by 1 cycle, not PASTE_CYCLES (else EHP/s
      // comes out 8x low).
      const pastePhaseS = cycleMs * (hasPaste ? PASTE_CYCLES : 1) / 1000;
      // For EHP/s including reload (for stats panel):
      const totalS_withReload = hasPaste ? (cycleMs * PASTE_CYCLES + reloadMs) / 1000 : cycleMs / 1000;
      slotEngineStats.set(slot, {
        isAAR: true,
        baseRep, cycleMs, reloadMs, hasPaste, pasteMult, PASTE_CYCLES,
        repPerCycle: Math.round(repPerCycle),
        totalHP:    Math.round(rawTotalHP),
        totalEHP:   Math.round(totalEHP),
        totalS:     Math.round(pastePhaseS * 10) / 10,
        totalS_withReload: Math.round(totalS_withReload * 10) / 10,
        ehpS:       Math.round(totalEHP / pastePhaseS * 10) / 10,  // Pyfa: paste phase only, no reload
      });
      continue;
    }

    // ASB detection: Ancillary Shield Booster (mirrors AAR, but boosts shield and runs a clip of
    // Cap Booster charges). With charges loaded it cycles its clip, then reloads (60s).
    const isASB = fitItem.groupName === 'Ancillary Shield Booster' ||
      modName.includes('Ancillary Shield Booster');
    if (isASB) {
      const baseBoost  = fitItem.get('shieldBonus') ?? 0;
      const cycleMs    = fitItem.get('duration') ?? fitItem.get('speed') ?? 5000;
      const reloadMs   = fitItem.get('reloadTime') ?? 60000;
      // Loaded with cap-booster charges? (group 87). If so it runs a clip; if not, it boosts on cap continuously.
      const _ammo = (slot.ammo ?? '').replace(/\s*\(\d+\)$/, '');
      const _cTid = _ammo ? (typeIDByName(_ammo) ?? tidByName(_ammo)) : null;
      const _cg   = _cTid ? (TYPES[_cTid]?.g ?? TYPES[_cTid]?.groupID) : null;
      const hasCharges = _cg === 87;
      const chargeVol = _cTid ? (TYPES[_cTid]?.attrs?.volume ?? TYPES[_cTid]?.a?.['161'] ?? 12) : 12;
      const capacity  = fitItem.get('capacity') ?? 0;
      const clipCycles = hasCharges && chargeVol > 0 ? Math.max(1, Math.floor(capacity / chargeVol)) : 0;
      const boostPerCycle = baseBoost;
      const rawTotalHP    = hasCharges ? boostPerCycle * clipCycles : boostPerCycle;
      // Shield EHP multiplier weighted by the selected incoming damage profile.
      const rEM  = s.get('shieldEmDamageResonance')  ?? 1;
      const rTH  = s.get('shieldThermalDamageResonance') ?? 1;
      const rKIN = s.get('shieldKineticDamageResonance') ?? 1;
      const rEXP = s.get('shieldExplosiveDamageResonance') ?? 1;
      const _div = dmgP[0]*rEM + dmgP[1]*rTH + dmgP[2]*rKIN + dmgP[3]*rEXP;
      const ehpMult = _div > 0.0001 ? 1 / _div : 1;
      const totalEHP = rawTotalHP * ehpMult;
      // Boost phase time only (charge clip), pyfa-style (no reload in the denominator)
      const boostPhaseS = hasCharges ? cycleMs * clipCycles / 1000 : cycleMs / 1000;
      const totalS_withReload = hasCharges ? (cycleMs * clipCycles + reloadMs) / 1000 : cycleMs / 1000;
      slotEngineStats.set(slot, {
        isASB: true,
        baseBoost, cycleMs, reloadMs, hasCharges, clipCycles,
        boostPerCycle: Math.round(boostPerCycle),
        totalHP:    Math.round(rawTotalHP),
        totalEHP:   Math.round(totalEHP),
        totalS:     Math.round(boostPhaseS * 10) / 10,
        totalS_withReload: Math.round(totalS_withReload * 10) / 10,
        ehpS:       boostPhaseS > 0 ? Math.round(totalEHP / boostPhaseS * 10) / 10 : 0,
      });
      continue;
    }

    // Reactive Armor Hardener: expose the adapted per-type resonances (set on the engine module
    // during calculate()) so the UI can show the module's current resistance split.
    if ((fitItem.groupName === 'Armor Resistance Shift Hardener') && Array.isArray(fitItem._rahAdapted)) {
      // resist contribution per type = 1 - resonance (em, th, kin, exp), as percentages.
      const adapted = fitItem._rahAdapted;
      slotEngineStats.set(slot, {
        isRAH: true,
        rahResonance: adapted.slice(),
        rahResistPct: adapted.map(r => Math.round((1 - r) * 1000) / 10),
      });
      continue;
    }

    // Warp Disruption Field Generator (HIC): expose the warp-scramble range for a module-row readout.
    // Unscripted = bubble radius; with a Focused script the engine has reshaped it to a longer point.
    if ((fitItem.groupName === 'Warp Disrupt Field Generator') || (fitItem._td?.gn === 'Warp Disrupt Field Generator')) {
      const wsr = fitItem.get('warpScrambleRange') ?? 0;
      const scripted = !!fitItem._charge;
      slotEngineStats.set(slot, { isWDFG: true, warpScrambleRange: wsr, scripted });
      continue;
    }

    // Breacher Pod Launchers (SCARAB pods): a resist-ignoring damage-over-time weapon. Each pod
    // applies a DoT for dotDuration, ticking once per second; each tick deals the LESSER of a flat
    // cap (dotMaxDamagePerTick) and a fraction of the target's max HP (dotMaxHPPercentagePerTick%).
    // Because it bypasses resists and partly scales with target HP, it is reported on its own rather
    // than folded into resist-weighted weapon DPS.
    if ((fitItem.groupName === 'Breacher Pod Launchers') || (fitItem._td?.gn === 'Breacher Pod Launchers')) {
      const ch = fitItem._charge;
      if (ch) {
        const TICK_S = 1; // breacher pods tick every second
        const LVL = 5;    // tool assumes all skills trained to V
        // Breacher skills at V: Clone Efficacity +5%/lvl flat damage, Launcher Operation +5%/lvl
        // %-HP, Clone Longevity +10%/lvl duration (engine can't push owner-skill mods to charges).
        const flat  = (ch.get('dotMaxDamagePerTick') ?? 0) * (1 + 0.05 * LVL);
        const hpPct = (ch.get('dotMaxHPPercentagePerTick') ?? 0) * (1 + 0.05 * LVL);
        const durS  = ((ch.get('dotDuration') ?? 0) / 1000) * (1 + 0.10 * LVL);
        const ticks = TICK_S > 0 ? durS / TICK_S : 0;
        const totalAbs  = flat * ticks;                          // total absolute over the DoT
        const totalPct  = hpPct * ticks;                         // total % of target HP over the DoT
        const fullDpsHP = hpPct > 0 ? flat / (hpPct / 100) : 0;  // target HP where flat == relative
        slotEngineStats.set(slot, { isBreacher: true, podName: ch.name ?? '',
          flatDps: flat / TICK_S, hpPctDps: hpPct / TICK_S, perTickFlat: flat, perTickHpPct: hpPct,
          durationS: durS, tickS: TICK_S, totalAbs, totalPct, fullDpsHP });
      } else {
        slotEngineStats.set(slot, { isBreacher: true, noPod: true });
      }
      continue;
    }

    // (Leadership/Fleet Command/Wing Command areaOfEffectBonus → maxRange) now that
    // those skills are mapped in SKILL_CAMEL_TO_PYFA. 15km × 1.5 (hull) × 1.35 × 1.25 × 1.30 = 49.4km.
    const maxRange = fitItem.get('maxRange') ?? 0;
    if (maxRange <= 0) continue;
    // Remote reps / ewar use falloffEffectiveness (attr 2044); turrets use falloff (158).
    // The turret falloff attr defaults to 1, which masks falloffEffectiveness via ??, so check
    // which attr the module actually carries in its type data and read that one.
    const _ta = TYPES[fitItem.typeID]?.attrs ?? TYPES[fitItem.typeID]?.a ?? {};
    const hasFalloffEff = (_ta.falloffEffectiveness ?? _ta['2044']) != null;
    const falloff = hasFalloffEff
      ? (fitItem.get('falloffEffectiveness') ?? 0)
      : (fitItem.get('falloff') ?? 0);
    const tracking = fitItem.get('trackingSpeed') ?? 0;
    // Heated range: if the module isn't already overheated but CAN overload its range
    // (has overloadRangeBonus), compute the heated maxRange for display (e.g. webs/tackle).
    // Use the ENGINE-resolved overloadRangeBonus, which includes subsystem enhancements
    // (e.g. Loki Core's E6936 raises the web's overload bonus from 30 to 45).
    let heatedRange = null;
    const overloadRangeBonus = fitItem.get('overloadRangeBonus') ?? 0;
    if (overloadRangeBonus && !isOverheated(slot.state)) {
      // NOT `maxRange * (1 + bonus/100)`. maxRange is already stacked, and the overload bonus is a
      // PostPercent that would land in that same penalised pool — so applying it on top double-
      // counts the slot it takes. Under an Interdiction Maneuvers link a Loki's Domination web
      // reads 45.1 km cold; the naive form promised 65.5 km against the 63.3 you actually get,
      // because overheating demotes the burst to the second stacking slot. getWithExtraPercent
      // resolves the attribute with the bonus IN the pool, through the same code path as the real
      // overheated value, so the preview and the toggled state now agree by construction.
      heatedRange = fitItem.getWithExtraPercent('maxRange', overloadRangeBonus);
    }
    slotEngineStats.set(slot, {
      optimal:  Math.round(maxRange / 1000 * 10) / 10,
      falloff:  Math.round(falloff  / 1000 * 10) / 10,
      tracking: Math.round(tracking * 1000) / 1000,
      heatedOptimal: heatedRange != null ? Math.round(heatedRange / 1000 * 10) / 10 : null,
    });
  }

  // ── 9. Drones ─────────────────────────────────────────────────────────────
  let droneDps    = { em:0, th:0, kin:0, exp:0, total:0 };
  let droneVolley = { em:0, th:0, kin:0, exp:0, total:0 };
  // Drone control range (m): base 20 km + Drone Avionics/Advanced + Drone Link Augmentors, applied
  // to droneControlDistance by the engine. Drones deal full DPS within it and none beyond it.
  const droneControlRange = s.get('droneControlDistance') ?? 20000;

  // Per-drone EFFECTIVE stats for the Drones tab. These MUST come from the engine, not from the raw
  // type data: the UI used to snapshot base values when the drone was added, so skills, implants
  // (e.g. Overmind 'Goliath' Drone Tuner), boosters and ship bonuses were all ignored — a Federation
  // Navy Hobgoblin showed 0 range, 2.396 tracking and 3360 m/s instead of 2.69km+2.05km, 3.93 and 3780.
  const droneInfo = [];
  for (const { item, qty, raw, active } of droneItems) {
    if (item) {
      const layer = (hp, res) => (hp > 0 && res) ? hp / ((res.em + res.th + res.kin + res.exp) / 4) : 0;
      const rz = (p) => ({
        em:  item.get(`${p}EmDamageResonance`)        ?? 1,
        th:  item.get(`${p}ThermalDamageResonance`)   ?? 1,
        kin: item.get(`${p}KineticDamageResonance`)   ?? 1,
        exp: item.get(`${p}ExplosiveDamageResonance`) ?? 1,
      });
      const hullRz = {
        em:  item.get('emDamageResonance')        ?? 1,
        th:  item.get('thermalDamageResonance')   ?? 1,
        kin: item.get('kineticDamageResonance')   ?? 1,
        exp: item.get('explosiveDamageResonance') ?? 1,
      };
      const ehp = layer(item.get('shieldCapacity') ?? 0, rz('shield'))
                + layer(item.get('armorHP') ?? 0,        rz('armor'))
                + layer(item.get('hp') ?? 0,             hullRz);
      const dm = item.get('damageMultiplier') ?? 1;
      const cy = (item.get('speed') ?? 0) / 1000;
      const vol = ((item.get('emDamage') ?? 0) + (item.get('thermalDamage') ?? 0)
                 + (item.get('kineticDamage') ?? 0) + (item.get('explosiveDamage') ?? 0)) * dm;
      droneInfo.push({
        name: raw?.name ?? item.name, qty, active: active !== false,
        optimal:  item.get('maxRange') ?? 0,
        falloff:  item.get('falloff') ?? 0,
        tracking: item.get('trackingSpeed') ?? 0,
        // pyfa's drone list shows tracking NORMALISED to a 40,000 m reference signature, not the raw
        // attribute (gui/builtinViewColumns/misc.py: trackingSpeed * 40000 / optimalSigRadius). The
        // raw attr for a Federation Navy Hobgoblin is 2.46, which is what pyfa's attribute panel
        // shows — but its drone list shows 3.93k. Both are correct; they are different numbers.
        trackingNorm: (() => {
          const t = item.get('trackingSpeed') ?? 0;
          const sig = item.get('optimalSigRadius') ?? 0;
          return (t > 0 && sig > 0) ? t * 40000 / sig : 0;
        })(),
        velocity: item.get('maxVelocity') ?? 0,
        ehp,
        dps: cy > 0 ? (vol / cy) * qty : 0,
      });
    }
  }

  for (const { item, qty, raw, active } of droneItems) {
    if (!active) continue; // bay drones (not launched) deal 0 DPS
    if (item) {
      // Engine-resolved: damageMultiplier already includes Drone Interfacing, drone-op skills,
      // racial specs, ship/subsystem drone-damage bonuses and any drone damage amplifiers.
      const dmgMult = item.get('damageMultiplier') ?? 1;
      const cycleS  = (item.get('speed') ?? 1000) / 1000;
      const dmg = {
        em:  (item.get('emDamage')        ?? 0) * dmgMult * qty,
        th:  (item.get('thermalDamage')   ?? 0) * dmgMult * qty,
        kin: (item.get('kineticDamage')   ?? 0) * dmgMult * qty,
        exp: (item.get('explosiveDamage') ?? 0) * dmgMult * qty,
      };
      const volley = dmg.em + dmg.th + dmg.kin + dmg.exp;
      // Utility drones (ECM, energy neutralizer, web, mining) have no weapon cycle (speed=0) and
      // deal no weapon damage — skip them so volley/0 doesn't poison the totals with NaN.
      if (cycleS <= 0 || volley <= 0) continue;
      for (const key of ['em','th','kin','exp']) {
        droneDps[key]    += dmg[key] / cycleS;
        droneVolley[key] += dmg[key];
      }
      droneDps.total    += volley / cycleS;
      droneVolley.total += volley;
      // Damage-graph contributor: full DPS up to control range, zero beyond (drones orbit the
      // target, so range-to-target doesn't reduce their damage — only losing control does).
      graphWeapons.push({ kind:'drone', volley:{...dmg}, cycleS, controlRange: droneControlRange });
    } else if (raw) {
      // Fallback for drones not resolvable as engine FitItems (raw type data, no bonuses).
      const typeData = getDroneByName(raw.name);
      if (!typeData) continue;
      const da = typeData.a ?? typeData.attrs ?? {};
      const dmgMult = da.damageMultiplier ?? 1;
      const cycleS  = (da.speed ?? 1000) / 1000;
      const volley = ((da.emDamage??0)+(da.thermalDamage??0)+(da.kineticDamage??0)+(da.explosiveDamage??0)) * dmgMult * qty;
      if (cycleS <= 0 || volley <= 0) continue;
      droneDps.total    += volley / cycleS;
      droneVolley.total += volley;
      const _dm=dmgMult*qty;
      graphWeapons.push({ kind:'drone', cycleS, controlRange: droneControlRange,
        volley:{ em:(da.emDamage??0)*_dm, th:(da.thermalDamage??0)*_dm, kin:(da.kineticDamage??0)*_dm, exp:(da.explosiveDamage??0)*_dm } });
    }
  }

  // ── 9c. Mining yield ──────────────────────────────────────────────────────
  // Ports eos's Fit.calculatemining (module.py / drone.py `__calculateMining`). Yield per cycle
  // divided by cycle seconds, summed over ACTIVE mining modules and LAUNCHED mining drones — the
  // same state rules the DPS passes above use, and for the same reason: an offline strip miner
  // mines nothing.
  //
  // Everything that scales the yield (the Mining/Astrogeology/Ice Harvesting skills, Mining Laser
  // Upgrades, the barge/exhumer/Venture hull bonuses, mining crystals) reaches `miningAmount` on the
  // engine-computed item, so this reads the engine and never the raw type data.
  //
  // `wasteM3S` is eos's mining DRAIN minus the yield: the ore a miner destroys without collecting.
  // It is not a yield loss to the pilot (the hold fills at `yieldM3S` either way) but it decides how
  // fast a rock is gone, which is what makes two equal-yield fits different.
  const mining = { moduleM3S: 0, droneM3S: 0, totalM3S: 0, wasteM3S: 0, modules: [] };
  {
    // eos reads the module's cycle from `speed` first, then `duration`; a mining laser only carries
    // `duration`, but reading them in the same order keeps this honest if CCP ever adds one.
    const cycleS = (it) => ((it.get('speed') || it.get('duration') || 0) / 1000);
    const wasted = (it, yps) => {
      const chance = Math.max(0, Math.min(1, (it.get('miningWasteProbability') ?? 0) / 100));
      return yps * chance * (it.get('miningWastedVolumeMultiplier') ?? 0);
    };
    for (const { slot, fitItem } of modItems) {
      if (!fitItem || !isActive(slot.state)) continue;
      const amount = fitItem.get('miningAmount') ?? 0;
      const cyc = cycleS(fitItem);
      if (amount <= 0 || cyc <= 0) continue;
      let yps = amount / cyc;
      mining.wasteM3S += wasted(fitItem, yps);
      // Mining crits roll per cycle, so the displayed yield is the EXPECTED value — chance × bonus
      // on top of the base. eos folds this in the same way, and only after waste has been measured
      // against the un-crit yield.
      yps += yps * (fitItem.get('miningCritChance') ?? 0) * (fitItem.get('miningCritBonusYield') ?? 0);
      mining.moduleM3S += yps;
      mining.modules.push({ name: fitItem.name ?? TYPES[slot.typeID]?.n ?? '?', m3s: yps, cycleS: cyc });
    }
    for (const { item, qty, active } of droneItems) {
      if (!item || !active) continue;
      const amount = item.get('miningAmount') ?? 0;
      const cyc = cycleS(item);
      if (amount <= 0 || cyc <= 0) continue;
      const yps = (amount * qty) / cyc;
      mining.wasteM3S += wasted(item, yps);
      mining.droneM3S += yps;
    }
    mining.totalM3S = mining.moduleM3S + mining.droneM3S;
  }

  // ── 9b. Fighters (squadron DPS, speed, EHP, per-ability toggles) ───────────
  // Fighters aren't dogma-engine FitItems, so their multipliers are composed analytically from the
  // modifiers Pyfa applies: Fighters (+5%/lvl), racial Fighter Specialization (+2%/lvl, T2), Heavy
  // Fighters (+5%/lvl, heavy), Drone Interfacing (+10%/lvl), the hull fighter-damage bonus
  // (carrier/super/titan-role) and Drone Damage Amplifiers (stacking-penalized). Fighter Support
  // Units shorten cycle time (RoF) and boost velocity/shield. Each ability can be toggled on/off,
  // which flows through to the fighter (and total) DPS and the displayed speed.
  const FIGHTER_ABILITY_DEFS = [
    { key:'AttackMissile', label:'Turret Attack',    kind:'damage',  probe:'fighterAbilityAttackMissileDuration' },
    { key:'Missiles',      label:'Missile Attack',   kind:'damage',  probe:'fighterAbilityMissilesDuration' },
    { key:'AttackTurret',  label:'Turret Attack',    kind:'damage',  probe:'fighterAbilityAttackTurretDuration' },
    { key:'MicroWarpDrive',label:'Microwarpdrive',   kind:'speed',   probe:'fighterAbilityMicroWarpDriveSpeedBonus' },
    { key:'Afterburner',   label:'Afterburner',      kind:'speed',   probe:'fighterAbilityAfterburnerSpeedBonus' },
    { key:'MicroJumpDrive',label:'Micro Jump Drive', kind:'utility', probe:'fighterAbilityMicroJumpDriveDuration' },
    { key:'LaunchBomb',    label:'Bomb',             kind:'utility', probe:'fighterAbilityLaunchBombDuration' },
    { key:'WarpDisruption',label:'Warp Disruption',  kind:'tackle',  probe:'fighterAbilityWarpDisruptionRange' },
    { key:'StasisWebifier',label:'Stasis Web',       kind:'tackle',  probe:'fighterAbilityStasisWebifierDuration' },
  ];
  let fighterDps     = { em:0, th:0, kin:0, exp:0, total:0 };
  let fighterVolley  = { em:0, th:0, kin:0, exp:0, total:0 };
  const fighterDetails = [];
  const fighters = opts.fighters ?? [];
  if (fighters.length) {
    const lvl = 5;
    // Hull fighter-damage bonus (pre-scaled by racial capital skill in the full fit → apply flat).
    let shipFtrMult = 1;
    for (const a of ['shipBonusCarrierG1','shipBonusCarrierC1','shipBonusCarrierA1','shipBonusCarrierM1',
                     'shipBonusSupercarrierG1','shipBonusSupercarrierC1','shipBonusSupercarrierA1','shipBonusSupercarrierM1']) {
      const v = s.get(a); if (v) shipFtrMult *= 1 + v / 100;
    }
    if ((TYPES[shipTypeID]?.e ?? []).includes(6984)) {
      const roleV = s.get('shipBonusRole4'); if (roleV) shipFtrMult *= 1 + roleV / 100; // titan role bonus
    }
    // Hull fighter-HP bonus (carrier/super "*3" fighter-hitpoint bonuses), pre-scaled → flat.
    let shipHpMult = 1;
    for (const a of ['shipBonusCarrierG3','shipBonusCarrierC3','shipBonusCarrierA3','shipBonusCarrierM3',
                     'shipBonusSupercarrierG3','shipBonusSupercarrierC3','shipBonusSupercarrierA3','shipBonusSupercarrierM3']) {
      const v = s.get(a); if (v) shipHpMult *= 1 + v / 100;
    }
    // Drone Damage Amplifiers (fighter damage) + Fighter Support Units (RoF / velocity / shield).
    const ddaVals = [], fsuRofV = [], fsuVelV = [], fsuShV = [];
    for (const { slot: s2, fitItem: fi2 } of modItems) {
      if (!fi2 || !isOnline(s2.state)) continue;
      const at = TYPES[fi2.typeID]?.attrs; if (!at) continue;
      if (at.droneDamageBonus) ddaVals.push(at.droneDamageBonus);
      if (at.fighterBonusROFPercent && at.fighterBonusROFPercent < 1)          fsuRofV.push((1 - at.fighterBonusROFPercent) * 100);
      if (at.fighterBonusVelocityPercent && at.fighterBonusVelocityPercent > 1) fsuVelV.push((at.fighterBonusVelocityPercent - 1) * 100);
      if (at.fighterBonusShieldCapacityPercent && at.fighterBonusShieldCapacityPercent > 1) fsuShV.push((at.fighterBonusShieldCapacityPercent - 1) * 100);
    }
    const stackMult = (vals) => { vals.sort((a,b)=>b-a); let m=1; vals.forEach((v,i)=>m*=1+(v/100)*Math.exp(-(i*i)/7.1289)); return m; };
    const stackRof  = (vals) => { vals.sort((a,b)=>b-a); let m=1; vals.forEach((v,i)=>m*=1-(v/100)*Math.exp(-(i*i)/7.1289)); return m; };
    const prod = (vals) => vals.reduce((m,v)=>m*(1+v/100),1); // unpenalized product
    const ddaMult = stackMult(ddaVals), fsuRof = stackRof(fsuRofV), fsuVel = stackMult(fsuVelV), fsuSh = prod(fsuShV);
    // Drone Navigation Computer modules boost fighter velocity (speedFactor, stacking-penalized).
    const dncVals = [];
    for (const { slot: s2, fitItem: fi2 } of modItems) {
      if (!fi2 || !isOnline(s2.state)) continue;
      if (TYPES[fi2.typeID]?.gn === 'Drone Navigation Computer') { const sf = TYPES[fi2.typeID]?.attrs?.speedFactor; if (sf) dncVals.push(sf); }
    }
    const dncMult = stackMult(dncVals);
    const fightersSkill = 1 + 0.05*lvl, droneInterfacing = 1 + 0.10*lvl, specMult = 1 + 0.02*lvl, heavyMult = 1 + 0.05*lvl;
    const droneNavSkill = 1 + 0.05*lvl;      // Drone Navigation (+5%/lvl velocity, all fighters)
    const droneDurability = 1 + 0.05*lvl;    // Drone Durability (+5%/lvl shield/hull, all fighters)
    const abBonusBoost = 1 + (s.get('shipBonusCarrierG5') ?? 0)/100; // hull support-fighter AB speed-bonus boost (pre-scaled)
    const prof = (opts.damageProfile && opts.damageProfile.length === 4) ? opts.damageProfile : [1,1,1,1];
    const profSum = prof.reduce((a,b)=>a+b,0) || 1;
    for (const f of fighters) {
      const ftid = typeIDByName(f.name) ?? tidByName(f.name);
      const fa = TYPES[ftid]?.a ?? TYPES[ftid]?.attrs;
      if (!fa) continue;
      const squads   = f.qty ?? f.squadrons ?? f.count ?? 1;
      const sqSize   = fa.fighterSquadronMaxSize ?? 1;
      const isHeavy  = (fa.fighterSquadronIsHeavy ?? 0) === 1;
      const isLight  = (fa.fighterSquadronIsLight ?? 0) === 1;
      const isSupport= (fa.fighterSquadronIsSupport ?? 0) === 1;
      const isT2     = / II$/.test(f.name);
      const sqActive = f.active !== false; // active squadron (in space) — like the drone active checkbox
      let mult = fightersSkill * droneInterfacing * shipFtrMult * ddaMult;
      if (isT2 && isLight) mult *= specMult; // racial Fighter Specialization: light T2 fighters only
      if (isHeavy)         mult *= heavyMult; // Heavy Fighters skill (heavy fighters instead of a racial spec)
      const tog = f.abilities || {};
      const isOn = (def) => tog[def.key] !== undefined ? !!tog[def.key] : (def.kind === 'damage'); // damage on by default
      const abilities = [];
      let ftrDpsTotal = 0;
      for (const def of FIGHTER_ABILITY_DEFS) {
        if (fa[def.probe] == null) continue; // fighter doesn't have this ability
        const abilOn = isOn(def);
        let abDps = 0;
        if (def.kind === 'damage') {
          const ab = def.key;
          const em = fa[`fighterAbility${ab}DamageEM`] ?? 0, th = fa[`fighterAbility${ab}DamageTherm`] ?? 0,
                kin = fa[`fighterAbility${ab}DamageKin`] ?? 0, exp = fa[`fighterAbility${ab}DamageExp`] ?? 0;
          const tot = em+th+kin+exp, durMs = fa[`fighterAbility${ab}Duration`] ?? 0;
          if (tot > 0 && durMs > 0) {
            const durS = (durMs/1000) * fsuRof;
            const factor = (fa[`fighterAbility${ab}DamageMultiplier`] ?? 1) * mult * sqSize * squads;
            const pt = { em:em*factor, th:th*factor, kin:kin*factor, exp:exp*factor };
            const vol = pt.em+pt.th+pt.kin+pt.exp;
            abDps = vol / durS;
            if (abilOn) {
              ftrDpsTotal += abDps;
              if (sqActive) { // only active squadrons feed the firepower total
                for (const k of ['em','th','kin','exp']) { fighterDps[k] += pt[k]/durS; fighterVolley[k] += pt[k]; }
                fighterDps.total += vol/durS; fighterVolley.total += vol;
              }
            }
          }
        }
        abilities.push({ key:def.key, label:def.label, kind:def.kind, active:abilOn, dps:Math.round(abDps) });
      }
      // Speed model (validated vs pyfa "Affected by"): skills (Light Fighters + Drone Navigation,
      // unpenalized) × FSU velocity (penalized among FSUs) × a propulsion penalty group that stacks
      // the Drone Navigation Computer bonus together with the active AB/MWD burst. So the DNC is full
      // at cruise, but gets stacking-penalized behind the burst when a prop ability is toggled on.
      const velSkill = (isLight ? (1 + 0.05*lvl) : 1) * droneNavSkill;
      const velCore = (fa.maxVelocity ?? 0) * velSkill * fsuVel; // everything except the prop group
      const baseSpeed = velCore * stackMult(dncVals);            // cruise: DNC only in the prop group
      let speedActive = baseSpeed, burstFrom = null;
      for (const def of FIGHTER_ABILITY_DEFS) {
        if (def.kind !== 'speed' || fa[def.probe] == null || !isOn(def)) continue;
        // AB speed bonus is boosted by the hull's support-fighter speed bonus (shipBonusCarrierG5);
        // MWD is unboosted. The burst joins the DNC in the stacking-penalized propulsion group.
        const bonus = def.key === 'MicroWarpDrive' ? (fa.fighterAbilityMicroWarpDriveSpeedBonus ?? 0)
                                                    : (fa.fighterAbilityAfterburnerSpeedBonus ?? 0) * abBonusBoost;
        const spd = velCore * stackMult([bonus, ...dncVals]);
        if (spd > speedActive) { speedActive = spd; burstFrom = def.label; }
      }
      // EHP: shield boosted by Drone Durability (+25%), the hull fighter-HP bonus, and FSU shield
      // (unpenalized), weighted by the incoming damage profile; structure (hull) also gets Drone Durability.
      const shield = (fa.shieldCapacity ?? 0) * droneDurability * shipHpMult * fsuSh;
      const avgRes = (prof[0]*(fa.shieldEmDamageResonance ?? 1) + prof[1]*(fa.shieldThermalDamageResonance ?? 1) +
                      prof[2]*(fa.shieldKineticDamageResonance ?? 1) + prof[3]*(fa.shieldExplosiveDamageResonance ?? 1)) / profSum;
      const structure = (fa.hp ?? 0) * droneDurability;
      const ehp = avgRes > 0 ? (shield/avgRes + structure) : (shield + structure);
      fighterDetails.push({
        name: f.name, qty: squads, sqSize, active: sqActive,
        class: isLight ? 'Light' : isHeavy ? 'Heavy' : isSupport ? 'Support' : 'Fighter',
        dps: Math.round(ftrDpsTotal),
        speed: Math.round(baseSpeed), speedActive: Math.round(speedActive), burstFrom,
        ehp: Math.round(ehp), shield: Math.round(shield), structure: Math.round(structure),
        abilities,
      });
    }
  }

  // ── 10. Tank (shield/armor rep rates) ─────────────────────────────────────
  let shieldRepPS = 0, armorRepPS = 0, hullRepPS = 0;
  let armorRepPS_AAR = 0;   // an AAR's UNBOOSTED rep — subtracted below so it isn't counted twice
  const localRepairers = []; // {tank, repPS, capPS, cn} for sustainable tank calc
  // Remote reps (logistics): rep/s delivered to other ships + cap transmitted.
  let remoteShieldPS = 0, remoteArmorPS = 0, remoteHullPS = 0, remoteCapPS = 0;
  const remoteRepModules = []; // per-module detail for the Remote Reps panel
  const isBastionActive = modItems.some(({slot,fitItem}) =>
    fitItem && isActive(slot.state) && fitItem.groupName === 'Siege Module');

  for (const { slot, fitItem } of modItems) {
    if (!fitItem || !isActive(slot.state)) continue;
    const gn  = fitItem.groupName;
    const dur = fitItem.get('duration'); // ms, engine has applied all duration bonuses
    if (!dur) continue;

    if (isShieldBooster(gn)) {
      // Engine applies: Marauder hull bonus, Bastion, Shield Operation skill duration
      const amount = fitItem.get('shieldBonus');
      if (typeof window !== 'undefined' && window.__pyfaDebug) {
        console.log('[SHIELD BOOST]', 'amount=', amount, 'dur=', dur, 'HP/s=', amount/(dur/1000));
      }
      const ps = amount / (dur / 1000);
      shieldRepPS += ps;
      // Track for sustainable tank. ASBs with cap-booster charges use no ship cap.
      const cn = fitItem.get('capacitorNeed') ?? 0;
      const ammo2 = (slot.ammo ?? '').replace(/\s*\(\d+\)$/, '');
      const cTid2 = ammo2 ? (typeIDByName(ammo2) ?? tidByName(ammo2)) : null;
      const isCapCharged = gn === 'Ancillary Shield Booster' && cTid2 && (TYPES[cTid2]?.g ?? TYPES[cTid2]?.groupID) === 87;
      localRepairers.push({ tank:'shield', repPS: ps, capPS: isCapCharged ? 0 : cn / (dur / 1000), cn });

    } else if (isArmorRepairer(gn)) {
      // Engine applies: Marauder hull bonus, Bastion, Repair Systems skill duration
      const amount = fitItem.get('armorDamageAmount');
      const ps = amount / (dur / 1000);
      armorRepPS  += ps;
      // An AAR's real output is its PASTE-boosted figure (from the engine stats below). Track its
      // unboosted rep here so we can subtract it and avoid counting the module twice.
      if (gn === 'Ancillary Armor Repairer') armorRepPS_AAR += ps;
      const cn = fitItem.get('capacitorNeed') ?? 0;
      localRepairers.push({ tank:'armor', repPS: ps, capPS: cn / (dur / 1000), cn });

    } else if (gn === 'Hull Repair Unit') {
      const amount = fitItem.get('structureDamageAmount');
      const ps = amount / (dur / 1000);
      hullRepPS += ps;
      const cn = fitItem.get('capacitorNeed') ?? 0;
      localRepairers.push({ tank:'hull', repPS: ps, capPS: cn / (dur / 1000), cn });

    } else if (gn === 'Remote Shield Booster') {
      const amt = fitItem.get('shieldBonus') ?? 0;
      const ps  = amt / (dur / 1000);
      remoteShieldPS += ps;
      remoteRepModules.push({ name: slot.name, typeID: fitItem.typeID, kind: 'shield', repPS: Math.round(ps * 10) / 10,
        amount: Math.round(amt), cycleMs: Math.round(dur),
        optimal: Math.round((fitItem.get('maxRange') ?? 0) / 1000 * 10) / 10,
        falloff: Math.round((fitItem.get('falloffEffectiveness') ?? 0) / 1000 * 10) / 10 });

    } else if (gn === 'Remote Armor Repairer') {
      const amt = fitItem.get('armorDamageAmount') ?? 0;
      const ps  = amt / (dur / 1000);
      remoteArmorPS += ps;
      remoteRepModules.push({ name: slot.name, typeID: fitItem.typeID, kind: 'armor', repPS: Math.round(ps * 10) / 10,
        amount: Math.round(amt), cycleMs: Math.round(dur),
        optimal: Math.round((fitItem.get('maxRange') ?? 0) / 1000 * 10) / 10,
        falloff: Math.round((fitItem.get('falloffEffectiveness') ?? 0) / 1000 * 10) / 10 });

    } else if (gn === 'Mutadaptive Remote Armor Repairer') {
      // Triglavian logistics rep that spools rep amount over time (Rodiva/Zarmazd).
      const amt = fitItem.get('armorDamageAmount') ?? 0;
      const ps  = amt / (dur / 1000);
      remoteArmorPS += ps;
      const spool = MUTADAPTIVE_SPOOL[fitItem.typeID];
      let spoolFactor = 1, spoolTimeS = 0;
      if (spool && spool.max > 0 && spool.perCycle > 0) {
        spoolFactor = 1 + spool.max;
        // Mutadaptive reps fire at the END of the cycle, so reaching full spool takes the full
        // cycle count (cycles × cycleTime), unlike start-firing entropic disintegrators.
        const cycles = spoolCyclesToMax(spool.max, spool.perCycle);
        spoolTimeS = cycles * (dur / 1000);
      }
      remoteRepModules.push({ name: slot.name, typeID: fitItem.typeID, kind: 'armor', repPS: Math.round(ps * 10) / 10,
        amount: Math.round(amt), cycleMs: Math.round(dur),
        spoolFactor, spoolTimeS: Math.round(spoolTimeS * 10) / 10,
        repPSMax: Math.round(ps * spoolFactor * 10) / 10,
        optimal: Math.round((fitItem.get('maxRange') ?? 0) / 1000 * 10) / 10,
        falloff: Math.round((fitItem.get('falloffEffectiveness') ?? 0) / 1000 * 10) / 10 });

    } else if (gn === 'Remote Hull Repairer') {
      const amt = fitItem.get('structureDamageAmount') ?? 0;
      const ps  = amt / (dur / 1000);
      remoteHullPS += ps;
      remoteRepModules.push({ name: slot.name, typeID: fitItem.typeID, kind: 'hull', repPS: Math.round(ps * 10) / 10,
        amount: Math.round(amt), cycleMs: Math.round(dur),
        optimal: Math.round((fitItem.get('maxRange') ?? 0) / 1000 * 10) / 10,
        falloff: Math.round((fitItem.get('falloffEffectiveness') ?? 0) / 1000 * 10) / 10 });

    } else if (gn === 'Remote Capacitor Transmitter') {
      const amt = fitItem.get('powerTransferAmount') ?? 0;
      const ps  = amt / (dur / 1000);
      remoteCapPS += ps;
      remoteRepModules.push({ name: slot.name, typeID: fitItem.typeID, kind: 'cap', repPS: Math.round(ps * 10) / 10,
        amount: Math.round(amt), cycleMs: Math.round(dur),
        optimal: Math.round((fitItem.get('maxRange') ?? 0) / 1000 * 10) / 10,
        falloff: Math.round((fitItem.get('falloffEffectiveness') ?? 0) / 1000 * 10) / 10 });
    }
  }

  // Logistic-drone remote reps. Maintenance bots (all groupName 'Logistic Drone') add to the fit's
  // remote-rep output alongside the modules above. The layer is whichever rep-amount attribute is
  // populated (armor/shield/structureDamageAmount default to 0, so a >0 test picks it cleanly). Only
  // launched (active) drones rep. Drones orbit the assisted ship → no range falloff.
  for (const { item, qty, active } of droneItems) {
    if (!item || active === false || item.groupName !== 'Logistic Drone') continue;
    const ddur = (item.get('duration') ?? 0) / 1000;
    if (ddur <= 0) continue;
    const sAmt = item.get('shieldBonus') ?? 0;
    const aAmt = item.get('armorDamageAmount') ?? 0;
    const hAmt = item.get('structureDamageAmount') ?? 0;
    if (sAmt > 0) { const ps = (sAmt / ddur) * qty; remoteShieldPS += ps;
      remoteRepModules.push({ name: item.name, typeID: item.typeID, kind: 'shield', repPS: Math.round(ps * 10) / 10,
        amount: Math.round(sAmt), cycleMs: Math.round(ddur * 1000), qty, isDrone: true, optimal: 0, falloff: 0 }); }
    if (aAmt > 0) { const ps = (aAmt / ddur) * qty; remoteArmorPS += ps;
      remoteRepModules.push({ name: item.name, typeID: item.typeID, kind: 'armor', repPS: Math.round(ps * 10) / 10,
        amount: Math.round(aAmt), cycleMs: Math.round(ddur * 1000), qty, isDrone: true, optimal: 0, falloff: 0 }); }
    if (hAmt > 0) { const ps = (hAmt / ddur) * qty; remoteHullPS += ps;
      remoteRepModules.push({ name: item.name, typeID: item.typeID, kind: 'hull', repPS: Math.round(ps * 10) / 10,
        amount: Math.round(hAmt), cycleMs: Math.round(ddur * 1000), qty, isDrone: true, optimal: 0, falloff: 0 }); }
  }

  // ── Sustainable tank (pyfa calculateSustainableTank) ──────────────────────
  // Peak rep is what each repairer does at 100% duty. When cap is unstable, reps
  // can't all run continuously — allocate available cap-regen to repairers by
  // efficiency (rep per cap), most efficient first, throttling the rest.
  let sustainedShieldRepPS = shieldRepPS, sustainedArmorRepPS = armorRepPS, sustainedHullRepPS = hullRepPS;
  const totalPeakRecharge = peakRegen(capCapacity, capRechargeMs) + capFillPS; // GJ/s cap available
  const capStableForTank = (capFillPS + totalPeakRecharge - capDrainPS) >= 0 && capSim?.stable;
  if (!capStableForTank && localRepairers.length > 0) {
    // localAdjustment starts by removing all local reps, then adds back the sustainable portion.
    const adj = { shield: -shieldRepPS, armor: -armorRepPS, hull: -hullRepPS };
    // capUsed = cap drained by NON-rep modules: total drain minus all local repairer cap use.
    let capUsed = capDrainPS;
    for (const r of localRepairers) capUsed -= r.capPS;
    // Most efficient first (rep per cap). Cap-free repairers (ASB w/ charges) handled separately.
    const cappedReps = localRepairers.filter(r => r.capPS > 0)
      .sort((a, b) => (b.repPS / b.cn) - (a.repPS / a.cn));
    const freeReps = localRepairers.filter(r => r.capPS <= 0);
    // Cap-free reps (ASB with cap-booster charges) are always sustainable.
    for (const r of freeReps) adj[r.tank] += r.repPS;
    // Cap-using reps get throttled by available recharge, most efficient first.
    for (const r of cappedReps) {
      if (capUsed > totalPeakRecharge) break;
      const sustainability = Math.min(1, (totalPeakRecharge - capUsed) / r.capPS);
      adj[r.tank] += sustainability * r.repPS;
      capUsed += r.capPS; // pyfa adds full capPS, not the throttled portion
    }
    sustainedShieldRepPS = shieldRepPS + adj.shield;
    sustainedArmorRepPS  = armorRepPS  + adj.armor;
    sustainedHullRepPS   = hullRepPS   + adj.hull;
  }

  const scanRes    = s.get('scanResolution');
  // EVE hard-caps targeting range at 300 km regardless of bonuses (e.g. Anhinga Primary mode ×5).
  // Targeting range is capped by the ship's OWN maximumRangeCap attribute (attr797) — NOT by a
  // hardcoded number. This used to be `Math.min(..., 300000)`, which was wrong twice over: the
  // default cap is 750 km, and modules can raise it. The Integrated Sensor Array carries
  // maximumRangeCap = 1e9 and its effect applies that to the ship — precisely how CCP lets a
  // capital lock past the normal limit. The magic 300 km clamped a Salvation with an active
  // ISA to 300 km instead of 6457 km.
  const rangeCap = s.get('maximumRangeCap') || 300000;
  const targetRange = Math.min(s.get('maxTargetRange'), rangeCap) / 1000; // km
  // A ship's max locked targets is capped by the pilot's own limit: base 2 + Target Management (V, +5)
  // + Advanced Target Management (V, +5) = 12 with all skills trained. Big hulls (carriers/supers) list
  // a higher ship value (e.g. Revenant 14) but a character can never lock more than their own cap.
  const PILOT_MAX_LOCKED_TARGETS = 12;
  const maxTargets = Math.min(s.get('maxLockedTargets'), PILOT_MAX_LOCKED_TARGETS);
  const sensorStrength = s.get('scanRadarStrength') || s.get('scanLadarStrength') ||
                         s.get('scanMagnetometricStrength') || s.get('scanGravimetricStrength') || 0;

  // ── 12. Final stats ───────────────────────────────────────────────────────
  const shieldEHP = layerEHP(shieldHP, effectiveResists.shield);
  const armorEHP  = layerEHP(armorHP,  effectiveResists.armor);
  const hullEHP   = layerEHP(hullHP,   effectiveResists.hull);

  // Engine applies Shield Operation skill to shieldRechargeRate
  // The Skua's Defense mode adds a -33.3% shield recharge time bonus that the proxied Jackdaw mode
  // doesn't carry (its trait lists it explicitly); faster recharge → more passive regen.
  const skuaDefRecharge = (ship?.name === 'Skua' && (slots.tactical ?? 'Defense') === 'Defense') ? (1 / 1.5) : 1;
  const shieldRechargeMs  = s.get('shieldRechargeRate') * skuaDefRecharge;
  const passiveShieldRegen = peakRegen(shieldHP, shieldRechargeMs);
  const alignTime  = calcAlignTime(agility, mass);  // mass includes MWD massAddition
  // Always use engine-computed warpSpeedMultiplier (attr600) so rig bonuses apply
  const warpSpeed  = s.get('warpSpeedMultiplier') ?? ship.warpSpeed ?? 3;
  const lockTime   = calcLockTime(scanRes, sigRadius);

  // An Ancillary Armor Repairer runs on Nanite Repair Paste (x3 rep), so its EHP/s comes from the
  // engine stats rather than the raw armorDamageAmount. It must be ADDED to the other repairers, not
  // substituted for them: this used to take the largest AAR and DISCARD every other repairer, so a
  // Praxis with an AAR plus an Imperial Navy Large Armor Repairer reported 447 EHP/s, not 695.3.
  let armorRepIsAAR = false;
  let aarEhpS = 0;
  if (slotEngineStats) {
    for (const [, stats] of slotEngineStats) {
      if (stats.isAAR) { aarEhpS += stats.ehpS ?? 0; armorRepIsAAR = true; }
    }
  }
  const nonAarRepPS = Math.max(0, armorRepPS - armorRepPS_AAR);
  let armorRepEhpS = aarEhpS + (nonAarRepPS > 0 ? layerEHP(nonAarRepPS, effectiveResists.armor) : 0);
  // Regular (non-AAR) repairers report raw armorRepPS; convert to EHP/s with armor resists so the
  // stat is resist-adjusted like the AAR path and like pyfa's "Armor Rep" EHP/s display.

  // Sustained armor rep EHP/s — pyfa default (factorReload OFF): NO reload duty-cycle is applied.
  // Sustained = peak rep throttled only by capacitor availability. A cap-stable repairer shows
  // sustained == peak. For AARs the cap factor is the ratio of cap-throttled to un-throttled base
  // rep (sustainedArmorRepPS / armorRepPS); a cap-stable fit gives factor 1 → sustained = peak.
  let armorRepSustainedEhpS;
  if (armorRepIsAAR) {
    const capFactor = armorRepPS > 0 ? Math.max(0, Math.min(1, sustainedArmorRepPS / armorRepPS)) : 1;
    armorRepSustainedEhpS = armorRepEhpS * capFactor;
  } else {
    armorRepSustainedEhpS = layerEHP(sustainedArmorRepPS, effectiveResists.armor);
  }

  // Shield boost sustained EHP/s — mirrors the armor path above, pyfa default (factorReload OFF):
  // no reload duty-cycle, sustained = peak throttled only by capacitor availability.
  let shieldRepEhpS = 0, shieldRepIsASB = false;
  if (slotEngineStats) {
    for (const [, stats] of slotEngineStats) {
      // Peak EHP/s uses total shieldRepPS below, so a mix of ASB + regular booster (e.g. the PNI:
      // CONCORD Capital Shield Booster + Capital ASB) is summed correctly.
      if (stats.isASB && (stats.ehpS ?? 0) > 0) shieldRepIsASB = true;
    }
  }
  if (shieldRepPS > 0) shieldRepEhpS = layerEHP(shieldRepPS, effectiveResists.shield);

  let shieldRepSustainedEhpS;
  if (shieldRepIsASB) {
    // The cap factor is the ratio of cap-throttled to un-throttled base rep, exactly as the AAR
    // path does it — NOT a fit-wide "is any ASB cap-charged" flag.
    //
    // That flag was the bug: it forced the factor to 1 whenever ANY ancillary booster ran on cap
    // booster charges, which declared the WHOLE shield layer sustainable — including a CONCORD
    // Capital Shield Booster sitting next to it, drawing ship cap the fit cannot pay for. Sustained
    // then equalled peak, and since the UI only shows the sustained row when it is BELOW peak, the
    // row vanished entirely on exactly the fits that need it most.
    //
    // Nothing is lost by dropping the flag, because `sustainedShieldRepPS` already models this
    // correctly per repairer: `calculateSustainableTank` above gives cap-FREE reps their full rep
    // and throttles only the cap-using ones. An all-cap-charged fit therefore still comes out at
    // ratio 1 and sustained == peak, which is what the flag was reaching for.
    const capFactor = shieldRepPS > 0 ? Math.max(0, Math.min(1, sustainedShieldRepPS / shieldRepPS)) : 1;
    shieldRepSustainedEhpS = shieldRepEhpS * capFactor;
  } else {
    shieldRepSustainedEhpS = layerEHP(sustainedShieldRepPS, effectiveResists.shield);
  }

  // Breacher pod launchers report a resist-ignoring DoT. pyfa folds the flat (absolute) DPS into
  // Weapon DPS, so do the same; it is not spooled and has no damage-type breakdown. Volley is ONE
  // tick's flat damage (pyfa reports the earliest subcycle's absolute cap), so fold perTickFlat
  // into weaponVolley.total the same way.
  let breacherDps = 0;
  for (const st of slotEngineStats.values()) {
    if (st.isBreacher && st.flatDps)     breacherDps        += st.flatDps;
    if (st.isBreacher && st.perTickFlat) weaponVolley.total += st.perTickFlat;
  }
  weaponDps.total += breacherDps;

  // Defensive: never surface NaN/Infinity in headline damage numbers (e.g. from an unusual
  // charge/module combination). Clamp non-finite values to 0 so the UI stays clean.
  for (const d of [weaponDps, weaponVolley, droneDps, droneVolley, fighterDps, fighterVolley])
    for (const k in d) if (!Number.isFinite(d[k])) d[k] = 0;

  // Resist-weighted volley per graph weapon, so the damage graph reflects the target profile
  // without every call site knowing about it. Done once here rather than at the four
  // graphWeapons.push sites — two of which are drone entries that are easy to miss.
  for (const w of graphWeapons) if (w && w.volley) w.volleyEff = applyTargetResists(w.volley, _tgtRes);

  return {
    // Resources
    cpuUsed:  Math.round(cpuUsed  * 100) / 100,
    cpuTotal: Math.round(cpuTotal * 100) / 100,
    pgUsed:   Math.round(pgUsed   * 100) / 100,
    pgTotal:  Math.round(pgTotal  * 100) / 100,
    calUsed:  Math.round(calUsed),
    calTotal: ship.calibration ?? 400,

    // HP
    shieldHP, armorHP, hullHP,
    shieldEHP, armorEHP, hullEHP,
    totalEHP: shieldEHP + armorEHP + hullEHP,
    resists: effectiveResists,

    // Tank
    passiveShieldRegen,
    shieldRepPS, shieldRepEhpS, shieldRepIsASB, shieldRepSustainedEhpS, armorRepPS, armorRepEhpS, armorRepIsAAR, armorRepSustainedEhpS, hullRepPS,
    sustainedShieldRepPS, sustainedArmorRepPS, sustainedHullRepPS,
    // Remote reps (logistics)
    remoteShieldPS: Math.round(remoteShieldPS * 10) / 10,
    remoteArmorPS:  Math.round(remoteArmorPS * 10) / 10,
    remoteHullPS:   Math.round(remoteHullPS * 10) / 10,
    remoteCapPS:    Math.round(remoteCapPS * 10) / 10,
    remoteRepModules,
    shieldRechargeMs,

    // Cap
    capCapacity, capRechargeMs,
    capDrainPS, capFillPS,
    capInjectors, capInjectorFillPS,
    capModules,
    energyWarfareResist: s.get('energyWarfareResistance') ?? 1,
    capDelta: capFillPS + peakRegen(capCapacity, capRechargeMs) - capDrainPS,
    capStable: capSim.stable,
    capLevel:  capSim.level,
    capTime:   capSim.time,

    // Weapons
    weaponDps, weaponVolley,
    droneDps, droneVolley, droneInfo,
    fighterDps, fighterVolley, fighterDetails,
    mining,
    totalDps: {
      em: weaponDps.em + droneDps.em + fighterDps.em, th: weaponDps.th + droneDps.th + fighterDps.th,
      kin: weaponDps.kin + droneDps.kin + fighterDps.kin, exp: weaponDps.exp + droneDps.exp + fighterDps.exp,
      total: weaponDps.total + droneDps.total + fighterDps.total,
    },
    totalVolley: {
      em: weaponVolley.em + droneVolley.em + fighterVolley.em, th: weaponVolley.th + droneVolley.th + fighterVolley.th,
      kin: weaponVolley.kin + droneVolley.kin + fighterVolley.kin, exp: weaponVolley.exp + droneVolley.exp + fighterVolley.exp,
      total: weaponVolley.total + droneVolley.total + fighterVolley.total,
    },
    // Spool-up (entropic disintegrators). weaponSpoolFactor>1 means the weapon ramps damage:
    // the unspooled totals above are the MIN. Only the spooling weapon's OWN contribution
    // (spoolBaseDps/spoolBaseVolley) ramps — co-fitted smartbombs/guns, breacher DoTs and drones
    // stay at base. So MAX = total + spoolBase × (factor − 1). weaponSpoolTimeS = time to full spool.
    hasSpoolWeapon: weaponSpoolFactor > 1,
    weaponSpoolFactor,
    weaponSpoolTimeS: Math.round(weaponSpoolTimeS * 10) / 10,
    weaponDpsMax:    weaponDps.total    + spoolBaseDps    * (weaponSpoolFactor - 1),
    weaponVolleyMax: weaponVolley.total + spoolBaseVolley * (weaponSpoolFactor - 1),
    totalDpsMax:     weaponDps.total    + spoolBaseDps    * (weaponSpoolFactor - 1) + droneDps.total + fighterDps.total,
    totalVolleyMax:  weaponVolley.total + spoolBaseVolley * (weaponSpoolFactor - 1) + droneVolley.total + fighterVolley.total,
    // Resist-weighted versions of everything above, against the selected target profile. With no
    // profile (or "None") the resists are all zero and these equal the raw figures exactly, so the
    // UI and graph can read them unconditionally.
    targetResists: _tgtRes,
    effective: (() => {
      const w = applyTargetResists(weaponDps, _tgtRes), wv = applyTargetResists(weaponVolley, _tgtRes);
      const d = applyTargetResists(droneDps, _tgtRes),  dv = applyTargetResists(droneVolley, _tgtRes);
      const f = applyTargetResists(fighterDps, _tgtRes), fv = applyTargetResists(fighterVolley, _tgtRes);
      const sd = applyTargetResists(spoolBaseDpsT, _tgtRes).total;
      const sv = applyTargetResists(spoolBaseVolleyT, _tgtRes).total;
      const sum = (...xs) => ({
        em: xs.reduce((a,x)=>a+x.em,0), th: xs.reduce((a,x)=>a+x.th,0),
        kin: xs.reduce((a,x)=>a+x.kin,0), exp: xs.reduce((a,x)=>a+x.exp,0),
        total: xs.reduce((a,x)=>a+x.total,0),
      });
      return {
        weaponDps: w, weaponVolley: wv, droneDps: d, droneVolley: dv, fighterDps: f, fighterVolley: fv,
        totalDps: sum(w,d,f), totalVolley: sum(wv,dv,fv),
        weaponDpsMax:   w.total  + sd * (weaponSpoolFactor - 1),
        weaponVolleyMax: wv.total + sv * (weaponSpoolFactor - 1),
        totalDpsMax:    w.total  + sd * (weaponSpoolFactor - 1) + d.total + f.total,
        totalVolleyMax: wv.total + sv * (weaponSpoolFactor - 1) + dv.total + fv.total,
      };
    })(),
    // Per-weapon hit-math data + ship geometry for the damage graph
    graphWeapons,
    shipRadius: s.get('radius') ?? 0,

    // Navigation
    maxVelocity:   Math.round(maxVelocity),
    maxVelocityAB: Math.round(abMwdSpeed),
    agility, mass,
    alignTime:     Math.round(alignTime * 100) / 100,
    warpSpeed:     Math.round(warpSpeed * 100) / 100,

    // Targeting
    sigRadius:      Math.round(sigRadius * 10) / 10,
    scanRes:        Math.round(scanRes),
    targetRange:    Math.round(targetRange * 10) / 10,
    maxTargets,
    lockTime:       lockTime ? Math.round(lockTime * 100) / 100 : null,
    sensorStrength: Math.round(sensorStrength * 10) / 10,
    sensorType:     ship.sensorType ?? '',

    // Drone bay (from ship base data, not engine)
    droneBay:       s.get('droneCapacity') || ship.droneBay || 0,   // || not ?? — base=0 ships get subsystem bonus
    droneBandwidth: s.get('droneBandwidth') || ship.droneBandwidth || 0,
    droneControlRange: Math.round(s.get('droneControlDistance') ?? 20000),
    droneControlRange,
    volume:         s.get('volume') ?? ship.volume ?? 0,
    cargoCapacity:  s.get('capacity') ?? 0,
    warpCapNeed:    ship.warpCapNeed ?? 0,

    // Per-slot engine-computed stats (ammo-adjusted range, cycle time etc.)
    slotEngineStats,

    // Graph helpers
    optMult: optMultOut, trkMult: trkMultOut, fallMult: fallMultOut,
    effectiveDmgMultBonus,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// getModuleStats — single-module tooltip data
// ─────────────────────────────────────────────────────────────────────────────
export function getModuleStats(state, modName, ammoName) {
  const tid = tidByName(modName);
  if (!tid || !TYPES[tid]) return null;
  const td = TYPES[tid];
  const a  = td.attrs;
  return {
    name:      td.name,
    groupName: td.groupName,
    cpu:    a.cpu    ?? 0,
    pg:     a.power  ?? 0,
    volume: a.volume ?? 0,
    // Add more as needed
  };
}
