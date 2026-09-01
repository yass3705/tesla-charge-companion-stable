#!/usr/bin/env python3
import json
from pathlib import Path

p=Path('data/v9/germany-direct-offers-ewv-extension.json')
d=json.loads(p.read_text())
o={x['id']:x for x in d['directOffers']}
assert set(o)=={'ewv-card-standard-ac','ewv-card-standard-dc','ewv-customer-ac','ewv-customer-dc'}
prices={k:v['pricing']['rules'][0]['pricePerKwh'] for k,v in o.items()}
assert prices=={'ewv-card-standard-ac':0.54,'ewv-card-standard-dc':0.69,'ewv-customer-ac':0.44,'ewv-customer-dc':0.59}
for k,v in o.items():
 assert v['directOperatorOnly'] is True
 assert v['defaultSelected'] is False
 assert 'EWV Energie- und Wasser-Versorgung GmbH' in v['operatorAliases']
 fee=v['blockingFee']
 assert fee['pricePerMinute']==0.05 and fee['capPerSession']==20
 assert fee['activeWindow']=={'start':'09:00','end':'21:00'}
 if k.endswith('-ac'): assert fee['afterMinutes']==241
 else: assert fee['afterMinutes']==91
s=o['ewv-card-standard-ac']['subscription']; c=o['ewv-customer-ac']['subscription']
assert s['monthlyFee']==0 and s['monthlyMinimumSpend']==12 and s['oneTimeCardFee']==15
assert c['monthlyFee']==0 and c['monthlyMinimumSpend']==9.5 and c['oneTimeCardFee']==10
assert 'customer' in c['eligibility'].lower()
assert 'ladenetz' in d['roamingPolicy'].lower()
print(json.dumps({'country':'DE','operator':'EWV','offerCount':len(o),'standard':[0.54,0.69],'customer':[0.44,0.59],'blocking':'0.05/min 09:00-21:00 cap 20','minimumSpend':[12,9.5]},indent=2))
