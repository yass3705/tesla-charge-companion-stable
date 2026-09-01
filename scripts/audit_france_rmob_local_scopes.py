#!/usr/bin/env python3
from __future__ import annotations
import argparse,csv,gzip,json,re,unicodedata
from collections import Counter,defaultdict
from pathlib import Path

def clean(v): return str(v or '').strip()
def norm(v):
    s=unicodedata.normalize('NFD',clean(v));s=''.join(c for c in s if unicodedata.category(c)!='Mn')
    return re.sub(r'[^a-z0-9]+',' ',s.lower()).strip()
def load_json(path):
    p=Path(path)
    if p.suffix=='.gz':
        with gzip.open(p,'rt',encoding='utf-8') as f:return json.load(f)
    return json.loads(p.read_text(encoding='utf-8'))
def detect_dialect(path):
    with open(path,'r',encoding='utf-8-sig',newline='') as f:sample=f.read(65536)
    try:return csv.Sniffer().sniff(sample,delimiters=',;\t|')
    except csv.Error:return csv.excel
def first(row,*keys):
    for k in keys:
        x=clean(row.get(k))
        if x:return x
    return ''
def station_id(row):return first(row,'id_station_itinerance') or first(row,'id_station_local')
def read_static(static_csv):
    out={};d=detect_dialect(static_csv)
    with open(static_csv,'r',encoding='utf-8-sig',newline='') as f:
        for row in csv.DictReader(f,dialect=d):
            sid=station_id(row)
            if sid and sid not in out:
                out[sid]={'authority':first(row,'nom_amenageur'),'codeInsee':first(row,'code_insee_commune','code_insee'),'brand':first(row,'nom_enseigne'),'stationName':first(row,'nom_station'),'address':first(row,'adresse_station')}
    return out

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--canonical-dir',required=True);ap.add_argument('--static-csv',required=True);ap.add_argument('--out',required=True);a=ap.parse_args()
    stations=load_json(Path(a.canonical_dir)/'stations.json.gz');pdcs=load_json(Path(a.canonical_dir)/'charge_points.json.gz');station_by={clean(x.get('stationId')):x for x in stations};meta=read_static(a.static_csv)
    rmob=[]
    for p in pdcs:
        sid=clean(p.get('stationId'));m=meta.get(sid) or {};st=station_by.get(sid) or {}
        physical=p.get('physicalOperatorId') or st.get('physicalOperatorId')
        if p.get('tariffNetworkId')!='alize-liberte' or physical!='bouygues-energies-services' or norm(m.get('authority'))!='r mob':continue
        ci=clean(st.get('codeInsee') or m.get('codeInsee'));dept=ci[:2] if len(ci)>=2 else ''
        rmob.append({'stationId':sid,'pdcId':clean(p.get('pdcId')),'codeInsee':ci,'department':dept,'name':clean(st.get('name') or m.get('stationName')),'address':clean(st.get('address') or m.get('address')),'brand':clean(m.get('brand'))})
    by_dept=defaultdict(list);by_insee=defaultdict(list)
    for x in rmob:by_dept[x['department']].append(x);by_insee[x['codeInsee']].append(x)
    departments=[]
    for d,rows in sorted(by_dept.items(),key=lambda kv:(-len(kv[1]),kv[0])):
        sids={x['stationId'] for x in rows};examples=[]
        for sid in sorted(sids)[:8]:
            x=next(y for y in rows if y['stationId']==sid);examples.append({'stationId':sid,'codeInsee':x['codeInsee'],'name':x['name'],'address':x['address']})
        departments.append({'department':d,'stationCount':len(sids),'pdcCount':len(rows),'codeInseeCounts':sorted([{'codeInsee':ci,'stationCount':len({x['stationId'] for x in vals}),'pdcCount':len(vals)} for ci,vals in by_insee.items() if ci.startswith(d)],key=lambda z:(-z['pdcCount'],z['codeInsee'])),'examples':examples})
    known={'griffon-branche':{'department':'22','codeInsee':'22278'},'dreux':{'department':'28','codeInsee':'28134'}}
    known_counts={}
    known_pdc=set()
    for k,v in known.items():
        rows=[x for x in rmob if x['department']==v['department'] and x['codeInsee']==v['codeInsee']]
        ids={x['pdcId'] for x in rows};known_pdc.update(ids);known_counts[k]={'stationCount':len({x['stationId'] for x in rows}),'pdcCount':len(rows)}
    remaining=[x for x in rmob if x['pdcId'] not in known_pdc]
    report={'schemaVersion':'1.0.0','dataset':'france-rmob-local-scope-audit','summary':{'stationCount':len({x['stationId'] for x in rmob}),'pdcCount':len(rmob),'departmentCount':len(by_dept),'knownLocalScopePdcCount':len(known_pdc),'remainingPdcCount':len(remaining),'physicalInventoryMutationCount':0},'knownLocalScopes':known_counts,'departments':departments,'remainingDepartments':dict(sorted(Counter(x['department'] for x in remaining).items()))}
    p=Path(a.out);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
