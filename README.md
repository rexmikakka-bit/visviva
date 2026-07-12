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

### Optional: local ship/module icons

The app falls back to CCP's image server for icons, so it works fine without this. For local icons,
put a pyfa checkout at `pyfa-master/` in the repo root. It's gitignored — never commit it.

### Optional: regenerating the dogma bundles

Only needed when moving to a new EVE build. Requires pyfa's `eve.db` (gitignored). See
**CLAUDE.md → "Upgrading eve.db"** before doing this — it is not a routine action.

```bash
python scripts/build-bundle.py --dry-run   # report what CCP changed
python scripts/build-bundle.py             # write the bundles
npm test                                   # baselines MUST still pass
```

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
