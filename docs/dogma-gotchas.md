# Dogma engine gotchas — full detail

> Referenced from the top-level `CLAUDE.md` "Hard-won gotchas" index. That index has a one-line
> summary of each item below; read this file when you're actually touching the relevant code, not
> as background reading.

## Numbered gotchas

1. **`numShots` is not a stored attribute.** Clip size = `floor(capacity / (chargeVolume × chargeRate))`.
   Reading `get('numShots')` returns 0, which silently disables the reload-time DPS penalty and the
   damage-over-time graph's reload gaps. Use `clipSizeOf()` in `calc.js`.

2. **Booster (drug) bonuses are their own stacking group** — unpenalised against modules. Passive
   resist bonuses from boosters must be applied with `direct=true`.

3. **The RAH adapts to POST-command-burst resonances.** Command bursts are applied in `calc.js` after
   the engine runs, so a fit with both an active RAH *and* an armor-resonance burst needs a second
   `calculate()` pass with `fit._rahArmorBurstEff` set. `calc.js` then skips its own buff-13
   application to avoid double-counting. The RAH algorithm itself is correct and chaotically sensitive
   to its inputs — if the RAH split is wrong, the *inputs* are wrong, not the algorithm.

   **RAH em/kin ~2pp splits on Triglavian/AT hulls vs the oracle are a float tie-break artifact, NOT a
   bug — do not chase them.** Ikitursa/Draugur/Nergal carry base armor resonances `0.5/0.25/0.75/0.35`.
   Under the oracle's forced UNIFORM 25/25/25/25 pattern, the em:exp resonance ratio 0.3375:0.23625 is
   exactly 10:7, and the RAH settles at a 0.7 multiplier — so at the steady state em and exp take
   *mathematically equal* damage. That exact tie is then resolved by sub-ULP dust in the ship's computed
   resonance: our stacking math yields `armorExplosiveDamageResonance = 0.23625000000000002` (dust
   *above* 0.23625) while eos yields `0.23624999999999996` (dust *below*). Same IEEE-754 double, opposite
   last bit → the stable sort orders em/exp oppositely → our RAH converges to em/kin `0.745/0.655`, eos
   to `0.71/0.71`. The RAH loop is byte-identical between our JS and eos's Python (verified standalone);
   the divergence is purely the resonance input's final ULP, which no two independent engines will match.
   Neither value is "more correct." Real (non-uniform) damage profiles don't hit the exact tie, so this
   never surfaces in-app. Confirmed 2026-07-18; the scale convention (we feed pattern fractions `0.25`,
   eos feeds raw amounts `25`) is irrelevant here — the tie is scale-invariant.

4. **Beam-type super weapons tick.** Lancer lances, titan Reapers and the Bosonic Field Generator deal
   damage every `doomsdayDamageCycleTime` for `doomsdayDamageDuration` — so their em/th/kin/exp attrs
   are damage **per tick**, and DPS = `perTick × ticks / duration`. Volley is **one tick** (that's what
   pyfa shows). Titan doomsdays and all smartbombs have no tick attrs → 1 tick, unchanged.

5. **Group modifiers can target a CHARGE's group, not the module's.** The Minokawa's Force Auxiliary
   C5 bonus (+20%/level cap booster strength) is a `LocationGroupModifier` on group **87 = Capacitor
   Booster *Charge***, modifying `capacitorBonus` — an attribute that only exists on the charge (the
   module is group 76). `LocationGroupModifier` therefore applies to modules **and their loaded
   charges**. Anything reading a charge attribute must read the *engine-computed* charge, not the raw
   type data, or hull bonuses are ignored.

6. **Attributes have default values.** `getBase()` on an attribute a type doesn't carry returns the
   attribute's *default*, not 0. `shieldHpBonus` defaults to **1**, which silently added a phantom +1%
   for the Nirvana Omega (which doesn't carry the attribute). When filtering set members, test for
   attribute **presence** (`'attr' in type.a`), not just a truthy value.

7. **Validate through `calcFitStats`, not the raw `Fit` engine.** `calcFitStats` defaults every
   unset skill to level V. A raw `Fit` harness that loops over skill types can miss some (e.g. Caldari
   Tactical Destroyer defaulting to 1 → wrong reload), producing numbers that look like engine bugs.

8. **`ships.json`'s `hullClass` is wrong for 64 hulls, and its `race` for 116.** It files the Crow
   under "Tactical Destroyer", the Cenotaph under plain "Battlecruiser", and the Draugur — a
   Triglavian Command Destroyer — as an **"Unknown Attack Battlecruiser"**, which is what a user
   reported seeing in the fit header. Use CCP's group name from the type data (`TYPES[typeID].gn`)
   as the authoritative hull class and `classifyHull()` (`lib/ship-taxonomy.js`) for the race.

   `lookupShip()` derives both, via `hullIdentity()`, so the header subtitle and the ship browser
   cannot describe the same hull differently. The hardcoded `SHIPS_BY_CLASS` table that used to
   patch `hullClass` here is **deleted** — it was itself stale (it filed the Bifrost and Stork, both
   Command Destroyers, as "Flag Cruisers") and it only ever covered a couple of dozen hulls.
   **Do not reintroduce a hand-listed class table.** Regression section 14b sweeps every hull.

9. **`data-bundle.js`'s `meta` strings are wrong** — faction/storyline/deadspace/officer modules all
   came through as "T2". Meta group is derived from CCP's `metaGroupID` (shipped as `mg` on every type
   in `dogma-types.json`); see `metaOf()` in `App.jsx`. Never trust the bundle's `meta` field.

