#!/usr/bin/env python3
import argparse,gzip,json
from pathlib import Path

def load(path): return json.loads(Path(path).read_text())

def main():
 p=argparse.ArgumentParser()
 p.add_argument('--offers',default='data/v9/germany-direct-offers-e-werk-mittelbaden-extension.json')
 p.add_argument('--aliases',default='data/v9/germany-operator-aliases.json')
 p.add_argument('--sites')
 a=p.parse_args()
 d=load(a.offers);offers={o['id']:o for o in d['directOffers']}
 assert d['country']=='DE' and d['preIntegrationOnly'] is True
 assert d['verifiedAt']=='2026-09-01'
 assert d['source']=='https://www.e-werk-mittelbaden.de/oeffentliches-ladenetz'
 assert d['faqSource']=='https://www.e-werk-mittelbaden.de/faqs'
 assert set(offers)=={'e-werk-mittelbaden-adhoc-ac','e-werk-mittelbaden-adhoc-dc'}
 expected_aliases={'E-Werk Mittelbaden','Elektrizitätswerk Mittelbaden AG & Co. KG'}
 for offer in offers.values():
  assert offer['selectionId']=='e-werk-mittelbaden-adhoc',offer['id']
  assert offer['provider']=='E-Werk Mittelbaden ad hoc',offer['id']
  assert set(offer['operatorAliases'])==expected_aliases,offer['id']
  assert not offer.get('networkAliases'),offer['id']
  assert offer['countries']==['DE'],offer['id']
  assert offer['directOperatorOnly'] is True and offer['defaultSelected'] is False,offer['id']
  assert offer['subscription'] is None,offer['id']
  assert offer['payment']=={'registrationRequired':False,'channels':['qr_code','paypal','visa','mastercard']},offer['id']
 ac=offers['e-werk-mittelbaden-adhoc-ac'];dc=offers['e-werk-mittelbaden-adhoc-dc']
 assert ac['connectorKinds']==['AC'] and dc['connectorKinds']==['DC']
 assert ac['pricing']['rules']==[{'scope':'allDay','start':'00:00','end':'24:00','billing':'kwh','currency':'EUR','pricePerKwh':0.476}]
 assert dc['pricing']['rules']==[{'scope':'allDay','start':'00:00','end':'24:00','billing':'kwh','currency':'EUR','pricePerKwh':0.65}]
 assert 'blockingFee' not in ac and 'idleFee' not in ac
 assert dc['blockingFee']=={'afterMinutes':120,'pricePerMinute':0.18,'currency':'EUR'}
 assert 'capPerSession' not in dc['blockingFee'] and 'capPerDay' not in dc['blockingFee']
 assert d['paymentAuthorization']=={'amount':95.2,'currency':'EUR','authorizationOnly':True,'reason':'The payment provider reserves up to 95.20 EUR before the session and releases the unused balance. This is a temporary card authorization, not a tariff component or session-price cap.'}
 assert d['roamingDeferred']['available'] is True
 assert d['roamingDeferred']['channels']==['rfid_card','roaming_partner_app']
 assert 'never attach' in d['roamingDeferred']['reason']
 assert 'No such fee is fabricated' in d['deferred']['acBlockingFee']
 assert 'No cap is inferred' in d['deferred']['dcBlockingFeeCap']
 evidence=d['networkEvidence']
 assert evidence=={'bnetzaSnapshotDate':'2026-07-28','siteCount':84,'evseCount':190,'connectorCounts':{'AC':163,'DC':27},'states':['Baden-Württemberg'],'policy':'Attach both ad-hoc offers only to physical E-Werk Mittelbaden sites. Re-audit if a site outside Baden-Württemberg appears.'}
 aliases=load(a.aliases)['operators']
 canonical=[x for x in aliases if x['canonical']=='E-Werk Mittelbaden']
 assert canonical==[{'canonical':'E-Werk Mittelbaden','aliases':['Elektrizitätswerk Mittelbaden AG & Co. KG']}]
 if a.sites:
  rows=json.loads(gzip.decompress(Path(a.sites).read_bytes()))
  sites=[r for r in rows if r[5]=='E-Werk Mittelbaden']
  assert len(sites)>=80,f'unexpectedly low E-Werk Mittelbaden site count: {len(sites)}'
  assert all('Baden-Württemberg' in r[2] for r in sites),'Review tariff scope: an E-Werk Mittelbaden site outside Baden-Württemberg is now present.'
  counts={kind:sum(int(c[4]) for r in sites for c in r[8] if c[2]==kind) for kind in ('AC','DC')}
  assert counts['AC']>=160 and counts['DC']>=25,f'unexpected connector counts: {counts}'
 print(json.dumps({'country':'DE','operator':'E-Werk Mittelbaden','offers':len(offers),'selections':1,'siteCount':evidence['siteCount'],'evseCount':evidence['evseCount'],'status':'ok'},ensure_ascii=False))

if __name__=='__main__': main()
