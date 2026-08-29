#!/usr/bin/env python3
import gzip,json,tempfile
from pathlib import Path
from subprocess import run

def dump(path,value):
    p=Path(path);op=gzip.open if p.suffix=='.gz' else open
    with op(p,'wt',encoding='utf-8') as f:json.dump(value,f)
def load(path):
    p=Path(path);op=gzip.open if p.suffix=='.gz' else open
    with op(p,'rt',encoding='utf-8') as f:return json.load(f)
with tempfile.TemporaryDirectory() as d:
    d=Path(d);fb=d/'fallback.json.gz';offers=d/'offers.json.gz';report=d/'report.json'
    dump(fb,[{'canonicalPdcId':'A','rankable':True,'channel':'direct','sourceMode':'network_rule','blockedReasons':[],'selectors':{'fallbackOnly':True}},{'canonicalPdcId':'B','rankable':True,'channel':'direct','sourceMode':'network_rule','blockedReasons':[],'selectors':{'fallbackOnly':True}},{'canonicalPdcId':'C','rankable':False,'channel':'reference','sourceMode':'reference_only','blockedReasons':['ambiguous'],'selectors':{'fallbackOnly':True}}])
    dump(offers,[{'canonicalPdcId':'A','rankable':True},{'canonicalPdcId':'B','rankable':False}])
    run(['python','scripts/finalize_irve_fallback_precedence.py','--fallback',str(fb),'--structured-offers',str(offers),'--report',str(report)],check=True)
    rows=load(fb);r=load(report);by={x['canonicalPdcId']:x for x in rows}
    assert by['A']['rankable'] is False and by['A']['channel']=='reference' and 'structured_exact_pdc_offer_precedence' in by['A']['blockedReasons']
    assert by['B']['rankable'] is True and by['C']['rankable'] is False
    assert r['structuredRankablePdcCount']==1 and r['fallbackSuppressedByStructuredExactPdc']==1
print('IRVE fallback exact-PDC precedence: OK')
