"""Oracle baselines for a character who is NOT at all skills V.

Everything else in this directory measures an all-V pilot, which is the one case where the two
untrained-skill faults fixed in `dogma-engine.js` are invisible: a bonus attribute is never exactly
zero, so the "source attribute reads 0 -> substitute the attribute default" branch never fires and
the skill pass never has a level-0 skill to skip. This prints the two references that do exercise
them, and that `regression.test.mjs` section 12a pins:

  ZERO   an untrained Character(level 0)
  ALPHA  eos's own alpha clone ceiling — Character.Skill.level mins itself against
         `character.alphaClone`, so this is CCP's table applied by pyfa rather than by us.

Run:  /c/Python314/python scripts/oracle/oracle_untrained.py
"""
import json

from eos_bootstrap import get_eos
import oracle

CARACAL = {"ship": "Caracal"}
SPECS = {
    "bare":  {**CARACAL, "high": [], "mid": [], "low": [], "rigs": []},
    "ab":    {**CARACAL, "high": [], "mid": [{"name": "10MN Afterburner II", "state": "active"}],
              "low": [], "rigs": []},
    "plate": {**CARACAL, "high": [], "mid": [],
              "low": [{"name": "1600mm Steel Plates II", "state": "online"}], "rigs": []},
    "hml":   {**CARACAL, "high": [{"name": "Heavy Missile Launcher II", "state": "active",
                                   "ammo": "Scourge Fury Heavy Missile"}],
              "mid": [], "low": [], "rigs": []},
}
KEEP = ("weaponDps", "weaponVolley", "totalEHP", "shieldHP", "armorHP", "capDelta", "maxSpeed")


def measure(make_character):
    out = {}
    for name, spec in SPECS.items():
        fit = oracle.build_fit(spec)
        fit.character = make_character()
        s = oracle.stats(fit)
        row = {k: s[k] for k in KEEP if k in s}
        row["mass"] = fit.ship.getModifiedItemAttr("mass")
        out[name] = row
    return out


def main():
    e = get_eos()

    def zero():
        return e["Character"]("__oracle_zero", 0)

    def alpha():
        # An all-V character with the alpha ceiling applied on top: Skill.level takes
        # min(activeLevel, alphaClone.getSkillLevel(self)), so this is CCP's own table.
        c = e["Character"]("__oracle_alpha", 5)
        c.alphaCloneID = 1
        return c

    print(json.dumps({"zero": measure(zero), "alpha": measure(alpha)}, indent=1, default=str))


if __name__ == "__main__":
    main()
