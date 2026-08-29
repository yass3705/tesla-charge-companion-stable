#!/usr/bin/env python3
import argparse,csv,gzip,hashlib,json,math,re,shutil,tempfile,unicodedata,urllib.request
from collections import defaultdict
from datetime import datetime,timezone
from pathlib import Path

DEFAULT_URL='https://data.bundesnetzagentur.de/Bundesnetzagentur/DE/Fachthemen/ElektrizitaetundGas/E-Mobilitaet/Ladesaeulenregister_BNetzA_2026-07-28.csv'
TILE=.5

def txt(v): return str(v or '').strip()
def norm(v):
    s=unicodedata.normalize('NFKD',txt(v));s=''.join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r'[^a-z0-9]+','_',s).strip('_')
def num(v):
    s=txt(v).replace(' ','').replace(',','.')
    try:return float(s)
    except:return None

def first(row,*names):
    idx={norm(k):v for k,v in row.items()}
    for n in names:
        v=idx.get(norm(n))
        if txt(v):return txt(v)
    return ''

def load_aliases(path):
    data=json.loads(Path(path).read_text(encoding='utf-8'));out={}
    for item in data.get('operators',[]):
        canon=item.get('canonical') or ''
        for a in item.get('aliases',[]):out[norm(a)]=canon or a
    return out

def tile_id(lat,lon):
    a=math.floor(lat/TILE)*TILE;b=math.floor(lon/TILE)*TILE
    f=lambda x:str(round(x*2)).replace('-','m')
    return f't_{f(a)}_{f(b)}'

def infer_kind(connector,power,facility_type=''):
    s=norm(connector+' '+facility_type)
    if any(k in s for k in ('ccs','combo','chademo','schnelllade')):return 'DC'
    if any(k in s for k in ('typ_2','type_2','schuko','cee','normallade')):return 'AC'
    return 'DC' if (power or 0)>43 else 'AC'

def access(row):
    opening=first(row,'Öffnungszeiten','Offnungszeiten')
    days=first(row,'Öffnungszeiten: Wochentage','Offnungszeiten: Wochentage')
    times=first(row,'Öffnungszeiten: Tageszeiten','Offnungszeiten: Tageszeiten')
    s=norm(' '.join((opening,days,times)))
    if any(k in s for k in ('24_7','24_stunden','durchgehend')):
        return [[d,'00:00','24:00'] for d in range(7)]
    return 0

def download(url):
    fd=tempfile.NamedTemporaryFile(delete=False,suffix='.csv');fd.close()
    req=urllib.request.Request(url,headers={'User-Agent':'Tesla-Charge-Companion-V9-Germany/1.0','Accept':'text/csv,text/plain,*/*'})
    with urllib.request.urlopen(req,timeout=180) as r,open(fd.name,'wb') as w:shutil.copyfileobj(r,w)
    return Path(fd.name)

def open_reader(path):
    raw=Path(path).read_bytes();text=None
    for enc in ('utf-8-sig','utf-8','cp1252','latin-1'):
        try:text=raw.decode(enc);break
        except UnicodeDecodeError:pass
    if text is None:raise RuntimeError('BNetzA export cannot be decoded')
    import io
    sample=text[:65536]
    try:dialect=csv.Sniffer().sniff(sample,delimiters=';,\t|')
    except csv.Error:dialect=csv.excel;dialect.delimiter=';'
    return csv.DictReader(io.StringIO(text),dialect=dialect)

