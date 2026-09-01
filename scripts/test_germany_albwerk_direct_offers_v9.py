#!/usr/bin/env python3
import argparse,gzip,json
from pathlib import Path

def load(path): return json.loads(Path(path).read_text())

def main():
 p=argparse.ArgumentParser()
 p.add_argument('--offers',default='data/v9/germany-direct-offers-albwerk-extension.json')
 p.add_argument('--aliases',default='data/v9/germany-operator-aliases.json')
 p.add_argument('--sites')
 a=p.parse_args()
 d=load(a.offers);offers={o['id']:o for o in d['directOffers']}
 assert d['country']=='DE' and d['preIntegrationOnly'] is True
 assert d['verifiedAt']=='2026-09-01' and d['effectiveFrom']=='2024-12-01'
 assert d['source']=='https://www.albwerk.de/laden-unterwegs'
 assert d['priceSheetSource']=='https://www.albwerk.de/de/Mobilitaet/Mobilitaet/ETG-Preisblatt-2024.12.pdf'
 assert set(offers)=={'albwerk-energie-to-go-own-ac','albwerk-energie-to-go-own-dc'}
 expected_aliases={'Albwerk','Albwerk Elektro- und Kommunikationstechnik GmbH'}
 for offer in offers.values():
  assert set(offer['operatorAliases'])==expected_aliases,offer['id']
  assert offer['networkBrand']=='ENERGIE TO GO',offer['id']
  assert not offer.get('networkAliases'),offer['id']
  assert offer['countries']==['DE'],offer['id']
  assert offer['selectionId']=='albwerk-energie-to-go-card',offer['id']
  assert offer['provider']=='Albwerk ENERGIE TO GO',offer['id']
  assert offer['directOperatorOnly'] is True and offer['defaultSelected'] is False,offer['id']
  assert offer['payment']=={'registrationRequired':True,'channels':['energie_to_go_charging_card']},offer['id']
  assert offer['subscription']=={'id':'albwerk-energie-to-go-card','monthlyFee':2.99,'currency':'EUR','minimumTermMonths':1},offer['id']
  assert 'blockingFee' not in offer,offer['id']
 for offer_id,kind,price in (
  ('albwerk-energie-to-go-own-ac','AC',0.4),
  ('albwerk-energie-to-go-own-dc','DC',0.5),
 ):
  offer=offers[offer_id]
  assert offer['connectorKinds']==[kind]
  assert offer['pricing']['rules']==[{'scope':'allDay','start':'00:00','end':'24:00','billing':'kwh','currency':'EUR','pricePerKwh':price}]
 roaming=d['roamingDeferred']
 assert roaming['ladenetz']=={'acPricePerKwh':0.55,'dcPricePerKwh':0.65,'currency':'EUR'}
 assert roaming['externalPartners']['acPricePerKwh']==0.6
 assert roaming['externalPartners']['dcPricePerKwh']==0.8
 assert roaming['externalPartners']['blockingFee']=={
  'AC':{'afterMinutes':240,'pricePerMinute':0.1,'capPerDay':24.0},
  'DC':{'afterMinutes':60,'pricePerMinute':0.1,'capPerDay':24.0},
 }
 assert 'never attach' in roaming['reason']
 assert d['adHocDeferred']['available'] is True and d['adHocDeferred']['pricePublished'] is False
 assert 'Do not infer' in d['adHocDeferred']['reason']
 evidence=d['networkEvidence']
 assert evidence=={'bnetzaSnapshotDate':'2026-07-28','siteCount':93,'evseCount':225,'connectorCounts':{'AC':214,'DC':11},'states':['Baden-Württemberg'],'policy':'Attach both charging-card offers only to physical Albwerk sites. Re-audit if a site outside Baden-Württemberg appears.'}
 aliases=load(a.aliases)['operators']
 canonical=[x for x in aliases if x['canonical']=='Albwerk']
 assert canonical==[{'canonical':'Albwerk','aliases':['Albwerk Elektro- und Kommunikationstechnik GmbH']}]
 if a.sites:
  rows=json.loads(gzip.decompress(Path(a.sites).read_bytes()))
  sites=[r for r in rows if r[5]=='Albwerk']
  assert len(sites)>=90,f'unexpectedly low Albwerk site count: {len(sites)}'
  assert all('Baden-Württemberg' in r[2] for r in sites),'Review tariff scope: an Albwerk site outside Baden-Württemberg is now present.'
  counts={kind:sum(int(c[4]) for r in sites for c in r[8] if c[2]==kind) for kind in ('AC','DC')}
  assert counts['AC']>=210 and counts['DC']>=10,f'unexpected connector counts: {counts}'
 print(json.dumps({'country':'DE','operator':'Albwerk','offers':len(offers),'selections':1,'siteCount':evidence['siteCount'],'evseCount':evidence['evseCount'],'status':'ok'},ensure_ascii=False))

if __name__=='__main__': main()
