#!/usr/bin/env python3
"""Materialize current TotalEnergies France tariff families conservatively.

Safety invariants:
- PAN IRVE remains the only physical inventory.
- Only canonical PDCs whose tariffNetworkId is exactly ``totalenergies`` qualify.
- Current station-service pricing is published as power-band *ranges*, with six
  explicit 0.59 EUR/kWh local exceptions. No exact price is ranked until a
  canonical station is matched to the applicable official station tariff.
- Charge+ Zen is a 15% eMSP subscription discount, never a fixed 0.49 EUR/kWh
  offer. Official station eligibility and the underlying public price must both
  be resolved before ranking; FRHXW/Hexawatt is explicitly excluded.
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
    if data.get("dataset") != "totalenergies-france-v9-official-review" or data.get("country") != "FR":
        raise ValueError("unexpected TotalEnergies V9 review source")
    classification = data.get("classification") or {}
    if classification.get("singleNationalExactCpoTariff") is not False:
        raise ValueError("TotalEnergies source unexpectedly declares a single exact CPO tariff")
    if classification.get("stationLevelPriceRequiredForExactSimulation") is not True:
        raise ValueError("TotalEnergies source no longer requires station-level exact price")
    if classification.get("chargePlusIsEmspNotCpoDirect") is not True:
        raise ValueError("Charge+ must remain separate from CPO-direct pricing")

    station_service = data.get("stationServiceFrance") or {}
    low = station_service.get("upToAndIncluding50Kw") or {}
    high = station_service.get("over50Kw") or {}
    if (number(low.get("minEurPerKwh")), number(low.get("maxEurPerKwh"))) != (0.52, 0.55):
        raise ValueError("TotalEnergies <=50 kW published range changed")
    if (number(high.get("minEurPerKwh")), number(high.get("maxEurPerKwh"))) != (0.62, 0.65):
        raise ValueError("TotalEnergies >50 kW published range changed")
    occupation = station_service.get("occupationFee") or {}
    if number(occupation.get("eurPerMin")) != 0.5 or number(occupation.get("startsAfterConsecutiveConnectedMinutes")) != 45:
        raise ValueError("TotalEnergies station-service occupation rule changed")
    exceptions = station_service.get("local059Exceptions") or []
    if len(exceptions) != 6 or any(number(row.get("eurPerKwh")) != 0.59 for row in exceptions):
        raise ValueError("TotalEnergies 0.59 local exception set changed")

    zen = data.get("chargePlusZen") or {}
    if zen.get("classification") != "subscription_emsp_discount":
        raise ValueError("Charge+ Zen source classification invalid")
    if number(zen.get("monthlyFeeEur")) != 3.9 or number(zen.get("discountPercent")) != 15.0:
        raise ValueError("Charge+ Zen current terms changed")
    if number(zen.get("minimumPowerKw")) != 50:
        raise ValueError("Charge+ Zen power threshold changed")
    if "FRHXW" not in (zen.get("excludedOperatorCodes") or []):
        raise ValueError("Charge+ Zen Hexawatt exclusion missing")
    if zen.get("exactEligibleStationIdentityRequired") is not True or zen.get("underlyingPublicPriceRequired") is not True:
        raise ValueError("Charge+ Zen safety requirements missing")
    return station_service, zen


def power_band(power, station_service):
    low = station_service["upToAndIncluding50Kw"]
    high = station_service["over50Kw"]
    if power is None:
        return "power_unresolved", 0.52, 0.65
    if power <= 50:
        return "up_to_and_including_50kw", number(low["minEurPerKwh"]), number(low["maxEurPerKwh"])
    return "over_50kw", number(high["minEurPerKwh"]), number(high["maxEurPerKwh"])


def station_service_reference(pdc, station, source, station_service, normalized_at):
    pid = clean(pdc.get("pdcId"))
    sid = clean(pdc.get("stationId"))
    power = number(pdc.get("powerKw"))
    band, price_min, price_max = power_band(power, station_service)
    occ = station_service.get("occupationFee") or {}
    reasons = ["station_service_scope_unresolved", "exact_kwh_price_station_specific"]
    if power is None:
        reasons.append("pdc_power_unresolved")
    return {
        "offerId": f"totalenergies-station-service-reference:{pid}",
        "physicalOperatorId": pdc.get("physicalOperatorId") or station.get("physicalOperatorId"),
        "tariffNetworkId": "totalenergies",
        "provider": "TotalEnergies station-service direct",
        "channel": "direct",
        "sourceMode": "network_family_price_range_reference",
        "sourceStationId": None,
        "sourceEvseId": None,
        "canonicalStationId": sid,
        "canonicalPdcId": pid,
        "matchMethod": "tariff_network_scope_reference_only",
        "matchDistanceMeters": None,
        "selectors": {
            "tariffFamily": "station_service_france",
            "powerBand": band,
            "publishedPriceMinEurPerKwh": price_min,
            "publishedPriceMaxEurPerKwh": price_max,
            "local059ExceptionCount": len(station_service.get("local059Exceptions") or []),
        },
        "kind": None,
        "minPowerKw": None,
        "maxPowerKw": None,
        "pricingRules": [{
            "scope": "allDay",
            "start": "00:00",
            "end": "24:00",
            "days": None,
            "currency": "EUR",
            "pricePerKwh": None,
            "chargePerMinute": 0,
            "connectionFee": number(station_service.get("sessionFeeEur")) or 0,
            "durationPerMinute": 0,
            "durationThresholdMinutes": 0,
            "occupancyPerMinute": number(occ.get("eurPerMin")),
            "occupancyThresholdMinutes": number(occ.get("startsAfterConsecutiveConnectedMinutes")),
            "occupancyCap": None,
            "parkingPerMinute": 0,
            "notes": f"Official station-service published range {price_min:.2f}-{price_max:.2f} EUR/kWh for this power band; exact station price unresolved. Six named local stations are published at 0.59 EUR/kWh.",
        }],
        "subscriptionId": None,
        "validFrom": None,
        "validTo": None,
        "rankable": False,
        "blockedReasons": reasons,
        "sourceUrl": station_service.get("source"),
        "sourceUpdatedAt": source.get("reviewedAt"),
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
            "brandScope": zen.get("brandScope"),
            "geography": zen.get("geography"),
            "excludedOperatorCodes": zen.get("excludedOperatorCodes") or [],
            "excludedOperatorLabel": zen.get("excludedOperatorLabel"),
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
            "hexawatt_frhxw_exclusion_must_be_enforced",
        ],
        "sourceUrl": zen.get("source"),
        "sourceUpdatedAt": source.get("reviewedAt"),
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
    if any(row.get("channel") == "direct" and row.get("pricingRules", [{}])[0].get("pricePerKwh") is not None for row in offers):
        raise AssertionError("Station-specific TotalEnergies kWh price must remain unresolved until exact match")

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
            "stationServiceUpTo50PublishedRangeEurPerKwh": [0.52, 0.55],
            "stationServiceOver50PublishedRangeEurPerKwh": [0.62, 0.65],
            "stationService059ExceptionCount": 6,
            "stationServiceOccupationEurPerMin": 0.5,
            "stationServiceOccupationStartsAfterMinutes": 45,
            "zenMonthlyFeeEur": 3.9,
            "zenDiscountPercent": 15.0,
            "zenMinimumPowerKw": 50,
            "zenExcludedOperatorCodes": zen.get("excludedOperatorCodes") or [],
            "zenFlatPricePerKwh": None,
            "counters": dict(counters),
        },
        "stationService059Exceptions": station_service.get("local059Exceptions") or [],
        "nextSteps": [
            "match explicit TotalEnergies station-service identity and exact local station price before ranking direct offers",
            "match the official Charge+ Zen eligible-station identity to canonical PDCs and enforce FRHXW exclusion",
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
