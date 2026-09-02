#!/usr/bin/env python3
import argparse,csv,gzip,hashlib,json,math,re,shutil,tempfile,unicodedata,urllib.request,io
from collections import defaultdict
from datetime import datetime,timezone
from pathlib import Path
URL='https://data.bundesnetzagentur.de/Bundesnetzagentur/DE/Fachthemen/ElektrizitaetundGas/E-Mobilitaet/Ladesaeulenregister_BNetzA_2026-07-28.csv';TILE=.5

def t(v): return str(v or '').strip()
def n(v):
 s=unicodedata.normalize('NFKD',t(v));s=''.join(c for c in s if not unicodedata.combining(c)).lower();return re.sub(r'[^a-z0-9]+','_',s).strip('_')
def fnum(v):
 try:return float(t(v).replace(' ','').replace(',','.'))
 except:return None
def nv(r,*names):
 for x in names:
  v=r.get(n(x))
  if t(v): return t(v)
 return ''
def aliases(p):
 paths=[Path(p)];ext=Path(p).with_name('germany-operator-aliases-extension.json')
 if ext.exists():paths.append(ext)
 o={}
 for path in paths:
  d=json.loads(path.read_text())
  for x in d.get('operators',[]):
   for a in x.get('aliases',[]):o[n(a)]=x.get('canonical') or a
 return o
def dl(u):
 q=tempfile.NamedTemporaryFile(delete=False,suffix='.csv');q.close();req=urllib.request.Request(u,headers={'User-Agent':'TCC-V9-DE/1.3'})
 with urllib.request.urlopen(req,timeout=180) as r,open(q.name,'wb') as w:shutil.copyfileobj(r,w)
 return Path(q.name)
def reader(p):
 raw=Path(p).read_bytes();text=None
 for e in ('utf-8-sig','utf-8','cp1252','latin-1'):
  try:text=raw.decode(e);break
  except UnicodeDecodeError:pass
 lines=text.splitlines();start=None
 for i,line in enumerate(lines[:50]):
  z=n(line)
  if 'ladeeinrichtungs_id' in z and 'breitengrad' in z and 'langengrad' in z:start=i;break
 if start is None: raise RuntimeError('BNetzA table header not found')
 text='\n'.join(lines[start:])
 return csv.DictReader(io.StringIO(text),delimiter=';',quotechar='"')
def sid(r,lat,lon,i):
 x=nv(r,'Ladeeinrichtungs-ID','Standort-ID')
 if x:return x
 material='|'.join([nv(r,'Betreiber'),nv(r,'Straße'),nv(r,'Hausnummer'),nv(r,'Postleitzahl'),nv(r,'Ort'),f'{lat:.7f}',f'{lon:.7f}',str(i)])
 return 'AUTO-'+hashlib.sha1(material.encode()).hexdigest()[:20]
def kind(c,p,typ):
 s=n(c+' '+typ)
 if any(x in s for x in ('combo','ccs','chademo','schnelllade')):return 'DC'
 if any(x in s for x in ('typ_2','type_2','schuko','cee','normallade')):return 'AC'
 return 'DC' if (p or 0)>43 else 'AC'
def tile(lat,lon):
 a=math.floor(lat/TILE)*TILE;b=math.floor(lon/TILE)*TILE;fmt=lambda x:str(round(x*2)).replace('-','m');return f't_{fmt(a)}_{fmt(b)}'
