#!/usr/bin/env python3
from __future__ import annotations
import importlib.util,json
from pathlib import Path

BASE=Path(__file__).with_name('v9_build_italy_catalog.py')
spec=importlib.util.spec_from_file_location('v9_build_italy_catalog_base',BASE)
if spec is None or spec.loader is None: raise SystemExit('cannot load Italy V9 builder')
base=importlib.util.module_from_spec(spec); spec.loader.exec_module(base)
original_direct_pricing=base.direct_pricing

def ge_runtime_pricing(tariff):
    if tariff.get('operator')!='Go Electric Stations SRLS' or tariff.get('pricingType')!='components': return None
    if tariff.get('runtimeRankable') is not True or tariff.get('fullCostRankable') is not True or tariff.get('rankable') is not True: return None
    if tariff.get('requiresRuntimeComponentSupport') is not False: return None
    evidence=tariff.get('runtimeTranslation'); runtime=tariff.get('runtimePricing')
    if not isinstance(evidence,dict) or evidence.get('exactPublicUiProofPassed') is not True: return None
    if evidence.get('semanticsQaRun')!=33551150109: return None
    if evidence.get('enginePrimitiveMappingQa')!='existing_v9_primitives_only': return None
    if not isinstance(runtime,dict) or runtime.get('type')!='rules' or not isinstance(runtime.get('rules'),list) or not runtime['rules']: return None
    serialized=json.dumps(runtime,separators=(',',':'))
    if 'connectedTimeSurcharge' in serialized or 'activeLocalWindows' in serialized: return None
    allowed_rule_keys={'scope','start','end','pricePerKwh','sessionFeeEur','connectedTimePerMinuteEur','connectedTimeFreeMinutes','connectedTimePerMinuteAfterFreeEur'}
    for rule in runtime['rules']:
        if not isinstance(rule,dict) or set(rule)-allowed_rule_keys: return None
        if base.finite(rule.get('pricePerKwh')) is None: return None
    fee=runtime.get('postChargeFee')
    if fee is not None:
        if not isinstance(fee,dict) or set(fee)-{'eurPerMinute','graceMinutes','exemptLocalWindows'}: return None
        if base.finite(fee.get('eurPerMinute')) is None: return None
    if set(runtime)-{'type','rules','postChargeFee'}: return None
    comps=tariff.get('priceComponents') or []
    types={str(c.get('type') or '') for c in comps if isinstance(c,dict)}
    if not types or not types <= {'energy','session','time','parking'} or 'energy' not in types: return None
    return runtime

def direct_pricing(tariff):
    pricing=ge_runtime_pricing(tariff)
    return pricing if pricing is not None else original_direct_pricing(tariff)

base.direct_pricing=direct_pricing
if __name__=='__main__': base.main()
