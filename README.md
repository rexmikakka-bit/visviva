# Vis Viva

An EVE Online ship-fitting calculator for mobile. React + Vite. It reimplements pyfa's dogma engine
in JavaScript, and **pyfa v2.67.0 (EVE client build 3383521) is the reference implementation** — when
our numbers disagree with pyfa, we are wrong until proven otherwise.

## Getting started

```bash
git clone https://github.com/rexmikakka-bit/visviva.git
cd visviva
npm install
npm test        # ALL 25 REGRESSION CHECKS PASSED  <- if this fails, stop and ask
npm run dev
```

That's the whole setup. `npm test` needs no build step and no local data files.

### Optional extras (the app works fine without these)

Everything below is **gitignored on purpose** — it's large, and it's all publicly downloadable, so
nobody needs to send you files.

**1. A pyfa checkout (only needed to REGENERATE the bundled art).**
Ship/module art lives in `src/assets/` and is committed, so the app works offline out of the box —
you do not need this to develop. You only need it if CCP adds new art and the assets must be rebuilt:
download the pyfa **source** ZIP from <https://github.com/pyfa-org/Pyfa>, extract it to `pyfa-master/`
in the repo root, then run `node scripts/bundle-icons.mjs` (it also needs `eve.db`, below).

**2. `eve.db` (only if you regenerate the dogma bundles).**
Not needed to run or develop the app. It ships inside pyfa's **Windows release** ZIP (a different
download from the source above), at `app/eve.db`. Grab **v2.67.0** — the version our regression
baselines were validated against — from <https://github.com/pyfa-org/Pyfa/releases>, and put
`eve.db` in the repo root.

You do **not** need `sqlite-latest.sqlite` (the raw CCP dump). Nothing in this project reads it.

### Regenerating the dogma bundles

Only when moving to a new EVE build. Requires `eve.db` above. Read
**CLAUDE.md → "Upgrading eve.db"** first — it is not a routine action.

```bash
python scripts/build-bundle.py --dry-run   # report what CCP changed
python scripts/build-bundle.py             # write the bundles
npm test                                   # baselines MUST still pass
```

### Art is bundled, not fetched

`src/assets/icons/` and `src/assets/renders/` are committed (~6.5 MB) and compiled into the build, so
the shipped app needs **no network** for images. Do not point the globs in `src/lib/icons.js` at
anything outside the repo — they used to point at the gitignored `pyfa-master/`, which meant every
release build silently fell back to CCP's image server.

About 1,000 types have no art in pyfa's set; those still fall back to the image server (fine online,
hidden offline).

## Before you open a PR

```bash
npm run verify
```

Runs everything CI runs: runtime-fatal lint, import-path resolution, production build, and the 25
pyfa-validated fit baselines. If it's green locally, CI will be green.

| command | what it does |
| --- | --- |
| `npm run dev` | dev server |
| `npm test` | 25 pyfa-validated fit baselines |
| `npm run check` | lint (runtime-fatal rules) + import-path resolution |
| `npm run build` | production build |
| `npm run verify` | all of the above — run this before pushing |

## Working on this

**Read [CLAUDE.md](./CLAUDE.md) first.** It documents the architecture, the layering
(`core -> ui -> tabs -> App`), and — importantly — the gotchas that have each cost a full debugging
session. A few that will bite you otherwise:

- `numShots` is not a stored attribute; clip size must be derived from the charge bay.
- Booster bonuses are unpenalised; module bonuses are not.
- Group modifiers can target a **charge's** group rather than the module's.
- Attributes have **default values**, so `getBase()` on an absent attribute returns the default, not 0.
- The Asklepian and Nirvana implant sets require **different** set products despite identical dogma.
  This is deliberate and validated against pyfa. **Do not "fix" it.**

### The regression suite is not optional

Every number in `src/regression.test.mjs` was validated by hand against pyfa. They are not "whatever
the code currently prints". If a check fails, you broke something real — do not update the expected
value to match your output unless you have re-checked against pyfa and can say why the old number was
wrong.

### Don't hand-edit generated files

`src/data/dogma-*.json`, `data-bundle.js`, `modules.json`, `module-variations.json` and
`pyfa-types.json` are generated. Regenerate them with `scripts/build-bundle.py`; hand fixes belong in
`scripts/data-patches.json`, which is re-applied on every build.

### Branch, don't push to main

Work on a branch, open a PR, let CI run. `App.jsx` and the data bundles are the files most likely to
conflict — keep changes to them focused.
