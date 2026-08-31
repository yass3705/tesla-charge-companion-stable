#!/usr/bin/env python3
"""Materialize Pass Pass électrique direct tariffs on canonical France IRVE.

Safety policy:
- PAN IRVE remains the sole physical inventory.
- Only tariffNetworkId == ``passpass`` is eligible.
- Normal class is inferred only from the official 3–22 kW range (source allows 22.5 tolerance).
- Rapid class is inferred only from supported 43/50 kW-class power (40–60 kW) and a non-long-stay site.
- Ultra (>60 kW) stays reference-only because the source marks power inference provisional.
- Long-stay pricing is applied only when the station explicitly identifies a P+R/park-and-ride/carpool site.
- Subscriber offers remain opt-in via subscriptionId.
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


def clean(value):
    return str(value or "").strip()


def norm(value):
    text = unicodedata.normalize("NFD", clean(value))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


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
    if data.get("dataset") != "passpass-electrique-direct-tariffs-france":
        raise ValueError("unexpected Pass Pass tariff dataset")
    if data.get("networkId") != "passpass" or data.get("country") != "FR":
        raise ValueError("unexpected Pass Pass scope")
    scope = data.get("scope") or {}
    for key in ("directNetworkOnly", "physicalInventoryFromIrveOnly", "billingContinuesWhileConnected", "stationTariffClassRequired"):
        if scope.get(key) is not True:
            raise ValueError(f"invalid Pass Pass scope: {key}")
    by_class = {}
    for offer in data.get("offers") or []:
        site_class = clean((offer.get("selectors") or {}).get("siteClass"))
        if site_class:
            by_class.setdefault(site_class, []).append(offer)
    if set(by_class) != {"normal", "rapid", "ultra", "long_stay"}:
        raise ValueError(f"unexpected Pass Pass classes: {sorted(by_class)}")
    return by_class, data.get("subscriptions") or []


LONG_STAY_PATTERNS = (
    "p r", "parc relais", "parking relais", "park ride", "park and ride",
    "covoiturage", "aire de covoiturage",
)


def explicit_long_stay(station):
    text = norm(" ".join([clean(station.get("name")), clean(station.get("address")), clean(station.get("access"))]))
    return any(pattern in text for pattern in LONG_STAY_PATTERNS)


def classify(pdc, station):
    power = number(pdc.get("powerKw"))
    if explicit_long_stay(station):
        return "long_stay", True, "explicit_site_text"
    if power is None:
        return None, False, "missing_power"
    if 3 <= power <= 22.5:
        return "normal", True, "official_power_range"
    if 40 <= power <= 60:
        return "rapid", True, "supported_43_50kw_power"
    if power > 60:
        return "ultra", False, "provisional_power_inference"
    return None, False, "unsupported_power"


def normalize_rule(rule):
    item = dict(rule or {})
    item.setdefault("days", None)
    item.setdefault("chargePerMinute", 0)
    item.setdefault("chargeThresholdMinutes", 0)
    item.setdefault("durationThresholdMinutes", 0)
    item.setdefault("durationCap", 0)
    item.setdefault("connectionFee", 0)
    item.setdefault("occupancyPerMinute", 0)
    item.setdefault("occupancyThresholdMinutes", 0)
    item.setdefault("occupancyCap", 0)
    item.setdefault("parkingPerMinute", 0)
    return item


def materialize(data, stations, pdcs, normalized_at=None):
    by_class, subscriptions = validate_source(data)
    subscription_map = {clean(row.get("id")): row for row in subscriptions}
    station_map = {clean(row.get("stationId")): row for row in stations if row.get("stationId")}
    pass_stations = {sid: row for sid, row in station_map.items() if row.get("tariffNetworkId") == "passpass"}
    pass_pdcs = [row for row in pdcs if row.get("tariffNetworkId") == "passpass"]
    normalized_at = normalized_at or dt.datetime.now(dt.timezone.utc).isoformat()
    output = []
    counters = Counter()
    unresolved = []

    for pdc in pass_pdcs:
        pid = clean(pdc.get("pdcId")); sid = clean(pdc.get("stationId"))
        station = pass_stations.get(sid)
        if not station:
            raise AssertionError(f"Pass Pass PDC escaped Pass Pass station scope: {pid}")
        site_class, class_rankable, method = classify(pdc, station)
        counters[f"class_{site_class or 'unresolved'}"] += 1
        counters[f"method_{method}"] += 1
        if not site_class:
            if len(unresolved) < 100:
                unresolved.append({"pdcId": pid, "stationId": sid, "powerKw": pdc.get("powerKw"), "reason": method})
            continue
        for source_offer in by_class[site_class]:
            channel = clean(source_offer.get("channel")) or "reference"
            subscription_id = clean(source_offer.get("subscriptionId")) or None
            rankable = bool(source_offer.get("rankable")) and class_rankable
            blocked = list(source_offer.get("blockedReasons") or [])
            if site_class == "ultra" and "station_tariff_class_not_directly_verified" not in blocked:
                blocked.append("station_tariff_class_not_directly_verified")
            if channel == "subscription":
                sub = subscription_map.get(subscription_id) or {}
                if not sub.get("rankableWhenSelected", False):
                    rankable = False
                    blocked.append("subscription_not_rankable")
            item = {
                "offerId": f"{clean(source_offer.get('id'))}:{pid}",
                "physicalOperatorId": pdc.get("physicalOperatorId") or station.get("physicalOperatorId"),
                "tariffNetworkId": "passpass",
                "provider": clean(source_offer.get("provider")) or "Pass Pass électrique",
                "channel": channel,
                "sourceMode": "network_class_rule",
                "sourceStationId": None,
                "sourceEvseId": None,
                "canonicalStationId": sid,
                "canonicalPdcId": pid,
                "matchMethod": method,
                "matchDistanceMeters": None,
                "selectors": {"siteClass": site_class, "powerKw": pdc.get("powerKw"), "classProof": method},
                "kind": None,
                "minPowerKw": None,
                "maxPowerKw": None,
                "pricingRules": [normalize_rule(rule) for rule in source_offer.get("pricingRules") or []],
                "subscriptionId": subscription_id,
                "validFrom": data.get("validFrom"),
                "validTo": None,
                "rankable": rankable,
                "blockedReasons": blocked,
                "sourceUrl": data.get("source"),
                "sourceUpdatedAt": data.get("verifiedAt"),
                "normalizedAt": normalized_at,
            }
            output.append(item)
            counters[f"offer_{site_class}_{channel}"] += 1
            counters["rankable_offer" if rankable else "reference_offer"] += 1

    output.sort(key=lambda r: (r["canonicalStationId"], r["canonicalPdcId"], r["offerId"]))
    covered_rankable_pdcs = {r["canonicalPdcId"] for r in output if r.get("rankable")}
    reference_pdcs = {r["canonicalPdcId"] for r in output if not r.get("rankable")}
    summary = {
        "canonicalPassPassStationCount": len(pass_stations),
        "canonicalPassPassPdcCount": len(pass_pdcs),
        "materializedOfferCount": len(output),
        "rankableOfferCount": sum(1 for r in output if r.get("rankable")),
        "referenceOfferCount": sum(1 for r in output if not r.get("rankable")),
        "rankableCoveredPdcCount": len(covered_rankable_pdcs),
        "referenceCoveredPdcCount": len(reference_pdcs),
        "unresolvedPdcCount": len(pass_pdcs) - len({r["canonicalPdcId"] for r in output}),
        "physicalInventoryMutationCount": 0,
        "counters": dict(counters),
    }
    return output, subscriptions, summary, unresolved


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="data/passpass_electrique_direct_tariffs_v1.json")
    ap.add_argument("--canonical-dir", default="build/france_irve_identity")
    ap.add_argument("--out-dir", default="build/france_irve_offers")
    args = ap.parse_args()
    data = load_json(args.source)
    canonical = Path(args.canonical_dir)
    offers, subscriptions, summary, unresolved = materialize(
        data,
        load_json(canonical / "stations.json.gz"),
        load_json(canonical / "charge_points.json.gz"),
    )
    out = Path(args.out_dir)
    dump_json(out / "passpass_pdc_offers_contract_v1_1.json.gz", offers)
    dump_json(out / "passpass_subscriptions_contract_v1_1.json", {"schemaVersion":"1.1.1","networkId":"passpass","subscriptions":subscriptions})
    report = {"schemaVersion":"1.1.1","dataset":"france-passpass-canonical-audit","productionReady":False,"summary":summary,"unresolvedExamples":unresolved}
    dump_json(out / "passpass_materialization_report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
