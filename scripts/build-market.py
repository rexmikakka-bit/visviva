#!/usr/bin/env python3
"""
build-market.py — regenerate src/data/modules.json and src/data/market-tree.json.

    python scripts/build-market.py                     # auto-detect eve.db, write both files
    python scripts/build-market.py --db path/to/eve.db # explicit path
    python scripts/build-market.py --dry-run           # semantic diff, write nothing

Then ALWAYS verify:

    npm run verify

────────────────────────────────────────────────────────────────────────────────
WHY THIS EXISTS

Both files were committed once, by hand, in 35b917b "complete file copy", and no
generator ever existed. dogma-types.json has been regenerated many times since,
so the two drifted apart: the market browser was reading a snapshot of the game
from before several CCP rebalances while the fitting engine read the current one.
Concretely, at the time this was written the browser still showed pre-nerf railgun
tracking and range, pre-revamp mining laser cycle times, and 106 boosters CCP has
since deleted, and it was missing 36 published modules including 8 officer drops.

The fix for that class of drift is a generator, not another hand-copy.

────────────────────────────────────────────────────────────────────────────────
WHERE EACH FIELD COMES FROM

Type-level data (name, group, attributes, required skills, meta group) is read
from dogma-types.json, NOT from eve.db directly. That is deliberate: dogma-types
is the file the fitting engine reads, and it has already had data-patches.json
applied. Deriving the browser from the same file is what keeps the number in the
market list equal to the number in the fit.

eve.db supplies only what dogma-types does not carry: each type's marketGroupID,
and the market group tree itself (names and parents).

WHAT eve.db CANNOT GIVE US: the little icon shown next to a market group is a
representative typeID (group "Standard Frigates" is drawn as a Rifter), and that
mapping is not in the SDE under any column — invmarketgroups.iconID is a different
thing entirely. Those representatives are curated, so they are PRESERVED from the
existing market-tree.json, the same way build-bundle.py preserves effect modifiers.
A genuinely new group falls back to its lowest typeID and is reported.
"""

import argparse, json, os, sqlite3, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'src', 'data')

# Categories the market browser can show. Skills (16) are deliberately absent: they are
# not fittable, so they have no place in a browser used to put things on a ship.
#  6 Ship  7 Module  8 Charge  18 Drone  20 Implant  22 Deployable
# 32 Subsystem  65 Structure  66 Structure Module  87 Fighter
MARKET_CATS = {6, 7, 8, 18, 20, 22, 32, 65, 66, 87}
MODULE_CAT = 7

# EVE encodes a module's slot as an effect, not an attribute.
SLOT_BY_EFFECT = [(12, 'high'), (13, 'mid'), (11, 'low'), (2663, 'rigs')]

# CCP's metaGroupID -> the label the UI shows. Kept identical to META_BY_MG in
# src/lib/meta.js; if that map gains a tier, mirror it here.
META_BY_MG = {1: 'T1', 2: 'T2', 3: 'Storyline', 4: 'Faction', 5: 'Officer', 6: 'Deadspace',
              14: 'T3', 15: 'Abyssal', 17: 'Premium', 19: 'Limited',
              52: 'Faction', 53: 'T2', 54: 'T1'}

CHARGE_GROUP_ATTRS = [604, 605, 606, 609, 610]
RESONANCES = {  # em, th, kin, exp
    'dcShield': (271, 274, 273, 272),
    'dcArmor':  (267, 270, 269, 268),
    'dcHull':   (974, 977, 976, 975),
}

