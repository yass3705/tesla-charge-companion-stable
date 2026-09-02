#!/usr/bin/env python3
import argparse,csv,html,io,json,re,time,unicodedata,urllib.parse,urllib.request
from pathlib import Path
URL='https://data.bundesnetzagentur.de/Bundesnetzagentur/DE/Fachthemen/ElektrizitaetundGas/E-Mobilitaet/Ladesaeulenregister_BNetzA_2026-07-28.csv'
UA='Tesla-Charge-Companion-V9-Wirelane/1.0'

def fetch(url,timeout=90):
 req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept-Language':'de-DE,de;q=0.9'})
 with urllib.request.urlopen(req,timeout=timeout) as r:return r.read().decode('utf-8','replace')
def bnetza_rows():
 text=fetch(URL,180);lines=text.splitlines(True);start=None
 for i,line in enumerate(lines[:100]):
  if line.lstrip('\ufeff').startswith('Ladeeinrichtungs-ID;Betreiber;'):start=i;break
 if start is None:raise RuntimeError('BNetzA header not found')
 return csv.DictReader(io.StringIO(''.join(lines[start:])),delimiter=';',quotechar='"')
def parse_price(body):
 s=html.unescape(re.sub(r'<[^>]+>',' ',body));s=re.sub(r'\s+',' ',s)
 m=re.search(r'(?i)([0-9]+(?:[\.,][0-9]+)?)\s*(?:€|EUR)\s*/\s*kWh',s)
 if not m:
  m=re.search(r'(?i)([0-9]+(?:[\.,][0-9]+)?)\s*ct\s*/\s*kWh',s)
  if m:return float(m.group(1).replace(',','.'))/100,s
 return (float(m.group(1).replace(',','.')) if m else None),s
def parse_extra(s):
 out={}
 m=re.search(r'(?i)([0-9]+(?:[\.,][0-9]+)?)\s*(?:€|EUR)\s*(?:Startgebühr|starting fee)',s)
 if m:out['sessionFee']=float(m.group(1).replace(',','.'))
 m=re.search(r'(?i)([0-9]+(?:[\.,][0-9]+)?)\s*(?:€|EUR|ct)\s*/\s*Min[^0-9]{0,30}ab\s*([0-9]+)\s*Min',s)
 if m:
  v=float(m.group(1).replace(',','.'));frag=m.group(0).lower()
  if 'ct' in frag:v/=100
  out['blockingFee']={'afterMinutes':int(m.group(2)),'pricePerMinute':v,'currency':'EUR'}
  cap=re.search(r'(?i)max\.\s*([0-9]+(?:[\.,][0-9]+)?)\s*€',s)
  if cap:out['blockingFee']['maxFee']=float(cap.group(1).replace(',','.'))
  if re.search(r'(?i)außer\s+zwischen\s+20\s*[-–]\s*8\s*Uhr',s):out['blockingFee']['inactiveWindow']={'start':'20:00','end':'08:00'}
 return out
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--out',default='build/germany-wirelane-station-pricing.json');ap.add_argument('--limit',type=int,default=0);ap.add_argument('--sleep',type=float,default=.05);a=ap.parse_args()
 ids=[]
 for row in bnetza_rows():
  op=(row.get('Betreiber') or '')
  if 'wirelane' not in op.lower():continue
  for i in range(1,7):
   ev=(row.get(f'EVSE-ID{i}') or '').strip()
   if ev.upper().startswith('DE*WLN*'):ids.append(ev)
 ids=sorted(set(ids)); ids=ids[:a.limit] if a.limit else ids
 rows=[];failed=[]
 for ev in ids:
  url='https://direct.wirelane.com/'+urllib.parse.quote(ev,safe='')+'?_locale=de'
  try:
   body=fetch(url,30);price,text=parse_price(body)
   if price is None:failed.append({'evseId':ev,'reason':'no_price','url':url});continue
   kind='DC' if re.search(r'(?i)\bDC\b|CCS',text) else 'AC'
   p=re.search(r'(?i)max\.\s*([0-9]+(?:[\.,][0-9]+)?)\s*kW',text)
   e={'operator':'Wirelane','sourceProvider':'wirelane_direct','sourceUrl':url,'evseId':ev,'connectorKind':kind,'currency':'EUR','pricePerKwh':price}
   if p:e['powerKw']=float(p.group(1).replace(',','.'))
   e.update(parse_extra(text));rows.append(e)
  except Exception as ex:failed.append({'evseId':ev,'reason':repr(ex),'url':url})
  if a.sleep:time.sleep(a.sleep)
 out={'schemaVersion':1,'country':'DE','preIntegrationOnly':True,'scope':'evse','operator':'Wirelane','entryCount':len(rows),'sourceEvseCount':len(ids),'failedCount':len(failed),'entries':rows,'failed':failed,'policy':'Exact public Wirelane direct-payment tariff per EVSE only; never infer an operator-wide fallback.'}
 q=Path(a.out);q.parent.mkdir(parents=True,exist_ok=True);q.write_text(json.dumps(out,ensure_ascii=False,separators=(',',':'))+'\n')
 print(json.dumps({'sourceEvseCount':len(ids),'entryCount':len(rows),'failedCount':len(failed),'prices':sorted(set(x['pricePerKwh'] for x in rows))},indent=2))
if __name__=='__main__':main()
