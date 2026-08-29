#!/usr/bin/env python3
import json,subprocess,tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/'data/v9/subscription-entitlements-global.json'

with tempfile.TemporaryDirectory() as td:
    td=Path(td);compiled={};reports={}
    for country in ('FR','ES','NL'):
        out=td/f'{country}.json';report=td/f'{country}-report.json'
        subprocess.run(['python',str(ROOT/'scripts/compile_global_subscriptions_v9.py'),'--input',str(SRC),'--country',country,'--out',str(out),'--report-out',str(report)],check=True)
        compiled[country]=json.loads(out.read_text(encoding='utf-8'));reports[country]=json.loads(report.read_text(encoding='utf-8'))

    fr=compiled['FR']['subscriptionOffers'];es=compiled['ES']['subscriptionOffers'];nl=compiled['NL']['subscriptionOffers']
    assert all(x['selectionId']==x['subscriptionId'] for x in fr+es+nl)
    assert any(x['subscriptionId']=='atlante-go' and x['countries']==['FR'] and x['pricing']['rules'][0]['pricePerKwh']==0.42 for x in fr)
    assert any(x['subscriptionId']=='atlante-go' and x['countries']==['ES'] and x['pricing']['rules'][0]['pricePerKwh']==0.49 for x in es)
    assert any(x['subscriptionId']=='fastned-gold' and x['pricing']['rules'][0]['pricePerKwh']==0.43 for x in fr)
    assert any(x['subscriptionId']=='fastned-gold' and x['pricing']['rules'][0]['pricePerKwh']==0.41 for x in es)
    assert any(x['subscriptionId']=='fastned-gold' and x['pricing']['rules'][0]['pricePerKwh']==0.54 for x in nl)
    assert any(x['subscriptionId']=='electra-plus-smart' and x['countries']==['ES'] and x['pricing']['rules'][0]['pricePerKwh']==0.54 and 'Fastned' in x['networkAliases'] for x in es)
    assert any(x['subscriptionId']=='electra-plus-smart' and x['countries']==['FR'] and x['pricing']['rules'][0]['pricePerKwh']==0.49 and 'IONITY' in x['networkAliases'] for x in fr)
    assert any(x['subscriptionId']=='electra-plus-essential' and x['reason']=='price_not_materialized' and x['benefit'].get('discountPerKwh')==0.1 for x in reports['ES']['deferred'])
    assert any(x['subscriptionId']=='electra-plus-smart' and x['reason']=='price_not_materialized' and x['benefit'].get('discountPerKwh')==0.2 for x in reports['ES']['deferred'])
    assert any(x['subscriptionId']=='ionity-motion' and x['pricing']['rules'][0]['pricePerKwh']==0.54 for x in nl)
    assert any(x['subscriptionId']=='ionity-power' and x['pricing']['rules'][0]['pricePerKwh']==0.43 for x in nl)
    assert not any(x['subscriptionId'].startswith('repsol-') for x in es)
    assert any(x['subscriptionId']=='wenea-everyday' and x['reason']=='price_not_materialized' for x in reports['ES']['deferred'])
    assert any(x['subscriptionId']=='repsol-movilidad-100' and x['reason']=='price_not_materialized' for x in reports['ES']['deferred'])
    assert any(x['subscriptionId']=='totalenergies-chargeplus-smart-es' and x['reason']=='price_not_materialized' and x['benefit'].get('discountPercent')==10 for x in reports['ES']['deferred'])
    assert any(x['subscriptionId']=='electroverse-ionity' and x['reason']=='price_not_materialized' and x['benefit'].get('discountPercent')==40 for x in reports['ES']['deferred'])
    assert any(x['subscriptionId']=='electroverse-powerdot' and x['reason']=='price_not_materialized' and x['benefit'].get('discountPercent')==29 for x in reports['ES']['deferred'])
    assert any(x['subscriptionId']=='electroverse-iberdrola-bp-pulse-es' and x['reason']=='price_not_materialized' and x['benefit'].get('discountPercent')==22 for x in reports['ES']['deferred'])
    common=set(x['subscriptionId'] for x in fr)&set(x['subscriptionId'] for x in es)
    assert {'atlante-go','fastned-gold','zunder-easy','zunder-pro','electra-plus-smart'}<=common
    deferred_common=set(x['subscriptionId'] for x in reports['FR']['deferred'])&set(x['subscriptionId'] for x in reports['ES']['deferred'])
    assert {'electroverse-ionity','electroverse-powerdot'}<=deferred_common
print('Global V9 subscription contract OK')
