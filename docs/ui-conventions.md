# Axis UI conventions

Axis's existing screens are the design reference. Extend their visual hierarchy,
density, and behavior unless Owen requests a design change. Matching the palette
alone does not make a new screen consistent.

## Start with an existing screen

Before implementing UI, inspect the closest existing screen and its source. Name
that reference in the progress update. Use the following map to find it:

| Work | Existing reference |
| --- | --- |
| Picking a module, including an owned abyssal | `ModuleBrowserSheet` and `ModRow` in `src/components/ui.jsx` |
| Comparing module replacements | `ModuleVariationsTab` in `src/components/ui.jsx` |
| Editing a roll | `MutaplasmidEditor` in `src/components/ui.jsx` |
| Sheets and item information | `BottomSheet`, `InfoButton`, `ItemInfoSheet`, and `ModuleInfoTab` in `src/components/ui.jsx` |
| Colors and fonts | `src/theme.js` and `src/index.css`; follow component usage of `C` and the bundled Saira font |

Reuse the actual component when the job is the same. `AbyssalLibrary` receives a
`renderRow` callback from `ModuleBrowserSheet` so it can use `ModRow` without a
circular import. Preserve this reuse. Extend a shared component with focused props
when needed; avoid creating a second implementation of the same row. Do not turn a
feature into a broad component-system refactor.

## Preserve the established hierarchy and behavior

- Module picker rows use an item icon, module name, PG/CPU fitting costs, grade/meta
  badge, info control, and separators. The primary row action fits the module.
  Preserve keyboard activation, disabled states, and search-focus behavior.
- Use the variations browser's compact wrapping attribute layout for comparable
  secondary stats. Preserve units and the distinction between raw rolls, fitting
  costs, and comparison deltas; appearance must not change what a number means.
- Put owner/location and availability in secondary content. Keep identity, labels,
  favorites, and import management from overwhelming the module-selection task.
  Preserve visible error, busy, and unavailable states.
- Match the reference's spacing, type sizes, icon alignment, control treatment,
  and information density. Use theme colors for new styling. The existing source
  remains authoritative for exact values; this document is not a second token table.
- For a new control with no direct shared component, follow the closest existing
  control and explain any necessary departure. Continue routine work without an
  extra approval step; a larger redesign needs to be part of the user's request.

## Verify appearance separately from functionality

For UI changes, run the project's required functional checks, then inspect the
changed screen and its reference through the real app navigation at the same
viewport and theme. Use 390 x 844 as an initial phone viewport and also check a
narrower phone width. Check dark and light themes; inspect other supported themes
when the change affects color treatment.

Compare row density, spacing, typography, icons, badges, stats, controls, and tap
behavior. Cover the relevant empty, populated, long-name/location, expanded,
loading/error, and disabled/unavailable states. Use representative synthetic data
without replacing real user records. A standalone fixture alone does not establish
that the feature works or looks right inside its actual sheet.

Include comparison screenshots when delivering appearance changes and identify
the reference, viewport, themes, and states inspected. If visual inspection is
unavailable, say so; passing `npm run verify` does not establish visual consistency.
Do not describe an appearance as owner-approved without Owen's feedback.

## Why this guidance exists

The initial abyssal library in `b27c3b5` imported `C`, but implemented its own
name/Fit/favorite buttons and vertical attribute grid instead of using the module
picker's row. It therefore matched colors while changing the layout and interaction.
`bdd900e` restored shared `ModRow` rendering and compact wrapping stats, and collapsed
import controls when records exist. The handoff says Owen has not reviewed that
revised appearance yet.

The repository's functional checks cover mechanics, imports, build correctness,
and other regressions; they do not compare rendered screens. The project guidance
previously lacked a UI reference map and a visual comparison requirement. These are
observable gaps, not evidence of what a previous agent internally intended.