# field -> attribute ID, for every field that is a plain passthrough of one attribute
# and is null when the type does not carry it.
PLAIN = {
    'rigSize': 1547, 'dmgMult': 64, 'rofMult': 204, 'rof': 51, 'tracking': 160,
    'chargeSize': 128, 'thDmg': 118, 'kinDmg': 117, 'expDmg': 116,
    'shieldBonus': 68, 'armorBonus': 84, 'duration': 73, 'capUse': 6,
    'shieldHPBonus': 72, 'sigRadAdd': 983, 'armorHPAdd': 1159, 'massAdd': 796,
    'armorHPMult': 148, 'emResBonus': 984, 'expResBonus': 985, 'kinResBonus': 986,
    'thResBonus': 987, 'shieldRechargeBonus': 338, 'capRechargeMult': 144,
    'pgMult': 145, 'shieldCapMult': 146, 'capCapMult': 147, 'cpuMult': 202,
    'pgAdd': 549, 'capAdd': 67, 'velBonus': 1076, 'agilMult': 169,
    'sigRadBonus': 554, 'velMod': 306, 'speedFactor': 20, 'maxRangeBonus': 351,
    'trackingBonus': 767, 'falloffBonus': 349, 'scanResBonus': 566,
    'targetRangeBonus': 309, 'scanResMult': 565, 'maxLockedTargetsBonus': 235,
    'overloadRangeBonus': 1222, 'overloadHardeningBonus': 1208,
    'overloadShieldBoostBonus': 1231, 'overloadArmorRepBonus': 1230,
    'overloadDurationBonus': 1206, 'rigDurationBonus': 312, 'reloadMs': 1795,
    'energyNeutAmt': 97, 'capTransferAmt': 90,
}
# Fitting costs read as 0, not null, when absent — a module with no powergrid line uses none.
ZERO_DEFAULT = {'cpu': 50, 'pg': 30, 'cal': 1153, 'capacity': 38}
# Stored in metres by CCP, shown in kilometres.
KM = {'optimal': 54, 'falloff': 158}
# Never populated for any type. Kept so the record shape does not change under consumers.
ALWAYS_NULL = ['maxGroupFit', 'hullBonus', 'shieldRechargeMult', 'drawback']

FIELD_ORDER = ['typeID', 'name', 'groupID', 'groupName', 'marketGroupID', 'marketGroupPath',
               'slot', 'meta', 'cpu', 'pg', 'cal', 'maxGroupFit', 'rigSize', 'dmgMult',
               'rofMult', 'rof', 'tracking', 'optimal', 'falloff', 'chargeSize', 'chargeGroups',
               'thDmg', 'kinDmg', 'expDmg', 'shieldBonus', 'armorBonus', 'hullBonus', 'duration',
               'capUse', 'shieldHPBonus', 'sigRadAdd', 'armorHPAdd', 'massAdd', 'armorHPMult',
               'dcShield', 'dcArmor', 'dcHull', 'emResBonus', 'expResBonus', 'kinResBonus',
               'thResBonus', 'shieldRechargeMult', 'shieldRechargeBonus', 'capRechargeMult',
               'pgMult', 'shieldCapMult', 'capCapMult', 'cpuMult', 'pgAdd', 'capAdd', 'velBonus',
               'agilMult', 'sigRadBonus', 'velMod', 'speedFactor', 'maxRangeBonus',
               'trackingBonus', 'falloffBonus', 'scanResBonus', 'targetRangeBonus', 'scanResMult',
               'maxLockedTargetsBonus', 'drawback', 'overloadRangeBonus', 'overloadHardeningBonus',
               'overloadShieldBoostBonus', 'overloadArmorRepBonus', 'overloadDurationBonus',
               'rigDurationBonus', 'capacity', 'reloadMs', 'energyNeutAmt', 'capTransferAmt',
               'requiredSkills']


def find_db(explicit=None):
    """Same probe order as build-bundle.py: installed pyfa first, repo-root copy last.
    The repo-root eve.db is a superseded leftover and picking it silently regenerates
    from an old client build."""
    if explicit:
        if not os.path.isfile(explicit):
            sys.exit(f"eve.db not found at {explicit}")
        return explicit
    for c in [os.path.join('Pyfa-268', 'eve.db'), os.path.join('Pyfa-268', 'app', 'eve.db'),
              os.path.join('Pyfa-master', 'eve.db'), os.path.join('Pyfa-master', 'app', 'eve.db')]:
        p = os.path.join(ROOT, c)
        if os.path.isfile(p):
            return p
    for p in [r'C:\Program Files\pyfa\app\eve.db', os.path.join(ROOT, 'eve.db')]:
        if os.path.isfile(p):
            return p
    sys.exit("Could not find eve.db. Pass --db path/to/eve.db (it ships inside pyfa).")


