#!/usr/bin/env python3
import json
from pathlib import Path

p=Path('data/v9/germany-direct-offers-infra-fuerth-extension.json')
d=json.loads(p.read_text())
assert d['country']=='DE' and d['preIntegrationOnly'] is True
assert d['effectiveFrom']=='2026-09-01'
o={x['id']:x for x in d['directOffers']}
expected={
 'infra-fuerth-lvp-normal-ac':0.48,
 'infra-fuerth-lvp-normal-dc':0.58,
 'infra-fuerth-lvp-customer-ac':0.42,
 'infra-fuerth-lvp-customer-dc':0.50,
 'infra-fuerth-lvp-adhoc-ac':0.62,
 'infra-fuerth-lvp-adhoc-dc':0.76,
}
assert set(o)==set(expected)
for oid,price in expected.items():
 x=o[oid]
 assert x['pricing']['rules'][0]['pricePerKwh']==price
 assert x['directOperatorOnly'] is True and x['defaultSelected'] is False
 assert 'infra fürth service gmbh' in x['operatorAliases']
 fee=x['blockingFee']
 assert 'parkhouse' in fee['exemptLocationTypes']
 if oid.endswith('-ac'):
  assert fee['afterMinutes']==240 and fee['pricePerMinute']==0.05
  assert fee['activeWindow']=={'start':'08:00','end':'20:00'}
 else:
  assert fee['afterMinutes']==45 and fee['pricePerMinute']==0.10
  assert 'activeWindow' not in fee
for oid in ('infra-fuerth-lvp-customer-ac','infra-fuerth-lvp-customer-dc'):
 assert o[oid]['eligibility']['infraElectricityCustomerOnly'] is True
 assert o[oid]['eligibility']['personalCodeRequired'] is True
rfid=d['accessoryFees']['rfidCard']
assert rfid=={'optional':True,'oneTimeFee':10.0,'currency':'EUR'}
assert 'roaming' in d['roamingPolicy'].lower()
print(json.dumps({'operator':'infra fürth service gmbh','offers':len(o),'prices':expected,'rfidOptional':True,'parkhouseBlockingExempt':True,'status':'ok'},ensure_ascii=False))
