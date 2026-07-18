"""Oracle: drive pyfa's eos engine and print stats for a fit spec.

Builds a fit programmatically (ship + modules + charges + drones + implants +
boosters + all-skills-at-V character), runs eos, and prints the derived stats
that our regression suite validates (weapon DPS, volley, EHP, tank, cap, lock
range). This is the reference we diff calc.js against.

Run:  /c/Python314/python scripts/oracle/oracle.py <fitname>
      /c/Python314/python scripts/oracle/oracle.py --list
"""
import sys

from eos_bootstrap import get_eos

# State strings in our fit format -> FittingModuleState.
_STATE = {"offline": -1, "online": 0, "active": 1, "overheated": 2}


def build_fit(spec):
    """spec = {ship, high[], mid[], low[], rigs[], drones[], implants[], boosters[]}.

    Each module entry: {name, state, ammo?}. Drone: {name, qty, active}.
    Implant/booster: {name, active?}.
    """
    e = get_eos()
    db = e["db"]

    ship_item = db.getItem(spec["ship"])
    try:
        ship = e["Ship"](ship_item)
    except ValueError:
        ship = e["Citadel"](ship_item)
    fit = e["Fit"](ship, spec.get("name", spec["ship"]))
    fit.character = e["Character"]("__oracle_allV", 5)

    for rack in ("high", "mid", "low", "rigs"):
        for entry in spec.get(rack, []):
            if entry is None or entry.get("empty"):
                continue
            m = e["Module"](db.getItem(entry["name"]))
            m.owner = fit
            state = _STATE.get(entry.get("state", "online"), 0)
            if m.isValidState(state):
                m.state = state
            elif m.isValidState(e["State"].ACTIVE) and state >= e["State"].ACTIVE:
                m.state = e["State"].ACTIVE
            if entry.get("ammo"):
                charge = db.getItem(entry["ammo"], eager="group.category")
                if charge.category.name == "Charge":
                    m.charge = charge
            fit.modules.append(m)

    for d in spec.get("drones", []):
        drone = e["Drone"](db.getItem(d["name"], eager="group.category"))
        drone.amount = d.get("qty", 1)
        drone.amountActive = d.get("qty", 1) if d.get("active") else 0
        fit.drones.append(drone)

    for imp in spec.get("implants", []):
        implant = e["Implant"](db.getItem(imp["name"], eager="group.category"))
        implant.active = imp.get("active", True)
        fit.implants.append(implant)

    for b in spec.get("boosters", []):
        booster = e["Booster"](db.getItem(b["name"], eager="group.category"))
        booster.active = b.get("active", True)
        fit.boosters.append(booster)

    # Uniform 25/25/25/25 incoming damage profile so EHP and rep-EHP/s match our
    # layerEHP (hp / (1 - avg resist)) — see notes in this file's docstring.
    from eos.saveddata.damagePattern import DamagePattern
    fit.damagePattern = DamagePattern(25, 25, 25, 25)

    return fit


def _resist_str(ship, layer):
    """'em/th/kin/exp' resist percentages, matching our resistStr()."""
    prefix = {"shield": "shield", "armor": "armor", "hull": ""}[layer]
    out = []
    for dmg in ("Em", "Thermal", "Kinetic", "Explosive"):
        attr = f"{prefix}{dmg}DamageResonance"
        attr = attr[0].lower() + attr[1:]
        out.append(f"{(1 - ship.getModifiedItemAttr(attr)) * 100:.1f}")
    return "/".join(out)


def stats(fit):
    fit.calculateModifiedAttributes()
    ship = fit.ship
    ehp = fit.ehp
    tank = fit.effectiveTank  # rep amounts already resist-weighted by the uniform pattern
    return {
        "weaponDps": fit.getWeaponDps().total,
        "weaponVolley": fit.getWeaponVolley().total,
        "totalDps": fit.getTotalDps().total,
        "totalEHP": ehp["shield"] + ehp["armor"] + ehp["hull"],
        "ehp": ehp,
        "shieldHP": ship.getModifiedItemAttr("shieldCapacity"),
        "armorHP": ship.getModifiedItemAttr("armorHP"),
        "hullHP": ship.getModifiedItemAttr("hp"),
        "armorRepEhpS": tank.get("armorRepair", 0) or tank.get("armorRepairFullSpool", 0),
        "shieldRepEhpS": tank.get("shieldRepair", 0),
        "capDelta": fit.capDelta,
        "maxTargetRange": fit.maxTargetRange,
        "maxSpeed": fit.maxSpeed,
        "scanRes": ship.getModifiedItemAttr("scanResolution"),
        "resists": {
            "shield": _resist_str(ship, "shield"),
            "armor": _resist_str(ship, "armor"),
            "hull": _resist_str(ship, "hull"),
        },
    }


