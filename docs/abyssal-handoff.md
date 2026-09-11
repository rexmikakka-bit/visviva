# Abyssal library handoff

Last updated September 11, 2026. Owen asked to park the work and resume in a new session.
No implementation or release is currently requested beyond this housekeeping.

## Branch and releases

- Continue in `codex/abyssal-library`. Feature work is pushed there, not merged to main.
- `b27c3b5` introduced the multi-character abyssal library.
- iOS **1.25.0 (119)** was built from that commit and uploaded successfully to TestFlight:
  https://github.com/rexmikakka-bit/visviva/actions/runs/34566578893
- Owen enabled `esi-assets.read_assets.v1` on the existing EVE developer application after an
  `invalid_scope` error. He confirmed real authentication and seeing his character's modules on his phone.
  Do not change the client ID or callback URLs. Additional characters need the optional asset grant.
- The newer browser appearance changes described below have NOT been shipped to iOS.
- Android remains 1.24.2 (93); no Android 1.25.0 release was requested.
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
