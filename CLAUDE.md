# Axis — EVE Online fitting calculator (mobile)

> **Renamed from "Vis Viva" / "Visviva" to "Axis".** Everything a user sees says Axis. Three things
> deliberately still say `visviva` and must NOT be "cleaned up":
>
> | Still `visviva` | Why |
> | --- | --- |
> | Bundle ID `com.rexmikakka.visviva` (Android `applicationId` + namespace, Java package, iOS bundle ID, `strings.xml` `package_name`/`custom_url_scheme`) | Permanent identity. Changing it makes Android treat the app as a brand-new install (no update path, all local data lost) and orphans the App Store Connect record, provisioning profile and TestFlight testers. Never user-visible. |
> | ESI deep link `eveauth-visviva://auth-callback` (`esi-config.js`, `AndroidManifest.xml`, `patch-ios-project.sh`) | Registered as a Callback URL on the EVE developer application. Changing it breaks ESI login until it is re-registered AND every install updates. Never user-visible. |
> | The GitHub repo / clone URL | Not renamed yet. |
>
> localStorage keys DID move `visviva_*` → `axis_*`, carried by storage migration **v1 → v2**
> (`lib/storage-migrate.js`). Saved fits were always `pyfa-*` and were untouched. Backup files now
> tag `"app": "axis"` but `isBackupApp()` still accepts `"visviva"`, so old backups restore.

A React + Vite ship-fitting calculator for EVE Online, targeting mobile. It implements EVE's dogma
system in JavaScript. **pyfa v2.68.0 with all skills at V is the reference implementation** — when our
numbers disagree with pyfa, we are wrong until proven otherwise.

---

## Before you change anything

```bash
npm run verify                    # the real gate: lint + imports + build + offline + effect coverage + regression
node src/regression.test.mjs      # just the suite — must print "ALL N REGRESSION CHECKS PASSED" (currently 993)
```

Every number in that suite was validated by hand against pyfa. Several took an entire session to pin
down. **If a check fails, you broke something real.** Do not update the expected values to match new
output unless you have re-validated against pyfa first and can say why the old number was wrong.

CI runs this on every PR (`.github/workflows/regression.yml`).

### A fresh clone

```bash
git clone https://github.com/rexmikakka-bit/visviva.git
cd visviva
npm install
npm test          # if this is not green on a clean checkout, stop and ask
npm run dev
```

That is the whole setup — `npm test` needs no build step and no local data files. The two optional
downloads below are **gitignored on purpose**: both are large, both are publicly downloadable, and
neither is needed to run, develop or test the app.

| command | what it does |
| --- | --- |
| `npm run dev` | dev server |
| `npm test` | the pyfa-validated fit baselines |
| `npm run check` | lint (runtime-fatal rules) + import-path resolution |
| `npm run build` | production build |
| `node scripts/check-effect-coverage.mjs` | fails if a data regen adds a new silent no-op effect |
| `npm run verify` | all of the above — the gate CI runs |

