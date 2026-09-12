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

## MutaMarket integration — verified against the live API, September 11 2026

Owen authorized starting the MutaMarket tie-in. `src/lib/mutamarket.js` (pure: query building +
conversion) and `src/lib/mutamarket-contracts.js` (ESI station join) exist and are covered by the
suite. **No UI is wired yet** — the `MutaMarket / Not connected` row in
`src/components/abyssal-sources.jsx` is still the seam to connect.

**MutaMarket removes the need for the Axis-hosted contract index** proposed further down this file.
It already indexes every publicly contracted abyssal module, needs no key or account, and filters by
type, attribute, meta group, price, contract cleanliness and region.

Verified live, not assumed:

- **Abyssal type coverage is exactly 1:1.** All 89 dynamic result types in `mutaplasmids.json`
  (`m.r`) match MutaMarket's `type_id` in both directions. No mapping table. Pinned by the suite.
- **Rolls convert with no mismatches** across 503 live listings over six types, once `is_derived` /
  `is_virtual` attributes are dropped. Values land inside `mutaplasmids.json` ranges.
- **`contract.id` IS ESI's `contract_id`** — 400 of 400 sampled ids matched, prices identical. This
  is what makes station resolution possible.
- **MutaMarket's `id` IS the EVE `item_id`**, the same key space as an imported asset, so a listing
  can be recognised as a module the user already owns.

### Four traps, each already cost a probe to find

1. **Only the LAST `attributes/` segment is applied.** Stacking two does not intersect and does not
   error — it returns rows violating the earlier filter. `mutaMarketQuery` refuses more than one;
   narrow further on-device.
2. **`public_asset.price` is `0.0` for any uncontracted module.** Zero is not free. Only a clean
   `item_exchange` contract (one abyssal module, no other items, no PLEX, not asking for items)
   yields a price; everything else must be null. `estimated_value` is MutaMarket's model and is
   carried separately so it can be labelled as an estimate.
3. **No station below region.** `region_id` is the finest MutaMarket filter and its contract payload
   has no station, so Jita 4-4 comes from joining ESI's public contract list. Owen chose this over a
   region-only label. It matters: of 400 clean Forge listings, 371 were Jita 4-4 and 29 were not.
   An unresolved contract must stay `null` — never folded into a station match.
4. **No CORS headers**, same as ceve-market: fine in the installed app via CapacitorHttp, blocked on
   the dev server, which needs a proxy before Owen can review it. Registered in `check-offline.mjs`.

Cost is low: the whole Forge contract index is ~35 pages / ~35,000 contracts in ~2.1s at 8 pages in
parallel, cached 30 min by ESI and reused for the session. A partial index is refused outright — a
dropped page is indistinguishable from "those contracts are elsewhere" and would silently hide real
Jita listings, the same rule `scanAbyssals` applies to asset pages.

MutaMarket's legal page states no API terms, licence or attribution requirement — only that it is a
personal project by Nicolas Kion provided as-is. Their docs ask for an identifying User-Agent with a
contact address (`MUTAMARKET_USER_AGENT`) and no tight-looping `POST /modules`, which Axis never
calls. Their `documentation/api-modules` page 404s; `/api/openapi.json` is the reliable reference.

Validation: `npm run verify` passed all **1,601** checks (1,563 before, 38 new). Teeth proven by
reverting three fixes and watching the suite fail: dropping the derived/virtual guard, falling back
to `public_asset.price`, and defaulting an unresolved station to the requested one. No live ESI
login, no UI, and no native build were exercised in this pass.

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

> **Superseded for discovery.** MutaMarket already maintains this index publicly, so the Axis-hosted
> service is not needed and nothing above authorizes building one. The ESI notes in this section are
> still live for a different reason: `/contracts/public/{region_id}` is what resolves a contract to
> Jita 4-4, since MutaMarket filters no finer than region. See the section above.

---

# Pick-up-here handoff — September 11, 2026

**Read this section first.** Everything above is background; this is the live state.

## State of the tree

Backlog items #9 through #19 are finished and committed on the branch **`abyssal-mutamarket`**, which
branches from `main` at `b1b02cb Record Android 1.25.1 release`. `main` itself is untouched. The
branch has **not been pushed** — do not push it, open a PR or merge it without asking Owen.

Three commits, split by layer so a piece can be reverted on its own:

1. `08febae` — the MutaMarket data layer (`src/lib/mutamarket*.js`, `market-settings.js`,
   `shopping-list.js`), the ESI station join, `scripts/check-offline.mjs`, the `vite.config.js` proxy
   and the regression checks.
