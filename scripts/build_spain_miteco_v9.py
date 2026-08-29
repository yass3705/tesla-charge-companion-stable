#!/usr/bin/env python3
import argparse,csv,gzip,hashlib,json,math,re,shutil,tempfile,unicodedata,urllib.request
from collections import defaultdict
from datetime import datetime,timezone
from pathlib import Path

DEFAULT_URL='https://energia.serviciosmin.gob.es/Ripree/ExportarInstalaciones/Export'
TILE=.5

def txt(v): return str(v or '').strip()
def norm(v):
    s=unicodedata.normalize('NFKD',txt(v));s=''.join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r'[^a-z0-9]+','_',s).strip('_')
def num(v):
    s=txt(v).replace(' ','')
    if not s:return None
    if ',' in s and '.' not in s:s=s.replace(',','.')
    elif ',' in s and '.' in s and s.rfind(',')>s.rfind('.'):s=s.replace('.','').replace(',','.')
    try:return float(s)
    except:return None

def first(row,*aliases):
    idx={norm(k):v for k,v in row.items()}
    for a in aliases:
        v=idx.get(norm(a))
        if txt(v):return txt(v)
    return ''

def load_aliases(path):
    data=json.loads(Path(path).read_text(encoding='utf-8'))
    out={}
    for item in data.get('operators',[]):
        for a in item.get('aliases',[]):out[norm(a)]=item.get('canonical') or a
    return out

def canonical_operator(raw,aliases):return aliases.get(norm(raw),raw or 'Autre')
def tile_id(lat,lon):
    a=math.floor(lat/TILE)*TILE;b=math.floor(lon/TILE)*TILE
    f=lambda x:str(round(x*2)).replace('-','m')
    return f't_{f(a)}_{f(b)}'

def download(url):
    fd=tempfile.NamedTemporaryFile(delete=False,suffix='.csv');fd.close()
    req=urllib.request.Request(url,headers={'User-Agent':'Tesla-Charge-Companion-V9-Spain/1.0','Accept':'text/csv,text/plain,*/*'})
    with urllib.request.urlopen(req,timeout=180) as r,open(fd.name,'wb') as w:shutil.copyfileobj(r,w)
    return Path(fd.name)

def open_reader(path):
    raw=Path(path).read_bytes()
    text=None
    for enc in ('utf-8-sig','utf-8','cp1252','latin-1'):
        try:text=raw.decode(enc);break
        except UnicodeDecodeError:pass
    if text is None:raise RuntimeError('MITECO export cannot be decoded')
    if text.lstrip().startswith('<'):raise RuntimeError('MITECO endpoint returned markup instead of CSV')
    sample=text[:65536]
    try:dialect=csv.Sniffer().sniff(sample,delimiters=',;\t|')
    except csv.Error:dialect=csv.excel
    import io
    return csv.DictReader(io.StringIO(text),dialect=dialect)

def infer_kind(connector,power):
    s=norm(connector)
    if any(k in s for k in ('ccs','combo','chademo')):return 'DC'
    if any(k in s for k in ('tipo_2','type_2','mennekes','schuko')):return 'AC'
    return 'DC' if (power or 0)>=43 else 'AC'

def station_key(row,index):
    sid=first(row,'id instalacion','id_instalacion','identificador instalacion','codigo instalacion','id punto recarga','id_punto_recarga','evse id','evse_id','codigo punto')
    if sid:return sid
    material='|'.join(filter(None,[first(row,'operador','cpo','titular explotacion','titular de la explotacion'),first(row,'direccion','domicilio'),first(row,'municipio','localidad'),first(row,'codigo postal','cp'),first(row,'latitud','latitude'),first(row,'longitud','longitude')]))
    if not material:material=json.dumps(row,ensure_ascii=False,sort_keys=True)+f'|{index}'
    return 'AUTO-'+hashlib.sha1(material.encode()).hexdigest()[:20]