9b. **`data-bundle.js`'s `shipsByClass` is also incomplete — and `mg` and `raceID` are the WRONG
    signals for classifying a hull.** Three traps, all found building the nested ship browser
    (`src/lib/ship-taxonomy.js`, 2026-08-06):
    - `shipsByClass` has **zero** entries for `Command Carrier` and `Lancer Dreadnought` — four live
      hulls each. `core.js` backfills the ship *list* from `TYPES` for exactly this reason, but the
      bundle rows are still the only place `raceID` lives, so anything keyed on `raceID` silently
      drops those eight hulls. Build from `TYPES` (`t.gn` = CCP's group name) and derive the rest.
    - **TIER comes from the required skill; RACE comes from `factionID`.** `t.rs` holds skill
      **NAMES**, not IDs (easy to misread — a naive `TYPES[id].n` lookup on them "works" by falling
      through to a not-found branch). The skills distinguish a **navy** hull (one racial skill) from
      a **pirate** one (**two** — the Machariel needs Minmatar + Gallente BS), and that is all they
      are good for. They do **not** tell you who built the hull: the Vendetta requires "Gallente
      Carrier" but is Serpentis, the Python and the Marshal require no racial skill at all, and
      nothing in the Outrider's skill list mentions ORE. `invtypes.factionID` is authoritative and
      is emitted to `src/data/ship-factions.json` by `build-bundle.py` (so it refreshes on an
      eve.db upgrade). `FACTION_BUCKET` maps it; unmapped factions fall back to the skill race.
    - **"Special edition" is CCP's own MARKET group, not a guess from the name.** `invmarketgroups`
      has `Ships / Special Edition Ships` (marketGroupID **1612**); `build-bundle.py` walks the
      parent chain and emits `s:1`. Two cases fold in: a hull with **no** marketGroupID at all (not
      sold anywhere → an event prize; among ships that is exactly the Stratios Emergency Responder),
      and a Shuttle with metaGroupID 3/4 (CCP files Goru's and the Guristas shuttle under "Faction
      Shuttles", but they are the same unbuyable novelty — the four racial shuttles carry
      metaGroupID 1 or nothing, so this splits them without naming a hull).
      **The flag alone is NOT the routing rule.** It also covers ~35 Alliance Tournament hulls (Utu,
      Chremoas, Adrestia, Skua…), and those must stay in their functional class — an AT Assault
      Frigate is fitted as an Assault Frigate. `SPECIAL_EDITION_CLASS` lists only the groups where a
      special hull has no natural home (the base size classes + Shuttle/Corvette), so the redirect
      catches the Echelon and the Guardian-Vexor without gutting the T2 lists.
    - **`data-bundle.js`'s `raceIcons` keys are NOT SDE raceIDs.** It ships eight icons keyed
      1/2/4/8/16/32/135/512, and **135 is ORE's gold hexagon while 512 is the Triglavian red
      glyph** — confirmed by decoding the PNGs, not by reading the keys. Taking them for raceIDs
      (ORE=128, Triglavian=135) put the ORE logo on every Triglavian category and left ORE with no
      icon. There is no icon for CONCORD, EDENCOM, Upwell or Pirate Faction; those fall back to the
      generic ship glyph. The suite asserts every mapped key actually exists in the bundle.
    - **`mg` (metaGroupID) is absent on plain T1 hulls.** The Rokh, Hyperion, Abaddon and Maelstrom
      carry no `mg` at all, so the faction test must be `mg === 4`, never `mg === 1` for "standard".

    The taxonomy is derived, never hand-listed, so the failure mode is a hull quietly falling out of
    the tree and becoming unreachable in the UI. Regression section 14 asserts total coverage
    (every fittable hull reachable exactly once) rather than specific counts, so an eve.db upgrade
    that adds hulls passes as long as they land somewhere.

10. **Structures need character skills applied to their FITTED MODULES but never to their own hull
    stats, and `domain='structureID'` is NOT a projected/ignorable domain** — three real engine bugs
    caught when structure support was added (2026-08-01), all confirmed against eos directly
    (`scripts/oracle/oracle.py astrahus_empty` / `astrahus_service_only` / `azbel_missile_test`):
    - Our "all-5 reference character" was applying Hull Upgrades/Shield Management/Mechanics' +25%
      ship-hull bonus to a structure's armorHP/shieldCapacity/hp. Structures are corp-owned assets,
      not personally piloted — no skill should touch the structure's OWN hull attributes. **First
      fix attempt (wrong): skip the entire skill pass for structures.** That over-corrected — see
      next point — and was replaced with a precise guard in `_applyEffect`'s `ItemModifier` branch:
      skip only when `domain==='shipID'` AND the source is a skill (`skillLevel != null`) AND the
      fit's ship is a structure. `LocationModifier`/`LocationGroupModifier`/`LocationRequiredSkillModifier`
      skill effects (which target FITTED MODULES/CHARGES, not the hull) are untouched by this guard.
    - The reason the broad "skip everything" fix was wrong: **skills DO enhance modules/charges
      fitted to a structure** — e.g. "Structure Missile Systems" boosts a structure missile
      launcher's charge damage exactly like Warhead Upgrades does for a ship (Effect6396,
      `LocationGroupModifier`, filtered by the CHARGE's group name). Skipping the whole pass made
      every structure-fitted weapon read 0 DPS or understated DPS. Caught on a real user fit (an
      Azbel with Standup Multirole Missile Launchers): weaponDps came out 133.33 instead of pyfa's
      146.7. The structure-only "operation" skills (**Structure Missile Systems**, **Structure
      Electronic Systems**, **Structure Engineering Systems**, **Structure Doomsday Operation** —
      the structure equivalents of Warhead Upgrades and the cap-cost-reduction skills, boosting
      missile/EWAR/energy-neutralizer/doomsday modules respectively) weren't in `SKILL_DEFAULTS` at
      all — this app was ship-only until structures were added, so nobody had added them. Also
      explained a "slight cap delta discrepancy" the user reported on the same fit — Structure
      Electronic/Engineering Systems reduce `capacitorNeed` on the fitted ECM/energy-neutralizer
      modules, which our cap-delta calc had never seen.
    - `domain='structureID'` was lumped in with `targetID`/`target` ("projected onto an external
      target — ignore") because no structure effect had ever been exercised before. It's actually
      the Structure-category equivalent of `domain='shipID'` — self-reference, not a remote target.
      This silently dropped Effect7008/7009, the pair that implements structures' **Full/Low Power
      State**: a structure's base hull attributes are its *Low Power* stats, and having any Service
      Slot module fitted (`online`, doesn't need to be "active") force-multiplies shieldCapacity
      and armorHP by that specific service module's own `serviceModuleFullPowerStateHitpointMultiplier`
      (4x for every service module — hull HP is unaffected either way). It's ALSO
      what Effect6396 (Structure Missile Systems, above) and its Electronic/Engineering/Doomsday
      siblings use to reach fitted modules/charges — same remap, same reason. Fixed by remapping
      `structureID`→`shipID` in `_applyEffect`, but only when the fit's own ship is itself a
      structure (a ship fit could theoretically carry a genuine remote `structureID` reference,
      which must stay ignored).
    - **Diagnostic technique worth keeping**: when a discrepancy is skill-shaped (present at "all
      skills V", absent at "no skills") but no specific skill you'd guess changes it, don't guess
      further — enumerate every skill on a level-5 `Character` and re-test with each individually
      zeroed (`scripts/oracle/` — build a level-5 `Fit`, then `Skill(character, item, level=0)` +
      `character.addSkill(...)` per candidate, diff the result) until the one that moves the number
      turns up. That's how "Structure Missile Systems" — not on anyone's list of suspects — was
      found in minutes instead of guessed at for an hour. (Note: overriding an ALREADY-level-5
      default skill down to a LOWER level via `addSkill` doesn't reliably re-trigger recalculation
      the same way a whole fresh `Character(name, level)` does — trust the "vary the whole
      character's level" result over a single skill's override result if they ever disagree.)
    - **System security scales structure RIG bonuses and is a FIT PARAMETER.** Structure rigs carry
      `hiSecModifier`/`lowSecModifier`/`nullSecModifier`; CCP has the client write the applicable one
      into `securityModifier`, which effect 6672 then PostMuls into every rig bonus attribute. Our
      bundle ships `securityModifier` frozen at its hisec value of 1, so `Fit.calculate()` sets it
      from `Fit.systemSecurity` (defaulting to **nullsec**, matching eos's `Fit.getSystemSecurity`).
      Surfaced in the UI as a Hi/Low/Null/W-C selector on structure fits only, stored as
      `slots.systemSecurity` (so it persists and is covered by undo for free). The same rig is 20%
      weaker in hisec — an Astrahus sensor rig gives scanRes 115 there vs 130 elsewhere.
    - **`canFitShipType`/`canFitShipGroup` applies to structures exactly as it does to ships** —
      eos runs the same `Fit.canFit` for both. A short/"incomplete-looking" whitelist is real game
      data, not corrupt data: Standup Market Hub I omits Astrahus/Raitaru/Athanor because a market
      genuinely requires a medium-or-larger structure, and Standup Metenox Moon Drill lists exactly
      one legal hull. Reading that as "this data isn't shaped for structures" and skipping the check
      (which is what `checkFitRestriction` did at first) makes every structure module fit every
      structure. It also silently produced an **illegal regression fixture** — the Astrahus
      full-power baseline was a Market Hub on an Astrahus, which computed the right number for the
      wrong fit (every service module carries the same 4x multiplier, so the error was invisible);
      it now uses Standup Cloning Center I. eos enforces a second, separate rule alongside it:
      structure modules (category 66) only on structures, ship modules (category 7) only on ships.
    - **Structure charges require NO skills, and that is load-bearing for missile RANGE.** This is
      the exact mirror image of the DPS bug above, and the two pull in opposite directions — do not
      "unify" them. Every personal missile range bonus in eos (the **Missile Projection** and
      **Missile Bombardment** skills, Missile Guidance Computers/Enhancers, Hydraulic Bay Thruster
      and Rocket Fuel Cache rigs, Zainou 'Deadeye' implants, the Antipharmakon Toxot booster, the
      Hydra implant set) is gated on `mod.charge.requiresSkill('Missile Launcher Operation')` —
      every one of those handlers uses that identical predicate. Standup missiles have an **empty
      `rs`**, so none of them apply: an Azbel's Standup Light Missile flies its base 95 s at its
      base 15 km/s. `calc.js` applied the two skills unconditionally, multiplying velocity *and*
      flight time by 1.5 → 3195 km against pyfa's 1417.5 km. Fixed with the `gate()` helper at the
      `velMult`/`flightMult` combination in `calc.js`, keyed on the pre-existing `reqMLO`. Bombs,
      Defender Missiles and probes also lack the requirement and are correctly excluded too.
    - See `src/regression.test.mjs`'s "10. ASTRAHUS" and "11. AZBEL" sections for the validated
      baselines (9.0M EHP low-power / 29.25M EHP full-power; 146.7 weaponDps / 440 volley;
      1417.5 km missile range).

11. **Fighters never enter the dogma engine, so their skills are applied BY HAND — with the levels
    read from the pilot and gated on the fighter requiring the skill.** `calc.js` composes a
    fighter's multipliers analytically (section 9b), and it got both halves wrong for a long time:

    - A single `lvl = 5` stood in for Fighters, Drone Interfacing, the racial Fighter Specialization,
      Heavy Fighters, Drone Navigation and Drone Durability. That is exactly right for the all-V
      default and wrong for every other pilot, so **no baseline in the suite could ever have caught
      it** — a character synced from ESI at Drone Interfacing IV still read fighter DPS as if at V.
      Use `fit.getSkillLevel('<EVE skill name>')`, which is the same API the AoE-skill pass uses.
    - eos gates **every** fighter bonus on `mod.item.requiresSkill(...)`, and a **Standup (structure)
      fighter's required-skill list is EMPTY** — the same rule as structure charges taking no missile
      skills (gotcha 10). Ungated, a Sotiyo's Standup Templar II read 1042 DPS against eos's 555.8,
      exactly the ×1.875 that Fighters V and Drone Interfacing V add.

    The racial specialization is **named by the fighter** (`Firbolg II` → `Gallente Fighter
    Specialization`), so read whichever one it asks for rather than inferring "T2 and light" from the
    name. Only T2 *light* fighters carry one, which is why that proxy worked, but it cannot tell you
    the level of the right racial skill. Pinned in `regression.test.mjs` section 18; found by the
    skill sweep, not by a fit diff, for the reason in the "SKILL sweep" section of `docs/oracle.md`.

## Two different sets of skills — don't conflate them

`SKILL_DEFAULTS` (~167) is the set the **dogma engine reads**: train these and your numbers change.
It is NOT the set of skills a fit **requires**. ~316 more skills appear only as `requiredSkillN` on
fittable types — Jury Rigging (on 279 rigs), the racial frigate/cruiser skills, Tactical Shield
Manipulation — and no dogma effect reads any of them, which is exactly why they were never in
`SKILL_DEFAULTS`.

`SKILL_CATALOG` in `calc.js` is the union (357, collision-free keys), built at module load from
`SKILL_DEFAULTS` ∪ every `requiredSkillN` reference. It drives both the Settings → Skills panel and
`checkFitSkills()` (the green/red book in the fit header). A requirement check built from
`SKILL_DEFAULTS` alone would call almost every fit flyable, so the regression suite asserts that
**every** requirement reference resolves to a catalog entry.

Two things that are easy to get wrong here:

- **Charges carry requirements too, and the strictest wins.** A Heavy Missile Launcher II needs
  Missile Launcher Operation IV, but Scourge Fury Heavy Missile needs it at V — so the fit needs V.
  Checking modules without their loaded ammo understates the requirement by a level.
- **Unset skills count as V**, matching `calcFitStats`. A fresh install has no skills configured; if
  absent meant 0, every fit would show red on first launch.

`SKILL_CATALOG` also back-fills `SKILL_CAMEL_TO_PYFA` for its derived keys, so a level set on a
requirement-only skill actually reaches the engine instead of falling through to the all-V default.

## Per-fit pilot (`slots.pilot`) — one resolver, and it must stay the only one

A fit can name whose skills it is flown with: `slots.pilot` is `"allV"`, `"alpha"`, `"me"` or
`"esi:<characterId>"`, absent meaning "the app-wide sheet". `resolvePilotSkills()` in `src/lib/pilot.js`
is the **only** place that decision is made, and it is deliberately pure and esi-free (`calc.js` and
the regression suite import it; `esi.js` touches `localStorage` and `fetch`) — the per-character skill
cache is passed in. It is written at sync time to `axis_esi_skills`; an `esi:` pilot that has never
synced falls back rather than guessing, because a character connected on another device has no entry.

Three things here are load-bearing:

- **`fallback` is the caller's, not `appSkills`.** They are different questions: "no pilot named"
  resolves to the app sheet in the app and to all V in a headless caller, while an unresolvable
  `esi:` pilot must never quietly borrow *your* skills.
- **A projection/command SOURCE fit resolves through the SAME resolver with the SAME fallback as the
  fit being edited**, so a saved fit reads identically whether you are editing it or projecting it.
  An earlier build gave source fits their own all-V fallback ("it's someone else's ship"); that is
  **not** the behaviour — the skills a fit was last edited under are the skills it keeps.
- **The Effects tab is handed App.jsx's own `sourceSkills` resolver** rather than computing its own.
  The card and the applied value diverging is a real bug this project has already shipped once: the
  burst applied at the local sheet while the card beside it was hardcoded to all V, and a Vargur
  under Sleipnir links read 141.9k EHP against pyfa's 146k with the card still saying 22.5%. They
  agreed only while every skill was unset (and so defaulted to V). Pinned in section 13l.

**No storage migration, and `SCHEMA_VERSION` stays where it is.** `pilot` is optional exactly like
`pilotSec` / `tactical` / `systemSecurity` / `environment`, none of which have one. Absent is a
permanent, meaningful state — also true of every brand-new fit — not a legacy shape. Stamping
`pilot:null` would be a no-op; stamping `"me"` would silently change how every existing fit projects.

## ⚠️ T3D tactical modes are `published=0` — and the generator filtered on `published`

All 18 "Ship Modifiers" (group **1306**) — the items that carry a T3 destroyer's mode bonuses — are
unpublished, because they are not items you own. `build-bundle.py`'s `fit_types` filter required
`published==1`, so **none of them could ever enter the bundle**; the 12 that were in it were legacy
entries predating the generator, and every mode CCP has added since was silently missing. The filter
now admits group 1306 by ID (`MODE_GROUP`).

Two bugs had grown over that gap, both of the "special case that hides a data problem" shape:

- `calc.js` proxied the **Skua** to the *Jackdaw's* modes (`MODE_PROXY`), on the stated belief that
  the Skua ships no modes of its own. It ships three (90060/90062/90064). A Propulsion Skua read
  `maxSpeed` 2303 against eos's 2729.
- The **Anhinga's** mode bonuses were hand-transcribed into an `ANHINGA_MODES` table — every value in
  which was exactly `1/<the mode's own PostDiv attribute>`.

Seven of the modes' effects ship EMPTY (5560, 12767, 12794, 12795, 12796, 12798, 12799); they are now
in `scripts/data-patches.json`, mirroring pyfa's handlers. Lock range, agility and launcher RoF come
from the engine; **missile velocity and flight time still have to be applied in `calc.js`**, because
this file reads charge attributes RAW and builds its own multiplier chain — an engine-applied charge
modifier is invisible to it. Same split as `SHIP_MISSILE_DMG` (below).

**An attribute being present does NOT mean its effect applies.** The Skua's Sharpshooter mode still
carries a vestigial `modeMaxRangePostDiv = 0.6` from before CCP split that bonus into two per-skill
ones, but it does **not** carry effect **6076** — so eos ignores the attribute entirely. Keying the
mode-bonus table off attribute presence applied a phantom second multiplier and put a Sharpshooter
Skua's rockets at 47 km against eos's 35 km. `MODE_MISSILE_VEL` is keyed by **effect ID**, and the
attribute is only read once that effect is confirmed present on the mode.

## Stacking groups (this bit is subtle)

Two rules, both established against pyfa and both load-bearing:

1. **PostMul (op4) and PostPercent (op6) share ONE stacking group per attribute.** They compete for
   the same slots. PreMul (op0) keeps its own group — folding it in as well regresses the Astarte's
   armor resists, the Bane's DPS and the Minokawa's EHP.

   Evidence: a Salvation with an active Integrated Sensor Array (op4 ×12 on `maxTargetRange`) plus an
   Information Command Burst (op6 +42%) must give **6457 km**. The multiplier takes slot 1 and the
   burst slot 2 (×0.8691). Penalising each operation in its own pool gave the burst full strength and
   produced 6718 km.

2. **Mode modules (Siege / Triage / Bastion) are ROLE bonuses and are NOT stacking-penalised**
   (`MODE_MODULE_GROUPS` in `dogma-engine.js`). Without this exemption, rule 1 makes a Bane's Siege
   rate-of-fire bonus compete with its Ballistic Control Systems and DPS falls from 13301 to 12695.

   The Capital Sensor Array is deliberately **not** exempt — its multiplier *is* penalised, which is
   precisely what produces the 6457 km above.

   **Exception, and it is per-module not per-group: only BASTION's rate-of-fire bonus joins eos's
   `'postPerc'` penalty group.** Siege's RoF passes no `stackingPenalties` flag at all (defaults
   False → unpenalised); Effect6658's two Bastion RoF boosts explicitly pass
   `penaltyGroup='postPerc'`. Those, plus overload RoF (Effect3001), are the *only* three uses of
   `'postPerc'` in all of eos — grep for it. We used to put every mode module's `speed` bonus there,
   which is invisible with one member and wrong with two: sieged **and** overheated, siege and
   overload penalised each other and the overload's −15% arrived as −13.04%
   (`= −15% × exp(−1/7.1289)`), costing a Phoenix Navy Issue 2.2% of its DPS *with volley matching
   exactly* — the classic "divisor is wrong" signature.

Both rules are covered by the regression suite. Changing either will break real fits.

## Implant sets — FIVE exist, all use the FULL product (incl. Omega)

`Asklepian` (armor rep), `Nirvana` (shield HP), `Amulet` (armor HP), `Mimesis` (entropic
disintegrator SPOOL) and `Savior` (remote-rep CYCLE TIME) all follow the same shape: each member carries a bonus attr, and a
set-multiplier effect (PreMul on that attr, domain=charID) which the dispatcher SKIPS. Each needs a
custom handler in `dogma-engine.js` applying the FULL set product including Omega (1.1^5 x 1.25 =
2.0131 for the first three; Mid-grade Mimesis is 1.2^5 x 1.6 = 3.981312).

If a fit's tank/EHP is low by roughly 10-13%, suspect a set with no handler. Amulet was missing
entirely — a Revelation Navy Issue came out at 4.49M EHP instead of pyfa's 5.07M.

> **History, kept short because it's tempting to "fix" this again:** an earlier version of this file
> warned that Asklepian excluded Omega from its product while Nirvana included it. That asymmetry was
> never a real mechanic — it was compensating for a phantom `Republic Defense Booster II` (typeID
> 93055, since pruned) with a bogus `armorRepairBonus: 6` that happened to cancel the missing Omega
> multiplier. With the phantom pruned, all five sets use the same full-product rule above. Two errors
> were cancelling each other out; don't reintroduce the asymmetry from an old commit.

**Mimesis is the odd one out and shows the failure looks different when the target isn't the ship.**
It boosts MODULES, not the hull: members carry `damageMultiplierBonusMaxModifier` and
`damageMultiplierBonusPerCycleModifier`, which effects 7232/7233 apply to Precursor Weapons (group
1986) — how far an entropic disintegrator's spool ramps, and how fast. Those two effects DO carry
modifiers, so the un-amplified bonus was applying all along and only the ×3.98 amplification was
missing; the symptom was full-spool DPS 20% low (a Draugur at 388.8 against eos's 490.6) with
*unspooled* DPS matching exactly. If spooled and unspooled disagree about whether they're correct,
look here.

`Savior` is the second module-targeting set. Members carry `remoteRepDurationCapBonus`, which effect
8018 applies to the duration and capacitorNeed of anything requiring Remote Armor Repair Systems or
Shield Emission Systems — so remote reps cycle FASTER. As with Mimesis, only the multiplier
(Effect8017, domain=charID) was missing: a projected Nestor's Large Remote Armor Repairer II read
141.62 HP/s against eos's 157.28.

### A set amplifies the MEMBER'S bonus attribute, and it must run EARLY

Every implant set — the five above and the generic ones (Snake, Genolution, Thukker, Blood Raider,
ORE, Mordu's, warp-speed) handled by `_amplifyImplantSets` — works the same way in pyfa: the set
effect is a `filteredItemMultiply` over the *other implants'* bonus attributes
(`cpuOutputBonus2 *= implantSetChristmas`), marked `runTime='early'`, and it never touches the ship.
It is the member's own ordinary effect (485/490/...) that carries the already-amplified bonus across.

The generic sets used to be handled after the effect pass, which left only one option: apply the
difference (`raw × product − raw`) as a *second* modifier on the ship attribute. **A second op6
compounds — it does not combine.** A Genolution CA-2 is +1.5% CPU at a set product of 3.276, so pyfa
gives one `+4.914%` while we gave `1.015 × 1.03414`, and a Curse read 498.58 tf of CPU output against
pyfa's 498.34. Under a percent, invisible everywhere except the fitting bar, where it decides whether
the last module fits. Pinned in `regression.test.mjs` section 12i (also the suite's first
mutated-module baseline).

If you add a set, amplify the bonus attr on the implant before step 3 — never patch the ship after.

## ⚠️ Incoming remote reps have DIMINISHING RETURNS

Remote reps do not add up linearly — eos's `Fit.__getAppliedRr` scales each source down as the total
climbs, per layer (hull/armor/shield independently). `applyRemoteRepDiminishing` in `calc.js` ports
it. Two details are load-bearing and look like typos if you skim: the curve divides by the cycle time
**truncated to whole seconds**, but the final term divides by the **exact** cycle. eos even comments
on it ("for considerations of RR diminishing returns cycle time is rounded this way").

Below a few thousand HP/s the multiplier is ~1, which is why single-logi fits never showed it. A
Leshak under 14 projected Large Remote Armor Repairer IIs gets ×0.951217 — 3455.77 HP/s rather than
the naive 3633.0.

## `computeProjectedReps` must build the SOURCE as completely as `calcFitStats` does

Three separate bugs, all the same shape: the projection source was built without something the fit
under test would have had. Its **tactical mode** (a Defense-mode Confessor reps ×4/3), its **T3
cruiser subsystems** (a logi Loki's Offensive - Support Processor strengthens the Shield Command
Burst that shortens its remote boosters' cycle), and its **ancillary paste multiplier** (×3, which
the LOCAL path already applied). If a projected source's output is a clean fraction low, check what
the source fit is missing before suspecting the rep maths.

When adding one, filter members on attribute PRESENCE (`'attr' in type.a`), not on a truthy value:
attributes have defaults, and Omega (which carries no bonus attr) will otherwise read back the default
and inject a phantom bonus.

## Environment effects (the system a fit is sitting in)

Wormhole class effects, metaliminal storms and event beacons live in group **920 "Effect Beacon"**
(category 2, Celestial) — so no `CATS` filter was ever going to admit them; `build-bundle.py` now
takes the group by ID, like `MODE_GROUP`. CCP ships **no modifierInfo** for any of them, so they
arrive inert and are driven from `src/data/system-effects.json`, generated from pyfa's ~100
hand-written handlers by `scripts/build-system-effects.py` and interpreted by `_applyEnvironment()`.

Stored on the fit as `slots.environment` (a NAME, so it survives a bundle regeneration), which also
gets persistence and undo for free.

**They run EARLY — before module effects.** pyfa marks every one `runTime='early'` and that is
load-bearing: the overload effects boost attributes (`overloadHardeningBonus` and friends) that a
module's OWN overload effect reads in the module pass. Applied afterwards, the module has already
consumed the un-boosted value — a Lachesis in a C6 Red Giant read 84.2% armor explosive resist
against eos's 92.3.

**The generator must fail loudly, not skip.** An environment effect that quietly does nothing is
this project's recurring failure mode, so `build-system-effects.py` refuses to write while anything
is unparsed. Getting to zero needed four passes: attribute-presence filters
(`'heatDamage' in mod.itemModifiedAttributes`, how every overload effect selects its modules),
`lambda x: True`, loop-unrolling for `.format()`/f-string attribute names, and a `.format()` arg
that is itself a call (`damage.capitalize()` — `[^)]*` stops at the inner paren and breaks argument
splitting entirely). Four effects (3698, 3794–3796, generic NPC "dungeon" beacons) are left inert
**because pyfa does not implement them either** — matching pyfa is the point.

`check-effect-coverage.mjs` knows about the table, so the ~100 beacon effects do not need to be
blanket-accepted into the empty-effect baseline; anything the table does not cover still shows up.

## ⚠️ Pilot-security bonuses must NOT also sit in `SHIP_MISSILE_DMG`

A few hulls (Sidewinder & kin) scale a damage bonus by the pilot's *negative* security status:
magnitude is `ATFrigDmgBonus × sec`, not the raw attribute. Effect **12165** was listed in
`SHIP_MISSILE_DMG` *as well as* in the dedicated pilot-sec block in `calc.js`, so the raw −7.5% was
applied on top of the sec-scaled +75%: `1.75 × 0.925 = 1.61875`, and a −10.0 sec Sidewinder read
190.4 weapon DPS against eos's 205.8. `SHIP_MISSILE_DMG` is for bonuses whose magnitude *is* the
attribute; anything scaled by something else belongs only with its own handler.

## ⚠️ Charges modify their parent MODULE (domain "otherID")

Crystals/ammo carry effects with domain `otherID` — from a charge, "other" is its parent module. The
engine does NOT iterate charges as effect sources, so those effects are dead. Conflagration XL's
`capNeedBonus` (+25% cap, Effect804) is handled explicitly in the charge pass; if another
charge-modifies-module effect turns up, it needs the same treatment.

**Mining crystals are the second case (Effect1200, added 2026-08-14).** All three of its modifiers
are `otherID`: `specializationAsteroidYieldMultiplier` PostMuls the strip miner's `miningAmount`,
and the two `specializationCrystalMining…` attributes ModAdd onto its waste probability / wasted-volume
multiplier. pyfa uses `multiplyItemAttr`/`increaseItemAttr` with no stacking flag, so all three are
**unpenalised** (`direct=true`). The failure mode is the reason this sat broken: a crystal is roughly
half an exhumer's yield (a Modulated Strip Miner II is 120 m³/cycle bare, 216 with a T2 crystal), and
dropping it produces a plausible-looking small number rather than anything that reads as a bug.

## Hull damage/RoF/tank bonuses split across TWO code paths

Faction/navy hull bonuses (the 2026-07 navy destroyer batch is the worked example) land in one of two
places depending on WHICH attribute they modify — never guess, check where `calc.js` reads the number:

1. **Missile CHARGE damage** (`emDamage`/`kinDamage`…) → the `SHIP_MISSILE_DMG` table in `calc.js`.
   `calc.js` reads charge damage from RAW type data (`chargeProfile` reads `td.attrs`, not the engine),
   and the engine's `OwnerRequiredSkillModifier` can't reach a charge, so these bonuses must be applied
   in `calc.js`. Keyed by effect ID → `[bonusAttr, dmgTypes, skillFilterIndices]`.
2. **MODULE attributes** — turret `damageMultiplier` (64), missile RoF `speed` (51), `shieldBonus`
   (68) — → the engine via a `LocationRequiredSkillModifier` entry in `scripts/data-patches.json`.
   `calc.js` reads these engine-computed (`fitItem.get('damageMultiplier')` etc.), so a modifierInfo
   patch is enough. The `skillTypeID` in the patch is a module **filter**, not a level multiplier.

**Skill-prescaling gotcha (cost a session):** hull bonus attrs (`shipBonusGD2`…) are pre-scaled by the
racial destroyer skill (an `ItemModifier`, domain shipID, modifyingAttributeID 280=skillLevel, op0) so
that `fit.ship.get('shipBonusGD2')` already carries the full ×5 (level V) value before a hull effect
reads it. MD1/MD2 share the prescale effects 5282/5283, **but the newer MD3 (6089) and CD3 (6088) have
their OWN prescale effects (12816 on the Minmatar Destroyer skill, 12814 on Caldari) which CCP ships
EMPTY.** Without patching 12816, `shipBonusMD3` stayed ×1 and the Talwar Fleet's RoF bonus applied at
1/5 strength. If a *newer* hull-bonus attr reads at 1/5, look for a missing prescale effect.

## ⚠️ Phantom types — dead entries shadowing live ones

`build-bundle.py` prunes types that no longer exist in eve.db. It used to keep them ("harmless"), but
**274 dead types** were in the bundle and **35 of them shadowed a live type by name** — all seasonal
boosters. `typeIDByName` resolved to the dead entry, so fits silently used the wrong item's stats.

Symptoms this caused: the Asklepian rule above, and a Praxis whose shield/armor/hull resists were all
uniform because a phantom `Imperial Defense Booster II` had all four passive resists at −4 instead of
the real explosive −4 / kinetic −2.

## ⚠️ Booster bonuses: don't double-apply

The `B_PCT` table in `dogma-engine.js` applies booster bonuses whose dogma effect ships **empty**.
Whether an effect is empty varies per booster, so the handler now checks each booster's own effects
and skips anything already applied by the effect pass. The old hardcoded list was calibrated against
the phantom boosters (whose effects were empty); against clean data every non-resist entry
double-applied, which is what pushed the Astarte's scan resolution from 306 to 312.

## Testing landmine: `check()`'s tolerance is RELATIVE

`check()` in `regression.test.mjs` takes a RELATIVE tolerance. `check(g, l, actual, 63773.5, 1)`
means +/-100%, not +/-1. Four checks were written that way and passed against any number until a
deliberate revert-the-fix test exposed them. For a hard baseline use `1e-5`; for a 0/1 assertion
use `0`. **Always prove a new check has teeth by reverting the fix and watching it fail.**
