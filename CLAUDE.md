# Vis Viva — EVE Online fitting calculator (mobile)

A React + Vite ship-fitting calculator for EVE Online, targeting mobile. It reimplements pyfa's dogma
engine in JavaScript. **pyfa v2.68.0 with all skills at V is the reference implementation** — when our
numbers disagree with pyfa, we are wrong until proven otherwise.

---

## Before you change anything

```bash
node src/regression.test.mjs      # must print "ALL 25 REGRESSION CHECKS PASSED"
```

Every number in that suite was validated by hand against pyfa. Several took an entire session to pin
down. **If a check fails, you broke something real.** Do not update the expected values to match new
output unless you have re-validated against pyfa first and can say why the old number was wrong.

CI runs this on every PR (`.github/workflows/regression.yml`).

---

## Architecture

| File | Role |
| --- | --- |
| `src/dogma-engine.js` | The dogma engine: attribute pools, stacking penalties, effect dispatch, custom handlers. ~1000 lines. |
| `src/dogma-engine-init.js` | Loads the dogma bundles and calls `initEngine()`. Works in **both** Vite and Node. |
| `src/calc.js` | Turns a fit + engine output into displayed stats (DPS, tank, cap, resists, graph data). |
| `src/App.jsx` | The entire UI. ~4,400 lines — see "merge hazards" below. |
| `src/data/dogma-*.json` | The dogma bundle: types, effects, attributes. **Generated + hand-patched.** |
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

8. **`ships.json`'s `hullClass` is wrong for 64 hulls.** It files the Crow under "Tactical Destroyer"
   and the Cenotaph under plain "Battlecruiser". Use CCP's group name from the type data
   (`TYPES[typeID].gn`) as the authoritative hull class.

9. **`data-bundle.js`'s `meta` strings are wrong** — faction/storyline/deadspace/officer modules all
   came through as "T2". Meta group is derived from CCP's `metaGroupID` (shipped as `mg` on every type
   in `dogma-types.json`); see `metaOf()` in `App.jsx`. Never trust the bundle's `meta` field.

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

### Implant SETS — three exist, all use the FULL product (incl. Omega)

`Asklepian` (armor rep), `Nirvana` (shield HP) and `Amulet` (armor HP) all follow the same shape: each
member carries a bonus attr, and a set-multiplier effect (PreMul on that attr, domain=charID) which the
dispatcher SKIPS. Each needs a custom handler in `dogma-engine.js` applying the FULL set product
including Omega (1.1^5 x 1.25 = 2.0131).

If a fit's tank/EHP is low by roughly 10-13%, suspect a set with no handler. Amulet was missing
entirely — a Revelation Navy Issue came out at 4.49M EHP instead of pyfa's 5.07M.

When adding one, filter members on attribute PRESENCE (`'attr' in type.a`), not on a truthy value:
attributes have defaults, and Omega (which carries no bonus attr) will otherwise read back the default
and inject a phantom bonus.

### ⚠️ Charges modify their parent MODULE (domain "otherID")

Crystals/ammo carry effects with domain `otherID` — from a charge, "other" is its parent module. The
engine does NOT iterate charges as effect sources, so those effects are dead. Conflagration XL's
`capNeedBonus` (+25% cap, Effect804) is handled explicitly in the charge pass; if another
charge-modifies-module effect turns up, it needs the same treatment.

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

--- | --- | --- | --- |
| Asklepian | `armorRepairBonus` → `armorDamageAmount` | `1.1^5 = 1.6105` (Alpha–Epsilon only, **excludes Omega**) | Astarte repairer = **1132 HP/cycle** in pyfa (ours 1134.18 @ 9000 ms) |
| Nirvana | `shieldHpBonus` → `shieldCapacity` | `1.1^5 × 1.25 = 2.0131` (**includes Omega**) | Minokawa = **3.26M EHP** in pyfa (ours 3,256,400) |