def build(source,out_dir,crosswalk_path,aliases_path):
    aliases=load_aliases(aliases_path);reader=open_reader(source);stations={};row_count=0;skipped=0
    for row in reader:
        row_count+=1
        lat=num(first(row,'latitud','latitude','coord_y','y'));lon=num(first(row,'longitud','longitude','coord_x','x'))
        if lat is None or lon is None or abs(lat)>90 or abs(lon)>180:skipped+=1;continue
        sid=station_key(row,row_count)
        raw_op=first(row,'operador','cpo','nombre operador','titular explotacion','titular de la explotacion','empresa operadora')
        op=canonical_operator(raw_op,aliases)
        name=first(row,'nombre instalacion','nombre','denominacion','emplazamiento')
        address=', '.join(x for x in [first(row,'direccion','domicilio','via'),first(row,'codigo postal','cp'),first(row,'municipio','localidad','poblacion'),first(row,'provincia')] if x)
        connector=first(row,'tipo conector','tipo de conector','conector','connector_type')
        power=num(first(row,'potencia maxima','potencia_maxima','potencia kw','potencia','power_kw')) or 11.0
        kind=infer_kind(connector,power)
        evse=first(row,'evse id','evse_id','id punto recarga','id_punto_recarga','codigo punto')
        updated=first(row,'fecha actualizacion','fecha_actualizacion','fecha modificacion','fecha_modificacion','date_maj','updated_at')
        st=stations.setdefault(sid,{'id':sid,'name':name,'address':address,'operator':op,'network':op,'lat':lat,'lon':lon,'evses':set(),'groups':{},'updated':updated,'rawOperators':set()})
        if not st['name'] and name:st['name']=name
        if not st['address'] and address:st['address']=address
        st['rawOperators'].add(raw_op or op)
        if evse:st['evses'].add(evse)
        gkey=(kind,round(power,1),connector)
        g=st['groups'].setdefault(gkey,{'kind':kind,'power':round(power,1),'connector':connector,'evses':set()})
        if evse:g['evses'].add(evse)
        if updated and updated>st['updated']:st['updated']=updated
    generated=datetime.now(timezone.utc).isoformat().replace('+00:00','Z');rows=[];cross=[]
    for sid,st in sorted(stations.items()):
        configs=[]
        for i,g in enumerate(sorted(st['groups'].values(),key=lambda x:(x['kind'],x['power'],x['connector']))):
            ids=sorted(g['evses']);cfg=f'miteco-{i}-{g["kind"].lower()}-{str(g["power"]).replace(".","_")}'
            label=f'MITECO · {g["kind"]} {g["power"]:g} kW' + (f' · {g["connector"]}' if g['connector'] else '')
            configs.append([cfg,label,g['kind'],g['power'],len(ids) or 1,[],ids])
        rows.append([sid,st['name'] or st['address'] or f'Borne {sid}',st['address'],round(st['lat'],6),round(st['lon'],6),st['operator'],len(st['evses']) or sum(x[4] for x in configs),0,configs,st['updated'] or generated[:10],st['network']])
        cross.append({'canonicalId':f'ES:national:{sid}','mitecoId':sid,'mitecoEvseIds':sorted(st['evses']),'reveLocationIds':[],'reveEvseIds':[],'aliases':[f'miteco:{sid}'],'sourceIds':[],'operator':st['operator'],'rawOperators':sorted(st['rawOperators']),'updatedAt':st['updated'] or None})
    out=Path(out_dir);shutil.rmtree(out,ignore_errors=True);out.mkdir(parents=True,exist_ok=True);tiles=defaultdict(list)
    for r in rows:tiles[tile_id(r[3],r[4])].append(r)
    manifest_tiles=[]
    for tid,items in sorted(tiles.items()):
        items.sort(key=lambda r:r[0]);raw=json.dumps(items,separators=(',',':'),ensure_ascii=False).encode();gz=gzip.compress(raw,compresslevel=9);fn=f'{tid}.json.gz';(out/fn).write_bytes(gz)
        lat0=math.floor(items[0][3]/TILE)*TILE;lon0=math.floor(items[0][4]/TILE)*TILE
        manifest_tiles.append({'id':tid,'file':fn,'minLat':lat0,'maxLat':lat0+TILE,'minLon':lon0,'maxLon':lon0+TILE,'count':len(items),'bytes':len(gz),'sha256':hashlib.sha256(gz).hexdigest()})
    all_raw=json.dumps(rows,separators=(',',':'),ensure_ascii=False).encode();all_gz=gzip.compress(all_raw,compresslevel=9);(out/'all.json.gz').write_bytes(all_gz)
    manifest={'schemaVersion':2,'dataset':'spain-miteco-static-v9','country':'ES','generatedAt':generated,'sourceUrl':DEFAULT_URL,'sourceRows':row_count,'stationCount':len(rows),'evseCount':sum(len(s['evses']) for s in stations.values()),'skippedRows':skipped,'tileSizeDegrees':TILE,'tileCount':len(manifest_tiles),'allFile':'all.json.gz','allBytes':len(all_gz),'allSha256':hashlib.sha256(all_gz).hexdigest(),'preIntegrationOnly':True,'tiles':manifest_tiles}
    (out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    cp=Path(crosswalk_path);cp.parent.mkdir(parents=True,exist_ok=True);cp.write_text(json.dumps({'schemaVersion':1,'country':'ES','generatedAt':generated,'preIntegrationOnly':True,'entries':cross},ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    print(json.dumps({k:manifest[k] for k in ('sourceRows','stationCount','evseCount','skippedRows','tileCount','allBytes')},indent=2))

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--input');ap.add_argument('--url',default=DEFAULT_URL);ap.add_argument('--out',default='data/v9/spain-static');ap.add_argument('--crosswalk',default='data/v9/spain-crosswalk.json');ap.add_argument('--aliases',default='data/v9/spain-operator-aliases.json');args=ap.parse_args();temp=None
    try:
        source=Path(args.input) if args.input else download(args.url);temp=None if args.input else source;build(source,args.out,args.crosswalk,args.aliases)
    finally:
        if temp:temp.unlink(missing_ok=True)
if __name__=='__main__':main()
