#!/usr/bin/env python3
"""Materialize official TotalEnergies France tariff families on canonical PDCs.

Conservative V9 rules:
- PAN IRVE remains the only physical inventory.
- Only canonical PDCs with tariffNetworkId ``totalenergies`` are considered.
- The published 0.52/0.62 EUR/kWh tariff is a *station-service* tariff family,
  not a guarantee for every TotalEnergies concession/public network. It is
  therefore reference-only until station-service scope is proven.
- Charge+ Zen is a 15% subscription discount, not a flat 0.49 EUR/kWh tariff.
  It remains reference-only until official eligible-station/PDC identity and
  the underlying public price are both resolved.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
from collections import Counter
from pathlib import Path


def clean(value):
    return str(value or "").strip()


def number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def load_json(path):
    path = Path(path)
    if path.suffix == ".gz":
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            return json.load(handle)
    return json.loads(path.read_text(encoding="utf-8"))


def dump_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix == ".gz":
        with gzip.open(path, "wt", encoding="utf-8", compresslevel=9) as handle:
            json.dump(value, handle, ensure_ascii=False, separators=(",", ":"))
    else:
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def validate_source(data):
    if data.get("dataset") != "totalenergies-official-france" or data.get("country") != "FR":
        raise ValueError("unexpected TotalEnergies source")
    classification = data.get("classification") or {}
    if classification.get("singleNationalOperatorTariff") is not False:
        raise ValueError("TotalEnergies source no longer distinguishes tariff families")

    station_service = (data.get("operatorDirect") or {}).get("stationServiceFrance") or {}
    if number(station_service.get("upToAndIncluding50KwEurPerKwh")) != 0.52:
        raise ValueError("TotalEnergies <=50 kW station-service tariff changed")
    if number(station_service.get("over50KwEurPerKwh")) != 0.62:
        raise ValueError("TotalEnergies >50 kW station-service tariff changed")
    occupation = station_service.get("occupationFee") or {}
    if number(occupation.get("eurPerMin")) != 0.5 or number(occupation.get("startsAfterConsecutiveConnectedMinutes")) != 45:
        raise ValueError("TotalEnergies station-service occupation fee changed")

    charge_plus = (data.get("mobilityProvider") or {}).get("chargePlus") or {}
    if charge_plus.get("classification") != "eMSP_roaming" or charge_plus.get("operatorDirect") is not False:
        raise ValueError("Charge+ must remain separate from CPO-direct pricing")
    zen = charge_plus.get("zen") or {}
    if number(zen.get("monthlyFeeEur")) != 3.9 or number(zen.get("discountPercent")) != 15.0:
        raise ValueError("Charge+ Zen current terms changed")
    if number(zen.get("minimumPowerKw")) != 50:
        raise ValueError("Charge+ Zen power threshold changed")
    eligible = data.get("zenEligibleInventory") or {}
    if eligible.get("stationLevelEligibilityListAvailable") is not True:
        raise ValueError("Charge+ Zen official eligible-station list no longer declared")
    return station_service, zen


def station_service_reference(pdc, station, source, station_service, normalized_at):
    pid = clean(pdc.get("pdcId"))
    sid = clean(pdc.get("stationId"))
    power = number(pdc.get("powerKw"))
    price = None
    band = "power_unresolved"
    if power is not None:
        if power <= 50:
            price = number(station_service.get("upToAndIncluding50KwEurPerKwh"))
            band = "up_to_and_including_50kw"
        else:
            price = number(station_service.get("over50KwEurPerKwh"))
            band = "over_50kw"
    occ = station_service.get("occupationFee") or {}
    reasons = ["station_service_scope_unresolved"]
    if price is None:
        reasons.append("pdc_power_unresolved")
    return {
        "offerId": f"totalenergies-station-service-reference:{pid}",
        "physicalOperatorId": pdc.get("physicalOperatorId") or station.get("physicalOperatorId"),
        "tariffNetworkId": "totalenergies",
        "provider": "TotalEnergies station-service direct",
        "channel": "direct",
        "sourceMode": "network_family_reference",
        "sourceStationId": None,
        "sourceEvseId": None,
        "canonicalStationId": sid,
        "canonicalPdcId": pid,
        "matchMethod": "tariff_network_scope_reference_only",
        "matchDistanceMeters": None,
        "selectors": {"tariffFamily": "station_service_france", "powerBand": band},
        "kind": None,
        "minPowerKw": None,
        "maxPowerKw": None,
        "pricingRules": [{
            "scope": "allDay",
            "start": "00:00",
            "end": "24:00",
            "days": None,
            "currency": "EUR",
            "pricePerKwh": price,
            "chargePerMinute": 0,
            "connectionFee": number(station_service.get("sessionFeeEur")) or 0,
            "durationPerMinute": 0,
            "durationThresholdMinutes": 0,
            "occupancyPerMinute": number(occ.get("eurPerMin")),
            "occupancyThresholdMinutes": number(occ.get("startsAfterConsecutiveConnectedMinutes")),
            "occupancyCap": None,
            "parkingPerMinute": 0,
            "notes": "Official station-service tariff family only; do not apply to concessions/public networks without explicit station-service identity.",
        }],
        "subscriptionId": None,
        "validFrom": station_service.get("effectiveSince"),
        "validTo": None,
        "rankable": False,
        "blockedReasons": reasons,
        "sourceUrl": "https://chargeplus.totalenergies.com/fr/conseils-recharge-electrique/cout-recharge-voiture-electrique/",
        "sourceUpdatedAt": source.get("generatedAt"),
        "normalizedAt": normalized_at,
    }


def zen_reference(pdc, station, source, zen, normalized_at):
    pid = clean(pdc.get("pdcId"))
    sid = clean(pdc.get("stationId"))
    power = number(pdc.get("powerKw"))
    if power is None or power < number(zen.get("minimumPowerKw")):
        return None
    return {
        "offerId": f"totalenergies-charge-plus-zen-reference:{pid}",
        "physicalOperatorId": pdc.get("physicalOperatorId") or station.get("physicalOperatorId"),
        "tariffNetworkId": "totalenergies",
        "provider": "Charge+ Zen",
        "channel": "subscription",
        "sourceMode": "official_eligibility_rule_reference",
        "sourceStationId": None,
        "sourceEvseId": None,
        "canonicalStationId": sid,
        "canonicalPdcId": pid,
        "matchMethod": "candidate_network_and_power_scope_reference_only",
        "matchDistanceMeters": None,
        "selectors": {
            "minimumPowerKw": number(zen.get("minimumPowerKw")),
            "eligibleOperatorBrand": zen.get("eligibleOperatorBrand"),
            "geography": zen.get("geography"),
            "discountPercent": number(zen.get("discountPercent")),
        },
        "kind": None,
        "minPowerKw": number(zen.get("minimumPowerKw")),
        "maxPowerKw": None,
        "pricingRules": [],
        "subscriptionId": "totalenergies-charge-plus-zen",
        "subscriptionMonthlyFeeEur": number(zen.get("monthlyFeeEur")),
        "subscriptionDiscountPercent": number(zen.get("discountPercent")),
        "subscriptionDiscountAppliesTo": zen.get("discountAppliesTo"),
        "validFrom": None,
        "validTo": None,
        "rankable": False,
        "blockedReasons": [
            "zen_official_station_eligibility_unresolved",
            "underlying_public_kwh_price_unresolved",
        ],
        "sourceUrl": "https://chargeplus.totalenergies.com/fr/rechargez-votre-vehicule-electrique-partout-en-france-avec-charge-de-totalenergies/",
        "sourceUpdatedAt": source.get("generatedAt"),
        "normalizedAt": normalized_at,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--canonical-dir", default="build/france_irve_identity")
    parser.add_argument("--out-dir", default="build/france_irve_offers")
    args = parser.parse_args()

    source = load_json(args.source)
    station_service, zen = validate_source(source)
    canonical_dir = Path(args.canonical_dir)
    stations = load_json(canonical_dir / "stations.json.gz")
    pdcs = load_json(canonical_dir / "charge_points.json.gz")
    stations_by_id = {clean(row.get("stationId")): row for row in stations if row.get("stationId")}
    total_stations = {sid for sid, row in stations_by_id.items() if row.get("tariffNetworkId") == "totalenergies"}
    total_pdcs = [row for row in pdcs if row.get("tariffNetworkId") == "totalenergies"]

    now = dt.datetime.now(dt.timezone.utc).isoformat()
    direct_refs = []
    zen_refs = []
    counters = Counter()
    for pdc in total_pdcs:
        sid = clean(pdc.get("stationId"))
        station = stations_by_id.get(sid)
        if not station or station.get("tariffNetworkId") != "totalenergies":
            raise AssertionError(f"TotalEnergies PDC escaped network scope: {pdc.get('pdcId')}")
        direct_refs.append(station_service_reference(pdc, station, source, station_service, now))
        z = zen_reference(pdc, station, source, zen, now)
        if z:
            zen_refs.append(z)
            counters["zen_power_candidate_pdc"] += 1
        else:
            counters["zen_below_threshold_or_unknown_power_pdc"] += 1

    offers = direct_refs + zen_refs
    offers.sort(key=lambda row: (row["canonicalStationId"], row["canonicalPdcId"], row["offerId"]))
    if any(row.get("tariffNetworkId") != "totalenergies" or row.get("rankable") for row in offers):
        raise AssertionError("TotalEnergies conservative scope/rankability invariant failed")
    if any(row.get("provider") == "Charge+ Zen" and row.get("subscriptionDiscountPercent") != 15.0 for row in offers):
        raise AssertionError("Charge+ Zen must be modeled as 15% discount, not a fixed price")

    report = {
        "schemaVersion": "1.1.1",
        "dataset": "france-totalenergies-canonical-reference-audit",
        "productionReady": False,
        "summary": {
            "canonicalTotalEnergiesStationCount": len(total_stations),
            "canonicalTotalEnergiesPdcCount": len(total_pdcs),
            "stationServiceReferenceOfferCount": len(direct_refs),
            "zenReferenceOfferCount": len(zen_refs),
            "materializedReferenceOfferCount": len(offers),
            "rankableOfferCount": 0,
            "physicalInventoryMutationCount": 0,
            "stationServiceUpTo50PriceEurPerKwh": 0.52,
            "stationServiceOver50PriceEurPerKwh": 0.62,
            "stationServiceOccupationEurPerMin": 0.5,
            "stationServiceOccupationStartsAfterMinutes": 45,
            "zenMonthlyFeeEur": 3.9,
            "zenDiscountPercent": 15.0,
            "zenFlatPricePerKwh": None,
            "counters": dict(counters),
        },
        "nextSteps": [
            "match explicit TotalEnergies station-service identity before promoting the direct tariff family",
            "match the official Charge+ Zen eligible-station list to canonical PDCs",
            "resolve each eligible point's underlying public kWh price before applying the 15% Zen discount",
            "keep local concessions such as Aix-Marseille Option City separate from station-service pricing",
        ],
    }
    out = Path(args.out_dir)
    dump_json(out / "totalenergies_pdc_offers_contract_v1_1.json.gz", offers)
    dump_json(out / "totalenergies_materialization_report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