2. `c39ee4e` — the UI: Variations, the source picker, the My Abyssals browser, the shopping-list
   sheet, and their `App.jsx` wiring.
3. `b97f3dd` — this handoff.

`npm run verify` is green at **1,783 checks** at the branch tip. Only the tip was verified; the two
earlier commits were not built in isolation.

Three untracked paths are deliberately left out of every commit: `output/` and `promotional-assets/`
(review screenshots) and `.claude/scheduled_tasks.lock`.

## The backlog, in Owen's words

Items #9–#19 are done. What is left:

- **#20** — *"revamp info sheet for abyssal modules with ownership/location/price/mutamarket
  link/ingame contract link/custom name field/anything else a user would want to look at"* and
  *"allow a user to save a custom abyssal module to their own abyssal collection via that module's
  info sheet"*. **In progress — see below.**
- **#21** — *"make the shopping list exportable as a pastable eve contract link list, so without
  authing a character…"*. Owen confirmed the target format:
  `<url=contract:30000142//235822605>Contract 235822605 (Abyssal Ballistic Control System) ISK 270,000,000</url>`
- **#22** — Fit value: include priced abyssals in the fit's total value, flag the unknowns rather than
  counting them as zero, badge where each price came from.
- **#23** — Handle being offline gracefully across every abyssal feature.
- **#24** — Document MutaMarket and ESI asset reading (README + the ESI settings page).
- **Deferred, awaiting Owen's call:** replacing "Favorites" with a tag system. That one needs a
  `src/lib/storage-migrate.js` migration; do not start it unprompted.

## #20 — exactly where it stands

**Done and verified.** `src/lib/shopping-list.js` now exports `abyssalProvenance(itemId,{owned,
listings,now})`, and `shoppingList()` has been rebuilt on top of it so the two screens cannot
disagree. The returned row shape is byte-identical to before. Seven new checks are in the `shopping`
group of `src/regression.test.mjs`; teeth were proven by inverting the OWNED-wins rule and watching
`a module in your hangar is owned even while its old contract is still live` fail.

The insight worth keeping: a roll's provenance is a **join on the EVE item id** between the owned
library (IndexedDB `axis-abyssals` / `modules`) and the listing cache (`axis-abyssals` / `listings`).
That join already existed inside `shoppingList`; the info sheet needed the same answer. `OWNED` beats
a live contract deliberately — a module in your hangar is not a purchase, whatever the market still
says about the contract it came off.

**Not started — steps B to F:**

- **B. `src/lib/abyssal-library.js`** — add `export const MANUAL_OWNER` (**one declarator per line**:
  `check-imports.mjs` reads exports by regex and only sees the first of a comma-separated
  `export const`), plus `customAbyssal(mod,{itemId,label,ownerName,locationName,now})` building a full
  library record, and `manualAbyssalId()` producing a synthetic **prefixed string** id that can never
  collide with a real EVE item id.
  Two reasons this shape was chosen: `mergeAbyssalScan` only reconciles rows where
  `old.characterId===character.characterId`, so a row with `characterId:MANUAL_OWNER` survives every
  asset scan untouched; and six separate display sites read `record.characterName`/`record.location`
  (`abyssalSourceTree`, `abyssalContainerGroups`, the library row subtitle, the library info block,
  the variations row, the sources sheet), so `customAbyssal` takes **already-translated display
  strings from the caller** rather than plumbing a marker through all six. The pure lib then needs no
  i18n import and the suite can pass explicit strings.
- **C. `src/lib/abyssal-store.js`** — `saveCustomAbyssal(record)` and `forgetAbyssal(itemId)`, so
  saving is reversible. Follow the `forgetCharacterAbyssals` transaction pattern at line 75: the
  shared `update()` helper only PUTs and never deletes, so delete paths are written out by hand.
- **D. Regression checks** for `customAbyssal` in a new group, each proven to have teeth by reversion.
- **E. New `src/components/abyssal-info.jsx`** exporting an `AbyssalInfo` panel: owner / location /
  last seen / availability, price (asking price, or `estimatedValue` **explicitly labelled as an
  estimate** — see trap 2 above), MutaMarket link via `mutaMarketUrl(slug)`, "Open in EVE" via
  `openContractWindow` gated on `UI_SCOPE`, the custom-name (label) field, and a "Save to My Abyssals"
  action when the roll is not already in the library. Keep it **out of `ui.jsx`**, which is 2,938
  lines and a named conflict hotspot.
