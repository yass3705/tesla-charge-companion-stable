#!/usr/bin/env python3
"""Finalize legacy-normalizer outputs to France offer contract v1.1.

Legacy `operatorId` meant two different things depending on the source. This
step removes that ambiguity without changing the source adapters themselves.
"""
from __future__ import annotations

import argparse
import gzip
import json
from collections import Counter
from pathlib import Path


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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--identity-dir", default="build/france_irve_identity")
    parser.add_argument("--offers-dir", default="build/france_irve_offers")
    args = parser.parse_args()

    identity_dir = Path(args.identity_dir)
    offers_dir = Path(args.offers_dir)
    stations = load_json(identity_dir / "stations.json.gz")
    station_identity = {
        str(row.get("stationId") or ""): {
            "physicalOperatorId": row.get("physicalOperatorId"),
            "tariffNetworkId": row.get("tariffNetworkId"),
        }
        for row in stations
        if row.get("stationId")
    }

    legacy_station_offers = load_json(offers_dir / "station_offers.json.gz")
    legacy_rule_templates = load_json(offers_dir / "operator_rule_templates.json")

    station_out = []
    counters = Counter()
    for row in legacy_station_offers:
        item = dict(row)
        legacy_id = item.pop("operatorId", None)
        identity = station_identity.get(str(item.get("canonicalStationId") or ""), {})
        item["physicalOperatorId"] = identity.get("physicalOperatorId") or legacy_id
        item["tariffNetworkId"] = identity.get("tariffNetworkId")
        if not item["tariffNetworkId"]:
            # Exact/station-specific source remains useful but not rankable until
            # its customer-facing network identity is resolved.
            item["rankable"] = False
            blocked = list(item.get("blockedReasons") or [])
            if "missing_tariff_network_identity" not in blocked:
                blocked.append("missing_tariff_network_identity")
            item["blockedReasons"] = blocked
            counters["station_missing_network"] += 1
        else:
            counters["station_network_resolved"] += 1
        station_out.append(item)

    rule_out = []
    for row in legacy_rule_templates:
        item = dict(row)
        network_id = item.pop("operatorId", None)
        item["physicalOperatorId"] = None
        item["tariffNetworkId"] = network_id
        item["sourceMode"] = "network_rule"
        item["matchMethod"] = "network_scope"
        if not network_id:
            item["rankable"] = False
            blocked = list(item.get("blockedReasons") or [])
            if "missing_tariff_network_identity" not in blocked:
                blocked.append("missing_tariff_network_identity")
            item["blockedReasons"] = blocked
            counters["rule_missing_network"] += 1
        else:
            counters["rule_network_resolved"] += 1
        rule_out.append(item)

    dump_json(offers_dir / "station_offers_v1_1.json.gz", station_out)
    dump_json(offers_dir / "network_rule_templates_v1_1.json", rule_out)
    report = {
        "schemaVersion": "1.1.0",
        "productionReady": False,
        "stationOfferCount": len(station_out),
        "rankableStationOfferCount": sum(1 for row in station_out if row.get("rankable")),
        "networkRuleTemplateCount": len(rule_out),
        "rankableNetworkRuleTemplateCount": sum(1 for row in rule_out if row.get("rankable")),
        "identityCounts": dict(counters),
    }
    dump_json(offers_dir / "offer_identity_finalization_report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
