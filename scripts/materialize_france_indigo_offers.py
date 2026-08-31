#!/usr/bin/env python3
"""Materialize INDIGO Recharge direct/subscription rules on canonical France IRVE.

The PAN-derived canonical inventory remains authoritative for physical stations/PDCs.
This layer only attaches INDIGO tariff offers to stations whose tariffNetworkId is
explicitly `indigo`. City exceptions use INSEE commune codes rather than fuzzy text.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path

LEGACY_CITY_INSEE = {
    "biarritz": "64122",
    "nevers": "58194",
    "saint germain en laye": "78551",
    "tours": "37261",
}


def clean(value):
    return str(value or "").strip()


def norm(value):
    text = unicodedata.normalize("NFD", clean(value))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def compact(value):
    return re.sub(r"[^A-Z0-9]+", "", clean(value).upper())


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
    if data.get("dataset") != "indigo-recharge-direct-tariffs-france":
        raise ValueError("unexpected Indigo tariff dataset")
    if data.get("networkId") != "indigo" or data.get("country") != "FR":
        raise ValueError("unexpected Indigo tariff scope")
    scope = data.get("scope") or {}
    expected = {
        "directNetworkOnly": True,
        "physicalInventoryFromIrveOnly": True,
        "parkingExcludedFromChargingTariff": True,
    }
    for key, value in expected.items():
        if scope.get(key) != value:
            raise ValueError(f"invalid Indigo scope {key}={scope.get(key)!r}")

    offers = data.get("offers") or []
    subscriptions = data.get("subscriptions") or []
    if not offers or not subscriptions:
        raise ValueError("Indigo tariff source is empty")

    selector_cities = set()
    for offer in offers:
        selectors = offer.get("selectors") or {}
        for field in ("cities", "excludeCities"):
            selector_cities.update(norm(value) for value in selectors.get(field) or [] if clean(value))
    unknown = selector_cities - set(LEGACY_CITY_INSEE)
    if unknown:
        raise ValueError(f"unknown Indigo city selector(s): {sorted(unknown)}")

    by_subscription = {row.get("id"): row for row in subscriptions}
    for offer in offers:
        channel = clean(offer.get("channel"))
        if channel == "subscription":
            sid = clean(offer.get("subscriptionId"))
            if sid not in by_subscription:
                raise ValueError(f"unknown Indigo subscription {sid}")
    return offers, subscriptions


def legacy_codes_from_selectors(selectors, field):
    values = selectors.get(field) or []
    return {LEGACY_CITY_INSEE[norm(value)] for value in values if norm(value) in LEGACY_CITY_INSEE}


def applies_to_station(offer, station):
    selectors = offer.get("selectors") or {}
    code = clean(station.get("codeInsee"))
    include = legacy_codes_from_selectors(selectors, "cities")
    exclude = legacy_codes_from_selectors(selectors, "excludeCities")
    if include and code not in include:
        return False
    if exclude and code in exclude:
        return False
    return True


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


def materialize(data, stations, pdcs, normalized_at=None):
    offers, subscriptions = validate_source(data)
    normalized_at = normalized_at or dt.datetime.now(dt.timezone.utc).isoformat()
    verified_at = clean(data.get("verifiedAt")) or None
    source_url = clean(data.get("source")) or "data/indigo_recharge_direct_tariffs_v1.json"

    indigo_stations = [row for row in stations if row.get("tariffNetworkId") == "indigo"]
    indigo_station_ids = {clean(row.get("stationId")) for row in indigo_stations}
    indigo_pdcs = [row for row in pdcs if row.get("tariffNetworkId") == "indigo"]
    pdc_by_station = Counter(clean(row.get("stationId")) for row in indigo_pdcs)

    subscription_by_id = {row.get("id"): row for row in subscriptions}
    output = []
    counters = Counter()
    rankable_station_ids = set()
    direct_rankable_station_ids = set()
    subscription_rankable_station_ids = set()

    for station in indigo_stations:
        sid = clean(station.get("stationId"))
        code_insee = clean(station.get("codeInsee"))
        legacy_city = code_insee in set(LEGACY_CITY_INSEE.values())
        counters["legacy_city_station" if legacy_city else "standard_city_station"] += 1

        for source_offer in offers:
            if not applies_to_station(source_offer, station):
                continue
            channel = clean(source_offer.get("channel")) or "reference"
            subscription_id = clean(source_offer.get("subscriptionId")) or None
            source_rankable = bool(source_offer.get("rankable"))
            blocked = list(source_offer.get("blockedReasons") or [])

            if channel == "subscription":
                sub = subscription_by_id.get(subscription_id) or {}
                if not sub.get("rankableWhenSelected", False):
                    source_rankable = False
                    reason = clean(sub.get("blockedReason")) or "subscription_not_rankable"
                    if reason not in blocked:
                        blocked.append(reason)
            if channel == "reference":
                source_rankable = False

            item = {
                "offerId": f"{clean(source_offer.get('id'))}:{compact(sid)}",
                "physicalOperatorId": station.get("physicalOperatorId"),
                "tariffNetworkId": "indigo",
                "provider": clean(source_offer.get("provider")) or "INDIGO Recharge",
                "channel": channel,
                "sourceMode": "network_rule",
                "sourceStationId": None,
                "sourceEvseId": None,
                "canonicalStationId": sid,
                "canonicalPdcId": None,
                "matchMethod": "network_scope",
                "matchDistanceMeters": None,
                "selectors": {
                    "codeInsee": code_insee or None,
                    "legacyCity": legacy_city,
                    "sourceSelectors": source_offer.get("selectors") or {},
                },
                "kind": None,
                "minPowerKw": None,
                "maxPowerKw": None,
                "pricingRules": [normalize_rule(rule) for rule in source_offer.get("pricingRules") or []],
                "subscriptionId": subscription_id,
                "validFrom": None,
                "validTo": None,
                "rankable": source_rankable,
                "blockedReasons": blocked,
                "sourceUrl": source_url,
                "sourceUpdatedAt": verified_at,
                "normalizedAt": normalized_at,
            }
            if source_rankable and not item["pricingRules"]:
                item["rankable"] = False
                item["blockedReasons"].append("missing_pricing_rules")
            output.append(item)
            counters[f"offer_{clean(source_offer.get('id'))}"] += 1
            counters[f"channel_{channel}"] += 1
            counters["rankable_offer" if item["rankable"] else "reference_offer"] += 1
            if item["rankable"]:
                rankable_station_ids.add(sid)
                if channel == "direct":
                    direct_rankable_station_ids.add(sid)
                if channel == "subscription":
                    subscription_rankable_station_ids.add(sid)

    if any(row.get("canonicalStationId") not in indigo_station_ids for row in output):
        raise AssertionError("Indigo offer escaped canonical Indigo network scope")
    if any(row.get("tariffNetworkId") != "indigo" for row in output):
        raise AssertionError("Indigo offer has invalid tariff network")

    output.sort(key=lambda row: (row["canonicalStationId"], row["offerId"]))
    summary = {
        "canonicalIndigoStationCount": len(indigo_stations),
        "canonicalIndigoPdcCount": len(indigo_pdcs),
        "materializedOfferCount": len(output),
        "rankableOfferCount": sum(1 for row in output if row.get("rankable")),
        "referenceOfferCount": sum(1 for row in output if not row.get("rankable")),
        "rankableCoveredStationCount": len(rankable_station_ids),
        "rankableDirectCoveredStationCount": len(direct_rankable_station_ids),
        "rankableSubscriptionCoveredStationCount": len(subscription_rankable_station_ids),
        "legacyCityStationCount": counters["legacy_city_station"],
        "standardCityStationCount": counters["standard_city_station"],
        "physicalInventoryMutationCount": 0,
        "pdcCountByCoveredStation": sum(pdc_by_station[sid] for sid in rankable_station_ids),
        "counters": dict(counters),
    }
    return output, subscriptions, summary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tariffs", default="data/indigo_recharge_direct_tariffs_v1.json")
    parser.add_argument("--canonical-dir", default="build/france_irve_identity")
    parser.add_argument("--out-dir", default="build/france_irve_offers")
    args = parser.parse_args()

    data = load_json(args.tariffs)
    canonical = Path(args.canonical_dir)
    stations = load_json(canonical / "stations.json.gz")
    pdcs = load_json(canonical / "charge_points.json.gz")
    offers, subscriptions, summary = materialize(data, stations, pdcs)

    out = Path(args.out_dir)
    dump_json(out / "indigo_station_offers_contract_v1_1.json.gz", offers)
    dump_json(out / "indigo_subscriptions_contract_v1_1.json", {
        "schemaVersion": "1.1.1",
        "networkId": "indigo",
        "subscriptions": subscriptions,
    })
    report = {
        "schemaVersion": "1.1.1",
        "dataset": "france-indigo-canonical-direct-audit",
        "productionReady": False,
        "summary": summary,
    }
    dump_json(out / "indigo_materialization_report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
