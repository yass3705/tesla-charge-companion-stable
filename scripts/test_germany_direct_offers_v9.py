#!/usr/bin/env python3
import json,sys
from pathlib import Path

files=sys.argv[1:] or ['data/v9/germany-direct-offers.json','data/v9/germany-direct-offers-aral-extension.json']
all_offers=[]
for p in files:
 d=json.loads(Path(p).read_text())
 assert d.get('country')=='DE'
 assert d.get('preIntegrationOnly') is True
 all_offers += d.get('directOffers',[])
ids=[o['id'] for o in all_offers]
assert len(ids)==len(set(ids)), 'duplicate offer ids'
for o in all_offers:
 assert o.get('countries')==['DE'], o['id']
 assert o.get('defaultSelected') is False, o['id']
 assert o.get('directOperatorOnly') is True, o['id']
 assert o.get('operatorAliases'), o['id']
 assert o.get('connectorKinds'), o['id']
 rules=o.get('pricing',{}).get('rules',[])
 assert rules, o['id']
 for r in rules:
  assert r.get('billing')=='kwh', o['id']
  assert r.get('currency')=='EUR', o['id']
  assert isinstance(r.get('pricePerKwh'),(int,float)) and r['pricePerKwh']>=0, o['id']
 if 'subscription' in o:
  s=o['subscription']
  assert isinstance(s.get('monthlyFee'),(int,float)) and s['monthlyFee']>=0, o['id']
  assert s.get('currency')=='EUR', o['id']
 promo=o.get('temporaryDiscount')
 if promo:
  assert isinstance(promo.get('discountPerKwh'),(int,float)) and promo['discountPerKwh']>=0,o['id']
  assert isinstance(promo.get('effectivePricePerKwh'),(int,float)) and promo['effectivePricePerKwh']>=0,o['id']
  assert promo.get('validFrom') and promo.get('validUntil'),o['id']
# power-band overlap check by selection + connector
by={}
for o in all_offers:
 for k in o['connectorKinds']:
  by.setdefault((o['selectionId'],k),[]).append((o.get('minPowerKw',float('-inf')),o.get('maxPowerKw',float('inf')),o['id']))
for key,bands in by.items():
 bands.sort(key=lambda x:x[0])
 for a,b in zip(bands,bands[1:]):
  assert a[1] < b[0], f'overlap {key}: {a} {b}'
print(json.dumps({'files':files,'offers':len(all_offers),'selections':len(set(o['selectionId'] for o in all_offers)),'status':'ok'}))
