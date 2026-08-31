#!/usr/bin/env python3
import json
from pathlib import Path
p=Path('data/v9/germany-direct-offers-stadtwerke-wuerzburg-extension.json')
d=json.loads(p.read_text()); offers=d['directOffers']; by={o['id']:o for o in offers}
assert len(offers)==6
expected={
 'wvv-ad-hoc-ac':0.54,'wvv-ad-hoc-dc':0.69,
 'wvv-comfort-card-ac':0.49,'wvv-comfort-card-dc':0.59,
 'wvv-energy-customer-ac':0.36,'wvv-energy-customer-dc':0.44,
}
for i,pv in expected.items():
 assert by[i]['pricing']['rules'][0]['pricePerKwh']==pv,(i,by[i])
 assert by[i].get('directOperatorOnly') is True
 fee=by[i]['postChargeParkingFee']
 assert fee['startsWhenChargingStops'] is True
 assert fee['activeWindow']=={'start':'00:00','end':'24:00'}
 if i.endswith('-ac'): assert fee['pricePerMinute']==0.10
 else: assert fee['pricePerMinute']==0.25
assert all(o.get('defaultSelected') is False for o in offers)
for i in ('wvv-comfort-card-ac','wvv-comfort-card-dc'):
 assert by[i]['eligibility']['requiresWvvComfortCard'] is True
for i in ('wvv-energy-customer-ac','wvv-energy-customer-dc'):
 e=by[i]['eligibility']; assert e['requiresWvvComfortCard'] is True and e['existingCustomerOnly'] is True
 assert set(e['qualifyingProducts'])=={'Strom','Gas'}
assert 'Third-party roaming' in d['roamingPolicy']
print(json.dumps({'operator':'Stadtwerke Würzburg','offers':6,'adHoc':[0.54,0.69],'comfortCard':[0.49,0.59],'energyCustomer':[0.36,0.44],'postChargeParkingFee':[0.10,0.25],'status':'ok'},ensure_ascii=False))
