#!/usr/bin/env python3
import json
from pathlib import Path
p=Path('data/v9/germany-mainova-shell-customer-discount.json')
d=json.loads(p.read_text())
assert d['country']=='DE'
assert d['preIntegrationOnly'] is True
assert d['operator']=='Mainova'
x=d['discount']; policy=d['policy']
assert x['percentOff']==20
assert x['multiplier']==0.8
assert x['eligibility']['mainovaCustomerOnly'] is True
assert x['appliesOnlyWhen']['physicalOperator']=='Mainova'
assert x['appliesOnlyWhen']['paymentChannel']=='Shell Recharge app'
assert x['appliesOnlyWhen']['basePriceKnown'] is True
assert x['rankableWithoutBasePrice'] is False
assert x['defaultSelected'] is False
assert policy['noNationalBasePrice'] is True
assert policy['doNotApplyToShellPhysicalCpo'] is True
assert policy['doNotApplyOutsideMainovaSites'] is True
assert policy['doNotApplyWithoutExactDisplayedBasePrice'] is True
assert policy['preservePhysicalCpoIdentity'] is True
print(json.dumps({'operator':'Mainova','discountPercent':20,'multiplier':0.8,'requiresExactBasePrice':True,'status':'ok'},indent=2))
