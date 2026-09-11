# Abyssal library handoff

Last updated September 11, 2026. Owen approved the refined interface and requested merging
all current feature work to main, followed by an iOS-only 1.25.1 release.

## Branch and releases

- The reviewed `codex/abyssal-library` work is merged into `main`, including its earlier
  ammo comparison changes. Continue new source-editor/MutaMarket work from main.
- `b27c3b5` introduced the multi-character abyssal library.
- iOS **1.25.0 (119)** was built from that commit and uploaded successfully to TestFlight:
  https://github.com/rexmikakka-bit/visviva/actions/runs/34566578893
- Owen enabled `esi-assets.read_assets.v1` on the existing EVE developer application after an
  `invalid_scope` error. He confirmed real authentication and seeing his character's modules on his phone.
  Do not change the client ID or callback URLs. Additional characters need the optional asset grant.
- iOS **1.25.1 (120)** includes the reviewed browser/comparison improvements below.
  It was built from main commit `e6ab37d` and uploaded successfully on September 11, 2026:
  https://github.com/rexmikakka-bit/visviva/actions/runs/34577722830
  The log confirmed **UPLOAD SUCCEEDED with no errors**. Apple processing/tester availability
  was not checked. Local `npm run verify` passed all **1,563** checks; main CI also passed:
  https://github.com/rexmikakka-bit/visviva/actions/runs/34577711842
- Owen subsequently requested Android **1.25.1 (94)** as well. It is published from main
  commit `456504d` at https://github.com/rexmikakka-bit/visviva/releases/tag/android-1.25.1
  with `Axis-1.25.1.apk`. All 1,563 verification checks passed, Gradle completed successfully,
  and aapt2 confirmed the APK's versionName/versionCode. The uploaded SHA-256 matches the
  local APK: `5cdd4fb06a3a9f23ee0a581a520db2ee4d04445d880f978315d5488d8f9656bc`.
  This is the standard sideload APK release; no Google Play upload was performed.
- Revised README with AI disclosure is now on main as `99e1b0c` (cherry-picked from `1b1f82f`).
  Earlier ammo changes remain in this feature branch's ancestry; do not accidentally drop them.

## What is implemented

Empty module slot → My Abyssals. Scan a linked character's personal assets, select locations,
then import the raw rolls into a local IndexedDB library (`axis-abyssals`, separate from fit DB).
Characters across accounts share one local library; importing character is separate from fit pilot.
Each record keeps its unique item ID, owner, container/location, original type, mutator, exact raw
attributes, last-seen timestamp, label, favorite, and availability flag.
Transfers update ownership without duplicating records. Missing items remain usable and flagged.
Fitting copies the roll into the fit. Library refresh cannot change saved fits. The picker prevents
adding the same unique item twice, and owned weapons do not auto-fill an entire rack.

Files: `src/lib/abyssal-library.js` (pure conversion/merge), `abyssal-import.js` (ESI scanning,
retry/cancel/batching), `abyssal-store.js` (IDB), `src/components/abyssal-library.jsx` (UI).
`docs/esi.md` has details. Personal modules only, not corporate assets or abyssal drones.
Library records/labels/favorites are NOT included in fit backups yet. Fitted rolls retain existing
fit backup behavior. Structures without resolved names display IDs. ESI caching delays updates.

## Most recent appearance changes

Owen said the initial library looked unlike the rest of Axis and asked for the same layout as the
module and variations browsers. The library now renders the actual shared `ModRow` from `ui.jsx`:
icons, name, PG/CPU glyphs and rolled values, grade badge, info button, separators, and row tap to fit.
Rolled non-resource stats wrap horizontally using variations-style spacing. Owner/location is
subtext; the info button expands identity, full location, label, and favorite controls.
Import/auth controls collapse above the library when it contains records. Filters are more compact.
`FitCost` now respects `item.mutations` so it never displays the unrolled fitting costs for these rows.

Validation: `npm run verify` passed **all 1,526 regression checks** after these UI changes.
Browser checked at 390×844 with the actual ModuleBrowserSheet, including row fitting, duplicate
prevention, and expanding details. Owen has not yet given feedback on this revised appearance.
No release or automatic version bump is requested yet.

### September 11 consistency review (local, uncommitted)

Follow-up review retained shared `ModRow` rendering and aligned the surrounding UI:
navigation now follows the browser's left-aligned back/category treatment; filters use
variations-style toggle buttons; module/attribute selects share one bounded-width row
using the compact select treatment from GraphTab. Count and toggles share the line above.
Import no longer shows a dangling separator without a character, empty results use the
browser's centered treatment, and label editing retains a 16px input font for mobile.

