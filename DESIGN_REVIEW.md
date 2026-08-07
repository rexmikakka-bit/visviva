# Design review — August 2026

A step back after building the app, written at the point where the dogma engine, the fitting
workflow and the EVE data model were all well understood. Not a plan and not a commitment: six
things that look wrong from here, ordered by what I would actually do first, each with the evidence
behind it and an honest confidence level.

Nothing in here is urgent. The app works. These are the changes that would stop *classes* of problem
rather than instances of them.

**Status: under review — the owner has concerns on some of these. See "Open questions" at the end.**

---

## 1. A fit should be one object, not eight pieces of state

**Confidence: high.** This is the only item backed by hard evidence rather than judgement.

A fit currently lives as eight independent `useState`s in `App.jsx` — `slots`, `drones`, `fighters`,
`cargoItems`, `implants`, `boosters`, `projFits`, `cmdFits` — reassembled by an autosave effect with
nine dependencies. Anything that wants to "open a fit" must set all eight *and* remember to register
a tab.

**The evidence.** The same bug shipped three separate times, each time in a new caller:

| Caller | Bug |
| --- | --- |
| `createNewFit` | bypassed `loadFit`, so a new fit never registered a tab |
| `openCopyOfFit` | same latent bug, found while fixing the first |
| `importFit` | set eight setters by hand; imported fits never appeared in the tab strip |

Three instances of one shape is a design signal, not bad luck.

**The change.** Make the fit a single object with `loadFit` / `updateFit` as the only doors in. Undo,
tabs and autosave then fall out of that one path instead of each being hand-maintained at every call
site.

**Cost.** Large refactor of `App.jsx`, which is the riskiest file in the repo and the one most prone
to merge conflicts. Worth staging rather than doing in one pass.

**Bonus.** It makes the fit-tab system safer without touching it. The tabs are correct *because*
`loadFit` is a single door; every tab bug so far came from something walking around that door.

---

## 2. Treat saved fits as precious, because nothing else does

**Confidence: high.**

Fits live in `localStorage` and nowhere else. No server, no file, no version control. Clearing site
data, switching browsers, or a storage migration going wrong loses everything a user has built.

`ErrorBoundary.jsx` and `lib/backup-io.js` exist precisely because of that fragility — and in August
2026 the iOS backup button was found to have been **silently reporting success while writing no
file at all** (a WKWebView ignores `<a download>`, and the code set `ok: true` on the next line). The
one feature protecting irreplaceable data was broken, and nothing noticed because nothing verified
it.

**The change, in order of value:**

1. Automatic periodic export the user never has to think about.
2. A visible "last backed up" state, so silence is not mistaken for safety.
3. Fits syncing to the character's in-game fittings over ESI — **already built and fixture-verified**;
   it needs an app registered at developers.eveonline.com and the client ID pasted into
   `src/esi-config.js`. That turns CCP's own servers into the backup.

**Why it ranks this high.** Every other item on this list improves the app. This one is the only one
where the failure mode is unrecoverable for the user.

---

## 3. "The scenario" is a real concept the app does not have

**Confidence: high on the diagnosis, medium on the shape of the fix.** This is the largest
*conceptual* gap, and it only became clear while auditing the graphs.

EVE numbers are conditional. DPS means nothing without range, tracking, target signature and target
resists. EHP means nothing without a damage profile. Cap stability depends on what is cycling. The
app models all of this correctly — but the inputs are scattered across the UI:

- damage profile — Fit tab
- target resist profile — Graph tab
- environment / system effects — Effects tab
- system security — structure fits only
- RAH damage pattern — its own control

**The consequence.** The Stats tab silently asserts ideal conditions while the Graph lets you vary
them, so the two do not agree about which engagement they are describing.

**The change.** One "engagement" object — range, target, damage profile, environment — set once and
applied consistently across Stats, Graph and the snapshot. It also makes Stats far more useful: *"my
DPS at 30 km against a cruiser"* is a number someone acts on; *"my DPS"* is not.

---

## 4. The bottom nav is fit sections pretending to be navigation

**Confidence: medium.** Least certain item here; large change, and muscle memory has real value.

Cargo, Drones, Implants and Effects are not destinations — they are *parts of the fit currently
open*. The tell: the bottom nav now has to be hidden entirely when no fit is open, because with no
fit those four tabs have nothing to act on. The information architecture is admitting what it is.

This is inherited from pyfa, where those are panels visible simultaneously on a wide screen. On a
phone, splitting one fit across five screens means remembering which tab holds the thing you want.

**The change.** Fold them into the fit view as sections, and reserve the bottom bar for genuine
destinations (your fits, browse ships, settings).

---

## 5. Stats and graphs should run the same simulation

**Confidence: high.**

The August 2026 graph audit found three curves that were decoration rather than math:

- "Damage inflicted" against distance plotted a **constant zero**.
- "Total repaired" against distance was `rate * 10` — an arbitrary ten seconds.
- Mobility's "bump speed" was `vmax * exp(-t/3)`, an invented decay modelling nothing.

They existed because graphs were written as plausible-looking curves instead of as renderings of the
engine. The two graphs that *cannot* drift from their readouts are the two derived from a real
simulation the app already runs — capacitor (`simulateCapTrace`) and, since the spool fix,
damage/reps.

**The rule to adopt.** A graph is a visualization of a simulation the stats already perform, never
its own parallel math. People make fitting decisions on these.

---

## 6. Derive, never enumerate

**Confidence: high.** The most repeated lesson in this codebase.

Every hand-maintained list has eventually rotted:

| Table | How it failed |
| --- | --- |
| `shipsByClass` | zero rows for Command Carriers and Lancer Dreadnoughts — eight live hulls unreachable |
| `MUTADAPTIVE_SPOOL` | comment claimed the attributes were absent from the bundle; they were present |
| `MODE_PROXY` | pointed the Skua at the Jackdaw's tactical modes; the Skua ships its own |
| `ANHINGA_MODES` | hand-transcribed values, each exactly `1/<the mode's own attribute>` |
| `raceIcons` keys | not SDE raceIDs at all — 135 is ORE, 512 is Triglavian |
| `data-bundle.js` `meta` | faction/storyline/deadspace/officer all came through as "T2" |

Every one was fixed by deriving from CCP's data instead.

**The companion rule, for tests.** The checks that caught real problems assert **totality** — "every
fittable hull is reachable exactly once", "every skill requirement resolves to a catalog entry" —
not specific counts. Totality survives an eve.db upgrade; counts do not.

---

## What should not change

Worth stating, so a future pass does not churn things that are working:

- **The dogma engine's architecture.** The attribute pools and stacking model have absorbed a year of
  edge cases without needing to change shape.
- **The module browser and the abyssal/mutaplasmid editor.** The mutaplasmid slider is better than
  pyfa's desktop equivalent.
- **Tabs as switching, not diffing.** A DPS number lifted out of its fit says very little, so seeing
  each fit whole is the right primitive. If comparison is ever added, scope it narrowly — same hull,
  one variable changed — rather than building a general diff.

---

## If only one thing gets done

**#1 and #2 together.** Making the fit one object is what stops the same bug shipping a fourth time;
making backups trustworthy is what stops a bad day from being unrecoverable. Neither adds a feature,
which is exactly why they would otherwise keep being deferred.

---

## Open questions

The owner has concerns with some of these — to be recorded here before any of it is acted on.

- [ ] _(concerns to be filled in)_
