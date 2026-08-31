#!/usr/bin/env python3
import json
from pathlib import Path

p=Path('data/v9/germany-direct-offers-swu-extension.json')
d=json.loads(p.read_text())
assert d['country']=='DE' and d['preIntegrationOnly'] is True
o={x['id']:x for x in d['directOffers']}
assert set(o)=={'swu-de-ad-hoc-ac','swu-de-ad-hoc-dc','swu-ladestrom-classic-ac','swu-ladestrom-classic-dc'}
price=lambda x:x['pricing']['rules'][0]['pricePerKwh']
assert price(o['swu-de-ad-hoc-ac'])==0.64
assert price(o['swu-de-ad-hoc-dc'])==0.74
assert price(o['swu-ladestrom-classic-ac'])==0.47
assert price(o['swu-ladestrom-classic-dc'])==0.57
for k in ('swu-ladestrom-classic-ac','swu-ladestrom-classic-dc'):
 s=o[k]['subscription']
 assert s['monthlyFee']==5.0 and s['currency']=='EUR'
 assert s['feeComponents']==[{'type':'account','monthlyFee':2.5},{'type':'card','monthlyFee':2.5,'quantityAssumed':1}]
assert o['swu-de-ad-hoc-ac']['excludedSiteIds']==['SITE-eea515530c6134eb0f4c']
assert 'excludedSiteIds' not in o['swu-de-ad-hoc-dc']
r=d['deferredRoaming']
assert r['standard']['acPricePerKwh']==0.65 and r['standard']['dcPricePerKwh']==0.75
assert r['specialNetworks']['dcPricePerKwh']==0.84
assert r['standard']['acBlockingFee']=={'afterMinutes':180,'pricePerMinute':0.1}
assert r['standard']['dcBlockingFee']=={'afterMinutes':60,'pricePerMinute':0.1}
print(json.dumps({'country':'DE','provider':'SWU','offers':len(o),'adHoc':[0.64,0.74],'classic':[0.47,0.57],'minimumMonthlyFeeOneCard':5.0,'excludedAdHocSite':'SITE-eea515530c6134eb0f4c','status':'ok'}))
