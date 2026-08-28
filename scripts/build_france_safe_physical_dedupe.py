#!/usr/bin/env python3
"""Collapse only high-confidence duplicate physical IRVE station/PDC identities.

This is deliberately conservative. Two station identities are aliases only when:
- they have the same resolved physical CPO,
- the same INSEE commune,
- the same number and power signature of PDCs,
- the same terminal numeric PDC identifiers after provider-prefix removal,
- and their coordinates are within the configured distance.

All removed source IDs are retained as aliases of the chosen physical primary.
No fuzzy name/address-only merge is performed here.
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import re
from collections import Counter, defaultdict
from copy import deepcopy
from pathlib import Path


def load_json(path):
    path = Path(path)
    if path.suffix == ".gz":
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            return json.load(handle)
    return json.loads(path.read_text(encoding="utf-8"))


def dump_json(path, value, pretty=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix == ".gz":
        with gzip.open(path, "wt", encoding="utf-8", compresslevel=9) as handle:
            json.dump(value, handle, ensure_ascii=False, separators=(",", ":"))
    else:
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2 if pretty else None) + "\n", encoding="utf-8")


def clean(value):
    return str(value or "").strip()


def number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def numeric_tail(value):
    match = re.search(r"(\d{6,})$", clean(value).upper())
    return match.group(1) if match else None


def haversine_m(a, b):
    lat1, lon1 = number(a.get("latitude")), number(a.get("longitude"))
    lat2, lon2 = number(b.get("latitude")), number(b.get("longitude"))
    if None in (lat1, lon1, lat2, lon2):
        return None
    radius = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(x))


def metadata_score(station):
    score = 0
    if clean(station.get("tariffNetworkId")):
        score += 1000
    if clean(station.get("address")):
        score += 200
    if clean(station.get("brand")):
        score += 100
    if clean(station.get("hours")):
        score += 50
    if clean(station.get("access")):
        score += 25
    score += min(100, len(clean(station.get("name"))))
    score += min(100, len(clean(station.get("address"))))
    return score


def choose_primary(rows):
    return sorted(rows, key=lambda row: (-metadata_score(row), clean(row.get("stationId"))))[0]


def pdc_signature(station, pdc_by_station):
    rows = pdc_by_station.get(clean(station.get("stationId")), [])
    tails = [numeric_tail(row.get("pdcId") or row.get("idPdcItinerance")) for row in rows]
    if not rows or any(not tail for tail in tails) or len(set(tails)) != len(tails):
        return None
    powers = []
    for row in rows:
        value = number(row.get("powerKw"))
        powers.append(round(value, 2) if value is not None else None)
    return tuple(sorted(tails)), tuple(sorted(powers, key=lambda v: (-1 if v is None else v)))


def components(rows, max_distance_m):
    remaining = set(range(len(rows)))
    result = []
    while remaining:
        seed = remaining.pop()
        comp = {seed}
        changed = True
        while changed:
            changed = False
            for idx in list(remaining):
                for other in comp:
                    distance = haversine_m(rows[idx], rows[other])
                    if distance is not None and distance <= max_distance_m:
                        remaining.remove(idx)
                        comp.add(idx)
                        changed = True
                        break
        result.append([rows[idx] for idx in sorted(comp)])
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--identity-dir", default="build/france_irve_identity")
    parser.add_argument("--out-dir", default="build/france_irve_physical")
    parser.add_argument("--max-distance-m", type=float, default=250.0)
    args = parser.parse_args()

    identity_dir = Path(args.identity_dir)
    stations = load_json(identity_dir / "stations.json.gz")
    charge_points = load_json(identity_dir / "charge_points.json.gz")
    pdc_by_station = defaultdict(list)
    pdc_by_id = {}
    for row in charge_points:
        pdc_by_station[clean(row.get("stationId"))].append(row)
        pdc_by_id[clean(row.get("pdcId"))] = row

    grouped = defaultdict(list)
    skipped_no_signature = 0
    for station in stations:
        signature = pdc_signature(station, pdc_by_station)
        operator_id = clean(station.get("physicalOperatorId"))
        code_insee = clean(station.get("codeInsee"))
        if not signature or not code_insee:
            skipped_no_signature += 1
            continue
        grouped[(operator_id, code_insee, signature)].append(station)

    duplicate_clusters = []
    for _, rows in grouped.items():
        if len(rows) < 2:
            continue
        for comp in components(rows, args.max_distance_m):
            if len(comp) < 2:
                continue
            primary = choose_primary(comp)
            aliases = [row for row in comp if row is not primary]
            duplicate_clusters.append((primary, aliases))

    station_alias_to_primary = {}
    pdc_alias_to_primary = {}
    alias_station_ids = set()
    alias_pdc_ids = set()
    status_conflicts = []
    cluster_rows = []

    for primary, aliases in duplicate_clusters:
        primary_id = clean(primary.get("stationId"))
        primary_pdcs = {numeric_tail(row.get("pdcId")): row for row in pdc_by_station[primary_id]}
        station_alias_ids = []
        pdc_alias_count = 0
        max_distance = 0.0
        for alias in aliases:
            alias_id = clean(alias.get("stationId"))
            station_alias_ids.append(alias_id)
            alias_station_ids.add(alias_id)
            station_alias_to_primary[alias_id] = primary_id
            distance = haversine_m(primary, alias)
            if distance is not None:
                max_distance = max(max_distance, distance)
            for alias_pdc in pdc_by_station[alias_id]:
                tail = numeric_tail(alias_pdc.get("pdcId"))
                primary_pdc = primary_pdcs.get(tail)
                if not primary_pdc:
                    continue
                alias_pid = clean(alias_pdc.get("pdcId"))
                primary_pid = clean(primary_pdc.get("pdcId"))
                alias_pdc_ids.add(alias_pid)
                pdc_alias_to_primary[alias_pid] = primary_pid
                pdc_alias_count += 1
                a_status = alias_pdc.get("status") or {}
                p_status = primary_pdc.get("status") or {}
                a_state = clean(a_status.get("etat_pdc")) if isinstance(a_status, dict) else ""
                p_state = clean(p_status.get("etat_pdc")) if isinstance(p_status, dict) else ""
                if a_state and p_state and a_state != p_state:
                    status_conflicts.append({
                        "primaryPdcId": primary_pid,
                        "aliasPdcId": alias_pid,
                        "primaryState": p_state,
                        "aliasState": a_state,
                    })
                elif not p_state and a_state:
                    primary_pdc["status"] = deepcopy(alias_pdc.get("status"))

        cluster_rows.append({
            "primaryStationId": primary_id,
            "aliasStationIds": sorted(station_alias_ids),
            "physicalOperatorId": primary.get("physicalOperatorId"),
            "tariffNetworkId": primary.get("tariffNetworkId"),
            "codeInsee": primary.get("codeInsee"),
            "pdcPerIdentity": len(primary_pdcs),
            "aliasPdcCount": pdc_alias_count,
            "maxAliasDistanceMeters": round(max_distance, 1),
        })

    station_primary_aliases = defaultdict(list)
    for alias_id, primary_id in station_alias_to_primary.items():
        station_primary_aliases[primary_id].append(alias_id)
    pdc_primary_aliases = defaultdict(list)
    for alias_id, primary_id in pdc_alias_to_primary.items():
        pdc_primary_aliases[primary_id].append(alias_id)

    dedup_stations = []
    for original in stations:
        sid = clean(original.get("stationId"))
        if sid in alias_station_ids:
            continue
        row = deepcopy(original)
        aliases = sorted(station_primary_aliases.get(sid, []))
        if aliases:
            row["physicalAliasStationIds"] = aliases
        row["pdcIds"] = [pid for pid in row.get("pdcIds", []) if pid not in alias_pdc_ids]
        dedup_stations.append(row)

    dedup_pdcs = []
    for original in charge_points:
        pid = clean(original.get("pdcId"))
        if pid in alias_pdc_ids:
            continue
        row = deepcopy(original)
        aliases = sorted(pdc_primary_aliases.get(pid, []))
        if aliases:
            row["physicalAliasPdcIds"] = aliases
        dedup_pdcs.append(row)

    cluster_rows.sort(key=lambda row: (clean(row.get("physicalOperatorId")), clean(row.get("primaryStationId"))))
    operator_clusters = Counter(clean(row.get("physicalOperatorId")) or "<unresolved>" for row in cluster_rows)
    report = {
        "schemaVersion": "1.0.0",
        "productionReady": False,
        "policy": {
            "maxDistanceMeters": args.max_distance_m,
            "requiresSamePhysicalOperator": True,
            "requiresSameInsee": True,
            "requiresSamePdcNumericTails": True,
            "requiresSamePowerSignature": True,
            "fuzzyNameOnlyMerge": False,
        },
        "inputStationCount": len(stations),
        "outputPhysicalStationCount": len(dedup_stations),
        "removedAliasStationCount": len(alias_station_ids),
        "inputPdcCount": len(charge_points),
        "outputPhysicalPdcCount": len(dedup_pdcs),
        "removedAliasPdcCount": len(alias_pdc_ids),
        "duplicateClusterCount": len(cluster_rows),
        "skippedStationNoSafeSignature": skipped_no_signature,
        "dynamicStatusConflictCount": len(status_conflicts),
        "clustersByPhysicalOperator": dict(operator_clusters.most_common()),
        "clusters": cluster_rows,
        "statusConflicts": status_conflicts[:500],
    }

    out_dir = Path(args.out_dir)
    dump_json(out_dir / "stations.json.gz", dedup_stations)
    dump_json(out_dir / "charge_points.json.gz", dedup_pdcs)
    dump_json(out_dir / "station_alias_map.json", station_alias_to_primary, pretty=True)
    dump_json(out_dir / "pdc_alias_map.json", pdc_alias_to_primary, pretty=True)
    dump_json(out_dir / "dedup_report.json", report, pretty=True)
    print(json.dumps({key: value for key, value in report.items() if key not in {"clusters", "statusConflicts"}}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
