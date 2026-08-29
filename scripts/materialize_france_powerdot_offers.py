#!/usr/bin/env python3
"""Materialize safe Powerdot direct tariffs onto canonical PAN PDCs.

Inputs are the connector/PDC-safe candidates produced by
`audit_powerdot_connector_identity.py` and the canonical PAN identity build.
No source record can create a physical station or PDC.

The converter is intentionally conservative:
- ENERGY -> pricePerKwh
- TIME without minDurationSec -> chargePerMinute
- TIME with minDurationSec -> durationPerMinute + durationThresholdMinutes
- FLAT -> connectionFee
- PARKING_TIME and unknown components/restrictions are blocked until their
  semantics are explicitly validated for TCC.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import math
from collections import Counter
from pathlib import Path


def clean(value):
    return str(value or "").strip()


def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def truthy(value):
    return clean(value).lower() in {"1", "true", "yes", "oui", "vrai"}


def load_json(path):
    path = Path(path)
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as handle:
        return json.load(handle)


def dump_json(path, value, pretty=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix == ".gz":
        with gzip.open(path, "wt", encoding="utf-8", compresslevel=9) as handle:
            json.dump(value, handle, ensure_ascii=False, separators=(",", ":"))
    else:
        path.write_text(
            json.dumps(value, ensure_ascii=False, indent=2 if pretty else None) + "\n",
            encoding="utf-8",
        )


def pdc_kind(pdc):
    connectors = pdc.get("connectors") or {}
    if truthy(connectors.get("comboCcs")) or truthy(connectors.get("chademo")):
        return "DC"
    return "AC"


def empty_components():
    return {
        "pricePerKwh": 0.0,
        "chargePerMinute": 0.0,
        "connectionFee": 0.0,
        "occupancyPerMinute": 0.0,
        "occupancyGraceMinutes": 0.0,
        "occupancyCap": 0.0,
        "durationPerMinute": 0.0,
        "durationThresholdMinutes": 0.0,
        "durationCap": 0.0,
        "parkingPerMinute": 0.0,
        "parkingFreeMinutes": 0.0,
        "parkingCap": 0.0,
    }


def restriction_keys(restrictions):
    return {
        clean(key)
        for key, value in (restrictions or {}).items()
        if value not in (None, "", [], {}, False)
    }


def convert_tariff(tariff):
    blocked = []
    warnings = []
    components = empty_components()
    currency = clean((tariff or {}).get("currencyCode")).upper() or "EUR"
    if currency != "EUR":
        blocked.append(f"unsupported_currency:{currency}")

    if (tariff or {}).get("subscriptionActive") is True:
        blocked.append("subscription_tariff_in_direct_source")

    elements = (tariff or {}).get("elements") or []
    if len(elements) != 1:
        blocked.append(f"unsupported_element_count:{len(elements)}")
        return components, currency, blocked, warnings

    element = elements[0] or {}
    restrictions = element.get("restrictions") or {}
    allowed_restrictions = {"minDurationSec"}
    unknown_restrictions = sorted(restriction_keys(restrictions) - allowed_restrictions)
    if unknown_restrictions:
        blocked.extend(f"unsupported_restriction:{key}" for key in unknown_restrictions)

    seen_types = Counter()
    for component in element.get("priceComponents") or []:
        ctype = clean(component.get("type")).upper()
        price = number(component.get("pricePerUnit"))
        seen_types[ctype] += 1
        if not ctype:
            blocked.append("missing_component_type")
            continue
        if price is None or price < 0:
            blocked.append(f"invalid_price:{ctype}")
            continue
        if seen_types[ctype] > 1:
            blocked.append(f"duplicate_component_type:{ctype}")
            continue

        if ctype == "ENERGY":
            components["pricePerKwh"] = price
        elif ctype == "FLAT":
            components["connectionFee"] = price
        elif ctype == "TIME":
            threshold_sec = number(restrictions.get("minDurationSec")) or 0
            if threshold_sec > 0:
                components["durationPerMinute"] = price
                components["durationThresholdMinutes"] = threshold_sec / 60.0
            else:
                components["chargePerMinute"] = price
        elif ctype == "PARKING_TIME":
            blocked.append("parking_time_semantics_not_validated")
        else:
            blocked.append(f"unsupported_component_type:{ctype}")

    if seen_types["ENERGY"] != 1:
        blocked.append("energy_component_required_once")
    if not (components["pricePerKwh"] > 0):
        blocked.append("positive_energy_price_required")

    return components, currency, sorted(set(blocked)), warnings


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--safe-candidates", required=True)
    parser.add_argument("--canonical-dir", required=True)
    parser.add_argument("--powerdot-gzip")
    parser.add_argument("--out-dir", default="build/france_irve_powerdot")
    args = parser.parse_args()

    safe = load_json(args.safe_candidates)
    charge_points = load_json(Path(args.canonical_dir) / "charge_points.json.gz")
    canonical_by_pdc = {}
    for pdc in charge_points:
        pid = clean(pdc.get("idPdcItinerance")) or clean(pdc.get("pdcId"))
        if pid:
            canonical_by_pdc[pid] = pdc

    source_meta = {}
    if args.powerdot_gzip:
        direct = load_json(args.powerdot_gzip)
        source_meta = {
            "generatedAt": clean(direct.get("generatedAt")),
            "source": direct.get("source") or {},
            "counts": direct.get("counts") or {},
        }

    offers = []
    blocked_rows = []
    strategy_counts = Counter()
    component_type_counts = Counter()
    missing_canonical = 0
    station_ids = set()

    for row in safe:
        pid = clean(row.get("pdcId"))
        pdc = canonical_by_pdc.get(pid)
        if not pdc:
            missing_canonical += 1
            blocked_rows.append({"pdcId": pid, "blockedReasons": ["canonical_pdc_missing"]})
            continue

        components, currency, blocked, warnings = convert_tariff(row.get("tariff") or {})
        for element in (row.get("tariff") or {}).get("elements") or []:
            for component in element.get("priceComponents") or []:
                component_type_counts[clean(component.get("type")).upper() or "<blank>"] += 1

        station_id = clean(pdc.get("stationId"))
        station_ids.add(station_id)
        strategy = clean(row.get("strategy"))
        strategy_counts[strategy or "<blank>"] += 1
        rankable = not blocked
        offer = {
            "schemaVersion": "1.1.0",
            "offerId": f"powerdot-direct:{pid}",
            "stationId": station_id,
            "pdcId": pid,
            "operatorId": "powerdot",
            "tariffNetworkId": "powerdot",
            "offerProvider": "Powerdot direct",
            "offerType": "direct",
            "currency": currency,
            "kind": pdc_kind(pdc),
            "powerKw": number(pdc.get("powerKw")),
            "pricingComponents": components,
            "subscriptionId": None,
            "subscriptionMonthlyFee": None,
            "matchMethod": f"powerdot_{strategy}",
            "rankable": rankable,
            "blockedReasons": blocked,
            "warnings": warnings,
            "provenance": {
                "physicalInventory": "PAN IRVE static",
                "tariffSource": "Powerdot direct public ad-hoc API",
                "tariffSourceGeneratedAt": source_meta.get("generatedAt", ""),
                "safeAssignmentStrategy": strategy,
                "assignment": row.get("provenance") or {},
            },
        }
        offers.append(offer)
        if not rankable:
            blocked_rows.append({
                "pdcId": pid,
                "stationId": station_id,
                "blockedReasons": blocked,
                "tariff": row.get("tariff") or {},
            })

    offers.sort(key=lambda item: item["pdcId"])
    rankable = [row for row in offers if row["rankable"]]
    report = {
        "schemaVersion": "1.0.0",
        "dataset": "france-powerdot-direct-pdc-offers-audit",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "productionReady": False,
        "policy": {
            "physicalInventoryAuthority": "PAN IRVE static",
            "mayCreatePhysicalPdc": False,
            "requiresSafeConnectorIdentityCandidate": True,
            "parkingTimeSupported": False,
            "unsupportedTariffSemanticsRankable": False,
            "operationalStatusSource": "PAN IRVE dynamic",
        },
        "summary": {
            "safeCandidateCount": len(safe),
            "materializedOfferCount": len(offers),
            "rankableOfferCount": len(rankable),
            "blockedOfferCount": len(offers) - len(rankable),
            "canonicalPdcMissingCount": missing_canonical,
            "stationCount": len(station_ids),
            "rankablePct": round(100 * len(rankable) / len(offers), 2) if offers else 0,
        },
        "assignmentStrategies": dict(strategy_counts),
        "tariffComponentTypes": dict(component_type_counts),
        "sourceSnapshot": source_meta,
        "blockedExamples": blocked_rows[:100],
    }

    out_dir = Path(args.out_dir)
    dump_json(out_dir / "powerdot_pdc_offers_v1_1.json.gz", offers)
    dump_json(out_dir / "powerdot_materialization_report.json", report, pretty=True)
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    print("Assignment strategies:", json.dumps(report["assignmentStrategies"], ensure_ascii=False))
    print("Tariff component types:", json.dumps(report["tariffComponentTypes"], ensure_ascii=False))


if __name__ == "__main__":
    main()