Both are independently confirmed against a pyfa measurement. Unifying them breaks one of them:
using the full product for Asklepian moves the Astarte's tank from 1671 to 1768 (pyfa: 1668.3).

Theories tested and **rejected**: the stacking flag of the target attribute (`armorDamageAmount` is
stackable=0, `shieldCapacity` is stackable=1) predicts 1152.9, not 1132; penalising the set multiplier
itself predicts 3.06M for the Minokawa, not 3.26M.

Best current explanation: this is a **pyfa implementation quirk**, not EVE truth — pyfa hand-codes
these set effects in Python, and CCP's dogma for the two sets is identical, so in-game EVE probably
applies the full product to both. We match pyfa because pyfa is our reference. If you ever decide to
prefer EVE-truth over pyfa-truth, drop the `repMembers` filter in the Asklepian handler and expect the
Astarte's tank to rise to ~1768.

**A future agent will be tempted to "helpfully" unify these two handlers. Don't.**

---

## Merge hazards (multi-person repo)

- **Never hand-edit the generated data files.** `dogma-types.json`, `dogma-effects.json`,
  `dogma-attrs.json`, `data-bundle.js` (5.8 MB), `modules.json`, `module-variations.json` and
  `pyfa-types.json` are generated artifacts. A conflict in them is unresolvable by hand.

  **Regenerate the dogma bundles instead:**

  ```bash
  python scripts/build-bundle.py --dry-run   # report what would change
  python scripts/build-bundle.py             # write the bundles
  npm test                                   # 25 pyfa checks MUST still pass
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

- **`App.jsx` is 4,400 lines and everyone touches it.** Two people editing it in parallel is a
  guaranteed conflict. It has obvious seams already (`GraphTab`, `ResourceStrip`, `ModuleBrowser`,
  `SettingsOverlay`, `ModuleVariationsTab`) — splitting it into files is the single biggest reduction
  in merge pain available.

- **Prefer targeted diffs over whole-file rewrites.** An agent handing back a full 4,400-line
  `App.jsx` will silently revert whatever a teammate changed in the meantime.

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
| pyfa source clone (keep current — a stale clone gives false "not implemented") | `Pyfa-master/` |

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

**⚠️ First suspect a VERSION-SKEW artifact, not a real gap.** The eos engine code must match the
gamedata db version. The default `Pyfa-master` clone is **stale (v2.66.3)** and lacks every v2.68
effect class, so it will report "gaps" that a version-matched clone does not. `eos_saveddata.py` (the
saved-fit scanner) honours `PYFA_ROOT`; `eos_bootstrap.py` (the hand-spec `oracle.py`) now does too —
**always run both with `PYFA_ROOT=$(pwd)/Pyfa-268`**, or the oracle invents gaps.

The classic false alarm: **Astarte weapon DPS (stale eos 800 vs ours 1200).** CCP moved the Astarte's
Command Ships weapon bonus from rate-of-fire (`Effect5505`) to +10%/lvl **medium-hybrid damage**
(effect **12897**, `eliteBonusCommandShipMediumHybridDamageCS1`, reads `eliteBonusCommandShips1`=10 →
×1.5 at all-V). The stale `Pyfa-master` clone has no `Effect12897` class → drops the whole CS weapon
bonus → 800. **Against `Pyfa-268` eos gives 1199.6 and agrees with us exactly.** Same story for the
Republic Defense Booster II resist effects (12822/12823): implemented in v2.68, so eos matches our
shield em 4 / hull em·th 35.7·34.3 / armorRep 1668.3 once the clone is current. These are **not** pyfa
gaps — the `known_gaps` annotations that used to live in the astarte spec were removed.

**Takeaway:** when the oracle flags a delta, first check the clone version. Only if a version-matched
clone still disagrees is it worth asking *which side is missing the effect* — run `node
scripts/pyfa-effect.mjs <id>` and `grep "class Effect<id>" Pyfa-268/eos/effects.py`.

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
