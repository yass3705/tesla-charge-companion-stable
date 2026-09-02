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

def treatment_index(amap):
 direct=set();station=set();collectors=set();deferred={}
 for p in glob.glob('data/v9/germany-direct-offers*.json'):
  try:d=load(p)
  except:continue
  for o in d.get('directOffers',[]):
   for k in ('operatorAliases','networkAliases'):
    for n in o.get(k,[]):direct.add(norm(amap.get(norm(n),n)))
 for p in glob.glob('data/v9/germany-station-pricing*.json'):
  try:d=load(p)
  except:continue
  default_op=d.get('operator')
  for e in d.get('entries',[]):
   op=e.get('operator') or default_op
   if op:station.add(norm(amap.get(norm(op),op)))
 p=Path('data/v9/germany-station-pricing-collectors.json')
 if p.exists():
  for c in load(p).get('collectors',[]):
   if c.get('status')=='active_validated' and c.get('operator'):
    op=amap.get(norm(c['operator']),c['operator']);collectors.add(norm(op))
 p=Path('data/v9/germany-cpo-deferred-pricing.json')
 if p.exists():
  for c in load(p).get('cpos',[]):
   if c.get('operator'):
    op=amap.get(norm(c['operator']),c['operator']);deferred[norm(op)]=c.get('status','')
 done=direct|station|collectors|set(deferred)
 return {'done':done,'direct':direct,'station':station,'collectors':collectors,'deferred':deferred}

def classify(opn,idx):
 status=idx['deferred'].get(opn,'')
 if status:
  if status.startswith('blocked_'):return 'blocked'
  if any(t in status for t in ('in_progress','partial','deferred','app_only')):return 'partial'
  if status.startswith('direct_dc_resolved') or status.startswith('direct_ac_resolved'):return 'partial'
  return 'complete'
 if opn in idx['collectors']:return 'complete'
 if opn in idx['station'] and opn not in idx['direct']:return 'partial'
 if opn in idx['direct']:return 'complete'
 if opn in idx['station']:return 'partial'
 return None

def reader():
 req=urllib.request.Request(URL,headers={'User-Agent':'TCC-V9-DE-EVSE-CPO-audit/1.1'})
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
 amap=alias_map();idx=treatment_index(amap);owners=defaultdict(Counter);points=Counter();no_prefix=Counter()
 for r in reader():
  raw=(r.get('Betreiber') or '').strip();op=amap.get(norm(raw),raw)
  if norm(op)=='tesla':continue
  found=False
  for i in range(1,7):
   ev=(r.get(f'EVSE-ID{i}') or '').strip();p=prefix(ev)
   if not p:continue
   found=True;points[p]+=1;owners[p][op]+=1
  if not found and raw:no_prefix[op]+=1
 rows=[];treated_count=0;classes=Counter();treated_rows=[]
 for p,n in points.most_common():
  dominant,domn=owners[p].most_common(1)[0];canonical=amap.get(norm(dominant),dominant);opn=norm(canonical);is_done=opn in idx['done'];cls=classify(opn,idx) if is_done else None
  if is_done:
   treated_count+=1;classes[cls or 'partial']+=1;treated_rows.append({'evsePrefix':p,'dominantOperator':canonical,'classification':cls or 'partial','points':n})
  rows.append({'evsePrefix':p,'points':n,'dominantOperator':canonical,'dominantShare':round(domn/n,4),'treated':is_done,'classification':cls,'topOwners':owners[p].most_common(5)})
 total=len(rows);untreated=[x for x in rows if not x['treated']]
 out={'schemaVersion':2,'country':'DE','method':'unique EVSE party prefix','totalCpoCount':total,'treatedCpoCount':treated_count,'remainingCpoCount':total-treated_count,'treatedShare':round(treated_count/total,4) if total else 0,'classificationCounts':{'complete':classes['complete'],'partial':classes['partial'],'blocked':classes['blocked']},'treatedCpos':treated_rows,'topUntreated':untreated[:100],'ownerLabelsWithoutRecognizableEvsePrefix':len(no_prefix),'topOwnerLabelsWithoutPrefix':no_prefix.most_common(50),'note':'EVSE prefixes are the primary CPO identity counter. Classification is derived from explicit V9 source status: validated direct offers/collectors are complete; exact station seeds and explicit in-progress/deferred scopes are partial; explicit blocked_* records are blocked. Owner labels without a recognizable EVSE prefix are tracked separately and are not automatically counted as distinct CPOs.'}
 print(json.dumps(out,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