# ── Fit specs mirrored from src/regression.test.mjs ──────────────────────────
FITS = {
    "bane": {
        "ship": "Bane",
        "high": [
            {"name": "'Azmaru' Electromagnetic Disruptive Lance", "state": "active"},
            {"name": "XL Torpedo Launcher II", "state": "active", "ammo": "Scourge Rage XL Torpedo"},
            {"name": "XL Torpedo Launcher II", "state": "active", "ammo": "Scourge Rage XL Torpedo"},
            {"name": "XL Torpedo Launcher II", "state": "active", "ammo": "Scourge Rage XL Torpedo"},
            {"name": "Siege Module II", "state": "active"},
        ],
        "mid": [
            {"name": "Tracking Computer II", "state": "active", "ammo": "Optimal Range Script"},
            {"name": "Heavy Capacitor Booster II", "state": "active", "ammo": "Navy Cap Booster 3200"},
            {"name": "Capital F-RX Compact Capacitor Booster", "state": "active", "ammo": "Navy Cap Booster 3200"},
            {"name": "Tracking Computer II", "state": "active", "ammo": "Optimal Range Script"},
        ],
        "low": [
            {"name": "Caldari Navy Ballistic Control System", "state": "online"},
            {"name": "Caldari Navy Ballistic Control System", "state": "online"},
            {"name": "Reactive Armor Hardener", "state": "active"},
            {"name": "25000mm Rolled Tungsten Compact Plates", "state": "online"},
            {"name": "25000mm Rolled Tungsten Compact Plates", "state": "online"},
            {"name": "25000mm Steel Plates II", "state": "online"},
            {"name": "Corelum C-Type Multispectrum Energized Membrane", "state": "online"},
            {"name": "Corelum C-Type Multispectrum Energized Membrane", "state": "online"},
        ],
        "rigs": [
            {"name": "Capital Trimark Armor Pump I", "state": "online"},
            {"name": "Capital Trimark Armor Pump I", "state": "online"},
        ],
        "expect": {"weaponDps": 13301, "weaponVolley": 180870},
    },

    # ASTARTE — RAH + command bursts + Asklepian implants + boosters.
    "astarte": {
        "ship": "Astarte",
        "high": [
            {"name": "Heavy Neutron Blaster II", "state": "active", "ammo": "Void M"},
            {"name": "Heavy Neutron Blaster II", "state": "active", "ammo": "Void M"},
            {"name": "Heavy Neutron Blaster II", "state": "active", "ammo": "Void M"},
            {"name": "Skirmish Command Burst II", "state": "active", "ammo": "Rapid Deployment Charge"},
            {"name": "Armor Command Burst II", "state": "active", "ammo": "Armor Energizing Charge"},
            {"name": "Heavy Neutron Blaster II", "state": "active", "ammo": "Void M"},
            {"name": "Heavy Neutron Blaster II", "state": "active", "ammo": "Void M"},
        ],
        "mid": [
            {"name": "50MN Cold-Gas Enduring Microwarpdrive", "state": "active"},
            {"name": "Medium Capacitor Booster II", "state": "active", "ammo": "Navy Cap Booster 800"},
            {"name": "Federation Navy Stasis Webifier", "state": "active"},
            {"name": "Dread Guristas Warp Scrambler", "state": "active"},
        ],
        "low": [
            {"name": "True Sansha Medium Armor Repairer", "state": "active"},
            {"name": "Corelum A-Type Explosive Energized Membrane", "state": "online"},
            {"name": "True Sansha Multispectrum Energized Membrane", "state": "online"},
            {"name": "Reactive Armor Hardener", "state": "active"},
            {"name": "Magnetic Field Stabilizer II", "state": "online"},
            {"name": "True Sansha Medium Armor Repairer", "state": "active"},
        ],
        "rigs": [
            {"name": "Medium EM Armor Reinforcer II", "state": "online"},
            {"name": "Medium Hybrid Burst Aerator II", "state": "online"},
        ],
        "implants": [{"name": n} for n in [
            "Mid-grade Asklepian Alpha", "Mid-grade Asklepian Beta", "Mid-grade Asklepian Gamma",
            "Mid-grade Asklepian Delta", "Mid-grade Asklepian Epsilon", "Mid-grade Asklepian Omega",
            "Zainou 'Deadeye' Trajectory Analysis TA-705", "Zainou 'Deadeye' Medium Hybrid Turret MH-805",
            "Eifyr and Co. 'Gunslinger' Surgical Strike SS-905", "Federation Navy Command Mindlink",
        ]],
        "boosters": [{"name": n} for n in [
            "Improved Exile Booster", "Standard Drop Booster", "Agency 'Hardshell' TB9 Dose IV",
            "Republic Electronics Booster I", "Republic Defense Booster II", "Republic Mobility Booster I",
            "Federation Hardpoint Booster II",
        ]],
        "drones": [{"name": "Warrior II", "qty": 5, "active": True}],
        "expect": {
            "weaponDps": 1200,
            "resists.armor": "82.8/83.2/90.6/83.0",
            "resists.shield": "4.0/60.8/85.0/50.0",
            "resists.hull": "35.7/34.3/33.0/33.0",
            "armorRepEhpS": 1668.3,
            "scanRes": 306,
        },
        # NO known gaps. The earlier "pyfa gap" annotations here (Effect12897 hybrid-damage
        # bonus, effects 12822/12823 booster resists) were a VERSION-SKEW artifact: the oracle
        # was loading eos from the stale Pyfa-master clone (v2.66.3), which lacks those v2.68
        # effect classes. Against a version-matched clone (PYFA_ROOT=Pyfa-268) eos applies all
        # three and agrees with us exactly (weaponDps 1199.6, resists identical, armorRep 1668.3).
    },

    # MINOKAWA — Nirvana implant set + cap-booster hull bonus.
    "minokawa": {
        "ship": "Minokawa",
        "high": [
            {"name": "Capital Remote Shield Booster II", "state": "active"},
            {"name": "Capital Remote Shield Booster II", "state": "active"},
            {"name": "Capital Murky Compact Remote Shield Booster", "state": "active"},
            {"name": "Capital Murky Compact Remote Shield Booster", "state": "active"},
            {"name": "Shield Command Burst II", "state": "active", "ammo": "Active Shielding Charge"},
            {"name": "Triage Module II", "state": "active"},
        ],
        "mid": [
            {"name": "Multispectrum Shield Hardener II", "state": "active"},
            {"name": "Capital Compact Pb-Acid Cap Battery", "state": "online"},
            {"name": "Capital F-S9 Regolith Compact Shield Extender", "state": "online"},
            {"name": "Multispectrum Shield Hardener II", "state": "active"},
            {"name": "Capital Shield Extender II", "state": "online"},
            {"name": "Capital F-S9 Regolith Compact Shield Extender", "state": "online"},
            {"name": "Capital Capacitor Booster II", "state": "active", "ammo": "Navy Cap Booster 3200"},
        ],
        "low": [
            {"name": "True Sansha Power Diagnostic System", "state": "online"},
            {"name": "True Sansha Power Diagnostic System", "state": "online"},
            {"name": "True Sansha Power Diagnostic System", "state": "online"},
            {"name": "Damage Control II", "state": "active"},
        ],
        "rigs": [
            {"name": "Capital Ancillary Current Router I", "state": "online"},
            {"name": "Capital Ancillary Current Router I", "state": "online"},
            {"name": "Capital EM Shield Reinforcer II", "state": "online"},
        ],
        "implants": [{"name": n} for n in [
            "Mid-grade Nirvana Alpha", "Mid-grade Nirvana Beta", "Mid-grade Nirvana Gamma",
            "Mid-grade Nirvana Delta", "Mid-grade Nirvana Epsilon", "Mid-grade Nirvana Omega",
            "Zainou 'Gnome' Shield Management SM-705", "Zainou 'Gnome' Shield Emission Systems SE-805",
            "Zainou 'Gnome' Shield Operation SP-905", "Shield Command Mindlink",
        ]],
        "expect": {
            "totalEHP": 3256400,
            "shieldHP": 623437,
            "capDelta": -494.0,
        },
    },

    # SALVATION — command carrier burst strength bonuses (ISA active for lock range).
    "salvation": {
        "ship": "Salvation",
        "high": [
            {"name": "Fighter Support Unit I", "state": "online"},
            {"name": "Fighter Support Unit I", "state": "online"},
            {"name": "Integrated Sensor Array", "state": "active"},
            {"name": "Armor Command Burst II", "state": "active", "ammo": "Armor Energizing Charge"},
            {"name": "Armor Command Burst II", "state": "active", "ammo": "Armor Reinforcement Charge"},
            {"name": "Information Command Burst II", "state": "active", "ammo": "Sensor Optimization Charge"},
        ],
        "mid": [
            {"name": "Capital Shield Extender II", "state": "online"},
            {"name": "Capital Shield Extender II", "state": "online"},
            {"name": "Pithum C-Type Multispectrum Shield Hardener", "state": "active"},
            {"name": "Pithum C-Type Multispectrum Shield Hardener", "state": "active"},
        ],
        "low": [
            {"name": "25000mm Steel Plates II", "state": "online"},
            {"name": "25000mm Steel Plates II", "state": "online"},
            {"name": "25000mm Steel Plates II", "state": "online"},
            {"name": "25000mm Steel Plates II", "state": "online"},
            {"name": "Centii A-Type Multispectrum Coating", "state": "online"},
            {"name": "Centii A-Type Multispectrum Coating", "state": "online"},
            {"name": "Damage Control II", "state": "active"},
            {"name": "Reactive Armor Hardener", "state": "active"},
        ],
        "rigs": [
            {"name": "Capital Trimark Armor Pump II", "state": "online"},
            {"name": "Capital Trimark Armor Pump II", "state": "online"},
        ],
        "expect": {
            "totalEHP": 8057016,
            "resists.armor": "87.0/86.8/87.4/90.9",
            "maxTargetRange": 6457000,  # eos reports metres; 6457 km baseline
        },
    },

    # REVELATION NAVY ISSUE — Amulet set, Conflagration crystals, siege.
    "revnavy": {
        "ship": "Revelation Navy Issue",
        "high": [
            {"name": "Dual Giga Pulse Laser II", "state": "active", "ammo": "Conflagration XL"},
            {"name": "Capital Gremlin Compact Energy Neutralizer", "state": "active"},
            {"name": "Dual Giga Pulse Laser II", "state": "active", "ammo": "Conflagration XL"},
            {"name": "Siege Module II", "state": "active"},
            {"name": "Capital Gremlin Compact Energy Neutralizer", "state": "active"},
            {"name": "Dual Giga Pulse Laser II", "state": "active", "ammo": "Conflagration XL"},
        ],
        "mid": [
            {"name": "Capital F-RX Compact Capacitor Booster", "state": "active", "ammo": "Navy Cap Booster 3200"},
            {"name": "Heavy Capacitor Booster II", "state": "active", "ammo": "Navy Cap Booster 3200"},
            {"name": "Tracking Computer II", "state": "active", "ammo": "Optimal Range Script"},
            {"name": "Tracking Computer II", "state": "active", "ammo": "Optimal Range Script"},
        ],
        "low": [
            {"name": "25000mm Steel Plates II", "state": "online"},
            {"name": "25000mm Steel Plates II", "state": "online"},
            {"name": "25000mm Rolled Tungsten Compact Plates", "state": "online"},
            {"name": "Dark Blood Heat Sink", "state": "online"},
            {"name": "Corpum B-Type Multispectrum Energized Membrane", "state": "online"},
            {"name": "Corpus X-Type Thermal Armor Hardener", "state": "active"},
            {"name": "Corpus X-Type EM Armor Hardener", "state": "active"},
            {"name": "Damage Control II", "state": "active"},
        ],
        "rigs": [
            {"name": "Capital Trimark Armor Pump I", "state": "online"},
            {"name": "Capital Trimark Armor Pump I", "state": "online"},
            {"name": "Capital Trimark Armor Pump I", "state": "online"},
        ],
        "implants": [{"name": n} for n in [
            "Mid-grade Amulet Alpha", "Mid-grade Amulet Beta", "Mid-grade Amulet Gamma",
            "Mid-grade Amulet Delta", "Mid-grade Amulet Epsilon", "Mid-grade Amulet Omega",
            "Eifyr and Co. 'Gunslinger' Motion Prediction MR-703",
            "Inherent Implants 'Squire' Capacitor Management EM-803",
            "Eifyr and Co. 'Gunslinger' Surgical Strike SS-903",
        ]],
        "expect": {
            "totalEHP": 5066076,
            "weaponDps": 10960,
            "weaponVolley": 84280,
        },
    },

    # THUNDERCHILD — EDENCOM battleship, Vorton Projector arc weapons (primary-target DPS).
    "thunderchild": {
        "ship": "Thunderchild",
        "high": [
            {"name": "Large Vorton Projector II", "state": "active", "ammo": "GalvaSurge Condenser Pack L"},
            {"name": "Large Vorton Projector II", "state": "active", "ammo": "GalvaSurge Condenser Pack L"},
            {"name": "Large Vorton Projector II", "state": "active", "ammo": "GalvaSurge Condenser Pack L"},
            {"name": "Large Vorton Projector II", "state": "active", "ammo": "GalvaSurge Condenser Pack L"},
            {"name": "Large Vorton Projector II", "state": "active", "ammo": "GalvaSurge Condenser Pack L"},
            {"name": "Large Vorton Projector II", "state": "active", "ammo": "GalvaSurge Condenser Pack L"},
        ],
        "mid": [], "low": [], "rigs": [],
        "expect": {"weaponDps": 1387, "weaponVolley": 14046},
    },

    # STORMBRINGER — EDENCOM cruiser.
    "stormbringer": {
        "ship": "Stormbringer",
        "high": [{"name": "Medium Vorton Projector II", "state": "active", "ammo": "GalvaSurge Condenser Pack M"} for _ in range(5)],
        "mid": [], "low": [], "rigs": [],
        "expect": {"weaponDps": 762.5, "weaponVolley": 6176},
    },

    # SKYBREAKER — EDENCOM frigate.
    "skybreaker": {
        "ship": "Skybreaker",
        "high": [{"name": "Small Vorton Projector II", "state": "active", "ammo": "GalvaSurge Condenser Pack S"} for _ in range(4)],
        "mid": [], "low": [], "rigs": [],
        "expect": {"weaponDps": 233.7, "weaponVolley": 1262},
    },
}


