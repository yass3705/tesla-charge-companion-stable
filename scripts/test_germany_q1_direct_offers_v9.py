#!/usr/bin/env python3
import json
from pathlib import Path
p=Path('data/v9/germany-direct-offers-q1-extension.json')
d=json.loads(p.read_text()); offers=d['directOffers']; by={o['id']:o for o in offers}
assert set(by)=={'q1-card-own-ac','q1-card-own-dc'}
def price(i): return by[i]['pricing']['rules'][0]['pricePerKwh']
assert price('q1-card-own-ac')==0.44
assert price('q1-card-own-dc')==0.539
assert all(o['selectionId']=='q1-card' for o in offers)
assert all(o.get('directOperatorOnly') is True for o in offers)
assert all('Q1 Energie AG' in o.get('operatorAliases',[]) for o in offers)
assert all(o.get('subscription',{}).get('monthlyFee')==0 for o in offers)
assert all(o.get('subscription',{}).get('oneTimeCardFee')==0 for o in offers)
for forbidden in ('EWE Go','SachsenEnergie','Westfalen Weser','Shell Recharge','EnBW mobility+'):
 assert all(forbidden not in (o.get('operatorAliases',[])+o.get('networkAliases',[])) for o in offers), forbidden
assert 'Third-party' in d.get('roamingPolicy','') or 'third-party' in d.get('roamingPolicy','')
print(json.dumps({'operator':'Q1 Energie AG','offers':2,'AC':0.44,'DC':0.539,'monthlyFee':0,'ownNetworkOnly':True,'status':'ok'},indent=2,ensure_ascii=False))
