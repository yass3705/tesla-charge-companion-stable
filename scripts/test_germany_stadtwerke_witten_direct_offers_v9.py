#!/usr/bin/env python3
import argparse,gzip,json
from pathlib import Path

def load(path): return json.loads(Path(path).read_text())

def main():
 p=argparse.ArgumentParser()
 p.add_argument('--offers',default='data/v9/germany-direct-offers-stadtwerke-witten-extension.json')
 p.add_argument('--aliases',default='data/v9/germany-operator-aliases.json')
 p.add_argument('--sites')
 a=p.parse_args()
 d=load(a.offers);offers={o['id']:o for o in d['directOffers']}
 assert d['country']=='DE' and d['preIntegrationOnly'] is True
 assert d['verifiedAt']=='2026-09-01' and d['effectiveFrom']=='2024-04-01'
 assert d['source']=='https://www.stadtwerke-witten.de/elektromobilitaet-ladekarte-witten'
 assert d['cardPortalSource']=='https://witten.stadtwerkedrive.de/ladekarte_bestellen'
 assert set(offers)=={
  'stadtwerke-witten-standard-ac','stadtwerke-witten-standard-dc',
  'stadtwerke-witten-customer-ac','stadtwerke-witten-customer-dc',
 }
 expected_aliases={'Stadtwerke Witten','Stadtwerke Witten Energielösungen GmbH'}
 for offer in offers.values():
  assert set(offer['operatorAliases'])==expected_aliases,offer['id']
  assert offer['networkAliases']==['Stadtwerkedrive Witten'],offer['id']
  assert offer['countries']==['DE'],offer['id']
  assert offer['directOperatorOnly'] is True and offer['defaultSelected'] is False,offer['id']
  assert offer['payment']=={'registrationRequired':True,'channels':['stadtwerkedrive_charging_card']},offer['id']
  assert offer['subscription']['monthlyFee']==0.0 and offer['subscription']['oneTimeCardFee']==9.95,offer['id']
 standard_ac=offers['stadtwerke-witten-standard-ac'];customer_ac=offers['stadtwerke-witten-customer-ac']
 assert standard_ac['pricing']['rules']==[
  {'scope':'sessionStartWindow','start':'00:00','end':'20:00','billing':'kwh','currency':'EUR','pricePerKwh':0.5},
  {'scope':'sessionStartWindow','start':'20:00','end':'24:00','billing':'kwh','currency':'EUR','pricePerKwh':0.4},
 ]
 assert customer_ac['pricing']['rules']==[
  {'scope':'sessionStartWindow','start':'00:00','end':'20:00','billing':'kwh','currency':'EUR','pricePerKwh':0.45},
  {'scope':'sessionStartWindow','start':'20:00','end':'24:00','billing':'kwh','currency':'EUR','pricePerKwh':0.4},
 ]
 for offer in (standard_ac,customer_ac):
  assert offer['connectorKinds']==['AC']
  assert offer['blockingFee']=={'afterMinutes':240,'pricePerMinute':0.05,'currency':'EUR','sessionStartOverrides':[{'start':'20:00','end':'24:00','afterMinutes':720}],'runtimeTranslationRequired':True}
 for offer_id,price in (('stadtwerke-witten-standard-dc',0.5),('stadtwerke-witten-customer-dc',0.45)):
  offer=offers[offer_id]
  assert offer['connectorKinds']==['DC']
  assert offer['pricing']['rules']==[{'scope':'allDay','start':'00:00','end':'24:00','billing':'kwh','currency':'EUR','pricePerKwh':price}]
  assert offer['blockingFee']=={'afterMinutes':120,'pricePerMinute':0.05,'currency':'EUR'}
 for offer_id in ('stadtwerke-witten-customer-ac','stadtwerke-witten-customer-dc'):
  assert offers[offer_id]['eligibility']=={'existingCustomerOnly':True,'qualifyingProducts':['Stadtwerke Witten electricity','Stadtwerke Witten gas']}
 roaming=d['roamingDeferred']
 assert roaming['monthlyOptionFee']==5.0
 assert roaming['interchargeAc']=={'pricePerKwh':0.5,'pricePerMinute':0.05}
 assert roaming['interchargeDc']=={'pricePerKwh':0.65,'pricePerMinute':0.05}
 assert 'never attach' in roaming['reason']
 assert d['adHocDeferred']['available'] is True and d['adHocDeferred']['pricePublished'] is False
 assert 'Do not infer' in d['adHocDeferred']['reason']
 evidence=d['networkEvidence']
 assert evidence=={'bnetzaSnapshotDate':'2026-07-28','siteCount':91,'evseCount':191,'connectorCounts':{'AC':178,'DC':13},'cities':['Witten'],'policy':'Attach the four charging-card offers only to physical Stadtwerke Witten sites in Witten. Re-audit if an out-of-city site appears.'}
 aliases=load(a.aliases)['operators']
 canonical=[x for x in aliases if x['canonical']=='Stadtwerke Witten']
 assert canonical==[{'canonical':'Stadtwerke Witten','aliases':['Stadtwerke Witten Energielösungen GmbH']}]
 if a.sites:
  rows=json.loads(gzip.decompress(Path(a.sites).read_bytes()))
  sites=[r for r in rows if r[5]=='Stadtwerke Witten']
  assert len(sites)>=90,f'unexpectedly low Stadtwerke Witten site count: {len(sites)}'
  assert all('Witten' in r[2] for r in sites),'Review tariff scope: a Stadtwerke Witten site outside Witten is now present.'
  counts={kind:sum(int(c[4]) for r in sites for c in r[8] if c[2]==kind) for kind in ('AC','DC')}
  assert counts['AC']>=175 and counts['DC']>=10,f'unexpected connector counts: {counts}'
 print(json.dumps({'country':'DE','operator':'Stadtwerke Witten','offers':len(offers),'selections':2,'siteCount':evidence['siteCount'],'evseCount':evidence['evseCount'],'status':'ok'},ensure_ascii=False))

if __name__=='__main__': main()