def build(src,out,cross,alias_path,u):
 A=aliases(alias_path);R=[];C=[];total=skip=evtot=0;now=datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
 rr=reader(src);headers=rr.fieldnames or [];print(json.dumps({'headers':headers},ensure_ascii=False))
 for raw in rr:
  total+=1;r={n(k):v for k,v in raw.items()};lat=fnum(nv(r,'Breitengrad'));lon=fnum(nv(r,'Längengrad','Langengrad'))
  if lat is None or lon is None or not(46<=lat<=56 and 4<=lon<=16):skip+=1;continue
  ID=sid(r,lat,lon,total);rawop=nv(r,'Betreiber');op=A.get(n(rawop),rawop or 'Autre');name=nv(r,'Anzeigename (Karte)','Standortbezeichnung') or rawop or ID
  street=' '.join(x for x in [nv(r,'Straße','Strasse'),nv(r,'Hausnummer')] if x);address=', '.join(x for x in [street,nv(r,'Adresszusatz'),nv(r,'Postleitzahl'),nv(r,'Ort'),nv(r,'Bundesland')] if x)
  typ=nv(r,'Art der Ladeeinrichtung');groups={};ev=[]
  for i in range(1,7):
   c=nv(r,f'Steckertypen{i}',f'Steckertypen {i}');p=fnum(nv(r,f'Nennleistung Stecker{i}',f'Nennleistung Stecker{i} [kW]',f'P{i} [kW]'));e=nv(r,f'EVSE-ID{i}',f'EVSE ID{i}',f'EVSE-ID {i}')
   if not c and p is None and not e:continue
   p=p if p is not None else fnum(nv(r,'Nennleistung Ladeeinrichtung [kW]')) or 11.;k=kind(c,p,typ);key=(k,round(p,1),c);g=groups.setdefault(key,{'kind':k,'power':round(p,1),'connector':c,'evses':[]})
   if e:g['evses'].append(e);ev.append(e)
  declared=int(fnum(nv(r,'Anzahl Ladepunkte')) or 0)
  if not groups:
   cnt=declared or 1;p=fnum(nv(r,'Nennleistung Ladeeinrichtung [kW]')) or 11.;k=kind('',p,typ);groups[(k,round(p,1),'')]={'kind':k,'power':round(p,1),'connector':'','evses':[],'count':cnt}
  cfg=[]
  for i,g in enumerate(sorted(groups.values(),key=lambda x:(x['kind'],x['power'],x['connector']))):
   ids=sorted(set(g.get('evses',[])));cnt=len(ids) or g.get('count',1);cid=f'bnetza-{i}-{g["kind"].lower()}-{str(g["power"]).replace(".","_")}';label=f'BNetzA · {g["kind"]} {g["power"]:g} kW'+(f' · {g["connector"]}' if g['connector'] else '');cfg.append([cid,label,g['kind'],g['power'],cnt,[],ids])
  if len(cfg)==1 and declared>cfg[0][4]:cfg[0][4]=declared
  count=max(len(set(ev)),declared,sum(x[4] for x in cfg));evtot+=count;upd=nv(r,'Inbetriebnahmedatum') or now[:10];R.append([ID,name,address,round(lat,6),round(lon,6),op,count,0,cfg,upd,op]);C.append({'canonicalId':f'DE:national:{ID}','bnetzaId':ID,'bnetzaEvseIds':sorted(set(ev)),'aliases':[f'bnetza:{ID}'],'sourceIds':[],'operator':op,'rawOperator':rawop or None})
 R.sort(key=lambda x:x[0]);C.sort(key=lambda x:x['bnetzaId']);O=Path(out);shutil.rmtree(O,ignore_errors=True);O.mkdir(parents=True,exist_ok=True);tiles=defaultdict(list)
 for r in R:tiles[tile(r[3],r[4])].append(r)
 mt=[]
 for tid,it in sorted(tiles.items()):
  raw=json.dumps(it,separators=(',',':'),ensure_ascii=False).encode();gz=gzip.compress(raw,9);fn=f'{tid}.json.gz';(O/fn).write_bytes(gz);lat0=math.floor(it[0][3]/TILE)*TILE;lon0=math.floor(it[0][4]/TILE)*TILE;mt.append({'id':tid,'file':fn,'minLat':lat0,'maxLat':lat0+TILE,'minLon':lon0,'maxLon':lon0+TILE,'count':len(it),'bytes':len(gz),'sha256':hashlib.sha256(gz).hexdigest()})
 allraw=json.dumps(R,separators=(',',':'),ensure_ascii=False).encode();allgz=gzip.compress(allraw,9);(O/'all.json.gz').write_bytes(allgz);syn=sum(str(r[0]).startswith('AUTO-') for r in R);m={'schemaVersion':4,'dataset':'germany-bnetza-static-v9','country':'DE','generatedAt':now,'sourceUrl':u,'sourceAttribution':'Bundesnetzagentur.de (CC BY 4.0)','sourceRows':total,'stationCount':len(R),'evseCount':evtot,'skippedRows':skip,'syntheticIdCount':syn,'tileSizeDegrees':TILE,'tileCount':len(mt),'allFile':'all.json.gz','allBytes':len(allgz),'allSha256':hashlib.sha256(allgz).hexdigest(),'preIntegrationOnly':True,'tiles':mt};(O/'manifest.json').write_text(json.dumps(m,ensure_ascii=False,separators=(',',':'))+'\n');Path(cross).write_text(json.dumps({'schemaVersion':1,'country':'DE','generatedAt':now,'preIntegrationOnly':True,'entries':C},ensure_ascii=False,separators=(',',':'))+'\n');print(json.dumps({k:m[k] for k in ('sourceRows','stationCount','evseCount','skippedRows','syntheticIdCount','tileCount','allBytes')},indent=2))
def main():
 p=argparse.ArgumentParser();p.add_argument('--source');p.add_argument('--url',default=URL);p.add_argument('--out',default='build/germany-static');p.add_argument('--crosswalk',default='build/germany-crosswalk.json');p.add_argument('--aliases',default='data/v9/germany-operator-aliases.json');a=p.parse_args();src=Path(a.source) if a.source else dl(a.url);build(src,a.out,a.crosswalk,a.aliases,a.url)
if __name__=='__main__':main()