`AGENTS.md` and the UI section in `CLAUDE.md` point future sessions to
`docs/ui-conventions.md`: identify an existing screen, reuse its components, and compare
the rendered result separately from functional verification.

Validation: `npm run verify` passed all 1,526 checks. Compared standard module rows with
the library in the real app at 390 x 844 in dark/light, inspected active filters in Amarr,
Sansha, and Intaki, and checked expanded long module/location content at 320 x 844
(document width stayed 320px). Checked favorites, CPU sort reversal, empty search,
unlinked import controls, keyboard fitting, and the fitted item's disabled duplicate
state. Undid the test fitting change and restored Dark. Used existing preview records;
no real ESI login, live scan/loading/error, or physical iOS keyboard test in this pass.
The revised appearance still awaits Owen's review. No release or push performed.

### September 11 organization follow-up (local, uncommitted)

Owen liked the consistency changes and requested two organization modes and visible
favorites. The library now has **Browser** (Owen's requested label) and **Containers**:

- Browser reuses the standard module market tree, including its synthetic propulsion
  size groups, pruned to owned items. Counts are physical modules, not distinct types.
  `ModuleGroupRow` is shared with the standard browser, like `ModRow` already was.
- Containers groups by owner ID + immediate location/container ID, showing full location
  and owner. Same-named containers stay distinct; IDs disambiguate duplicate labels.
  Unavailable records retain their last-known group and warning.
- Both views and search strictly filter to the opened slot group. Removed **All slot
  types** and the redundant module-type dropdown. Search spans that slot's library.
- Every module row now has a visible star: outlined to add a favorite, filled to remove.
  The Favorites button filters either view. The star is separate from the fit action.
- Opening **My Abyssals** carries over the standard browser's current market-group path
  (e.g. Electronic Warfare / Warp Disruptors). Empty owned categories still show their
  breadcrumb and Back. Returning to the standard browser preserves its place.
- Pure grouping/navigation helpers live in `src/lib/abyssal-browser.js`. No storage
  migration or ESI changes. The preview now uses distinct owner IDs and two container
  locations, so it exercises the grouping honestly.

Validation: all **1,543** checks passed via `npm run verify`, including catalog totality,
multiple rolls per type, off-market fallback, slot restriction, container identity,
and empty-group breadcrumbs. Browser checks covered actual Warp Disruptors handoff,
empty ECM Bursts handoff, Back/Escape, container counts, favorites toggling and persistence
across reload, empty favorites, slot-wide search, and exclusion of afterburners from the
high-slot browser. Inspected dark/light at 390px and expanded content at 320px with no
horizontal overflow. Earlier live-ESI/native-keyboard verification gaps still apply.

## Variations and info-sheet review — September 11, local changes

Owen authorized a provisional implementation of owned-roll comparisons, then requested
an abyssal toggle/source editor and a quieter, lower-profile toolbar. He approved the
refined appearance and requested including this work in the main merge and iOS 1.25.1.

- Variations uses the existing compact comparison rows with each physical owned roll
  represented separately. The fitted snapshot remains pinned; library refresh cannot
  overwrite its comparison baseline. Stock replacements clear the old roll and item ID.
- Attribute sorting compares displayed values (including inverted rate-of-fire values),
  preserves missing values/unknown prices at the end, and always displays the selected
  comparison attribute. Owned rolls do not inherit the stock item's market price.
- The sort control opens the existing `BottomSheet` with large choice rows. Both the
  library and Variations use `AttributeSort`; no native attribute-sort dropdown remains.
- The Variations toolbar has a small red triangle, pencil source editor, borderless sort
  label and direction arrow. Visible icons are small, with 44px control heights/targets.
  The triangle hides/shows abyssal candidates alongside stock variants; the fitted roll
  stays visible even when toggled off. Source selection offers all owned records or one
  owner/container, using owner/location IDs rather than display labels. Source selection
  and visibility are local to the mounted Variations view; attribute sorting persists.
- MutaMarket appears disabled as **Not connected** in the source sheet. Owen selected Owned
  modules and MutaMarket as the two sources; the separate public-contract option was removed
  before 1.25.1. No contract fetching, backend, or external source integration was added.
- Favorites have their own action outside the replacement target. Items already used in
  another slot are flagged and disabled; the update handler also rejects duplicate IDs.
  Replacement updates act on one slot rather than fanning a physical roll across an ammo rack.
- Owned-browser info uses the shared `ItemInfoSheet`/`ItemInfoPanel` with rolled base
  attributes, description, requirements and normal attribute sections. Inventory metadata
  and label editing sit below the info content. The old inline expansion was removed.
  Its separate 44px info target and adjacent dead space avoid accidental fitting near
  the glyph, while opening/closing info retains the browser search/path and scroll.

Validation: final `npm run verify` passed **1,563 regression checks**, including roll identity,
saved-baseline integrity, sorting, source isolation, missing containers and stock reversion.
Live synthetic preview checks covered owned-to-owned and owned-to-stock swaps, actual
fitting costs, container scoping, triangle on/off, occupied-item disabling, nested sheet
Back dismissal, and an edge click inside the enlarged info target without modifying the fit.
Inspected the existing Variations/BottomSheet layout in dark and light at 390px, plus dark
320px toolbar, sort and source sheets. Screenshots are in the current Codex visualization
output folder (`axis-variations-refined-dark.png`, `axis-variations-refined-light.png`,
`axis-mobile-sort-sheet-light.png`, `axis-abyssal-sources-320.png`, `axis-owned-real-info.png`).
Removed temporary fitted test modules and restored Dark theme and the browser's normal
viewport. Preview inventory remains for Owen's review. Actual iOS touch/native keyboard
and live ESI import were not re-tested; grouped weapon replacement was reviewed in code,
not exercised in a native build.

## Temporary local preview

`abyssal-preview.html` and `abyssal-preview.jsx` are a temporary Vite development page:
http://localhost:5173/abyssal-preview.html

Run `npm run dev` if necessary. Click **Add sample modules**, then **Open Axis**, choose a hull,
open an empty module slot, and select **My Abyssals**. It generates 243 synthetic records across
module types, three rolls each, with two Preview owners, favorites, and missing states.
No fake authentication tokens are created. Samples use the `axis-preview-` item-ID prefix.
The **Remove sample modules** button deletes only records with that prefix. It preserves real imports;
fits made using samples retain their copied attributes. Storage belongs to the browser and origin:
localhost and 127.0.0.1 do not share it. Seeded the Codex in-app browser at localhost:5173.

These root HTML/JSX files are not production entry points in the current Vite config, so the standard
build does not include the page. Remove them when Owen is done with the preview. They are retained
in the branch to survive a fresh session/checkout. Earlier hidden fixture files were removed.
An unrelated `.claude/scheduled_tasks.lock` is untracked: leave it alone.

## Future product decisions — discussion only, not authorization to build

Owen wants the player to choose the hull and module roles/layout. Do NOT build automatic whole-fit
optimization or rearrange co-processors, rigs, damage mods, etc. Desired future flow:
select a module → compare replacements in this fit → choose one → shopping/collection list.

- Pool owned modules across accounts; storage alts are a primary use case.
- Compare performance of individual replacements using the real fitting engine and pilot.
- Default to individually priced fixed-price contracts. Optional toggles can include auctions and
  multi-item bundles, but never misrepresent a whole contract's price as an individual item price.
- Jita 4-4 filter is important. Normal contract caching delays are acceptable; show last checked.
- Clearly flag unavailable fitted listings (red indicator + text); preserve the roll/fit. An in-app
  notice on refresh was suggested, not background notifications or a scheduled task.
- Owned/unknown prices should be clearly marked, not represented as trustworthy zero-value prices.
  A manual price override was discussed, not implemented.
- Never reuse the same unique physical item in two slots of one fit.
- Shopping list includes contract links for purchases and owner/container for existing modules.

## Market data feasibility research

MutaMarket is optional. Its documented public API needs no key/account, but live contract fields and
usage expectations still need checking before relying on it. No partnership was requested or contacted.
https://mutamarket.com/documentation/api-overview
https://mutamarket.com/documentation/api-filtering

ESI alone exposes regional public contract summaries, per-contract items (including item_id when
available), and dynamic rolled attributes. Live official schema was checked:
https://esi.evetech.net/meta/openapi.json
- GET /contracts/public/{region_id}: pagination, price, type, locations, expiry; cache 1800 seconds.
- GET /contracts/public/items/{contract_id}: paginated contents; cache 3600 seconds; can return 204
  for expired/recently accepted contracts. item_id is optional, so missing data must be handled.
- GET /dogma/dynamic/items/{type_id}/{item_id}: original type, mutator, raw attributes.

There is no server-side ESI search by contained module type/rolled attribute. Independent discovery
means scanning eligible contracts, inspecting contents, fetching rolls, and maintaining an index.
Suggested architecture: shared public Axis contract-index service, initially Jita 4-4, with private
inventory/fits and comparison computation remaining on-device. This would introduce hosting and
maintenance; no backend choice, cost commitment, implementation, or deployment is authorized yet.
