#!/usr/bin/env python3
import argparse,gzip,json
from pathlib import Path

TARGETS={
 'Fastned':{'minSites':50,'requireFullCoverage':True},
 'IONITY':{'minSites':200,'requireFullCoverage':True},
 'Aral pulse':{'minSites':500,'requireFullCoverage':True},
 'EnBW mobility+':{'minSites':2000,'requireFullCoverage':True},
 'SWU Energie':{'minSites':140,'requireFullCoverage':True},
 'Westfalen':{'minSites':120,'requireFullCoverage':True},
 'EAM Natur Energie':{'minSites':140,'requireFullCoverage':True},
 'Stadtwerke Lübeck Energie':{'minSites':140,'requireFullCoverage':True},
 'SWLB Mobilität':{'minSites':140,'requireFullCoverage':True},
 'Stadtwerke Bochum':{'minSites':120,'requireFullCoverage':True},
 'Mark-E':{'minSites':100,'requireFullCoverage':True},
 'Stadtwerke Würzburg':{'minSites':80,'requireFullCoverage':True},
 'Q1 Energie AG':{'minSites':100,'requireFullCoverage':True},
 'Stadtwerke Göttingen AG':{'minSites':100,'requireFullCoverage':True},
 'Oberhessische Versorgungsbetriebe AG':{'minSites':120,'requireFullCoverage':True},
 'WEMAG AG':{'minSites':90,'requireFullCoverage':True},
 'Stadtwerke Neuss Energie und Wasser GmbH':{'minSites':90,'requireFullCoverage':True},
 'infra fürth service gmbh':{'minSites':100,'requireFullCoverage':True},
 'Energieversorgung Oberhausen':{'minSites':130,'requireFullCoverage':True},
 'EWV Energie- und Wasser-Versorgung GmbH':{'minSites':100,'requireFullCoverage':True},
 'Gruppen-Gas- und Elektrizitätswerk Bergstraße AG':{'minSites':100,'requireFullCoverage':True},
 'TotalEnergies':{'minSites':300,'requireFullCoverage':False,'knownGap':'Germany prices are station-specific; national fallback forbidden'},
}

def load_json(path):
 return json.loads(Path(path).read_text())

def load_rows(path):
 return json.loads(gzip.decompress(Path(path).read_bytes()))

def offer_matches_connector(offer,connector):
 kind=connector[2]; power=float(connector[3])
 kinds=offer.get('connectorKinds') or []
 if kinds and kind not in kinds: return False
 lo=offer.get('minPowerKw'); hi=offer.get('maxPowerKw')
 if lo is not None and power < float(lo): return False
 if hi is not None and power > float(hi): return False
 return True

def offer_matches_site(offer,row):
 if 'DE' not in (offer.get('countries') or []): return False
 if str(row[0]) in {str(x) for x in (offer.get('excludedSiteIds') or [])}: return False
 op=row[5]
 aliases=set(offer.get('operatorAliases') or []) | set(offer.get('networkAliases') or [])
 if op not in aliases: return False
 return any(offer_matches_connector(offer,c) for c in row[8])

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument('--sites',default='build/germany-sites/all.json.gz')
 ap.add_argument('--offers',default='build/germany-direct-offers.json')
 args=ap.parse_args()
 rows=load_rows(args.sites); offers=load_json(args.offers).get('directOffers',[])
 report={}
 for op,cfg in TARGETS.items():
  sites=[r for r in rows if r[5]==op]
  matched=[r for r in sites if any(offer_matches_site(o,r) for o in offers)]
  report[op]={
   'siteCount':len(sites),
   'matchedSiteCount':len(matched),
   'coverage':round(len(matched)/len(sites),6) if sites else 0,
   'offerIds':sorted({o['id'] for o in offers if any(r[5] in (set(o.get('operatorAliases') or [])|set(o.get('networkAliases') or [])) for r in sites)}),
  }
  if cfg.get('knownGap'): report[op]['knownGap']=cfg['knownGap']
  assert len(sites)>=cfg['minSites'],f'{op}: unexpectedly low site count {len(sites)}'
  if cfg.get('requireFullCoverage'):
   assert len(matched)==len(sites),f'{op}: direct-offer linkage gap {len(matched)}/{len(sites)}'
 print(json.dumps({'country':'DE','targets':report},indent=2,ensure_ascii=False))

if __name__=='__main__': main()
