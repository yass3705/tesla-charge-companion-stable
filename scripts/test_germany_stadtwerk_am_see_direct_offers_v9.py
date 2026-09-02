#!/usr/bin/env python3
import argparse,gzip,json
from pathlib import Path

def load(path): return json.loads(Path(path).read_text())

def main():
 p=argparse.ArgumentParser()
 p.add_argument('--offers',default='data/v9/germany-direct-offers-stadtwerk-am-see-extension.json')
 p.add_argument('--aliases',default='data/v9/germany-operator-aliases.json')
 p.add_argument('--sites')
 a=p.parse_args()
 d=load(a.offers);offers={o['id']:o for o in d['directOffers']}
 assert d['country']=='DE' and d['preIntegrationOnly'] is True
 assert d['verifiedAt']=='2026-09-01' and d['effectiveFrom']=='2022-12-01'
 assert d['source']=='https://www.stadtwerk-am-see.de/de/Wohnen/eMobilitaet/'
 assert d['cardSource']=='https://www.stadtwerk-am-see.de/gruenekarte'
 assert d['termsSource'].endswith('/AGB-GRUENE-KARTE-MEIN-AUTO-STROM.pdf')
 assert d['otherFeesSource'].endswith('/auto-strom-sonstigen-preise-und-entgelte.pdf')
 assert d['cpoTransferSource'].endswith('/Stadtwerk-konzentriert-die-E-Mobilitaet-in-einer-neuen-Firma.html')
 assert set(offers)=={
  'stadtwerk-am-see-mein-auto-strom-standard-ac','stadtwerk-am-see-mein-auto-strom-standard-dc',
  'stadtwerk-am-see-mein-auto-strom-customer-ac','stadtwerk-am-see-mein-auto-strom-customer-dc',
 }
 expected_aliases={'Stadtwerk am See','STADTWERK MOBILITY PLUS GmbH & Co. KG'}
 for offer in offers.values():
  assert set(offer['operatorAliases'])==expected_aliases,offer['id']
  assert offer['networkAliases']==['SWSee'],offer['id']
  assert offer['countries']==['DE'],offer['id']
  assert offer['directOperatorOnly'] is True and offer['defaultSelected'] is False,offer['id']
  assert offer['payment']=={'registrationRequired':True,'channels':['gruene_karte_rfid','echarge_plus_contract']},offer['id']
  assert 'blockingFee' not in offer and 'idleFee' not in offer,offer['id']
 for tier in ('standard','customer'):
  ac=offers[f'stadtwerk-am-see-mein-auto-strom-{tier}-ac']
  dc=offers[f'stadtwerk-am-see-mein-auto-strom-{tier}-dc']
  assert ac['connectorKinds']==['AC'] and dc['connectorKinds']==['DC']
  assert ac['pricing']['rules']==[{'scope':'allDay','start':'00:00','end':'24:00','billing':'kwh','currency':'EUR','pricePerKwh':0.49}]
  assert dc['pricing']['rules']==[{'scope':'allDay','start':'00:00','end':'24:00','billing':'kwh','currency':'EUR','pricePerKwh':0.59}]
 standard=[offers[x] for x in offers if '-standard-' in x]
 customer=[offers[x] for x in offers if '-customer-' in x]
 for offer in standard:
  assert offer['subscription']['monthlyFee']==1.95
  assert offer['subscription']['annualCardFee']==15.0
  assert offer['subscription']['annualTotalFee']==38.4
  assert offer['subscription']['noticePeriodMonths']==1
  assert 'eligibility' not in offer
 for offer in customer:
  assert offer['subscription']['monthlyFee']==1.95
  assert offer['subscription']['annualCardFee']==0.0
  assert offer['subscription']['annualTotalFee']==23.4
  assert offer['subscription']['noticePeriodMonths']==1
  assert offer['eligibility']=={'existingCustomerOnly':True,'qualifyingProducts':['Stadtwerk am See electricity','Stadtwerk am See gas','Stadtwerk am See heat']}
 assert d['adHocDeferred']['available'] is True and d['adHocDeferred']['pricePublished'] is False
 assert 'Do not infer' in d['adHocDeferred']['reason']
 assert d['roamingPolicy']['availableWithGrueneKarte'] is False
 assert 'Never attach' in d['roamingPolicy']['reason']
 assert 'No such fee is fabricated' in d['deferred']['blockingFee']
 assert 'excluded' in d['deferred']['conditionalAdministrativeFees']
 evidence=d['networkEvidence']
 assert evidence=={'bnetzaSnapshotDate':'2026-07-28','siteCount':85,'evseCount':228,'connectorCounts':{'AC':213,'DC':15},'states':['Baden-Württemberg'],'policy':'Attach the four MEIN AUTO STROM offers only to physical STADTWERK MOBILITY PLUS sites. Re-audit if a site outside Baden-Württemberg appears.'}
 aliases=load(a.aliases)['operators']
 canonical=[x for x in aliases if x['canonical']=='Stadtwerk am See']
 assert canonical==[{'canonical':'Stadtwerk am See','aliases':['STADTWERK MOBILITY PLUS GmbH & Co. KG']}]
 if a.sites:
  rows=json.loads(gzip.decompress(Path(a.sites).read_bytes()))
  sites=[r for r in rows if r[5]=='Stadtwerk am See']
  assert len(sites)>=80,f'unexpectedly low Stadtwerk am See site count: {len(sites)}'
  assert all('Baden-Württemberg' in r[2] for r in sites),'Review tariff scope: a Stadtwerk am See site outside Baden-Württemberg is now present.'
  counts={kind:sum(int(c[4]) for r in sites for c in r[8] if c[2]==kind) for kind in ('AC','DC')}
  # networkEvidence is a dated 2026-07-28 snapshot. The live BNetzA registry can legitimately
  # gain or lose a small number of EVSEs between runs; fail only on material scope drift.
  assert counts['AC']>=210 and counts['DC']>=14 and sum(counts.values())>=224,f'unexpected connector counts: {counts}'
 print(json.dumps({'country':'DE','operator':'Stadtwerk am See','offers':len(offers),'selections':2,'siteCount':evidence['siteCount'],'evseCount':evidence['evseCount'],'status':'ok'},ensure_ascii=False))

if __name__=='__main__': main()
