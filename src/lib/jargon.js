// Module search shorthands, ported from pyfa's service/jargon/defaults.yaml.
// Each key maps to an array of pre-compiled RegExp patterns (OR'd together).
// jargonSearch() splits the query on spaces; each token that matches a key is
// expanded to its patterns. A module passes if it satisfies every token.

const J = (/** @type {string[]} */ ...pats) => pats.map(p => new RegExp(p, 'i'));

export const JARGON = {
  // Generic
  t1:   J('t1', ' I$'),
  t2:   J('t2', ' II$'),
  mk:   J('mk', 'mark'),
  std:  J('std', 'standard'),
  scan: J('scan', 'probe launcher'),

  // Sizes
  sml:  J('sml', 'small'),
  hvy:  J('hvy', 'heavy'),
  lrg:  J('lrg', 'large'),
  xl:   J('xl', 'x-large'),

  // British/American variants
  armour:       J('armour', 'armor'),
  neutraliser:  J('neutraliser', 'neutralizer', 'neutralization', 'ev-\\d00'),
  stabiliser:   J('stabiliser', 'stabilizer'),
  energised:    J('energised', 'energized'),
  economiser:   J('economiser', 'economizer'),

  // Damage types
  em:        J('em', 'mjolnir (.+ )?(missile|rocket|torpedo)', 'electromagnetic', 'electron bomb'),
  therm:     J('therm', 'inferno (.+ )?(missile|rocket|torpedo)', 'plasma smartbomb', 'scorch bomb'),
  thermal:   J('thermal', 'inferno (.+ )?(missile|rocket|torpedo)', 'plasma smartbomb', 'scorch bomb'),
  kin:       J('kin', 'scourge (.+ )?(missile|rocket|torpedo)', 'concussion bomb'),
  kinet:     J('kinet', 'scourge (.+ )?(missile|rocket|torpedo)', 'concussion bomb'),
  kinetic:   J('kinetic', 'scourge (.+ )?(missile|rocket|torpedo)', 'concussion bomb'),
  exp:       J('exp', 'nova (.+ )?(missile|rocket|torpedo)', 'proton smartbomb', 'shrapnel bomb'),
  expl:      J('expl', 'nova (.+ )?(missile|rocket|torpedo)', 'proton smartbomb', 'shrapnel bomb'),
  explo:     J('explo', 'nova (.+ )?(missile|rocket|torpedo)', 'proton smartbomb', 'shrapnel bomb'),
  explosive: J('explosive', 'nova (.+ )?(missile|rocket|torpedo)', 'proton smartbomb', 'shrapnel bomb'),

  // Races / faction prefixes
  cn:  J('(^| )cn', 'caldari navy'),
  rf:  J('(^| )rf', 'republic fleet'),
  fn:  J('(^| )fn', 'federation navy'),
  ts:  J('(^| )ts', 'true sansha', 'titanium sabot'),
  db:  J('(^| )db', 'dark blood'),
  dg:  J('(^| )dg', 'dread guristas'),
  ss:  J('(^| )ss', 'shadow serpentis'),

  // Weapons
  ac:    J('ac', 'autocannon'),
  arty:  J('arty', 'artillery'),
  ml:    J('ml', 'missile (launcher|bay)'),
  rl:    J('rl', 'rocket (launcher|bay)'),
  lml:   J('lml', '(?<!rapid )light missile (launcher|bay)'),
  rlml:  J('rlml', 'rapid light missile (launcher|bay)'),
  haml:  J('haml', 'heavy assault missile (launcher|bay)'),
  hml:   J('hml', '(?<!rapid )heavy missile (launcher|bay)'),
  rhml:  J('rhml', 'rapid heavy missile (launcher|bay)'),
  tl:    J('(^| )tl', '(?<!rapid )(?<!XL )torpedo (launcher|bay)', 'remote tracking computer', '(optimal range|tracking speed) script'),
  cml:   J('cml', '(?<!xl )cruise (missile )?(launcher|bay)'),
  rtl:   J('rtl', 'rapid torpedo (launcher|bay)', 'remote tracking computer', '(optimal range|tracking speed) script'),
  xlcml: J('xlcml', 'xl cruise missile (launcher|bay)'),
  xltl:  J('xltl', 'xl torpedo (launcher|bay)'),
  dd:    J('dd', 'doomsday', 'lance$', 'reaper', 'bosonic', 'arcing vorton projector'),
  doomsday: J('doomsday', 'lance$', 'reaper', 'bosonic', 'arcing vorton projector'),
  gtfo:  J('gravitational transportation field oscillator'),
  panic: J('pulse activated nexus invulnerability core'),
  sb:    J('sb', 'smartbomb', '(?<!remote )shield booster', '(?<!remote )sensor booster', '(targeting range|scan resolution|eccm) script'),
  disco: J('disco', 'smartbomb'),
  sbomb: J('sbomb', 'smartbomb'),
  pdb:   J('pdb', 'point defense battery'),
  haw:   J('haw', 'quad 800mm repeating cannon', 'triple neutron blaster cannon', 'quad mega pulse laser', 'rapid torpedo (launcher|bay)'),

  // Weapon upgrades
  gs:      J('(^| )gs', 'gyrostabilizer'),
  magstab: J('magstab', 'magnetic field stabilizer'),
  mfs:     J('mfs', 'magnetic field stabilizer'),
  ms:      J('(^| )ms', 'magnetic field stabilizer'),
  hs:      J('hs', 'heat sink'),
  heatsink: J('heatsink', 'heat sink'),
  radsink: J('radsink', 'entropic radiation sink'),
  rs:      J('(^| )rs', 'entropic radiation sink'),
  bcs:     J('bcs', 'ballistic control system'),
  bcu:     J('bcu', 'ballistic control system'),
  vts:     J('vts', 'vorton tuning system'),
  tc:      J('tc', '(?<!remote )tracking computer', '(optimal range|tracking speed) script'),
  rtc:     J('rtc', 'remote tracking computer', '(optimal range|tracking speed) script'),
  mgc:     J('mgc', 'missile guidance computer', 'missile (precision|range) script'),
  mge:     J('mge', 'missile guidance enhancer'),
  siege:   J('siege', 'bastion module', 'industrial core', 'triage module'),

  // Drone upgrades
  dda:  J('dda', 'drone damage amplifier'),
  dla:  J('dla', 'drone link augmentor'),
  dnc:  J('dnc', 'drone navigation computer'),
  fsu:  J('fsu', 'fighter support unit'),
  dte:  J('dte', 'omnidirectional tracking enhancer'),
  ote:  J('(^| )ote', 'omnidirectional tracking enhancer'),
  odte: J('odte', 'omnidirectional tracking enhancer'),
  dtl:  J('dtl', 'omnidirectional tracking link', '(optimal range|tracking speed) script'),
  otl:  J('otl', 'omnidirectional tracking link', '(optimal range|tracking speed) script'),
  odtl: J('odtl', 'omnidirectional tracking link', '(optimal range|tracking speed) script'),
  dtc:  J('dtc', 'omnidirectional tracking link', '(optimal range|tracking speed) script'),
  otc:  J('otc', 'omnidirectional tracking link', '(optimal range|tracking speed) script'),
  odtc: J('odtc', 'omnidirectional tracking link', '(optimal range|tracking speed) script'),
  mlu:  J('mlu', '(mining laser|harvester) upgrade'),

  // Remote repair
  rr:    J('(^| )rr', 'remote shield booster', 'remote (armor|hull) repairer', 'maintenance bot'),
  srr:   J('srr', 'small (.+ )?remote shield booster', 'small (.+ )?remote (armor|hull) repairer', 'light (.+ )?maintenance bot'),
  mrr:   J('mrr', 'medium (.+ )?remote shield booster', 'medium (.+ )?remote (armor|hull) repairer', 'heavy mutadaptive (.+ )?remote armor repairer', 'medium (.+ )?maintenance bot'),
  lrr:   J('lrr', 'large (.+ )?remote shield booster', 'large (.+ )?remote (armor|hull) repairer', 'heavy (.+ )?maintenance bot'),
  crr:   J('crr', 'capital (.+ )?remote shield booster', 'capital (.+ )?remote (armor|hull) repairer'),
  rsb:   J('rsb', 'remote shield booster', 'shield maintenance bot', 'remote sensor booster', '(targeting range|scan resolution|eccm) script'),
  srsb:  J('srsb', 'small (.+ )?remote shield booster', 'light shield maintenance bot'),
  mrsb:  J('mrsb', 'medium (.+ )?remote shield booster', 'medium shield maintenance bot'),
  lrsb:  J('lrsb', 'large (.+ )?remote shield booster', 'heavy shield maintenance bot'),
  crsb:  J('crsb', 'capital (.+ )?remote shield booster'),
  rasb:  J('rasb', 'ancillary remote shield booster'),
  srasb: J('srasb', 'small ancillary remote shield booster'),
  mrasb: J('mrasb', 'medium ancillary remote shield booster'),
  lrasb: J('lrasb', 'large ancillary remote shield booster'),
  crasb: J('crasb', 'capital ancillary remote shield booster'),
  arsb:  J('arsb', 'ancillary remote shield booster'),
  sarsb: J('sarsb', 'small ancillary remote shield booster'),
  marsb: J('marsb', 'medium ancillary remote shield booster'),
  larsb: J('larsb', 'large ancillary remote shield booster'),
  carsb: J('carsb', 'capital ancillary remote shield booster'),
  rar:   J('rar', 'remote armor repairer'),
  srar:  J('srar', 'small (.+ )?remote armor repairer', 'light (.+ )?armor maintenance bot'),
  mrar:  J('mrar', 'medium (.+ )?remote armor repairer', 'heavy mutadaptive (.+ )?remote armor repairer', 'medium (.+ )?armor maintenance bot'),
  lrar:  J('lrar', 'large (.+ )?remote armor repairer', 'heavy (.+ )?armor maintenance bot'),
  crar:  J('crar', 'capital (.+ )?remote armor repairer'),
  raar:  J('raar', 'ancillary remote armor repairer'),
  sraar: J('sraar', 'small ancillary remote armor repairer'),
  mraar: J('mraar', 'medium ancillary remote armor repairer'),
  lraar: J('lraar', 'large ancillary remote armor repairer'),
  craar: J('craar', 'capital ancillary remote armor repairer'),
  et:    J('(^| )et', 'remote capacitor transmitter'),
  set:   J('(^| )set', 'small (.+ )?remote capacitor transmitter'),
  met:   J('(^| )met', 'medium (.+ )?remote capacitor transmitter'),
  'let': J('(^| )let', 'large (.+ )?remote capacitor transmitter'),
  cet:   J('cet', 'capital (.+ )?remote capacitor transmitter'),
  ret:   J('(^| )ret', 'remote capacitor transmitter'),
  sret:  J('sret', 'small (.+ )?remote capacitor transmitter'),
  mret:  J('mret', 'medium (.+ )?remote capacitor transmitter'),
  lret:  J('lret', 'large (.+ )?remote capacitor transmitter'),
  cret:  J('cret', 'capital (.+ )?remote capacitor transmitter'),
  rct:   J('rct', 'remote capacitor transmitter'),
  srct:  J('srct', 'small (.+ )?remote capacitor transmitter'),
  mrct:  J('mrct', 'medium (.+ )?remote capacitor transmitter'),
  lrct:  J('lrct', 'large (.+ )?remote capacitor transmitter'),
  crct:  J('crct', 'capital (.+ )?remote capacitor transmitter'),

  // Shield modules
  sse:   J('(^| )sse', 'small (.+ )?shield extender'),
  mse:   J('mse', 'medium (.+ )?shield extender'),
  lse:   J('(^| )lse', 'large (.+ )?shield extender'),
  cse:   J('cse', 'capital (.+ )?shield extender'),
  aif:   J('aif', 'multispectrum shield hardener'),
  inv:   J('inv', 'multispectrum shield hardener'),
  invul: J('invul', 'multispectrum shield hardener'),
  invuln: J('invuln', 'multispectrum shield hardener'),
  invulnerability: J('invulnerability', 'multispectrum shield hardener'),
  ssb:   J('ssb', 'small (.+ )?(?<!remote )shield booster'),
  msb:   J('msb', 'medium (.+ )?(?<!remote )shield booster'),
  lsb:   J('lsb', '(?<!x-)large (.+ )?(?<!remote )shield booster'),
  xlsb:  J('xlsb', 'x-large (.+ )?(?<!remote )shield booster'),
  csb:   J('csb', 'capital (.+ )?(?<!remote )shield booster'),
  asb:   J('asb', 'ancillary shield booster'),
  sasb:  J('sasb', 'small ancillary (.+ )?(?<!remote )shield booster'),
  masb:  J('masb', 'medium ancillary (.+ )?(?<!remote )shield booster'),
  lasb:  J('lasb', '(?<!x-)large ancillary (.+ )?(?<!remote )shield booster'),
  xlasb: J('xlasb', 'x-large ancillary (.+ )?(?<!remote )shield booster'),
  casb:  J('casb', 'capital ancillary (.+ )?(?<!remote )shield booster'),
  sba:   J('sba', 'shield boost amplifier'),
  spr:   J('spr', 'shield power relay'),
  shieldrech: J('shieldrech', 'shield recharger'),
  anti:  J('anti', '(shield|armor) reinforcer'),
  'anti-': J('anti-', '(shield|armor) reinforcer'),

  // Armor modules
  eanm:  J('eanm', 'multispectrum energized membrane'),
  enam:  J('enam', 'multispectrum energized membrane'),
  mem:   J('mem', 'multispectrum energized membrane'),
  anp:   J('anp', 'multispectrum coating'),
  mc:    J('mc', 'multispectrum coating'),
  plating: J('plating', 'coating'),
  rah:   J('rah', 'reactive armor hardener'),
  sar:   J('(^| )sar', 'small (.+ )?(?<!remote )armor repairer'),
  lar:   J('lar', 'large (.+ )?(?<!remote )armor repairer'),
  car:   J('car', 'capital (.+ )?(?<!remote )armor repairer'),
  aar:   J('aar', 'ancillary (.+ )?(?<!remote )armor repairer'),
  saar:  J('saar', 'small ancillary (.+ )?(?<!remote )armor repairer'),
  maar:  J('maar', 'medium ancillary (.+ )?(?<!remote )armor repairer'),
  laar:  J('laar', 'large ancillary (.+ )?(?<!remote )armor repairer'),
  caar:  J('caar', 'capital ancillary (.+ )?(?<!remote )armor repairer'),

  // Hull modules
  dc:   J('dc', '(?<!assault )damage control'),
  dcu:  J('dcu', '(?<!assault )damage control'),
  adc:  J('adc', 'assault damage control'),
  adcu: J('adcu', 'assault damage control'),
  ehe:  J('ehe', 'emergency hull energizer'),
  cehe: J('cehe', 'capital (.+ )?emergency hull energizer'),

  // Propulsion
  ab:    J('(^| )ab', 'afterburner'),
  mwd:   J('mwd', 'microwarpdrive'),
  mjd:   J('mjd', 'micro jump drive', 'micro jump field generator', 'micro jump unit'),
  mmjd:  J('mmjd', 'medium micro jump drive'),
  lmjd:  J('lmjd', 'large micro jump drive'),
  mjfg:  J('mjfg', 'micro jump field generator'),
  boosh: J('boosh', 'micro jump field generator'),
  od:    J('(^| )od', 'overdrive injector'),
  odi:   J('(^| )odi', 'overdrive injector'),
  istab: J('istab', 'inertial stabilizer'),
  wcs:   J('wcs', 'warp core stabilizer'),
  wstab: J('wstab', 'warp core stabilizer'),
  jde:   J('jde', 'jump drive economizer'),
  zpme:  J('zpme', 'zero-point mass entangler'),
  srs:   J('srs', 'signature radius suppressor'),

  // Tackling
  point:     J('(^| )point', '(?<!mobile small )(?<!mobile medium )(?<!mobile large )warp disruptor'),
  ws:        J('ws', '(?<!heavy )warp scrambler'),
  hwd:       J('hwd', 'heavy warp disruptor'),
  hws:       J('hws', 'heavy warp scrambler'),
  scram:     J('scram', 'warp scrambler'),
  wdfg:      J('wdfg', 'warp disruption field generator', '^focused warp disruption script', '^focused warp scrambling script'),
  infinipoint: J('infinipoint', 'warp disruption field generator', '^focused warp disruption script', '^focused warp scrambling script'),
  infiniscram: J('infiniscram', 'warp disruption field generator', '^focused warp disruption script', '^focused warp scrambling script'),
  bubble:    J('bubble', 'interdiction sphere launcher', 'warp disrupt probe', 'warp disruption field generator', 'warp disruption (.+ )?projector', 'mobile (.+ )?warp disruptor'),
  webifier:  J('webifier', 'grappler', 'sw-\\d00'),
  wub:       J('wub', 'stasis webification probe', 'interdiction sphere launcher'),
  wubble:    J('wubble', 'stasis webification probe', 'interdiction sphere launcher'),
  web:       J('web', 'grappler', 'sw-\\d00'),
  sw:        J('sw', 'stasis webifier', 'stasis grappler'),
  sg:        J('sg', 'stasis grappler'),

  // Neutralization
  neut:       J('neutralizer', 'neutralization', 'ev-\\d00', 'void bomb'),
  neutralizer: J('neutralizer', 'neutralization', 'ev-\\d00'),

  // ECM
  ecm:    J('ecm', 'jammer', 'ec-\\d00', 'lockbreaker bomb'),
  jam:    J('jam', 'ecm', 'ec-\\d00', 'lockbreaker bomb'),
  jamm:   J('jamm', 'ecm', 'ec-\\d00', 'lockbreaker bomb'),
  jammer: J('jammer', 'ecm', 'ec-\\d00'),
  amarr:  J('amarr', 'radar'),
  caldari: J('caldari', 'gravimetric'),
  gallente: J('gallente', 'magnetometric'),
  minmatar: J('minmatar', 'ladar'),
  yellow: J('yellow', 'radar'),
  blue:   J('blue', 'gravimetric'),
  green:  J('green', 'magnetometric'),
  red:    J('red', 'ladar'),
  sda:    J('sda', 'signal distortion amplifier'),

  // Dampeners
  dampener: J('dampener', 'sd-\\d00', '(targeting range|scan resolution) dampening script'),
  damp:     J('damp', 'sd-\\d00'),
  sd:       J('(^| )sd', 'sensor dampener', '(targeting range|scan resolution) dampening script'),
  rsd:      J('rsd', 'sensor dampener', 'sd-\\d00', '(targeting range|scan resolution) dampening script'),

  // Weapon disruption
  td: J('td', 'tracking disrupt', 'weapon disrupt', '(optimal range|tracking speed) disruption script'),
  gd: J('gd', 'guidance disrupt', 'weapon disrupt', 'missile (precision|range) disruption script'),
  wd: J('wd', 'weapon disrupt', 'tracking disrupt', 'guidance disrupt', 'td-\\d00', '(?<!mobile small )(?<!mobile medium )(?<!mobile large )(?<!heavy )warp disruptor'),

  // Target painting
  tp:      J('(^| )tp', 'target painter', 'target illumination', 'tp-\\d00'),
  paint:   J('paint', 'target illumination'),
  painter: J('painter', 'target illumination'),

  // Power/cap upgrades
  cpr:      J('cpr', 'capacitor power relay'),
  caprelay: J('caprelay', 'capacitor power relay'),
  caprech:  J('caprech', 'cap recharger'),
  pds:      J('pds', 'power diagnostic system', 'point defense battery'),
  pdu:      J('pdu', 'power diagnostic system'),
  rcu:      J('rcu', 'reactor control unit'),
  rcs:      J('rcs', 'reactor control unit'),
  mapc:     J('mapc', 'micro auxiliary power core'),
  cb:       J('cb', 'capacitor booster', 'command burst'),
  inj:      J('inj', 'capacitor booster'),
  injector: J('injector', 'capacitor booster'),

  // Electronics/sensor upgrades
  coproc:  J('coproc', 'co-proc'),
  sebo:    J('sebo', '(?<!remote )sensor booster', '(targeting range|scan resolution|eccm) script'),
  rsebo:   J('rsebo', 'remote sensor booster', '(targeting range|scan resolution|eccm) script'),
  resebo:  J('resebo', 'remote sensor booster', '(targeting range|scan resolution|eccm) script'),
  nsa:     J('nsa', 'networked sensor array'),
  isa:     J('isa', 'integrated sensor array'),
  sigamp:  J('sigamp', 'signal amplifier'),
  eccm:    J('eccm', '(?<!remote )sensor booster', 'signal amplifier'),
  reccm:   J('reccm', 'remote sensor booster', 'eccm script'),

  // Rigs
  acr:  J('acr', 'ancillary current router'),
  ccc:  J('ccc', 'capacitor control circuit'),
  smc:  J('smc', 'semiconductor memory cell'),
  cdfe: J('cdfe', 'core defense field extender'),
  cdos: J('cdos', 'core defense operational solidifier'),
  cp:   J('cp', 'command processor'),
  ats:  J('ats', 'auto targeting system'),

  // Implant grades
  lg: J('lg', 'low-grade'),
  mg: J('mg', 'mid-grade'),
  hg: J('hg', 'high-grade'),
  slave: J('slave', 'amulet'),

  // Ammo
  lm:   J('(^| )lm', 'light missile'),
  hm:   J('(^| )hm', 'heavy missile'),
  ham:  J('(^| )ham', 'heavy assault missile'),
  cm:   J('(^| )cm', 'cruise missile'),
  fof:  J('fof', 'auto-targeting (.+ )?missile'),
  gbomb: J('gbomb', 'guided bomb'),
  ir:   J('(^| )ir', 'infrared'),
  mw:   J('mw', 'microwave'),
  uw:   J('uw', 'microwave'),
  uv:   J('(^| )uv', 'ultraviolet'),
  'x-ray': J('x-ray', 'xray'),
  mf:   J('mf', 'multifrequency'),
  am:   J('(^| )am', 'antimatter'),
  cl:   J('(^| )cl', 'carbonized lead'),
  du:   J('(^| )du', 'depleted uranium'),
  pp:   J('(^| )pp', 'phased plasma'),
  fvb:  J('fvb', 'focused void bomb'),
  flex: J('flex', 'resistance script'),
  charge: J('charge', 'cap booster \\d+'),
  stick:  J('stick', 'cap booster \\d+'),
  ncb:  J('ncb', 'navy cap booster \\d+'),
  nrp:  J('nrp', 'nanite repair paste'),
  np:   J('(^| )np', 'nanite repair paste'),
  lo:   J('(^| )lo', 'liquid ozone'),

  // Deployables
  mju:  J('mju', 'micro jump unit'),
  mmju: J('mmju', 'mobile micro jump unit'),
  ess:  J('encounter surveillance system'),
  mtu:  J('mtu', 'mobile tractor unit'),
};

