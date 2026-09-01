#!/usr/bin/env python3
import json
from pathlib import Path
d=json.loads(Path('data/v9/germany-direct-offers-jet-extension.json').read_text())
assert d['country']=='DE' and d['preIntegrationOnly'] is True
o=d['directOffers'][0]
assert len(d['directOffers'])==1
assert o['id']=='jet-strom-de-adhoc-dc' and o['selectionId']=='jet-strom-de-adhoc'
assert o['provider']=='JET Strom'
assert o['connectorKinds']==['DC']
assert o['pricing']['rules']==[{'scope':'allDay','start':'00:00','end':'24:00','billing':'kwh','currency':'EUR','pricePerKwh':0.49}]
assert o['subscription'] is None and o['blockingFee'] is None
assert o['directOperatorOnly'] is True and o['defaultSelected'] is False
assert {'JET Strom','JET Tankstellen Deutschland GmbH'} <= set(o['operatorAliases'])
print(json.dumps({'country':'DE','operator':'JET Strom','pricePerKwh':0.49,'connector':'DC','blockingFee':None,'subscription':None,'status':'ok'}))
