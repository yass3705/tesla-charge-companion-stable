#!/usr/bin/env python3
import argparse,csv,gzip,hashlib,json,math,re,shutil,tempfile,unicodedata,urllib.request
from collections import defaultdict
from datetime import datetime,timezone
from pathlib import Path
URL='https://data.bundesnetzagentur.de/Bundesnetzagentur/DE/Fachthemen/ElektrizitaetundGas/E-Mobilitaet/Ladesaeulenregister_BNetzA_2026-07-28.csv'; TILE=.5
def t(v): return str(v or '').strip()
def n(v):
 s=unicodedata.normalize('NFKD',t(v));s=''.join(c for c in s if not unicodedata.combining(c)).lower();return re.sub(r'[^a-z0-9]+','_',s).strip('_')
def fnum(v):
 try:return float(t(v).replace(' ','').replace(',','.'))
 except:return None
def val(r,*names):
 d={n(k):v for k,v in r.items() if k is not None}
 for x in names:
  q=n(x);v=d.get(q)
  if t(v):return t(v)
  for k,v in d.items():
   if (k.startswith(q+'_') or q.startswith(k+'_')) and t(v):return t(v)
 return ''
def aliases(p):
 d=json.loads(Path(p).read_text());o={}
 for x in d.get('operators',[]):
  for a in x.get('aliases',[]):o[n(a)]=x.get('canonical') or a
 return o
def dl(u):
 q=tempfile.NamedTemporaryFile(delete=False,suffix='.csv');q.close();req=urllib.request.Request(u,headers={'User-Agent':'TCC-V9-DE/1.2'})
 with urllib.request.urlopen(req,timeout=180) as r,open(q.name,'wb') as w:shutil.copyfileobj(r,w)
 return Path(q.name)
def reader(p):
 raw=Path(p).read_bytes();text=None
 for e in ('utf-8-sig','utf-8','cp1252','latin-1'):
  try:text=raw.decode(e);break
  except UnicodeDecodeError:pass
 lines=text.splitlines();start=0
 for i,line in enumerate(lines[:50]):
  z=n(line)
  if 'breitengrad' in z and ('langengrad' in z or 'laengengrad' in z):start=i;break
 text='\n'.join(lines[start:])
 import io
 try:d=csv.Sniffer().sniff(text[:65536],delimiters=';,\t|')
 except csv.Error:d=csv.excel;d.delimiter=';'
 return csv.DictReader(io.StringIO(text),dialect=d)
def sid(r,lat,lon,i):
 x=val(r,'Ladeeinrichtungs-ID','Standort-ID')
 if x:return x
 material='|'.join([val(r,'Betreiber'),val(r,'Straße','Strasse'),val(r,'Hausnummer'),val(r,'Postleitzahl'),val(r,'Ort'),f'{lat:.7f}',f'{lon:.7f}'])
 return 'AUTO-'+hashlib.sha1((material or str(i)).encode()).hexdigest()[:20]
def kind(c,p,typ):
 s=n(c+' '+typ)
 if any(x in s for x in ('combo','ccs','chademo','schnelllade')):return 'DC'
 if any(x in s for x in ('typ_2','type_2','schuko','cee','normallade')):return 'AC'
 return 'DC' if (p or 0)>43 else 'AC'
def tile(lat,lon):
 a=math.floor(lat/TILE)*TILE;b=math.floor(lon/TILE)*TILE;fmt=lambda x:str(round(x*2)).replace('-','m');return f't_{fmt(a)}_{fmt(b)}'
