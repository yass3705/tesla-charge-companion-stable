#!/usr/bin/env python3
import json
from pathlib import Path

p=Path('data/v9/germany-direct-offers-evf-extension.json')
d=json.loads(p.read_text())
o={x['id']:x for x in d['directOffers']}
assert set(o)=={'evf-de-direct-ac','evf-de-direct-dc'}
assert o['evf-de-direct-ac']['pricing']['rules'][0]['pricePerKwh']==0.38
assert o['evf-de-direct-dc']['pricing']['rules'][0]['pricePerKwh']==0.48
for x in o.values():
 assert x['directOperatorOnly'] is True
 assert x['defaultSelected'] is False
 assert 'Energieversorgung Filstal GmbH & Co. KG' in x['operatorAliases']
 assert x['currency']=='EUR'
 assert 'roaming' not in x['verifiedScope'].lower()
assert 'roaming' in d['roamingPolicy'].lower()
print(json.dumps({'country':'DE','operator':'EVF','offerCount':len(o),'ac':0.38,'dc':0.48},indent=2))