def num(v):
    """CCP stores everything as REAL; keep integers as integers so the JSON stays small."""
    if v is None:
        return None
    f = float(v)
    return int(f) if f.is_integer() else f


def build(db_path):
    types = json.load(open(os.path.join(DATA, 'dogma-types.json'), encoding='utf-8'))
    prev_tree = json.load(open(os.path.join(DATA, 'market-tree.json'), encoding='utf-8'))

    db = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
    cur = db.cursor()
    groups = {r[0]: {'n': r[1], 'p': r[2] or None} for r in
              cur.execute('SELECT marketGroupID, marketGroupName, parentGroupID FROM invmarketgroups')}
    market_of = {}
    for tid, mgid, cat in cur.execute(
            'SELECT t.typeID, t.marketGroupID, g.categoryID FROM invtypes t '
            'JOIN invgroups g ON g.groupID = t.groupID WHERE t.published = 1'):
        if mgid and cat in MARKET_CATS:
            market_of[tid] = (mgid, cat)
    db.close()

    # A type must also be in dogma-types.json: the browser has to be able to hand whatever the
    # user taps to the fitting engine, and the engine only knows types that live in that file.
    members = {t: v for t, v in market_of.items() if str(t) in types and v[0] in groups}
    dropped_unknown = sorted(t for t in market_of if str(t) not in types)

    tree_t = {}
    for tid in sorted(members):
        rec = types[str(tid)]
        tree_t[str(tid)] = [members[tid][0], rec['n'], num(rec['a'].get('161')) or 0.0]

    # Every group holding a member, plus all of their ancestors, so no branch is orphaned.
    needed = set()
    for tid in members:
        g = members[tid][0]
        while g and g not in needed:
            needed.add(g)
            g = groups[g]['p']

    by_group = {}
    for tid in members:
        by_group.setdefault(members[tid][0], []).append(tid)

    prev_icons = {int(k): v.get('i') for k, v in prev_tree['g'].items()}
    tree_g, new_groups = {}, []
    for gid in sorted(needed):
        icon = prev_icons.get(gid)
        if icon is None:
            icon = min(by_group.get(gid, [0])) or None
            new_groups.append((gid, groups[gid]['n'], icon))
        tree_g[str(gid)] = {'n': groups[gid]['n'], 'p': groups[gid]['p'], 'i': icon}

    def path_of(gid):
        out = []
        while gid:
            out.append(groups[gid]['n'])
            gid = groups[gid]['p']
        return out[::-1]

    modules = {}
    for tid in sorted(t for t, v in members.items() if v[1] == MODULE_CAT):
        rec = types[str(tid)]
        a = rec['a']
        attr = lambda i: num(a.get(str(i)))
        effects = set(rec.get('e') or [])
        slot = next((s for e, s in SLOT_BY_EFFECT if e in effects), None)
        m = {
            'typeID': tid,
            'name': rec['n'],
            'groupID': rec['g'],
            'groupName': rec.get('gn'),
            'marketGroupID': members[tid][0],
            'marketGroupPath': path_of(members[tid][0]),
            'slot': slot,
            'meta': META_BY_MG.get(rec.get('mg'), 'T1'),
        }
        for f, i in ZERO_DEFAULT.items():
            m[f] = attr(i) or 0
        for f, i in KM.items():
            m[f] = num((attr(i) or 0) / 1000)
        for f, i in PLAIN.items():
            m[f] = attr(i)
        for f in ALWAYS_NULL:
            m[f] = None
        m['chargeGroups'] = [int(v) for v in (attr(i) for i in CHARGE_GROUP_ATTRS) if v]
        for f, (em, th, kin, exp) in RESONANCES.items():
            vals = {'em': attr(em), 'th': attr(th), 'kin': attr(kin), 'exp': attr(exp)}
            m[f] = vals if any(v is not None for v in vals.values()) else None
        m['requiredSkills'] = rec.get('rs') or []
        modules[str(tid)] = {k: m[k] for k in FIELD_ORDER}

    return modules, {'g': tree_g, 't': tree_t}, new_groups, dropped_unknown


