// PRE-RELEASE hulls: ships CCP has shown but not yet shipped in its data.
//
// Hand-written, NOT generated. Everything here comes from CCP's preview screenshots of the in-game
// info window (Alliance Tournament XXI Amarr hulls, shown 2026-10-17), because the ships are on no
// server we can read: not in pyfa's eve.db, not in CCP's SDE, not on Tranquility (ESI /universe/ids
// knew neither name). Nothing here is pyfa-validated, and the UI labels both hulls "Pre-release".
//
// How it gets in: dogma-engine-init.js calls applyPrereleaseShips() on the raw bundles BEFORE
// initEngine(), so the engine, the ship browser (backfillHullsFromTypes files any category-6 type by
// its group name) and lookupShip()'s shipFromDogma() all see these as ordinary hulls.
//
// ⚠️ pyfa 2.69.3's eve.db (build 3624425) already CONTAINS a Herald and a Penitence: pyfa's own hand
// copies, with bonuses as eos effects 100100-100209 that carry no modifier data (17 inert effects in
// a build-bundle dry run). Regenerating from that db would make the name check below retire OUR hulls
// in favour of bonus-less ones. Until CCP ships the real types, build-bundle.py must drop pyfa's two
// (typeIDs 1000000/1000001), or stay on 3579973. Nothing else in 3624425 changes a value we use.
//
// It retires itself: a hull is skipped, along with its fitting allowances and bonus effects, as soon
// as the real bundle carries a type with the same name. Once CCP's data has both ships, delete this
// file and its three call sites (dogma-engine-init.js, core.js shipTraits merge, PRERELEASE_TYPE_IDS
// users). Saved fits survive the swap: the library is keyed by hull NAME, not typeID.
//
// What was guessed rather than read off a screenshot:
//   - typeIDs (990001/990002): placeholders well clear of CCP's range (~100k). Never exported to ESI.
//   - required skills: the info window's skill tab wasn't shown, so each hull requires the class
//     skills its bonuses are scaled by.
//   - heat, sensor-warfare resistances and other attributes no screenshot covers: copied from the
//     nearest existing hull (Herald <- Sentinel, Penitence <- Curse).
//   - how each bonus is implemented: CCP's own effects where an existing one does exactly that job
//     (comments name the hull it is borrowed from); new effects otherwise.
//
// pyfa v2.69.3 (2026-10-17) added both hulls the same way: hand-copied from the Sentinel and Curse,
// typeIDs 1000000/1000001 invented, bonuses as custom eos effects (100100-100106, 100200-100209).
// Every bonus here matches theirs in value, skill and target attribute. Two deliberate differences:
//   - pyfa files them under Assault Frigate / Heavy Interdiction Cruiser so the ADC and WDFG group
//     whitelists let them fit. We keep CCP's stated classes (Electronic Attack Ship / Combat Recon)
//     and add the hulls to the modules' canFitShipType lists instead.
//   - pyfa's Penitence keeps 115 m signature and 330 mm scan resolution, left over from the placeholder
//     hull that function defined before (the "Cybele"); the info
//     window screenshot says 140 m and 300 mm, which is what we use.

export const PRERELEASE_TYPE_IDS = new Set();

const HERALD = 990001, PENITENCE = 990002;

// A third Assault Frigates bonus attribute. The Herald has three AF bonuses (optimal, damage, armor
// resists) and CCP's Assault Frigates skill scales only two hull attributes (673/675), so this one is
// new, and the skill gets a matching prescale effect below.
const ATTR_AF3 = 990001;

// New effects. 990100 is the skill prescale; the rest are hull bonuses with no existing equivalent.
const EFF_AF3_PRESCALE = 990100;
const EFF_AF_ARMOR_RESISTS = 990101;   // Herald: 4% all armor resists per Assault Frigates level
const EFF_AC_DRONE_RANGE = 990102;     // Penitence: +7500 m drone operation range per Amarr Cruiser level
const EFF_ROLE_ARMOR_RESISTS = 990103; // Penitence: 20% all armor resists (role)
const EFF_ROLE_WDFG_SIG = 990104;      // Penitence: 50% less WDFG signature penalty (role)

