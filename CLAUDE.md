# Vis Viva — EVE Online fitting calculator (mobile)

A React + Vite ship-fitting calculator for EVE Online, targeting mobile. It reimplements pyfa's dogma
engine in JavaScript. **pyfa v2.67.0 with all skills at V is the reference implementation** — when our
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

### ⚠️ The implant-set asymmetry — do NOT "fix" this

Asklepian and Nirvana have **byte-for-byte identical dogma structure** (per-member bonus attribute +
an `ImplantSet*` multiplier on all six members, applied via a PreMul effect the dispatcher skips), yet
they empirically require **different set products** to match pyfa:

| Set | Bonus attribute | Set product | Validated against |
| --- | --- | --- | --- |
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
data: EVE client build 3383521 (SDE 2026-06-09) — matches validated baselines
```

We are currently on **pyfa v2.67.0 / client build 3383521**. When you move to a newer `eve.db`, the
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
