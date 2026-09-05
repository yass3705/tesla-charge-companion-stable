#!/usr/bin/env python3
import csv,glob,io,json,re,unicodedata,urllib.request
from collections import Counter,defaultdict
from pathlib import Path
URL='https://data.bundesnetzagentur.de/Bundesnetzagentur/DE/Fachthemen/ElektrizitaetundGas/E-Mobilitaet/Ladesaeulenregister_BNetzA_2026-09-01.csv'

def norm(v):
 s=unicodedata.normalize('NFKD',str(v or '').strip());s=''.join(c for c in s if not unicodedata.combining(c)).lower()
 return re.sub(r'[^a-z0-9]+','_',s).strip('_')

def load_json(p): return json.loads(Path(p).read_text(encoding='utf-8'))

def aliases():
 m={};canon=set()
 for p in ['data/v9/germany-operator-aliases.json','data/v9/germany-operator-aliases-extension.json']:
  if not Path(p).exists(): continue
  for item in load_json(p).get('operators',[]):
   c=item.get('canonical','').strip()
   if not c: continue
   canon.add(c);m[norm(c)]=c
   for a in item.get('aliases',[]): m[norm(a)]=c
 return m,canon

def treated(alias_map):
 names=set()
 for p in glob.glob('data/v9/germany-direct-offers*.json'):
  try:d=load_json(p)
  except:continue
  for o in d.get('directOffers',[]):
   for n in o.get('operatorAliases',[]): names.add(alias_map.get(norm(n),n))
   for n in o.get('networkAliases',[]): names.add(alias_map.get(norm(n),n))
 for p in glob.glob('data/v9/germany-station-pricing*.json'):
  try:d=load_json(p)
  except:continue
  for e in d.get('entries',[]):
   n=e.get('operator')
   if n:names.add(alias_map.get(norm(n),n))
 collectors=Path('data/v9/germany-station-pricing-collectors.json')
 if collectors.exists():
  for c in load_json(collectors).get('collectors',[]):
   if c.get('status')=='active_validated' and c.get('operator'):
    n=c['operator'];names.add(alias_map.get(norm(n),n))
 for p in glob.glob('data/v9/germany-cpo-deferred-pricing*.json'):
  try:d=load_json(p)
  except:continue
  for e in d.get('cpos',[]):
   n=e.get('operator')
   if n:names.add(alias_map.get(norm(n),n))
 return {norm(x) for x in names if x}

def fetch_rows():
 req=urllib.request.Request(URL,headers={'User-Agent':'TCC-V9-DE-cpo-audit/1.0'})
 with urllib.request.urlopen(req,timeout=180) as r: raw=r.read()
 text=None
 for enc in ('utf-8-sig','utf-8','cp1252','latin-1'):
  try:text=raw.decode(enc);break
  except UnicodeDecodeError:pass
 lines=text.splitlines(True);start=None
 for i,line in enumerate(lines[:100]):
  if line.lstrip('\ufeff').startswith('Ladeeinrichtungs-ID;Betreiber;'):start=i;break
 if start is None:raise RuntimeError('BNetzA header not found')
 return csv.DictReader(io.StringIO(''.join(lines[start:])),delimiter=';',quotechar='"')

def evse_prefix(v):
 s=(v or '').strip().upper().replace(' ','')
 m=re.match(r'([A-Z]{2})\*?([A-Z0-9]{3})\*?E',s)
 return f'{m.group(1)}*{m.group(2)}' if m else None

def main():
 amap,_=aliases();done=treated(amap);counts=Counter();prefixes=defaultdict(Counter);samples=defaultdict(list)
 for row in fetch_rows():
  raw=(row.get('Betreiber') or '').strip()
  if not raw:continue
  c=amap.get(norm(raw),raw)
  if norm(c)=='tesla':continue
  counts[c]+=1
  for i in range(1,7):
   ev=(row.get(f'EVSE-ID{i}') or row.get(f'EVSE ID{i}') or '').strip()
   if not ev:continue
   p=evse_prefix(ev)
   if p:prefixes[c][p]+=1
   if len(samples[c])<4 and ev not in samples[c]:samples[c].append(ev)
 total=len(counts);treated_ops=[x for x in counts if norm(x) in done];untreated=[(x,n) for x,n in counts.most_common() if norm(x) not in done]
 top=[]
 for x,n in untreated[:100]:
  top.append({'operator':x,'siteRows':n,'evsePrefixes':[{'prefix':p,'points':m} for p,m in prefixes[x].most_common(5)],'sampleEvseIds':samples[x]})
 report={'totalCpoCount':total,'treatedCpoCount':len(treated_ops),'remainingCpoCount':total-len(treated_ops),'treatedShare':round(len(treated_ops)/total,6) if total else 0,'topUntreated':top}
 print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
