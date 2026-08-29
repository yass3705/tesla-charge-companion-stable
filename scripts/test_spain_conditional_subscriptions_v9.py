#!/usr/bin/env python3
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
p=ROOT/'data/v9/spain-conditional-subscription-evidence.json'
d=json.loads(p.read_text(encoding='utf-8'))
assert d['schemaVersion']==1 and d['country']=='ES' and d['status']=='PRE_INTEGRATION_ONLY'
entries={e['id']:e for e in d['entries']}
endesa=entries['endesa-formidable-20']
assert endesa['benefit']['discountPercent']==20
assert endesa['eligibility']['requiresActivationCode'] is True
assert endesa['portableOutsideSpain']=='not_verified'
assert endesa['rankableWithoutStationBasePrice'] is False
moeve=entries['moeve-electric-plan']
assert moeve['fee']=={'currency':'EUR','amount':9,'periodDays':30}
assert moeve['benefit']['discountPercent']==25
assert moeve['stacking']['clubMoeveGowBalance'] is False
assert moeve['portableOutsideSpain']=='not_verified'
assert moeve['rankableWithoutStationBasePrice'] is False
print('Spain conditional subscription evidence OK')
