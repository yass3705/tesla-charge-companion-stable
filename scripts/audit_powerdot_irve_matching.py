#!/usr/bin/env python3
"""Audit Powerdot direct tariffs against the canonical France IRVE build.

PAN IRVE remains the only physical inventory. Powerdot may only enrich an
existing canonical station/PDC. Exact id_pdc_itinerance matching has priority;
a unique Powerdot-only geographic match is reported as fallback. Ambiguous and
unmatched rows are never rankable.
"""
from __future__ import annotations

import argparse
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
    value = unicodedata.normalize("NFD", clean(value))
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def number(value):
    try:
        value = float(value)
        return value if math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


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
        return
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2 if pretty else None) + "\n",
        encoding="utf-8",
    )


def haversine_km(lat1, lon1, lat2, lon2):
    values = [number(lat1), number(lon1), number(lat2), number(lon2)]
    if any(value is None for value in values):
        return math.inf
    lat1, lon1, lat2, lon2 = map(math.radians, values)
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371.0088 * 2 * math.asin(math.sqrt(h))


def as_list(value):
    if isinstance(value, list):
        return [clean(item) for item in value if clean(item)]
    return [clean(value)] if clean(value) else []


def location_key(location):
    explicit = clean(location.get("id")) or clean(location.get("uid"))
    if explicit:
        return f"id:{explicit}"
    lat, lon = number(location.get("latitude")), number(location.get("longitude"))
    return "geo:{:.6f}|{:.6f}|{}".format(lat or 0.0, lon or 0.0, norm(location.get("name")))


def tariff_components(tariff):
    rows = []
    if not isinstance(tariff, dict):
        return rows
    for element in tariff.get("elements") or []:
        restrictions = element.get("restrictions") or {}
        for component in element.get("priceComponents") or []:
            ctype = clean(component.get("type")).upper()
            if not ctype:
                continue
            rows.append({
                "type": ctype,
                "pricePerUnit": number(component.get("pricePerUnit")),
                "minDurationSec": number(restrictions.get("minDurationSec")) or 0,
            })
    return rows


def summarize_tariffs(connectors):
    types, currencies = Counter(), Counter()
    structured = subscriptions = 0
    flattened = []
    for connector in connectors:
        tariff = connector.get("tariff") or {}
        if tariff.get("subscriptionActive") is True:
            subscriptions += 1
        currency = clean(tariff.get("currencyCode")).upper()
        if currency:
            currencies[currency] += 1
        components = tariff_components(tariff)
        if components:
            structured += 1
        for component in components:
            types[component["type"]] += 1
            flattened.append(component)
    return {
        "connectorCount": len(connectors),
        "structuredConnectorCount": structured,
        "componentTypes": dict(types),
        "currencies": dict(currencies),
        "subscriptionActiveConnectorCount": subscriptions,
        "components": flattened,
    }


def status_like_fields(value, path="", found=None):
    if found is None:
        found = defaultdict(Counter)
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}" if path else key
            words = set(norm(key).split())
            if words.intersection({"status", "state", "availability", "available"}) and not isinstance(child, (dict, list)):
                found[child_path][clean(child) or "<blank>"] += 1
            status_like_fields(child, child_path, found)
    elif isinstance(value, list):
        for child in value:
            status_like_fields(child, path + "[]", found)
    return found


def build_locations(data):
    grouped = {}
    for entry in data.get("chargers") or []:
        location = entry.get("location") or {}
        key = location_key(location)
        group = grouped.setdefault(key, {
            "sourceLocationKey": key,
            "locationId": clean(location.get("id")),
            "locationUid": clean(location.get("uid")),
            "name": clean(location.get("name")),
            "address": clean(location.get("address")),
            "zipcode": clean(location.get("zipcode")),
            "city": clean(location.get("city")),
            "countryCode": clean(location.get("countryCode")),
            "latitude": number(location.get("latitude")),
            "longitude": number(location.get("longitude")),
            "irvePdcIds": set(),
            "connectors": [],
            "chargerCount": 0,
        })
        group["chargerCount"] += 1
        for candidate in (
            location.get("irvePdcIds"),
            entry.get("irvePdcIds"),
            (entry.get("charger") or {}).get("irvePdcIds"),
        ):
            group["irvePdcIds"].update(as_list(candidate))
        group["connectors"].extend((entry.get("charger") or {}).get("connectors") or [])
    result = []
    for group in grouped.values():
        group["irvePdcIds"] = sorted(group["irvePdcIds"])
        group["tariff"] = summarize_tariffs(group.pop("connectors"))
        result.append(group)
    return result


