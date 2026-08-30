#!/usr/bin/env python3
from resolve_v9_cross_border_tariff import resolve

def check(r,status,rankable,price=None,currency=None,semantics=None):
 assert r['status']==status,r
 assert r['rankable'] is rankable,r
 assert r['usedFallback'] is False,r
 if price is not None: assert abs(r['pricePerKwh']-price)<1e-9,r
 if currency is not None: assert r['currency']==currency,r
 if semantics is not None: assert r['priceSemantics']==semantics,r

check(resolve('fastned-gold','FR'),'exact',True,0.43,'EUR','exact-country')
check(resolve('fastned-gold','GB'),'exact',True,0.55,'GBP','exact-country')
check(resolve('fastned-gold','DE'),'exact',True,0.49,'EUR','exact-country')
r=resolve('fastned-gold','AT');check(r,'unavailable',False);assert 'pricePerKwh' not in r
check(resolve('ionity-power','FR'),'minimum',False,0.33,'EUR','country-minimum')
check(resolve('ionity-motion','GB'),'minimum',False,0.62,'GBP','country-minimum')
check(resolve('ionity-power','FR',0.37,'EUR'),'exact',True,0.37,'EUR','station-specific')
check(resolve('enbw-mobility-plus-m','FR'),'station-specific-required',False,semantics='station-specific')
check(resolve('enbw-mobility-plus-m','FR',0.59,'EUR'),'exact',True,0.59,'EUR','station-specific')
r=resolve('aral-pulse-extra','FR');check(r,'unavailable',False);assert 'pricePerKwh' not in r
# Regression: no German price may leak into unsupported countries.
for sid,country in [('fastned-gold','AT'),('ionity-power','PT'),('ionity-motion','PT')]:
 r=resolve(sid,country);assert r['usedFallback'] is False,r
 if r['status']=='unavailable': assert 'pricePerKwh' not in r,r
print('cross-border tariff resolver: ok')
