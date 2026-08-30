#!/usr/bin/env python3
import json,sys
from pathlib import Path
p=Path(sys.argv[1] if len(sys.argv)>1 else 'build/germany-direct-offers.json')
d=json.loads(p.read_text());offers=d['directOffers']

def matches(operator):
 o=operator.casefold()
 return [x for x in offers if any(a.casefold()==o for a in x.get('operatorAliases',[])) or any(a.casefold()==o for a in x.get('networkAliases',[]))]

def providers(operator): return {x['provider'] for x in matches(operator)}
fast=providers('Fastned');ion=providers('IONITY');aral=providers('Aral pulse');enbw=providers('EnBW mobility+')
assert fast and all('Fastned' in x for x in fast),fast
assert ion and all('IONITY' in x for x in ion),ion
assert aral and all('Aral pulse' in x for x in aral),aral
assert enbw and all('EnBW mobility+' in x for x in enbw),enbw
assert not providers('Tesla'), 'Tesla must never attach Germany non-Tesla direct offers'
# exact expected selections currently staged
assert {'fastned-de-standard','fastned-de-app-promo','fastned-gold'} <= {x['selectionId'] for x in matches('Fastned')}
assert {'ionity-de-direct','ionity-de-go','ionity-motion','ionity-power'} <= {x['selectionId'] for x in matches('IONITY')}
assert {'aral-pulse-de-ad-hoc','aral-pulse-klassik','aral-pulse-extra','aral-pulse-adac-e-charge'} <= {x['selectionId'] for x in matches('Aral pulse')}
assert {'enbw-mobility-plus-s','enbw-mobility-plus-m','enbw-mobility-plus-l'} == {x['selectionId'] for x in matches('EnBW mobility+')}
# EnBW attachment remains direct-network-only; partner CPO roaming is not represented here.
assert all(x.get('directOperatorOnly') is True for x in matches('EnBW mobility+'))
print(json.dumps({'Fastned':len(matches('Fastned')),'IONITY':len(matches('IONITY')),'Aral pulse':len(matches('Aral pulse')),'EnBW':len(matches('EnBW mobility+'))},indent=2))
