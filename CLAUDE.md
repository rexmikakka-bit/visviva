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

**This file is the always-loaded index.** Deep technical detail — full postmortems, evidence,
worked examples — lives in `docs/*.md` and is loaded on demand. Follow the pointers when you're
actually touching that area; don't read them as background.

| Doc | Read it when you're... |
| --- | --- |
| `docs/dogma-gotchas.md` | debugging a fit whose numbers disagree with pyfa, or touching `dogma-engine.js`/`calc.js` |
| `docs/data-pipeline.md` | regenerating art or the dogma bundles, or upgrading `eve.db` |
| `docs/oracle.md` | validating fits against pyfa's `eos` engine programmatically |
| `docs/esi.md` | touching character login, skill sync, or ESI fit import/export |
| `docs/release.md` | cutting an Android or iOS release |

---

## Before you change anything

```bash
npm run verify                    # the real gate: lint + imports + build + offline + effect coverage + regression
node src/regression.test.mjs      # just the suite — must print "ALL N REGRESSION CHECKS PASSED" (currently 1101)
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

**A pyfa SOURCE checkout** is needed only by the oracle and by `bundle-icons.mjs` (see
`docs/data-pipeline.md`). Take the source ZIP from <https://github.com/pyfa-org/Pyfa>, extract to
`Pyfa-master/`. Its version is enforced — see `docs/oracle.md`.

**`eve.db`** is needed only to regenerate the dogma bundles. It ships inside pyfa's **Windows release**
ZIP (a *different* download from the source above) at `app/eve.db`, from
<https://github.com/pyfa-org/Pyfa/releases>. Take the version the baselines were validated against.

You do **not** need `sqlite-latest.sqlite`, CCP's raw SDE dump. Nothing in this project reads it, and
pyfa's `eve.db` is a different, much more compact schema.

### Art is bundled, not fetched

Item and ship art is committed (~19.5 MB) so the app works fully offline. `node scripts/fetch-art.mjs`
regenerates icons/renders/type-icons from CCP's image server; it's idempotent, so a re-run after a
CCP art drop only costs the new files. Five sharp-edged traps (JPEG-as-.png, icon/render endpoint
mismatches, badge bleed, the 32 boosters with wrong art, drone icon collisions) are documented in
`docs/data-pipeline.md` — read it before touching the art pipeline, each one has already cost a
debugging session once.

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
| `src/lib/storage-migrate.js` | Versioned storage migrations, run on boot **before** React reads state. Bump `SCHEMA_VERSION` + append a migration whenever the saved-fit shape changes — see note below. |
| `src/lib/fits-store.js` | The saved-fit library, in **IndexedDB** (one record per hull). Settings stayed in localStorage; only fits moved. Loaded into memory by `main.jsx` before React mounts. |
| `src/lib/ship-taxonomy.js` | The nested ship-browser menu (Battleships > Faction Battleships > Pirate Faction). Pure + derived — see `docs/dogma-gotchas.md` gotcha 9b. |
| `src/data/dogma-*.json` | The dogma bundle: types, effects, attributes. **Generated + hand-patched** — see `docs/data-pipeline.md`. |
| `src/data/ship-traits.json` | Trait bonuses for Ships + Structures (with flavour description) and **T3 subsystems** (bonuses only — their description lives in `type-descriptions.json`, one source per string). **Generated** by `build-bundle.py`. A T3 cruiser's real bonuses live on the SUBSYSTEM, not the hull. |
| `src/data/type-descriptions.json` | Item flavour text for the info panel. **Generated** by `build-bundle.py` — two regen traps in `docs/data-pipeline.md`. |
| `src/data-bundle.js` | Legacy precomputed bundle (5.8 MB). Ship lists, module lists, meta labels. **Partly wrong — see `docs/dogma-gotchas.md` gotchas 9/9b.** |

### How the engine works, briefly

`AttrMap` keeps separate pools per attribute: `_base`, `_add`, `_post0` (op0 PreMul, penalised),
`_post4` (op4 PostMul, penalised), `_post` (op6 PostPercent, penalised), `_mul` (direct/unpenalised)
and `_force`. `applyMod(attrID, op, value, direct)` routes to the penalised or unpenalised pool.
Stacking factor is `exp(-(rank²)/7.1289)`, strongest first. Full stacking-group rules (which
operations share a penalty pool, which modules are exempt) are in `docs/dogma-gotchas.md`.

`Fit.calculate()` resets all attributes at the top, so it is **idempotent** — safe to call twice.
(`calc.js` relies on this for the RAH two-pass.)

Effects whose `modifierInfo` is empty in the bundle (`{"c":0,"m":[]}`) are CCP-applied effects that
were trimmed. They do nothing until someone populates the modifier or writes a custom handler.

### Where saved fits live, and the storage migration

**Settings are localStorage (`pyfa-*`); the FIT LIBRARY is IndexedDB** (`src/lib/fits-store.js`,
database `axis`, store `fits`), with no server either way. Fits moved out of the
`localStorage["pyfa-fitsdb"]` blob to make importing a pyfa collection possible: localStorage caps
around 5–10 MB and a real 1,744-fit pyfa backup is 3.78 MB in our slot shape.

Load-bearing rules:

- **One record per HULL, not per fit.** The value at key `"Rifter"` is exactly the array
  `fitsDB["Rifter"]` already held. Keying per fit would mean keying on `fit.id`, which is only
  unique *by construction* — `mergeFitsDB` has already shipped an id-collision bug once.
- **Writes are diffed by REFERENCE identity** (`diffFitsDB`). `prev[ship] !== next[ship]` names the
  changed hulls with no deep compare. If a future edit path mutates a hull array in place instead of
  replacing it, the write is silently skipped — section 9b2 of the suite pins the contract.
- **`main.jsx` loads the library before mounting React.** `initFitsStore()` fills an in-memory
  snapshot that `getLoadedFitsDB()` returns synchronously, since `App.jsx` reads fits inside
  `useState` initialisers and IndexedDB can't serve that. Falls back to the old localStorage blob if
  IndexedDB is unavailable (private mode, blocked upgrade).

The **backup file format is unchanged** — fits still travel under the `pyfa-fitsdb` key — so a file
written now restores on a build that kept fits in localStorage, and vice versa.

**Changing the saved-fit shape still means appending a migration.** `src/lib/storage-migrate.js`
stamps a `SCHEMA_VERSION` and runs ordered migrations on boot, **before** React reads any state —
otherwise an old saved fit deserializes into new code and crashes on render ("the app ate my fits").
Bump `SCHEMA_VERSION` and **append** (never reorder/renumber). Keep each migration total and
defensive (wrap `JSON.parse` in try/catch) — a throw there is the exact failure it exists to prevent.

⚠️ **A migration reaches the fits through `external`, not through localStorage.** `migrateLocalStorage`
takes `{external: {"pyfa-fitsdb": <blob>}}` and hands the migrated blob back for `main.jsx` to persist
to IndexedDB. Drop that and a fit-shape migration runs against a store with no fits in it and
silently does nothing — pinned by the `external:` checks in section 9b.

---

## Hard-won gotchas index (read this before debugging a fit)

Full evidence, worked examples and the specific fits that caught each of these:
**`docs/dogma-gotchas.md`**. One-line summary of each:

1. `numShots` is not a stored attribute — use `clipSizeOf()` in `calc.js`.
2. Booster (drug) bonuses are their own unpenalised stacking group; passive resist boosters need `direct=true`.
3. The RAH adapts to POST-command-burst resonances — needs a second `calculate()` pass with `fit._rahArmorBurstEff`.
4. Beam-type super weapons (Lancer, titan Reapers, Bosonic Field Generator) tick — DPS = perTick × ticks / duration.
5. Group modifiers can target a CHARGE's group (e.g. the Minokawa's C5 bonus) — read the engine-computed charge, not raw type data.
6. Attributes have non-zero defaults — filter set members by attribute presence, not truthiness.
7. Validate through `calcFitStats`, not a raw `Fit` harness — unset skills default to V.
8. `ships.json`'s `hullClass`/`race` are wrong for dozens of hulls — use `TYPES[id].gn` + `classifyHull()`, never a hand-listed table.
9. `data-bundle.js`'s `meta`/`shipsByClass` are wrong/incomplete — derive meta from `mg`, classification from `TYPES`, faction from `factionID` not `raceID`.
10. Structures: skills apply to fitted modules, never to the hull's own stats; `domain='structureID'` is self-reference, not a projected target; structure charges need no skills (missile range).
11. Fighters bypass the dogma engine — skill bonuses are hand-applied in `calc.js`, gated on the fighter requiring the skill (Standup fighters require none).

Also in that doc: the `SKILL_DEFAULTS` vs `SKILL_CATALOG` split, per-fit pilot resolution
(`slots.pilot`), T3D tactical modes being `published=0`, the full stacking-group rules, the five
implant sets, remote-rep diminishing returns, environment effects, and a testing landmine about
`check()`'s relative tolerance.

### pyfa's source is the reference — read it instead of guessing

pyfa is open source and hand-implements every effect CCP ships with an EMPTY modifier list, keyed by
ID (`class Effect12887` in `eos/effects.py`). Those empty effects are silent no-ops in our engine
until a fit comes out wrong.

```bash
git clone --depth 1 https://github.com/pyfa-org/Pyfa.git pyfa-master   # source, not the release build
node scripts/pyfa-effect.mjs 12887     # how pyfa implements one effect
node scripts/pyfa-effect.mjs --check   # verify our data-patches against pyfa
node scripts/pyfa-effect.mjs --gaps    # empty effects pyfa implements (a triage list)
```

**Do not treat `--gaps` as a bug list.** ~120 effects are empty in our bundle and implemented by pyfa,
but most are activation markers (`useMissiles`, `armorRepair`, MWD/AB) that we handle in `calc.js` by
group/attribute rather than by effect ID. Check how we already handle that module class before
"fixing" anything.

pyfa's source also settles DISPLAY questions, not just mechanics — e.g. its drone list shows tracking
normalised to a 40,000 m reference signature, which is why the attribute panel and the drone list
show different numbers for the same drone. Both are correct; they're different quantities.

---

## Merge hazards (multi-person repo)

**Never hand-edit the generated data files.** `dogma-types.json`, `dogma-effects.json`,
`dogma-attrs.json`, `ship-traits.json`, `type-descriptions.json`, `data-bundle.js`, `modules.json`,
`module-variations.json` and `pyfa-types.json` are generated artifacts. A conflict in them is
unresolvable by hand — regenerate instead (`docs/data-pipeline.md`).

- **The `App.jsx` split already happened.** It was ~4,400 lines; it is now ~620 and holds state,
  effects and composition only. The UI lives in `src/components/` (`ui.jsx`, `tabs.jsx`,
  `GraphTab.jsx`, `snapshot.jsx`, `effects.jsx`, `FittingsScreen.jsx`, …) and `src/lib/`. Do not
  reintroduce view code into `App.jsx`. `calc.js` (~3,260) and `ui.jsx` (~1,610) are now the two
  files most likely to conflict.

- **Prefer targeted diffs over whole-file rewrites.** An agent handing back a whole file silently
  reverts whatever a teammate changed in the meantime.

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

## Two landmines that have cost real time

- **`check()` in `regression.test.mjs` takes a RELATIVE tolerance**, not absolute — see the note in
  `docs/dogma-gotchas.md`. Always prove a new check has teeth by reverting the fix and watching it fail.
- **Do not patch `App.jsx` or `components/ui.jsx` with scripted whole-span replacements.** Slicing
  "from this function to the next `function `" silently swallows `export function` declarations
  and top-level `const` blocks sitting between them; it removed `ItemDetailSheet` once and the
  abyssal helper block twice. Worse, recovering the span from `git show HEAD` restores the
  *committed* version, quietly reverting any uncommitted work in it — a diff against HEAD will not
  show what you lost. Prefer targeted edits, and after any bulk patch diff the function inventory:

  ```bash
  diff <(git show HEAD:src/components/ui.jsx | grep -o "^\(export \)\?function [A-Za-z]*" | sort)        <(grep -o "^\(export \)\?function [A-Za-z]*" src/components/ui.jsx | sort)
  ```

---

## Other reference docs

- **`docs/data-pipeline.md`** — art bundling traps, regenerating the dogma bundles, the stale-eve.db
  auto-detect trap, and the full "Upgrading eve.db" process for a new EVE patch.
- **`docs/oracle.md`** — driving pyfa's `eos` engine directly to validate fits programmatically,
  sweeps, the skill sweep, and the version-skew trap.
- **`docs/esi.md`** — character login, skill sync, in-game fit import/export.
- **`docs/release.md`** — cutting an Android or iOS release, version numbering, Play signing, the
  iPad-orientation App Store rejection trap.
