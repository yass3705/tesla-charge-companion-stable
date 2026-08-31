#!/usr/bin/env python3
import json
from pathlib import Path
p=Path('data/v9/germany-direct-offers-ovag-extension.json')
d=json.loads(p.read_text())
o={x['id']:x for x in d['directOffers']}
assert len(o)==6
prices={k:v['pricing']['rules'][0]['pricePerKwh'] for k,v in o.items()}
assert prices['ovag-app-standard-ac']==0.52
assert prices['ovag-app-standard-dc']==0.59
assert prices['ovag-customer-ac']==0.48
assert prices['ovag-customer-dc']==0.55
assert prices['ovag-ad-hoc-ac']==0.59
assert prices['ovag-ad-hoc-dc']==0.59
for k,v in o.items():
 assert v['directOperatorOnly'] is True
 assert 'Oberhessische Versorgungsbetriebe AG' in v['operatorAliases']
 fee=v['blockingFee']
 assert 'capPerSession' not in fee
 if 'ac' in k:
  assert fee['afterMinutes']==241 and fee['pricePerMinute']==0.02
  assert fee['activeWindow']=={'start':'07:00','end':'23:00'}
 else:
  assert fee['afterMinutes']==46 and fee['pricePerMinute']==0.10
  assert 'activeWindow' not in fee
for k in ('ovag-customer-ac','ovag-customer-dc'):
 assert o[k]['eligibility']['existingCustomerOnly'] is True
 assert set(o[k]['eligibility']['qualifyingProducts'])=={'Strom','Gas'}
print(json.dumps({'operator':'OVAG','offers':6,'standard':[0.52,0.59],'customer':[0.48,0.55],'adHoc':[0.59,0.59],'uncappedBlockingFees':True,'status':'ok'}))