def report(modules, tree):
    """Semantic diff against what is committed, so a reviewer sees which items and which
    numbers moved rather than a one-line 5 MB blob."""
    old_m = json.load(open(os.path.join(DATA, 'modules.json'), encoding='utf-8'))
    old_t = json.load(open(os.path.join(DATA, 'market-tree.json'), encoding='utf-8'))

    for label, old, new in (('modules.json', old_m, modules), ('market-tree.json/t', old_t['t'], tree['t'])):
        added, removed = sorted(set(new) - set(old), key=int), sorted(set(old) - set(new), key=int)
        name = (lambda k: new[k]['name']) if label == 'modules.json' else (lambda k: new[k][1])
        oname = (lambda k: old[k]['name']) if label == 'modules.json' else (lambda k: old[k][1])
        print(f"\n{label}: {len(old)} -> {len(new)}  (+{len(added)} / -{len(removed)})")
        for k in added:
            print(f"   + {k:>6}  {name(k)}")
        for k in removed:
            print(f"   - {k:>6}  {oname(k)}")

    changed = {}
    for k in set(old_m) & set(modules):
        for f in FIELD_ORDER:
            if old_m[k].get(f) != modules[k][f]:
                changed.setdefault(f, []).append((modules[k]['name'], old_m[k].get(f), modules[k][f]))
    print(f"\nchanged values on existing modules: {sum(len(v) for v in changed.values())}")
    for f, rows in sorted(changed.items(), key=lambda kv: -len(kv[1])):
        print(f"   {f}: {len(rows)}")
        for n, o, w in rows[:4]:
            print(f"       {n[:44]:<44} {o} -> {w}")
        if len(rows) > 4:
            print(f"       ... and {len(rows) - 4} more")

    gdiff = [(k, old_t['g'].get(k), tree['g'].get(k)) for k in set(old_t['g']) | set(tree['g'])
             if old_t['g'].get(k) != tree['g'].get(k)]
    print(f"\nmarket group changes: {len(gdiff)}")
    for k, o, n in gdiff[:10]:
        print(f"   {k}: {o} -> {n}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    db_path = find_db(args.db)
    print(f"eve.db: {db_path}")

    modules, tree, new_groups, dropped_unknown = build(db_path)
    print(f"modules: {len(modules)}   market types: {len(tree['t'])}   market groups: {len(tree['g'])}")

    if dropped_unknown:
        print(f"\n{len(dropped_unknown)} published market types are absent from dogma-types.json "
              f"and were skipped. If this list is not empty, regenerate the dogma bundle first "
              f"(python scripts/build-bundle.py) so the browser and the engine agree:")
        for t in dropped_unknown[:20]:
            print(f"   {t}")
    if new_groups:
        print(f"\n{len(new_groups)} NEW market groups have no curated icon and fell back to their "
              f"lowest typeID. Check these look right in the browser:")
        for gid, n, icon in new_groups:
            print(f"   {gid} {n} -> {icon}")

    report(modules, tree)

    if args.dry_run:
        print("\n--dry-run: nothing written.")
        return

    with open(os.path.join(DATA, 'modules.json'), 'w', encoding='utf-8', newline='') as f:
        json.dump(modules, f, separators=(',', ':'), ensure_ascii=False)
    with open(os.path.join(DATA, 'market-tree.json'), 'w', encoding='utf-8', newline='') as f:
        json.dump(tree, f, separators=(',', ':'), ensure_ascii=True)
    print("\nwrote src/data/modules.json and src/data/market-tree.json")


if __name__ == '__main__':
    main()
