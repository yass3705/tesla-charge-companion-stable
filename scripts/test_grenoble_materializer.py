#!/usr/bin/env python3
from __future__ import annotations
import importlib.util
from pathlib import Path

SCRIPT=Path(__file__).with_name('materialize_france_grenoble_offers.py')
spec=importlib.util.spec_from_file_location('grenoble_materializer',SCRIPT)
mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def pdc(power,ccs='false',chademo='false'):
    return {'powerKw':power,'connectors':{'comboCcs':ccs,'chademo':chademo}}

assert mod.is_ac_slow(pdc(7.36)) is True
assert mod.is_ac_slow(pdc(7.4)) is True
assert mod.is_ac_slow(pdc(7.41)) is False
assert mod.is_ac_slow(pdc(7.36,'true')) is False
assert mod.is_ac_slow(pdc(50,'true')) is False
review=mod.load_json(Path(__file__).parents[1]/'data'/'grenoble_alpes_metropole_tariff_review_20260901.json')
sub,pg,safe=mod.validate_review(review)
assert sub['monthlyFeeEur']==6.0 and sub['optIn'] is True
assert safe['pricePerKwh']==0.29 and safe['subscriptionId']=='grenoble-oura'
assert pg['nonSubscriber']['rankable'] is False
print('Grenoble materializer regression tests OK')
