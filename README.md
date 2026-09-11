# Axis

Axis is a free ship-fitting calculator for EVE Online, available on iOS and Android. Build and save fits, compare equipment, and check performance from your phone. Fitting calculations work offline, with no ads or account required.

- [Download on the App Store](https://apps.apple.com/us/app/axis-mobile-fitting-tool/id6798416488)
- [Download the Android APK](https://github.com/rexmikakka-bit/visviva/releases)

Android installation may require permission to install apps from outside the Play Store.

Axis was previously called Vis Viva. The repository still uses the original name.

Axis is built with substantial help from AI coding tools, including Claude and OpenAI Codex. AI is part of the development process; the app's fitting calculations run locally using its bundled engine and game data.

## Fitting and analysis

Browse ships and structures by class, or search for a hull by name. Fits support high, mid, low, rig, subsystem, and service slots, along with drones, fighters, cargo, implants, and boosters. Modules can be offline, online, active, or overheated. Resource readouts update as you make changes and highlight exceeded limits, including powergrid, CPU, calibration, drone capacity, and bandwidth.

The stats panel shows damage and volley, resistances and effective HP, active tank and passive regeneration, capacitor stability, speed, agility, targeting, sensor strength, scan resolution, warp speed, and align time.

You can also:

- **Compare ammunition.** Preview ammo grades in the Firepower panel before loading them. Missile comparisons use one row per damage type, with shared controls for navy and T2 variants.
- **Plot performance.** Graph damage, EWAR, repairs, shield regeneration, capacitor, mobility, warp time, and lock time. Available axes include distance, time, target speed, and signature radius. Use a frigate, cruiser, or battleship target profile, or another saved fit.
- **Include fleet support and environment effects.** Apply links, command bursts, remote repairs, webs, neutralizers, target painters, and other EWAR from saved fits. Model wormhole class effects, metaliminal storms, and event beacons.
- **Choose a pilot.** Use all level V skills, an Alpha clone profile, or skills synced from your EVE character. The fit header identifies unmet skill requirements.
- **Work with abyssal modules.** Roll and save mutated modules with their individual attributes, and compare module variations side by side.
- **Inspect equipment.** View descriptions, traits, attributes, prices, and T1, T2, faction, storyline, deadspace, and officer variants.
- **Compare costs.** Request market prices for individual items or an entire fit. The price optimizer finds cheaper module variants with identical stats.

## Saving and sharing

Fits are saved on your device. Import and export EFT text, exchange saved fittings with your EVE character through ESI, or share a fit as an image. Saved data can be backed up to a file and restored.

## Offline use and privacy

Game data, ship and module art, and the fitting engine are bundled with the app. Your fits, skills, and settings remain on your device. Axis has no application server, separate account system, or telemetry.

Network access is used for optional EVE character connections and market-price requests. Character connections use CCP's official login through ESI; prices are fetched when requested. Neither is needed to build or evaluate a fit.

## Calculation accuracy

Axis implements EVE's dogma attribute and effect system in JavaScript, including stacking penalties, hull and subsystem bonuses, implant sets, command bursts, environment effects, and overheating.

[pyfa](https://github.com/pyfa-org/Pyfa) v2.68.0, using EVE client build 3424810, is the calculation reference. Discrepancies are investigated against pyfa before changing expected results.

The regression suite includes fit values checked manually against pyfa and through its `eos` engine, as well as checks for fitting rules and application behavior. Automated validation also checks imports, translations, production builds, and offline dependencies.

## Development

Axis is built with React and Vite, with native mobile projects managed through Capacitor.

```sh
npm install
npm run dev
```

Run the full validation suite before submitting changes:

```sh
npm run verify
```

[CLAUDE.md](./CLAUDE.md) contains the project conventions and links to documentation for the calculation engine, data pipeline, and validation tools. See [the release guide](./docs/release.md) for Android and iOS builds.

## Credits and data sources

### pyfa

[pyfa](https://github.com/pyfa-org/Pyfa), licensed under GPLv3, is Axis's calculation reference and the source for part of its environment-effect data.

Fenris Creations does not publish `modifierInfo` for Effect Beacon environment effects (group 920), including wormhole class effects, metaliminal storms, and event beacons. Axis generates `src/data/system-effects.json` from pyfa's handwritten handlers using `scripts/build-system-effects.py`.

The generated file contains mappings of effect IDs, targets, operations, and attributes. It uses Fenris Creations' attribute names and contains no pyfa source code, comments, or effect magnitudes; values are read from game data at runtime. Approximately 42% of the mappings follow the attribute naming conventions. The remaining mappings reflect work by pyfa's authors.

pyfa itself is not redistributed in the repository or app. This use of the derived data has not been cleared with pyfa's maintainers. Maintainers who would prefer it removed can open an issue, and it will be removed.

### EVE Online

EVE Online and related materials are the intellectual property of Fenris Creations. Axis is a free, unofficial fan tool and is not affiliated with or endorsed by Fenris Creations. Static game data is used under Fenris Creations' developer terms.

### Market data

Optional market prices are provided by [Fuzzwork](https://market.fuzzwork.co.uk/) and [ceve-market](https://www.ceve-market.org/).
