#!/usr/bin/env python3
"""
build-bundle.py — regenerate the dogma data bundles from pyfa's eve.db.

    python scripts/build-bundle.py                     # auto-detect eve.db, write bundles
    python scripts/build-bundle.py --db path/to/eve.db # explicit path
    python scripts/build-bundle.py --dry-run           # report changes, write nothing

Then ALWAYS verify:

    npm test        # 25 pyfa-validated checks must still pass

────────────────────────────────────────────────────────────────────────────────
WHAT THIS REPLACES, AND WHY

The previous generator (update-from-evedb.py) had two structural flaws that caused
every "missing attribute" bug we have chased:

  1. It only refreshed attributes a type ALREADY had:

         for ak in list(ca.keys()):   # <-- only touches existing keys

     so an attribute that became relevant later could never appear. This is why
     `angelCartelProjectileReloadingSpeed` was absent from the Angel hulls (their
     -75% projectile reload silently did nothing) and why the lance's doomsday
     tick attributes were missing (costing ~1190 DPS on a Bane).

  2. It filtered attributes through an `attr_allow.json` allowlist that is not in
     the repo, so nobody else could run it, and anything outside the list was
     invisible forever.

This version drops the allowlist and writes EVERY attribute CCP defines on a
fittable type. That costs about +0.6 MB on dogma-types.json and removes the whole
bug class permanently. It also covers drones/fighters/structures, which the old
category filter excluded.

────────────────────────────────────────────────────────────────────────────────
WHAT eve.db CANNOT GIVE US

eve.db has no effect *modifier* data — `dgmeffects` carries only names/flags, not
modifierInfo. Effect modifiers therefore CANNOT be regenerated from it; they are
preserved from the existing dogma-effects.json. If a new effect appears, it is
written with an empty modifier list and reported loudly: it will do NOTHING until
someone supplies the modifier (from CCP's FSD dump) or writes a custom handler.

Likewise `stackable` is not in eve.db, so existing attribute flags are preserved
and new attributes default to stackable=1 (and are reported).

Hand-applied fixes for effects CCP ships empty live in scripts/data-patches.json
and are re-applied at the end of every build, so regeneration is idempotent.
"""

import argparse, json, os, re, sqlite3, sys
from collections import defaultdict
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'src', 'data')
PATCHES = os.path.join(ROOT, 'scripts', 'data-patches.json')

# Everything the app can put on a fit, plus the hulls themselves.
#  6 Ship        7 Module      8 Charge     16 Skill      18 Drone     20 Implant
# 22 Deployable 32 Subsystem  65 Structure 66 Structure Module        87 Fighter
CATS = {6, 7, 8, 16, 18, 20, 22, 32, 65, 66, 87}

# requiredSkill1..6 attribute IDs, used to build each type's `rs` (required skills) list.
REQ_SKILL_ATTRS = [182, 183, 184, 1285, 1286, 1287, 1288]


def find_db(explicit=None):
    if explicit:
        if not os.path.isfile(explicit):
            sys.exit(f"eve.db not found at {explicit}")
        return explicit
    # ORDER MATTERS. The repo-root eve.db is a STALE leftover (client build 3383521), superseded by
    # the pyfa v2.68 install (3424810) — and it used to be probed FIRST. Nothing caught that,
    # because the source clone carries no eve.db either, so auto-detect silently regenerated the
    # whole bundle from the OLD client build: it reverts real attribute values (Aralez,
    # Berserker SW-900, ...) and invalidates every validated baseline in one commit. Probe the
    # installed pyfa first; keep the repo-root copy as a last resort.
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
    """CCP stores everything as REAL; keep ints as ints so the JSON stays small."""
    if v is None:
        return 0
    f = float(v)
    return int(f) if f.is_integer() else f


