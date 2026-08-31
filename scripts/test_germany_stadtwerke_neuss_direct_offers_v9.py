#!/usr/bin/env python3
import json
from pathlib import Path

p=Path('data/v9/germany-direct-offers-stadtwerke-neuss-extension.json')
d=json.loads(p.read_text())
o=d['directOffers']
assert len(o)==6
by={x['id']:x for x in o}
assert by['stadtwerke-neuss-card-standard-ac']['pricing']['rules'][0]['pricePerKwh']==0.56
assert by['stadtwerke-neuss-card-standard-dc']['pricing']['rules'][0]['pricePerKwh']==0.56
assert by['stadtwerke-neuss-card-customer-ac']['pricing']['rules'][0]['pricePerKwh']==0.49
assert by['stadtwerke-neuss-card-customer-dc']['pricing']['rules'][0]['pricePerKwh']==0.49
assert by['stadtwerke-neuss-ad-hoc-ac']['pricing']['rules'][0]['pricePerKwh']==0.56
assert by['stadtwerke-neuss-ad-hoc-dc']['pricing']['rules'][0]['pricePerKwh']==0.66
assert by['stadtwerke-neuss-card-standard-ac']['subscription']['monthlyFee']==8.9
assert by['stadtwerke-neuss-card-customer-ac']['subscription']['monthlyFee']==7.9
assert by['stadtwerke-neuss-ad-hoc-ac']['sessionFee']=={'amount':5.9,'currency':'EUR'}
assert by['stadtwerke-neuss-ad-hoc-dc']['sessionFee']=={'amount':9.9,'currency':'EUR'}
for x in o:
 assert x['directOperatorOnly'] is True
 assert x['defaultSelected'] is False
 aliases=set(x.get('operatorAliases',[]))|set(x.get('networkAliases',[]))
 assert 'Stadtwerke Neuss Energie und Wasser GmbH' in aliases
 assert not ({'Ladenetz','ladenetz.de','EnBW mobility+','EWE Go','Westfalen Weser'} & aliases)
for key in ('stadtwerke-neuss-card-customer-ac','stadtwerke-neuss-card-customer-dc'):
 e=by[key]['eligibility']; assert e['existingCustomerOnly'] is True and e['qualifyingProducts']==['Strom']
assert 'Ladenetz' in d['roamingPolicy']
print(json.dumps({'operator':'Stadtwerke Neuss Energie und Wasser GmbH','offers':6,'cardStandard':0.56,'cardCustomer':0.49,'adHocAC':0.56,'adHocDC':0.66,'sessionFees':[5.9,9.9],'status':'ok'}))
