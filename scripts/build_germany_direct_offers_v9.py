#!/usr/bin/env python3
import argparse,json
from pathlib import Path

def load(p): return json.loads(Path(p).read_text())

def main():
 a=argparse.ArgumentParser();a.add_argument('--base',default='data/v9/germany-direct-offers.json');a.add_argument('--extensions',nargs='*',default=['data/v9/germany-direct-offers-aral-extension.json','data/v9/germany-direct-offers-enbw-extension.json','data/v9/germany-direct-offers-swu-extension.json','data/v9/germany-direct-offers-westfalen-extension.json','data/v9/germany-direct-offers-eam-extension.json','data/v9/germany-direct-offers-stadtwerke-luebeck-extension.json','data/v9/germany-direct-offers-swlb-extension.json','data/v9/germany-direct-offers-stadtwerke-bochum-extension.json','data/v9/germany-direct-offers-mark-e-extension.json','data/v9/germany-direct-offers-stadtwerke-wuerzburg-extension.json','data/v9/germany-direct-offers-q1-extension.json','data/v9/germany-direct-offers-stadtwerke-goettingen-extension.json','data/v9/germany-direct-offers-ovag-extension.json','data/v9/germany-direct-offers-wemag-extension.json','data/v9/germany-direct-offers-stadtwerke-neuss-extension.json','data/v9/germany-direct-offers-infra-fuerth-extension.json']);a.add_argument('--out',default='build/germany-direct-offers.json');x=a.parse_args()
 base=load(x.base);offers=list(base.get('directOffers',[]));seen={o['id'] for o in offers}
 for p in x.extensions:
  d=load(p)
  assert d.get('country')=='DE'
  for o in d.get('directOffers',[]):
   if o['id'] in seen: raise SystemExit(f'duplicate offer id: {o["id"]}')
   offers.append(o);seen.add(o['id'])
 out=dict(base);out['directOffers']=offers;out['generatedFrom']=[x.base,*x.extensions];out['effectiveOfferCount']=len(offers)
 q=Path(x.out);q.parent.mkdir(parents=True,exist_ok=True);q.write_text(json.dumps(out,separators=(',',':'),ensure_ascii=False)+'\n')
 print(json.dumps({'country':out.get('country'),'effectiveOfferCount':len(offers),'selectionCount':len({o.get('selectionId') for o in offers})},indent=2))
if __name__=='__main__':main()
