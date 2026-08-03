"""build-system-effects.py — extract pyfa's environment-effect handlers into a data table.

    python scripts/build-system-effects.py [--dry-run]

Environment effects (wormhole class effects, metaliminal storms, event beacons — "Effect Beacon",
group 920) are hand-coded in pyfa: eve.db carries no modifierInfo for them, so there is nothing for
build-bundle.py to preserve and they arrive inert. There are ~100 of them, all the same shape:

    read attribute X off the beacon, apply it to <ship | modules | charges | drones | fighters>
    with an optional skill/group filter, either as a multiplier or a percentage boost.

Transcribing 100 handlers by hand would be a hundred chances to typo an attribute name, so this
parses them out of Pyfa-master/eos/effects.py into src/data/system-effects.json, which
dogma-engine.js interprets. Anything it cannot parse is REPORTED, never skipped silently — an
environment effect that quietly does nothing is exactly the failure mode this project keeps hitting.

Emitted per effect: a list of operations
    {t: target, op: operation, a: attribute, s: beacon attribute, f: filter, p: stacking-penalised}
      t  : ship | modules | charges | drones | fighters
      op : mul (multiplyItemAttr/filtered*Multiply) | boost (boostItemAttr/filtered*Boost, percent)
           | inc (increaseItemAttr/filtered*Increase, flat add)
      f  : null, {skill:[names]} or {group:[names]}   (charges filter on the CHARGE's skill)
"""
import json
import os
import re
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EFFECTS_PY = os.path.join(ROOT, 'Pyfa-master', 'eos', 'effects.py')
OUT = os.path.join(ROOT, 'src', 'data', 'system-effects.json')
BEACON_GROUP = 920

TARGET_MAP = {
    ('ship', 'multiplyItemAttr'):        ('ship', 'mul'),
    ('ship', 'boostItemAttr'):           ('ship', 'boost'),
    ('ship', 'increaseItemAttr'):        ('ship', 'inc'),
    ('modules', 'filteredItemMultiply'): ('modules', 'mul'),
    ('modules', 'filteredItemBoost'):    ('modules', 'boost'),
    ('modules', 'filteredItemIncrease'): ('modules', 'inc'),
    ('modules', 'filteredChargeMultiply'): ('charges', 'mul'),
    ('modules', 'filteredChargeBoost'):  ('charges', 'boost'),
    ('drones', 'filteredItemMultiply'):  ('drones', 'mul'),
    ('drones', 'filteredItemBoost'):     ('drones', 'boost'),
    ('fighters', 'filteredItemMultiply'): ('fighters', 'mul'),
    ('fighters', 'filteredItemBoost'):   ('fighters', 'boost'),
}

CALL = re.compile(r'fit\.(?P<coll>ship|modules|drones|fighters)\.(?P<fn>\w+)\(', re.S)
# The receiver is variously named beacon/module/src/source depending on the handler.
SRC_ATTR = re.compile(r"\w+\.getModifiedItemAttr\(\s*'([^']+)'\s*\)")
REQ_SKILL = re.compile(r"requiresSkill\(\s*'([^']+)'\s*\)")
GROUP_EQ = re.compile(r"group\.name\s*(?:==|in)\s*\(?\s*((?:'[^']*'\s*,?\s*)+)\)?")
# `lambda mod: 'heatDamage' in mod.itemModifiedAttributes` — filter on the module CARRYING an
# attribute at all, which is how every overload effect selects overloadable modules.
HAS_ATTR = re.compile(r"'([^']+)'\s+in\s+\w+\.itemModifiedAttributes")
# `lambda drone: True` — no filter, applies to the whole collection.
NO_FILTER = re.compile(r'^lambda\s+\w+\s*:\s*True\s*$', re.S)
# Several handlers loop a damage type or scan type over a tuple and build attribute names with
# .format(); expand those textually so the extractor sees plain literals.
FOR_LOOP = re.compile(r'^(?P<ind>[ \t]*)for\s+(?P<var>\w+)\s+in\s+\((?P<vals>[^)]*)\):\s*$', re.M)