// ── Matching and ranking ────────────────────────────────────────────────────────
// Two things live here beyond the jargon table above, and both exist because filtering alone is not
// a search. The table decides IF a name matches; nothing decided what order matches came back in, so
// results arrived in market-tree order — which put ten Omnidirectional Tracking Links above the plain
// Tracking Computer for the query "tracking".

// Word initials: "Omen Navy Issue" -> "oni", "Tracking Enhancer II" -> "tei". This is how a player
// actually types a hull name (ONI, RSI, TFI), and it is the ONLY reason "te" can find a Tracking
// Enhancer at all — the letters `te` appear nowhere in that name, so no substring match exists.
export function initialsOf(name) {
  return String(name ?? "").split(/[^a-z0-9]+/i).filter(Boolean).map(w => w[0].toLowerCase()).join("");
}

const isAlnum = (c) => (c >= "a" && c <= "z") || (c >= "0" && c <= "9");

// Does `needle` occur in `hay` at the start of a word? "tracking" starts a word in "Remote Tracking
// Computer" but not in "Retracking". Hand-rolled rather than a \b regex so the query needs no
// escaping — a query is user input and may hold regex metacharacters.
function atWordStart(hay, needle) {
  let i = hay.indexOf(needle);
  while (i >= 0) {
    if (i === 0 || !isAlnum(hay[i - 1])) return true;
    i = hay.indexOf(needle, i + 1);
  }
  return false;
}

