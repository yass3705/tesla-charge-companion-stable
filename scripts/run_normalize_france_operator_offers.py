#!/usr/bin/env python3
"""Compatibility entrypoint for tariff-network and physical-alias resolution.

- operator-rule offers resolve on customer-facing tariff networks;
- station-specific legacy sources may still reference an IRVE station identity
  collapsed by the conservative physical dedupe layer. Those source IDs are
  indexed as aliases of the retained primary station.
"""
import normalize_france_operator_offers as normalizer


def tariff_network_lookup(registry):
    specs = registry.get("networks", registry.get("operators", []))
    by_id = {row["id"]: row for row in specs}
    alias_rows = []
    for row in specs:
        aliases = list(row.get("aliases", []))
        if row.get("label"):
            aliases.append(row["label"])
        for alias in aliases:
            token = normalizer.norm(alias)
            if token:
                alias_rows.append((token, row["id"]))
    return by_id, alias_rows


def alias_aware_station_indexes(stations):
    by_id, raw, compact, by_operator = original_build_station_indexes(stations)
    for station in stations:
        sid = normalizer.clean(station.get("stationId"))
        if not sid:
            continue
        for alias in station.get("physicalAliasStationIds") or []:
            alias = normalizer.clean(alias)
            if not alias:
                continue
            raw[alias].add(sid)
            token = normalizer.compact_id(alias)
            if token:
                compact[token].add(sid)
    return by_id, raw, compact, by_operator


original_build_station_indexes = normalizer.build_station_indexes
normalizer.operator_lookup = tariff_network_lookup
normalizer.build_station_indexes = alias_aware_station_indexes
normalizer.main()