def expand_loops(body):
    """Unroll `for x in ('a','b'):` blocks, resolving both '...{}...'.format(x) and f'...{x}...'."""
    # Some handlers bind the tuple to a name first (`damages = ('em', ...)` then `for damage in
    # damages:`); inline those so the loop matcher sees a literal tuple.
    for name, vals in re.findall(r'^[ \t]*(\w+)\s*=\s*(\([^)]*\))\s*$', body, re.M):
        body = re.sub(r'(for\s+\w+\s+in\s+)%s\s*:' % re.escape(name), r'\g<1>%s:' % vals, body)
    while True:
        m = FOR_LOOP.search(body)
        if not m:
            return body
        var, ind = m.group('var'), m.group('ind')
        vals = re.findall(r"'([^']*)'", m.group('vals'))
        # the loop body is everything indented deeper than the `for`
        rest = body[m.end():]
        lines, taken = rest.split('\n'), []
        for ln in lines:
            if ln.strip() and not ln.startswith(ind + ' ') and not ln.startswith(ind + '\t'):
                break
            taken.append(ln)
        block = '\n'.join(taken)
        out = []
        for v in vals:
            b = block
            # '...{}...'.format(var) / '...{0}...'.format(var.capitalize())
            def fmt(mm, v=v):
                lit, arg = mm.group(1), mm.group(2)
                val = v.capitalize() if '.capitalize()' in arg else v
                return "'" + lit.replace('{0}', val).replace('{}', val) + "'"
            # The format arg may itself be a call — .format(damage.capitalize()) — so allow one
            # level of nested parens; [^)]* stops at the inner ')' and leaves a dangling one,
            # which then breaks argument splitting entirely.
            b = re.sub(r"'([^']*)'\.format\(\s*((?:[^()]|\([^()]*\))*?)\s*\)", fmt, b)
            # f-strings: f'scan{sensor_type}Strength' -> 'scanGravimetricStrength'
            b = re.sub(r"f'([^']*)'",
                       lambda mm, v=v: "'" + mm.group(1)
                           .replace('{%s.capitalize()}' % var, v.capitalize())
                           .replace('{%s}' % var, v) + "'", b)
            # a bare loop variable used as an argument (e.g. `attr`)
            b = re.sub(r'(?<![\w.\'])%s(?![\w(])' % re.escape(var), "'%s'" % v, b)
            out.append(b)
        body = body[:m.start()] + '\n'.join(out) + rest[len(block):]


def split_args(text):
    """Split a call's argument list on top-level commas (pyfa nests lambdas and calls)."""
    args, depth, cur, instr = [], 0, '', None
    for ch in text:
        if instr:
            cur += ch
            if ch == instr:
                instr = None
            continue
        if ch in "'\"":
            instr = ch; cur += ch; continue
        if ch in '([{':
            depth += 1
        elif ch in ')]}':
            if depth == 0:
                break
            depth -= 1
        if ch == ',' and depth == 0:
            args.append(cur); cur = ''
        else:
            cur += ch
    if cur.strip():
        args.append(cur)
    return [a.strip() for a in args]


def call_body(text, start):
    """Return the text inside the parens of a call whose '(' is at `start`."""
    depth, i = 0, start
    while i < len(text):
        if text[i] == '(':
            depth += 1
        elif text[i] == ')':
            depth -= 1
            if depth == 0:
                return text[start + 1:i]
        i += 1
    return ''