const ARMOR_RESONANCES = [267, 268, 269, 270];
const shipMod = (modified, modifying) =>
  ({ domain: 'shipID', func: 'ItemModifier', modifiedAttributeID: modified, modifyingAttributeID: modifying, operation: 6 });

const NEW_EFFECTS = {
  [EFF_AF3_PRESCALE]: { c: 0, m: [{ domain: 'shipID', func: 'ItemModifier', modifiedAttributeID: ATTR_AF3, modifyingAttributeID: 280, operation: 0 }] },
  [EFF_AF_ARMOR_RESISTS]: { c: 0, m: ARMOR_RESONANCES.map(r => shipMod(r, ATTR_AF3)) },
  // Same shape as the Ishtar's droneControlDistance bonus (effect 1084), on shipBonusAC3.
  [EFF_AC_DRONE_RANGE]: { c: 0, m: [{ domain: 'charID', func: 'ItemModifier', modifiedAttributeID: 458, modifyingAttributeID: 2070, operation: 2 }] },
  [EFF_ROLE_ARMOR_RESISTS]: { c: 0, m: ARMOR_RESONANCES.map(r => shipMod(r, 2298)) },
  [EFF_ROLE_WDFG_SIG]: { c: 0, m: [{ domain: 'shipID', func: 'LocationGroupModifier', groupID: 899, modifiedAttributeID: 554, modifyingAttributeID: 2299, operation: 6 }] },
};

// Resonance = 1 - resist. Kinetic/explosive come from the info window's EHP figures, which pin the
// half-percent the rounded resist bars hide (shield 4,907.87 / 2,730 HP means explosive is 87.5%).
const resonances = ({ shield, armor }) => ({
  271: shield.em, 274: shield.th, 273: shield.kin, 272: shield.exp,
  267: armor.em, 270: armor.th, 269: armor.kin, 268: armor.exp,
});

