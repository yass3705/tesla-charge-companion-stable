#!/usr/bin/env python3
"""Materialize Q-Park / IZIVIA tariff offers on canonical France IRVE.

Safety invariants:
- PAN IRVE remains the sole physical inventory.
- Q-Park is a commercial host, not automatically the charging CPO.
- Only canonical PDCs with tariffNetworkId=qpark AND physicalOperatorId=izivia
  may receive the published Q-Park / Pass IZIVIA tariff.
- Pass IZIVIA Access is opt-in and never selected by default.
- PayNow remains reference-only while Q-Park does not publish its ad-hoc price.
- Parking cost is never mixed into the charging tariff.
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


def normalize_rule(rule):
    item = dict(rule or {})
    item.setdefault("scope", "allDay")
    item.setdefault("start", "00:00")
    item.setdefault("end", "24:00")
    item.setdefault("days", None)
    item.setdefault("currency", "EUR")
    item.setdefault("pricePerKwh", 0)
    item.setdefault("chargePerMinute", 0)
    item.setdefault("chargeThresholdMinutes", 0)
    item.setdefault("durationPerMinute", 0)
    item.setdefault("durationThresholdMinutes", 0)
    item.setdefault("connectionFee", 0)
    item.setdefault("occupancyPerMinute", 0)
    item.setdefault("occupancyThresholdMinutes", 0)
    item.setdefault("occupancyCap", 0)
    item.setdefault("parkingPerMinute", 0)
    return item


def validate_source(data):
    if data.get("dataset") != "qpark-izivia-tariffs-france":
        raise ValueError("unexpected Q-Park tariff dataset")
    if data.get("networkId") != "qpark" or data.get("country") != "FR":
        raise ValueError("unexpected Q-Park tariff scope")
    scope = data.get("scope") or {}
    expected = {
        "physicalInventoryFromIrveOnly": True,
        "qparkIsCommercialHost": True,
        "chargingProvider": "IZIVIA",
        "requirePhysicalOperatorId": "izivia",
        "excludeOtherTechnicalCpos": True,
        "parkingExcludedFromChargingTariff": True,
        "otherMspTariffsRemainSeparate": True,
        "payNowTariffUnresolved": True,
    }
    for key, value in expected.items():
        if scope.get(key) != value:
            raise ValueError(f"invalid Q-Park scope {key}={scope.get(key)!r}")

    subscriptions = data.get("subscriptions") or []
    by_sub = {clean(row.get("id")): row for row in subscriptions}
    if "izivia-pass-access" not in by_sub:
        raise ValueError("missing IZIVIA Pass Access product")
    sub = by_sub["izivia-pass-access"]
    if sub.get("defaultSelected") is not False or sub.get("rankableWhenSelected") is not True:
        raise ValueError("IZIVIA Pass Access selection policy is invalid")

    offers = data.get("offers") or []
    by_id = {clean(row.get("id")): row for row in offers}
    required = {"qpark-izivia-pass-access", "qpark-izivia-paynow-unresolved"}
    if set(by_id) != required:
        raise ValueError(f"unexpected Q-Park offers: {sorted(by_id)}")
    access = by_id["qpark-izivia-pass-access"]
    paynow = by_id["qpark-izivia-paynow-unresolved"]
    if access.get("channel") != "subscription" or access.get("subscriptionId") != "izivia-pass-access" or access.get("rankable") is not True:
        raise ValueError("invalid Q-Park Pass IZIVIA offer")
    if paynow.get("channel") != "reference" or paynow.get("rankable") is not False:
        raise ValueError("invalid Q-Park PayNow reference")
    return subscriptions, access, paynow


def materialize(data, stations, pdcs, normalized_at=None):
    subscriptions, access_source, paynow_source = validate_source(data)
    normalized_at = normalized_at or dt.datetime.now(dt.timezone.utc).isoformat()
    source_url = clean(data.get("source")) or "data/qpark_izivia_tariffs_v1.json"
    verified_at = clean(data.get("verifiedAt")) or None

    stations_by_id = {clean(row.get("stationId")): row for row in stations if clean(row.get("stationId"))}
    qpark_stations = {sid: row for sid, row in stations_by_id.items() if row.get("tariffNetworkId") == "qpark"}
    qpark_pdcs = [row for row in pdcs if row.get("tariffNetworkId") == "qpark"]

    eligible = []
    blocked = []
    counters = Counter()
    for pdc in qpark_pdcs:
        sid = clean(pdc.get("stationId"))
        pid = clean(pdc.get("pdcId"))
        station = qpark_stations.get(sid)
        if not station:
            raise AssertionError(f"Q-Park PDC escaped Q-Park station scope: {pid}")
        physical = clean(pdc.get("physicalOperatorId") or station.get("physicalOperatorId")).lower()
        if physical == "izivia":
            eligible.append((pdc, station))
            counters["eligible_physical_operator_izivia"] += 1
        else:
            blocked.append({
                "canonicalPdcId": pid,
                "canonicalStationId": sid,
                "physicalOperatorId": physical or None,
                "reason": "physical_operator_not_izivia",
            })
            counters[f"blocked_physical_operator_{physical or 'unknown'}"] += 1

    output = []
    rankable_pdc_ids = set()
    reference_pdc_ids = set()
    for pdc, station in eligible:
        pid = clean(pdc.get("pdcId"))
        sid = clean(pdc.get("stationId"))
        physical = clean(pdc.get("physicalOperatorId") or station.get("physicalOperatorId"))

        access = {
            "offerId": f"qpark-izivia-pass-access:{pid}",
            "physicalOperatorId": physical,
            "tariffNetworkId": "qpark",
            "provider": clean(access_source.get("provider")) or "IZIVIA Pass · Q-Park",
            "channel": "subscription",
            "sourceMode": "network_rule",
            "sourceStationId": None,
            "sourceEvseId": None,
            "canonicalStationId": sid,
            "canonicalPdcId": pid,
            "matchMethod": "qpark_network_plus_physical_operator_izivia",
            "matchDistanceMeters": None,
            "selectors": {"physicalOperatorId": "izivia", "host": "Q-Park"},
            "kind": None,
            "minPowerKw": None,
            "maxPowerKw": None,
            "pricingRules": [normalize_rule(rule) for rule in access_source.get("pricingRules") or []],
            "subscriptionId": "izivia-pass-access",
            "validFrom": None,
            "validTo": None,
            "rankable": True,
            "blockedReasons": [],
            "sourceUrl": source_url,
            "sourceUpdatedAt": verified_at,
            "normalizedAt": normalized_at,
        }
        if not access["pricingRules"]:
            raise ValueError("rankable Q-Park Pass IZIVIA offer has no pricing rule")
        output.append(access)
        rankable_pdc_ids.add(pid)
        counters["rankable_pass_izivia_offer"] += 1

        paynow = {
            "offerId": f"qpark-izivia-paynow-reference:{pid}",
            "physicalOperatorId": physical,
            "tariffNetworkId": "qpark",
            "provider": clean(paynow_source.get("provider")) or "IZIVIA PayNow · Q-Park",
            "channel": "reference",
            "sourceMode": "reference_only",
            "sourceStationId": None,
            "sourceEvseId": None,
            "canonicalStationId": sid,
            "canonicalPdcId": pid,
            "matchMethod": "qpark_network_plus_physical_operator_izivia",
            "matchDistanceMeters": None,
            "selectors": {"physicalOperatorId": "izivia", "host": "Q-Park"},
            "kind": None,
            "minPowerKw": None,
            "maxPowerKw": None,
            "pricingRules": [],
            "subscriptionId": None,
            "validFrom": None,
            "validTo": None,
            "rankable": False,
            "blockedReasons": list(paynow_source.get("blockedReasons") or ["adhoc_paynow_tariff_not_published_on_qpark_source"]),
            "sourceUrl": source_url,
            "sourceUpdatedAt": verified_at,
            "normalizedAt": normalized_at,
        }
        output.append(paynow)
        reference_pdc_ids.add(pid)
        counters["reference_paynow_offer"] += 1

    output.sort(key=lambda row: (row["canonicalStationId"], row["canonicalPdcId"], row["offerId"]))
    covered_station_ids = {row["canonicalStationId"] for row in output if row.get("rankable")}
    summary = {
        "canonicalQparkStationCount": len(qpark_stations),
        "canonicalQparkPdcCount": len(qpark_pdcs),
        "eligibleIziviaPdcCount": len(eligible),
        "blockedOtherCpoPdcCount": len(blocked),
        "materializedOfferCount": len(output),
        "rankableOfferCount": sum(1 for row in output if row.get("rankable")),
        "referenceOfferCount": sum(1 for row in output if not row.get("rankable")),
        "rankableCoveredPdcCount": len(rankable_pdc_ids),
        "rankableCoveredStationCount": len(covered_station_ids),
        "referenceCoveredPdcCount": len(reference_pdc_ids),
        "unresolvedEligiblePdcCount": len(eligible) - len(rankable_pdc_ids),
        "physicalInventoryMutationCount": 0,
        "passAccessCardFeeEur": next(float(s.get("feeEur", 0)) for s in subscriptions if s.get("id") == "izivia-pass-access"),
        "passAccessMonthlyFeeEur": next(float(s.get("monthlyFeeEur", 0)) for s in subscriptions if s.get("id") == "izivia-pass-access"),
        "counters": dict(counters),
    }
    report = {
        "schemaVersion": "1.1.1",
        "dataset": "france-qpark-izivia-canonical-audit",
        "productionReady": False,
        "summary": summary,
        "blockedOtherCpoExamples": blocked[:100],
    }
    return output, subscriptions, report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="data/qpark_izivia_tariffs_v1.json")
    parser.add_argument("--canonical-dir", default="build/france_irve_identity")
    parser.add_argument("--out-dir", default="build/france_irve_offers")
    args = parser.parse_args()

    data = load_json(args.source)
    canonical = Path(args.canonical_dir)
    stations = load_json(canonical / "stations.json.gz")
    pdcs = load_json(canonical / "charge_points.json.gz")
    offers, subscriptions, report = materialize(data, stations, pdcs)

    out = Path(args.out_dir)
    dump_json(out / "qpark_pdc_offers_contract_v1_1.json.gz", offers)
    dump_json(out / "qpark_subscriptions_contract_v1_1.json", {
        "schemaVersion": "1.1.1",
        "networkId": "qpark",
        "subscriptions": subscriptions,
    })
    dump_json(out / "qpark_materialization_report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
