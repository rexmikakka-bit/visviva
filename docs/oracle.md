# The oracle — driving pyfa's `eos` engine directly

> Referenced from the top-level `CLAUDE.md`. Read this when validating a fit or a batch of fits
> against pyfa's own engine instead of doing it by hand in the GUI.

Built 2026-07-17. An automated oracle drives pyfa's calculation engine as a Python library and diffs
its numbers against ours, instead of validating one fit at a time by hand in the GUI. Lives in
`scripts/oracle/`.

```bash
/c/Python314/python scripts/oracle/oracle.py --list      # available fit specs
/c/Python314/python scripts/oracle/oracle.py bane        # eos stats + diff vs our baseline
```

## Sweeps: diffing HUNDREDS of fits at once

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

## The SKILL sweep — a different question from the fit sweeps

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

## How the headless bootstrap works (the non-obvious bits)

`eos_bootstrap.py` wires eos headless; `oracle.py` builds a fit from a spec (ship + modules + charges
+ drones + implants + boosters + all-skills-at-V) and prints `getWeaponDps()`, `getWeaponVolley()`,
`getTotalDps()`, `ehp`, `capDelta`, `maxTargetRange`, `scanResolution`. **Proven:** the Bane spec
reproduces our baseline exactly — eos weaponDps 13301.28 (ours 13301), volley 180870.16 (ours 180870).

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

## ⚠️ The oracle is not infallible — pyfa has its own bugs

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
