#!/usr/bin/env python3
import argparse,json,re,time,urllib.request,urllib.error
from pathlib import Path

PRICE_RE=re.compile(r'(?i)(?:€|EUR)\s*([0-9]+[\.,][0-9]{1,4})|([0-9]+[\.,][0-9]{1,4})\s*(?:€|EUR)')
EVNUM_RE=re.compile(r'EV(\d{7})',re.I)
UA='Mozilla/5.0 TeslaChargeCompanion/9 PluqPriceCollector'

def fetch_price(num):
 url=f'https://chargestation.road.io/evse/{num}'
 req=urllib.request.Request(url,headers={'User-Agent':UA})
 with urllib.request.urlopen(req,timeout=20) as r:
  body=r.read().decode('utf-8','replace')
  vals=sorted({(a or b).replace(',','.') for a,b in PRICE_RE.findall(body)})
  vals=[float(v) for v in vals if 0<float(v)<5]
  if not vals:return url,None
  # ROAD page should expose one current ad-hoc energy tariff for these Pluq AC points.
  return url,vals[0] if len(set(vals))==1 else None

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--crosswalk',default='data/v9/germany-crosswalk.json');ap.add_argument('--out',default='build/germany-pluq-station-pricing.json');ap.add_argument('--sleep',type=float,default=.15);a=ap.parse_args()
 d=json.loads(Path(a.crosswalk).read_text()); groups={}
 for e in d.get('entries',[]):
  if e.get('operator')!='Pluq':continue
  for evse in e.get('bnetzaEvseIds',[]):
   m=EVNUM_RE.search(evse)
   if m:groups.setdefault(m.group(1),[]).append({'evseId':evse,'bnetzaId':e.get('bnetzaId'),'canonicalId':e.get('canonicalId')})
 out=[];errors=[]
 for i,(num,refs) in enumerate(sorted(groups.items())):
  try:
   url,price=fetch_price(num)
   if price is None:errors.append({'stationId':num,'reason':'no_single_price','sourceUrl':url});continue
   for ref in refs:out.append({**ref,'operator':'Pluq','connectorKind':'AC','currency':'EUR','pricePerKwh':price,'sourceProvider':'ROAD','sourceUrl':url})
  except Exception as ex:errors.append({'stationId':num,'reason':type(ex).__name__,'detail':str(ex)[:160]})
  if a.sleep:time.sleep(a.sleep)
 payload={'schemaVersion':1,'country':'DE','preIntegrationOnly':True,'scope':'evse','operator':'Pluq','entryCount':len(out),'uniqueStationIds':len(groups),'pricedStationIds':len({x['sourceUrl'] for x in out}),'entries':sorted(out,key=lambda x:x['evseId']),'errors':errors,'policy':'Exact Pluq/ROAD ad-hoc price only. No operator-wide fallback; unpriced EVSEs remain visible but unranked.'}
 q=Path(a.out);q.parent.mkdir(parents=True,exist_ok=True);q.write_text(json.dumps(payload,separators=(',',':'),ensure_ascii=False)+'\n')
 print(json.dumps({'uniqueStationIds':payload['uniqueStationIds'],'pricedStationIds':payload['pricedStationIds'],'entryCount':payload['entryCount'],'errors':len(errors),'prices':sorted({x['pricePerKwh'] for x in out})},indent=2))

if __name__=='__main__':main()
