#!/usr/bin/env python3
"""Attach strict Freshmile direct tariffs to canonical France IRVE identities.

The tariff source is enrichment only: it cannot create physical stations/PDCs.
Technical CPO identity is not sufficient; rankable offers are restricted to the
customer-facing tariff network `freshmile` so regional networks operated by
Freshmile never inherit the Freshmile direct tariff accidentally.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path


def clean(value):
    return str(value or "").strip()


def compact_id(value):
    return re.sub(r"[^A-Z0-9]", "", clean(value).upper())


def number(value):
    try:
        value = float(value)
        return value if math.isfinite(value) else None
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


def haversine_m(lat1, lon1, lat2, lon2):
    radius = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(h))


def validate_source(data):
    if data.get("dataset") != "freshmile-direct-tcc-v8-france" or data.get("schemaVersion") != "1.0.0":
        raise ValueError("unexpected Freshmile strict dataset contract")
    scope = data.get("scope") or {}
    expected = {
        "countryCode": "FR",
        "onlyDirectCpo": True,
        "onlyStrictTccExact": True,
        "roamingIncluded": False,
        "configuredRegionalNetworksIncluded": False,
        "preferentialTariffsIncluded": False,
    }
    for key, expected_value in expected.items():
        if scope.get(key) != expected_value:
            raise ValueError(f"invalid Freshmile scope: {key}={scope.get(key)!r}")
    stations = data.get("stations") or []
    if not isinstance(stations, list) or not stations:
        raise ValueError("Freshmile strict source has no stations")
    expected_count = (data.get("counts") or {}).get("strictPublishedStations")
    if expected_count is not None and len(stations) != int(expected_count):
        raise ValueError("Freshmile strict station count mismatch")
    return stations


def validate_exact(exact):
    if not isinstance(exact, dict) or exact.get("currency") != "EUR":
        return False, "invalid_exact_formula"
    energy = exact.get("energy")
    time = exact.get("time")
    session_fee = number(exact.get("sessionFeeEur"))
    if exact.get("free") is True:
        valid = session_fee in (None, 0) and not energy and not time
        return valid, None if valid else "inconsistent_free_formula"
    if session_fee is not None and session_fee < 0:
        return False, "invalid_session_fee"
    if energy:
        amount = number(energy.get("amount"))
        if amount is None or amount < 0 or energy.get("billing") not in {"started_kwh", "linear_kwh"}:
            return False, "invalid_energy_component"
    if time:
        amount = number(time.get("amount"))
        threshold = number(time.get("startAfterMinutes"))
        if amount is None or amount < 0 or time.get("billing") != "started_minute":
            return False, "invalid_time_component"
        if time.get("appliesTo") not in {"charge", "occupied"}:
            return False, "invalid_time_scope"
        if threshold is not None and threshold < 0:
            return False, "invalid_time_threshold"
    if not energy and not time and not (session_fee is not None and session_fee > 0):
        return False, "empty_formula"
    return True, None


def strict_config(config):
    if not isinstance(config, dict):
        return False, "invalid_config"
    required = {
        "freshmileDirect": True,
        "freshmileVerified": True,
        "freshmileStrictExact": True,
        "offerType": "operator_direct",
    }
    for key, expected in required.items():
        if config.get(key) != expected:
            return False, f"invalid_{key}"
    if clean(config.get("kind")).upper() not in {"AC", "DC"}:
        return False, "invalid_kind"
    if not (number(config.get("powerKw")) or 0) > 0:
        return False, "invalid_power"
    if not (number(config.get("stalls")) or 0) > 0:
        return False, "invalid_stalls"
    if not [clean(value) for value in config.get("freshmileEvseIds") or [] if clean(value)]:
        return False, "missing_evse_ids"
    return validate_exact((config.get("pricing") or {}).get("freshmileExact"))


def build_indexes(stations, pdcs):
    station_by_id = {}
    station_raw = defaultdict(set)
    station_compact = defaultdict(set)
    freshmile_geo = []
    pdc_by_id = {}
    pdc_compact = defaultdict(set)
    for station in stations:
        station_id = clean(station.get("stationId"))
        if not station_id:
            continue
        station_by_id[station_id] = station
        for value in (station_id, station.get("idStationItinerance"), station.get("idStationLocal")):
            value = clean(value)
            if value:
                station_raw[value].add(station_id)
                station_compact[compact_id(value)].add(station_id)
        if station.get("tariffNetworkId") == "freshmile":
            lat, lon = number(station.get("latitude")), number(station.get("longitude"))
            if lat is not None and lon is not None:
                freshmile_geo.append((station_id, lat, lon))
    for pdc in pdcs:
        pdc_id = clean(pdc.get("pdcId"))
        if not pdc_id:
            continue
        pdc_by_id[pdc_id] = pdc
        for value in (pdc_id, pdc.get("idPdcItinerance"), pdc.get("idPdcLocal")):
            token = compact_id(value)
            if token:
                pdc_compact[token].add(pdc_id)
    return station_by_id, station_raw, station_compact, freshmile_geo, pdc_by_id, pdc_compact


def unique(index, key):
    values = index.get(key) or set()
    return next(iter(values)) if len(values) == 1 else None


def match_config(source_station, config, indexes):
    station_by_id, station_raw, station_compact, freshmile_geo, pdc_by_id, pdc_compact = indexes
    pdc_matches = []
    non_freshmile_pdc_hits = 0
    for source_evse in [clean(v) for v in config.get("freshmileEvseIds") or [] if clean(v)]:
        pdc_id = unique(pdc_compact, compact_id(source_evse))
        if not pdc_id:
            continue
        pdc = pdc_by_id[pdc_id]
        if pdc.get("tariffNetworkId") != "freshmile":
            non_freshmile_pdc_hits += 1
            continue
        pdc_matches.append((source_evse, pdc_id, pdc))
    if pdc_matches:
        station_ids = {clean(row[2].get("stationId")) for row in pdc_matches}
        if len(station_ids) == 1:
            station_id = next(iter(station_ids))
            station = station_by_id.get(station_id) or {}
            if station.get("tariffNetworkId") == "freshmile":
                return station_id, pdc_matches, "exact_source_evse", None, non_freshmile_pdc_hits
        return None, [], "ambiguous", None, non_freshmile_pdc_hits

    source_station_id = clean(source_station.get("stationId"))
    station_id = unique(station_raw, source_station_id) if source_station_id else None
    if not station_id and source_station_id:
        station_id = unique(station_compact, compact_id(source_station_id))
    if station_id:
        station = station_by_id.get(station_id) or {}
        if station.get("tariffNetworkId") == "freshmile":
            return station_id, [], "exact_source_station", None, non_freshmile_pdc_hits
        return None, [], "non_freshmile_network", None, non_freshmile_pdc_hits

    lat, lon = number(source_station.get("latitude")), number(source_station.get("longitude"))
    if lat is not None and lon is not None:
        candidates = []
        for candidate_id, station_lat, station_lon in freshmile_geo:
            distance = haversine_m(lat, lon, station_lat, station_lon)
            if distance <= 100.0:
                candidates.append((distance, candidate_id))
        candidates.sort()
        if len(candidates) == 1:
            return candidates[0][1], [], "unique_geo_operator_100m", round(candidates[0][0], 1), non_freshmile_pdc_hits
        if len(candidates) > 1:
            return None, [], "ambiguous", None, non_freshmile_pdc_hits
    return None, [], "unmatched", None, non_freshmile_pdc_hits


def pricing_rule(exact):
    result = {
        "scope": "allDay", "start": "00:00", "end": "24:00", "days": None,
        "currency": "EUR", "pricePerKwh": 0, "chargePerMinute": 0,
        "chargeThresholdMinutes": 0, "durationPerMinute": 0,
        "durationThresholdMinutes": 0, "connectionFee": 0,
        "occupancyPerMinute": 0, "occupancyThresholdMinutes": 0,
        "occupancyCap": 0, "parkingPerMinute": 0, "rounding": None,
        "notes": "Freshmile strict direct exact formula",
    }
    if exact.get("free") is True:
        result["notes"] = "Freshmile strict direct free formula"
        return result
    session_fee = number(exact.get("sessionFeeEur"))
    if session_fee is not None:
        result["connectionFee"] = session_fee
    rounding = []
    energy = exact.get("energy") or None
    if energy:
        result["pricePerKwh"] = number(energy.get("amount")) or 0
        if energy.get("billing") == "started_kwh":
            rounding.append("started_kwh")
    time = exact.get("time") or None
    if time:
        amount = number(time.get("amount")) or 0
        threshold = number(time.get("startAfterMinutes")) or 0
        if time.get("appliesTo") == "charge":
            result["chargePerMinute"] = amount
            result["chargeThresholdMinutes"] = threshold
        else:
            result["durationPerMinute"] = amount
            result["durationThresholdMinutes"] = threshold
        rounding.append("started_minute")
    if rounding:
        result["rounding"] = "_and_".join(rounding)
    return result


def build_offer(source_station, config, station_id, pdc_id, source_evse, method, distance, updated_at, normalized_at):
    kind = clean(config.get("kind")).upper()
    power = number(config.get("powerKw"))
    exact = (config.get("pricing") or {}).get("freshmileExact") or {}
    power_token = compact_id(f"{kind}{power if power is not None else 'any'}")
    target_token = compact_id(pdc_id or station_id)
    return {
        "offerId": f"freshmile-direct:{target_token}:{power_token}",
        "physicalOperatorId": "freshmile", "tariffNetworkId": "freshmile",
        "provider": "Freshmile", "channel": "direct",
        "sourceMode": "station_evse" if pdc_id else "station_power",
        "sourceStationId": clean(source_station.get("stationId")) or None,
        "sourceEvseId": source_evse, "canonicalStationId": station_id,
        "canonicalPdcId": pdc_id, "matchMethod": method,
        "matchDistanceMeters": distance, "selectors": {"freshmileStrictExact": True},
        "kind": kind, "minPowerKw": power, "maxPowerKw": power,
        "pricingRules": [pricing_rule(exact)], "subscriptionId": None,
        "validFrom": None, "validTo": None, "rankable": True,
        "blockedReasons": [],
        "sourceUrl": "https://raw.githubusercontent.com/yass3705/tesla-charge-companion-data-lab/main/data/national/freshmile_direct_tcc_v8.json.gz",
        "sourceUpdatedAt": updated_at, "normalizedAt": normalized_at,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--freshmile-gzip", required=True)
    parser.add_argument("--canonical-dir", default="build/france_irve_identity")
    parser.add_argument("--out-dir", default="build/france_irve_offers")
    args = parser.parse_args()

    source = load_json(args.freshmile_gzip)
    source_stations = validate_source(source)
    canonical_dir = Path(args.canonical_dir)
    stations = load_json(canonical_dir / "stations.json.gz")
    pdcs = load_json(canonical_dir / "charge_points.json.gz")
    indexes = build_indexes(stations, pdcs)
    canonical_station_ids = {clean(row.get("stationId")) for row in stations if row.get("stationId")}
    canonical_pdc_ids = {clean(row.get("pdcId")) for row in pdcs if row.get("pdcId")}
    freshmile_stations = {clean(row.get("stationId")) for row in stations if row.get("tariffNetworkId") == "freshmile"}
    freshmile_pdcs = {clean(row.get("pdcId")) for row in pdcs if row.get("tariffNetworkId") == "freshmile"}

    counters = Counter()
    outcomes = Counter()
    offers = []
    unresolved = []
    seen = set()
    source_config_count = 0
    strict_config_count = 0
    normalized_at = dt.datetime.now(dt.timezone.utc).isoformat()
    source_updated_at = clean(source.get("generatedAt")) or None

    for source_station in source_stations:
        station_has_offer = False
        for config_index, config in enumerate(source_station.get("configurations") or []):
            source_config_count += 1
            valid, reason = strict_config(config)
            if not valid:
                counters[f"rejected_{reason}"] += 1
                continue
            strict_config_count += 1
            station_id, pdc_matches, method, distance, nonfresh_hits = match_config(source_station, config, indexes)
            counters[f"match_{method}"] += 1
            counters["non_freshmile_pdc_hits"] += nonfresh_hits
            if not station_id:
                if len(unresolved) < 100:
                    unresolved.append({"sourceStationId": source_station.get("stationId"), "name": source_station.get("name"), "configIndex": config_index, "matchMethod": method})
                continue
            if station_id not in freshmile_stations:
                counters["blocked_non_freshmile_tariff_network"] += 1
                continue
            targets = [(source_evse, pdc_id) for source_evse, pdc_id, _ in pdc_matches] if pdc_matches else [(None, None)]
            for source_evse, pdc_id in targets:
                if pdc_id and pdc_id not in freshmile_pdcs:
                    counters["blocked_non_freshmile_pdc_network"] += 1
                    continue
                signature = (station_id, pdc_id, clean(config.get("kind")).upper(), number(config.get("powerKw")), json.dumps((config.get("pricing") or {}).get("freshmileExact") or {}, sort_keys=True))
                if signature in seen:
                    counters["deduplicated_offer"] += 1
                    continue
                seen.add(signature)
                offers.append(build_offer(source_station, config, station_id, pdc_id, source_evse, method, distance, source_updated_at, normalized_at))
                counters["materialized_pdc_offer" if pdc_id else "materialized_station_offer"] += 1
                station_has_offer = True
        outcomes["with_offer" if station_has_offer else "without_offer"] += 1

    for offer in offers:
        if offer["canonicalStationId"] not in canonical_station_ids:
            raise AssertionError("Freshmile offer created a non-canonical station")
        if offer.get("canonicalPdcId") and offer["canonicalPdcId"] not in canonical_pdc_ids:
            raise AssertionError("Freshmile offer created a non-canonical PDC")
        if offer["canonicalStationId"] not in freshmile_stations or offer["tariffNetworkId"] != "freshmile":
            raise AssertionError("Freshmile offer escaped tariff-network scope")

    offers.sort(key=lambda row: (row["canonicalStationId"], row.get("canonicalPdcId") or "", row["offerId"]))
    out_dir = Path(args.out_dir)
    dump_json(out_dir / "freshmile_station_offers_contract_v1_1.json.gz", offers)
    report = {
        "schemaVersion": "1.1.1", "dataset": "france-freshmile-canonical-direct-audit",
        "productionReady": False,
        "summary": {
            "sourceStationCount": len(source_stations), "sourceConfigCount": source_config_count,
            "strictConfigCount": strict_config_count,
            "canonicalFreshmileTariffNetworkStationCount": len(freshmile_stations),
            "canonicalFreshmileTariffNetworkPdcCount": len(freshmile_pdcs),
            "materializedOfferCount": len(offers),
            "rankableOfferCount": sum(1 for row in offers if row.get("rankable")),
            "coveredCanonicalStationCount": len({row["canonicalStationId"] for row in offers}),
            "coveredCanonicalPdcCount": len({row["canonicalPdcId"] for row in offers if row.get("canonicalPdcId")}),
            "physicalInventoryMutationCount": 0, "stationOutcomes": dict(outcomes),
            "counters": dict(counters),
        },
        "unresolvedExamples": unresolved,
    }
    dump_json(out_dir / "freshmile_materialization_report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
