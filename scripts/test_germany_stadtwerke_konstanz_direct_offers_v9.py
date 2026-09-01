#!/usr/bin/env python3
import json
from pathlib import Path
p=json.loads(Path('data/v9/germany-direct-offers-stadtwerke-konstanz-extension.json').read_text())
o={x['id']:x for x in p['directOffers']}
assert len(o)==4
assert all(x.get('directOperatorOnly') is True for x in o.values())
assert all(x.get('defaultSelected') is False for x in o.values())
assert all('Stadtwerke Konstanz Mobil GmbH' in x.get('operatorAliases',[]) for x in o.values())
def price(x): return x['pricing']['rules'][0]['pricePerKwh']
assert price(o['stadtwerke-konstanz-card-own-network'])==0.44
assert price(o['stadtwerke-konstanz-card-green-customer'])==0.44
assert price(o['stadtwerke-konstanz-card-fairplus'])==0.44
assert price(o['stadtwerke-konstanz-ladeapp-own-network'])==0.54
assert o['stadtwerke-konstanz-card-own-network']['subscription']['monthlyFee']==9.0
assert o['stadtwerke-konstanz-card-green-customer']['subscription']['monthlyFee']==6.0
assert o['stadtwerke-konstanz-card-fairplus']['subscription']['monthlyFee']==3.0
r=p['roamingDeferred']['ladenetz']
assert r['acPricePerKwh']==0.65 and r['dcPricePerKwh']==0.79
print(json.dumps({'operator':'Stadtwerke Konstanz Mobil GmbH','offers':4,'ownCardPrice':0.44,'ladeappPrice':0.54,'monthlyFees':[9,6,3],'roamingSeparated':True,'status':'ok'}))