def build(source,out_dir,crosswalk_path,aliases_path,source_url):
    aliases=load_aliases(aliases_path);reader=open_reader(source);rows=[];cross=[];source_rows=0;skipped=0;evse_total=0
    generated=datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
    for row in reader:
        source_rows+=1
        sid=first(row,'Ladeeinrichtungs-ID','Ladeeinrichtungs ID','Ladeeinrichtungs_ID')
        lat=num(first(row,'Breitengrad'));lon=num(first(row,'Längengrad','Langengrad'))
        if not sid or lat is None or lon is None or not (46<=lat<=56 and 4<=lon<=16):skipped+=1;continue
        raw_op=first(row,'Betreiber');op=aliases.get(norm(raw_op),raw_op or 'Autre')
        name=first(row,'Anzeigename (Karte)','Standortbezeichnung') or raw_op or f'Ladeeinrichtung {sid}'
        street=' '.join(x for x in [first(row,'Straße','Strasse'),first(row,'Hausnummer')] if x)
        address=', '.join(x for x in [street,first(row,'Adresszusatz'),first(row,'Postleitzahl'),first(row,'Ort'),first(row,'Bundesland')] if x)
        facility_type=first(row,'Art der Ladeeinrichtung')
        evses=[];groups={}
        for i in range(1,7):
            connector=first(row,f'Steckertypen{i}',f'Steckertypen {i}')
            power=num(first(row,f'Nennleistung Stecker{i}',f'Nennleistung Stecker{i} [kW]',f'P{i} [kW]'))
            evse=first(row,f'EVSE-ID{i}',f'EVSE ID{i}',f'EVSE-ID {i}')
            if not connector and power is None and not evse:continue
            power=power if power is not None else num(first(row,'Nennleistung Ladeeinrichtung [kW]')) or 11.0
            kind=infer_kind(connector,power,facility_type);key=(kind,round(power,1),connector)
            g=groups.setdefault(key,{'kind':kind,'power':round(power,1),'connector':connector,'evses':[]})
            if evse:g['evses'].append(evse);evses.append(evse)
        if not groups:
            count=int(num(first(row,'Anzahl Ladepunkte')) or 1);power=num(first(row,'Nennleistung Ladeeinrichtung [kW]')) or 11.0
            kind=infer_kind('',power,facility_type);groups[(kind,round(power,1),'')]={'kind':kind,'power':round(power,1),'connector':'','evses':[],'count':count}
        configs=[]
        for i,g in enumerate(sorted(groups.values(),key=lambda x:(x['kind'],x['power'],x['connector']))):
            ids=sorted(set(g.get('evses',[])));count=len(ids) or g.get('count',1)
            cfg=f'bnetza-{i}-{g["kind"].lower()}-{str(g["power"]).replace(".","_")}'
            label=f'BNetzA · {g["kind"]} {g["power"]:g} kW'+(f' · {g["connector"]}' if g['connector'] else '')
            configs.append([cfg,label,g['kind'],g['power'],count,[],ids])
        station_count=len(set(evses)) or int(num(first(row,'Anzahl Ladepunkte')) or sum(x[4] for x in configs))
        evse_total+=station_count
        updated=first(row,'Inbetriebnahmedatum') or generated[:10]
        rows.append([sid,name,address,round(lat,6),round(lon,6),op,station_count,access(row),configs,updated,op])
        cross.append({'canonicalId':f'DE:national:{sid}','bnetzaId':sid,'bnetzaEvseIds':sorted(set(evses)),'aliases':[f'bnetza:{sid}'],'sourceIds':[],'operator':op,'rawOperator':raw_op or None})
    rows.sort(key=lambda r:r[0]);cross.sort(key=lambda r:r['bnetzaId']);out=Path(out_dir);shutil.rmtree(out,ignore_errors=True);out.mkdir(parents=True,exist_ok=True)
    tiles=defaultdict(list)
    for r in rows:tiles[tile_id(r[3],r[4])].append(r)
    manifest_tiles=[]
    for tid,items in sorted(tiles.items()):
        raw=json.dumps(items,separators=(',',':'),ensure_ascii=False).encode();gz=gzip.compress(raw,compresslevel=9);fn=f'{tid}.json.gz';(out/fn).write_bytes(gz)
        lat0=math.floor(items[0][3]/TILE)*TILE;lon0=math.floor(items[0][4]/TILE)*TILE
        manifest_tiles.append({'id':tid,'file':fn,'minLat':lat0,'maxLat':lat0+TILE,'minLon':lon0,'maxLon':lon0+TILE,'count':len(items),'bytes':len(gz),'sha256':hashlib.sha256(gz).hexdigest()})
    all_raw=json.dumps(rows,separators=(',',':'),ensure_ascii=False).encode();all_gz=gzip.compress(all_raw,compresslevel=9);(out/'all.json.gz').write_bytes(all_gz)
    manifest={'schemaVersion':2,'dataset':'germany-bnetza-static-v9','country':'DE','generatedAt':generated,'sourceUrl':source_url,'sourceAttribution':'Bundesnetzagentur.de (CC BY 4.0)','sourceRows':source_rows,'stationCount':len(rows),'evseCount':evse_total,'skippedRows':skipped,'tileSizeDegrees':TILE,'tileCount':len(manifest_tiles),'allFile':'all.json.gz','allBytes':len(all_gz),'allSha256':hashlib.sha256(all_gz).hexdigest(),'preIntegrationOnly':True,'tiles':manifest_tiles}
    (out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    Path(crosswalk_path).write_text(json.dumps({'schemaVersion':1,'country':'DE','generatedAt':generated,'preIntegrationOnly':True,'entries':cross},ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    print(json.dumps({k:manifest[k] for k in ('sourceRows','stationCount','evseCount','skippedRows','tileCount','allBytes')},indent=2))

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--input');ap.add_argument('--url',default=DEFAULT_URL);ap.add_argument('--out',default='data/v9/germany-static');ap.add_argument('--crosswalk',default='data/v9/germany-crosswalk.json');ap.add_argument('--aliases',default='data/v9/germany-operator-aliases.json');args=ap.parse_args();temp=None
    try:
        source=Path(args.input) if args.input else download(args.url);temp=None if args.input else source;build(source,args.out,args.crosswalk,args.aliases,args.url)
    finally:
        if temp:temp.unlink(missing_ok=True)
if __name__=='__main__':main()
