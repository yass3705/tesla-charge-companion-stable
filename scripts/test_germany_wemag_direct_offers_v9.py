#!/usr/bin/env python3
import json
from pathlib import Path

p=Path('data/v9/germany-direct-offers-wemag-extension.json')
d=json.loads(p.read_text())
assert d.get('country')=='DE'
assert d.get('preIntegrationOnly') is True
offers={o['id']:o for o in d.get('directOffers',[])}
expected={'wemag-ad-hoc-ac','wemag-ad-hoc-dc','wemag-app-card-ac','wemag-app-card-dc'}
assert set(offers)==expected, set(offers)

def price(oid):
 rules=offers[oid]['pricing']['rules']
 assert len(rules)==1
 r=rules[0]
 assert r['billing']=='kwh' and r['currency']=='EUR'
 return r['pricePerKwh']

assert price('wemag-ad-hoc-ac')==0.69
assert price('wemag-ad-hoc-dc')==0.79
assert price('wemag-app-card-ac')==0.49
assert price('wemag-app-card-dc')==0.65
for o in offers.values():
 assert o.get('directOperatorOnly') is True
 assert o.get('defaultSelected') is False
 assert 'WEMAG AG' in o.get('operatorAliases',[])
 assert 'blockingFee' not in o
 assert 'sessionFee' not in o
for oid in ('wemag-app-card-ac','wemag-app-card-dc'):
 s=offers[oid]['subscription']
 assert s['monthlyFee']==0.0
 assert s['currency']=='EUR'
 assert s['optionalPhysicalCardFee']==9.99
 assert s['optionalKeyFobFee']==14.99
 assert 'oneTimeCardFee' not in s, 'physical card must remain optional because app works without it'
assert 'partner' in d['roamingPolicy'].lower()
print(json.dumps({'operator':'WEMAG AG','offers':4,'adHoc':[0.69,0.79],'appCard':[0.49,0.65],'monthlyFee':0.0,'optionalPhysicalCardFee':9.99,'blockingFee':False,'status':'ok'}))
