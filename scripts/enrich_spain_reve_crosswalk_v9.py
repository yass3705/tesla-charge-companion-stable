#!/usr/bin/env python3
import argparse,gzip,json,math,re,unicodedata
from pathlib import Path

def txt(v):return str(v or '').strip()
def norm(v):
    s=unicodedata.normalize('NFKD',txt(v));s=''.join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r'[^a-z0-9]+',' ',s).strip()
def num(v):
    try:return float(v)
    except:return None

def load_json(path):
    p=Path(path);raw=p.read_bytes()
    if p.suffix=='.gz':raw=gzip.decompress(raw)
    return json.loads(raw.decode('utf-8'))

def haversine(a,b,c,d):
    r=6371000;p1=math.radians(a);p2=math.radians(c);dp=math.radians(c-a);dl=math.radians(d-b)
    x=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*r*math.asin(math.sqrt(x))

def reveal_locations(data):
    if isinstance(data,list):return data
    if isinstance(data,dict):
        for key in ('locations','data','items','results'):
            if isinstance(data.get(key),list):return data[key]
        # collector snapshot keyed by REVE location id
        if data and all(isinstance(v,dict) for v in data.values()):return list(data.values())
    return []

def loc_id(x):return txt(x.get('id') or x.get('location_id') or x.get('locationId'))
def coords(x):
    g=x.get('coordinates') or x.get('coordinates_gps') or x.get('geo_location') or x.get('geoLocation') or {}
    lat=num(x.get('latitude') or x.get('lat') or (g.get('latitude') if isinstance(g,dict) else None) or (g.get('lat') if isinstance(g,dict) else None))
    lon=num(x.get('longitude') or x.get('lon') or (g.get('longitude') if isinstance(g,dict) else None) or (g.get('lon') if isinstance(g,dict) else None))
    return lat,lon

def evse_ids(x):
    out=[]
    for e in x.get('evses') or []:
        if isinstance(e,dict):
            v=txt(e.get('evse_id') or e.get('evseId') or e.get('uid') or e.get('id'))
            if v:out.append(v)
    return sorted(set(out))
def operator(x):return txt(x.get('cpo_name') or x.get('operator') or x.get('owner') or x.get('cpo'))
def address(x):return norm(' '.join(filter(None,[txt(x.get('address')),txt(x.get('city')),txt(x.get('postal_code') or x.get('postalCode'))])))
def name(x):return norm(x.get('name'))

def row_index(catalog):
    rows=catalog if isinstance(catalog,list) else []
    return {txt(r[0]):r for r in rows if isinstance(r,list) and len(r)>=11}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--crosswalk',default='data/v9/spain-crosswalk.json');ap.add_argument('--catalog',default='data/v9/spain-static/all.json.gz');ap.add_argument('--reve',required=True);ap.add_argument('--out',default='data/v9/spain-crosswalk-reve.json');ap.add_argument('--max-distance-m',type=float,default=75);args=ap.parse_args()
    cw=load_json(args.crosswalk);rows=row_index(load_json(args.catalog));locs=reveal_locations(load_json(args.reve))
    by_evse={}
    for loc in locs:
        for eid in evse_ids(loc):by_evse.setdefault(norm(eid),[]).append(loc)
    stats={'exactEvse':0,'geoOperator':0,'unresolved':0,'ambiguous':0};entries=[]
    for base in cw.get('entries',[]):
        e=dict(base);candidates=[];method='';source_row=rows.get(txt(e.get('mitecoId')))
        for eid in e.get('mitecoEvseIds') or []:
            candidates.extend(by_evse.get(norm(eid),[]))
        uniq={loc_id(x):x for x in candidates if loc_id(x)}
        if len(uniq)==1:
            candidates=list(uniq.values());method='exact_evse';stats['exactEvse']+=1
        elif len(uniq)>1:
            candidates=list(uniq.values());method='ambiguous_exact_evse';stats['ambiguous']+=1
        else:
            candidates=[]
            if source_row:
                lat,lon=num(source_row[3]),num(source_row[4]);op=norm(source_row[5]);addr=norm(source_row[2]);nm=norm(source_row[1])
                scored=[]
                for loc in locs:
                    la,lo=coords(loc)
                    if None in (lat,lon,la,lo):continue
                    d=haversine(lat,lon,la,lo)
                    if d>args.max_distance_m:continue
                    lop=norm(operator(loc));laa=address(loc);ln=name(loc)
                    op_ok=bool(op and lop and (op==lop or op in lop or lop in op))
                    text_ok=bool((addr and laa and (addr in laa or laa in addr)) or (nm and ln and (nm==ln or nm in ln or ln in nm)))
                    if op_ok and (text_ok or d<=30):scored.append((d,loc))
                scored.sort(key=lambda x:x[0])
                if len(scored)==1 or (len(scored)>1 and scored[1][0]-scored[0][0]>=25):
                    candidates=[scored[0][1]];method='geo_operator';stats['geoOperator']+=1
                elif scored:
                    candidates=[x[1] for x in scored];method='ambiguous_geo_operator';stats['ambiguous']+=1
                else:stats['unresolved']+=1
            else:stats['unresolved']+=1
        e['reveMatchMethod']=method or 'unresolved';e['reveMatchCandidates']=[loc_id(x) for x in candidates if loc_id(x)]
        if len(candidates)==1:
            loc=candidates[0];e['reveLocationIds']=sorted(set((e.get('reveLocationIds') or [])+[loc_id(loc)]));e['reveEvseIds']=sorted(set((e.get('reveEvseIds') or [])+evse_ids(loc)))
        entries.append(e)
    out={'schemaVersion':1,'country':'ES','generatedFrom':'MITECO+REVE','preIntegrationOnly':True,'matchPolicy':{'exactEvseFirst':True,'geoOperatorMaxDistanceM':args.max_distance_m,'ambiguousNeverAutoMerged':True},'stats':stats,'entries':entries}
    Path(args.out).parent.mkdir(parents=True,exist_ok=True);Path(args.out).write_text(json.dumps(out,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8');print(json.dumps(stats,indent=2))
if __name__=='__main__':main()
