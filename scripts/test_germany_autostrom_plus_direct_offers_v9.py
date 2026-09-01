#!/usr/bin/env python3
import json
from pathlib import Path

p=Path('data/v9/germany-direct-offers-autostrom-plus-extension.json')
d=json.loads(p.read_text())
assert d['country']=='DE'
assert d['preIntegrationOnly'] is True
assert d['source']=='https://autostrom.plus/laden-tarif-2/'
o=d['directOffers']
assert len(o)==1
x=o[0]
assert x['id']=='autostrom-plus-de-adhoc-hpc'
assert x['selectionId']=='autostrom-plus-adhoc'
assert x['operatorAliases']==['Autostrom plus GmbH']
assert x['connectorKinds']==['DC']
assert x['minPowerKw']==150
assert x['pricing']['rules'][0]['pricePerKwh']==0.69
assert x['subscription'] is None
assert x['idleFee'] is None
assert x['directOperatorOnly'] is True
assert d['roamingDeferred']
print(json.dumps({'country':'DE','operator':'Autostrom plus GmbH','offerCount':1,'pricePerKwh':0.69,'minPowerKw':150,'blockingFee':None,'status':'ok'},indent=2))