- **F. Mount it at two sites.** `src/components/abyssal-library.jsx:165` — the `renderInfo` children
  block, replacing the existing inline owner/location/label block. And
  `ModuleInfoTab` at `src/components/ui.jsx:1523`, which today renders only `<ItemInfoPanel>` and
  shows no provenance at all — that is the "no price" sheet Owen saw. Its two call sites are
  `ui.jsx:2746` (modules) and `ui.jsx:2794` (drones); only the module one needs provenance.

Reference anchors: `ItemInfoSheet` `ui.jsx:1492` (renders the panel then `{children}`), the
My Abyssals toggle and `<AbyssalLibrary>` mount `ui.jsx:895–904`, `ModuleVariationsTab` `ui.jsx:1752`,
the variations provenance line `ui.jsx:2061`.

The reusable patterns for the link/contract actions are all in `src/components/shopping-list.jsx`:
`openUrl` (Capacitor `Browser.open` on native, `window.open` otherwise), `openContractWindow`,
`UI_SCOPE` gating, and the two-step clipboard fallback (`navigator.clipboard` needs a secure context,
which `file://` is not).

## #21 — the one detail that is not yet solved

The in-game link is `contract:<SOLAR SYSTEM ID>//<contract id>`, and `30000142` in Owen's example is
**Jita the solar system**, not a region and not the station. What the listing cache actually stores is
`stationId` (Jita 4-4 is `60003760`), resolved by `withStations` from ESI's
`/contracts/public/{region_id}` `start_location_id`. There is no system id anywhere in the pipeline
yet.

Do not guess one. Either resolve station → system through ESI `/universe/stations/{station_id}`
(the payload has `system_id`; cache it, and it is a public endpoint needing no auth), or — if Owen
prefers the smaller change — accept that the export only covers contracts whose station resolved and
map those. A listing whose `stationId` is `null` must not be exported with an invented system id;
`null` means *unknown*, never *Jita*. That rule is load-bearing throughout this feature.

`copyList` at `shopping-list.jsx:66` is the function to extend — it already has the clipboard
fallback and the "copied" flash. The export must work with **no character linked at all**, which is
Owen's stated point ("without authing a character"), so it cannot depend on `UI_SCOPE`.

## Rules that have already cost time here

- **`check()` in `regression.test.mjs` takes a RELATIVE tolerance, not absolute.** Always prove a new
  check has teeth by reverting the change and watching it fail.
- **`check-i18n.mjs` fails only on ORPHANED catalog keys, never on missing ones.** New `t()` strings
  are free. Editing an *existing* English string that is in the catalog orphans its 7 translations.
- **Never patch `App.jsx` or `components/ui.jsx` with scripted whole-span replacements**, and never
  use sed/python to write source files at all — it flips LF→CRLF and eats adjacent lines invisibly.
  Slicing "from this function to the next `function `" has already silently swallowed `ItemDetailSheet`
  once and the abyssal helper block twice.
- **Review on the dev server before shipping.** The synthetic library lives at
  `http://localhost:5173/abyssal-preview.html` — **Add sample modules**, then **Open Axis**, pick a
  hull, open an empty module slot, choose **My Abyssals**. 243 rolls, all at Jita 4-4
  (`locationId:'60003760'`), so the Jita filter legitimately changes nothing on this data — that is
  not a bug, it was checked.
- MutaMarket has **no CORS headers**, so it is blocked on the dev server and needs the `vite.config.js`
  proxy; it works natively via CapacitorHttp.
- Owen is on iPhone. Every release ships **both** platforms (Android GitHub APK *and* iOS TestFlight),
  patch bumps by default, and **never** a Play-signed AAB unless he explicitly asks.

## Codex continuation — September 11, 2026

The #20–24 implementation described above is now in the working tree on `abyssal-mutamarket`.
It has not been committed, pushed, merged, or released. The older “next action” sections above
describe the starting point; do not implement them again.

- **#20:** Shared `AbyssalInfo` lives inside the existing item info panel, with provenance,
  asking price versus labelled estimate, market/EVE links, custom labels, and reversible local
  custom-roll storage. Manual records have their own synthetic owner and cryptographic ID;
  asset scans cannot retire them. Editing a fitted roll clears its original physical item ID.
- **#21:** Shopping-list export produces EVE contract links without authentication. Public
  station lookups resolve and cache solar system IDs; unresolved locations are skipped visibly,
  never guessed. Duplicate contracts are exported once.
