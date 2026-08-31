#!/usr/bin/env python3
import json
from pathlib import Path
p=Path('data/v9/germany-direct-offers-mark-e-extension.json')
d=json.loads(p.read_text()); offers=d['directOffers']
by={o['id']:o for o in offers}
assert set(by)=={'mark-e-drivecard-own-ac','mark-e-drivecard-own-dc'}
ac=by['mark-e-drivecard-own-ac']; dc=by['mark-e-drivecard-own-dc']
assert ac['pricing']['rules'][0]['pricePerKwh']==0.45
assert dc['pricing']['rules'][0]['pricePerKwh']==0.61
assert ac['maxPowerKw']==22
assert dc['minPowerKw']==50
for o in offers:
 assert o['selectionId']=='mark-e-drivecard'
 assert o['directOperatorOnly'] is True
 assert o['subscription']['monthlyFee']==1.99
 assert o['subscription']['oneTimeCardFee']==11.99
 assert o['defaultSelected'] is False
assert ac['idleFee']=={'afterMinutes':240,'amount':0.5,'currency':'EUR','billingIntervalMinutes':15,'note':'Official tariff: 0.50 EUR per 15 minutes from the begun fifth hour.'}
assert dc['idleFee']=={'afterMinutes':60,'amount':0.5,'currency':'EUR','billingIntervalMinutes':15,'note':'Official tariff: 0.50 EUR per 15 minutes from the begun second hour.'}
assert d['roamingDeferred']['ladenetz']['acPricePerKwh']==0.59
assert d['roamingDeferred']['ladenetz']['dcPricePerKwh']==0.69
assert d['roamingDeferred']['otherRoaming']['acPricePerKwh']==0.61
assert d['roamingDeferred']['otherRoaming']['dcPricePerKwh']==0.86
print(json.dumps({'operator':'Mark-E','offers':2,'ac':0.45,'dc':0.61,'monthlyFee':1.99,'oneTimeCardFee':11.99,'acBlockingAfterMinutes':240,'dcBlockingAfterMinutes':60},indent=2,ensure_ascii=False))
