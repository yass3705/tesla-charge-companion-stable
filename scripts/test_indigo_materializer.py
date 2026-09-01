#!/usr/bin/env python3
from materialize_france_indigo_offers import materialize


def source():
    return {
        "schemaVersion": "1.1.1",
        "dataset": "indigo-recharge-direct-tariffs-france",
        "networkId": "indigo",
        "country": "FR",
        "verifiedAt": "2026-08-28",
        "source": "https://www.indigoneo.fr/fr/recharge-electrique",
        "scope": {
            "directNetworkOnly": True,
            "physicalInventoryFromIrveOnly": True,
            "parkingExcludedFromChargingTariff": True,
            "standardTariffsApplyToMostEquippedIndigoCarParks": True,
        },
        "subscriptions": [
            {"id":"indigo-recharge-a-la-carte","rankableWhenSelected":True},
            {"id":"indigo-recharge-100","rankableWhenSelected":False,"blockedReason":"monthly_remaining_quota_not_tracked"},
        ],
        "offers": [
            {
                "id":"indigo-public-standard","channel":"direct","provider":"INDIGO public",
                "selectors":{"excludeCities":["Biarritz","Nevers","Saint-Germain-en-Laye","Tours"]},
                "pricingRules":[{"currency":"EUR","pricePerKwh":0.55,"connectionFee":0.99,"durationPerMinute":0.10,"durationThresholdMinutes":600}],
                "rankable":True,
            },
            {
                "id":"indigo-a-la-carte-standard","channel":"subscription","subscriptionId":"indigo-recharge-a-la-carte","provider":"INDIGO ALC",
                "selectors":{"excludeCities":["Biarritz","Nevers","Saint-Germain-en-Laye","Tours"]},
                "pricingRules":[{"currency":"EUR","pricePerKwh":0.45,"connectionFee":0.49,"durationPerMinute":0.05,"durationThresholdMinutes":600}],
                "rankable":True,
            },
            {
                "id":"indigo-a-la-carte-legacy-city","channel":"subscription","subscriptionId":"indigo-recharge-a-la-carte","provider":"INDIGO ALC legacy",
                "selectors":{"cities":["Biarritz","Nevers","Saint Germain en Laye","Tours"]},
                "pricingRules":[{"currency":"EUR","pricePerKwh":0.30,"durationPerMinute":0.03,"durationThresholdMinutes":0}],
                "rankable":True,
            },
            {
                "id":"indigo-public-legacy-city-unresolved","channel":"reference","provider":"INDIGO public exception",
                "selectors":{"cities":["Biarritz","Nevers","Saint-Germain-en-Laye","Tours"]},
                "pricingRules":[],"rankable":False,"blockedReasons":["public_ad_hoc_tariff_not_explicitly_stated_for_legacy_city_exception"],
            },
            {
                "id":"indigo-monthly-quota-reference","channel":"reference","provider":"INDIGO quota",
                "selectors":{"excludeCities":["Biarritz","Nevers","Saint-Germain-en-Laye","Tours"]},
                "pricingRules":[],"rankable":False,"blockedReasons":["monthly_remaining_quota_not_tracked"],
            },
        ],
    }


stations = [
    {"stationId":"STD","tariffNetworkId":"indigo","physicalOperatorId":"indigo","codeInsee":"75056"},
    {"stationId":"LEG","tariffNetworkId":"indigo","physicalOperatorId":"indigo","codeInsee":"78551"},
    {"stationId":"OTHER","tariffNetworkId":"freshmile","physicalOperatorId":"freshmile","codeInsee":"75056"},
]
pdcs = [
    {"pdcId":"P1","stationId":"STD","tariffNetworkId":"indigo"},
    {"pdcId":"P2","stationId":"LEG","tariffNetworkId":"indigo"},
    {"pdcId":"P3","stationId":"OTHER","tariffNetworkId":"freshmile"},
]

offers, subscriptions, summary = materialize(source(), stations, pdcs, normalized_at="2026-08-31T00:00:00+00:00")
assert len(subscriptions) == 2
assert summary["canonicalIndigoStationCount"] == 2
assert summary["canonicalIndigoPdcCount"] == 2
assert summary["rankableCoveredStationCount"] == 2
assert summary["physicalInventoryMutationCount"] == 0
assert all(row["canonicalStationId"] in {"STD","LEG"} for row in offers)
assert all(row["tariffNetworkId"] == "indigo" for row in offers)

std = {row["offerId"].split(":")[0]: row for row in offers if row["canonicalStationId"] == "STD"}
leg = {row["offerId"].split(":")[0]: row for row in offers if row["canonicalStationId"] == "LEG"}
assert std["indigo-public-standard"]["rankable"] is True
assert std["indigo-a-la-carte-standard"]["rankable"] is True
assert std["indigo-monthly-quota-reference"]["rankable"] is False
assert "indigo-a-la-carte-legacy-city" not in std
assert "indigo-public-legacy-city-unresolved" not in std

assert leg["indigo-a-la-carte-legacy-city"]["rankable"] is True
assert leg["indigo-public-legacy-city-unresolved"]["rankable"] is False
assert "indigo-public-standard" not in leg
assert "indigo-a-la-carte-standard" not in leg
assert "indigo-monthly-quota-reference" not in leg

print("Indigo canonical materializer tests OK")