const SHIPS = [
  {
    id: HERALD, name: 'Herald', base: 11190 /* Sentinel */, g: 893, gn: 'Electronic Attack Ship',
    rs: ['Amarr Frigate', 'Electronic Attack Ships', 'Assault Frigates'],
    drop: [1249, 2069], // the Sentinel's neut/nos bonus attributes
    a: {
      4: 1010100, 9: 1100, 11: 69, 12: 5, 13: 5, 14: 2, 37: 420, 38: 165, 48: 222,
      55: 187000, 70: 3.3, 76: 69000, 101: 0, 102: 2, 161: 28100, 192: 7, 208: 21,
      263: 664, 265: 1337, 283: 60, 479: 625000, 482: 675, 552: 35, 564: 650, 600: 5,
      1132: 400, 1137: 2, 1154: 2, 1271: 20, 1547: 1, 2045: 0.5, 6364: 9000,
      182: 3331, 183: 28615, 184: 12095, 277: 5, 278: 1, 279: 1,
      ...resonances({ shield: { em: 1, th: 0.8, kin: 0.45, exp: 0.125 }, armor: { em: 0.5, th: 0.65, kin: 0.375, exp: 0.2 } }),
      673: 20,          // AF: small energy turret optimal range   (Retribution's effect 991)
      675: 40,          // AF: small energy turret damage           (Retribution's effect 1179)
      [ATTR_AF3]: -4,   // AF: all armor resistances                (new, 990101)
      1250: -5,         // EAS: capacitor recharge time             (Sentinel's effect 3466)
      485: 12.5,        // Amarr Frigate: weapon disruptor strength (Sentinel's effect 6354)
      464: -5,          // Amarr Frigate: small energy turret ROF   (Retribution's effect 7018)
      1803: -50,        // role: MWD signature penalty              (Retribution's effect 4902)
    },
    e: [991, 1179, EFF_AF_ARMOR_RESISTS, 3466, 6354, 7018, 4902],
    // Assault Damage Controls whitelist the Assault Frigate (324) and Combat Interceptor (358) groups.
    allow: t => t.g === 60 && /Assault Damage Control/.test(t.n),
    traits: {
      skills: [
        { header: 'Assault Frigates bonuses (per skill level):', bonuses: [
          { number: '20%', text: 'bonus to Small Energy Turret optimal range' },
          { number: '40%', text: 'bonus to Small Energy Turret damage' },
          { number: '4%', text: 'bonus to all armor resistances' }] },
        { header: 'Electronic Attack Ships bonuses (per skill level):', bonuses: [
          { number: '5%', text: 'reduction in ship capacitor recharge time' }] },
        { header: 'Amarr Frigate bonuses (per skill level):', bonuses: [
          { number: '12.5%', text: 'bonus to Weapon Disruptor effectiveness' },
          { number: '5%', text: 'bonus to Small Energy Turret rate of fire' }] },
      ],
      role: { header: 'Role Bonus:', bonuses: [
        { number: '50%', text: 'increase in capacitor warfare resistance' },
        { number: '50%', text: 'reduction in Microwarpdrive signature radius penalty' },
        { text: '• Can fit Assault Damage Controls' }] },
      desc: 'His Justice is Swift and Decisive. His Tolerance is Limited.\n– The Scriptures, Book I, The Code of Demeanor\n\nEmpress Catiz Tash-Murkon watched closely as the Caldari awarded vessels surrounded by controversy and accusations of pirate-connections for Alliance Tournament XXI.',
    },
  },
  {
    id: PENITENCE, name: 'Penitence', base: 20125 /* Curse */, g: 906, gn: 'Combat Recon Ship',
    rs: ['Amarr Cruiser', 'Recon Ships', 'Heavy Interdiction Cruisers'],
    drop: [],
    a: {
      4: 11810000, 9: 2400, 11: 1450, 12: 7, 13: 6, 14: 5, 37: 230, 38: 475, 48: 460,
      55: 360000, 70: 0.48, 76: 110500, 101: 4, 102: 2, 161: 118000, 192: 10, 208: 28,
      263: 2730, 265: 3540, 283: 300, 479: 1250000, 482: 3800, 552: 140, 564: 300, 600: 4,
      1132: 400, 1137: 2, 1154: 2, 1271: 50, 1547: 2, 2045: 1, 6364: 11500,
      182: 3335, 183: 22761, 184: 28609, 277: 5, 278: 1, 279: 1,
      ...resonances({ shield: { em: 1, th: 0.8, kin: 0.3, exp: 0.125 }, armor: { em: 0.5, th: 0.65, kin: 0.375, exp: 0.2 } }),
      962: 50,          // Recon: nos/neut optimal range  (Curse's effects 6230/6234)
      1537: 30,         // Recon: nos/neut falloff        (Curse's effects 6233/6238)
      963: 40,          // Recon: nos/neut drain amount   (Curse's effects 1910/2305)
      1247: 10,         // HIC: WDFG range                (the HICs' effect 3468)
      478: 10,          // Amarr Cruiser: weapon disruptor strength (Curse's effect 6395)
      656: 25,          // Amarr Cruiser: drone HP and damage       (Curse's effects 2181/2189)
      2070: 7500,       // Amarr Cruiser: drone operation range     (new, 990102)
      2298: -20,        // role: all armor resistances              (new, 990103)
      2043: 12.5,       // role: drone microwarp velocity           (Prophecy's effect 6176)
      2299: -50,        // role: WDFG signature penalty             (new, 990104)
    },
    e: [6230, 6234, 6233, 6238, 1910, 2305, 3468, 6395, 2181, 2189,
        EFF_AC_DRONE_RANGE, EFF_ROLE_ARMOR_RESISTS, 6176, EFF_ROLE_WDFG_SIG],
    // Warp Disruption Field Generators whitelist Heavy Interdictors (894) only; the plain Cynosural
    // Field Generator I takes Force Recons, Black Ops and HICs. Covert and Industrial cynos are left
    // alone: the role bonus names the Cynosural Field Generator, and a combat recon has no covert cloak.
    allow: t => t.g === 899 || t.n === 'Cynosural Field Generator I',
    traits: {
      skills: [
        { header: 'Recon Ships bonuses (per skill level):', bonuses: [
          { number: '50%', text: 'bonus to Energy Nosferatu and Energy Neutralizer optimal range' },
          { number: '30%', text: 'bonus to Energy Nosferatu and Energy Neutralizer falloff range' },
          { number: '40%', text: 'bonus to Energy Nosferatu and Energy Neutralizer drain amount' }] },
        { header: 'Heavy Interdiction Cruisers bonuses (per skill level):', bonuses: [
          { number: '10%', text: 'bonus to Warp Disruption Field Generator range' }] },
        { header: 'Amarr Cruiser bonuses (per skill level):', bonuses: [
          { number: '10%', text: 'bonus to Weapon Disruptor effectiveness' },
          { number: '25%', text: 'bonus to Drone hitpoints and damage' },
          { number: '7500m', text: 'bonus to Drone operation range' }] },
      ],
      role: { header: 'Role Bonus:', bonuses: [
        { text: '• Cannot be detected by directional scanners' },
        { text: '• Can fit Warp Disruption Field Generator and Cynosural Field Generator modules' },
        { number: '20%', text: 'bonus to all armor resistances' },
        { number: '12.5%', text: 'bonus to Drone microwarp velocity' },
        { number: '50%', text: 'reduction to signature radius penalty from Warp Disruption Field Generator' }] },
      desc: 'Always must we strive to show him our worth.\nFor we are the Chosen.\n– The Scriptures, Book of Reclaiming 4:45\n\nEmpress Catiz Tash-Murkon watched closely as the Caldari awarded vessels surrounded by controversy and accusations of pirate-connections for Alliance Tournament XXI.',
    },
  },
];

