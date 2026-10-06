import re, html, schema as S
D,TBL,R=S.D,S.TBL,S.rels()
def keys(k): return k.split()
def fk(k): return [p[3:] for p in keys(k) if p.startswith('FK>')]
# ---------- DBML
def dbml():
    o=['// Dota Fantasy — ER-модель (PostgreSQL). Источник: er/schema.py. Открыть: dbdiagram.io → Import → DBML','']
    for d in D:
        o.append(f'TableGroup {d["code"]} {{'); o+= [f'  {t["name"]}' for t in d['tables']]; o.append('}'); o.append('')
    for d in D:
        for t in d['tables']:
            o.append(f'Table {t["name"]} [note: \'{t["desc"]}\'] {{')
            pks=[n for (n,ty,k,_) in t['cols'] if 'PK' in keys(k)]
            for (n,ty,k,c) in t['cols']:
                a=[]
                if 'PK' in keys(k) and len(pks)==1:a.append('pk')
                if 'UQ' in keys(k):a.append('unique')
                if 'NN' in keys(k) and 'PK' not in keys(k):a.append('not null')
                for f in fk(k):a.append(f'ref: > {f}.'+('id' if f!='tournament_players' or True else 'id'))
                if c:a.append("note: '"+c.replace("'","’")+"'")
                ty2=ty if ty!='text[]' else '"text[]"'
                o.append(f'  {n} {ty2}'+(f' [{", ".join(a)}]' if a else ''))
            idx=[]
            if len(pks)>1: idx.append(f'    ({", ".join(pks)}) [pk]')
            for x in t['extra']:
                m=re.match(r'(UNIQUE|INDEX) \(([^)]*)\)',x)
                if m and 'lower(' not in x and 'DESC' not in x:
                    idx.append(f'    ({m.group(2)})'+(' [unique]' if m.group(1)=='UNIQUE' else ''))
            if idx:o+=['  indexes {']+idx+['  }']
            o.append('}');o.append('')
    return '\n'.join(o)
# fix: FK targets whose PK is not "id" (composite) — none expected
for (a,b,col,nn) in R:
    pk=[n for (n,ty,k,_) in TBL[b][1]['cols'] if 'PK' in keys(k)]
    assert pk==['id'],(a,b,pk)
open('schema.dbml','w').write(dbml())
# ---------- mermaid
def mtype(ty): return re.sub(r'\W','',ty.split('(')[0].replace('[]','_arr'))
def mer(d):
    names=[t['name'] for t in d['tables']]; ext=set()
    o=['erDiagram']
    for t in d['tables']:
        o.append(f'  {t["name"]} {{')
        for (n,ty,k,c) in t['cols']:
            ks=[x for x in ('PK','FK','UK') if (x=='UK' and 'UQ' in keys(k)) or (x!='UK' and (x in keys(k) or (x=='FK' and fk(k))))]
            if not ks: continue
            o.append(f'    {mtype(ty)} {n} {",".join(ks)}')
        o.append('  }')
    for (a,b,col,nn) in R:
        if a in names or b in names:
            if a in names and b not in names: ext.add(b)
            if b in names and a not in names: continue
            o.append(f'  {b} ||--o{{ {a} : "{col}"')
    for x in sorted(ext): o.append(f'  {x} {{\n    bigint id PK\n  }}')
    return '\n'.join(o),sorted(ext)
def overview():
    o=['flowchart LR']
    for d in D:o.append(f'  {d["code"]}["{d["name"]}<br/><small>{len(d["tables"])} табл.</small>"]')
    E=set()
    for (a,b,col,nn) in R:
        da,db=TBL[a][0],TBL[b][0]
        if da!=db:E.add((da,db))
    for (da,db) in sorted(E):o.append(f'  {da} --> {db}')
    return '\n'.join(o)