# Hull categories that get a traits/description entry: 6 Ship, 65 Structure.
HULL_CATS = {6, 65}
# Subsystems (32) carry traitText too — a T3 cruiser's per-skill-level bonuses live on the SUBSYSTEM,
# not on the hull, so without these a Legion's Traits tab can only show the handful of bonuses the
# hull itself carries and the ones actually deciding the fit are invisible. They get traits only,
# never a `desc`: subsystem flavour text already ships in type-descriptions.json (DESC_CATS below),
# and duplicating it would give the info panel two sources for one string.
TRAIT_ONLY_CATS = {32}
# Categories whose flavour text the item info panel can show. Hulls are deliberately absent — their
# description ships inside ship-traits.json alongside their trait bonuses, so the panel reads one
# file per kind of thing rather than both. The pre-existing hand-built type-descriptions.json only
# ever covered 7/8/20, which is why every structure module, drone, fighter, subsystem and deployable
# had a blank Description.
#  7 Module  8 Charge  18 Drone  20 Implant  22 Deployable  32 Subsystem  66 Structure Module  87 Fighter
DESC_CATS = {7, 8, 18, 20, 22, 32, 66, 87}
_TAG_RE = re.compile(r'<[^>]+>')
# A bonus line usually opens with its magnitude, in one of three forms CCP uses: a percentage
# ("10%", "7.5%"), a flat bonus ("5+ bonus to Relic and Data Analyzer virus strength"), or a
# multiplier ("5x penalty to Entosis Link duration"). All three get split out so the UI can colour
# the number separately; anything else (a "•"-bulleted note) stays one string.
_LEADING_PCT_RE = re.compile(r'^(\d+(?:\.\d+)?[%+x])\s+(.*)$', re.S)


def strip_html(s):
    """CCP descriptions carry <br>, <a href=...> and friends. Flatten to plain text."""
    if not s:
        return ''
    s = re.sub(r'<br\s*/?>', '\n', s, flags=re.I)
    s = _TAG_RE.sub('', s)
    return re.sub(r'\n{3,}', '\n\n', s.replace('\r\n', '\n').replace('\r', '\n')).strip()