- **#22:** Fit stats and snapshot values include confirmed live asking prices. Owned/custom,
  expired, and unknown-price abyssals remain explicitly unknown (`+ ?`). Estimates, auction bids,
  and bundle totals do not become individual module values. Stats show price provenance.
- **#23:** Bounded network requests and offline guards preserve saved data. Market failures can
  fall back to selected listings already cached, respecting source filters and expiry. Offline
  status explains that availability is stale; local collection viewing/editing remains usable.
- **#24:** README and ESI settings explain optional access, local storage, MutaMarket and pricing.

Validation: final `npm run verify` passed after copy/link-layout polish, including the production
build and all 1,808 regression checks. Four critical invariants were mutation-tested in memory: independent
manual owner, copied mutations, rejecting unknown link systems, and owned provenance precedence.
Browser review covered owned/custom sheets at 390px and 320px, saving/renaming/removing a custom
roll, and the live market info sheet in dark and light themes. A live 10M ISK afterburner brought
the fit total from 9.20M to 19.20M. With no linked character, Copy EVE contract links produced
`<url=contract:30000142//235739208>Contract 235739208 (1MN Y-S8 Compact Afterburner) ISK 10,000,000</url>`.
Temporary custom record and fitted review module were removed; the isolated preview retains the
selected listing cache and MutaMarket source preference. User Chrome tabs were untouched.

Still needs device validation before release: iPhone keyboard/safe-area behavior, native
Capacitor network/offline behavior, actual EVE window opening with a scoped character, and
snapshot export visual review. Offline failure behavior has automated coverage, not a physical
airplane-mode test. The deferred tags migration remains deferred. Leave unrelated `.claude/`
lock, `output/`, and `promotional-assets/` artifacts alone.

### Owen's pre-push review fixes — September 11, 2026

All nine requested changes are implemented locally, still uncommitted/unpushed:

- Removing a mutaplasmid clears its item ID. `variationItems` also ignores stale provenance on
  unmutated legacy modules, so the baseline gets the stock price and the original roll is selectable.
- Info badges distinguish Owned, locally saved Custom, and MutaMarket; listing badges distinguish
  item exchange, auction, and multi-item contracts (a multi-item auction gets both relevant badges).
  Auction bids and bundle totals have explicit labels and remain excluded from confirmed value.
- `showAuctions` is independent of `allContracts` (the single-item/all choice), defaults false,
  persists through settings normalization, and is enforced on live and cached listings. Client-side
  checks defend against MutaMarket ignoring a filter segment.
- Heat Damage and Overload Speed Factor Bonus are excluded from sortable attributes. Their normal
  item stats remain available. Stock modules ignore the abyssal budget, including officer modules.
- Sorting no longer narrows network requests against the fitted attribute. Explicit attribute locks
  still filter locally. The bounded listing-fetch budget and partial-result notice remain.
- Each live shopping-list contract has its own Copy EVE contract link action, alongside bulk copy.
- GraphTab now forwards `externalBursts` into outgoing projections and includes it in memo deps.
  Orthrus Warp Scrambler II range with a 33.75% Interdiction Maneuvers burst is 18,056.25m, matching
  the fitted info value (13,500m without it). The user's exact saved Malediction graph was not opened.
- Fitting probes divide effective costs by raw type costs, not `getBase()`: bomber PreMul bonuses
  already alter that base. The old denominator incorrectly returned 1,538.1 MW for Torpedo Launcher II
  instead of 5.38335 MW on a Hound. The regression sweep now covers all 21 launcher variants on
  Hound, Manticore, Purifier, and Nemesis in addition to the existing hulls.

Final `npm run verify` passes (production build and 1,834 checks); `git diff --check` is clean.
In-memory reversions demonstrated failures for the bomber denominator, stale item identity, and
auction exclusion. Browser review used the existing source sheet/info/shopping components:
390px dark/light source controls, dark info badges, 320px shopping actions, live single/bulk EVE
link copying, mutaplasmid removal returning to a 32.95k stock baseline, and an 8.75B stock officer
module visible under the 250M abyssal ceiling. Hound browser showed regular torpedo launchers in
normal text and capital launchers red. Auction/bundle filter combinations have automated coverage;
their info-badge combinations have not all been visually checked against live listings.

### Badge/switch polish and explicit price units

