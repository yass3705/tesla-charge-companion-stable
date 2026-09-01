#!/usr/bin/env python3
"""Normalize existing France operator tariff sources onto a PAN IRVE audit build.

This script never creates a physical station or PDC. Station-specific sources
must match a station already produced by build_france_irve_canonical.py.
Operator-wide tariff grids are emitted as templates scoped to an already-known
canonical operator id.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path


def clean(value):
    return str(value or "").strip()


def norm(value):
    text = unicodedata.normalize("NFD", clean(value))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def compact_id(value):
    return re.sub(r"[^A-Z0-9]", "", clean(value).upper())


def number(value):
    try:
        x = float(value)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def get_path(obj, dotted, default=None):
    current = obj
    for part in clean(dotted).split("."):
        if not part:
            continue
        if not isinstance(current, dict) or part not in current:
            return default
        current = current[part]
    return current


def load_json(path):
    path = Path(path)
    if path.suffix == ".gz":
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            return json.load(handle)
    return json.loads(path.read_text(encoding="utf-8"))


def dump_json(path, value, pretty=True):
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


def haversine_m(lat1, lon1, lat2, lon2):
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def build_station_indexes(stations):
    raw = defaultdict(set)
    compact = defaultdict(set)
    by_operator = defaultdict(list)
    by_id = {}
    for station in stations:
        sid = clean(station.get("stationId"))
        if not sid:
            continue
        by_id[sid] = station
        for value in (
            sid,
            station.get("idStationItinerance"),
            station.get("idStationLocal"),
        ):
            value = clean(value)
            if not value:
                continue
            raw[value].add(sid)
            token = compact_id(value)
            if token:
                compact[token].add(sid)
        operator_id = clean(station.get("operatorId"))
        if operator_id:
            by_operator[operator_id].append(station)
    return by_id, raw, compact, by_operator


def unique_from_index(index, key):
    values = index.get(key) or set()
    if len(values) == 1:
        return next(iter(values))
    return None


def source_coordinates(row, spec):
    field = clean(spec.get("coordinatesField"))
    if not field:
        return None, None
    coords = row.get(field)
    if not isinstance(coords, (list, tuple)) or len(coords) < 2:
        return None, None
    lat, lon = number(coords[0]), number(coords[1])
    if lat is None or lon is None:
        return None, None
    return lat, lon


def match_station(row, spec, raw_index, compact_index, by_operator):
    source_ids = []
    for field in spec.get("stationIdFields", []):
        value = clean(row.get(field))
        if value:
            source_ids.append(value)

    for value in source_ids:
        sid = unique_from_index(raw_index, value)
        if sid:
            return {"stationId": sid, "method": "exact_source_station", "distanceMeters": None, "sourceId": value}

    for value in source_ids:
        token = compact_id(value)
        sid = unique_from_index(compact_index, token) if token else None
        if sid:
            return {"stationId": sid, "method": "exact_source_station", "distanceMeters": None, "sourceId": value}

    lat, lon = source_coordinates(row, spec)
    operator_id = clean(spec.get("operatorId"))
    if lat is not None and lon is not None and operator_id:
        candidates = []
        for station in by_operator.get(operator_id, []):
            slat, slon = number(station.get("latitude")), number(station.get("longitude"))
            if slat is None or slon is None:
                continue
            distance = haversine_m(lat, lon, slat, slon)
            if distance <= 100.0:
                candidates.append((distance, station["stationId"]))
        candidates.sort()
        if len(candidates) == 1:
            return {
                "stationId": candidates[0][1],
                "method": "unique_geo_operator_100m",
                "distanceMeters": round(candidates[0][0], 1),
                "sourceId": source_ids[0] if source_ids else "",
            }
        if len(candidates) > 1:
            return {"stationId": None, "method": "ambiguous", "distanceMeters": None, "sourceId": source_ids[0] if source_ids else ""}

    return {"stationId": None, "method": "unmatched", "distanceMeters": None, "sourceId": source_ids[0] if source_ids else ""}


def operator_lookup(operator_registry):
    specs = operator_registry.get("operators", [])
    by_id = {row["id"]: row for row in specs}
    alias_rows = []
    for row in specs:
        for alias in row.get("aliases", []):
            token = norm(alias)
            if token:
                alias_rows.append((token, row["id"]))
    return by_id, alias_rows


def resolve_offer_operator(offer, fixed_operator_id, alias_rows):
    if fixed_operator_id:
        return fixed_operator_id
    candidate_tokens = {norm(v) for v in offer.get("operatorAliases", []) if clean(v)}
    candidate_tokens.add(norm(offer.get("provider")))
    matches = set()
    for token, operator_id in alias_rows:
        if token in candidate_tokens:
            matches.add(operator_id)
    return next(iter(matches)) if len(matches) == 1 else None


def normalized_station_power_offers(source_spec, data, match_ctx, normalized_at):
    _, raw_index, compact_index, by_operator = match_ctx
    rows = get_path(data, source_spec.get("stationArray", "stations"), []) or []
    results = []
    counters = Counter()
    unmatched_examples = []
    parent_updated = clean(data.get("generatedAt"))

    for station_row in rows:
        if not isinstance(station_row, dict):
            continue
        match = match_station(station_row, source_spec, raw_index, compact_index, by_operator)
        counters[match["method"]] += 1
        if not match["stationId"]:
            if len(unmatched_examples) < 50:
                unmatched_examples.append({
                    "sourceStationId": match.get("sourceId"),
                    "name": clean(station_row.get(source_spec.get("nameField", "name"))),
                    "address": clean(station_row.get(source_spec.get("addressField", "address"))),
                    "matchMethod": match["method"],
                })
            continue

        configs = get_path(station_row, source_spec.get("configArray", "configs"), []) or []
        for index, cfg in enumerate(configs):
            if not isinstance(cfg, dict):
                continue
            power = number(cfg.get(source_spec.get("powerField", "powerKw")))
            price = number(cfg.get(source_spec.get("pricePerKwhField", "pricePerKwh")))
            rankable_field = clean(source_spec.get("rankableField"))
            source_rankable = bool(cfg.get(rankable_field)) if rankable_field else price is not None
            blocked_field = clean(source_spec.get("blockedReasonsField"))
            blocked = list(cfg.get(blocked_field) or []) if blocked_field else []
            if price is None and "missing_price" not in blocked:
                blocked.append("missing_price")
            if match["method"] in {"ambiguous", "unmatched"} and "unsafe_match" not in blocked:
                blocked.append("unsafe_match")
            rankable = bool(source_rankable and price is not None and not blocked)
            kind_field = clean(source_spec.get("kindField"))
            kind = clean(cfg.get(kind_field)).upper() if kind_field else None
            if kind not in {"AC", "DC"}:
                kind = None
            source_station_id = match.get("sourceId") or clean(station_row.get((source_spec.get("stationIdFields") or [""])[0]))
            offer_id = f"{source_spec['id']}:{compact_id(source_station_id) or 'station'}:{str(power or 'any').replace('.', '_')}:{index}"
            results.append({
                "offerId": offer_id,
                "operatorId": source_spec.get("operatorId"),
                "provider": source_spec["id"],
                "channel": "direct",
                "sourceMode": "station_power",
                "sourceStationId": source_station_id,
                "sourceEvseId": None,
                "canonicalStationId": match["stationId"],
                "canonicalPdcId": None,
                "matchMethod": match["method"],
                "matchDistanceMeters": match.get("distanceMeters"),
                "kind": kind,
                "minPowerKw": power,
                "maxPowerKw": power,
                "pricingRules": [{
                    "scope": "allDay",
                    "start": "00:00",
                    "end": "24:00",
                    "days": None,
                    "currency": "EUR",
                    "pricePerKwh": price,
                    "chargePerMinute": 0,
                    "connectionFee": 0,
                    "occupancyPerMinute": 0,
                    "occupancyThresholdMinutes": 0,
                    "occupancyCap": 0,
                    "parkingPerMinute": 0,
                    "notes": None,
                }],
                "subscriptionId": None,
                "validFrom": None,
                "validTo": None,
                "rankable": rankable,
                "blockedReasons": blocked,
                "sourceUrl": clean(get_path(data, "source.artifact")) or clean(get_path(data, "source.dataset")) or source_spec["path"],
                "sourceUpdatedAt": parent_updated,
                "normalizedAt": normalized_at,
            })
    return results, counters, unmatched_examples


def normalized_rule_templates(source_spec, data, alias_rows, normalized_at):
    templates = []
    counters = Counter()
    unresolved = []
    fixed_operator = clean(source_spec.get("operatorId")) or None
    source_updated = clean(data.get("generatedAt"))
    source_url = clean(data.get("source")) if isinstance(data.get("source"), str) else clean(get_path(data, "source.dataset"))

    offers = get_path(data, source_spec.get("offerArray", "operatorOffers"), []) or []
    for offer in offers:
        if not isinstance(offer, dict):
            continue
        operator_id = resolve_offer_operator(offer, fixed_operator, alias_rows)
        if not operator_id:
            counters["unresolved_operator"] += 1
            if len(unresolved) < 50:
                unresolved.append({"id": offer.get("id"), "provider": offer.get("provider"), "operatorAliases": offer.get("operatorAliases", [])})
            continue
        counters["resolved_operator"] += 1
        templates.append({
            "offerId": clean(offer.get("id")) or f"{source_spec['id']}:{len(templates)}",
            "operatorId": operator_id,
            "provider": clean(offer.get("provider")) or operator_id,
            "channel": "direct",
            "sourceMode": "operator_rule",
            "sourceStationId": None,
            "sourceEvseId": None,
            "canonicalStationId": None,
            "canonicalPdcId": None,
            "matchMethod": "operator_scope",
            "matchDistanceMeters": None,
            "kind": clean(offer.get("kind")).upper() or None,
            "minPowerKw": number(offer.get("minPowerKw")),
            "maxPowerKw": number(offer.get("maxPowerKw")),
            "pricingRules": get_path(offer, "pricing.rules", []) or [],
            "subscriptionId": None,
            "validFrom": clean(offer.get("validFrom")) or None,
            "validTo": clean(offer.get("validTo")) or None,
            "rankable": True,
            "blockedReasons": [],
            "sourceUrl": clean(offer.get("source")) or source_url or source_spec["path"],
            "sourceUpdatedAt": source_updated,
            "normalizedAt": normalized_at,
        })

    subscriptions = get_path(data, source_spec.get("subscriptionArray", "subscriptions"), []) or []
    for offer in subscriptions:
        if not isinstance(offer, dict):
            continue
        operator_id = resolve_offer_operator(offer, fixed_operator, alias_rows)
        if not operator_id:
            counters["unresolved_subscription_operator"] += 1
            continue
        counters["resolved_subscription_operator"] += 1
        rule = {
            "scope": "allDay",
            "start": "00:00",
            "end": "24:00",
            "currency": clean(offer.get("currency")) or "EUR",
            "pricePerKwh": number(offer.get("pricePerKwh")),
            "chargePerMinute": number(offer.get("chargePerMinute")) or 0,
            "connectionFee": number(offer.get("connectionFee")) or 0,
            "occupancyPerMinute": number(offer.get("occupancyPerMinute")) or 0,
            "occupancyThresholdMinutes": number(offer.get("occupancyThresholdMinutes")) or 0,
            "occupancyCap": number(offer.get("occupancyCap")) or 0,
            "parkingPerMinute": number(offer.get("parkingPerMinute")) or 0,
            "notes": clean(offer.get("note")) or None,
        }
        blocked = []
        if rule["pricePerKwh"] is None and not offer.get("runtime"):
            blocked.append("subscription_price_not_materialized")
        templates.append({
            "offerId": clean(offer.get("id")) or f"{source_spec['id']}:subscription:{len(templates)}",
            "operatorId": operator_id,
            "provider": clean(offer.get("provider")) or operator_id,
            "channel": "subscription",
            "sourceMode": "operator_rule",
            "sourceStationId": None,
            "sourceEvseId": None,
            "canonicalStationId": None,
            "canonicalPdcId": None,
            "matchMethod": "operator_scope",
            "matchDistanceMeters": None,
            "kind": clean(offer.get("kind")).upper() or None,
            "minPowerKw": number(offer.get("minPowerKw")),
            "maxPowerKw": number(offer.get("maxPowerKw")),
            "pricingRules": [rule] if rule["pricePerKwh"] is not None else [],
            "subscriptionId": clean(offer.get("id")) or None,
            "validFrom": clean(offer.get("validFrom")) or None,
            "validTo": clean(offer.get("validTo")) or None,
            "rankable": not blocked,
            "blockedReasons": blocked,
            "sourceUrl": clean(offer.get("source")) or source_url or source_spec["path"],
            "sourceUpdatedAt": source_updated,
            "normalizedAt": normalized_at,
        })
    return templates, counters, unresolved


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--canonical-dir", default="build/france_irve")
    parser.add_argument("--operator-registry", default="data/france_irve_operator_registry_v1.json")
    parser.add_argument("--adapter-registry", default="data/france_operator_adapter_registry_v1.json")
    parser.add_argument("--out-dir", default="build/france_irve_offers")
    args = parser.parse_args()

    canonical_dir = Path(args.canonical_dir)
    stations = load_json(canonical_dir / "stations.json.gz")
    operator_registry = load_json(args.operator_registry)
    adapter_registry = load_json(args.adapter_registry)
    _, alias_rows = operator_lookup(operator_registry)
    match_ctx = build_station_indexes(stations)
    normalized_at = dt.datetime.now(dt.timezone.utc).isoformat()

    station_offers = []
    rule_templates = []
    source_reports = []

    for source_spec in adapter_registry.get("sources", []):
        path = Path(source_spec["path"])
        if not path.exists():
            source_reports.append({"sourceId": source_spec["id"], "status": "missing_artifact", "path": str(path)})
            continue
        data = load_json(path)
        mode = source_spec.get("mode")
        if mode == "station_power":
            offers, counters, examples = normalized_station_power_offers(source_spec, data, match_ctx, normalized_at)
            station_offers.extend(offers)
            source_reports.append({
                "sourceId": source_spec["id"],
                "status": "processed",
                "mode": mode,
                "offerCount": len(offers),
                "matches": dict(counters),
                "unmatchedExamples": examples,
            })
        elif mode in {"operator_rule", "operator_rule_multi"}:
            templates, counters, unresolved = normalized_rule_templates(source_spec, data, alias_rows, normalized_at)
            rule_templates.extend(templates)
            source_reports.append({
                "sourceId": source_spec["id"],
                "status": "processed",
                "mode": mode,
                "templateCount": len(templates),
                "resolution": dict(counters),
                "unresolvedExamples": unresolved,
            })
        else:
            source_reports.append({"sourceId": source_spec["id"], "status": "unsupported_mode", "mode": mode})

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    dump_json(out_dir / "station_offers.json.gz", station_offers, pretty=False)
    dump_json(out_dir / "operator_rule_templates.json", rule_templates)
    report = {
        "schemaVersion": "1.0.0",
        "generatedAt": normalized_at,
        "productionReady": False,
        "canonicalStationCount": len(stations),
        "stationSpecificOfferCount": len(station_offers),
        "rankableStationSpecificOfferCount": sum(1 for row in station_offers if row.get("rankable")),
        "operatorRuleTemplateCount": len(rule_templates),
        "rankableOperatorRuleTemplateCount": sum(1 for row in rule_templates if row.get("rankable")),
        "sources": source_reports,
    }
    dump_json(out_dir / "match_report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
