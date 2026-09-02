#!/usr/bin/env python3
import argparse,csv,io,json,urllib.request
from pathlib import Path
URL='https://data.bundesnetzagentur.de/Bundesnetzagentur/DE/Fachthemen/ElektrizitaetundGas/E-Mobilitaet/Ladesaeulenregister_BNetzA_2026-07-28.csv'
SOURCE='https://www.e-ladestation.aldi-sued.de/how-to'
UA='Tesla-Charge-Companion-V9-ALDI-SUED/1.0'

def num(v):
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
def station_price(power):
 if power is None:return None,None
 if power<=22:return .29,'normal<=22kW'
 if power<=50:return .44,'fast<=50kW'
 if power>=150:return .47,'ultrafast>=150kW'
 return None,None
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--out',default='build/germany-aldi-sued-station-pricing.json');a=ap.parse_args();rows=[];unknown=[];sites=0
 for r in reader():
  op=(r.get('Betreiber') or '').lower()
  if 'aldi süd' not in op and 'aldi sued' not in op:continue
  sites+=1;sid=(r.get('Ladeeinrichtungs-ID') or '').strip();sp=num(r.get('Nennleistung Ladeeinrichtung [kW]'));price,tier=station_price(sp)
  evses=[]
  for i in range(1,7):
   ev=(r.get(f'EVSE-ID{i}') or '').strip()
   if ev:evses.append((ev,num(r.get(f'Nennleistung Stecker{i}')),r.get(f'Steckertypen{i}')))
  if price is None:
   unknown.append({'bnetzaId':sid,'stationPowerKw':sp,'evseIds':[e[0] for e in evses]});continue
  for ev,p,conn in evses:
   rows.append({'operator':'ALDI SÜD','sourceProvider':'aldi_sued_official','sourceUrl':SOURCE,'bnetzaId':sid,'evseId':ev,'stationPowerKw':sp,'connectorPowerKw':p,'connector':conn,'currency':'EUR','pricePerKwh':price,'stationClass':tier})
 out={'schemaVersion':1,'country':'DE','preIntegrationOnly':True,'scope':'evse','operator':'ALDI SÜD','bnetzaSiteRows':sites,'entryCount':len(rows),'entries':rows,'unpricedStations':unknown,'policy':'ALDI SÜD prices are assigned by station rated-power class, not connector type. <=22 kW 0.29 EUR/kWh; <=50 kW 0.44; >=150 kW 0.47. Undocumented intermediate classes remain unpriced.'}
 q=Path(a.out);q.parent.mkdir(parents=True,exist_ok=True);q.write_text(json.dumps(out,ensure_ascii=False,separators=(',',':'))+'\n')
 print(json.dumps({'sites':sites,'entryCount':len(rows),'unpricedStations':len(unknown),'prices':sorted({x['pricePerKwh'] for x in rows})},indent=2))
if __name__=='__main__':main()
