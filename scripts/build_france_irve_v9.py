#!/usr/bin/env python3
import argparse,csv,gzip,hashlib,json,math,re,shutil,tempfile,urllib.request
from collections import defaultdict
from datetime import datetime,timezone
from pathlib import Path

DEFAULT_URL='https://www.data.gouv.fr/api/1/datasets/r/4ca78c71-4ea4-475d-bd3a-d4aef88f7bf8'
TILE=.5

def txt(v): return str(v or '').strip()
def truth(v): return txt(v).lower() in {'true','1','oui','yes','vrai'}
def num(v):
    try: return float(txt(v).replace(',','.'))
    except: return None

def coords(row):
    lat=num(row.get('latitude')); lon=num(row.get('longitude'))
    if lat is not None and lon is not None: return lat,lon
    raw=txt(row.get('coordonneesXY') or row.get('coordonnees_xy') or row.get('coordonnees'))
    if raw:
        try:
            p=json.loads(raw)
            if isinstance(p,(list,tuple)) and len(p)>=2: lon,lat=float(p[0]),float(p[1]); return lat,lon
            if isinstance(p,dict):
                lon=num(p.get('lon') or p.get('longitude') or p.get('x')); lat=num(p.get('lat') or p.get('latitude') or p.get('y'))
                if lat is not None and lon is not None:return lat,lon
        except Exception: pass
        vals=re.findall(r'-?\d+(?:[.,]\d+)?',raw)
        if len(vals)>=2:
            a,b=(float(x.replace(',','.')) for x in vals[:2])
            if abs(a)<=180 and abs(b)<=90:return b,a
            if abs(a)<=90 and abs(b)<=180:return a,b
    return None,None

def exact_kwh_tariff(raw):
    s=txt(raw).lower().replace(',','.')
    vals=[float(x) for x in re.findall(r'(\d+(?:\.\d+)?)\s*(?:€|eur)?\s*/\s*kwh\b',s)]
    if len(vals)!=1 or not (0<=vals[0]<=5): return []
    return [['allDay','00:00','24:00','kwh','EUR',round(vals[0],6),0,0,0,0,0,None]]

def access(raw):
    s=txt(raw).lower().replace(' ','')
    if any(k in s for k in ('24/7','24h/24','24h24','7j/7')):
        return [[d,'00:00','24:00'] for d in range(7)]
    return 0

def connector_kinds(row,power):
    kinds=[]
    if truth(row.get('prise_type_combo_ccs')) or truth(row.get('prise_type_chademo')): kinds.append('DC')
    if truth(row.get('prise_type_ef')) or truth(row.get('prise_type_2')) or truth(row.get('cable_t2_attache')): kinds.append('AC')
    if not kinds: kinds=['DC' if (power or 0)>43 else 'AC']
    return sorted(set(kinds))

def tile_id(lat,lon):
    a=math.floor(lat/TILE)*TILE;b=math.floor(lon/TILE)*TILE
    f=lambda x:str(round(x*2)).replace('-','m')
    return f't_{f(a)}_{f(b)}'

def download(url):
    fd=tempfile.NamedTemporaryFile(delete=False,suffix='.csv');fd.close()
    req=urllib.request.Request(url,headers={'User-Agent':'Tesla-Charge-Companion-V9/1.0'})
    with urllib.request.urlopen(req,timeout=180) as r,open(fd.name,'wb') as w: shutil.copyfileobj(r,w)
    return Path(fd.name)

def open_reader(path):
    f=open(path,'r',encoding='utf-8-sig',newline='')
    sample=f.read(65536);f.seek(0)
    try:dialect=csv.Sniffer().sniff(sample,delimiters=',;\t')
    except csv.Error:dialect=csv.excel
    return f,csv.DictReader(f,dialect=dialect)

