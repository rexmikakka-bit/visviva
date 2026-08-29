# Data pipeline — art, bundle generation, eve.db upgrades

> Referenced from the top-level `CLAUDE.md`. Read this when regenerating art or the dogma bundles,
> or upgrading to a new `eve.db`.

## Art is bundled, not fetched

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

Five traps here:

- **Files under `renders/` and `hero-renders/` are JPEG bytes with a `.png` name.** CCP's render
  endpoint serves JPEG (the icon endpoint still serves PNG). The extension is kept so `icons.js`'s
  globs stay single-format, and browsers dispatch on content sniffing rather than the name.
  `hero-renders/` has been like this since it was created. Nothing is lost: pyfa's renders were
  colour type 2 (RGB, **no alpha**), so there was never transparency to preserve.
- **Icons are keyed by iconID; the image server is keyed by typeID.** 16,829 types share 2,419
  icons, so fetching per type would be ~97 MB of near-identical art. `fetch-art.mjs` fetches one
  representative type per iconID (falling through to siblings if it 400s) and saves `<iconID>.png`.
- **WHICH representative matters — the image server bakes the META-GROUP BADGE into the picture.**
  Ask it for a Storyline type and the PNG arrives with the green corner marker burned in. One file
  serves every type on that iconID, so taking whichever member came first badged 73 icons: iconID
  26547's first member is the *'Basic'* Reactor Control Unit, so every RCU in the app — T1 included —
  wore a Storyline marker. `metaRank` in `fetch-art.mjs` now prefers Tech I, which is never badged.
  pyfa's art carried no badges at all, which is why this only appeared when the source changed.
- **The image server serves the WRONG picture for the 32 classic combat boosters.** Each is built
  from a *"Pure"* material of the same name, and the SDE gives the two different iconIDs (Standard
  Exile Booster 26613, Pure Standard Exile Booster 26426). The image server ignores that and returns
  one shared image for the pair, picking arbitrarily which rendition — Synth/Standard/Improved Exile
  come back as the material's **ore pile**, Strong Exile as the booster canister. The client shows
  the canister for all four, so pyfa's SDE art is correct; `src/assets/icons/` carries a hand-restored
  copy of it (32px, not 64) and `IMAGE_SERVER_WRONG` in `fetch-art.mjs` keeps `--force` off them.

  **The sweep that found it is worth re-running after any CCP art drop:** hash every file in
  `src/assets/icons/` and look for byte-identical files under *different* iconIDs. Distinct iconIDs
  mean distinct SDE art, so a collision is proof one of them is wrong. It turned "the Effects tab
  icon looks odd" into an exact list of 32. Three collisions remain and are **fine** — Advanced
  Planetology, the Medium/Large Asteroid Ore Compressors and Clone Vat Bay I are identical in pyfa's
  art too, i.e. CCP reusing one picture on purpose.
- **`type-icons/` is fetched from the RENDER endpoint, not the icon endpoint** — drones, fighters and
  deployables are 3D models, and for those the two endpoints serve the same picture except that the
  icon has the meta badge composited on. `metaRank` cannot help here (one type, one file), and CCP's
  badging of this set is simply wrong: Berserker I, Hornet I, Warrior I and Acolyte I are Tech I and
  came back wearing the green **Faction** corner. The render is badge-free at the same 128px, and all
  280 files were colour type 2 anyway, so the switch to JPEG cost nothing and halved the folder
  (2.42 MB → 1.1 MB).

  Related: CCP gave the three Acolytes iconID **1084** and gave every other drone none at all, so they
  were the only drones resolving through the shared-icon path — one badged picture for all three.
  `DRONE_ICON_IDS` (derived: every member in category 18/87) keeps such iconIDs out of `icons/`, so
  `eveIcon()` falls through to `type-icons/` and each Acolyte gets its own art.

## Regenerating the dogma bundles

**Never hand-edit the generated data files.** `dogma-types.json`, `dogma-effects.json`,
`dogma-attrs.json`, `ship-traits.json`, `type-descriptions.json`, `data-bundle.js` (5.8 MB),
`modules.json`, `module-variations.json` and `pyfa-types.json` are generated artifacts. A conflict
in them is unresolvable by hand.

```bash
python scripts/build-bundle.py --dry-run   # report what would change
python scripts/build-bundle.py             # write the bundles
npm test                                   # the full regression suite MUST still pass
```

It needs pyfa's `eve.db` (auto-detected in `Pyfa-master/`, or pass `--db`). Regeneration is
idempotent: hand fixes live in `scripts/data-patches.json` and are re-applied on every build.

**What eve.db cannot give you:** it has no effect `modifierInfo` and no `stackable` flag. Effect
modifiers are preserved from the existing bundle; a genuinely new effect is written inert and
reported loudly. Supply its modifier from CCP's FSD dump via `data-patches.json`, or write a custom
handler in `dogma-engine.js`. Only ONE hand patch remains: **effect 12887**, which CCP ships with an
empty modifier list.

### Two traps when regenerating `type-descriptions.json`

It is keyed off the emitted TYPES, *not* `fit_types`: `fit_types` requires `published=1`, and the 89
T3-destroyer tactical modes (Confessor/Svipul/Jackdaw/Hecate "… Mode") are unpublished yet fully live
— `calc.js` resolves them by typeID — so keying off `fit_types` silently drops their descriptions.
And hulls are deliberately excluded (`DESC_CATS` has no 6/65): a hull's description ships inside
`ship-traits.json` next to its trait bonuses. When you regenerate, diff against the previous file and
expect **zero** text changes beyond `\r\n` → `\n`; anything else means the extraction changed, not
the data.

### The old `update-from-evedb.py` was the source of nearly every data bug in this project

It only refreshed attributes a type *already had* (`for ak in list(ca.keys())`), so a newly-relevant
attribute could never appear — and it filtered everything through an `attr_allow.json` allowlist
that was never committed. That is why the Angel hulls were missing their −75% projectile reload
attribute, why the lance was missing its doomsday tick attributes (~1190 DPS on a Bane), and why
carrier hull bonuses, the Capital MJD skill and covert-cloak CPU were all silently inert.

`build-bundle.py` drops the allowlist and writes **every** attribute CCP defines on a fittable type
(+0.6 MB, ~75k attribute slots restored), and covers drones/fighters/structures, which the old
category filter excluded — fighter stats had been stale for months.

## ⚠️ `build-bundle.py` auto-detect could silently pick the STALE eve.db

The repo-root `eve.db` is a superseded leftover (client build **3383521**); the authoritative one is
the pyfa v2.68 install (**3424810**). `find_db()` probed the repo-root copy **first**, and the only
thing that had ever kept that from mattering was `Pyfa-master/` also existing. It carries no
`eve.db`, so a plain `python scripts/build-bundle.py` regenerated the entire bundle from the old
client build — reverting real attribute values (Aralez, Berserker SW-900, …) and invalidating every
validated baseline in one commit. The probe order is now installs-first, repo-root last.

**Always check the first two lines the generator prints** — it echoes the db path and client build.
If it does not say `3424810`, stop.

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

**When you upgrade eve.db, also upgrade the pyfa source clone the oracle uses, in the same commit** —
see the version-skew note in `docs/oracle.md`.