Info and Variations now share `source-badge.jsx`: MutaMarket keeps the existing green badge,
Owned uses the same style in accent blue. Source selection is labelled My Abyssals. Multi-item
contracts and Auctions use independent accessible button switches matching Settings' track/thumb.
The max-price text field is numeric millions with `M ISK` outside it: 20 → 20M, 2000 → 2B.
Blank means Any; the existing slider bounds remain. `parsePriceMillions` has conversion, blank,
and invalid-unit checks. Verification passes 1,837 checks. Browser review covered 390px dark/light
source controls, 320px dark controls, 20/2000 input and switch independence, and the shared market
badge in the actual info sheet. No push or release has been performed.

### 1.25.2 release authorized

Owen approved shipping all work and selected the original promotional icon for BOTH iOS and
Android, rejecting the separate Android adaptation. Launcher assets are generated by
`scripts/build-launcher-icons.mjs`; in-app marks, favicon and splash remain unchanged.
Full verification passed 1,837 checks. Cumulative notes since 1.22.6 are in
`docs/whats-new-1.25.2.md`. Release results will be recorded after publishing.

### 1.25.2 shipped

- PR #71 merged to main at `b5a1b4bf65090b058d4da9ce55ee44aec6d52025`; both CI jobs passed.
- Android 1.25.2, versionCode 95: https://github.com/rexmikakka-bit/visviva/releases/tag/android-1.25.2
  APK metadata was verified with aapt2; uploaded SHA-256 matches the local build:
  `95531f4af3290b90de655ff76ea5abb30781bf63ccbd6ea6d470deb85ee913f2`.
  Packaged launcher pixels match the approved original artwork.
- iOS 1.25.2, build 121: https://github.com/rexmikakka-bit/visviva/actions/runs/34676759783
  Completed successfully; upload log says `UPLOAD SUCCEEDED with no errors`.
  App Store Connect processing/tester availability was not separately checked.
- Android notes were corrected to cover **since 1.25.1** (`docs/android-release-1.25.2.md`).
  The App Store submission notes remain cumulative **since 1.22.6** (`docs/whats-new-1.25.2.md`).
- The rejected Android adaptation, `.claude` lock and `output/` scratch artifacts remain untracked.

### Post-release contract access and price polish (September 12)

Local branch `codex/contract-access-price-polish`, not released:
- Shopping List now selects a character with UI scope, retaining an explicitly selected
  authorized character. Previously reauthorization appended its character to storage while
  the sheet used the first character, leaving contract access apparently unchanged with
  multiple characters. The picker contains only authorized characters; login errors are
  surfaced in the sheet and offline authorization is disabled.
- Standard Fit Value rows omit source subtext entirely; abyssal provenance remains.
- ItemPrice and AbyssalInfo share `price-card.jsx`. Confirmed MutaMarket asking prices sit
  after the description with the standard card styling and compact ISK formatting.
  Auction bids, bundle totals, estimates and unknown prices retain their distinct meaning.
- `npm run verify` passes all 1,842 checks, including five character-selection regressions.
  Actual info sheets compared at 390px in dark/light; abyssal card also inspected at 320px.
  Standard Fit Value module breakdown was checked via rendered DOM: name and price only.
  Native SSO round trip still requires device verification; the detected selection bug is
  covered locally. Browser used the existing saved MutaMarket listing after a live 404.
  Screenshots: visualization directory for this task, `price-standard-{dark,light}.png`,
  `price-abyssal-{dark,light,narrow}.png`. Temporary in-app fit `Price review` deletion was
  attempted, but browser timed out before cleanup could be confirmed.

### iOS 1.25.3 device review build uploaded

Owen requested an iOS patch to test these fixes. Commit `9c3432a` was pushed on
`codex/contract-access-price-polish` and built directly from that branch, pending
device login verification before merging. iOS **1.25.3 (122)** upload succeeded:
https://github.com/rexmikakka-bit/visviva/actions/runs/34680074341
The log confirms `UPLOAD SUCCEEDED with no errors`. Apple processing and tester
availability have not been independently verified. Android remains 1.25.2 (95).

### Android 1.25.3 shipped after device approval

Owen confirmed the iOS fixes look great and work correctly, then authorized Android.
PR #72 merged to main at `692db3d`; both CI checks and local verification passed
(1,842 regression checks). Android **1.25.3 (96)** is published:
https://github.com/rexmikakka-bit/visviva/releases/tag/android-1.25.3
APK package/version metadata verified with aapt2. GitHub asset SHA-256 matches local:
`80396022e64041467b3ce0cade809cb4d6cce3b7bb0c9fe34feff823b7d8d0aa`.
Notes are in `docs/android-release-1.25.3.md`. iOS remains 1.25.3 (122).
