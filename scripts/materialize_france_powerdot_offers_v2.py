#!/usr/bin/env python3
"""Powerdot materializer v2: safe support for multi-element ENERGY + TIME tariffs."""
from collections import Counter
import materialize_france_powerdot_offers as base


def convert_tariff(tariff):
    blocked=[]; warnings=[]; components=base.empty_components()
    currency=base.clean((tariff or {}).get('currencyCode')).upper() or 'EUR'
    if currency!='EUR':blocked.append(f'unsupported_currency:{currency}')
    if (tariff or {}).get('subscriptionActive') is True:blocked.append('subscription_tariff_in_direct_source')
    elements=(tariff or {}).get('elements') or []
    if not elements:
        blocked.append('missing_tariff_elements')
        return components,currency,sorted(set(blocked)),warnings
    seen=Counter()
    for element in elements:
        element=element or {}; restrictions=element.get('restrictions') or {}
        unknown=sorted(base.restriction_keys(restrictions)-{'minDurationSec'})
        blocked.extend(f'unsupported_restriction:{key}' for key in unknown)
        threshold_sec=base.number(restrictions.get('minDurationSec')) or 0
        for component in element.get('priceComponents') or []:
            ctype=base.clean(component.get('type')).upper(); price=base.number(component.get('pricePerUnit'))
            if not ctype:
                blocked.append('missing_component_type');continue
            if price is None or price<0:
                blocked.append(f'invalid_price:{ctype}');continue
            if ctype=='ENERGY':
                seen['ENERGY']+=1
                if seen['ENERGY']>1:blocked.append('duplicate_component_type:ENERGY');continue
                if threshold_sec>0:blocked.append('energy_with_duration_restriction_not_supported');continue
                components['pricePerKwh']=price
            elif ctype=='FLAT':
                seen['FLAT']+=1
                if seen['FLAT']>1:blocked.append('duplicate_component_type:FLAT');continue
                if threshold_sec>0:blocked.append('flat_with_duration_restriction_not_supported');continue
                components['connectionFee']=price
            elif ctype=='TIME':
                key='TIME_THRESHOLD' if threshold_sec>0 else 'TIME_CONTINUOUS'; seen[key]+=1
                if seen[key]>1:
                    blocked.append('multiple_time_tiers_not_supported' if threshold_sec>0 else 'duplicate_continuous_time_component');continue
                if threshold_sec>0:
                    components['durationPerMinute']=price;components['durationThresholdMinutes']=threshold_sec/60.0
                else:components['chargePerMinute']=price
            elif ctype=='PARKING_TIME':blocked.append('parking_time_semantics_not_validated')
            else:blocked.append(f'unsupported_component_type:{ctype}')
    if seen['ENERGY']!=1:blocked.append('energy_component_required_once')
    if not (components['pricePerKwh']>0):blocked.append('positive_energy_price_required')
    return components,currency,sorted(set(blocked)),warnings

base.convert_tariff=convert_tariff
if __name__=='__main__':base.main()
