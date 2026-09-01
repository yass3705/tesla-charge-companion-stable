#!/usr/bin/env python3
import json
from pathlib import Path
p=Path('data/v9/germany-direct-offers-ecowerk-extension.json')
d=json.loads(p.read_text())
o={x['id']:x for x in d['directOffers']}
assert len(o)==9
assert d['country']=='DE' and d['preIntegrationOnly'] is True
assert all(x['directOperatorOnly'] is True and x['defaultSelected'] is False for x in o.values())
assert all('ecowerk e-charge GmbH' in x['operatorAliases'] for x in o.values())
expected={
 'ecowerk-app-ac':0.42,'ecowerk-app-dc50':0.49,'ecowerk-app-dc300':0.58,
 'ecowerk-customer-ac':0.39,'ecowerk-customer-dc50':0.46,'ecowerk-customer-dc300':0.55,
 'ecowerk-adhoc-ac':0.42,'ecowerk-adhoc-dc50':0.49,'ecowerk-adhoc-dc300':0.58,
}
for k,v in expected.items(): assert o[k]['pricing']['rules'][0]['pricePerKwh']==v
for k in ('ecowerk-app-ac','ecowerk-customer-ac','ecowerk-adhoc-ac'):
 f=o[k]['blockingFee']; assert f['afterMinutes']==241 and f['pricePerMinute']==0.08 and f['capPerSession']==18.0
 assert f['activeWindow']=={'start':'08:00','end':'24:00'}
for k in ('ecowerk-app-dc50','ecowerk-customer-dc50','ecowerk-adhoc-dc50'):
 f=o[k]['blockingFee']; assert f['afterMinutes']==181 and f['pricePerMinute']==0.10 and f['capPerSession']==18.0
 assert o[k].get('maxPowerKw')==50
for k in ('ecowerk-app-dc300','ecowerk-customer-dc300','ecowerk-adhoc-dc300'):
 f=o[k]['blockingFee']; assert f['afterMinutes']==91 and f['pricePerMinute']==0.10 and f['capPerSession']==18.0
 assert o[k].get('minPowerKw')>50 and o[k].get('maxPowerKw')==300
for k in ('ecowerk-customer-ac','ecowerk-customer-dc50','ecowerk-customer-dc300'):
 e=o[k]['eligibility']; assert e['swtElectricityOrGasCustomerOnly'] is True and e['contractAccountNumberRequired'] is True
for k in ('ecowerk-adhoc-ac','ecowerk-adhoc-dc50','ecowerk-adhoc-dc300'):
 assert o[k]['payment']['registrationRequired'] is False
assert 'roaming' in d['roamingPolicy'].lower()
assert 'parkhouse' in d['deferred']['swtParkhouseTariff'].lower()
print(json.dumps({'country':'DE','operator':'ecowerk e-charge GmbH','offerCount':len(o),'app':[0.42,0.49,0.58],'customer':[0.39,0.46,0.55],'status':'ok'},indent=2))
