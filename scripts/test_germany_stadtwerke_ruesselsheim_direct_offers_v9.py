#!/usr/bin/env python3
import argparse,gzip,json
from pathlib import Path

def load(path): return json.loads(Path(path).read_text())
def price(offer): return offer['pricing']['rules'][0]['pricePerKwh']

def main():
 p=argparse.ArgumentParser()
 p.add_argument('--offers',default='data/v9/germany-direct-offers-stadtwerke-ruesselsheim-extension.json')
 p.add_argument('--aliases',default='data/v9/germany-operator-aliases.json')
 p.add_argument('--sites')
 a=p.parse_args()
 d=load(a.offers);offers={o['id']:o for o in d['directOffers']}
 assert d['country']=='DE' and d['preIntegrationOnly'] is True
 assert d['verifiedAt']=='2026-09-01'
 assert d['source']=='https://www.stadtwerke-ruesselsheim.de/de/Geschaeftskunden/E-Mobilitaet/E-Mobilitaet/Unsere-oeffentlichen-Ladestationen/'
 assert d['cardPlanSource']=='https://www.stadtwerke-ruesselsheim.de/ladekarte'
 assert set(offers)=={
  'stadtwerke-ruesselsheim-basic-ac',
  'stadtwerke-ruesselsheim-smart-ac',
  'stadtwerke-ruesselsheim-plus-ac',
  'stadtwerke-ruesselsheim-adhoc-ac',
 }
 expected_aliases={'Stadtwerke Rüsselsheim','Stadtwerke Rüsselsheim GmbH'}
 for offer in offers.values():
  assert set(offer['operatorAliases'])==expected_aliases,offer['id']
  assert offer['networkAliases']==['SWR'],offer['id']
  assert offer['countries']==['DE'] and offer['connectorKinds']==['AC'],offer['id']
  assert offer['directOperatorOnly'] is True and offer['defaultSelected'] is False,offer['id']
 for offer_id in ('stadtwerke-ruesselsheim-basic-ac','stadtwerke-ruesselsheim-smart-ac','stadtwerke-ruesselsheim-plus-ac'):
  offer=offers[offer_id]
  assert offer['payment']=={'registrationRequired':True,'channels':['swr_charging_card']},offer_id
  assert offer['subscription']['minimumTermMonths']==3,offer_id
 adhoc=offers['stadtwerke-ruesselsheim-adhoc-ac']
 assert adhoc['payment']=={'registrationRequired':False,'channels':['credit_card_adhoc']}
 assert adhoc['subscription'] is None
 assert price(offers['stadtwerke-ruesselsheim-basic-ac'])==0.46
 assert price(offers['stadtwerke-ruesselsheim-plus-ac'])==0.38
 assert price(offers['stadtwerke-ruesselsheim-adhoc-ac'])==0.6
 assert offers['stadtwerke-ruesselsheim-basic-ac']['subscription']['monthlyFee']==4.9
 assert offers['stadtwerke-ruesselsheim-smart-ac']['subscription']['monthlyFee']==7.9
 assert offers['stadtwerke-ruesselsheim-plus-ac']['subscription']['monthlyFee']==10.9
 smart_rules=offers['stadtwerke-ruesselsheim-smart-ac']['pricing']['rules']
 assert smart_rules==[
  {'scope':'sessionStartWindow','start':'00:00','end':'08:00','billing':'kwh','currency':'EUR','pricePerKwh':0.39},
  {'scope':'sessionStartWindow','start':'08:00','end':'20:00','billing':'kwh','currency':'EUR','pricePerKwh':0.42},
  {'scope':'sessionStartWindow','start':'20:00','end':'24:00','billing':'kwh','currency':'EUR','pricePerKwh':0.39},
 ]
 roaming=d['roamingDeferred']
 assert roaming['acPricePerKwh']==0.55 and roaming['dcPricePerKwh']==0.67
 assert 'must not attach' in roaming['reason']
 dc=d['directDcDeferred']
 assert dc['adHocPricePerKwh']==0.65 and 'no Stadtwerke Rüsselsheim DC site' in dc['reason']
 conflict=d['conflictingOfficialPageDeferred']
 assert conflict['publishedLegacyCardPrices']=={'AC':0.43,'DC':0.48}
 assert 'No legacy card rate is merged' in conflict['reason']
 evidence=d['networkEvidence']
 assert evidence=={'bnetzaSnapshotDate':'2026-07-28','siteCount':93,'evseCount':186,'connectorKinds':['AC'],'policy':'Attach the four current own-network options only to physical Stadtwerke Rüsselsheim AC sites. Re-evaluate before adding any DC offer.'}
 aliases=load(a.aliases)['operators']
 canonical=[x for x in aliases if x['canonical']=='Stadtwerke Rüsselsheim']
 assert canonical==[{'canonical':'Stadtwerke Rüsselsheim','aliases':['Stadtwerke Rüsselsheim GmbH']}]
 if a.sites:
  rows=json.loads(gzip.decompress(Path(a.sites).read_bytes()))
  sites=[r for r in rows if r[5]=='Stadtwerke Rüsselsheim']
  assert len(sites)>=90,f'unexpectedly low Stadtwerke Rüsselsheim site count: {len(sites)}'
  assert all(r[8] and all(c[2]=='AC' for c in r[8]) for r in sites),'Review tariff scope: a Stadtwerke Rüsselsheim DC connector is now present.'
  assert sum(int(c[4]) for r in sites for c in r[8])>=180,'unexpectedly low Stadtwerke Rüsselsheim EVSE count'
 print(json.dumps({'country':'DE','operator':'Stadtwerke Rüsselsheim','offers':len(offers),'selections':4,'siteCount':evidence['siteCount'],'status':'ok'},ensure_ascii=False))

if __name__=='__main__': main()
