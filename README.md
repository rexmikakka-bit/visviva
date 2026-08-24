# Axis

A ship-fitting calculator for **EVE Online**, built for your phone.

Axis implements EVE's dogma system in JavaScript, so you get the same numbers pyfa gives you —
stacking penalties, hull and subsystem bonuses, implant sets, command bursts, environment effects,
overheating — on a screen you actually have with you. pyfa v2.68.0 is the reference implementation:
where Axis disagrees with pyfa, Axis is treated as wrong until proven otherwise. It is free, has no
ads, needs no account, and works with no signal.

Formerly *Vis Viva*.

## Getting it

- **iOS** — TestFlight.
- **Android** — the APK on the [Releases page](https://github.com/rexmikakka-bit/visviva/releases).
  Sideload it; you may need to allow installs from unknown sources.

## What it does

**Find a ship.** A nested browser that follows the way people actually talk about hulls —
Battleships → Faction Battleships → Pirate Faction — with every fittable hull in the game reachable,
including structures. Search by name if you already know what you want.

**Fit it.** High/mid/low slots, rigs, subsystems and service slots, with module states you can cycle
(offline, online, active, overheated). Drag in drones and fighters, load charges, stock the cargo
hold, and plug in implants and boosters. Fitting resources, slot counts, powergrid, CPU, calibration
and drone bay/bandwidth all update as you go, and turn red when you have gone over.

**See what it does.** A stats panel covering DPS and volley, effective HP and resist profile, active
and passive tank, capacitor stability, speed and agility, targeting, sensor strength, scan
resolution, warp speed and align time.

**Graph it.** Damage, EWAR, reps, shield regen, capacitor, mobility, warp time and lock time — each
plottable against distance, time, target speed or target signature radius, aimed at a frigate,
cruiser or battleship profile or at another one of your saved fits.

**Fly it with someone else's help.** Project other saved fits onto this one as links, command
bursts, remote reps, webs, neuts, paints or EWAR, and set the system you are sitting in — wormhole
class effects, metaliminal storms and event beacons are all modelled.

**Fly it with your skills.** Every fit records whose skills it is flown with: all level V, an Alpha
clone, or your real character synced from EVE. The skill check in the fit header tells you whether
you can actually fly what you have drawn, and what you are missing.

**Abyssal modules.** Roll and store mutated modules with their real rolled attributes, and compare
variations of any module side by side.

**Look things up.** Tap any item for its description, traits, full attribute list, market price and
every variation of it — T1, T2, faction, storyline, deadspace and officer.

**Move fits around.** Import and export EFT text, import and export directly against your
character's in-game saved fittings over ESI, and share a fit as a rendered image. Everything you
save can be backed up to a file and restored.

**Prices.** Optional market pricing per module and for the whole fit, plus a one-tap optimizer that
swaps every module for its cheapest **stat-identical** variant — same numbers, less ISK.

## Accuracy

pyfa v2.68.0 (EVE client build 3424810) is the reference implementation. Where Axis disagrees with
pyfa, Axis is treated as wrong until proven otherwise.

Correctness is held in place by a regression suite of **993 checks** — real fits whose every number
was validated by hand against pyfa, and in many cases against pyfa's `eos` engine driven directly as
a library. It runs on every change. A number in this app is not "whatever the code currently
prints"; it is a value someone confirmed.

## Offline and private

All ship and module art is bundled into the app (~6.5 MB), so nothing is fetched while you fit. Your
fits, skills and settings live on your device — there is no server, no account and no telemetry.
Connecting an EVE character over ESI is entirely optional, uses CCP's official login, and is the
only thing that ever talks to the network besides market prices, which are fetched only when you ask
for them.

## Contributing

The engine internals, the data pipeline and the hard-won gotchas are documented in
[CLAUDE.md](./CLAUDE.md). Start there.

---

## Credits and third-party material

**[pyfa](https://github.com/pyfa-org/Pyfa) (GPLv3)** is this project's reference implementation, and
one piece of shipped data is derived from it. Fenris Creations publishes no `modifierInfo` for Effect Beacon
(group 920) environment effects — wormhole class effects, metaliminal storms, event beacons — so
there is nothing to extract from `eve.db` and every engine that models them relies on pyfa's
hand-written handlers. `src/data/system-effects.json` is generated from those handlers by
`scripts/build-system-effects.py`.

What that file contains is a wiring table — `{effectID, target, operation, attribute}` using Fenris
Creations' own attribute names. It carries no pyfa source, no comments and no magnitudes; every value
is read from the game data at runtime. Roughly 42% of its rows fall directly out of those naming
conventions;
the remainder encodes mappings pyfa's authors worked out.

pyfa itself is **not** redistributed here — neither this repository nor the built app contains any
pyfa code.

This has not been cleared with pyfa's maintainers. If you are one of them and would rather this data
were not used, please open an issue — it will be removed.

**EVE Online** and all related materials are the intellectual property of Fenris Creations. Axis is
an unofficial, free, fan-made tool, not affiliated with or endorsed by Fenris Creations. Static game
data is used under Fenris Creations' developer terms.

**Market prices** come from [Fuzzwork](https://market.fuzzwork.co.uk/) and
[ceve-market](https://www.ceve-market.org/), fetched only when you ask for them.
