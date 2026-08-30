#!/usr/bin/env python3
import argparse,gzip,hashlib,json,math,re,shutil,unicodedata
from collections import Counter,defaultdict
from datetime import datetime,timezone
from pathlib import Path
TILE=.5

def t(v): return str(v or '').strip()
def n(v):
 s=unicodedata.normalize('NFKD',t(v));s=''.join(c for c in s if not unicodedata.combining(c)).lower();return re.sub(r'[^a-z0-9]+','_',s).strip('_')
def is_tesla_operator(v):
 x=n(v);return x=='tesla' or x.startswith('tesla_')
def tile(lat,lon):
 a=math.floor(lat/TILE)*TILE;b=math.floor(lon/TILE)*TILE;fmt=lambda x:str(round(x*2)).replace('-','m');return f't_{fmt(a)}_{fmt(b)}'
def site_key(r): return '|'.join([n(r[5]),n(r[2]),f'{float(r[3]):.6f}',f'{float(r[4]):.6f}'])
def site_id(key): return 'SITE-'+hashlib.sha1(key.encode()).hexdigest()[:20]
def loadgz(p): return json.loads(gzip.decompress(Path(p).read_bytes()))
def writegz(p,obj):
 raw=json.dumps(obj,separators=(',',':'),ensure_ascii=False).encode();gz=gzip.compress(raw,9);Path(p).write_bytes(gz);return gz
def commissioning_date(v):
 s=t(v)
 if not s:return None
 for fmt in ('%d.%m.%Y','%Y-%m-%d'):
  try:return datetime.strptime(s,fmt).date()
  except ValueError:pass
 return None

