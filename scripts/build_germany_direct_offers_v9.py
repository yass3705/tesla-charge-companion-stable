#!/usr/bin/env python3
import argparse,json
from datetime import datetime,timezone
from pathlib import Path

def load(p): return json.loads(Path(p).read_text())
def parse_time(v):
 if not v:return None
 try:return datetime.fromisoformat(str(v).replace('Z','+00:00'))
 except ValueError:return None
def is_active(o,now):
 until=parse_time(o.get('validUntil'))
 return until is None or until>=now

def main():
 a=argparse.ArgumentParser();a.add_argument('--base',default='data/v9/germany-direct-offers.json');a.add_argument('--extensions',nargs='*',default=['data/v9/germany-direct-offers-aral-extension.json','data/v9/germany-direct-offers-enbw-extension.json','data/v9/germany-direct-offers-swu-extension.json','data/v9/germany-direct-offers-westfalen-extension.json','data/v9/germany-direct-offers-eam-extension.json','data/v9/germany-direct-offers-stadtwerke-luebeck-extension.json','data/v9/germany-direct-offers-swlb-extension.json','data/v9/germany-direct-offers-stadtwerke-bochum-extension.json','data/v9/germany-direct-offers-mark-e-extension.json','data/v9/germany-direct-offers-stadtwerke-wuerzburg-extension.json','data/v9/germany-direct-offers-q1-extension.json','data/v9/germany-direct-offers-stadtwerke-goettingen-extension.json','data/v9/germany-direct-offers-ovag-extension.json','data/v9/germany-direct-offers-wemag-extension.json','data/v9/germany-direct-offers-stadtwerke-neuss-extension.json','data/v9/germany-direct-offers-infra-fuerth-extension.json','data/v9/germany-direct-offers-evo-extension.json','data/v9/germany-direct-offers-ewv-extension.json','data/v9/germany-direct-offers-ggew-extension.json','data/v9/germany-direct-offers-ecowerk-extension.json','data/v9/germany-direct-offers-autostrom-plus-extension.json','data/v9/germany-direct-offers-stadtwerke-konstanz-extension.json','data/v9/germany-direct-offers-stadtwerke-bruchsal-extension.json','data/v9/germany-direct-offers-jolt-extension.json','data/v9/germany-direct-offers-maingau-extension.json','data/v9/germany-direct-offers-jet-extension.json','data/v9/germany-direct-offers-stadtwerke-heidelberg-extension.json','data/v9/germany-direct-offers-stadtwerke-ruesselsheim-extension.json','data/v9/germany-direct-offers-stadtwerke-witten-extension.json','data/v9/germany-direct-offers-albwerk-extension.json','data/v9/germany-direct-offers-stadtwerke-bielefeld-extension.json','data/v9/germany-direct-offers-e-werk-mittelbaden-extension.json','data/v9/germany-direct-offers-stadtwerk-am-see-extension.json','data/v9/germany-direct-offers-wsw-extension.json','data/v9/germany-direct-offers-17er-extension.json','data/v9/germany-direct-offers-praeg-extension.json','data/v9/germany-direct-offers-evi-hildesheim-extension.json','data/v9/germany-direct-offers-stadtwerke-castrop-rauxel-extension.json','data/v9/germany-direct-offers-badenova-extension.json','data/v9/germany-direct-offers-mainzer-stadtwerke-extension.json','data/v9/germany-direct-offers-bilkraft-extension.json','data/v9/germany-direct-offers-next-wave-extension.json','data/v9/germany-direct-offers-swb-extension.json','data/v9/germany-direct-offers-stromspeichermarkt-extension.json','data/v9/germany-direct-offers-kiel-kassel-dueren-extension.json','data/v9/germany-direct-offers-stadtwerke-bonn-extension.json','data/v9/germany-direct-offers-lsw-evm-extension.json','data/v9/germany-direct-offers-stadtwerke-heilbronn-extension.json','data/v9/germany-direct-offers-jena-extension.json','data/v9/germany-direct-offers-nvb-team-extension.json','data/v9/germany-direct-offers-eins-gera-stendal-extension.json','data/v9/germany-direct-offers-uez-extension.json','data/v9/germany-direct-offers-fairenergie-extension.json','data/v9/germany-direct-offers-suec-extension.json']);a.add_argument('--out',default='build/germany-direct-offers.json');x=a.parse_args()
 now=datetime.now(timezone.utc);base=load(x.base);raw=list(base.get('directOffers',[]));seen={o['id'] for o in raw}
 for p in x.extensions:
  d=load(p);assert d.get('country')=='DE'
  for o in d.get('directOffers',[]):
   if o['id'] in seen: raise SystemExit(f'duplicate offer id: {o["id"]}')
   raw.append(o);seen.add(o['id'])
 offers=[o for o in raw if is_active(o,now)];expired=[o['id'] for o in raw if not is_active(o,now)]
 out=dict(base);out['directOffers']=offers;out['generatedFrom']=[x.base,*x.extensions];out['effectiveOfferCount']=len(offers);out['expiredOfferIds']=expired;out['builtAt']=now.isoformat()
 q=Path(x.out);q.parent.mkdir(parents=True,exist_ok=True);q.write_text(json.dumps(out,separators=(',',':'),ensure_ascii=False)+'\n')
 print(json.dumps({'country':out.get('country'),'effectiveOfferCount':len(offers),'expiredOfferIds':expired,'selectionCount':len({o.get('selectionId') for o in offers})},indent=2))
if __name__=='__main__':main()
