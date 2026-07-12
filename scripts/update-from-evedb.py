import sqlite3, json
from collections import defaultdict
db=sqlite3.connect('/home/claude/eve.db')
P='/home/claude/pyfa-mobile/src/data/'
cur_types=json.load(open(P+'dogma-types.json'))
cur_eff=json.load(open(P+'dogma-effects.json'))
cur_attr=json.load(open(P+'dogma-attrs.json'))
fsd_eff=json.load(open('/home/claude/dogmaeffects.0.json'))
fsd_attr=json.load(open('/home/claude/dogmaattributes.0.json'))
allow=set(json.load(open('/tmp/attr_allow.json')))
FIT_CATS={6,7,8,16,20,32}
def norm(v): return int(v) if isinstance(v,float) and v.is_integer() else v
gmeta={r[0]:(r[1],r[2]) for r in db.execute("SELECT groupID,name,categoryID FROM invgroups")}
tmeta={r[0]:(r[1],r[2],r[3]) for r in db.execute("SELECT typeID,typeName,groupID,published FROM invtypes")}
skillname={tid:m[0] for tid,m in tmeta.items() if gmeta.get(m[1],(None,0))[1]==16}
tattr=defaultdict(dict)
for tid,aid,val in db.execute("SELECT typeID,attributeID,value FROM dgmtypeattribs"):
    if aid in allow: tattr[tid][aid]=norm(val)
reqraw=defaultdict(dict)
for tid,aid,val in db.execute("SELECT typeID,attributeID,value FROM dgmtypeattribs WHERE attributeID IN (182,183,184,1285,1286,1287,1288)"):
    reqraw[tid][aid]=val
teff=defaultdict(list)
for tid,eid in db.execute("SELECT typeID,effectID FROM dgmtypeeffects"): teff[tid].append(eid)
REQ=[182,183,184,1285,1286,1287,1288]
def reqskills(tid):
    out=[]
    for aid in REQ:
        v=reqraw[tid].get(aid)
        if v:
            sn=skillname.get(round(v))
            if sn and sn not in out: out.append(sn)
    return out
fit_types=[tid for tid,m in tmeta.items() if m[2]==1 and gmeta.get(m[1],(None,0))[1] in FIT_CATS]
vchg=[]; newt=[]; effchg=[]
for tid in fit_types:
    sid=str(tid); name,gid,pub=tmeta[tid]; gname,cat=gmeta.get(gid,('',0))
    if sid in cur_types:
        ce=cur_types[sid]; ca=ce['a']
        for ak in list(ca.keys()):                       # value updates ONLY on present attrs
            av=tattr[tid].get(int(ak))
            if av is not None and abs(float(ca[ak])-float(av))>max(1e-6,abs(float(av))*1e-6):
                vchg.append((tid,name,ak,ca[ak],av)); ca[ak]=av
        if ce.get('e',[])!=teff[tid]:
            effchg.append((tid,name,sorted(set(teff[tid])-set(ce.get('e',[]))),sorted(set(ce.get('e',[]))-set(teff[tid]))))
            ce['e']=teff[tid]
        ce['rs']=reqskills(tid)
    else:
        cur_types[sid]={'n':name,'g':gid,'gn':gname,'c':cat,
                        'a':{str(a):v for a,v in tattr[tid].items()},'e':teff[tid],'rs':reqskills(tid)}
        newt.append((tid,name,gname))
# effects
fit_eff=set();  [fit_eff.update(teff[t]) for t in fit_types]
ea=0; enomod=[]
for e in sorted(fit_eff):
    if str(e) in cur_eff: continue
    fe=fsd_eff.get(str(e))
    if fe: cur_eff[str(e)]={'c':fe.get('effectCategory',0),'m':fe.get('modifierInfo') or []}; ea+=1
    else: cur_eff[str(e)]={'c':0,'m':[]}; enomod.append(e)
# attrs
aa=0
for aid,an,dv,hg in db.execute("SELECT attributeID,attributeName,defaultValue,highIsGood FROM dgmattribs"):
    if str(aid) in cur_attr: continue
    fa=fsd_attr.get(str(aid),{}); st=fa.get('stackable',1)
    cur_attr[str(aid)]={'n':an or fa.get('name',''),'s':1 if st else 0,'h':1 if hg else 0,'d':norm(dv or 0)}; aa+=1
json.dump(cur_types,open('/tmp/dogma-types.json','w'))
json.dump(cur_eff,open('/tmp/dogma-effects.json','w'))
json.dump(cur_attr,open('/tmp/dogma-attrs.json','w'))
print(f"VALUE CHANGES: {len(vchg)} | NEW TYPES: {len(newt)} | EFFECT-LIST CHANGES: {len(effchg)} | new effects: {ea} (+{len(enomod)} no-mod) | new attrs: {aa}")
print("\n-- value changes --")
nm2={r[0]:r[1] for r in db.execute('SELECT attributeID,attributeName FROM dgmattribs')}
for tid,name,ak,o,n in vchg[:40]: print(f"  {name} [{nm2.get(int(ak),ak)}]: {o} -> {n}")
print("\n-- breacher skill effects present? --", [e for e in [12217,12218,12219,12220,12221] if str(e) in cur_eff and cur_eff[str(e)]['m']])
json.dump({'vchg':vchg,'newt':newt,'effchg':effchg,'enomod':enomod},open('/tmp/rep2.json','w'))
