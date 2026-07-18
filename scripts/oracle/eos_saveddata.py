"""Wire eos headless with saveddata pointed at a COPY of the user's real db.

Unlike eos_bootstrap (which forces saveddata to :memory:), this loads the user's
1700+ saved pyfa fits so the oracle can diff each against calc.js. We copy the db
first so eos's import-time migrations / any writes never touch the real file.

Run standalone to smoke-test:  /c/Python314/python scripts/oracle/eos_saveddata.py
"""
import os
import sys
import shutil
import tempfile

GAMEDATA_DB = os.environ.get("EOS_GAMEDATA_DB", r"C:\Program Files\pyfa\app\eve.db")
USER_SAVEDDATA = os.environ.get("EOS_SAVEDDATA_DB", r"C:\Users\owen_\.pyfa\saveddata.db")

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# The clone supplies the eos ENGINE code; the gamedata db supplies the numbers. They must be the SAME
# pyfa version or the oracle produces false "gaps" -- a v2.66.3 clone against v2.68.0 data reported the
# Astarte/Claymore damage-bonus effects (12897/12892/12893) as unimplemented when v2.68.0 in fact
# implements them. Override with PYFA_ROOT to point at a matching clone.
_PYFA_ROOT = os.environ.get("PYFA_ROOT", os.path.join(_REPO_ROOT, "Pyfa-master"))

_eos = None
_tmp_saveddata = None


def get_eos():
    global _eos, _tmp_saveddata
    if _eos is not None:
        return _eos

    for p in (GAMEDATA_DB, USER_SAVEDDATA):
        if not os.path.isfile(p):
            raise SystemExit(f"db not found: {p}")

    # Copy the user's saveddata so migrations/writes hit the copy, never the real db.
    fd, _tmp_saveddata = tempfile.mkstemp(prefix="oracle_saveddata_", suffix=".db")
    os.close(fd)
    shutil.copy2(USER_SAVEDDATA, _tmp_saveddata)

    if _PYFA_ROOT not in sys.path:
        sys.path.insert(0, _PYFA_ROOT)

    import eos.config as config
    config.gamedata_connectionstring = "sqlite:///" + GAMEDATA_DB.replace("\\", "/")
    config.saveddata_connectionstring = "sqlite:///" + _tmp_saveddata.replace("\\", "/")

    import types as _types
    if "config" not in sys.modules:
        _stub = _types.ModuleType("config")
        _stub.savePath = os.path.dirname(_tmp_saveddata)
        _stub.saveDB = _tmp_saveddata
        sys.modules["config"] = _stub

    import eos.db as db

    from eos.gamedata import Item
    from eos.saveddata.ship import Ship
    from eos.saveddata.fit import Fit
    from eos.saveddata.character import Character
    from eos.const import FittingModuleState

    _eos = {
        "config": config, "db": db, "Item": Item, "Ship": Ship, "Fit": Fit,
        "Character": Character, "State": FittingModuleState,
    }
    return _eos


def all_v_char():
    e = get_eos()
    return e["Character"]("__oracle_allV", 5)


if __name__ == "__main__":
    e = get_eos()
    db = e["db"]
    fits = db.getFitList()
    print("loaded fits:", len(fits))
    f = db.getFit(1)
    if f:
        f.character = all_v_char()
        f.calculateModifiedAttributes()
        print("fit 1:", f.name, "ship:", f.ship.item.typeName)
        print("  modules:", len([m for m in f.modules if not m.isEmpty]))
        print("  dps:", f.getTotalDps().total, "ehp:", sum(f.ehp.values()) if f.ehp else 0)