**A pyfa SOURCE checkout** is needed only by the oracle and by `bundle-icons.mjs` (see "Art is
bundled" below — it is no longer the art path). Take the source ZIP from
<https://github.com/pyfa-org/Pyfa>, extract to `Pyfa-master/`. Its version is enforced — see
"Driving pyfa's eos engine directly".

**`eve.db`** is needed only to regenerate the dogma bundles. It ships inside pyfa's **Windows release**
ZIP (a *different* download from the source above) at `app/eve.db`, from
<https://github.com/pyfa-org/Pyfa/releases>. Take the version the baselines were validated against.

You do **not** need `sqlite-latest.sqlite`, CCP's raw SDE dump. Nothing in this project reads it, and
pyfa's `eve.db` is a different, much more compact schema — see the note under the oracle section.

### Art is bundled, not fetched

Item and ship art is committed (~19.5 MB) so the app works fully offline and does not hammer anyone's
image CDN. Roughly 1,000 types have no art and fall back to a generic glyph; that is expected, not a
missing file.

`node scripts/fetch-art.mjs` regenerates icons/renders/type-icons from CCP's image server and needs
**no** local downloads — just a network. It is idempotent (it reads each file's real pixel width and
skips anything already at target), so a re-run after a CCP art drop costs only the new files.
`fetch-hero-renders.mjs` does the 256px info-sheet renders separately.

**`bundle-icons.mjs` is the OLD path and is superseded for resolution.** It copies from a pyfa
checkout, and pyfa's art is its ceiling: 32px icons and 64px renders, which testers reported as
blurry at the 26-30 CSS px the module rows draw them at (2x is already upscaling, 3x visibly soft).
The bundled art is now 64px icons / 128px renders / 128px type-icons, all from CCP. Keep the script:
it is the only thing that maps pyfa's graphicID-named render files onto typeIDs, and it works offline.

Two traps here:

- **Files under `renders/` and `hero-renders/` are JPEG bytes with a `.png` name.** CCP's render
  endpoint serves JPEG (the icon endpoint still serves PNG). The extension is kept so `icons.js`'s
  globs stay single-format, and browsers dispatch on content sniffing rather than the name.
  `hero-renders/` has been like this since it was created. Nothing is lost: pyfa's renders were
  colour type 2 (RGB, **no alpha**), so there was never transparency to preserve.
- **Icons are keyed by iconID; the image server is keyed by typeID.** 16,829 types share 2,419
  icons, so fetching per type would be ~97 MB of near-identical art. `fetch-art.mjs` fetches one
  representative type per iconID (falling through to siblings if it 400s) and saves `<iconID>.png`.

### Branch, don't push to main

Work on a branch and let CI run, unless the user has asked for something else in the moment (they
often do, and that is theirs to decide). `App.jsx`, `calc.js`, `ui.jsx` and the data bundles are the
files most likely to conflict — keep changes to them focused.

---

## Architecture

| File | Role |
| --- | --- |
| `src/dogma-engine.js` | The dogma engine: attribute pools, stacking penalties, effect dispatch, custom handlers. ~1570 lines. |
| `src/dogma-engine-init.js` | Loads the dogma bundles and calls `initEngine()`. Works in **both** Vite and Node. |
| `src/calc.js` | Turns a fit + engine output into displayed stats (DPS, tank, cap, resists, graph data). |
| `src/App.jsx` | State, effects and composition only (~620 lines). The views live in `src/components/`. |
| `src/ErrorBoundary.jsx` | React class boundary wrapping `<App>`. Catches render crashes and shows a recovery card (download-your-fits / reload / copy error report) instead of a blank page. Dependency-light on purpose so it survives whatever crashed. |
| `src/lib/storage-migrate.js` | Versioned localStorage migrations, run on boot **before** React reads state. Bump `SCHEMA_VERSION` + append a migration whenever the saved-fit shape changes — see note below. |
| `src/lib/ship-taxonomy.js` | The nested ship-browser menu (Battleships > Faction Battleships > Pirate Faction). Pure + derived — see "ship browser taxonomy" below. |
| `src/data/dogma-*.json` | The dogma bundle: types, effects, attributes. **Generated + hand-patched.** |
| `src/data/ship-traits.json` | Trait bonuses for Ships + Structures (with flavour description) and **T3 subsystems** (bonuses only — their description lives in `type-descriptions.json`, one source per string). **Generated** by `build-bundle.py` from eve.db's `invtraits`/`invtypes`; overrides `data-bundle.js`'s stale `shipTraits`. A T3 cruiser's real bonuses live on the SUBSYSTEM, not the hull, so `TRAIT_ONLY_CATS` matters. |
| `src/data/type-descriptions.json` | Item flavour text for the info panel (modules, charges, implants, drones, fighters, subsystems, deployables, **structure modules**). **Generated** by `build-bundle.py`. Lazy-imported — see the null-guard note below. |
| `src/data-bundle.js` | Legacy precomputed bundle (5.8 MB). Ship lists, module lists, meta labels. **Partly wrong — see below.** |

### How the engine works, briefly

`AttrMap` keeps separate pools per attribute: `_base`, `_add`, `_post0` (op0 PreMul, penalised),
`_post4` (op4 PostMul, penalised), `_post` (op6 PostPercent, penalised), `_mul` (direct/unpenalised)
and `_force`. `applyMod(attrID, op, value, direct)` routes to the penalised or unpenalised pool.
Stacking factor is `exp(-(rank²)/7.1289)`, strongest first.

`Fit.calculate()` resets all attributes at the top, so it is **idempotent** — safe to call twice.
(`calc.js` relies on this for the RAH two-pass; see below.)

Effects whose `modifierInfo` is empty in the bundle (`{"c":0,"m":[]}`) are CCP-applied effects that
were trimmed. They do nothing until someone populates the modifier or writes a custom handler.

### Changing the saved-fit shape → add a storage migration

Saved fits and settings live **only** in `pyfa-*` localStorage keys (see `backup-io.js`), with no
server. The day you change that shape, an old saved fit deserializes into new code and crashes on
render — which the user reads as "the app ate my fits". `src/lib/storage-migrate.js` prevents this:
it stamps a `SCHEMA_VERSION` and runs ordered migrations on boot, from `main.jsx`, **before** React
reads any state. When you change the shape: bump `SCHEMA_VERSION` and **append** (never reorder/renumber)
a migration that rewrites old fits into the new shape. Keep each migration total and defensive — a throw
there is the exact blank-page failure it exists to prevent (wrap `JSON.parse` in try/catch). The pure
core `runMigrations` is DOM-free and covered by the regression suite.

---

## Hard-won gotchas (read this before debugging a fit)

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
    skill sweep, not by a fit diff, for the reason in the "SKILL sweep" section below.

### Two different sets of skills — don't conflate them

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

### Per-fit pilot (`slots.pilot`) — one resolver, and it must stay the only one

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

### ⚠️ T3D tactical modes are `published=0` — and the generator filtered on `published`

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
modifier is invisible to it. Same split as `SHIP_MISSILE_DMG`.

**An attribute being present does NOT mean its effect applies.** The Skua's Sharpshooter mode still
carries a vestigial `modeMaxRangePostDiv = 0.6` from before CCP split that bonus into two per-skill
ones, but it does **not** carry effect **6076** — so eos ignores the attribute entirely. Keying the
mode-bonus table off attribute presence applied a phantom second multiplier and put a Sharpshooter
Skua's rockets at 47 km against eos's 35 km. `MODE_MISSILE_VEL` is keyed by **effect ID**, and the
attribute is only read once that effect is confirmed present on the mode.

### ⚠️ `build-bundle.py` auto-detect could silently pick the STALE eve.db

The repo-root `eve.db` is a superseded leftover (client build **3383521**); the authoritative one is
the pyfa v2.68 install (**3424810**). `find_db()` probed the repo-root copy **first**, and the only
thing that had ever kept that from mattering was `Pyfa-master/` also existing. It carries no
`eve.db`, so a plain `python scripts/build-bundle.py` regenerated the entire bundle from the old
client build — reverting real attribute values (Aralez, Berserker SW-900, …) and invalidating every
validated baseline in one commit. The probe order is now installs-first, repo-root last.

**Always check the first two lines the generator prints** — it echoes the db path and client build.
If it does not say `3424810`, stop.

### Stacking groups (this bit is subtle)

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

### Implant sets (RESOLVED — was a data bug, not a mechanic)

Asklepian and Nirvana both use the **FULL set product including Omega** (`1.1^5 × 1.25 = 2.0131`).
There is no asymmetry. Do not "restore" one.

This looked like a genuine mechanical difference for a long time: excluding Omega from Asklepian was
the only way to match pyfa. It turned out to be compensating for **corrupt data**. The bundle carried
a phantom `Republic Defense Booster II` (typeID 93055, deleted from the game) shadowing the real one
(91945), and the phantom had a bogus `armorRepairBonus: 6`. That fake +6% armor rep exactly cancelled
the missing Omega multiplier on the Astarte, so the wrong rule produced the right number.

With the phantom types pruned, the full product gives the Astarte a repair amount of **1132.35/cycle**
(pyfa: 1132) and a tank of **1668.3 EHP/s** (pyfa: 1668.3) — exact.

**The lesson worth keeping:** a rule that only works with a magic exception is usually a symptom.
Two errors were cancelling, and the "asymmetry" was the shape of the cancellation.

### Implant SETS — FIVE exist, all use the FULL product (incl. Omega)

`Asklepian` (armor rep), `Nirvana` (shield HP), `Amulet` (armor HP), `Mimesis` (entropic
disintegrator SPOOL) and `Savior` (remote-rep CYCLE TIME) all follow the same shape: each member carries a bonus attr, and a
set-multiplier effect (PreMul on that attr, domain=charID) which the dispatcher SKIPS. Each needs a
custom handler in `dogma-engine.js` applying the FULL set product including Omega (1.1^5 x 1.25 =
2.0131 for the first three; Mid-grade Mimesis is 1.2^5 x 1.6 = 3.981312).

If a fit's tank/EHP is low by roughly 10-13%, suspect a set with no handler. Amulet was missing
entirely — a Revelation Navy Issue came out at 4.49M EHP instead of pyfa's 5.07M.

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

### ⚠️ A set amplifies the MEMBER'S bonus attribute, and it must run EARLY

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

### ⚠️ Incoming remote reps have DIMINISHING RETURNS

Remote reps do not add up linearly — eos's `Fit.__getAppliedRr` scales each source down as the total
climbs, per layer (hull/armor/shield independently). `applyRemoteRepDiminishing` in `calc.js` ports
it. Two details are load-bearing and look like typos if you skim: the curve divides by the cycle time
**truncated to whole seconds**, but the final term divides by the **exact** cycle. eos even comments
on it ("for considerations of RR diminishing returns cycle time is rounded this way").

Below a few thousand HP/s the multiplier is ~1, which is why single-logi fits never showed it. A
Leshak under 14 projected Large Remote Armor Repairer IIs gets ×0.951217 — 3455.77 HP/s rather than
the naive 3633.0.

### `computeProjectedReps` must build the SOURCE as completely as `calcFitStats` does

Three separate bugs, all the same shape: the projection source was built without something the fit
under test would have had. Its **tactical mode** (a Defense-mode Confessor reps ×4/3), its **T3
cruiser subsystems** (a logi Loki's Offensive - Support Processor strengthens the Shield Command
Burst that shortens its remote boosters' cycle), and its **ancillary paste multiplier** (×3, which
the LOCAL path already applied). If a projected source's output is a clean fraction low, check what
the source fit is missing before suspecting the rep maths.

When adding one, filter members on attribute PRESENCE (`'attr' in type.a`), not on a truthy value:
attributes have defaults, and Omega (which carries no bonus attr) will otherwise read back the default
and inject a phantom bonus.

### Environment effects (the system a fit is sitting in)

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

### ⚠️ Pilot-security bonuses must NOT also sit in `SHIP_MISSILE_DMG`

A few hulls (Sidewinder & kin) scale a damage bonus by the pilot's *negative* security status:
magnitude is `ATFrigDmgBonus × sec`, not the raw attribute. Effect **12165** was listed in
`SHIP_MISSILE_DMG` *as well as* in the dedicated pilot-sec block in `calc.js`, so the raw −7.5% was
applied on top of the sec-scaled +75%: `1.75 × 0.925 = 1.61875`, and a −10.0 sec Sidewinder read
190.4 weapon DPS against eos's 205.8. `SHIP_MISSILE_DMG` is for bonuses whose magnitude *is* the
attribute; anything scaled by something else belongs only with its own handler.

### ⚠️ Charges modify their parent MODULE (domain "otherID")

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

### Hull damage/RoF/tank bonuses split across TWO code paths

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

### pyfa's source is the reference — read it instead of guessing

pyfa is open source and hand-implements every effect CCP ships with an EMPTY modifier list, keyed by
ID (`class Effect12887` in `eos/effects.py`). Those empty effects are silent no-ops in our engine
until a fit comes out wrong — that is how we lost sessions to the Angel Cartel reload bonus, the
command-carrier burst bonuses, and the hardpoint-booster missile damage.

```bash
git clone --depth 1 https://github.com/pyfa-org/Pyfa.git pyfa-master   # source, not the release build
node scripts/pyfa-effect.mjs 12887     # how pyfa implements one effect
node scripts/pyfa-effect.mjs --check   # verify our data-patches against pyfa
node scripts/pyfa-effect.mjs --gaps    # empty effects pyfa implements (a triage list)
```

**Do not treat `--gaps` as a bug list.** ~120 effects are empty in our bundle and implemented by pyfa,
but most are activation markers (`useMissiles`, `armorRepair`, `shieldBoosting`, MWD/AB) that we handle
in `calc.js` by group/attribute rather than by effect ID. Check how we already handle that module class
before "fixing" anything.

pyfa's source also settles DISPLAY questions, not just mechanics. Its drone list shows tracking
normalised to a 40,000 m reference signature (`trackingSpeed * 40000 / optimalSigRadius`, in
`gui/builtinViewColumns/misc.py`) — which is why its attribute panel says 2.46 and its drone list says
3.93k for the same drone. Both are correct; they are different quantities. We would never have worked
that out from screenshots.

### ⚠️ Phantom types — dead entries shadowing live ones

`build-bundle.py` prunes types that no longer exist in eve.db. It used to keep them ("harmless"), but
**274 dead types** were in the bundle and **35 of them shadowed a live type by name** — all seasonal
boosters. `typeIDByName` resolved to the dead entry, so fits silently used the wrong item's stats.

Symptoms this caused: the Asklepian rule above, and a Praxis whose shield/armor/hull resists were all
uniform because a phantom `Imperial Defense Booster II` had all four passive resists at −4 instead of
the real explosive −4 / kinetic −2.

### ⚠️ Booster bonuses: don't double-apply

The `B_PCT` table in `dogma-engine.js` applies booster bonuses whose dogma effect ships **empty**.
Whether an effect is empty varies per booster, so the handler now checks each booster's own effects
and skips anything already applied by the effect pass. The old hardcoded list was calibrated against
the phantom boosters (whose effects were empty); against clean data every non-resist entry
double-applied, which is what pushed the Astarte's scan resolution from 306 to 312.

### ⚠️ The Asklepian "excludes Omega" rule is DEAD — don't restore it from an old commit

This file used to carry a table asserting that Asklepian amplified with `1.1^5 = 1.6105`
(Alpha–Epsilon only) against Nirvana's full `1.1^5 × 1.25 = 2.0131`, plus a warning not to unify the
two handlers. **That is obsolete** and is kept here only as a tombstone, because the reasoning was
persuasive and someone digging through history will find it and be tempted.

The asymmetry was never real — it was compensating for the phantom `Republic Defense Booster II`
described above. With the phantom pruned, **every** set uses the full product including Omega, and
`dogma-engine.js` computes `setProduct` over all set members for both. (The `repMembers` filter still
in the Asklepian handler is not that rule: Omega's own `armorRepairBonus` is 0, so it contributes
nothing to amplify either way. It selects which members' bonuses get scaled, not what the product is.)

The live values are in the "Implant SETS — FIVE exist" section above. Two errors were cancelling;
see that section for the general lesson.

---

## Merge hazards (multi-person repo)

- **Never hand-edit the generated data files.** `dogma-types.json`, `dogma-effects.json`,
  `dogma-attrs.json`, `ship-traits.json`, `type-descriptions.json`, `data-bundle.js` (5.8 MB),
  `modules.json`, `module-variations.json` and `pyfa-types.json` are generated artifacts. A conflict
  in them is unresolvable by hand.

  **Two traps when regenerating `type-descriptions.json`.** It is keyed off the emitted TYPES, *not*
  `fit_types`: `fit_types` requires `published=1`, and the 89 T3-destroyer tactical modes
  (Confessor/Svipul/Jackdaw/Hecate "… Mode") are unpublished yet fully live — `calc.js` resolves them
  by typeID — so keying off `fit_types` silently drops their descriptions. And hulls are deliberately
  excluded (`DESC_CATS` has no 6/65): a hull's description ships inside `ship-traits.json` next to its
  trait bonuses. When you regenerate, diff against the previous file and expect **zero** text changes
  beyond `\r\n` → `\n`; anything else means the extraction changed, not the data.

  **Regenerate the dogma bundles instead:**

  ```bash
  python scripts/build-bundle.py --dry-run   # report what would change
  python scripts/build-bundle.py             # write the bundles
  npm test                                   # the full regression suite MUST still pass
  ```

  It needs pyfa's `eve.db` (auto-detected in `Pyfa-master/`, or pass `--db`). Regeneration is
  idempotent: hand fixes live in `scripts/data-patches.json` and are re-applied on every build.

  **The old `update-from-evedb.py` was the source of nearly every data bug in this project.** It only
  refreshed attributes a type *already had* (`for ak in list(ca.keys())`), so a newly-relevant
  attribute could never appear — and it filtered everything through an `attr_allow.json` allowlist
  that was never committed. That is why the Angel hulls were missing their −75% projectile reload
  attribute, why the lance was missing its doomsday tick attributes (~1190 DPS on a Bane), and why
  carrier hull bonuses, the Capital MJD skill and covert-cloak CPU were all silently inert.

  `build-bundle.py` drops the allowlist and writes **every** attribute CCP defines on a fittable type
  (+0.6 MB, ~75k attribute slots restored), and covers drones/fighters/structures, which the old
  category filter excluded — fighter stats had been stale for months.

  **What eve.db cannot give you:** it has no effect `modifierInfo` and no `stackable` flag. Effect
  modifiers are preserved from the existing bundle; a genuinely new effect is written inert and
  reported loudly. Supply its modifier from CCP's FSD dump via `data-patches.json`, or write a custom
  handler in `dogma-engine.js`. Only ONE hand patch remains: **effect 12887**, which CCP ships with an
  empty modifier list.

- **The `App.jsx` split already happened.** It was ~4,400 lines; it is now ~620 and holds state,
  effects and composition only. The UI lives in `src/components/` (`ui.jsx`, `tabs.jsx`,
  `GraphTab.jsx`, `snapshot.jsx`, `effects.jsx`, `FittingsScreen.jsx`, …) and `src/lib/`. Do not
  reintroduce view code into `App.jsx`. `calc.js` (~3,260) and `ui.jsx` (~1,610) are now the two
  files most likely to conflict.

- **Prefer targeted diffs over whole-file rewrites.** An agent handing back a whole file silently
  reverts whatever a teammate changed in the meantime.

---

## Upgrading eve.db (a new EVE patch)

The regression baselines are only meaningful **relative to a specific EVE build**. The bundle records
which one it came from in `src/data/bundle-version.json`, and the suite prints it on every run:

```
data: EVE client build 3424810 (SDE 2026-07-07) — matches validated baselines
```

We are currently on **pyfa v2.68.0 / client build 3424810**. When you move to a newer `eve.db`, the
suite detects the mismatch and prints a loud banner.

**A red suite after an eve.db upgrade is a WORKLIST, not a failure.** Some baselines will move because
CCP rebalanced something — that is correct and expected. The failure mode to avoid is shrugging and
updating the expected values to whatever the code now prints: that silently converts validated
baselines into "whatever we currently compute", which is worth nothing.

The process:

1. **Upgrade the pyfa app to the same version as the new `eve.db`.** They must match — pyfa is the
   reference, and comparing against a different build proves nothing.
2. `python scripts/build-bundle.py --dry-run` — read what CCP actually changed before you write it.
3. Regenerate, then `npm test`. Expect some red.
4. For **each** failure: open that fit in the new pyfa and read the real number.
   - pyfa's number changed too → CCP rebalanced. Update the baseline, and **say why in the commit
     message** (e.g. "blaster damage nerfed 2%, Astarte 1200 → 1176 per pyfa 2.68").
   - pyfa still gives the OLD number → **you found a real bug.** Fix the code, not the test.
5. Watch for the generator shouting about **new effects with no modifier data**. A new expansion will
   add some, and they are inert until someone supplies a modifier (`scripts/data-patches.json`) or
   writes a custom handler. The same goes for new attributes, which default to `stackable=1`.

   This step is now also **enforced in CI** by `scripts/check-effect-coverage.mjs`, which snapshots the
   set of empty-modifier effects present on fittable types into `scripts/effect-coverage-baseline.json`.
   A regen that ADDS such an effect fails the gate with a triage list. For each new one: run
   `node scripts/pyfa-effect.mjs <id>` to see if pyfa implements it; add a handler/data-patch if it
   matters, or (if it's a benign activation marker we already handle by group/attribute) accept it with
   `node scripts/check-effect-coverage.mjs --update`. Effects LEAVING the set never fail — they just
   prompt an update. **Do not `--update` to silence the gate without triaging first** — that is exactly
   how silent no-ops ship.
6. Bump `VALIDATED_BUILD` in `src/regression.test.mjs` as part of the same commit.

Do the upgrade as its own PR, with nothing else in it. The diff will be large and the whole point is
that a human can see exactly which numbers moved and why.

---

## Driving pyfa's `eos` engine directly (the oracle — BUILT, 2026-07-17)

An automated oracle now drives pyfa's calculation engine as a Python library and diffs its numbers
against ours, instead of validating one fit at a time by hand in the GUI. Lives in `scripts/oracle/`.

```bash
/c/Python314/python scripts/oracle/oracle.py --list      # available fit specs
/c/Python314/python scripts/oracle/oracle.py bane        # eos stats + diff vs our baseline
```

### Sweeps: diffing HUNDREDS of fits at once

Three fit SOURCES, one comparison harness. All emit the same JSONL record (`{id, name, ship, eos,
spec, flags}`), so `oracle_compare.mjs` runs `calcFitStats` on each spec and reports divergence per
stat, worst-first, clustered by ship — which is what turns 110 failures into "one effect is wrong".

```bash
# GENERATED structure fits (one module per fit; --charges also enumerates every valid charge)
node scripts/oracle/gen_structure_fits.mjs [--charges] > scripts/oracle/_structfits.jsonl
# ...or RANDOM multi-module fits, seeded so a failure is reproducible from its id
node scripts/oracle/gen_structure_fits.mjs --random=500 --seed=1 > scripts/oracle/_rnd.jsonl
/c/Python314/python scripts/oracle/oracle_batch.py scripts/oracle/_structfits.jsonl > scripts/oracle/_struct.jsonl
node scripts/oracle/oracle_compare.mjs scripts/oracle/_struct.jsonl

# YOUR REAL saved pyfa fits (OPSEC: _*.jsonl is gitignored — never commit it)
/c/Python314/python scripts/oracle/oracle_saved.py > scripts/oracle/_saved.jsonl
node scripts/oracle/oracle_compare.mjs scripts/oracle/_saved.jsonl
```

**Generate fits in Node, not Python.** Legality (canFitShipType/Group, rigSize, the structure-module
category rule) already exists on the JS side; a second Python copy would be a second thing to keep
right, and a generator bug masquerades as an engine bug — the worst failure mode for an oracle.

**One module per fit is the highest-signal sweep**: a mismatch names its own culprit, no bisection.
But it is blind by construction to *module-boosts-module* bugs — a BCS alone has no weapon to boost.
That class needs multi-module fits (real saved fits found the Standup BCS double-count). Both matter.

The 2026-08-01 sweep (343 single-module + 361 with charges) found four real bugs: duplicate modifier
entries in effect 7098, the missing system-security modifier, two unmodelled structure weapon groups,
and the Standup BCS double-count. All four are pinned in `regression.test.mjs` section 11b.
`--random` then ran 2,100 multi-module fits across 5 seeds with zero divergences.

**A sweep that cannot fail is worthless — prove it has teeth.** Before trusting a clean run, revert
a known fix and confirm the sweep catches it. Reverting the Standup BCS fix turns the random sweep
from 500/500 clean into 86 divergences; putting it back returns it to 500/500. Without that check,
"500 clean" might only mean the generator never produced an interesting fit. (It does: of 500 random
fits, 93 combine a weapon with a damage-upgrade module, 376 carry rigs, and system security is spread
evenly across all four values.)

**Tell eos the system security.** `oracle_batch.py` sets `fit.systemSecurity` from the spec. Skip it
and eos silently uses its nullsec default, so every hisec fit reads as a 20% rig-bonus "divergence"
that is really a harness mismatch.

### The SKILL sweep — a different question from the fit sweeps

```bash
/c/Python314/python scripts/oracle/skill_sweep.py > scripts/oracle/_skills.jsonl
node scripts/oracle/skill_sweep_compare.mjs scripts/oracle/_skills.jsonl [--verbose]
```

`oracle_compare.mjs` asks "do the two engines agree on this fit's numbers", with everything at V on
both sides. A skill that is a silent no-op in OUR engine is **invisible** to that. This asks "does
each SKILL do the same thing in both engines" by zeroing one skill at a time and comparing how far
each stat moves — so an ignored skill shows up as a zero delta against a live one. It reports
RELATIVE movement deliberately, so a unit mismatch cannot masquerade as a missing skill. Fits live
in `skill_fits.json`, chosen to cover skill surface (turrets, missiles, drones, fighters, mining,
logi, EWAR, cloak, bombs); a skill no fit exercises reports inert on both sides and is counted, not
listed — that is a coverage gap to widen, not a pass.

**Four harness traps, all of which manufacture fake findings** — every one cost a false lead:

- eos's `Character.addSkill()` only replaces a skill when the new level is **higher**, so handing it
  a level-0 skill on an all-V character is silently ignored. `Skill.setLevel(0, ignoreRestrict=True)`
  is the one that works (`ignoreRestrict` stops the strict-skill cascade from zeroing dependents too).
- eos's `capDelta` reads two private fields that `calculateModifiedAttributes()` does not fill; it
  returns a flat 0 until something touches `fit.capUsed` and triggers `simulateCap()`. Left dead, it
  made 18 cap skills look like ours-only.
- eos's `fit.maxSpeed` is the ship's engine-computed `maxVelocity`, and eos applies the prop mod
  there. We apply ours afterwards in `calc.js`, so the like-for-like field is `maxVelocityAB` (which
  falls back to the unpropped speed when nothing is propping). Compare against `cs.exact.*`, not the
  display fields — those are rounded, and rounding quantises movement to about the noise threshold.
- **One eos `Fighter` object IS one squadron**; its `amount` is how many fighters are inside it. Nine
  squadrons is nine appended objects, not `amount = 9` — and fighters need `fighter.owner = fit` set
  by hand (drones don't), or `getDroneDps()` raises on `owner.factorReload`. On our side fighters go
  in `opts.fighters`, not the drones argument, which is silently accepted and yields 0.

Teeth: reverting the skill-prescale ordering fix in `dogma-engine.js` turns a clean run into
`INERT HERE: Bomb Deployment [hound_bomb]`.

`eos_bootstrap.py` wires eos headless; `oracle.py` builds a fit from a spec (ship + modules + charges
+ drones + implants + boosters + all-skills-at-V) and prints `getWeaponDps()`, `getWeaponVolley()`,
`getTotalDps()`, `ehp`, `capDelta`, `maxTargetRange`, `scanResolution`. **Proven:** the Bane spec
reproduces our baseline exactly — eos weaponDps 13301.28 (ours 13301), volley 180870.16 (ours 180870).

**How the headless bootstrap works (the non-obvious bits):**

- `Pyfa-master/eos/` itself has zero wx imports — BUT `eos/db/migration.py` does `import config`
  (pyfa's **GUI** app config at `Pyfa-master/config.py`), which pulls in `wx`. That import happens at
  `eos.db` load time. `migration.update()` is only ever called from GUI-side `service/prefetch.py`, so
  the bootstrap injects a tiny stub `config` module into `sys.modules` (with `savePath`/`saveDB`) —
  no wxPython needed.
- Set `sys._called_from_test = True` **before** importing `eos.config` → saveddata goes in-memory
  (no writes to the user's real db).
- Override `eos.config.gamedata_connectionstring` to the authoritative db **before** `import eos.db`
  (it reads the connection string at import time).
- All-skills-at-V character is just `Character("name", 5)` (`defaultLevel=5, initSkills=True`).
- Siege / Triage / Bastion are ordinary `Module`s in eos, not T3-style "modes". Charges: build the
  Module, set `m.owner = fit`, `m.state`, then `m.charge = <chargeItem>`, then `fit.modules.append`.

**Deps (already installed into `/c/Python314`):** `sqlalchemy==1.4.50` (builds fine on 3.14 despite
its age), `logbook`, `pyyaml`. `numpy` is NOT imported by eos — don't bother. `python`/`python3`/`py`
hit a Microsoft Store alias stub; the real interpreter is `/c/Python314/python` (3.14.5).

**Assets located on this machine (as of the 2026-07-16 v2.68 upgrade):**

| What | Path |
| --- | --- |
| pyfa v2.68.0 gamedata db (build 3424810) — the **authoritative** one | `C:\Program Files\pyfa\app\eve.db` |
| Old gamedata db (build 3383521) — repo root, superseded | `eve.db` (repo root) |
| User's real characters / skills / fits | `C:\Users\owen_\.pyfa\saveddata.db` |
| pyfa source clone — the ONE clone; must match eve.db's version (enforced at startup) | `Pyfa-master/` |

- pyfa's gamedata schema is its **own** compact SQLite (tables `dgmattribs`, `dgmtypeattribs`
  (single `value` column), `invtypes`, `invgroups.name`, …) matching `eos/db/gamedata/*.py` — **not**
  raw SDE (`sqlite-latest.sqlite`, capitalized tables). `config.py` resolves `gameDB = <pyfaPath>/eve.db`.
- **Still to do:** Praxis (needs mutated-module support) is the only regression fit not yet in `FITS`.
  Bane, Astarte, Minokawa, Salvation and Rev Navy are ported and diff against our baselines.

### ⚠️ The oracle is not infallible — pyfa has its own bugs

pyfa is our reference, but eos hand-codes each effect in `eos/effects.py` (its compact db carries **no**
`modifierInfo`), so an effect CCP ships with a modifier but which pyfa never wrote a class for is a
**silent no-op in eos** — and eos will disagree with a correct value of ours. When the oracle flags a
mismatch, first ask *which side is missing the effect*, not "how are we wrong."

**⚠️ VERSION SKEW used to be the #1 source of false "pyfa gaps" — it is now enforced, not
remembered.** The eos engine code must match the gamedata db version, because eos silently no-ops
any effect it has no class for. There is deliberately **ONE** clone, `Pyfa-master/`, and it must be
the version matching `eve.db`. `eos_bootstrap._assert_clone_matches_db()` checks a sentinel effect
class at startup and **refuses to run** against a stale clone; both `oracle.py` and
`eos_saveddata.py` go through it. `PYFA_ROOT` still overrides the path if you need a second clone
temporarily.

This replaced a two-clone setup (a stale `Pyfa-master` alongside a correct `Pyfa-268`) where the
*default* was the wrong one and correctness depended on remembering an env var. Consolidated
2026-08-01; the two effect classes the old clone had and the new one doesn't (`Effect5505`,
`Effect8366`) are ones CCP retired — **zero** live types carry either.

The classic false alarm this caused: **Astarte weapon DPS (stale eos 800 vs ours 1200).** CCP moved
the Astarte's Command Ships weapon bonus from rate-of-fire (`Effect5505`) to +10%/lvl **medium-hybrid
damage** (effect **12897**, `eliteBonusCommandShipMediumHybridDamageCS1`, reads
`eliteBonusCommandShips1`=10 → ×1.5 at all-V). A v2.66.3 clone has no `Effect12897` class → drops the
whole CS weapon bonus → 800. Against a matched clone eos gives 1199.6 and agrees with us exactly.
Same story for the Republic Defense Booster II resist effects (12822/12823). These are **not** pyfa
gaps — the `known_gaps` annotations that used to live in the astarte spec were removed.

**When you upgrade eve.db, upgrade the clone in the same commit** and point
`_VERSION_SENTINELS` in `eos_bootstrap.py` at an effect class new in that version — otherwise the
guard silently stops guarding.

**Takeaway:** a version-matched clone is now guaranteed, so if the oracle flags a delta it is worth
asking *which side is missing the effect* — run `node scripts/pyfa-effect.mjs <id>` and
`grep "class Effect<id>" Pyfa-master/eos/effects.py`.

---

## ESI connectivity (skills sync, in-game fit import/export — LIVE since 2026-08-09)

Character login (EVE SSO + PKCE), skill sync, and importing/exporting fits directly against a
character's in-game saved fittings. The ESI application is registered and `ESI_CLIENT_ID` is
populated; a real login was exercised end-to-end on a device build, which confirmed the one thing
fixtures could never cover — that `login.eveonline.com`'s token endpoint answers over Capacitor's
native networking. Nothing here is pending.

### Files

| File | Role |
| --- | --- |
| `src/esi-config.js` | Client ID, both callback URLs, requested scopes. The client ID is public by design in a PKCE flow — there is no secret here and there must never be one. |
| `src/lib/esi.js` | OAuth2+PKCE login, token storage/refresh, authenticated ESI GET/POST, skill-id → app-skill mapping. |
| `src/lib/esi-fits.js` | ESI saved-fitting JSON ⇄ this app's slot model, both directions. |
| `src/components/esi-ui.jsx` | Character login/switcher (Settings → ESI), Import-from-EVE and Export-to-EVE modals (hamburger menu). |

### Why this needed no backend

PKCE exists specifically so a public client with no client secret (this app, always) can do OAuth
without a server. The remaining question was whether `login.eveonline.com`'s token endpoint
answers a browser's `fetch()` at all (CORS) — docs don't say either way, and a related SSO endpoint
is known to fail CORS preflight (github.com/esi/esi-issues#197). This only matters for the **web**
build; the **native** build sidesteps it entirely: `capacitor.config.json` now sets
`CapacitorHttp.enabled: true`, which makes Capacitor route `fetch()`/`XHR` through native
networking instead of the WebView — not subject to browser CORS at all, since CORS is a browser
concept. Every ESI/SSO call in `esi.js` is a plain `fetch()`; it does not know or care which
transport actually serves it. **This one config line is why the whole feature could be built
backend-less.** If the web build ever turns out to need a proxy for the token exchange specifically
(nothing else), that's a small addition scoped to one function (`tokenRequest` in `esi.js`) — it
does not touch this file's architecture.

### ⚠️ The ESI fittings flag scheme is a STRING ENUM (corrected 2026-08-13)

`/characters/{id}/fittings/` items use **string flags** in both directions: `"HiSlot0".."HiSlot7"`,
`"MedSlot0..7"`, `"LoSlot0..7"`, `"RigSlot0..2"`, `"ServiceSlot0..7"`, `"SubSystemSlot0..3"`, plus
`"Cargo"`, `"DroneBay"`, `"FighterBay"` and `"Invalid"` (entries ESI wants discarded). It is **not**
the classic numeric inventory-flag scheme (LoSlot0=11, HiSlot0=27, RigSlot0=92, Cargo=5, …) that the
old XML API and the SDE's `invFlags` table used. The numbers are silently rejected.

This file previously documented the numeric scheme, sourced from `Pyfa-master/service/port/esi.py` —
which still sends numeric `INV_FLAGS`. **That was the bug**: every module of an imported fit failed
its flag lookup and was dropped, leaving a bare hull, and every exported fit was rejected the same
way. The authoritative source is CCP's own published schema,
**https://esi.evetech.net/meta/openapi.json** (`CharactersCharacterIdFittingsGet` and the POST request
body) — check the schema, not a port of it. Note `/latest/swagger.json` now 404s; `/latest` still
works as a request base.

Numeric flags are still **accepted on import**, because a fitting JSON written by an older tool is a
real thing a user will paste at us and the two schemes cannot be confused — one is a number. Export
emits strings only. `SubSystemSlot<n>` is derived from the type's `subSystemSlot` attribute (attr
1366), which CCP still ships in the old 125-128 numbering, so it names the slot **index** (125 →
`SubSystemSlot0`). Pinned by regression section **13l**.

**The wider lesson still holds, with a correction: read the live schema first, then pyfa.** pyfa's
source is authoritative for *dogma effects* because eos hand-implements them; it is not authoritative
for an API contract CCP has since changed underneath it.

Also confirmed there (and it matches a well-known in-game limitation): a saved fitting does **not**
record which module a charge was loaded into. pyfa's own export aggregates all loaded charges,
fit-wide, into a flat cargo-hold quantity (flag=Cargo) rather than per-module, and its import just
dumps everything with flag=Cargo into the cargo hold — no attempt to guess which module a charge
belongs to. `esi-fits.js` does the same on both sides, deliberately, rather than inventing a
round-trip precision ESI itself doesn't support.

### What's verified (no live ESI calls needed for any of this)

- PKCE `code_verifier`/`code_challenge` generation against the **RFC 7636 canonical test vector** —
  byte-exact match.
- JWT payload decode, including non-ASCII character names (UTF-8 through the base64url path).
- `esiFittingToImportShape()` → `buildSlotsFromEFT()` → `slotsToEsiFitting()` round-trip, including
  the T3-cruiser subsystem case (`SubSystemSlot0..3` preserved exactly).
- Unknown/unpublished `type_id`s in an ESI fitting are skipped, not mis-placed or crash-inducing.
- Skill-id → app-skill mapping reuses `calc.js`'s existing `SKILL_CAMEL_TO_PYFA` (now exported) —
  159/163 skill keys resolve to a real ESI skill_id; the 4 that don't are a pre-existing gap in that
  map (unrelated skill-name typos), not something ESI sync introduced. They just don't sync; nothing
  breaks.
- Every UI state (not connected, connected/one character, connected/multiple characters, no active
  fit, "ESI isn't configured yet") renders correctly with a fake character record injected directly
  into `localStorage` (same technique as the Optimize Fit Price verification below) — confirmed live
  in the dev server, no crashes, no console errors.
- The Android manifest's deep-link intent-filter (`eveauth-visviva://auth-callback`) and the `CapacitorHttp`
  config both compile in and show up correctly in a built debug APK (checked with `aapt2 dump
  xmltree` and by reading the synced `android/app/src/main/assets/capacitor.config.json`).

### The registered application (things that break login if changed)

The app is registered at developers.eveonline.com as Application Type "Authentication & API Access",
public client / PKCE. Two of its settings are mirrored in this repo and must stay in sync with it:

- **Both callback URLs** — the web origin and `eveauth-visviva://auth-callback` — are registered
  there. ESI SSO matches `redirect_uri` exactly, so a URL the application does not list is rejected
  outright. This is one of the three reasons the `visviva` name is frozen (see the top of this file).
- **Scopes** are fixed at grant time. Adding one to `ESI_SCOPES` does not retroactively extend
  existing tokens, so every already-logged-in character has to log in again to pick it up.

Changing the client ID or either callback is a re-registration, not an edit.

---

## Working style

- **Root-cause fixes, not patches.** If a number is wrong, find out *why* — do not special-case the
  fit. Nearly every bug in this project has turned out to be a missing or trimmed piece of CCP data,
  and the special-case would have hidden it.
- **Bisect with the numbers.** The fastest diagnoses here came from noticing *which* stats agreed:
  volley matching but DPS not ⇒ the divisor is wrong, not the damage. A cap gap exactly equal to the
  injector value ⇒ the injector is off by 2×, not the drain.
- **Beware compensating errors.** Two bugs that cancel will look like a pass. The Astarte's repair
  amount and cycle time were *both* checked individually for exactly this reason.
- A blank page in the app is almost always a React crash — check the console.

---

## Shipping a release (Android + iOS)

Releases come off `main` unless you are deliberately cutting a device build of an unmerged branch
(see the iOS `--ref` note). Always `npm run verify` first — CI runs the same suite on PRs, but the
release path itself is not gated.

### Version numbering

`android/version.properties` is the source of truth for Android and is **auto-managed** — never
hand-edit `versionCode`. iOS takes its marketing version from a workflow input and its build number
from the run number, so the two platforms share a marketing version but NOT a build number.

Feature work gets a minor bump (1.2.0 -> 1.3.0); fix-only gets a patch (1.3.0 -> 1.3.1).

### Android

```bash
npm run cap:sync                             # vite build + cap sync
node scripts/bump-android-version.mjs 1.3.0  # PASS THE VERSION EXPLICITLY
node scripts/gradle-assemble.mjs
```

**`npm run android:build` is not the release path.** It runs `android:bump` with *no argument*,
which only advances the patch digit — so a feature release built that way silently ships as
1.2.2 instead of 1.3.0. Bump explicitly, then assemble.

Verify the APK rather than trusting the bump script's own output — the two have disagreed before:

```bash
"$LOCALAPPDATA"/Android/Sdk/build-tools/*/aapt2.exe dump badging android/app/build/outputs/apk/debug/app-debug.apk | head -1
```

Then commit `android/version.properties` alone as `Release 1.3.0: versionCode 14`, push, and attach
the APK (`android/app/build/outputs/apk/debug/app-debug.apk`, ~16 MB) to a GitHub release tagged
`android-1.3.0`. The release notes are what testers actually read — write them in terms of what
changed for the user, not the commit log.

#### Google Play (signed AAB — a different artifact from the GitHub release)

The GitHub release ships a **debug-signed APK**, which is right for sideloading and wrong for Play.
Play needs a **signed AAB**, built by a separate task:

```bash
node scripts/bump-android-version.mjs 1.7.0   # explicit, same as the APK path
npm run android:bundle                        # → android/app/build/outputs/bundle/release/app-release.aab
```

`android:bundle` deliberately does **not** bump, for the same reason `android:build` doing an
implicit bump is a trap (above). Bump first, explicitly.

Signing is driven by **`android/key.properties`**, which is gitignored (it holds three passwords in
plaintext and this repo is public). Its absence is the normal case and does not break anything — the
project still configures, `assembleDebug` still works, and `bundleRelease` still succeeds but emits
an **unsigned** AAB that Play rejects loudly. If an upload is refused for signing, check that this
file exists before suspecting the Gradle config. Format:

```properties
storeFile=C:/Users/owen_/keys/axis-upload.jks
storePassword=...
keyAlias=axis-upload
keyPassword=...
```

`storeFile` resolves against `android/`; an absolute path outside the repo is preferred. **Use
forward slashes** — in a Java `.properties` file a backslash is an escape character, so a pasted
Windows path fails with a confusing "keystore not found".

Play App Signing means Google holds the real distribution key and this is only the *upload* key, so
losing it is recoverable through Play support — unlike the old pre-2021 model. Back it up anyway.

### iOS

**Manual dispatch only, on purpose** — it publishes to testers and burns a build number that can
never be reused:

```bash
gh workflow run ios-testflight.yml -f marketing_version=1.3.1 -f upload=true
gh run watch <run-id> --exit-status
```

- Add `--ref <branch>` to build a testable device copy of an unmerged branch. That is the right
  move when the point of the build is to exercise something that cannot be tested on a desktop
  (ESI login, deep links, WKWebView behaviour) — it avoids merging device-untested work.
- `upload=false` gives a signing dry run that produces only an `.ipa` artifact.
- The build number is `github.run_number`: monotonic, never resets, never reuse a marketing version
  with an old build number.
- `ios/` is deliberately NOT committed — it is regenerated every run, so a stale native project
  cannot drift from the web code. Anything you would otherwise hand-edit in Xcode belongs in
  `scripts/patch-ios-project.sh`.
- Roughly 3-20 minutes to build, then another 5-15 for App Store Connect to process before it
  reaches testers. Grep the run log for `UPLOAD SUCCEEDED`.
- No Mac required: the repo is public, so macOS runners are free. One-time signing/secret setup is
  in `IOS_RELEASE.md`.

#### ⚠️ The app is iPhone-only, and that is what makes the portrait lock legal

Capacitor generates a **universal** (`TARGETED_DEVICE_FAMILY = "1,2"`) project. App Store Connect
rejects any iPad-capable bundle whose `UISupportedInterfaceOrientations~ipad` does not list **all
four** orientations — error **90474**, "to support iPad multitasking". `UIRequiresFullScreen` used to
exempt you; it is **ignored as of the iOS 26 SDK**, which is what CI builds against, so that escape
hatch is gone. Portrait-locking a universal build is therefore an automatic rejection.

`patch-ios-project.sh` seds the target down to `"1"` (iPhone) and **deletes** the `~ipad` key rather
than setting it. Both halves matter: a portrait-only `~ipad` key is the exact thing the validator
looks at.

The failure costs a build number and ~15 minutes, because it happens inside Apple's validator
*after* a successful archive and export — the archive itself is perfectly happy. That is why the
script `grep`s its own sed and exits non-zero if the setting ever moves, rather than letting a
universal build sail through to the upload step. If the app ever grows a genuine wide layout,
revisit this: the fix is to go universal again and give the iPad all four orientations.

### Two landmines that have cost real time

- **`check()` in `regression.test.mjs` takes a RELATIVE tolerance.** `check(g, l, actual, 63773.5, 1)`
  means +/-100%, not +/-1. Four checks were written that way and passed against any number until a
  deliberate revert-the-fix test exposed them. For a hard baseline use `1e-5`; for a 0/1 assertion
  use `0`. **Always prove a new check has teeth by reverting the fix and watching it fail.**
- **Do not patch `App.jsx` or `components/ui.jsx` with scripted whole-span replacements.** Slicing
  "from this function to the next `
function `" silently swallows `export function` declarations
  and top-level `const` blocks sitting between them; it removed `ItemDetailSheet` once and the
  abyssal helper block twice. Worse, recovering the span from `git show HEAD` restores the
  *committed* version, quietly reverting any uncommitted work in it — a diff against HEAD will not
  show what you lost. Prefer targeted edits, and after any bulk patch diff the function inventory:

  ```bash
  diff <(git show HEAD:src/components/ui.jsx | grep -o "^\(export \)\?function [A-Za-z]*" | sort)        <(grep -o "^\(export \)\?function [A-Za-z]*" src/components/ui.jsx | sort)
  ```
