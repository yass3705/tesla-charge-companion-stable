#!/usr/bin/env python3
import json
from decimal import Decimal
from pathlib import Path

p=Path('data/v9/germany-direct-offers-westfalen-extension.json')
d=json.loads(p.read_text())
assert d['country']=='DE'
assert d['preIntegrationOnly'] is True
assert d['sourcePriceBasis']=='net_plus_19_percent_vat'
offers=d['directOffers']
assert len(offers)==2
by_kind={tuple(o['connectorKinds']):o for o in offers}
ac=by_kind[('AC',)];dc=by_kind[('DC',)]
assert Decimal(str(ac['pricing']['rules'][0]['pricePerKwh']))==Decimal('0.4641')
assert Decimal(str(dc['pricing']['rules'][0]['pricePerKwh']))==Decimal('0.5593')
assert ac['maxPowerKw']==22
for o in offers:
 assert o['selectionId']=='westfalen-service-card-echarge'
 assert o['directOperatorOnly'] is True
 assert o['eligibility']['businessOnly'] is True
 assert Decimal(str(o['subscription']['monthlyFee']))==Decimal('4.165')
 assert 'Westfalen AG & Co. KG' in o['operatorAliases']
 assert 'MER' not in o['operatorAliases'] and 'EnBW' not in o['operatorAliases']
 assert o['defaultSelected'] is False
r=d['roamingDeferred']
assert r['provider']=='Westfalen Service Card + eCharge'
assert r['officialNetPrices']['thirdParty']['ac']==0.49
assert r['officialNetPrices']['thirdParty']['dc']==0.66
assert r['officialNetPrices']['enbwMer']['ac']==0.65
assert r['officialNetPrices']['enbwMer']['dc']==0.75
print(json.dumps({'operator':'Westfalen AG & Co. KG','ownNetworkOffers':len(offers),'grossPrices':{'AC':0.4641,'DC':0.5593},'monthlyFeeGross':4.165,'businessOnly':True,'roamingSeparated':True},indent=2))