// One literal on purpose: check-suite-deps reads `from '…'` as an import, so a string ending in the
// word "from" followed by a `+` continuation trips it.
export const PRERELEASE_NOTICE = 'PRE-RELEASE: CCP has shown this ship but not shipped it yet. Its stats and bonuses come off CCP\'s preview screenshots, so expect them to change when it goes live.';

// Trait entries for core.js to merge into shipTraits, filled in by applyPrereleaseShips() for the
// hulls it actually added.
export const PRERELEASE_TRAITS = {};

// canFitShipType1..12. Not consecutive: CCP added them in batches.
const CAN_FIT_TYPE_IDS = [1302, 1303, 1304, 1305, 1944, 2103, 2463, 2486, 2487, 2488, 2758, 5948];

/** Mutates the raw dogma bundles. Must run before initEngine() converts attribute IDs to names. */
export function applyPrereleaseShips(types, effects, attrs) {
  const taken = new Set(Object.values(types).map(t => t.n));
  const live = SHIPS.filter(s => !taken.has(s.name) && types[s.base]);
  if (!live.length) return [];

  Object.assign(effects, NEW_EFFECTS);
  attrs[ATTR_AF3] = { n: 'prereleaseEliteBonusGunship3', s: 1, h: 1, d: 0 };
  const af = Object.values(types).find(t => t.n === 'Assault Frigates' && t.c === 16);
  if (af) af.e = [...(af.e ?? []), EFF_AF3_PRESCALE];

  for (const s of live) {
    const base = types[s.base];
    const a = { ...base.a, ...s.a };
    for (const k of s.drop) delete a[k];
    types[s.id] = { n: s.name, g: s.g, gn: s.gn, c: 6, a, e: s.e, rs: s.rs, mg: 4, ml: base.ml };
    PRERELEASE_TYPE_IDS.add(s.id);
    PRERELEASE_NAMES.add(s.name);
    PRERELEASE_TRAITS[s.id] = { ...s.traits, desc: `${PRERELEASE_NOTICE}\n\n${s.traits.desc}` };

    // Fitting allowances: add the hull to the first free canFitShipTypeN on each whitelisted module.
    for (const t of Object.values(types)) {
      if (t.c !== 7 || !t.a || !s.allow(t)) continue;
      const free = CAN_FIT_TYPE_IDS.find(k => t.a[k] == null);
      if (free != null) t.a = { ...t.a, [free]: s.id };
    }
  }
  return live.map(s => s.name);
}

const PRERELEASE_NAMES = new Set();
/** True for a hull added here, by typeID or by name (the fit library and browser rows hold names). */
export const isPrereleaseShip = idOrName =>
  PRERELEASE_TYPE_IDS.has(Number(idOrName)) || PRERELEASE_NAMES.has(idOrName);
