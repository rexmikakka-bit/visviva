# Pyfa Backup Import — Design Spec

## Goal
One-way import of a user's pyfa fit collection into Axis. Not bidirectional sync — pyfa is a local desktop SQLite app with no API, so true live sync isn't feasible without a relay server + conflict resolution, which is out of scope for now. This is a batch importer.

## Source format
Pyfa's "Backup All Fittings" produces an XML file (`pyfa.xml`), NOT HTML. Pyfa also has a separate "HTML Export" feature, but that's for generating an in-game-importable link for a single fit — unrelated to bulk backup.

The XML backup is a flat list of `<fitting>` elements: a ship type and a run of `<hardware>` elements, each carrying a slot string and an item name.

Three corrections to earlier guesses in this document, all verified against `Pyfa-master/service/port/xml.py`:

- **Everything is referenced by NAME.** There is not a single typeID in the file.
- **Implants and boosters are never in it, and there is no export option that adds them.** `exportXml` takes no options parameter at all; it walks modules, drones, fighters and cargo and nothing else. There are no folders either. So the import UI must *state the limitation*, not tell the user to tick a box that does not exist.
- **Which module a charge was loaded into is not recorded.** `exportXml` sums every module's ammo fit-wide into one dict, folds the real cargo hold into the same dict, and emits the totals as `slot="cargo"`. A literal import therefore leaves ~93% of a real library reading 0 DPS.

Slot strings are `FittingSlot(n).name.lower()` with one special case: HIGH renders as `hi`. So `hi slot 0`, `med slot 0`, `low slot 0`, `rig slot 0`, `subsystem slot 0`, `service slot 0`, plus `drone bay`, `fighter bay` and `cargo`.

Abyssal modules do survive, as `base_type` / `mutaplasmid` / `mutated_attrs`. The last is `"cpu 22.9, power 1440"` — byte-identical to the third line of an EFT mutation block, because both come from `renderMutantAttrs()`.

Localized clients wrap every name as escaped markup inside the attribute value (`<localized hint="Maelstrom">Sturmwind*</localized>`); the hint is the official English name and the only thing a name lookup can resolve.

## Scale target
Design for ~1700+ fits (real number from current user), not just a handful.

## Architecture decisions

**Storage: IndexedDB, not localStorage.**
localStorage is sync (blocks main thread on large writes) and capped low (~5-10MB depending on platform). IndexedDB is async and has a much higher ceiling. Batch the 1700 fit writes into a single transaction rather than 1700 individual calls.

**Calc strategy: lazy, not eager.**
Import only parses and stores raw fit definitions (ship/modules/charges/drones). Do NOT run the dogma engine (skill pass + module pass + effects) on all 1700 fits at import time — even at ~10-20ms/fit that's 17-35s of blocking work, reads as a frozen app on mobile webview.

Note the parse half was **not** cheap until the name-lookup Map hoist landed: `tidByName` was a linear scan, and 39,654 `<hardware>` elements against it is quadratic. That hoist was done first, as its own change, precisely because it decides whether this needs chunked background work or just a progress bar. With it, chunked conversion with a yield every 100 fits is enough.
- Compute a fit's stats (DPS/EHP/etc.) only when the user opens it or it scrolls into view in a list.
- Cache the computed result after first calc.
- If instant visible stats across the whole list turn out to matter later, revisit with chunked background calc via `requestIdleCallback` or a Web Worker — not a v1 requirement.

**List rendering: virtualize.**
Don't render 1700 DOM rows. Only render what's in the visible scroll range; manual windowing is fine, doesn't need a library.

**Dedup: hash map, not pairwise compare.**
Key by `(shipTypeID, name)` (or normalized name for fuzzy match). O(n²) pairwise comparison is unnecessary overhead at this scale.

## Import flow / UX
1. File input (mobile webview supports standard `<input type="file">`) → user picks their pyfa XML backup.
2. Parse via `DOMParser`, no external XML lib needed.
3. Map item names/typeIDs against the existing bundled SDE data (already in Axis — no new data dependency).
4. Flag unmatched items (renamed/deprecated types — same class of issue as the phantom-type SDE bugs already handled elsewhere in the app).
5. Show import preview: bulk select-all by default, not per-fit checkboxes at this scale. Group by ship (or by pyfa folder structure, if the XML preserves it) so users can deselect chunks.
6. Progress indicator during write (even though it's fast, 1700 records isn't instant).
7. Dedup against existing Axis fits before writing (hash map lookup, see above).

## Explicitly out of scope for this pass
- Bidirectional/live sync with pyfa's local `saveddata.db`.
- Real-time conflict resolution between desktop pyfa edits and Axis edits.
- A relay server or shared-folder watcher (could be a v2 "sync-ish" feature via iCloud Drive snapshotting, but is a scope/positioning shift away from Axis's current "local calculator, no login" stance — which the Beta App Review notes currently lean on).

## As built

| File | Role |
| --- | --- |
| `src/lib/pyfa-xml.js` | The importer. `parsePyfaXml` (DOMParser, browser-only) sits on top of pure functions — `parseSlotAttr`, `parseMutatedAttrs`, `officialName`, `reloadCargoCharges`, `xmlFittingToImportShape`, `convertFitting` — which is what makes it testable in Node, where there is no DOMParser. |
| `src/lib/fit-entry.js` | `buildFitEntry`, hoisted out of `App.jsx`'s `importFit` so the bulk importer and the EFT/ESI paste path share exactly one assembler. |
| `src/components/backup.jsx` | The UI, inside the existing Backup & Restore panel rather than a screen of its own. |

Two decisions worth keeping written down:

- **We reload ammo from cargo; pyfa's own importer does not.** pyfa leaves the guns empty because the file genuinely does not say what was loaded — correct, but in a *fitting calculator* it means most of an imported library reads 0 DPS. `reloadCargoCharges` gives each empty charge-taking module one clip of the largest compatible stack in the hold, decrements by `floor(bay / (chargeVolume × chargeRate))`, and leaves real spares behind. The guess is surfaced ("N modules had ammo restored") so it is visible rather than silent.
- **Import merges, never replaces**, and routes through the existing `mergeFitsDB`. That already reallocates every id DB-wide and suffixes same-name fits — and it builds its name set *as it goes*, so the 22 duplicate `(ship, name)` pairs that exist inside a single real pyfa export get separated too. No second dedup was needed.

An unrecognised slot string resolves to `null` and the element is **skipped** — deliberately not treated as cargo, so a module can never quietly end up in the hold. Pinned, with the rest of the pure layer, in `src/regression.test.mjs` section 22.

## Relevant existing files
- `src/App.jsx`, `src/calc.js`, `src/dogma-engine.js` — most likely touch points.
- SDE bundle / `scripts/build-bundle.py` — source of typeID/typeName mapping for import matching.
