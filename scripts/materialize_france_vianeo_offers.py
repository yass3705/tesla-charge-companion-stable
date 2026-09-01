#!/usr/bin/env python3
"""Materialize ENGIE Vianeo canonical reference offers.

Safety invariants:
- PAN IRVE remains the only physical inventory.
- Only PDCs whose customer-facing tariffNetworkId is exactly ``engie-vianeo`` qualify.
- Vianeo Max is national at 0.33 EUR/kWh, but some stations add minute fees and
  dedicated heavy-goods points are excluded by the official subscription scope.
- Until those station-level conditions are resolved, Vianeo Max is reference-only
  and MUST NOT participate in cost ranking.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
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
    if data.get("dataset") != "engie-vianeo-official-france" or data.get("country") != "FR":
        raise ValueError("unexpected Vianeo source")
    classification = data.get("classification") or {}
    if classification.get("nationalSubscriptionTariffExists") is not True:
        raise ValueError("Vianeo Max national subscription not confirmed")
    if classification.get("stationLevelPriceLookupRequiredForExactSimulation") is not True:
        raise ValueError("Vianeo station-level exact-pricing requirement unexpectedly absent")
    max_offer = (data.get("operatorDirect") or {}).get("vianeoMax") or {}
    if max_offer.get("classification") != "operator_direct_subscription":
        raise ValueError("Vianeo Max source classification invalid")
    if number(max_offer.get("monthlyFeeEur")) != 9.99 or number(max_offer.get("eurPerKwh")) != 0.33:
        raise ValueError("Vianeo Max current price changed; review required")
    if max_offer.get("allVianeoPassengerVehicleStationsFrance") is not True:
        raise ValueError("Vianeo Max national passenger scope not confirmed")
    if max_offer.get("stationMinuteFeesCanStillApply") is not True:
        raise ValueError("Vianeo source no longer declares station minute fees")
    if max_offer.get("excludesHeavyGoodsDedicatedPoints") is not True:
        raise ValueError("Vianeo source no longer excludes heavy-goods dedicated points")
    return max_offer


def reference_offer(pdc, station, source, max_offer, normalized_at):
    pid = clean(pdc.get("pdcId"))
    sid = clean(pdc.get("stationId"))
    return {
        "offerId": f"vianeo-max-reference:{pid}",
        "physicalOperatorId": pdc.get("physicalOperatorId") or station.get("physicalOperatorId"),
        "tariffNetworkId": "engie-vianeo",
        "provider": "ENGIE Vianeo Max",
        "channel": "subscription",
        "sourceMode": "network_rule_with_station_conditions",
        "sourceStationId": None,
        "sourceEvseId": None,
        "canonicalStationId": sid,
        "canonicalPdcId": pid,
        "matchMethod": "network_scope_reference_only",
        "matchDistanceMeters": None,
        "selectors": {
            "country": "FR",
            "passengerVehicleNetworkScope": True,
            "heavyGoodsDedicatedPointsExcluded": True,
            "stationMinuteFeesCanStillApply": True,
            "appOnly": max_offer.get("appOnly") is True,
            "dailyEnergyCapKwh": number(max_offer.get("dailyEnergyCapKwh")),
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
            "pricePerKwh": 0.33,
            "chargePerMinute": None,
            "connectionFee": 0,
            "durationPerMinute": None,
            "durationThresholdMinutes": None,
            "occupancyPerMinute": None,
            "occupancyThresholdMinutes": None,
            "occupancyCap": None,
            "parkingPerMinute": None,
            "notes": "National Vianeo Max energy price. Station-specific minute/occupation fees remain unresolved and may apply.",
        }],
        "subscriptionId": "vianeo-max",
        "subscriptionMonthlyFeeEur": 9.99,
        "validFrom": source.get("generatedAt"),
        "validTo": None,
        "rankable": False,
        "blockedReasons": [
            "station_specific_minute_fee_unresolved",
            "heavy_goods_dedicated_point_scope_unresolved",
        ],
        "sourceUrl": "https://www.engie-vianeo.com/tarifs-recharge-voiture-electrique/",
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
    max_offer = validate_source(source)
    canonical_dir = Path(args.canonical_dir)
    stations = load_json(canonical_dir / "stations.json.gz")
    pdcs = load_json(canonical_dir / "charge_points.json.gz")
    stations_by_id = {clean(row.get("stationId")): row for row in stations if row.get("stationId")}
    vianeo_stations = {sid for sid, row in stations_by_id.items() if row.get("tariffNetworkId") == "engie-vianeo"}
    vianeo_pdcs = [row for row in pdcs if row.get("tariffNetworkId") == "engie-vianeo"]

    now = dt.datetime.now(dt.timezone.utc).isoformat()
    offers = []
    for pdc in vianeo_pdcs:
        sid = clean(pdc.get("stationId"))
        station = stations_by_id.get(sid)
        if not station or station.get("tariffNetworkId") != "engie-vianeo":
            raise AssertionError(f"Vianeo PDC escaped Vianeo station scope: {pdc.get('pdcId')}")
        offers.append(reference_offer(pdc, station, source, max_offer, now))

    offers.sort(key=lambda row: (row["canonicalStationId"], row["canonicalPdcId"]))
    if any(row.get("tariffNetworkId") != "engie-vianeo" or row.get("rankable") for row in offers):
        raise AssertionError("Vianeo conservative materializer scope/rankability invariant failed")

    report = {
        "schemaVersion": "1.1.1",
        "dataset": "france-vianeo-canonical-reference-audit",
        "productionReady": False,
        "summary": {
            "canonicalVianeoStationCount": len(vianeo_stations),
            "canonicalVianeoPdcCount": len(vianeo_pdcs),
            "materializedReferenceOfferCount": len(offers),
            "rankableOfferCount": 0,
            "referenceCoveredStationCount": len({row["canonicalStationId"] for row in offers}),
            "referenceCoveredPdcCount": len({row["canonicalPdcId"] for row in offers}),
            "unresolvedForRankingPdcCount": len(offers),
            "physicalInventoryMutationCount": 0,
            "vianeoMaxMonthlyFeeEur": 9.99,
            "vianeoMaxPriceEurPerKwh": 0.33,
            "stationMinuteFeesCanStillApply": True,
            "heavyGoodsDedicatedPointsExcluded": True,
        },
        "nextStep": "resolve station-specific minute fees and heavy-goods dedicated scope before promoting individual offers to rankable",
    }
    out = Path(args.out_dir)
    dump_json(out / "vianeo_pdc_offers_contract_v1_1.json.gz", offers)
    dump_json(out / "vianeo_materialization_report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