def build(source,out_dir,crosswalk_path):
    f,reader=open_reader(source); stations={}; row_count=0; skipped=0
    try:
        for row in reader:
            row_count+=1
            sid=txt(row.get('id_station_itinerance')); pid=txt(row.get('id_pdc_itinerance'))
            if not sid: sid=txt(row.get('id_station_local'))
            if not sid and pid: sid=pid.rsplit('*',1)[0]
            lat,lon=coords(row)
            if not sid or lat is None or lon is None: skipped+=1;continue
            st=stations.setdefault(sid,{'id':sid,'name':'','address':'','operator':'','lat':lat,'lon':lon,'pdc':set(),'groups':{},'access':0,'updated':''})
            st['name']=st['name'] or txt(row.get('nom_station')) or txt(row.get('nom_enseigne'))
            st['address']=st['address'] or ', '.join(x for x in [txt(row.get('adresse_station')),txt(row.get('code_insee_commune'))] if x)
            st['operator']=st['operator'] or txt(row.get('nom_operateur')) or txt(row.get('nom_enseigne')) or 'Autre'
            st['access']=st['access'] or access(row.get('horaires'))
            updated=txt(row.get('date_maj'));st['updated']=max(st['updated'],updated)
            if pid:st['pdc'].add(pid)
            power=num(row.get('puissance_nominale')) or 11.0
            tariffs=exact_kwh_tariff(row.get('tarification'))
            for kind in connector_kinds(row,power):
                key=(kind,round(power,1),json.dumps(tariffs,separators=(',',':')))
                g=st['groups'].setdefault(key,{'kind':kind,'power':round(power,1),'pdc':set(),'rules':tariffs})
                if pid:g['pdc'].add(pid)
    finally:f.close()
    generated=datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
    rows=[];cross=[]
    for sid,st in sorted(stations.items()):
        configs=[]
        for i,g in enumerate(sorted(st['groups'].values(),key=lambda x:(x['kind'],x['power'],sorted(x['pdc'])))):
            pids=sorted(g['pdc']); cfg=f'irve-{i}-{g["kind"].lower()}-{str(g["power"]).replace(".","_")}'
            label=f'IRVE · {g["kind"]} {g["power"]:g} kW'
            configs.append([cfg,label,g['kind'],g['power'],len(pids) or 1,g['rules'],pids])
        rows.append([sid,st['name'] or st['address'] or f'Borne {sid}',st['address'],round(st['lat'],6),round(st['lon'],6),st['operator'],len(st['pdc']) or sum(x[4] for x in configs),st['access'],configs,st['updated'] or generated[:10]])
        cross.append({'canonicalId':f'FR:national:{sid}','idStationItinerance':sid,'pdcIds':sorted(st['pdc']),'aliases':[f'irve-station:{sid}'],'sourceIds':[],'updatedAt':st['updated'] or None})
    out=Path(out_dir);shutil.rmtree(out,ignore_errors=True);out.mkdir(parents=True,exist_ok=True)
    tiles=defaultdict(list)
    for r in rows:tiles[tile_id(r[3],r[4])].append(r)
    manifest_tiles=[]
    for tid,items in sorted(tiles.items()):
        items.sort(key=lambda r:r[0]); raw=json.dumps(items,separators=(',',':'),ensure_ascii=False).encode(); gz=gzip.compress(raw,compresslevel=9); fn=f'{tid}.json.gz';(out/fn).write_bytes(gz)
        lat0=math.floor(items[0][3]/TILE)*TILE;lon0=math.floor(items[0][4]/TILE)*TILE
        manifest_tiles.append({'id':tid,'file':fn,'minLat':lat0,'maxLat':lat0+TILE,'minLon':lon0,'maxLon':lon0+TILE,'count':len(items),'bytes':len(gz),'sha256':hashlib.sha256(gz).hexdigest()})
    all_raw=json.dumps(rows,separators=(',',':'),ensure_ascii=False).encode();all_gz=gzip.compress(all_raw,compresslevel=9);(out/'all.json.gz').write_bytes(all_gz)
    manifest={'schemaVersion':2,'dataset':'france-irve-static-v9','generatedAt':generated,'sourceUrl':DEFAULT_URL,'sourceRows':row_count,'stationCount':len(rows),'pdcCount':sum(len(s['pdc']) for s in stations.values()),'skippedRows':skipped,'tileSizeDegrees':TILE,'tileCount':len(manifest_tiles),'allFile':'all.json.gz','allBytes':len(all_gz),'allSha256':hashlib.sha256(all_gz).hexdigest(),'tiles':manifest_tiles}
    (out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    cp=Path(crosswalk_path);cp.parent.mkdir(parents=True,exist_ok=True);cp.write_text(json.dumps({'schemaVersion':1,'country':'FR','generatedAt':generated,'entries':cross},ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    print(json.dumps({k:manifest[k] for k in ('sourceRows','stationCount','pdcCount','skippedRows','tileCount','allBytes')},indent=2))

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--input');ap.add_argument('--url',default=DEFAULT_URL);ap.add_argument('--out',default='data/v9/france-static');ap.add_argument('--crosswalk',default='data/v9/france-crosswalk.json');args=ap.parse_args()
    temp=None
    try:
        source=Path(args.input) if args.input else download(args.url);temp=None if args.input else source
        build(source,args.out,args.crosswalk)
    finally:
        if temp:temp.unlink(missing_ok=True)
if __name__=='__main__':main()