def main():
    dry = '--dry-run' in sys.argv
    if not os.path.isfile(EFFECTS_PY):
        sys.exit(f"pyfa source not found at {EFFECTS_PY}")
    db_path = r'C:\Program Files\pyfa\app\eve.db'
    for cand in (os.path.join(ROOT, 'Pyfa-268', 'eve.db'), db_path, os.path.join(ROOT, 'eve.db')):
        if os.path.isfile(cand):
            db_path = cand
            break
    db = sqlite3.connect(db_path)
    ids = sorted({r[0] for r in db.execute(
        'SELECT DISTINCT te.effectID FROM dgmtypeeffects te JOIN invtypes t ON t.typeID=te.typeID '
        'WHERE t.groupID=?', (BEACON_GROUP,))})
    names = {r[0]: r[1] for r in db.execute('SELECT effectID,effectName FROM dgmeffects')}
    src = open(EFFECTS_PY, encoding='utf-8').read()

    table, unimplemented, problems = {}, [], []
    for eid in ids:
        m = re.search(r'^class Effect%d\(BaseEffect\):(.*?)(?=^class |\Z)' % eid, src, re.S | re.M)
        if not m:
            unimplemented.append(eid)
            continue
        body = expand_loops(m.group(1))
        ops = []
        # A few beacons (Pochven's Final Liminality, the Insurgency suppression beacons) do not
        # modify attributes directly — they hand WARFARE BUFFS to the fit exactly as a command burst
        # does, via fit.addCommandBonus. Emit a marker so the caller can push warfareBuffNID/Value
        # through the existing burst machinery instead of inventing a second one.
        if 'addCommandBonus' in body:
            slots = 4 if re.search(r'range\(\s*1\s*,\s*5\s*\)', body) else 1
            ops.append({'t': 'buff', 'n': slots})
        for cm in CALL.finditer(body):
            coll, fn = cm.group('coll'), cm.group('fn')
            key = TARGET_MAP.get((coll, fn))
            if key is None:
                problems.append(f"effect {eid} ({names.get(eid)}): unknown call fit.{coll}.{fn}()")
                continue
            target, op = key
            args = split_args(call_body(body, cm.end() - 1))
            if not args:
                problems.append(f"effect {eid}: empty arg list for fit.{coll}.{fn}()")
                continue
            # ship.*(attr, value)  |  filtered*(lambda, attr, value)
            filt, rest = (None, args) if coll == 'ship' else (args[0], args[1:])
            if len(rest) < 2:
                problems.append(f"effect {eid}: too few args for fit.{coll}.{fn}()")
                continue
            am = re.fullmatch(r"'([^']+)'", rest[0].strip())
            sm = SRC_ATTR.search(rest[1])
            if not am or not sm:
                problems.append(f"effect {eid}: cannot read attr/source from {rest[:2]}")
                continue
            entry = {'t': target, 'op': op, 'a': am.group(1), 's': sm.group(1)}
            if filt is not None:
                skills = REQ_SKILL.findall(filt)
                grp = GROUP_EQ.search(filt)
                hasattr_m = HAS_ATTR.search(filt)
                if NO_FILTER.match(filt.strip()):
                    pass                                    # applies to the whole collection
                elif skills:
                    entry['f'] = {'skill': sorted(set(skills))}
                elif grp:
                    entry['f'] = {'group': sorted(set(re.findall(r"'([^']*)'", grp.group(1))))}
                elif hasattr_m:
                    entry['f'] = {'hasAttr': hasattr_m.group(1)}
                else:
                    problems.append(f"effect {eid}: unparsed filter {filt.strip()[:90]}")
                    continue
            # stackingPenalties=True anywhere in this call's args
            entry['p'] = any('stackingPenalties=True' in a for a in args)
            ops.append(entry)
        if ops:
            table[str(eid)] = ops
        else:
            problems.append(f"effect {eid} ({names.get(eid)}): implemented by pyfa but produced NO ops")

    print(f"group {BEACON_GROUP} effects: {len(ids)}")
    print(f"  extracted   : {len(table)}  ({sum(len(v) for v in table.values())} operations)")
    print(f"  not in pyfa : {len(unimplemented)}  {unimplemented}")
    if problems:
        print(f"\n!! {len(problems)} PROBLEM(S) — these would be silent no-ops, fix before shipping:")
        for p in problems:
            print('   ', p)
    if dry:
        print('\n--dry-run: nothing written.')
        return
    if problems:
        sys.exit('\nrefusing to write with unresolved problems above.')
    payload = {'_README': [
        "Auto-generated by scripts/build-system-effects.py from pyfa's eos/effects.py.",
        "Environment effects (Effect Beacon, group 920): wormhole class effects, metaliminal storms.",
        "CCP ships no modifierInfo for these, so they are hand-coded in pyfa and transcribed here.",
        "t=target(ship|modules|charges|drones|fighters) op=mul|boost|inc a=target attr",
        "s=attribute read off the beacon f=filter(skill|group) p=stacking-penalised",
    ], 'effects': table}
    with open(OUT, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(payload, fh, indent=1, ensure_ascii=True)
        fh.write('\n')
    print(f"\nwrote {OUT}")


if __name__ == '__main__':
    main()
