#!/usr/bin/env python3
import json
from pathlib import Path
p=Path('data/v9/germany-direct-offers-stadtwerke-goettingen-extension.json')
d=json.loads(p.read_text())
o={x['id']:x for x in d['directOffers']}
assert d['country']=='DE' and d['preIntegrationOnly'] is True
assert len(o)==6
expected={
 'stadtwerke-goettingen-base-ac':(0.46,0.70,240,0.0),
 'stadtwerke-goettingen-base-dc':(0.52,0.70,120,0.0),
 'stadtwerke-goettingen-gostrom-ac':(0.44,0.70,240,0.0),
 'stadtwerke-goettingen-gostrom-dc':(0.50,0.70,120,0.0),
 'stadtwerke-goettingen-commuter-ac':(0.40,0.0,240,14.99),
 'stadtwerke-goettingen-commuter-dc':(0.40,0.0,120,14.99),
}
for oid,(price,start,after,monthly) in expected.items():
 x=o[oid]
 rule=x['pricing']['rules'][0]
 assert rule['pricePerKwh']==price,oid
 assert 'startFee' not in x,oid
 if start:
  assert rule['sessionFeeEur']==start,oid
 else:
  assert 'sessionFeeEur' not in rule,oid
 assert x['blockingFee']['afterMinutes']==after,oid
 assert x['blockingFee']['pricePerMinute']==0.06,oid
 assert x['blockingFee']['activeWindow']=={'start':'09:00','end':'20:00'},oid
 assert x['blockingFee']['waivedOutsideActiveWindow'] is True,oid
 assert 'capPerSession' not in x['blockingFee'],oid
 assert x['subscription']['monthlyFee']==monthly,oid
 assert x['directOperatorOnly'] is True and x['defaultSelected'] is False,oid
 assert 'Stadtwerke Göttingen AG' in x['operatorAliases'],oid
assert o['stadtwerke-goettingen-gostrom-ac']['eligibility']['existingCustomerOnly'] is True
assert o['stadtwerke-goettingen-gostrom-dc']['eligibility']['qualifyingProducts']==['GöStrom']
print(json.dumps({'country':'DE','operator':'Stadtwerke Göttingen AG','offers':6,'base':[0.46,0.52],'gostrom':[0.44,0.50],'commuter':[0.40,0.40],'startFeeRuntimeEur':0.70,'blockingWindow':'09:00-20:00','status':'ok'},ensure_ascii=False))
