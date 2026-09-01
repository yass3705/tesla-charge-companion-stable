#!/usr/bin/env python3
import argparse,gzip,json
from pathlib import Path

def load(path): return json.loads(Path(path).read_text())

def main():
 p=argparse.ArgumentParser()
 p.add_argument('--offers',default='data/v9/germany-direct-offers-stadtwerke-bielefeld-extension.json')
 p.add_argument('--aliases',default='data/v9/germany-operator-aliases.json')
 p.add_argument('--sites')
 a=p.parse_args()
 d=load(a.offers);offers={o['id']:o for o in d['directOffers']}
 assert d['country']=='DE' and d['preIntegrationOnly'] is True
 assert d['verifiedAt']=='2026-09-01' and d['effectiveFrom']=='2025-07-01'
 assert d['source']=='https://www.stadtwerke-bielefeld.de/privatkunden/strom/e-mobilitaet/meinladestrom/'
 assert d['priceSheetSource']=='https://www.stadtwerke-bielefeld.de/fileadmin/Inhalte/05_Services/2025-07_Preisblatt_meinLadestrom.pdf'
 assert d['termsSource']=='https://www.stadtwerke-bielefeld.de/fileadmin/Inhalte/05_Services/Stadtwerke_Bielefeld_oeffentliches_Laden_AGB.pdf'
 assert d['contractSource']=='https://www.stadtwerke-bielefeld.de/fileadmin/Inhalte/05_Services/M.0090_12_23_Ladevertrag_Elektrofahrzeuge_ausfuellbar..pdf'
 assert set(offers)=={
  'stadtwerke-bielefeld-meinladestrom-standard-ac','stadtwerke-bielefeld-meinladestrom-standard-dc',
  'stadtwerke-bielefeld-meinladestrom-customer-ac','stadtwerke-bielefeld-meinladestrom-customer-dc',
 }
 expected_aliases={'Stadtwerke Bielefeld','Stadtwerke Bielefeld GmbH'}
 for offer in offers.values():
  assert set(offer['operatorAliases'])==expected_aliases,offer['id']
  assert not offer.get('networkAliases'),offer['id']
  assert offer['countries']==['DE'],offer['id']
  assert offer['directOperatorOnly'] is True and offer['defaultSelected'] is False,offer['id']
  assert offer['payment']=={'registrationRequired':True,'channels':['echarge_plus_app_contract_id']},offer['id']
  assert 'blockingFee' not in offer and 'idleFee' not in offer,offer['id']
 for prefix in ('standard','customer'):
  ac=offers[f'stadtwerke-bielefeld-meinladestrom-{prefix}-ac']
  dc=offers[f'stadtwerke-bielefeld-meinladestrom-{prefix}-dc']
  assert ac['connectorKinds']==['AC'] and dc['connectorKinds']==['DC']
  assert ac['pricing']['rules']==[{'scope':'allDay','start':'00:00','end':'24:00','billing':'kwh','currency':'EUR','pricePerKwh':0.56}]
  assert dc['pricing']['rules']==[{'scope':'allDay','start':'00:00','end':'24:00','billing':'kwh','currency':'EUR','pricePerKwh':0.65}]
 for offer_id in ('stadtwerke-bielefeld-meinladestrom-standard-ac','stadtwerke-bielefeld-meinladestrom-standard-dc'):
  assert offers[offer_id]['subscription']['monthlyFee']==4.0
  assert 'eligibility' not in offers[offer_id]
 for offer_id in ('stadtwerke-bielefeld-meinladestrom-customer-ac','stadtwerke-bielefeld-meinladestrom-customer-dc'):
  offer=offers[offer_id]
  assert offer['subscription']['monthlyFee']==0.0
  assert offer['eligibility']=={'existingCustomerOnly':True,'qualifyingProducts':['Stadtwerke Bielefeld household electricity']}
 assert 'never attach' in d['roamingDeferred']['reason']
 assert d['adHocDeferred']['available'] is True and d['adHocDeferred']['pricePublished'] is False
 assert 'Do not infer' in d['adHocDeferred']['reason']
 evidence=d['networkEvidence']
 assert evidence=={'bnetzaSnapshotDate':'2026-07-28','siteCount':92,'evseCount':203,'connectorCounts':{'AC':193,'DC':10},'states':['Nordrhein-Westfalen'],'policy':'Attach the four meinLadestrom offers only to physical Stadtwerke Bielefeld sites. Re-audit if a site outside Nordrhein-Westfalen appears.'}
 aliases=load(a.aliases)['operators']
 canonical=[x for x in aliases if x['canonical']=='Stadtwerke Bielefeld']
 assert canonical==[{'canonical':'Stadtwerke Bielefeld','aliases':['Stadtwerke Bielefeld GmbH']}]
 if a.sites:
  rows=json.loads(gzip.decompress(Path(a.sites).read_bytes()))
  sites=[r for r in rows if r[5]=='Stadtwerke Bielefeld']
  assert len(sites)>=90,f'unexpectedly low Stadtwerke Bielefeld site count: {len(sites)}'
  assert all('Nordrhein-Westfalen' in r[2] for r in sites),'Review tariff scope: a Stadtwerke Bielefeld site outside Nordrhein-Westfalen is now present.'
  counts={kind:sum(int(c[4]) for r in sites for c in r[8] if c[2]==kind) for kind in ('AC','DC')}
  assert counts['AC']>=190 and counts['DC']>=10,f'unexpected connector counts: {counts}'
 print(json.dumps({'country':'DE','operator':'Stadtwerke Bielefeld','offers':len(offers),'selections':2,'siteCount':evidence['siteCount'],'evseCount':evidence['evseCount'],'status':'ok'},ensure_ascii=False))

if __name__=='__main__': main()