def main():
 a=argparse.ArgumentParser();a.add_argument('--input-root',required=True);a.add_argument('--input-crosswalk',required=True);a.add_argument('--out',required=True);a.add_argument('--crosswalk',required=True);x=a.parse_args()
 inp=Path(x.input_root);all_rows=loadgz(inp/'all.json.gz');cw=json.loads(Path(x.input_crosswalk).read_text());entry_by_id={str(e['bnetzaId']):e for e in cw.get('entries',[])}
 def facility_is_tesla(r):
  if is_tesla_operator(r[5]):return True
  e=entry_by_id.get(str(r[0]),{})
  return is_tesla_operator(e.get('rawOperator'))
 excluded_tesla=[r for r in all_rows if facility_is_tesla(r)];rows=[r for r in all_rows if not facility_is_tesla(r)]
 groups=defaultdict(list)
 for r in rows: groups[site_key(r)].append(r)
 outrows=[];outcw=[];multi=0;maxfac=0;facility_count=0;evse_total=0
 for key,items in groups.items():
  items=sorted(items,key=lambda r:str(r[0]));sid=site_id(key);facility_ids=[str(r[0]) for r in items];facility_count+=len(items);maxfac=max(maxfac,len(items));multi+=1 if len(items)>1 else 0
  names=Counter(t(r[1]) for r in items if t(r[1]));name=names.most_common(1)[0][0] if names else t(items[0][5]) or sid
  addr=items[0][2];lat=items[0][3];lon=items[0][4];op=items[0][5];network=items[0][10]
  access=0 if any(int(r[7] or 0)==0 for r in items) else 1
  cfgmap={};evses=[];declared=0
  for r in items:
   declared+=int(r[6] or 0)
   for c in r[8] or []:
    k=(t(c[2]),round(float(c[3] or 0),1),n(c[1].split('·')[-1] if '·' in c[1] else ''))
    g=cfgmap.setdefault(k,{'kind':t(c[2]),'power':round(float(c[3] or 0),1),'count':0,'ids':set(),'label':t(c[1])})
    g['count']+=int(c[4] or 0)
    for e in (c[6] or []): g['ids'].add(e);evses.append(e)
  cfg=[]
  for j,g in enumerate(sorted(cfgmap.values(),key=lambda z:(z['kind'],z['power'],z['label']))):
   ids=sorted(g['ids']);cnt=len(ids) if ids else g['count'];cfg.append([f'bnetza-site-{j}-{g["kind"].lower()}-{str(g["power"]).replace(".","_")}',g['label'],g['kind'],g['power'],cnt,[],ids])
  unique_evses=sorted(set(evses));cnt=len(unique_evses) or declared or sum(c[4] for c in cfg);evse_total+=cnt
  parsed_dates=[d for d in (commissioning_date(r[9]) for r in items) if d];commissioned=min(parsed_dates).isoformat() if parsed_dates else ''
  outrows.append([sid,name,addr,lat,lon,op,cnt,access,cfg,commissioned,network])
  aliases=[];rawops=set();all_evses=[]
  for fid in facility_ids:
   e=entry_by_id.get(fid,{})
   aliases.extend(e.get('aliases',[]));raw=e.get('rawOperator')
   if raw: rawops.add(raw)
   all_evses.extend(e.get('bnetzaEvseIds',[]))
  outcw.append({'canonicalId':f'DE:site:{sid}','siteId':sid,'bnetzaIds':facility_ids,'bnetzaEvseIds':sorted(set(all_evses or unique_evses)),'aliases':sorted(set(aliases+[f'bnetza:{z}' for z in facility_ids])),'operator':op,'rawOperators':sorted(rawops),'facilityCount':len(facility_ids),'commissioningDate':commissioned or None})
 outrows.sort(key=lambda r:r[0]);out=Path(x.out);shutil.rmtree(out,ignore_errors=True);out.mkdir(parents=True);tiles=defaultdict(list)
 for r in outrows: tiles[tile(r[3],r[4])].append(r)
 mt=[]
 for q,items in sorted(tiles.items()):
  gz=writegz(out/(q+'.json.gz'),items);aa=math.floor(items[0][3]/TILE)*TILE;bb=math.floor(items[0][4]/TILE)*TILE;mt.append({'id':q,'file':q+'.json.gz','minLat':aa,'maxLat':aa+TILE,'minLon':bb,'maxLon':bb+TILE,'count':len(items),'bytes':len(gz),'sha256':hashlib.sha256(gz).hexdigest()})
 allgz=writegz(out/'all.json.gz',outrows);now=datetime.now(timezone.utc).isoformat().replace('+00:00','Z');srcm=json.loads((inp/'manifest.json').read_text())
 m={'schemaVersion':5,'dataset':'germany-bnetza-sites-v9','country':'DE','generatedAt':now,'sourceDataset':srcm.get('dataset'),'sourceUrl':srcm.get('sourceUrl'),'sourceAttribution':srcm.get('sourceAttribution'),'sourceRows':srcm.get('sourceRows'),'sourceFacilityCount':len(all_rows),'excludedTeslaFacilityCount':len(excluded_tesla),'facilityCount':facility_count,'siteCount':len(outrows),'stationCount':len(outrows),'evseCount':evse_total,'multiFacilitySiteCount':multi,'maxFacilitiesPerSite':maxfac,'skippedRows':srcm.get('skippedRows',0),'syntheticIdCount':srcm.get('syntheticIdCount',0),'tileSizeDegrees':TILE,'tileCount':len(mt),'allFile':'all.json.gz','allBytes':len(allgz),'allSha256':hashlib.sha256(allgz).hexdigest(),'preIntegrationOnly':True,'teslaExcludedFromRuntimeBaseline':True,'groupingKey':'canonical operator + normalized address + coordinates rounded to 6 decimals','row9Semantic':'commissioningDate','tiles':mt}
 (out/'manifest.json').write_text(json.dumps(m,separators=(',',':'),ensure_ascii=False)+'\n');Path(x.crosswalk).write_text(json.dumps({'schemaVersion':4,'country':'DE','generatedAt':now,'preIntegrationOnly':True,'teslaExcludedFromRuntimeBaseline':True,'entries':outcw},separators=(',',':'),ensure_ascii=False)+'\n')
 print(json.dumps({k:m[k] for k in ('sourceFacilityCount','excludedTeslaFacilityCount','facilityCount','siteCount','evseCount','multiFacilitySiteCount','maxFacilitiesPerSite','tileCount','allBytes')},indent=2))
if __name__=='__main__': main()
