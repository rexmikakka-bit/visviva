"""Skill-sensitivity sweep, eos half.

    /c/Python314/python scripts/oracle/skill_sweep.py > scripts/oracle/_skills.jsonl
    node scripts/oracle/skill_sweep_compare.mjs scripts/oracle/_skills.jsonl

WHAT THIS ANSWERS, and why it is not the same question the other sweeps ask
--------------------------------------------------------------------------
oracle_compare.mjs asks "do the two engines agree on this fit's numbers", with every skill at V on
both sides. A skill that is a silent no-op in OUR engine is invisible to that: if neither side is
looking at it, or if some other error compensates, the totals still match.

This asks a different question — "does each SKILL do the same thing in both engines" — by zeroing
one skill at a time and recording how far each stat moves. A skill that our engine ignores shows up
as a zero delta against a non-zero one in eos, whichever way the absolute numbers happen to land.

It reports RELATIVE change ((zeroed - base) / base) rather than absolute values, deliberately: the
two engines use different units and conventions for several stats (metres vs km, resist strings),
and those are already covered elsewhere. Comparing the *shape* of each skill's influence isolates
"is this skill wired up" from "do we agree on the number", so a unit mismatch cannot masquerade as
a missing skill.

A skill no fit here exercises reports inert on BOTH sides and is simply out of the sweep's reach —
that is a coverage gap in skill_fits.json, not a pass. The compare half counts those separately.

eos gotcha this depends on: Character.addSkill() only REPLACES a skill when the new level is HIGHER,
so handing it a level-0 skill on an all-V character is silently ignored (which is what CLAUDE.md
warns about). Skill.setLevel() is the one that works. ignoreRestrict=True stops eos's strict-skill
cascade from also zeroing every dependent skill, which would make the result a prerequisite tree
rather than one skill.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from oracle import build_fit, get_eos  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SPECS = json.load(open(os.path.join(HERE, "skill_fits.json")))["fits"]


def _stats(fit):
    fit.calculateModifiedAttributes()
    ship = fit.ship
    ehp = fit.ehp
    tank = fit.effectiveTank
    # capDelta reads two PRIVATE fields that calculateModifiedAttributes() does not fill; it returns a
    # flat 0 until the cap simulation has run. Touching capUsed is what triggers simulateCap(). Without
    # this the stat is dead on every fit, and every cap skill reports as "we move it, eos does not".
    fit.capUsed
    return {
        "weaponDps": fit.getWeaponDps().total,
        "weaponVolley": fit.getWeaponVolley().total,
        "droneDps": fit.getDroneDps().total,
        "totalDps": fit.getTotalDps().total,
        "totalEHP": ehp["shield"] + ehp["armor"] + ehp["hull"],
        "shieldHP": ship.getModifiedItemAttr("shieldCapacity"),
        "armorHP": ship.getModifiedItemAttr("armorHP"),
        "hullHP": ship.getModifiedItemAttr("hp"),
        "armorRepEhpS": tank.get("armorRepair", 0) or tank.get("armorRepairFullSpool", 0),
        "shieldRepEhpS": tank.get("shieldRepair", 0),
        "capDelta": fit.capDelta,
        "capCapacity": ship.getModifiedItemAttr("capacitorCapacity"),
        "maxTargetRange": fit.maxTargetRange,
        "maxSpeed": fit.maxSpeed,
        "scanRes": ship.getModifiedItemAttr("scanResolution"),
        "sigRadius": ship.getModifiedItemAttr("signatureRadius"),
        "agility": ship.getModifiedItemAttr("agility"),
        "cpuUsed": fit.cpuUsed,
        "pgUsed": fit.pgUsed,
        "minerYield": fit.minerYield,
    }


def _build(spec, zero_skill=None):
    e = get_eos()
    fit = build_fit(spec)
    # build_fit does not know about fighters. Unlike drones, appending one does NOT set its owner,
    # and a fighter reads owner.factorReload while computing its own DPS — so an ownerless fighter
    # raises inside getDroneDps() rather than merely reading low.
    # eos has no multi-squadron Fighter: one object IS one squadron, and `amount` is how many fighters
    # are in it (setting it to the type's fighterSquadronMaxSize means "full"). `qty` here is SQUADRONS,
    # matching our side, so append that many. Assigning qty to `amount` instead reads as one partial
    # squadron and puts every fighter stat out by exactly the squadron size.
    for f in spec.get("fighters", []):
        for _ in range(f.get("qty", 1)):
            fighter = e["Fighter"](e["db"].getItem(f["name"], eager="group.category"))
            fighter.owner = fit
            fighter.active = f.get("active", True)
            fit.fighters.append(fighter)
    char = e["Character"]("__sweep_allV", 5)
    if zero_skill is not None:
        char.getSkill(zero_skill).setLevel(0, ignoreRestrict=True)
    fit.character = char
    return fit


def main():
    e = get_eos()
    skills = sorted(
        (i.name for i in e["Character"].getSkillList()),
        key=str.lower,
    )
    # --fit=<id>[,<id>] narrows the run to named fits, which is what makes a teeth test affordable:
    # revert a fix, re-sweep the one fit that exercises it, confirm it shows up.
    only = next((a.split("=", 1)[1].split(",") for a in sys.argv[1:] if a.startswith("--fit=")), None)
    specs = {k: v for k, v in SPECS.items() if only is None or k in only}
    print(f"# {len(skills)} skills x {len(specs)} fits", file=sys.stderr)

    for fit_id, spec in specs.items():
        base = _stats(_build(spec))
        print(json.dumps({"fit": fit_id, "skill": None, "stats": base}))
        for name in skills:
            try:
                st = _stats(_build(spec, name))
            except Exception as exc:  # a skill eos cannot resolve is data, not a failure
                print(json.dumps({"fit": fit_id, "skill": name, "error": str(exc)}))
                continue
            moved = {k: v for k, v in st.items() if v != base[k]}
            print(json.dumps({"fit": fit_id, "skill": name, "moved": moved}))
        print(f"#   {fit_id} done", file=sys.stderr)


if __name__ == "__main__":
    main()
