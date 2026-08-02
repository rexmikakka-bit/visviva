"""Diff every saved pyfa fit against calc.js via the eos oracle.

Loads the user's real fits (through a copy of saveddata.db -- see eos_saveddata),
computes eos stats for each, and emits a JSONL record carrying both the eos stats
and a calc.js-format spec (ship + slots + drones + implants + boosters). A Node
harness (oracle_compare.mjs) then runs calcFitStats on each spec and diffs.

    /c/Python314/python scripts/oracle/oracle_saved.py > scripts/oracle/_saved.jsonl
    node scripts/oracle/oracle_compare.mjs scripts/oracle/_saved.jsonl

Fits with mutated modules or projected effects are still emitted, but flagged so
the Node side can bucket them (our engine's mutaplasmid/projection support is
partial). Charges/subsystems/drones/implants/boosters are all translated by name.
"""
import json
import sys

from eos_saveddata import get_eos, all_v_char

# Force FULL spool so eos's entropic-disintegrator DPS/volley is comparable to ours (which reports
# unspooled .total plus a max-spool multiplier). Without this, eos uses each fit's SAVED per-module
# spool (max on some fits, zero on others), so the same hull diverges both ways. force=True overrides.
# Built lazily in main() — `eos` isn't importable until get_eos() puts pyfa on sys.path.
_FULL_SPOOL = None

# FittingModuleState int -> our string state.
_STATE_STR = {-1: "offline", 0: "online", 1: "active", 2: "overheated"}
# Slot enum (eos.const.Slot): LOW=1 MED=2 HIGH=3 RIG=4 SUBSYSTEM=5 MODE=6 SYSTEM=7 SERVICE=8.
# SERVICE is structure-only and was missing: unmapped slots are SKIPPED, so every service module on
# a structure fit vanished from the spec. That is not a small omission — a fitted service module is
# what puts a structure into Full Power State (Effect7008/7009, x4 shield+armor), so calc.js saw a
# low-power hull while eos saw a full-power one and every structure would have read 4x low on EHP.
_SLOT_KEY = {1: "low", 2: "mid", 3: "high", 4: "rigs", 5: "subsystems", 8: "services"}


def _resist_str(ship, layer):
    prefix = {"shield": "shield", "armor": "armor", "hull": ""}[layer]
    out = []
    for dmg in ("Em", "Thermal", "Kinetic", "Explosive"):
        attr = f"{prefix}{dmg}DamageResonance"
        attr = attr[0].lower() + attr[1:]
        out.append(round((1 - ship.getModifiedItemAttr(attr)) * 100, 1))
    return out


def eos_stats(fit):
    ship = fit.ship
    ehp = fit.ehp or {"shield": 0, "armor": 0, "hull": 0}
    tank = fit.effectiveTank or {}
    return {
        "weaponDps": fit.getWeaponDps(spoolOptions=_FULL_SPOOL).total,
        "weaponVolley": fit.getWeaponVolley(spoolOptions=_FULL_SPOOL).total,
        "totalDps": fit.getTotalDps(spoolOptions=_FULL_SPOOL).total,
        "totalEHP": ehp["shield"] + ehp["armor"] + ehp["hull"],
        "armorRepEhpS": tank.get("armorRepair", 0) or tank.get("armorRepairFullSpool", 0),
        "shieldRepEhpS": tank.get("shieldRepair", 0),
        "scanRes": ship.getModifiedItemAttr("scanResolution"),
        "maxSpeed": fit.maxSpeed,
        "maxTargetRange": fit.maxTargetRange,
        "resists": {
            "shield": _resist_str(ship, "shield"),
            "armor": _resist_str(ship, "armor"),
            "hull": _resist_str(ship, "hull"),
        },
    }


