#!/usr/bin/env python3
import argparse,gzip,json,math,re
from collections import defaultdict
from pathlib import Path

SOURCE_SPECS=[
  {'provider':'izivia','path':'data/national/izivia_station_index.json.gz'},
  {'provider':'avia-volt','path':'data/national/avia_volt_picoty_station_index.json'},
  {'provider':'allego','path':'data/national/allego_direct_stations_france.json.gz'},
  {'provider':'atlante','path':'data/national/atlante_direct_stations_france.json.gz'},
  {'provider':'avia-picoty','path':'data/national/avia_picoty_direct_stations_france.json.gz'},
  {'provider':'bump','path':'data/national/bump_direct_inventory_france.json.gz'},
  {'provider':'bump','path':'data/national/bump_direct_stations_france.json.gz'},
  {'provider':'belib','path':'data/national/belib_stations_paris.json'},
  {'provider':'electric55','path':'data/national/electric55_stations_france.json'}
]

STATION_ID_KEYS=('id_station_itinerance','idStationItinerance','stationId','station_id','idStation','locationId','location_id','siteId','site_id','id')
PDC_ID_KEYS=('id_pdc_itinerance','idPdcItinerance','pdcId','pdc_id','evseId','evse_id','uid')
PROVIDER_ID_KEYS=('sourceStationId','source_station_id','providerStationId','provider_station_id','locationId','location_id','siteId','site_id','stationId','station_id','id')
NAME_KEYS=('name','stationName','station_name','nom_station','nom','label','title')
LAT_KEYS=('latitude','lat')
LON_KEYS=('longitude','lon','lng')


def txt(v):return str(v or '').strip()
def norm(v):return re.sub(r'[^a-z0-9]+','-',txt(v).lower()).strip('-')
def scalar(v):return isinstance(v,(str,int,float)) and txt(v)!=''
def vals(record,keys):
    out=[]
    for k in keys:
        v=record.get(k)
        if scalar(v):out.append(txt(v))
        elif isinstance(v,list):out.extend(txt(x) for x in v if scalar(x))
    return list(dict.fromkeys(out))
def first_num(record,keys):
    for k in keys:
        try:
            if record.get(k) is not None:return float(record[k])
        except:pass
    c=record.get('coordinates') or record.get('coordinate') or record.get('position')
    if isinstance(c,dict):
        for k in keys:
            try:
                if c.get(k) is not None:return float(c[k])
            except:pass
    return None
def first_text(record,keys):
    for k in keys:
        if scalar(record.get(k)):return txt(record[k])
    return ''

def read_json(path):
    if path.suffix=='.gz':
        with gzip.open(path,'rt',encoding='utf-8') as f:return json.load(f)
    return json.loads(path.read_text(encoding='utf-8'))

def walk_records(obj):
    if isinstance(obj,dict):
        yield obj
        for v in obj.values():
            if isinstance(v,(dict,list)):yield from walk_records(v)
    elif isinstance(obj,list):
        for v in obj:
            if isinstance(v,(dict,list)):yield from walk_records(v)

def haversine(a,b):
    lat1,lon1=a;lat2,lon2=b;r=6371000
    p1=math.radians(lat1);p2=math.radians(lat2);dp=math.radians(lat2-lat1);dl=math.radians(lon2-lon1)
    h=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*r*math.atan2(math.sqrt(h),math.sqrt(max(0,1-h)))

