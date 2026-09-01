#!/usr/bin/env python3
import json
from pathlib import Path

p=Path('data/v9/germany-direct-offers-ggew-extension.json')
d=json.loads(p.read_text())
o={x['id']:x for x in d['directOffers']}
assert set(o)=={'ggew-card-standard-ac','ggew-card-customer-ac'}
for x in o.values():
 assert x['pricing']['rules'][0]['pricePerKwh']==0.5
 assert x['connectorKinds']==['AC']
 assert x.get('maxPowerKw')==22
 assert x['blockingFee']['afterMinutes']==240
 assert x['blockingFee']['pricePerMinute']==0.12
 assert x['blockingFee']['currency']=='EUR'
 assert x['directOperatorOnly'] is True
 assert x['defaultSelected'] is False
 assert 'Gruppen-Gas- und Elektrizitätswerk Bergstraße AG' in x['operatorAliases']
assert o['ggew-card-standard-ac']['subscription']['monthlyFee']==3.0
assert o['ggew-card-standard-ac']['subscription']['oneTimeActivationFee']==25.0
assert o['ggew-card-customer-ac']['subscription']['monthlyFee']==0.0
assert o['ggew-card-customer-ac']['subscription']['oneTimeActivationFee']==11.9
assert 'eligibility' in o['ggew-card-customer-ac']['subscription']
assert '0.595' in d['roamingPolicy']
assert 'provider-specific' in d['roamingPolicy']
print(json.dumps({'country':'DE','operator':'GGEW','offerCount':2,'pricePerKwh':0.5,'blockingAfterMinutes':240,'blockingPerMinute':0.12,'standardMonthlyFee':3.0,'customerMonthlyFee':0.0},indent=2,ensure_ascii=False))