def extract_spec(fit):
    """Translate an eos Fit into the {ship, slots, drones, implants, boosters} shape
    calc.js consumes. Returns (spec, flags)."""
    slots = {"high": [], "mid": [], "low": [], "rigs": [], "subsystems": []}
    mutated = False
    for m in fit.modules:
        if m.isEmpty:
            continue
        key = _SLOT_KEY.get(int(m.slot))
        if key is None:
            continue
        if m.mutaplasmid is not None:
            mutated = True
        if key == "subsystems":
            slots["subsystems"].append({"name": m.item.typeName})
            continue
        entry = {
            "typeID": m.item.ID,
            "name": m.item.typeName,
            "state": _STATE_STR.get(int(m.state), "online"),
        }
        if m.charge is not None:
            entry["ammo"] = m.charge.typeName
        slots[key].append(entry)

    # T3 destroyer tactical mode: eos stores it as fit.mode (not a rack module).
    # calc.js wants slots.tactical = 'Defense'|'Propulsion'|'Sharpshooter'.
    if getattr(fit, "mode", None) is not None:
        mode_words = fit.mode.item.typeName.split()  # "<Ship> <Mode> Mode"
        if len(mode_words) >= 2 and mode_words[-1] == "Mode":
            slots["tactical"] = mode_words[-2]

    drones = [
        {"typeID": d.item.ID, "name": d.item.typeName,
         "qty": d.amount, "active": d.amountActive > 0}
        for d in fit.drones
    ]
    # Use appliedImplants, not implants: a fit can be set to draw implants from the CHARACTER
    # (implantLocation=CHARACTER) instead of the fit itself. eos then applies NONE of the fit's own
    # implants (our all-V oracle char carries none), while fit.implants still LISTS them. Emitting
    # fit.implants made calc.js apply implants eos ignored -- e.g. #2096 Corax Navy, full High-grade
    # Nirvana set: our 8987.6 shieldHP vs eos 5850, purely because the fit uses character implants.
    # appliedImplants is [] for character-source fits, so both engines see the same implants.
    implants = [{"name": i.item.typeName} for i in fit.appliedImplants]
    boosters = [{"name": b.item.typeName, "active": bool(b.active)} for b in fit.boosters]

    flags = {
        "mutated": mutated,
        "fighters": len(fit.fighters) > 0,
        # ALL FIVE projection collections, not just modules+fits. projectedDrones and
        # projectedFighters were missing, so a fit with (say) an Armor Maintenance Bot projected onto
        # it looked unflagged: eos folds the incoming reps into effectiveTank via _getAppliedArmorRr,
        # our spec carries no projection at all, and the fit shows up as a phantom engine divergence.
        # That is exactly what made saved Deacon #132 read eos 35.6 vs ours 0.0 armorRepEhpS —
        # rebuilding the same hull+modules by hand gives eos 0.0 too, i.e. our number was right.
        "projected": bool(getattr(fit, "projectedModules", []) or
                          getattr(fit, "projectedFits", {}) or
                          getattr(fit, "projectedDrones", []) or
                          getattr(fit, "projectedFighters", []) or
                          getattr(fit, "projectedFitDict", {})),
        # Gang/command boosts come from a LINKED command fit (fit.commandFits), not the fit's own
        # modules. eos folds those buffs into ship attrs (scan res, resists, speed...) but our spec
        # only carries the fit's own modules, so bucket these like projected fits.
        "commandBoosted": bool(getattr(fit, "commandFits", None)),
    }
    # System security (structure fits only): scales structure RIG bonuses by hiSec/lowSec/nullSec
    # modifier. eos defaults to NULLSEC when unset, so a fit explicitly set to hisec computes 20%
    # weaker rig bonuses. Without emitting this, calc.js used its own default and a real hisec
    # Fortizar diverged by exactly +19.6% on weapon DPS.
    _SEC_STR = {0: "hisec", 1: "lowsec", 2: "nullsec", 3: "wspace"}
    spec = {
        "ship": {"typeID": fit.ship.item.ID, "name": fit.ship.item.typeName},
        "slots": slots, "drones": drones,
        "implants": implants, "boosters": boosters,
        "systemSecurity": _SEC_STR.get(int(fit.getSystemSecurity()), "nullsec"),
    }
    return spec, flags


def main():
    e = get_eos()
    db = e["db"]
    global _FULL_SPOOL
    from eos.const import SpoolType
    from eos.utils.spoolSupport import SpoolOptions
    _FULL_SPOOL = SpoolOptions(SpoolType.SPOOL_SCALE, 1.0, True)
    # eos computes ehp/effectiveTank against each fit's SAVED damage pattern (some fits store a
    # pure-explosive or skewed profile). calc.js defaults EHP/rep-EHP to a UNIFORM 25/25/25/25 split
    # (calc.js line ~1829), so force the same uniform pattern here or the EHP/tank diff is just the
    # profile mismatch, not an engine bug (e.g. #245 Retribution: identical HP+resists, EHP 6190 vs
    # eos 13185 purely from a 0/0/0/1 explosive pattern; uniform makes eos 6190 exactly).
    from eos.saveddata.damagePattern import DamagePattern
    _UNIFORM_DP = DamagePattern(25, 25, 25, 25)
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    fit_list = db.getFitList()
    emitted = 0
    for meta in fit_list:
        fid = meta.ID
        try:
            fit = db.getFit(fid)
            if fit is None:
                continue
            fit.character = all_v_char()
            fit.damagePattern = _UNIFORM_DP
            fit.calculateModifiedAttributes()
            spec, flags = extract_spec(fit)
            rec = {
                "id": fid, "name": fit.name,
                "ship": fit.ship.item.typeName,
                "eos": eos_stats(fit),
                "spec": spec, "flags": flags,
            }
            sys.stdout.write(json.dumps(rec) + "\n")
            emitted += 1
        except Exception as ex:  # noqa: BLE001 -- keep going, report at end
            sys.stderr.write(f"FAIL fit {fid} ({meta.name!r}): {type(ex).__name__}: {ex}\n")
        if limit and emitted >= limit:
            break
    sys.stderr.write(f"emitted {emitted} fits\n")


if __name__ == "__main__":
    main()
