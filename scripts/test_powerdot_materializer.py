#!/usr/bin/env python3
from materialize_france_powerdot_offers import convert_tariff


def tariff(components, restrictions=None):
    return {
        "currencyCode": "EUR",
        "subscriptionActive": False,
        "elements": [{
            "restrictions": restrictions or {},
            "priceComponents": components,
        }],
    }


energy, currency, blocked, _ = convert_tariff(tariff([
    {"type": "ENERGY", "pricePerUnit": 0.43},
]))
assert currency == "EUR"
assert blocked == []
assert energy["pricePerKwh"] == 0.43

mixed, _, blocked, _ = convert_tariff(tariff([
    {"type": "ENERGY", "pricePerUnit": 0.35},
    {"type": "TIME", "pricePerUnit": 0.05},
], {"minDurationSec": 3600}))
assert blocked == []
assert mixed["pricePerKwh"] == 0.35
assert mixed["durationPerMinute"] == 0.05
assert mixed["durationThresholdMinutes"] == 60
assert mixed["chargePerMinute"] == 0

continuous, _, blocked, _ = convert_tariff(tariff([
    {"type": "ENERGY", "pricePerUnit": 0.47},
    {"type": "TIME", "pricePerUnit": 0.01},
]))
assert blocked == []
assert continuous["chargePerMinute"] == 0.01
assert continuous["durationPerMinute"] == 0

flat, _, blocked, _ = convert_tariff(tariff([
    {"type": "ENERGY", "pricePerUnit": 0.58},
    {"type": "FLAT", "pricePerUnit": 1.0},
]))
assert blocked == []
assert flat["connectionFee"] == 1.0

parking, _, blocked, _ = convert_tariff(tariff([
    {"type": "ENERGY", "pricePerUnit": 0.35},
    {"type": "PARKING_TIME", "pricePerUnit": 0.02},
]))
assert "parking_time_semantics_not_validated" in blocked

unsupported, _, blocked, _ = convert_tariff(tariff([
    {"type": "ENERGY", "pricePerUnit": 0.35},
], {"startTime": "08:00"}))
assert "unsupported_restriction:startTime" in blocked

sub = tariff([{"type": "ENERGY", "pricePerUnit": 0.35}])
sub["subscriptionActive"] = True
_, _, blocked, _ = convert_tariff(sub)
assert "subscription_tariff_in_direct_source" in blocked

print("Powerdot materializer tariff semantics: OK")
