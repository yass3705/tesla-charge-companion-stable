#!/usr/bin/env python3
import argparse,json,re
from pathlib import Path
EVSE_RE=re.compile(r'^DE\*[A-Z0-9]{3}\*E[A-Z0-9*._-]+$')
DEFAULT_SEEDS=['data/v9/germany-station-pricing-seed.json','data/v9/germany-station-pricing-seed-extension-2.json']

def main():
 p=argparse.ArgumentParser();p.add_argument('--seeds',nargs='*',default=DEFAULT_SEEDS);p.add_argument('--out',default='build/germany-station-pricing.json');a=p.parse_args()
 rows=[];seen=set()
 for seed in a.seeds:
  d=json.loads(Path(seed).read_text());assert d.get('country')=='DE'
  for e in d.get('entries',[]):
   evse=e.get('evseId','').strip();assert EVSE_RE.match(evse),evse;assert evse not in seen,evse;seen.add(evse)
   price=e.get('pricePerKwh');assert isinstance(price,(int,float)) and 0<price<5,e
   assert e.get('currency')=='EUR';assert e.get('connectorKind') in ('AC','DC');assert e.get('sourceUrl','').startswith('https://')
   rows.append(dict(e))
 rows.sort(key=lambda x:x['evseId'])
 out={'schemaVersion':1,'country':'DE','preIntegrationOnly':True,'scope':'evse','entryCount':len(rows),'generatedFrom':a.seeds,'entries':rows,'precedence':'EVSE-specific price overrides operator-wide direct offer for the same connector only.'}
 q=Path(a.out);q.parent.mkdir(parents=True,exist_ok=True);q.write_text(json.dumps(out,separators=(',',':'),ensure_ascii=False)+'\n')
 print(json.dumps({'entryCount':len(rows),'operators':sorted({x['operator'] for x in rows}),'ac':sum(x['connectorKind']=='AC' for x in rows),'dc':sum(x['connectorKind']=='DC' for x in rows)},indent=2,ensure_ascii=False))
if __name__=='__main__':main()
