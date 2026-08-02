"""Headless bootstrap for pyfa's eos engine.

Points eos at the authoritative pyfa gamedata db (build 3424810) and exposes
helpers to build a Fit programmatically. Importing this module wires eos up;
`get_eos()` returns the loaded namespace.

Python note: the real interpreter on this machine is C:\\Python314\\python.exe
(`python`/`py` hit a Store alias stub). Run with:

    /c/Python314/python scripts/oracle/eos_bootstrap.py
"""
import os
import sys

# Authoritative pyfa gamedata db that matches our bundle (client build 3424810).
GAMEDATA_DB = os.environ.get(
    "EOS_GAMEDATA_DB", r"C:\Program Files\pyfa\app\eve.db"
)

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# The clone supplies the eos ENGINE code; it MUST match the gamedata db version. eos hand-codes
# every effect as a Python class, so a clone older than the db is missing classes for whatever CCP
# added since — and a missing class is a SILENT no-op, not an error. The oracle then reports a
# confident wrong number and it looks like OUR bug.
_PYFA_ROOT = os.environ.get("PYFA_ROOT", os.path.join(_REPO_ROOT, "Pyfa-master"))

# Sentinel effect classes that exist only in the version matching GAMEDATA_DB. Checked at import so
# a stale clone fails LOUDLY instead of quietly costing an afternoon. Effect12897 is the worked
# example: the Astarte's Command Ships bonus moved to it in v2.68, and a v2.66.3 clone drops the
# whole bonus and reports weaponDps 799.8 where the correct answer is 1199.6.
# When you upgrade eve.db + the clone together, update this list to an effect new in THAT version.
_VERSION_SENTINELS = {"Effect12897": "v2.68 (Astarte Command Ships hybrid-damage bonus)"}


def _assert_clone_matches_db():
    effects_py = os.path.join(_PYFA_ROOT, "eos", "effects.py")
    if not os.path.isfile(effects_py):
        raise SystemExit(
            f"pyfa clone not found at {_PYFA_ROOT}\n"
            "  Clone the pyfa SOURCE matching your eve.db, or set PYFA_ROOT."
        )
    with open(effects_py, "r", encoding="utf-8", errors="ignore") as fh:
        src = fh.read()
    missing = [f"{cls}  [{why}]" for cls, why in _VERSION_SENTINELS.items()
               if f"class {cls}(" not in src]
    if missing:
        raise SystemExit(
            "pyfa clone is STALE relative to the gamedata db — refusing to run.\n"
            f"  clone: {_PYFA_ROOT}\n"
            f"  db:    {GAMEDATA_DB}\n"
            "  missing effect classes:\n    " + "\n    ".join(missing) + "\n"
            "  eos silently no-ops effects it has no class for, so the oracle would report\n"
            "  wrong numbers as if they were pyfa's truth. Update the clone to match the db."
        )

_eos = None


def get_eos():
    """Import and wire up eos exactly once, returning a namespace of handles."""
    global _eos
    if _eos is not None:
        return _eos

    if not os.path.isfile(GAMEDATA_DB):
        raise SystemExit(f"gamedata db not found: {GAMEDATA_DB}")

    _assert_clone_matches_db()

    if _PYFA_ROOT not in sys.path:
        sys.path.insert(0, _PYFA_ROOT)

    # Force saveddata into an in-memory sqlite (no user db writes).
    sys._called_from_test = True

    import eos.config as config
    config.gamedata_connectionstring = "sqlite:///" + GAMEDATA_DB.replace("\\", "/")

    # eos.db.migration does `import config` (pyfa's GUI app config, which pulls
    # in wx). It only touches config.savePath / config.saveDB inside update(),
    # which is never called on our headless path — so a bare stub avoids wx.
    import types as _types
    if "config" not in sys.modules:
        _stub = _types.ModuleType("config")
        _stub.savePath = os.path.dirname(GAMEDATA_DB)
        _stub.saveDB = None
        sys.modules["config"] = _stub

    import eos.db as db  # reads config at import time

    from eos.gamedata import Item
    from eos.saveddata.ship import Ship
    from eos.saveddata.citadel import Citadel
    from eos.saveddata.fit import Fit
    from eos.saveddata.character import Character
    from eos.saveddata.module import Module
    from eos.saveddata.mode import Mode
    from eos.saveddata.drone import Drone
    from eos.saveddata.fighter import Fighter
    from eos.saveddata.booster import Booster
    from eos.saveddata.implant import Implant
    from eos.const import FittingModuleState

    _eos = {
        "config": config,
        "db": db,
        "Item": Item,
        "Ship": Ship,
        "Citadel": Citadel,
        "Fit": Fit,
        "Character": Character,
        "Module": Module,
        "Mode": Mode,
        "Drone": Drone,
        "Fighter": Fighter,
        "Booster": Booster,
        "Implant": Implant,
        "State": FittingModuleState,
    }
    return _eos


def get_item(name):
    e = get_eos()
    return e["db"].getItem(name)


def all_skills_v(fit):
    """Attach an all-skills-at-V character to the fit."""
    e = get_eos()
    char = e["Character"]("__oracle_allV", 5)  # defaultLevel=5, initSkills=True
    fit.character = char
    return char


if __name__ == "__main__":
    e = get_eos()
    print("eos loaded; gamedata:", e["config"].gamedata_connectionstring)

    item = e["db"].getItem("Rifter")
    print("Rifter item:", item, "typeID", getattr(item, "ID", getattr(item, "typeID", "?")))

    ship = e["Ship"](item)
    fit = e["Fit"](ship, "oracle Rifter")

    char = e["Character"]("__oracle_allV", 5)
    fit.character = char

    fit.calculateModifiedAttributes()

    for attr in ("hp", "armorHP", "shieldCapacity", "maxTargetRange", "scanResolution"):
        print(f"  {attr:16} = {ship.getModifiedItemAttr(attr)}")
