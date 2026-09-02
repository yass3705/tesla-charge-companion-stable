#!/usr/bin/env python3
import argparse,csv,io,json,urllib.request
from pathlib import Path
URL='https://data.bundesnetzagentur.de/Bundesnetzagentur/DE/Fachthemen/ElektrizitaetundGas/E-Mobilitaet/Ladesaeulenregister_BNetzA_2026-07-28.csv'
SOURCE='https://de.mer.eco/news/glossar/ladestation/e-auto-laden-kosten/'
UA='Tesla-Charge-Companion-V9-Mer/1.0'

def fnum(v):
 try:return float(str(v or '').strip().replace(',','.'))
 except:return None

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

def tariff(kind,power):
 if kind=='AC' and power<=49:return 0.49,'AC<=49kW'
 if kind=='DC' and 50<=power<=75:return 0.57,'DC50-75kW'
 if kind=='DC' and 76<=power<=400:return 0.69,'HPC76-400kW'
 return None,None

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--out',default='build/germany-mer-station-pricing.json');a=ap.parse_args();rows=[];sites=0
 for r in reader():
  op=(r.get('Betreiber') or '').strip().lower()
  if 'mer germany' not in op:continue
  sites+=1;sid=(r.get('Ladeeinrichtungs-ID') or '').strip()
  for i in range(1,7):
   ev=(r.get(f'EVSE-ID{i}') or '').strip();p=fnum(r.get(f'Nennleistung Stecker{i}'));conn=(r.get(f'Steckertypen{i}') or '').lower()
   if not ev or p is None:continue
   kind='DC' if ('dc ' in conn or 'combo' in conn or 'chademo' in conn or p>49) else 'AC'
   price,tier=tariff(kind,p)
   if price is None:continue
   rows.append({'operator':'Mer','sourceProvider':'mer_official_connect_me','sourceUrl':SOURCE,'bnetzaId':sid,'evseId':ev,'connectorKind':kind,'powerKw':p,'currency':'EUR','pricePerKwh':price,'tariff':'Connect Me','powerTier':tier})
 out={'schemaVersion':1,'country':'DE','preIntegrationOnly':True,'scope':'evse','operator':'Mer','bnetzaSiteRows':sites,'entryCount':len(rows),'entries':rows,'policy':'Official Connect Me tariff mapped only when BNetzA EVSE power fits a published Mer power tier. Ad-hoc maximum prices are not emitted as exact station prices.'}
 q=Path(a.out);q.parent.mkdir(parents=True,exist_ok=True);q.write_text(json.dumps(out,ensure_ascii=False,separators=(',',':'))+'\n')
 print(json.dumps({'sites':sites,'entryCount':len(rows),'prices':sorted({x['pricePerKwh'] for x in rows}),'tiers':sorted({x['powerTier'] for x in rows})},indent=2))
if __name__=='__main__':main()
