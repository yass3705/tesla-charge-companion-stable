#!/usr/bin/env python3
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
status=json.loads((ROOT/'data/v9/spain-ready-for-reve.json').read_text(encoding='utf-8'))
registry=json.loads((ROOT/'data/v9/subscription-entitlements-global.json').read_text(encoding='utf-8'))

assert status['country']=='ES'
assert status['status']=='READY_FOR_REVE'
assert status['runtimeIntegration'] is False
assert status['publication'] is False
assert status['decisions']['tesla']['primarySource']=='existing-tesla-spain-feed'
assert status['decisions']['nationalDynamic']['apiKeyRequired'] is True
assert status['decisions']['subscriptions']['percentDiscountWithoutBasePriceRankable'] is False
assert status['decisions']['endesa']['countryScope']==['ES']
assert status['decisions']['endesa']['crossBorderInferred'] is False
assert status['decisions']['moeve']['countryScope']==['ES']
assert status['decisions']['moeve']['monthlyFeeEur']==9
assert status['decisions']['moeve']['discountPercent']==25
assert status['decisions']['moeve']['partnerOrCrossBorderInferred'] is False
blocked=' | '.join(status['blockedByReve']).lower()
for token in ('response schemas','locations','connectors/tariffs','operational status','redistribution/licensing'):
    assert token in blocked, token
plans={p['id']:p for p in registry.get('plans',[])}
for sid in ('fastned-gold','atlante-go','electra-plus-smart','totalenergies-chargeplus-smart-es','electroverse-ionity','electroverse-powerdot','electroverse-iberdrola-bp-pulse-es'):
    assert sid in plans, sid
assert not any(p.get('provider')=='Freshmile' for p in registry.get('plans',[])), 'Freshmile generic subscription must not be invented'
print('Spain V9 READY_FOR_REVE contract OK')
