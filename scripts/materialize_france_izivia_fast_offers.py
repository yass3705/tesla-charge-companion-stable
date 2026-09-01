#!/usr/bin/env python3
"""Materialize the official IZIVIA FAST France tariff on canonical FAST PDCs.

Safety invariants:
- PAN IRVE remains the only physical inventory.
- Only PDCs whose customer-facing tariffNetworkId is exactly ``izivia-fast`` qualify.
- Generic IZIVIA, IZIVIA Express, SIGEIF/IZIVIA and client networks never inherit this tariff.
- The official FAST tariff is network-wide and never creates stations or PDCs.
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


def truthy(value):
    if isinstance(value, bool):
        return value
    return clean(value).lower() in {"1", "true", "vrai", "yes", "oui", "y", "x"}


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
    expected = {
        "schemaVersion": "1.0.0",
        "dataset": "izivia-fast-direct-france-v1",
    }
    for key, value in expected.items():
        if data.get(key) != value:
            raise ValueError(f"unexpected IZIVIA FAST source {key}={data.get(key)!r}")
    scope = data.get("scope") or {}
    if scope.get("countryCode") != "FR" or scope.get("network") != "IZIVIA FAST":
        raise ValueError("IZIVIA FAST source scope is not France/FAST")
    if scope.get("onlyDirectCpo") is not True or scope.get("roamingIncluded") is not False:
        raise ValueError("IZIVIA FAST source must remain direct-CPO only")
    if scope.get("subscriptionDiscountsIncluded") is not False or scope.get("failClosed") is not True:
        raise ValueError("IZIVIA FAST source safety policy changed")
    matching = data.get("matching") or {}
    if matching.get("dcOnly") is not True:
        raise ValueError("IZIVIA FAST source must remain DC-only")
    tariff = data.get("tariff") or {}
    expected_windows = [
        ("00:00", "11:30", 0.30),
        ("11:30", "15:00", 0.35),
        ("15:00", "18:00", 0.30),
        ("18:00", "24:00", 0.35),
    ]
    if tariff.get("currency") != "EUR" or tariff.get("billing") != "kwh":
        raise ValueError("unsupported IZIVIA FAST billing")
    windows = tariff.get("windows") or []
    if len(windows) != len(expected_windows):
        raise ValueError("unexpected IZIVIA FAST tariff window count")
    for row, expected in zip(windows, expected_windows):
        if row.get("start") != expected[0] or row.get("end") != expected[1] or number(row.get("pricePerKwh")) != expected[2]:
            raise ValueError(f"unexpected IZIVIA FAST tariff window: {row}")
    return windows


def dc_evidence(pdc):
    connectors = pdc.get("connectors") or {}
    if truthy(connectors.get("comboCcs")) or truthy(connectors.get("chademo")):
        return "declared_dc_connector"
    power = number(pdc.get("powerKw"))
    # IZIVIA FAST is officially an ultra-rapid 150-200 kW network. A >50 kW
    # canonical FAST PDC is therefore a safe DC inference when connector flags
    # are absent from PAN.
    if power is not None and power > 50:
        return "fast_network_high_power_inference"
    return None


def pricing_rules(windows):
    return [
        {
            "scope": "timeWindow",
            "start": row["start"],
            "end": row["end"],
            "days": None,
            "currency": "EUR",
            "pricePerKwh": number(row.get("pricePerKwh")),
            "chargePerMinute": 0,
            "connectionFee": 0,
            "durationPerMinute": 0,
            "durationThresholdMinutes": 0,
            "occupancyPerMinute": 0,
            "occupancyThresholdMinutes": 0,
            "occupancyCap": 0,
            "parkingPerMinute": 0,
            "notes": clean(row.get("label")),
        }
        for row in windows
    ]


def offer_for(pdc, station, source, windows, normalized_at, evidence):
    pid = clean(pdc.get("pdcId"))
    sid = clean(pdc.get("stationId"))
    return {
        "offerId": f"izivia-fast-direct:{pid}",
        "physicalOperatorId": pdc.get("physicalOperatorId") or station.get("physicalOperatorId"),
        "tariffNetworkId": "izivia-fast",
        "provider": "IZIVIA FAST direct",
        "channel": "direct",
        "sourceMode": "network_rule",
        "sourceStationId": None,
        "sourceEvseId": None,
        "canonicalStationId": sid,
        "canonicalPdcId": pid,
        "matchMethod": "exact_tariff_network",
        "matchDistanceMeters": None,
        "selectors": {
            "network": "IZIVIA FAST",
            "host": "McDonald's France",
            "dcEvidence": evidence,
        },
        "kind": "DC",
        "minPowerKw": None,
        "maxPowerKw": None,
        "pricingRules": pricing_rules(windows),
        "subscriptionId": None,
        "validFrom": source.get("generatedAt"),
        "validTo": None,
        "rankable": True,
        "blockedReasons": [],
        "sourceUrl": clean(((source.get("source") or {}).get("networkPage"))) or "data:izivia_fast_direct_tariff_v1.json",
        "sourceUpdatedAt": source.get("generatedAt"),
        "normalizedAt": normalized_at,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="data/izivia_fast_direct_tariff_v1.json")
    parser.add_argument("--canonical-dir", default="build/france_irve_identity")
    parser.add_argument("--out-dir", default="build/france_irve_offers")
    args = parser.parse_args()

    source = load_json(args.source)
    windows = validate_source(source)
    canonical_dir = Path(args.canonical_dir)
    stations = load_json(canonical_dir / "stations.json.gz")
    pdcs = load_json(canonical_dir / "charge_points.json.gz")
    stations_by_id = {clean(row.get("stationId")): row for row in stations if row.get("stationId")}
    fast_stations = {sid for sid, row in stations_by_id.items() if row.get("tariffNetworkId") == "izivia-fast"}
    fast_pdcs = [row for row in pdcs if row.get("tariffNetworkId") == "izivia-fast"]

    now = dt.datetime.now(dt.timezone.utc).isoformat()
    offers = []
    unresolved = []
    counters = Counter()
    for pdc in fast_pdcs:
        pid = clean(pdc.get("pdcId"))
        sid = clean(pdc.get("stationId"))
        station = stations_by_id.get(sid)
        if not station or station.get("tariffNetworkId") != "izivia-fast":
            raise AssertionError(f"IZIVIA FAST PDC escaped FAST station scope: {pid}")
        evidence = dc_evidence(pdc)
        if not evidence:
            counters["unresolved_dc_evidence"] += 1
            if len(unresolved) < 100:
                unresolved.append({
                    "pdcId": pid,
                    "stationId": sid,
                    "powerKw": pdc.get("powerKw"),
                    "connectors": pdc.get("connectors"),
                })
            continue
        counters[evidence] += 1
        offers.append(offer_for(pdc, station, source, windows, now, evidence))

    offers.sort(key=lambda row: (row["canonicalStationId"], row["canonicalPdcId"]))
    pdc_ids = {clean(row.get("pdcId")) for row in pdcs if row.get("pdcId")}
    if any(
        row.get("canonicalStationId") not in fast_stations
        or row.get("canonicalPdcId") not in pdc_ids
        or row.get("tariffNetworkId") != "izivia-fast"
        or row.get("channel") != "direct"
        or row.get("rankable") is not True
        for row in offers
    ):
        raise AssertionError("IZIVIA FAST materializer escaped canonical network scope")

    covered_pdcs = {row["canonicalPdcId"] for row in offers}
    covered_stations = {row["canonicalStationId"] for row in offers}
    report = {
        "schemaVersion": "1.1.1",
        "dataset": "france-izivia-fast-canonical-direct-audit",
        "productionReady": False,
        "summary": {
            "canonicalIziviaFastStationCount": len(fast_stations),
            "canonicalIziviaFastPdcCount": len(fast_pdcs),
            "materializedOfferCount": len(offers),
            "rankableOfferCount": len(offers),
            "rankableCoveredStationCount": len(covered_stations),
            "rankableCoveredPdcCount": len(covered_pdcs),
            "unresolvedPdcCount": len(fast_pdcs) - len(covered_pdcs),
            "physicalInventoryMutationCount": 0,
            "happyHourPriceEurPerKwh": 0.30,
            "standardPriceEurPerKwh": 0.35,
            "counters": dict(counters),
        },
        "unresolvedExamples": unresolved,
    }
    out = Path(args.out_dir)
    dump_json(out / "izivia_fast_pdc_offers_contract_v1_1.json.gz", offers)
    dump_json(out / "izivia_fast_materialization_report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