// An initialism is only inferred for SHORT alphabetic tokens. "tracking" as initials would be a
// 8-word name, which no item has, so allowing it would only ever add noise.
const MIN_INITIALISM = 2, MAX_INITIALISM = 5;
const isInitialismToken = (tok) => tok.length >= MIN_INITIALISM && tok.length <= MAX_INITIALISM && /^[a-z]+$/.test(tok);

// A jargon key's EXPANSION beats an incidental literal hit. `ac` means autocannon, but the letters
// "ac" appear nowhere in "AutoCannon" — they do appear in "Hostile Target Acquisition", which
// literal scoring rates a word-start match. Without this, ranking buried the autocannons at 158th
// in their own search. Patterns whose source IS the token are the literal half of the entry and are
// deliberately not counted, or every `ac` substring would score the same as the real expansion.
// A match in the MIDDLE of a word is only honoured for longer queries. It has to exist at all: EVE is
// full of compound words and players type the second half — every one of the 70 hits for "burner" is
// mid-word in "Afterburner", so without it that search returns nothing, and "cannon" would miss every
// AutoCannon. But at two letters it is all noise: "te" matched 939 modules, 930 of them incidental
// (Compressor, Fighter Support Unit, Setele's), which is the pile the plain Tracking Enhancer was
// buried under. Four is where the two stop overlapping — every real query measured keeps its full
// result set, and no shorter string that only ever occurs mid-word is one a player would type.
const MIN_MIDWORD = 4;
const literalMatch = (name, tok) =>
  atWordStart(name, tok) || (tok.length >= MIN_MIDWORD && name.includes(tok));

