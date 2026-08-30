#!/usr/bin/env python3
import json
from pathlib import Path
p=Path('data/v9/germany-cross-border-subscriptions.json')
d=json.loads(p.read_text())
assert d['homeCountry']=='DE' and d['preIntegrationOnly'] is True
policy=d['policy']
assert policy['countryPriceRequired'] is True
assert policy['noHomePricePropagation'] is True
assert policy['physicalCpoIdentityPreserved'] is True
assert policy['roamingSeparatedFromDirectCpo'] is True
subs=d['subscriptions']; ids=[s['id'] for s in subs]
assert len(ids)==len(set(ids))
by_id={s['id']:s for s in subs}
for s in subs:
 assert 'DE' in s['coverageCountries'],s['id']
 assert len(s['coverageCountries'])==len(set(s['coverageCountries'])),s['id']
 assert s['pricingMode'] in {'country-specific','station-specific-roaming'}
 if s['pricingMode']=='country-specific':
  assert s['homeCountryPrice']['country']=='DE'
  assert s['homeCountryPrice']['pricePerKwh']>=0
  assert s.get('rankableAbroad',True) is True
 else:
  assert s.get('rankableAbroad') is False,s['id']
  assert 'countryPrices' not in s,s['id']
# Country-specific policy coverage must exactly match its verified matrix.
fastned=json.loads(Path('data/v9/fastned-gold-country-prices.json').read_text())
ionity=json.loads(Path('data/v9/ionity-monthly-country-prices.json').read_text())
assert set(by_id['fastned-gold']['coverageCountries'])==set(fastned['prices'])
for sid in ('ionity-motion','ionity-power'):
 assert set(by_id[sid]['coverageCountries'])==set(ionity['subscriptions'][sid]),sid
# Critical regression guards: German prices must never be interpreted as foreign prices.
for s in subs:
 assert 'defaultForeignPrice' not in s,s['id']
 assert 'fallbackPricePerKwh' not in s,s['id']
# Aral cross-border remains deferred until its eMSP matrix is explicit.
deferred={x['id'] for x in d.get('deferred',[])}
assert {'aral-pulse-extra','aral-pulse-klassik','aral-pulse-adac-e-charge'} <= deferred
print(json.dumps({'subscriptions':len(subs),'fastnedCountries':len(fastned['prices']),'ionityCountries':len(ionity['subscriptions']['ionity-power']),'status':'ok'}))