def parse_trait_text(html):
    """invtraits.traitText → the {skills:[], role:{}, misc:{}} shape the app's ShipInfoSheet renders.

    The source is a fixed little HTML dialect: `<b>Header</b><br />` followed by one bonus per
    `<br />`, with a blank line (`<br /><br />`) between sections. A leading percentage is split
    into its own `number` field so the UI can colour it; anything else (a bare `10+ bonus to ...`,
    or a `•`-bulleted note) stays whole, which is exactly how the pre-existing hand-entered
    trait data was shaped.
    """
    if not html:
        return None
    sections, cur = [], None
    for raw in re.split(r'<br\s*/?>', html):
        line = raw.strip()
        if not line:
            continue
        m = re.match(r'^<b>(.*?)</b>$', line, re.S | re.I)
        if m:
            cur = {'header': _TAG_RE.sub('', m.group(1)).strip(), 'bonuses': []}
            sections.append(cur)
            continue
        if cur is None:                      # bonus line before any header — synthesise one
            cur = {'header': '', 'bonuses': []}
            sections.append(cur)
        text = _TAG_RE.sub('', line).strip()
        if not text:
            continue
        pm = _LEADING_PCT_RE.match(text)
        cur['bonuses'].append({'number': pm.group(1), 'text': pm.group(2).strip()} if pm
                              else {'text': text})

    out = {'skills': []}
    for sec in sections:
        if not sec['bonuses']:
            continue
        h = sec['header']
        if re.search(r'per skill level', h, re.I):
            out['skills'].append(sec)
        elif re.match(r'\s*role bonus', h, re.I):
            out['role'] = sec
        else:
            out['misc'] = sec
    return out if (out['skills'] or 'role' in out or 'misc' in out) else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', help='path to pyfa eve.db')
    ap.add_argument('--dry-run', action='store_true', help='report changes, write nothing')
    args = ap.parse_args()

    db_path = find_db(args.db)
    db = sqlite3.connect(db_path)
    print(f"eve.db: {db_path}")

    # eve.db carries a metadata table stamping which EVE client build it was dumped from. Record it
    # in the bundle so there is never ambiguity about WHICH data the numbers were validated against —
    # the regression baselines are only meaningful relative to a specific build.
    meta = {}
    try:
        meta = {r[0]: r[1] for r in db.execute("SELECT * FROM metadata")}
    except sqlite3.Error:
        pass
    client_build = str(meta.get('client_build', 'unknown'))
    dump_time = int(meta.get('dump_time', 0) or 0)
    dump_iso = (datetime.fromtimestamp(dump_time, tz=timezone.utc).strftime('%Y-%m-%d')
                if dump_time else 'unknown')
    print(f"EVE client build: {client_build}   (SDE dumped {dump_iso})")

    old_types = json.load(open(os.path.join(DATA, 'dogma-types.json')))
    old_effs  = json.load(open(os.path.join(DATA, 'dogma-effects.json')))
    old_attrs = json.load(open(os.path.join(DATA, 'dogma-attrs.json')))

    # ── metadata ────────────────────────────────────────────────────────────
    groups = {r[0]: (r[1], r[2]) for r in db.execute("SELECT groupID,name,categoryID FROM invgroups")}
    types  = {r[0]: r for r in db.execute(
        "SELECT typeID,typeName,groupID,published,metaGroupID,metaLevel,variationParentTypeID FROM invtypes")}
    attr_names = {r[0]: r[1] for r in db.execute("SELECT attributeID,attributeName FROM dgmattribs")}
    skill_names = {tid: t[1] for tid, t in types.items() if groups.get(t[2], (None, 0))[1] == 16}

    # ── every attribute on every type (NO allowlist — this is the fix) ──────
    tattr = defaultdict(dict)
    for tid, aid, val in db.execute("SELECT typeID,attributeID,value FROM dgmtypeattribs"):
        tattr[tid][aid] = num(val)

    teff = defaultdict(list)
    for tid, eid in db.execute("SELECT typeID,effectID FROM dgmtypeeffects"):
        teff[tid].append(eid)

    def required_skills(tid):
        out = []
        for aid in REQ_SKILL_ATTRS:
            v = tattr[tid].get(aid)
            if v:
                nm = skill_names.get(round(float(v)))
                if nm and nm not in out:
                    out.append(nm)
        return out

    # T3 destroyer tactical modes ("Ship Modifiers", group 1306) are ALL published=0 — they are not
    # items you own, they are the dogma carrier for the mode a T3D is sitting in. The published
    # filter therefore excludes every one of them, and the 12 in the bundle were only there because
    # they predate this generator and survived as legacy entries. Any mode CCP added since (the
    # Skua's and the Anhinga's) could never arrive, so applyTacticalMode silently found no type and
    # the hull's mode bonuses just didn't apply. Admit the whole group by ID.
    MODE_GROUP = 1306
    # Environment effects ("Effect Beacon", group 920) are category 2 (Celestial), so no CATS filter
    # was ever going to admit them — they are not something you fit, they are the system you are
    # sitting in. Same dogma-carrier role as the tactical modes above: wormhole class effects
    # (Pulsar/Wolf-Rayet/Black Hole/Magnetar/Red Giant/Cataclysmic, 6 classes each), the metaliminal
    # storms, and a handful of event beacons. Without them a WH fit's resists, reps, sig and speed
    # are all simply wrong, and they were the last thing the oracle could not model.
    BEACON_GROUP = 920
    fit_types = [tid for tid, t in types.items()
                 if (t[3] == 1 and groups.get(t[2], (None, 0))[1] in CATS)
                 or t[2] == MODE_GROUP or t[2] == BEACON_GROUP]

    # ── rebuild types ───────────────────────────────────────────────────────
    # Drop types eve.db no longer has AT ALL. Keeping them used to seem harmless, but a dead type can
    # SHADOW a live one by name: the bundle carried a phantom "Imperial Defense Booster II" (93134,
    # deleted from the game) alongside the real one (91939), and typeIDByName resolved to the phantom —
    # which had all four passive resists at -4 instead of the correct explosive -4 / kinetic -2. Fits
    # using any of 35 shadowed seasonal boosters silently got the wrong item's stats.
    all_live = {int(r[0]) for r in db.execute('SELECT typeID FROM invtypes')}
    dead = [k for k in old_types if int(k) not in all_live]
    new_types = {k: v for k, v in old_types.items() if int(k) in all_live}
    shadowed = sum(1 for k in dead
                   if any(v.get('n') == old_types[k].get('n') and int(j) in all_live
                          for j, v in old_types.items()))
    if dead:
        print(f"pruned:  {len(dead)} dead types not present in eve.db ({shadowed} were shadowing a live type by name)")
    added, value_changes, attrs_added, effect_changes = [], [], 0, []

    for tid in fit_types:
        sid = str(tid)
        name, gid, _pub, mg, ml, vparent = types[tid][1], types[tid][2], types[tid][3], types[tid][4], types[tid][5], types[tid][6]
        gname, cat = groups.get(gid, ('', 0))

        entry = {
            'n': name, 'g': gid, 'gn': gname, 'c': cat,
            'a': {str(a): v for a, v in sorted(tattr[tid].items())},
            'e': sorted(teff[tid]),
            'rs': required_skills(tid),
        }
        # Meta group comes from CCP, NOT from data-bundle.js (whose `meta` strings are wrong:
        # faction/storyline/deadspace/officer modules all come through as "T2").
        if mg is not None:
            entry['mg'] = int(mg)
        if ml:
            entry['ml'] = num(ml)
        if vparent is not None and vparent != tid:
            entry['vp'] = 1

        prev = old_types.get(sid)
        if prev is None:
            added.append((tid, name, gname))
        else:
            pa = prev.get('a', {})
            for k, v in entry['a'].items():
                if k not in pa:
                    attrs_added += 1
                elif abs(float(pa[k]) - float(v)) > max(1e-6, abs(float(v)) * 1e-6):
                    value_changes.append((name, attr_names.get(int(k), k), pa[k], v))
            if sorted(prev.get('e', [])) != entry['e']:
                effect_changes.append((name,
                                       sorted(set(entry['e']) - set(prev.get('e', []))),
                                       sorted(set(prev.get('e', [])) - set(entry['e']))))
        new_types[sid] = entry

    # ── attributes: eve.db has no `stackable`, so preserve existing flags ────
    new_attrs = dict(old_attrs)
    new_attr_ids = []
    for aid, an, dv, hg, mx in db.execute(
            "SELECT attributeID,attributeName,defaultValue,highIsGood,maxAttributeID FROM dgmattribs"):
        s = str(aid)
        # maxAttributeID: id of another attribute whose value caps this one (upper bound). Used e.g.
        # to clamp forced damage resonances to 1.0 so Polarized weapons floor resists at 0%, not -9900%.
        cap = int(mx) if mx else 0
        if s in new_attrs:
            new_attrs[s]['n'] = an or new_attrs[s].get('n', '')
            new_attrs[s]['h'] = 1 if hg else 0
            new_attrs[s]['d'] = num(dv)
            if cap:
                new_attrs[s]['x'] = cap
            else:
                new_attrs[s].pop('x', None)
        else:
            # stackable is NOT in eve.db. Default to 1 (unpenalised) and report — if a new
            # attribute is actually stacking-penalised, set "s": 0 by hand in data-patches.json.
            new_attrs[s] = {'n': an or '', 's': 1, 'h': 1 if hg else 0, 'd': num(dv)}
            if cap:
                new_attrs[s]['x'] = cap
            new_attr_ids.append((aid, an))

    # ── effects: modifiers cannot come from eve.db; preserve, and flag new ones ──
    new_effs = dict(old_effs)
    referenced = set()
    for tid in fit_types:
        referenced.update(teff[tid])
    new_effect_ids = []
    for eid in sorted(referenced):
        s = str(eid)
        if s not in new_effs:
            new_effs[s] = {'c': 0, 'm': []}     # inert until a modifier is supplied
            new_effect_ids.append(eid)

    # ── re-apply hand patches (idempotent) ──────────────────────────────────
    patched = []
    if os.path.isfile(PATCHES):
        patches = json.load(open(PATCHES))
        for eid, mods in (patches.get('effects') or {}).items():
            if eid in new_effs:
                new_effs[eid]['m'] = mods
                patched.append(f"effect {eid}")
        for aid, flags in (patches.get('attributes') or {}).items():
            if aid in new_attrs:
                new_attrs[aid].update(flags)
                patched.append(f"attr {aid}")

    # ── ship/structure traits + descriptions ────────────────────────────────
    # Previously these lived ONLY in data-bundle.js's precomputed `shipTraits`, which predates
    # whole hull lines — structures had no entry at all, so the Traits and Description tabs came
    # up blank for every Citadel/Engineering Complex/Refinery. eve.db carries both fields for
    # every hull (invtraits.traitText, invtypes.typeDescription), so generate them here instead of
    # hand-maintaining another literal.
    trait_html = {r[0]: r[1] for r in db.execute("SELECT typeID,traitText FROM invtraits")}
    desc_text  = {r[0]: r[1] for r in db.execute("SELECT typeID,typeDescription FROM invtypes")}
    ship_traits, trait_hulls = {}, 0
    for tid in fit_types:
        cat = groups.get(types[tid][2], ('', 0))[1]
        if cat not in HULL_CATS and cat not in TRAIT_ONLY_CATS:
            continue
        entry = parse_trait_text(trait_html.get(tid)) or {}
        if cat in HULL_CATS:
            desc = strip_html(desc_text.get(tid))
            if desc:
                entry['desc'] = desc
        if entry:
            ship_traits[str(tid)] = entry
            trait_hulls += 1

    # ── hull race + faction (drives the ship browser's racial categories) ───
    # The ship browser derives a hull's racial bucket from its REQUIRED SKILL, which is right for
    # the empire hulls but has nothing to say about the ones no empire built: the Vendetta needs
    # "Gallente Carrier" but is a Serpentis hull, the Python and the Marshal require no racial skill
    # at all, and the Outrider's ORE-ness lives nowhere in its skill list. invtypes.factionID is the
    # authoritative answer and eve.db has it for every hull, so emit it rather than maintaining a
    # by-name table that would rot on the next expansion.
    #
    # HULL_CATS only (ships + structures) — this is browser metadata, not dogma, and no other
    # category has a meaningful faction.
    #
    # Also emits `s:1` for "special edition" — CCP's OWN market taxonomy has a
    # `Ships / Special Edition Ships` group (marketGroupID 1612), which is a far better answer than
    # guessing from the name or the metaGroupID. Two extra cases fold in:
    #   - No marketGroupID at all → not sold anywhere, so it is an event/prize hull. Among ships
    #     that is exactly one thing: the Stratios Emergency Responder.
    #   - A Shuttle with metaGroupID 3 or 4 (Storyline/Faction). CCP files Goru's and the Guristas
    #     shuttle under "Faction Shuttles" rather than Special Edition, but they are the same kind
    #     of unbuyable novelty; the four racial shuttles carry metaGroupID 1 or nothing, so this
    #     splits them cleanly without naming any hull.
    SPECIAL_EDITION_ROOT = 1612
    mkt_parent = {r[0]: r[1] for r in db.execute(
        "SELECT marketGroupID,parentGroupID FROM invmarketgroups")}

    def in_special_edition(mgid):
        seen = 0
        while mgid is not None and seen < 16:
            if mgid == SPECIAL_EDITION_ROOT:
                return True
            mgid = mkt_parent.get(mgid)
            seen += 1
        return False

    race_faction = {}
    for tid, rc, fc, mgid, meta in db.execute(
            "SELECT typeID,raceID,factionID,marketGroupID,metaGroupID FROM invtypes"):
        row = types.get(tid)
        if row is None or groups.get(row[2], ('', 0))[1] not in HULL_CATS:
            continue
        gname = groups.get(row[2], ('', 0))[0]
        special = (in_special_edition(mgid) or mgid is None
                   or (gname == 'Shuttle' and meta in (3, 4)))
        if rc is None and fc is None and not special:
            continue
        entry = {k: v for k, v in (('r', rc), ('f', fc)) if v is not None}
        if special:
            entry['s'] = 1
        race_faction[str(tid)] = entry

    # ── item flavour text (modules/charges/implants/drones/fighters/…) ──────
    # Iterate the TYPES we actually emit, not `fit_types`: `fit_types` requires published=1, and the
    # T3 destroyer tactical modes (Confessor/Svipul/Jackdaw/Hecate/Bomber "... Mode", 89 of them) are
    # UNPUBLISHED yet fully live in the app — calc.js resolves them by typeID. Keying off fit_types
    # silently dropped every one of their descriptions.
    type_descs = {}
    for sid in new_types:
        tid = int(sid)
        row = types.get(tid)
        if row is None or groups.get(row[2], ('', 0))[1] not in DESC_CATS:
            continue
        desc = strip_html(desc_text.get(tid))
        if desc:
            type_descs[sid] = desc

    # ── report ──────────────────────────────────────────────────────────────
    print(f"\ntypes:   {len(fit_types):,} fittable   (+{len(added)} new)")
    print(f"traits:  {trait_hulls:,} hulls with traits/description "
          f"({sum(1 for t in ship_traits.values() if t.get('skills') or t.get('role')):,} carry trait bonuses)")
    print(f"descs:   {len(type_descs):,} item descriptions")
    print(f"faction: {len(race_faction):,} hulls with a race/faction")
    print(f"attrs:   +{attrs_added:,} attribute slots added to existing types")
    print(f"         {len(value_changes):,} value changes   |   +{len(new_attr_ids)} new attribute definitions")
    print(f"effects: {len(effect_changes):,} type effect-list changes   |   +{len(new_effect_ids)} new effects")
    if patched:
        print(f"patches: re-applied {len(patched)} ({', '.join(patched)})")

    if value_changes:
        print("\n-- value changes (first 25) --")
        for nm, an, o, n in value_changes[:25]:
            print(f"   {nm}  [{an}]  {o} -> {n}")

    # A new effect that a data-patch already supplied a modifier for is NOT inert, so listing it
    # here trains the reader to ignore the one warning that must never be ignored. Report only the
    # effects that are still empty AFTER patches were applied.
    still_inert = [e for e in new_effect_ids if not new_effs.get(str(e), {}).get('m')]
    if still_inert:
        print(f"\n!! {len(still_inert)} NEW EFFECTS have NO modifier data and will do NOTHING:")
        for e in still_inert[:15]:
            print(f"     {e}")
        print("   eve.db does not carry modifierInfo. Supply it from CCP's FSD dump, add it to")
        print("   scripts/data-patches.json, or write a custom handler in dogma-engine.js.")

    if new_attr_ids:
        print(f"\n!! {len(new_attr_ids)} NEW ATTRIBUTES defaulted to stackable=1 (not penalised):")
        for a, an in new_attr_ids[:15]:
            print(f"     {a}  {an}")
        print("   If any of these are stacking-penalised, set \"s\": 0 in scripts/data-patches.json.")

    if args.dry_run:
        print("\n--dry-run: nothing written.")
        return

    # Version stamp lives in its OWN file — do not put it inside dogma-types.json, whose values are
    # iterated as type entries all over the app.
    version = {
        'client_build': client_build,
        'sde_dump_date': dump_iso,
        'generated': datetime.now(timezone.utc).strftime('%Y-%m-%d'),
        'types': len(fit_types),
        '_note': ('The regression baselines in src/regression.test.mjs were validated against pyfa '
                  'running THIS client build. If you regenerate from a newer eve.db, expect some '
                  'baselines to move: that is CCP rebalancing, not a code regression. See CLAUDE.md '
                  '-> "Upgrading eve.db".'),
    }
    json.dump(version, open(os.path.join(DATA, 'bundle-version.json'), 'w'), indent=2)

    for name, obj in [('dogma-types.json', new_types),
                      ('dogma-effects.json', new_effs),
                      ('dogma-attrs.json', new_attrs),
                      ('ship-traits.json', ship_traits),
                      ('ship-factions.json', race_faction),
                      ('type-descriptions.json', type_descs)]:
        p = os.path.join(DATA, name)
        json.dump(obj, open(p, 'w'), separators=(',', ':'))
        print(f"wrote {p}  ({os.path.getsize(p)/1048576:.2f} MB)")

    print("\nNOW RUN:  npm test     <- 25 pyfa-validated checks must still pass")


if __name__ == '__main__':
    main()
