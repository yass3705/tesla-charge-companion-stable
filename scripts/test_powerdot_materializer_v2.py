#!/usr/bin/env python3
from materialize_france_powerdot_offers_v2 import convert_tariff

def elem(ctype,price,restrictions=None):
    return {'restrictions':restrictions or {},'priceComponents':[{'type':ctype,'pricePerUnit':price}]}
def tariff(elements):return {'currencyCode':'EUR','subscriptionActive':False,'elements':elements}

# Real Powerdot shape: unrestricted energy plus a separate time surcharge after a threshold.
c,cur,blocked,_=convert_tariff(tariff([elem('ENERGY',.58),elem('TIME',.05,{'minDurationSec':3600})]))
assert cur=='EUR' and blocked==[]
assert c['pricePerKwh']==.58 and c['durationPerMinute']==.05 and c['durationThresholdMinutes']==60
assert c['chargePerMinute']==0

# Element restrictions apply to every component in that element: restricted ENERGY is not flattened.
c,_,blocked,_=convert_tariff({'currencyCode':'EUR','subscriptionActive':False,'elements':[{'restrictions':{'minDurationSec':3600},'priceComponents':[{'type':'ENERGY','pricePerUnit':.58},{'type':'TIME','pricePerUnit':.05}]}]})
assert 'energy_with_duration_restriction_not_supported' in blocked

# Continuous TIME and one later surcharge are both representable.
c,_,blocked,_=convert_tariff(tariff([elem('ENERGY',.47),elem('TIME',.01),elem('TIME',.04,{'minDurationSec':7200})]))
assert blocked==[] and c['chargePerMinute']==.01 and c['durationPerMinute']==.04 and c['durationThresholdMinutes']==120

# Multiple threshold tiers cannot fit the current TCC component contract and remain blocked.
_,_,blocked,_=convert_tariff(tariff([elem('ENERGY',.47),elem('TIME',.04,{'minDurationSec':1800}),elem('TIME',.05,{'minDurationSec':3600})]))
assert 'multiple_time_tiers_not_supported' in blocked

_,_,blocked,_=convert_tariff(tariff([elem('ENERGY',.47),elem('PARKING_TIME',.02)]))
assert 'parking_time_semantics_not_validated' in blocked

sub=tariff([elem('ENERGY',.47)]);sub['subscriptionActive']=True
_,_,blocked,_=convert_tariff(sub)
assert 'subscription_tariff_in_direct_source' in blocked
print('Powerdot materializer v2 multi-element semantics: OK')