def build(src,out,cross,alias_path,u):
 A=aliases(alias_path);R=[];C=[];total=skip=evtot=0;now=datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
 rr=reader(src);headers=rr.fieldnames or [];print(json.dumps({'headers':headers[:80]},ensure_ascii=False))
 for r in rr:
  total+=1;lat=fnum(val(r,'Breitengrad','Breitengrad WGS84'));lon=fnum(val(r,'Längengrad','Langengrad','Längengrad WGS84','Langengrad WGS84'))
  if lat is None or lon is None or not(46<=lat<=56 and 4<=lon<=16):skip+=1;continue
  ident=sid(r,lat,lon,total);rawop=val(r,'Betreiber');op=A.get(n(rawop),rawop or 'Autre');typ=val(r,'Art der Ladeeinrichtung','Art der Ladeeinrichung')
  street=' '.join(x for x in [val(r,'Straße','Strasse'),val(r,'Hausnummer')] if x);addr=', '.join(x for x in [street,val(r,'Adresszusatz'),val(r,'Postleitzahl'),val(r,'Ort'),val(r,'Bundesland')] if x)
  groups={};evses=[]
  for i in range(1,7):
   c=val(r,f'Steckertypen{i}',f'Steckertypen {i}');p=fnum(val(r,f'P{i} [kW]',f'P{i}[kW]',f'Nennleistung Stecker{i} [kW]'));e=val(r,f'EVSE-ID{i}',f'EVSE ID{i}')
   if not c and p is None and not e:continue
   p=p if p is not None else fnum(val(r,'Anschlussleistung','Anschlussleistung [kW]','Nennleistung Ladeeinrichtung [kW]')) or 11.;k=kind(c,p,typ);g=groups.setdefault((k,round(p,1),c),{'k':k,'p':round(p,1),'c':c,'ids':[],'count':0});g['count']+=1
   if e:g['ids'].append(e);evses.append(e)
  declared=int(fnum(val(r,'Anzahl Ladepunkte')) or 0)
  if not groups:
   p=fnum(val(r,'Anschlussleistung','Anschlussleistung [kW]')) or 11.;k=kind('',p,typ);groups[(k,round(p,1),'')]={'k':k,'p':round(p,1),'c':'','ids':[],'count':declared or 1}
  cfg=[]
  for j,g in enumerate(sorted(groups.values(),key=lambda z:(z['k'],z['p'],z['c']))):
   ids=sorted(set(g['ids']));cnt=len(ids) or g['count'];cfg.append([f'bnetza-{j}-{g["k"].lower()}-{str(g["p"]).replace(".","_")}',f'BNetzA · {g["k"]} {g["p"]:g} kW'+(f' · {g["c"]}' if g['c'] else ''),g['k'],g['p'],cnt,[],ids])
  cnt=len(set(evses)) or declared or sum(x[4] for x in cfg);evtot+=cnt;name=val(r,'Anzeigename (Karte)','Standortbezeichnung') or rawop or f'Ladeeinrichtung {ident}'
  R.append([ident,name,addr,round(lat,6),round(lon,6),op,cnt,0,cfg,val(r,'Inbetriebnahmedatum') or now[:10],op]);C.append({'canonicalId':f'DE:national:{ident}','bnetzaId':ident,'bnetzaEvseIds':sorted(set(evses)),'aliases':[f'bnetza:{ident}'],'operator':op,'rawOperator':rawop or None,'syntheticId':ident.startswith('AUTO-')})
 R.sort(key=lambda x:x[0]);out=Path(out);shutil.rmtree(out,ignore_errors=True);out.mkdir(parents=True);tiles=defaultdict(list)
 for r in R:tiles[tile(r[3],r[4])].append(r)
 mt=[]
 for q,items in sorted(tiles.items()):
  raw=json.dumps(items,separators=(',',':'),ensure_ascii=False).encode();gz=gzip.compress(raw,9);fn=q+'.json.gz';(out/fn).write_bytes(gz);a=math.floor(items[0][3]/TILE)*TILE;b=math.floor(items[0][4]/TILE)*TILE;mt.append({'id':q,'file':fn,'minLat':a,'maxLat':a+TILE,'minLon':b,'maxLon':b+TILE,'count':len(items),'bytes':len(gz),'sha256':hashlib.sha256(gz).hexdigest()})
 raw=json.dumps(R,separators=(',',':'),ensure_ascii=False).encode();gz=gzip.compress(raw,9);(out/'all.json.gz').write_bytes(gz);m={'schemaVersion':2,'dataset':'germany-bnetza-static-v9','country':'DE','generatedAt':now,'sourceUrl':u,'sourceAttribution':'Bundesnetzagentur.de (CC BY 4.0)','sourceRows':total,'stationCount':len(R),'evseCount':evtot,'skippedRows':skip,'syntheticIdCount':sum(x['syntheticId'] for x in C),'tileSizeDegrees':TILE,'tileCount':len(mt),'allFile':'all.json.gz','allBytes':len(gz),'allSha256':hashlib.sha256(gz).hexdigest(),'preIntegrationOnly':True,'tiles':mt};(out/'manifest.json').write_text(json.dumps(m,separators=(',',':'),ensure_ascii=False)+'\n');Path(cross).write_text(json.dumps({'schemaVersion':1,'country':'DE','generatedAt':now,'preIntegrationOnly':True,'entries':C},separators=(',',':'),ensure_ascii=False)+'\n');print(json.dumps({k:m[k] for k in ('sourceRows','stationCount','evseCount','skippedRows','syntheticIdCount','tileCount','allBytes')},indent=2))
def main():
 a=argparse.ArgumentParser();a.add_argument('--input');a.add_argument('--url',default=URL);a.add_argument('--out',default='data/v9/germany-static');a.add_argument('--crosswalk',default='data/v9/germany-crosswalk.json');a.add_argument('--aliases',default='data/v9/germany-operator-aliases.json');x=a.parse_args();tmp=None
 try:src=Path(x.input) if x.input else dl(x.url);tmp=None if x.input else src;build(src,x.out,x.crosswalk,x.aliases,x.url)
 finally:
  if tmp:tmp.unlink(missing_ok=True)
if __name__=='__main__':main()