const EXPANSION = 700;
function expansionScore(name, query) {
  const entry = JARGON[query];
  if (!entry) return 0;
  return entry.some((re) => re.source !== query && re.test(name)) ? EXPANSION : 0;
}

// Relevance, highest first. The tiers are deliberately coarse and gap-separated: within a tier the
// caller breaks ties on name LENGTH, which is what floats "Tracking Computer I" above "Unit
// D-34343's Modified Tracking Computer" without needing to know anything about meta levels.
export function searchScore(name, query) {
  const n = String(name ?? "").toLowerCase();
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return 0;
  if (n === q) return 1000;                                     // exact
  if (n.startsWith(q)) return 800;                              // "tracking" -> Tracking Computer
  const jargonHit = expansionScore(n, q);                       // "ac" -> AutoCannon
  if (jargonHit) return jargonHit;
  if (atWordStart(n, q)) return 600;                            // -> Remote Tracking Computer
  if (initialsOf(name).startsWith(q.replace(/\s+/g, ""))) return 500;  // "te" -> Tracking Enhancer
  if (n.includes(q)) return 300;                                // "cannon" -> AutoCannon (mid-word)
  return 100;                                                   // matched via jargon / another token
}

export function rankByRelevance(names, query, nameOf = (x) => x) {
  return names
    .map((x, i) => ({ x, i, s: searchScore(nameOf(x), query) }))
    .sort((a, b) => b.s - a.s || String(nameOf(a.x)).length - String(nameOf(b.x)).length || a.i - b.i)
    .map((r) => r.x);
}

// True if `name` satisfies every token: each is a jargon expansion, else a literal substring OR an
// initialism. Used directly for ships (which have no jargon table of their own).
export function nameMatchesQuery(name, query) {
  const tokens = String(query ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  const lower = String(name).toLowerCase();
  return tokens.every((tok) => {
    const entry = JARGON[tok];
    // A jargon entry pairs curated EXPANSIONS with the literal token itself. The expansions are
    // trusted as written, but that literal half is an unanchored regex and so bypassed the mid-word
    // gate — /ac/i matched "Tr[ac]tor Beam". It is just a literal token, so it obeys the same rule.
    if (entry) return entry.some((re) => (re.source === tok ? literalMatch(lower, tok) : re.test(name)));
    return literalMatch(lower, tok)
        || (isInitialismToken(tok) && initialsOf(name).startsWith(tok));
  });
}

// Returns mods matching the query, MOST RELEVANT FIRST, or null if the query is empty.
export function jargonSearch(query, mods) {
  if (!String(query ?? "").trim()) return null;
  return rankByRelevance(mods.filter((m) => nameMatchesQuery(m.name, query)), query, (m) => m.name);
}
