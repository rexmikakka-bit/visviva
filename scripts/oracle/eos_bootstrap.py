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
# The clone supplies the eos ENGINE code; it MUST match the gamedata db version or the oracle
# invents false "gaps". The default Pyfa-master clone is stale (v2.66.3) and lacks the v2.68 effect
# classes (e.g. Effect12897, the Astarte CS hybrid-damage bonus), so it reports 799.8 for a hull that
# eos v2.68 correctly puts at 1200. Point PYFA_ROOT at a matching clone (Pyfa-268) to avoid this.
_PYFA_ROOT = os.environ.get("PYFA_ROOT", os.path.join(_REPO_ROOT, "Pyfa-master"))

_eos = None


def get_eos():
    """Import and wire up eos exactly once, returning a namespace of handles."""
    global _eos
    if _eos is not None:
        return _eos

    if not os.path.isfile(GAMEDATA_DB):
        raise SystemExit(f"gamedata db not found: {GAMEDATA_DB}")

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