def is_canonical_powerdot_station(station):
    ids = {
        clean(station.get("tariffNetworkId")),
        clean(station.get("physicalOperatorId")),
        clean(station.get("operatorId")),
    }
    raw = " ".join(clean(station.get(key)) for key in (
        "networkRaw", "physicalOperatorRaw", "operatorRaw", "brand"
    ))
    return "powerdot" in ids or norm(raw).replace(" ", "") .find("powerdot") >= 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--powerdot-gzip", required=True)
    parser.add_argument("--canonical-dir", required=True)
    parser.add_argument("--out-dir", default="build/france_irve_powerdot")
    parser.add_argument("--geo-max-m", type=float, default=100.0)
    args = parser.parse_args()

    data = load_json(args.powerdot_gzip)
    canonical_dir = Path(args.canonical_dir)
    stations = load_json(canonical_dir / "stations.json.gz")
    charge_points = load_json(canonical_dir / "charge_points.json.gz")
    out_dir = Path(args.out_dir)

    source = data.get("source") or {}
    validation = {
        "directCpoPublicAdhocApi": source.get("sourceType") == "direct_cpo_public_adhoc_api",
        "roamingFalse": source.get("roaming") is False,
        "emspCodeEmpty": clean(source.get("emspCode")) == "",
        "operatorPowerDotFrance": norm(source.get("operator")) == "power dot france",
        "chargersArray": isinstance(data.get("chargers"), list),
    }

    pdc_by_itinerance = defaultdict(list)
    for pdc in charge_points:
        pdc_id = clean(pdc.get("idPdcItinerance"))
        if pdc_id:
            pdc_by_itinerance[pdc_id].append(pdc)
    station_by_id = {clean(station.get("stationId")): station for station in stations}
    powerdot_stations = [
        station for station in stations
        if is_canonical_powerdot_station(station)
        and number(station.get("latitude")) is not None
        and number(station.get("longitude")) is not None
    ]

    locations = build_locations(data)
    source_irve_ids, matched_irve_ids, unmatched_irve_ids = set(), set(), set()
    component_types, currencies, match_methods = Counter(), Counter(), Counter()
    source_connectors = structured_connectors = subscription_active = 0
    rows = []

    for location in locations:
        tariff = location["tariff"]
        source_connectors += tariff["connectorCount"]
        structured_connectors += tariff["structuredConnectorCount"]
        subscription_active += tariff["subscriptionActiveConnectorCount"]
        component_types.update(tariff["componentTypes"])
        currencies.update(tariff["currencies"])

        source_ids = set(location["irvePdcIds"])
        source_irve_ids.update(source_ids)
        matched_pdcs, duplicate_ids, missing_ids = [], [], []
        for source_id in sorted(source_ids):
            matches = pdc_by_itinerance.get(source_id, [])
            if len(matches) == 1:
                matched_pdcs.append(matches[0])
                matched_irve_ids.add(source_id)
            elif len(matches) > 1:
                duplicate_ids.append(source_id)
            else:
                missing_ids.append(source_id)
                unmatched_irve_ids.add(source_id)

        exact_station_ids = sorted({clean(pdc.get("stationId")) for pdc in matched_pdcs if clean(pdc.get("stationId"))})
        method, station_id, geo_distance_m = "unmatched", "", None
        ambiguous_station_ids = []
        if duplicate_ids:
            method = "ambiguous_exact_pdc"
        elif len(exact_station_ids) == 1:
            method, station_id = "exact_pdc", exact_station_ids[0]
        elif len(exact_station_ids) > 1:
            method, ambiguous_station_ids = "ambiguous_exact_station", exact_station_ids
        else:
            candidates = []
            if location["latitude"] is not None and location["longitude"] is not None:
                for station in powerdot_stations:
                    distance_km = haversine_km(
                        location["latitude"], location["longitude"],
                        station.get("latitude"), station.get("longitude"),
                    )
                    if distance_km * 1000 <= args.geo_max_m + 1e-9:
                        candidates.append((distance_km, clean(station.get("stationId"))))
            candidates.sort()
            unique = []
            seen = set()
            for distance, candidate_sid in candidates:
                if candidate_sid and candidate_sid not in seen:
                    unique.append((distance, candidate_sid))
                    seen.add(candidate_sid)
            if len(unique) == 1:
                method, station_id = "geo_unique_powerdot", unique[0][1]
                geo_distance_m = round(unique[0][0] * 1000, 1)
            elif len(unique) > 1:
                method = "ambiguous_geo"
                ambiguous_station_ids = [sid for _, sid in unique[:10]]

        match_methods[method] += 1
        structured_tariff = tariff["structuredConnectorCount"] > 0
        rankable = method in {"exact_pdc", "geo_unique_powerdot"} and structured_tariff
        canonical_station = station_by_id.get(station_id) or {}
        matched_canonical_pdc_ids = sorted({
            clean(pdc.get("pdcId")) for pdc in matched_pdcs
            if clean(pdc.get("stationId")) == station_id and clean(pdc.get("pdcId"))
        })
        rows.append({
            "sourceLocationKey": location["sourceLocationKey"],
            "locationId": location["locationId"],
            "locationUid": location["locationUid"],
            "name": location["name"],
            "address": location["address"],
            "zipcode": location["zipcode"],
            "city": location["city"],
            "latitude": location["latitude"],
            "longitude": location["longitude"],
            "sourceIrvePdcIds": sorted(source_ids),
            "matchedCanonicalPdcIds": matched_canonical_pdc_ids,
            "unmatchedSourceIrvePdcIds": missing_ids,
            "duplicateCanonicalPdcIds": duplicate_ids,
            "matchMethod": method,
            "canonicalStationId": station_id or None,
            "canonicalStationName": canonical_station.get("name"),
            "geoDistanceM": geo_distance_m,
            "ambiguousCanonicalStationIds": ambiguous_station_ids,
            "tariff": tariff,
            "structuredTariff": structured_tariff,
            "rankableCandidate": rankable,
            "rankabilityReason": (
                "structured_direct_tariff_on_unique_canonical_match" if rankable
                else "ambiguous_or_unmatched" if method.startswith("ambiguous") or method == "unmatched"
                else "no_structured_tariff"
            ),
        })

    status_fields = status_like_fields(data)
    rankable_locations = sum(row["rankableCandidate"] for row in rows)
    structured_locations = sum(row["structuredTariff"] for row in rows)
    report = {
        "schemaVersion": "1.0.0",
        "dataset": "powerdot-direct-to-france-irve-canonical-audit",
        "productionReady": False,
        "policy": {
            "physicalInventoryAuthority": "PAN IRVE static",
            "statusAuthority": "PAN IRVE dynamic unless a superior direct Powerdot status source is separately validated",
            "tariffSourceMayCreatePhysicalStation": False,
            "matchPrecedence": ["exact_id_pdc_itinerance", "unique_geo_powerdot_fallback"],
            "geoFallbackMaxM": args.geo_max_m,
            "ambiguousOrUnmatchedRankable": False,
            "subscriptionsOptIn": True,
        },
        "sourceValidation": validation,
        "sourceMetadata": source,
        "summary": {
            "sourceChargerCount": len(data.get("chargers") or []),
            "sourceLocationCount": len(locations),
            "sourceConnectorCount": source_connectors,
            "sourceStructuredTariffConnectorCount": structured_connectors,
            "sourceStructuredTariffLocationCount": structured_locations,
            "sourceIrvePdcIdCount": len(source_irve_ids),
            "exactCanonicalIrvePdcMatchCount": len(matched_irve_ids),
            "exactCanonicalIrvePdcCoveragePct": round(100 * len(matched_irve_ids) / len(source_irve_ids), 2) if source_irve_ids else 0,
            "unmatchedSourceIrvePdcIdCount": len(unmatched_irve_ids),
            "canonicalPowerdotStationCandidateCount": len(powerdot_stations),
            "rankableLocationCandidateCount": rankable_locations,
            "rankableLocationCandidatePct": round(100 * rankable_locations / len(locations), 2) if locations else 0,
            "subscriptionActiveConnectorCount": subscription_active,
        },
        "matchMethods": dict(match_methods),
        "tariffComponentTypes": dict(component_types),
        "currencies": dict(currencies),
        "statusLikeFieldsDiscovered": [
            {"path": path, "valueCounts": dict(values.most_common(20)), "observations": sum(values.values())}
            for path, values in sorted(status_fields.items())
        ],
        "examples": {
            "ambiguous": [row for row in rows if row["matchMethod"].startswith("ambiguous")][:30],
            "unmatched": [row for row in rows if row["matchMethod"] == "unmatched"][:30],
            "geoFallback": [row for row in rows if row["matchMethod"] == "geo_unique_powerdot"][:30],
        },
    }

    dump_json(out_dir / "powerdot_irve_match_report.json", report, pretty=True)
    dump_json(out_dir / "powerdot_offer_candidates.json.gz", rows)
    dump_json(out_dir / "manifest.json", {
        "schemaVersion": "1.0.0",
        "dataset": "powerdot-irve-canonical-audit",
        "productionReady": False,
        "source": str(args.powerdot_gzip),
        "canonicalDir": str(canonical_dir),
        "files": {
            "report": "powerdot_irve_match_report.json",
            "offerCandidates": "powerdot_offer_candidates.json.gz",
        },
    }, pretty=True)

    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    print("matchMethods:", json.dumps(report["matchMethods"], ensure_ascii=False))
    print("tariffComponentTypes:", json.dumps(report["tariffComponentTypes"], ensure_ascii=False))
    if not all(validation.values()):
        print("WARNING: Powerdot source validation has failures:", json.dumps(validation, ensure_ascii=False))


if __name__ == "__main__":
    main()
