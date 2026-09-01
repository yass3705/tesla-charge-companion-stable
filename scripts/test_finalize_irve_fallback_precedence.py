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
    dump(fb,[{'canonicalPdcId':'A','rankable':True,'channel':'direct','sourceMode':'network_rule','blockedReasons':[],'selectors':{'fallbackOnly':True}},{'canonicalPdcId':'B','rankable':True,'channel':'direct','sourceMode':'network_rule','blockedReasons':[],'selectors':{'fallbackOnly':True}},{'canonicalPdcId':'C','rankable':False,'channel':'reference','sourceMode':'reference_only','blockedReasons':['ambiguous'],'selectors':{'fallbackOnly':True}},{'canonicalPdcId':'D','rankable':True,'channel':'direct','sourceMode':'network_rule','blockedReasons':[],'selectors':{'fallbackOnly':True}}])
    dump(offers,[{'canonicalPdcId':'A','rankable':True,'selectors':{}},{'canonicalPdcId':'B','rankable':False,'selectors':{'blocksGenericFallback':True}},{'canonicalPdcId':'D','rankable':False,'selectors':{}}])
    run(['python','scripts/finalize_irve_fallback_precedence.py','--fallback',str(fb),'--structured-offers',str(offers),'--report',str(report)],check=True)
    rows=load(fb);r=load(report);by={x['canonicalPdcId']:x for x in rows}
    assert by['A']['rankable'] is False and by['A']['channel']=='reference' and 'structured_exact_pdc_offer_precedence' in by['A']['blockedReasons']
    assert by['B']['rankable'] is False and 'structured_exact_pdc_offer_precedence' in by['B']['blockedReasons']
    assert by['C']['rankable'] is False and by['D']['rankable'] is True
    assert r['structuredRankablePdcCount']==1 and r['structuredReferenceBlockerPdcCount']==1
    assert r['structuredPrecedencePdcCount']==2 and r['fallbackSuppressedByStructuredExactPdc']==2
print('IRVE fallback exact-PDC precedence: OK')
