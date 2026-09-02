#!/usr/bin/env python3
import csv,glob,io,json,re,unicodedata,urllib.request
from collections import Counter,defaultdict
from pathlib import Path
URL='https://data.bundesnetzagentur.de/Bundesnetzagentur/DE/Fachthemen/ElektrizitaetundGas/E-Mobilitaet/Ladesaeulenregister_BNetzA_2026-07-28.csv'

def norm(v):
 s=unicodedata.normalize('NFKD',str(v or '').strip());s=''.join(c for c in s if not unicodedata.combining(c)).lower();return re.sub(r'[^a-z0-9]+','_',s).strip('_')
def load(p): return json.loads(Path(p).read_text(encoding='utf-8'))
def alias_map():
 m={}
 for p in ('data/v9/germany-operator-aliases.json','data/v9/germany-operator-aliases-extension.json'):
  if not Path(p).exists():continue
  for x in load(p).get('operators',[]):
   c=x.get('canonical')
   if not c:continue
   m[norm(c)]=c
   for a in x.get('aliases',[]):m[norm(a)]=c
 return m
def treated(amap):
 names=set()
 for p in glob.glob('data/v9/germany-direct-offers*.json'):
  try:d=load(p)
  except:continue
  for o in d.get('directOffers',[]):
   for k in ('operatorAliases','networkAliases'):
    for n in o.get(k,[]):names.add(amap.get(norm(n),n))
 for p in glob.glob('data/v9/germany-station-pricing*.json'):
  try:d=load(p)
  except:continue
  for e in d.get('entries',[]):
   if e.get('operator'):names.add(amap.get(norm(e['operator']),e['operator']))
 p=Path('data/v9/germany-station-pricing-collectors.json')
 if p.exists():
  for c in load(p).get('collectors',[]):
   if c.get('status')=='active_validated' and c.get('operator'):names.add(amap.get(norm(c['operator']),c['operator']))
 p=Path('data/v9/germany-cpo-deferred-pricing.json')
 if p.exists():
  for c in load(p).get('cpos',[]):
   if c.get('operator'):names.add(amap.get(norm(c['operator']),c['operator']))
 return {norm(x) for x in names}
def reader():
 req=urllib.request.Request(URL,headers={'User-Agent':'TCC-V9-DE-EVSE-CPO-audit/1.0'})
 with urllib.request.urlopen(req,timeout=180) as r:raw=r.read()
 text=None
 for enc in ('utf-8-sig','utf-8','cp1252','latin-1'):
  try:text=raw.decode(enc);break
  except UnicodeDecodeError:pass
 lines=text.splitlines(True);start=next((i for i,l in enumerate(lines[:100]) if l.lstrip('\ufeff').startswith('Ladeeinrichtungs-ID;Betreiber;')),None)
 if start is None:raise RuntimeError('header not found')
 return csv.DictReader(io.StringIO(''.join(lines[start:])),delimiter=';',quotechar='"')
def prefix(ev):
 s=re.sub(r'[\s\-]','',str(ev or '').upper())
 m=re.match(r'([A-Z]{2})\*?([A-Z0-9]{3})\*?E',s)
 return f'{m.group(1)}*{m.group(2)}' if m else None

def main():
 amap=alias_map();done=treated(amap);owners=defaultdict(Counter);points=Counter();no_prefix=Counter()
 for r in reader():
  raw=(r.get('Betreiber') or '').strip();op=amap.get(norm(raw),raw)
  if norm(op)=='tesla':continue
  found=False
  for i in range(1,7):
   ev=(r.get(f'EVSE-ID{i}') or '').strip();p=prefix(ev)
   if not p:continue
   found=True;points[p]+=1;owners[p][op]+=1
  if not found and raw:no_prefix[op]+=1
 rows=[];treated_count=0
 for p,n in points.most_common():
  dominant,domn=owners[p].most_common(1)[0];canonical=amap.get(norm(dominant),dominant);is_done=norm(canonical) in done
  if is_done:treated_count+=1
  rows.append({'evsePrefix':p,'points':n,'dominantOperator':canonical,'dominantShare':round(domn/n,4),'treated':is_done,'topOwners':owners[p].most_common(5)})
 total=len(rows);untreated=[x for x in rows if not x['treated']]
 out={'schemaVersion':1,'country':'DE','method':'unique EVSE party prefix','totalCpoCount':total,'treatedCpoCount':treated_count,'remainingCpoCount':total-treated_count,'treatedShare':round(treated_count/total,4) if total else 0,'topUntreated':untreated[:100],'ownerLabelsWithoutRecognizableEvsePrefix':len(no_prefix),'topOwnerLabelsWithoutPrefix':no_prefix.most_common(50),'note':'EVSE prefixes are the primary CPO identity counter. Owner labels without a recognizable EVSE prefix are tracked separately and are not automatically counted as distinct CPOs.'}
 print(json.dumps(out,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
