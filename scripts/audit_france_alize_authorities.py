#!/usr/bin/env python3
from __future__ import annotations
import argparse,csv,gzip,json,re,unicodedata
from collections import Counter,defaultdict
from pathlib import Path

def clean(v): return str(v or '').strip()
def norm(v):
    s=unicodedata.normalize('NFD',clean(v)); s=''.join(c for c in s if unicodedata.category(c)!='Mn')
    return re.sub(r'[^a-z0-9]+',' ',s.lower()).strip()
def load_json(path):
    p=Path(path)
    if p.suffix=='.gz':
        with gzip.open(p,'rt',encoding='utf-8') as f: return json.load(f)
    return json.loads(p.read_text(encoding='utf-8'))
def dialect(path):
    with open(path,'r',encoding='utf-8-sig',newline='') as f: sample=f.read(65536)
    try:return csv.Sniffer().sniff(sample,delimiters=',;\t|')
    except csv.Error:return csv.excel
def first(row,*keys):
    for k in keys:
        v=clean(row.get(k))
        if v:return v
    return ''
def station_id(row): return first(row,'id_station_itinerance','id_station_local')

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--canonical-dir',required=True); ap.add_argument('--static-csv',required=True); ap.add_argument('--out',required=True); a=ap.parse_args()
    stations=load_json(Path(a.canonical_dir)/'stations.json.gz'); pdcs=load_json(Path(a.canonical_dir)/'charge_points.json.gz')
    alize_stations={clean(s.get('stationId')):s for s in stations if s.get('tariffNetworkId')=='alize-liberte'}
    alize_pdcs=[p for p in pdcs if p.get('tariffNetworkId')=='alize-liberte']
    raw={}
    with open(a.static_csv,'r',encoding='utf-8-sig',newline='') as f:
        for row in csv.DictReader(f,dialect=dialect(a.static_csv)):
            sid=station_id(row)
            if not sid or sid not in alize_stations or sid in raw: continue
            raw[sid]={
                'amenageur':first(row,'nom_amenageur') or '(missing)',
                'operateur':first(row,'nom_operateur') or '(missing)',
                'enseigne':first(row,'nom_enseigne') or '(missing)',
                'codeInsee':first(row,'code_insee_commune') or first(row,'code_insee') or '',
                'adresse':first(row,'adresse_station') or ''}
    pdc_by_station=Counter(clean(p.get('stationId')) for p in alize_pdcs)
    groups=defaultdict(lambda:{'stationIds':set(),'pdcCount':0,'operators':Counter(),'brands':Counter(),'departments':Counter(),'examples':[]})
    for sid,st in alize_stations.items():
        r=raw.get(sid,{})
        amen=r.get('amenageur') or '(missing)'; g=groups[amen]; g['stationIds'].add(sid); g['pdcCount']+=pdc_by_station.get(sid,0)
        g['operators'][r.get('operateur') or '(missing)']+=pdc_by_station.get(sid,0); g['brands'][r.get('enseigne') or '(missing)']+=pdc_by_station.get(sid,0)
        ci=r.get('codeInsee') or ''; dep=('97'+ci[2] if ci.startswith(('971','972','973','974','976')) else ci[:2]) if ci else '(missing)'
        g['departments'][dep]+=pdc_by_station.get(sid,0)
        if len(g['examples'])<5:g['examples'].append({'stationId':sid,'name':st.get('name'),'address':st.get('address'),'codeInsee':st.get('codeInsee'),'operatorRaw':st.get('operatorRaw'),'physicalOperatorId':st.get('physicalOperatorId')})
    rows=[]
    for amen,g in groups.items():
        rows.append({'contractingAuthority':amen,'stationCount':len(g['stationIds']),'pdcCount':g['pdcCount'],'topOperators':g['operators'].most_common(5),'topBrands':g['brands'].most_common(5),'departments':g['departments'].most_common(20),'examples':g['examples']})
    rows.sort(key=lambda x:(-x['pdcCount'],-x['stationCount'],norm(x['contractingAuthority'])))
    out={'schemaVersion':'1.0.0','dataset':'france-alize-liberte-authority-audit','summary':{'stationCount':len(alize_stations),'pdcCount':len(alize_pdcs),'authorityCount':len(rows)},'authorities':rows}
    p=Path(a.out);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'summary':out['summary'],'topAuthorities':rows[:20]},ensure_ascii=False,indent=2))
if __name__=='__main__': main()