def bucket(lat,lon,scale=100):return (round(lat*scale),round(lon*scale))

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--crosswalk',default='data/v9/france-crosswalk.json')
    ap.add_argument('--data-lab',default='data-lab')
    ap.add_argument('--candidates',default='data/v9/france-crosswalk-candidates.json')
    a=ap.parse_args()
    p=Path(a.crosswalk);payload=json.loads(p.read_text(encoding='utf-8'));entries=payload.get('entries',[])
    station_map={};pdc_map={};canonical={}
    for e in entries:
        cid=txt(e.get('canonicalId'));canonical[cid]=e
        sid=txt(e.get('idStationItinerance') or e.get('id_station_itinerance'))
        if sid:station_map[sid]=cid
        for pid in e.get('pdcIds',[]) or []:
            if txt(pid):pdc_map[txt(pid)]=cid
        e.setdefault('aliases',[]);e.setdefault('sourceIds',[])
    spatial=defaultdict(list)
    static_manifest=Path('data/v9/france-static/all.json.gz')
    if static_manifest.exists():
        with gzip.open(static_manifest,'rt',encoding='utf-8') as f:
            for r in json.load(f):
                if len(r)>=5:
                    spatial[bucket(float(r[3]),float(r[4]))].append((txt(r[0]),float(r[3]),float(r[4]),txt(r[1])))
    exact_added=0;exact_records=0;candidate_rows=[];files_seen=0;records_seen=0
    seen_alias=set()
    for e in entries:
        for s in e.get('sourceIds',[]) or []:seen_alias.add((txt(e.get('canonicalId')),txt(s.get('source')),txt(s.get('id'))))
    for spec in SOURCE_SPECS:
        path=Path(a.data_lab)/spec['path']
        if not path.exists():continue
        files_seen+=1
        try:data=read_json(path)
        except Exception as ex:
            candidate_rows.append({'provider':spec['provider'],'file':spec['path'],'kind':'read_error','error':str(ex)[:240]});continue
        for rec in walk_records(data):
            records_seen+=1
            station_ids=vals(rec,STATION_ID_KEYS);pdc_ids=vals(rec,PDC_ID_KEYS)
            matches=[]
            for sid in station_ids:
                if sid in station_map:matches.append(('station',sid,station_map[sid]))
            for pid in pdc_ids:
                if pid in pdc_map:matches.append(('pdc',pid,pdc_map[pid]))
            cids=sorted(set(m[2] for m in matches))
            if len(cids)==1:
                exact_records+=1;cid=cids[0];e=canonical[cid]
                provider_ids=[]
                for v in vals(rec,PROVIDER_ID_KEYS):
                    if v not in station_map and v not in pdc_map and len(v)>=2:provider_ids.append(v)
                # Also preserve the exact IRVE identifier under the provider namespace when the provider dataset uses it as its own station key.
                if not provider_ids:
                    provider_ids=[m[1] for m in matches if m[0]=='station'][:1]
                for pid in dict.fromkeys(provider_ids):
                    key=(cid,spec['provider'],pid)
                    if key in seen_alias:continue
                    e['sourceIds'].append({'source':spec['provider'],'id':pid,'match':'exact_irve_identifier','file':spec['path']})
                    alias=f"{spec['provider']}:{pid}"
                    if alias not in e['aliases']:e['aliases'].append(alias)
                    seen_alias.add(key);exact_added+=1
                continue
            if len(cids)>1:
                candidate_rows.append({'provider':spec['provider'],'file':spec['path'],'kind':'ambiguous_exact','matchedCanonicalIds':cids[:20],'stationIds':station_ids[:10],'pdcIds':pdc_ids[:10]})
                continue
            lat=first_num(rec,LAT_KEYS);lon=first_num(rec,LON_KEYS)
            if lat is None or lon is None or not spatial:continue
            nearby=[]
            br,bc=bucket(lat,lon)
            for dr in (-1,0,1):
                for dc in (-1,0,1):
                    for sid,slat,slon,sname in spatial.get((br+dr,bc+dc),[]):
                        d=haversine((lat,lon),(slat,slon))
                        if d<=80:nearby.append((round(d,1),sid,sname))
            nearby.sort()
            if nearby:
                candidate_rows.append({'provider':spec['provider'],'file':spec['path'],'kind':'geo_candidate_only','name':first_text(rec,NAME_KEYS),'providerIds':vals(rec,PROVIDER_ID_KEYS)[:10],'latitude':lat,'longitude':lon,'nearby':[{'distanceM':d,'idStationItinerance':sid,'name':name} for d,sid,name in nearby[:5]]})
    for e in entries:
        e['aliases']=sorted(set(txt(x) for x in e.get('aliases',[]) if txt(x)))
        e['sourceIds']=sorted(e.get('sourceIds',[]),key=lambda x:(txt(x.get('source')),txt(x.get('id')),txt(x.get('file'))))
    payload['enrichment']={'filesSeen':files_seen,'recordsSeen':records_seen,'exactMatchedRecords':exact_records,'exactAliasesAdded':exact_added,'candidateCount':len(candidate_rows),'policy':'Only exact existing IRVE station/PDC identifiers create active provider aliases; geographic matches are review-only.'}
    p.write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    cp=Path(a.candidates);cp.parent.mkdir(parents=True,exist_ok=True);cp.write_text(json.dumps({'schemaVersion':1,'country':'FR','policy':'review_only_never_runtime','count':len(candidate_rows),'candidates':candidate_rows},ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    print(json.dumps(payload['enrichment'],indent=2))

if __name__=='__main__':main()
