#!/usr/bin/env python3
import json,sys
from datetime import date
from decimal import Decimal
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
 s=o.get('subscription')
 if s is not None:
  assert isinstance(s,dict), o['id']
  assert isinstance(s.get('monthlyFee'),(int,float)) and s['monthlyFee']>=0, o['id']
  assert s.get('currency')=='EUR', o['id']
 promo=o.get('temporaryDiscount')
 if promo:
  discount=promo.get('discountPerKwh'); effective=promo.get('effectivePricePerKwh')
  assert isinstance(discount,(int,float)) and discount>=0,o['id']
  assert isinstance(effective,(int,float)) and effective>=0,o['id']
  assert promo.get('validFrom') and promo.get('validUntil'),o['id']
  valid_from=date.fromisoformat(promo['validFrom']); valid_until=date.fromisoformat(promo['validUntil'])
  assert valid_from <= valid_until, f"promo date order {o['id']}: {valid_from} > {valid_until}"
  regular_prices={Decimal(str(r['pricePerKwh'])) for r in rules}
  assert len(regular_prices)==1, f"promo requires one regular price per offer {o['id']}: {regular_prices}"
  regular=next(iter(regular_prices))
  assert Decimal(str(effective)) == regular-Decimal(str(discount)), f"promo arithmetic {o['id']}: {regular}-{discount}!={effective}"
 fee=o.get('blockingFee')
 if fee:
  assert isinstance(fee.get('afterMinutes'),(int,float)) and fee['afterMinutes']>=0,o['id']
  assert isinstance(fee.get('pricePerMinute'),(int,float)) and fee['pricePerMinute']>=0,o['id']
  if 'capPerSession' in fee:
   assert isinstance(fee.get('capPerSession'),(int,float)) and fee['capPerSession']>=0,o['id']
  assert fee.get('currency')=='EUR',o['id']
# power-band overlap check by selection + connector
by={}
for o in all_offers:
 for k in o['connectorKinds']:
  by.setdefault((o['selectionId'],k),[]).append((o.get('minPowerKw',float('-inf')),o.get('maxPowerKw',float('inf')),o['id']))
for key,bands in by.items():
 bands.sort(key=lambda x:x[0])
 for a,b in zip(bands,bands[1:]):
  assert a[1] < b[0], f'overlap {key}: {a} {b}'
print(json.dumps({'files':files,'offers':len(all_offers),'selections':len(set(o['selectionId'] for o in all_offers)),'temporaryDiscounts':sum(bool(o.get('temporaryDiscount')) for o in all_offers),'blockingFees':sum(bool(o.get('blockingFee')) for o in all_offers),'status':'ok'}))
