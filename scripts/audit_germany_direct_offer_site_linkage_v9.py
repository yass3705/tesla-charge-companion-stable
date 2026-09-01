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
 'Q1':{'minSites':100,'requireFullCoverage':True},
 'Stadtwerke Göttingen':{'minSites':100,'requireFullCoverage':True},
 'OVAG':{'minSites':120,'requireFullCoverage':True},
 'WEMAG':{'minSites':90,'requireFullCoverage':True},
 'Stadtwerke Neuss':{'minSites':90,'requireFullCoverage':True},
 'infra fürth':{'minSites':100,'requireFullCoverage':True},
 'Energieversorgung Oberhausen':{'minSites':130,'requireFullCoverage':True},
 'EWV':{'minSites':100,'requireFullCoverage':True},
 'GGEW':{'minSites':100,'requireFullCoverage':True},
 'ecowerk e-charge':{'minSites':90,'requireFullCoverage':True},
 'Autostrom plus':{'minSites':110,'requireFullCoverage':True},
 'Stadtwerke Konstanz':{'minSites':30,'requireFullCoverage':True},
 'Stadtwerke Bruchsal':{'minSites':100,'requireFullCoverage':True},
 'JOLT Energy':{'minSites':90,'requireFullCoverage':True},
 'MAINGAU Energie GmbH':{'minSites':80,'requireFullCoverage':True},
 'JET Tankstellen Deutschland GmbH':{'minSites':80,'requireFullCoverage':True,'connectorKinds':['DC'],'knownGap':'One grouped legacy AC-only JET site is intentionally outside the JET Strom CCS ad-hoc tariff scope.'},
 'Stadtwerke Heidelberg':{'minSites':100,'requireFullCoverage':True},
 'TotalEnergies':{'minSites':300,'requireFullCoverage':False,'knownGap':'Germany prices are station-specific; national fallback forbidden'},
}

def load_json(path): return json.loads(Path(path).read_text())
def load_rows(path): return json.loads(gzip.decompress(Path(path).read_bytes()))
def offer_matches_connector(offer,connector):
 kind=connector[2]; power=float(connector[3]); kinds=offer.get('connectorKinds') or []
 if kinds and kind not in kinds: return False
 lo=offer.get('minPowerKw'); hi=offer.get('maxPowerKw')
 if lo is not None and power<float(lo): return False
 if hi is not None and power>float(hi): return False
 return True
def offer_matches_site(offer,row):
 if 'DE' not in (offer.get('countries') or []): return False
 if str(row[0]) in {str(x) for x in (offer.get('excludedSiteIds') or [])}: return False
 op=row[5]; aliases=set(offer.get('operatorAliases') or [])|set(offer.get('networkAliases') or [])
 if op not in aliases: return False
 return any(offer_matches_connector(offer,c) for c in row[8])
def site_in_scope(row,cfg):
 kinds=set(cfg.get('connectorKinds') or [])
 return not kinds or any(c[2] in kinds for c in row[8])
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--sites',default='build/germany-sites/all.json.gz');ap.add_argument('--offers',default='build/germany-direct-offers.json');args=ap.parse_args()
 rows=load_rows(args.sites);offers=load_json(args.offers).get('directOffers',[]);report={}
 for op,cfg in TARGETS.items():
  all_sites=[r for r in rows if r[5]==op];sites=[r for r in all_sites if site_in_scope(r,cfg)];matched=[r for r in sites if any(offer_matches_site(o,r) for o in offers)]
  report[op]={'totalSiteCount':len(all_sites),'siteCount':len(sites),'matchedSiteCount':len(matched),'coverage':round(len(matched)/len(sites),6) if sites else 0,'offerIds':sorted({o['id'] for o in offers if any(r[5] in (set(o.get('operatorAliases') or [])|set(o.get('networkAliases') or [])) for r in sites)})}
  if cfg.get('connectorKinds'): report[op]['connectorKinds']=cfg['connectorKinds']
  if cfg.get('knownGap'): report[op]['knownGap']=cfg['knownGap']
  assert len(sites)>=cfg['minSites'],f'{op}: unexpectedly low in-scope site count {len(sites)}'
  if cfg.get('requireFullCoverage'): assert len(matched)==len(sites),f'{op}: direct-offer linkage gap {len(matched)}/{len(sites)} in-scope sites'
 print(json.dumps({'country':'DE','targets':report},indent=2,ensure_ascii=False))
if __name__=='__main__': main()
