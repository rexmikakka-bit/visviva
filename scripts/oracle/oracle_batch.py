"""Run a file of generated fit specs through eos and emit oracle_compare-compatible JSONL.

    node scripts/oracle/gen_structure_fits.mjs > scripts/oracle/_structfits.jsonl
    /c/Python314/python scripts/oracle/oracle_batch.py scripts/oracle/_structfits.jsonl \
        > scripts/oracle/_struct.jsonl
    node scripts/oracle/oracle_compare.mjs scripts/oracle/_struct.jsonl

This is the generated-fit sibling of oracle_saved.py (which reads your real pyfa fits). Both emit
the SAME record shape, so oracle_compare.mjs diffs either one without knowing where the fits came
from. Input records carry {id, name, ship, spec:{ship,slots,...}, meta}; output adds `eos` + `flags`.

Reuses build_fit() from oracle.py (so there is ONE definition of how a spec becomes an eos Fit) and
eos_stats() from oracle_saved.py (whose resists are per-channel LISTS, which is what
oracle_compare.mjs expects — oracle.py's own version returns a display string instead).
"""
import json
import os
import sys

_SEC_ENUM = {}

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from eos_bootstrap import get_eos          # noqa: E402
from oracle import build_fit               # noqa: E402
from oracle_saved import eos_stats         # noqa: E402


def _to_build_spec(rec):
    """gen_* emits calc.js shape ({ship:{name}, slots:{high:[]}}); build_fit wants racks at the
    top level and a plain ship NAME. Convert rather than teaching build_fit two shapes."""
    spec = rec["spec"]
    out = {"ship": spec["ship"]["name"], "name": rec.get("name", "")}
    for rack in ("high", "mid", "low", "rigs", "services"):
        out[rack] = spec.get("slots", {}).get(rack, [])
    for k in ("drones", "implants", "boosters"):
        out[k] = spec.get(k, [])
    return out


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: oracle_batch.py <specs.jsonl> [limit]")
    path = sys.argv[1]
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 0

    e = get_eos()
    from eos.const import FitSystemSecurity
    global _SEC_ENUM
    _SEC_ENUM = {"hisec": FitSystemSecurity.HISEC, "lowsec": FitSystemSecurity.LOWSEC,
                 "nullsec": FitSystemSecurity.NULLSEC, "wspace": FitSystemSecurity.WSPACE}
    # Uniform damage pattern: calc.js defaults to 25/25/25/25, and EHP is profile-weighted. Without
    # forcing it here, every EHP "mismatch" would just be the two sides using different profiles.
    from eos.saveddata.damagePattern import DamagePattern
    uniform = DamagePattern(25, 25, 25, 25)

    emitted = failed = 0
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            try:
                fit = build_fit(_to_build_spec(rec))
                fit.damagePattern = uniform
                # System security scales structure RIG bonuses (x1.0 hisec vs x1.2 elsewhere). If the
                # spec names one, eos MUST be told — otherwise it silently uses its nullsec default
                # and every hisec fit reads as a 20% "divergence" that is really a harness mismatch.
                sec = rec["spec"].get("systemSecurity")
                if sec:
                    fit.systemSecurity = _SEC_ENUM[sec]
                fit.calculateModifiedAttributes()
                out = {
                    "id": rec.get("id"),
                    "name": rec.get("name"),
                    "ship": rec["spec"]["ship"]["name"],
                    "eos": eos_stats(fit),
                    "spec": rec["spec"],
                    # Generated fits are plain by construction — no mutated modules, no projection,
                    # no fighters, no command links. oracle_compare buckets on these.
                    "flags": {"mutated": False, "fighters": False,
                              "projected": False, "commandBoosted": False},
                    "meta": rec.get("meta", {}),
                }
                sys.stdout.write(json.dumps(out) + "\n")
                emitted += 1
            except Exception as ex:  # noqa: BLE001 — one bad spec must not kill the sweep
                failed += 1
                sys.stderr.write(f"FAIL {rec.get('id')} ({rec.get('name')!r}): "
                                 f"{type(ex).__name__}: {ex}\n")
            if limit and emitted >= limit:
                break
    sys.stderr.write(f"emitted {emitted} fits ({failed} failed)\n")


if __name__ == "__main__":
    main()
