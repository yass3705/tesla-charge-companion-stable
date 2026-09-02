#!/usr/bin/env python3
import argparse,json,urllib.request
from pathlib import Path
URL='https://tariff-locations-file-production.s3.eu-central-1.amazonaws.com/tariff-view.json'
UA='Tesla-Charge-Companion-V9-Qwello/1.0'
def money(v):
 if not v:return None
 return (10 ** int(v.get('power',0))) * float(v.get('significand',0))
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--out',default='build/germany-qwello-station-pricing.json');a=ap.parse_args()
 req=urllib.request.Request(URL,headers={'User-Agent':UA})
 with urllib.request.urlopen(req,timeout=90) as r:data=json.load(r)
 rows=[]
 for st in data:
  if st.get('country')!='DE':continue
  tariff=st.get('tariff') or {};version=tariff.get('version'); ids=st.get('id') or []
  chunks=[]
  if version=='V2':chunks=tariff.get('chunks') or []
  else:
   if tariff.get('day'):chunks.append(dict(tariff['day'],period='day'))
   if tariff.get('night'):chunks.append(dict(tariff['night'],period='night'))
  for evse in ids:
   entry={'operator':'Qwello','sourceProvider':'qwello_public_tariff_view','sourceUrl':URL,'evseId':evse,'currency':st.get('currency','EUR'),'location':st.get('location'),'city':st.get('city'),'tariffVersion':version,'gracePeriodMinutes':tariff.get('gracePeriodMinutes'),'chunks':[]}
   for c in chunks:
    x={'title':c.get('title'),'pricePerKwh':money(c.get('costPerKwh')),'pricePerMinute':money(c.get('costPerMinute')),'maxCostTime':money(c.get('maxCostTime'))}
    if c.get('time'):x['time']=c['time']
    if c.get('period'):x['period']=c['period']
    entry['chunks'].append({k:v for k,v in x.items() if v is not None})
   if entry['chunks']:rows.append(entry)
 out={'schemaVersion':1,'country':'DE','preIntegrationOnly':True,'scope':'evse','operator':'Qwello','sourceUrl':URL,'entryCount':len(rows),'entries':rows,'policy':'Exact Qwello-published EVSE tariff. Preserve time/minute components; never replace with a single operator-wide fallback.'}
 q=Path(a.out);q.parent.mkdir(parents=True,exist_ok=True);q.write_text(json.dumps(out,ensure_ascii=False,separators=(',',':'))+'\n')
 print(json.dumps({'entryCount':len(rows),'tariffVersions':sorted({x['tariffVersion'] for x in rows if x['tariffVersion']}),'sample':rows[:3]},ensure_ascii=False,indent=2))
if __name__=='__main__':main()