def _get(s, key):
    """Dotted lookup, e.g. 'resists.armor'."""
    cur = s
    for part in key.split("."):
        cur = cur[part]
    return cur


def run_one(name, tol=0.005):
    spec = FITS[name]
    s = stats(build_fit(spec))
    print(f"\n=== {name} ({spec['ship']}) -- pyfa eos ===")
    print(f"  weaponDps={s['weaponDps']:.1f}  volley={s['weaponVolley']:.1f}  totalDps={s['totalDps']:.1f}")
    print(f"  totalEHP={s['totalEHP']:.0f}  shieldHP={s['shieldHP']:.0f}  armorHP={s['armorHP']:.0f}")
    print(f"  armorRepEhpS={s['armorRepEhpS']:.1f}  shieldRepEhpS={s['shieldRepEhpS']:.1f}")
    print(f"  capDelta={s['capDelta']:.2f}  scanRes={s['scanRes']:.1f}  maxSpeed={s['maxSpeed']:.1f}  lockRange={s['maxTargetRange']:.0f}")
    print(f"  resists  shield={s['resists']['shield']}  armor={s['resists']['armor']}  hull={s['resists']['hull']}")
    fails = 0
    exp = spec.get("expect", {})
    gaps = spec.get("known_gaps", {})
    if exp:
        print("  --- vs our baselines ---")
        for k, v in exp.items():
            got = _get(s, k)
            if isinstance(v, str):
                ok = got == v
                line = f"  {'OK ' if ok else '!! '}{k:16} eos={got}  ours={v}"
            else:
                delta = (got - v) / v * 100 if v else (0 if got == 0 else 100)
                ok = abs(delta) <= tol * 100
                line = f"  {'OK ' if ok else '!! '}{k:16} eos={got:.1f}  ours={v}  ({delta:+.2f}%)"
            if not ok and k in gaps:
                # Expected pyfa-side divergence -- annotate, don't count as our failure.
                print(line.replace("!! ", "~~ ") + f"  [known pyfa gap: {gaps[k]}]")
            else:
                print(line)
                fails += 0 if ok else 1
    return fails


def main():
    args = sys.argv[1:]
    if not args or args[0] == "--list":
        print("fits:", ", ".join(FITS))
        return
    names = list(FITS) if args[0] == "--all" else args
    total_fails = 0
    for name in names:
        if name not in FITS:
            raise SystemExit(f"unknown fit '{name}'. try --list")
        total_fails += run_one(name)
    if len(names) > 1:
        print(f"\n{'ALL MATCH' if total_fails == 0 else str(total_fails) + ' MISMATCHES'}"
              f" across {len(names)} fits")


if __name__ == "__main__":
    main()
