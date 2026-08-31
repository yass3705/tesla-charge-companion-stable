#!/usr/bin/env python3
import json
from pathlib import Path
p=Path('data/v9/germany-direct-offers-swlb-extension.json')
d=json.loads(p.read_text()); offers=d['directOffers']
assert d['country']=='DE' and d['preIntegrationOnly'] is True
assert len(offers)==4
by={o['id']:o for o in offers}
expected={'swlb-ad-hoc-ac':0.59,'swlb-ad-hoc-dc':0.79,'swlb-customer-app-ac':0.49,'swlb-customer-app-dc':0.69}
for oid,price in expected.items():
 o=by[oid]
 assert o['directOperatorOnly'] is True and o['defaultSelected'] is False
 assert o['pricing']['rules'][0]['pricePerKwh']==price
 assert 'SWLB Mobilität' in o['operatorAliases']
fee_ac=by['swlb-ad-hoc-ac']['blockingFee']; fee_dc=by['swlb-ad-hoc-dc']['blockingFee']
assert (fee_ac['afterMinutes'],fee_ac['pricePerMinute'],fee_ac['capPerSession'])==(241,0.08,12.0)
assert (fee_dc['afterMinutes'],fee_dc['pricePerMinute'],fee_dc['capPerSession'])==(46,0.1,20.0)
for o in offers:
 f=o['blockingFee']; assert f['activeWindow']=={'start':'08:00','end':'20:00'}
for oid in ('swlb-customer-app-ac','swlb-customer-app-dc'):
 e=by[oid]['eligibility']; assert e['existingCustomerOnly'] is True
assert d['stationSpecificDeferred']['acParkhouse']['adHocPricePerKwh']==0.49
assert d['stationSpecificDeferred']['acParkhouse']['customerPricePerKwh']==0.46
assert d['stationSpecificDeferred']['acParkhouse']['blockingFee'] is None
print(json.dumps({'country':'DE','operator':'SWLB Mobilität','offers':len(offers),'adHoc':[0.59,0.79],'customer':[0.49,0.69],'blockingWindows':'08:00-20:00','parkhouseDeferred':True,'status':'ok'},ensure_ascii=False))
