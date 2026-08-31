#!/usr/bin/env python3
import json
from pathlib import Path

p=Path('data/v9/germany-direct-offers-evo-extension.json')
d=json.loads(p.read_text())
o={x['id']:x for x in d['directOffers']}
assert set(o)=={'evo-de-ad-hoc-ac','evo-de-ad-hoc-hpc'}
assert o['evo-de-ad-hoc-ac']['pricing']['rules'][0]['pricePerKwh']==0.49
assert o['evo-de-ad-hoc-hpc']['pricing']['rules'][0]['pricePerKwh']==0.49
assert o['evo-de-ad-hoc-ac']['connectorKinds']==['AC']
assert o['evo-de-ad-hoc-hpc']['connectorKinds']==['DC']
assert o['evo-de-ad-hoc-hpc']['minPowerKw']==300
for x in o.values():
 assert x['directOperatorOnly'] is True
 assert x['defaultSelected'] is False
 assert 'Energieversorgung Oberhausen' in x['operatorAliases']
 assert x['currency']=='EUR'
 assert x.get('blockingFee') is None
 assert 'monthlyFee' not in x
 assert 'startFee' not in x
assert 'roaming' in d['roamingPolicy'].lower()
print(json.dumps({'country':'DE','operator':'Energieversorgung Oberhausen','offerCount':len(o),'pricePerKwh':0.49,'blockingFee':None,'hpcMinKw':300},indent=2))
