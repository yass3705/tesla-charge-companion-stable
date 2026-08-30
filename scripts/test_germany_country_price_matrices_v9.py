#!/usr/bin/env python3
import json
from pathlib import Path
fast=json.loads(Path('data/v9/fastned-gold-country-prices.json').read_text())
ion=json.loads(Path('data/v9/ionity-monthly-country-prices.json').read_text())
# Fastned: exact country prices for all currently published countries.
expected_fast={'BE','CH','DE','DK','ES','FR','GB','IT','NL'}
assert set(fast['prices'])==expected_fast
assert set(fast['subscriptionFees'])==expected_fast
assert fast['priceType']=='exact-country-subscription-price'
for cc,p in fast['prices'].items():
 assert p['pricePerKwh']>=0 and p['currency']
 assert cc in fast['subscriptionFees']
# Regression guards: known official values.
assert fast['prices']['DE']=={'currency':'EUR','pricePerKwh':0.49}
assert fast['prices']['FR']=={'currency':'EUR','pricePerKwh':0.43}
assert fast['prices']['ES']=={'currency':'EUR','pricePerKwh':0.41}
assert fast['prices']['GB']=={'currency':'GBP','pricePerKwh':0.55}
# IONITY: 23 current markets, local currencies, minimum-price semantics.
expected_ion={'AT','BE','HR','CZ','DK','EE','FI','FR','DE','HU','IE','IT','LV','LT','NL','NO','PL','SK','SI','ES','SE','CH','GB'}
assert ion['priceType']=='official-current-minimum-country-price'
assert 'may be higher' in ion['warning']
for sid in ('ionity-power','ionity-motion'):
 prices=ion['subscriptions'][sid]
 assert set(prices)==expected_ion,(sid,set(prices)^expected_ion)
 for cc,p in prices.items():
  assert p['pricePerKwh']>=0 and p['currency']
# Ensure DE is not accidentally copied across the matrix.
for sid in ('ionity-power','ionity-motion'):
 de=ion['subscriptions'][sid]['DE']
 assert any(p!=de for cc,p in ion['subscriptions'][sid].items() if cc!='DE')
assert ion['subscriptions']['ionity-power']['FR']['pricePerKwh']==0.33
assert ion['subscriptions']['ionity-motion']['FR']['pricePerKwh']==0.41
assert ion['subscriptions']['ionity-power']['ES']['pricePerKwh']==0.38
assert ion['subscriptions']['ionity-motion']['ES']['pricePerKwh']==0.48
print(json.dumps({'fastnedCountries':len(expected_fast),'ionityCountries':len(expected_ion),'status':'ok'}))
