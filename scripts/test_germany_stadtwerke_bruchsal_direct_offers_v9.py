#!/usr/bin/env python3
import json
from pathlib import Path
p=Path('data/v9/germany-direct-offers-stadtwerke-bruchsal-extension.json')
d=json.loads(p.read_text())
o={x['id']:x for x in d['directOffers']}
assert d['country']=='DE' and d['preIntegrationOnly'] is True
assert len(o)==4
assert o['stadtwerke-bruchsal-eladen-ac']['pricing']['rules'][0]['pricePerKwh']==0.45
assert o['stadtwerke-bruchsal-eladen-dc']['pricing']['rules'][0]['pricePerKwh']==0.65
assert o['stadtwerke-bruchsal-adhoc-ac']['pricing']['rules'][0]['pricePerKwh']==0.57
assert o['stadtwerke-bruchsal-adhoc-dc']['pricing']['rules'][0]['pricePerKwh']==0.77
for x in o.values():
 assert x['operatorAliases']==['Energie- und Wasserversorgung Bruchsal GmbH']
 assert x['directOperatorOnly'] is True
 assert x['defaultSelected'] is False
 assert x['currency']=='EUR'
 assert 'subscription' not in x
ac=o['stadtwerke-bruchsal-eladen-ac']['blockingFee']; dc=o['stadtwerke-bruchsal-eladen-dc']['blockingFee']
assert ac['afterMinutes']==241 and ac['pricePerMinute']==0.10 and ac['capPerSession']==18.0
assert ac['activeWindows']==[{'start':'06:00','end':'22:00'}]
assert dc['afterMinutes']==61 and dc['pricePerMinute']==0.10 and dc['capPerSession']==18.0
for i in ('stadtwerke-bruchsal-adhoc-ac','stadtwerke-bruchsal-adhoc-dc'):
 f=o[i]['blockingFee']; assert f['afterMinutes']==61 and f['pricePerMinute']==0.10 and 'capPerSession' not in f
assert d['roamingDeferred']['registeredCardApp']['acPricePerKwh']==0.55
assert d['roamingDeferred']['registeredCardApp']['dcPricePerKwh']==0.90
print(json.dumps({'operator':'Stadtwerke Bruchsal','offers':len(o),'eLaden':[0.45,0.65],'adHoc':[0.57,0.77],'status':'ok'}))
