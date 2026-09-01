#!/usr/bin/env python3
import json
from pathlib import Path
p=Path('data/v9/germany-direct-offers-maingau-extension.json')
d=json.loads(p.read_text());offers=d['directOffers'];by={o['id']:o for o in offers}
assert d['country']=='DE' and d['preIntegrationOnly'] is True
assert len(offers)==4
expected={
 'maingau-autostrom-normal-ac':0.52,
 'maingau-autostrom-normal-dc':0.62,
 'maingau-autostrom-energy-customer-ac':0.42,
 'maingau-autostrom-energy-customer-dc':0.52,
}
for oid,price in expected.items():
 o=by[oid];assert o['directOperatorOnly'] is True and o['defaultSelected'] is False
 assert o['pricing']['rules'][0]['pricePerKwh']==price
 assert {'MAINGAU','MAINGAU Energie GmbH'} <= set(o['operatorAliases'])
 assert o['subscription']['monthlyFee']==0.0
 if oid.endswith('-ac'):
  assert o['connectorKinds']==['AC'];assert o['blockingFee']=={'afterMinutes':180,'pricePerMinute':0.1,'capPerSession':12.0,'currency':'EUR'}
 else:
  assert o['connectorKinds']==['DC'];assert o['blockingFee']=={'afterMinutes':60,'pricePerMinute':0.1,'capPerSession':12.0,'currency':'EUR'}
for oid in ('maingau-autostrom-energy-customer-ac','maingau-autostrom-energy-customer-dc'):
 assert by[oid]['eligibility']['existingCustomerOnly'] is True
 assert set(by[oid]['eligibility']['qualifyingProducts'])=={'Strom','Gas'}
assert d['roamingDeferred']['normal']['AC']=={'low':0.52,'standard':0.72,'high':0.82}
assert d['roamingDeferred']['normal']['DC']=={'low':0.62,'standard':0.72,'high':0.82}
assert d['roamingDeferred']['energyCustomer']['AC']=={'low':0.42,'standard':0.62,'high':0.82}
assert d['roamingDeferred']['energyCustomer']['DC']=={'low':0.52,'standard':0.62,'high':0.82}
print(json.dumps({'country':'DE','operator':'MAINGAU','offers':len(offers),'normal':[0.52,0.62],'energyCustomer':[0.42,0.52],'blocking':['AC 180m 0.10/min cap12','DC 60m 0.10/min cap12'],'roamingTieredDeferred':True,'status':'ok'},ensure_ascii=False))
