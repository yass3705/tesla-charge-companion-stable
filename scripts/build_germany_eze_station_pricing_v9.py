#!/usr/bin/env python3
import argparse,csv,io,json,urllib.request
from pathlib import Path
URL='https://data.bundesnetzagentur.de/Bundesnetzagentur/DE/Fachthemen/ElektrizitaetundGas/E-Mobilitaet/Ladesaeulenregister_BNetzA_2026-07-28.csv'
SOURCE='https://app.eze.network/'
UA='Tesla-Charge-Companion-V9-EZE/1.0'

def reader():
 req=urllib.request.Request(URL,headers={'User-Agent':UA})
 with urllib.request.urlopen(req,timeout=180) as r:raw=r.read()
 text=None
 for enc in ('utf-8-sig','utf-8','cp1252','latin-1'):
  try:text=raw.decode(enc);break
  except UnicodeDecodeError:pass
 lines=text.splitlines(True);start=next((i for i,l in enumerate(lines[:100]) if l.lstrip('\ufeff').startswith('Ladeeinrichtungs-ID;Betreiber;')),None)
 if start is None:raise RuntimeError('BNetzA header not found')
 return csv.DictReader(io.StringIO(''.join(lines[start:])),delimiter=';',quotechar='"')

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--out',default='build/germany-eze-station-pricing.json');a=ap.parse_args();rows=[];sites=0
 for r in reader():
  op=(r.get('Betreiber') or '').strip().lower()
  if 'eze.network' not in op:continue
  sites+=1;sid=(r.get('Ladeeinrichtungs-ID') or '').strip()
  for i in range(1,7):
   ev=(r.get(f'EVSE-ID{i}') or '').strip()
   if not ev:continue
   rows.append({'operator':'eze.network','sourceProvider':'eze_official','sourceUrl':SOURCE,'bnetzaId':sid,'evseId':ev,'currency':'EUR','tariff':'public','chunks':[{'title':'Night start','pricePerKwh':0.38,'pricePerMinute':0.01,'time':{'start':1200,'end':240},'scope':'sessionStartWindow'},{'title':'Day start','pricePerKwh':0.38,'pricePerMinute':0.02,'time':{'start':240,'end':1200},'scope':'sessionStartWindow'}]})
 out={'schemaVersion':1,'country':'DE','preIntegrationOnly':True,'scope':'evse','operator':'eze.network','bnetzaSiteRows':sites,'entryCount':len(rows),'entries':rows,'policy':'Official eze.network tariff: 0.38 EUR/kWh plus time fee from session start. Start 20:00-04:00 = 0.60 EUR/h; 04:00-20:00 = 1.20 EUR/h. No operator-wide simplification to kWh-only.'}
 q=Path(a.out);q.parent.mkdir(parents=True,exist_ok=True);q.write_text(json.dumps(out,ensure_ascii=False,separators=(',',':'))+'\n')
 print(json.dumps({'sites':sites,'entryCount':len(rows),'kwh':0.38,'minuteFees':[0.01,0.02]},indent=2))
if __name__=='__main__':main()
