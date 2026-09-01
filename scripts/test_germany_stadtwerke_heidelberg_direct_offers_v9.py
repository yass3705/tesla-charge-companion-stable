#!/usr/bin/env python3
import argparse,gzip,json
from pathlib import Path

def load(path): return json.loads(Path(path).read_text())
def price(offer): return offer['pricing']['rules'][0]['pricePerKwh']

def main():
 p=argparse.ArgumentParser()
 p.add_argument('--offers',default='data/v9/germany-direct-offers-stadtwerke-heidelberg-extension.json')
 p.add_argument('--aliases',default='data/v9/germany-operator-aliases.json')
 p.add_argument('--sites')
 a=p.parse_args()
 d=load(a.offers);offers={o['id']:o for o in d['directOffers']}
 assert d['country']=='DE' and d['preIntegrationOnly'] is True
 assert d['effectiveFrom']=='2026-02-01' and d['source']=='https://www.swhd.de/unterwegs-laden'
 assert set(offers)=={
  'stadtwerke-heidelberg-standard-ac','stadtwerke-heidelberg-standard-dc',
  'stadtwerke-heidelberg-emobil-plus-ac','stadtwerke-heidelberg-emobil-plus-dc'
 }
 expected_aliases={'Stadtwerke Heidelberg','Stadtwerke Heidelberg Energie GmbH'}
 for offer in offers.values():
  assert set(offer['operatorAliases'])==expected_aliases,offer['id']
  assert offer['networkAliases']==['heidelberg EMOBIL'],offer['id']
  assert offer['countries']==['DE'] and offer['directOperatorOnly'] is True,offer['id']
  assert offer['defaultSelected'] is False,offer['id']
 assert price(offers['stadtwerke-heidelberg-standard-ac'])==0.4753
 assert price(offers['stadtwerke-heidelberg-standard-dc'])==0.5359
 assert price(offers['stadtwerke-heidelberg-emobil-plus-ac'])==0.4253
 assert price(offers['stadtwerke-heidelberg-emobil-plus-dc'])==0.4859
 policy=d['parkhouseBlockingFeeExemption'];site_ids=policy['siteIds']
 assert len(site_ids)==len(set(site_ids))==6
 assert set(site_ids)=={m['siteId'] for m in policy['siteMappings']}
 assert policy['runtimePolicy'].startswith('Apply the Fair-Use exemption only to the listed site IDs.')
 assert [x['parkhouse'] for x in policy['unmatchedParkhouses']]==['P22 Europaplatz']
 expected_ac_rules=[
  {'start':'00:00','end':'08:00','pricePerMinute':0.0},
  {'start':'08:00','end':'22:00','pricePerMinute':0.10},
  {'start':'22:00','end':'24:00','pricePerMinute':0.0},
 ]
 expected_dc_rules=[
  {'start':'00:00','end':'08:00','pricePerMinute':0.02},
  {'start':'08:00','end':'22:00','pricePerMinute':0.10},
  {'start':'22:00','end':'24:00','pricePerMinute':0.02},
 ]
 for offer in offers.values():
  fee=offer['blockingFee'];kind=offer['connectorKinds'][0]
  assert fee['afterMinutes']==(241 if kind=='AC' else 121),offer['id']
  assert fee['timeRules']==(expected_ac_rules if kind=='AC' else expected_dc_rules),offer['id']
  assert fee['capPerSession']==40.0 and fee['currency']=='EUR',offer['id']
  assert fee['exemptSiteIds']==site_ids and fee['runtimeTranslationRequired'] is True,offer['id']
  assert 'pricePerMinute' not in fee and 'exemptLocationTypes' not in fee,offer['id']
 for offer_id in ('stadtwerke-heidelberg-standard-ac','stadtwerke-heidelberg-standard-dc'):
  assert offers[offer_id]['payment']=={'registrationRequired':False,'channels':['heidelberg_emobil_app','qr_adhoc']}
 for offer_id in ('stadtwerke-heidelberg-emobil-plus-ac','stadtwerke-heidelberg-emobil-plus-dc'):
  assert offers[offer_id]['eligibility']=={'existingCustomerOnly':True,'qualifyingProducts':['heidelberg KLIMA'],'additionalAgreementRequired':True}
 assert d['roamingDeferred']['countries']==['DE']
 assert 'exact operator identities' in d['roamingDeferred']['reason']
 aliases=load(a.aliases)['operators']
 canonical=[x for x in aliases if x['canonical']=='Stadtwerke Heidelberg']
 assert canonical==[{'canonical':'Stadtwerke Heidelberg','aliases':['Stadtwerke Heidelberg Energie GmbH']}]
 if a.sites:
  rows=json.loads(gzip.decompress(Path(a.sites).read_bytes()));by_id={str(r[0]):r for r in rows}
  heidelberg=[r for r in rows if r[5]=='Stadtwerke Heidelberg']
  assert len(heidelberg)>=100,f'unexpectedly low Heidelberg site count: {len(heidelberg)}'
  for mapping in policy['siteMappings']:
   row=by_id.get(mapping['siteId']);assert row is not None,mapping
   assert row[5]=='Stadtwerke Heidelberg',mapping
   assert row[2]==mapping['bnetzaAddress'],(mapping,row[2])
   assert any(c[2]=='AC' for c in row[8]),mapping
  assert not any('Max Planck Ring 14' in r[2] for r in heidelberg),'P22 unexpectedly became linkable; review the explicit mapping'
 print(json.dumps({'country':'DE','operator':'Stadtwerke Heidelberg','offers':len(offers),'selections':2,'mappedParkhouses':len(site_ids),'standard':[0.4753,0.5359],'emobilPlus':[0.4253,0.4859],'status':'ok'},ensure_ascii=False))

if __name__=='__main__': main()
