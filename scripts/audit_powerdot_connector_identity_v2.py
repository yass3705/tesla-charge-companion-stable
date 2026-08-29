#!/usr/bin/env python3
"""Conservative Powerdot connector/PDC identity audit (v2).

Never infer connector identity from array order or arbitrary scalar equality.
A tariff can reach a PAN PDC only through:
- an explicit connector field whose semantic name denotes a PDC/EVSE identifier;
- an entry/charger scope explicitly listing PAN PDC ids with one uniform tariff;
- a location scope explicitly listing PAN PDC ids with one uniform tariff.

Heterogeneous groups without explicit connector identity remain unresolved.
"""
from __future__ import annotations

import argparse
import gzip
import json
import re
from collections import Counter, defaultdict
from pathlib import Path


EXPLICIT_CONNECTOR_ID_KEYS = {
    "idpdcitinerance", "pdcid", "irvepdcid",
    "evseid", "evseuid", "evseidentifier",
}


def clean(value):
    return str(value or "").strip()


def norm_key(value):
    return re.sub(r"[^a-z0-9]+", "", clean(value).lower())


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
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2 if pretty else None) + "\n", encoding="utf-8")


def as_list(value):
    if isinstance(value, list):
        return [clean(item) for item in value if clean(item)]
    value = clean(value)
    return [value] if value else []


def pdc_ids_from_scope(value):
    ids = set()
    if not isinstance(value, dict):
        return ids
    for key in ("irvePdcIds", "irve_pdc_ids", "idPdcItinerance", "id_pdc_itinerance"):
        ids.update(as_list(value.get(key)))
    return ids


def location_key(location):
    explicit = clean(location.get("id")) or clean(location.get("uid"))
    if explicit:
        return f"id:{explicit}"
    return "geo:{}|{}|{}".format(location.get("latitude"), location.get("longitude"), clean(location.get("name")).lower())


def canonical_tariff(tariff):
    if not isinstance(tariff, dict):
        return None
    elements = []
    for element in tariff.get("elements") or []:
        restrictions = element.get("restrictions") or {}
        normalized_restrictions = {
            key: restrictions.get(key)
            for key in sorted(restrictions)
            if restrictions.get(key) not in (None, "", [], {})
        }
        components = []
        for component in element.get("priceComponents") or []:
            if not isinstance(component, dict):
                continue
            normalized_component = {
                key: component.get(key)
                for key in sorted(component)
                if component.get(key) not in (None, "", [], {})
            }
            components.append(normalized_component)
        if components:
            elements.append({"restrictions": normalized_restrictions, "priceComponents": components})
    if not elements:
        return None
    return {
        "currencyCode": clean(tariff.get("currencyCode")).upper() or "EUR",
        "subscriptionActive": tariff.get("subscriptionActive") is True,
        "elements": elements,
    }


def tariff_signature(tariff):
    value = canonical_tariff(tariff)
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) if value else ""


def explicit_connector_pdc_ids(value, canonical_ids, path="", found=None):
    """Only inspect values under semantically explicit PDC/EVSE id keys."""
    if found is None:
        found = defaultdict(set)
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}" if path else key
            if norm_key(key) in EXPLICIT_CONNECTOR_ID_KEYS:
                for candidate in as_list(child):
                    if candidate in canonical_ids:
                        found[child_path].add(candidate)
            elif isinstance(child, (dict, list)):
                explicit_connector_pdc_ids(child, canonical_ids, child_path, found)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            explicit_connector_pdc_ids(child, canonical_ids, f"{path}[{index}]", found)
    return found


def scalar_schema(connector):
    result = {}
    for key, value in (connector or {}).items():
        if key == "tariff":
            continue
        if isinstance(value, (str, int, float, bool)) or value is None:
            result[key] = value
        elif isinstance(value, list) and len(value) <= 8 and all(isinstance(item, (str, int, float, bool)) for item in value):
            result[key] = value
    return result


def add_assignment(assignments, pid, signature, strategy, provenance):
    if pid and signature:
        assignments[pid].append({"signature": signature, "strategy": strategy, "provenance": provenance})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--powerdot-gzip", required=True)
    parser.add_argument("--canonical-dir", required=True)
    parser.add_argument("--out-dir", default="build/france_irve_powerdot")
    args = parser.parse_args()

    data = load_json(args.powerdot_gzip)
    canonical = load_json(Path(args.canonical_dir) / "charge_points.json.gz")
    canonical_ids = set()
    station_by_pdc = {}
    for pdc in canonical:
        pid = clean(pdc.get("idPdcItinerance")) or clean(pdc.get("pdcId"))
        if pid:
            canonical_ids.add(pid)
            station_by_pdc[pid] = clean(pdc.get("stationId"))

    locations = defaultdict(lambda: {"location": {}, "locationPdcIds": set(), "entries": []})
    scope_counts = Counter()
    explicit_paths = Counter()
    connector_count = 0
    explicit_unique_connectors = 0
    explicit_ambiguous_connectors = 0
    connector_without_explicit_id = 0
    uniform_entries = 0
    heterogeneous_entries = 0
    schema_samples = []

    for entry_index, entry in enumerate(data.get("chargers") or []):
        location = entry.get("location") or {}
        charger = entry.get("charger") or {}
        key = location_key(location)
        bucket = locations[key]
        if not bucket["location"]:
            bucket["location"] = {
                "key": key,
                "id": clean(location.get("id")),
                "uid": clean(location.get("uid")),
                "name": clean(location.get("name")),
                "city": clean(location.get("city")),
            }

        location_ids = pdc_ids_from_scope(location)
        entry_ids = pdc_ids_from_scope(entry)
        charger_ids = pdc_ids_from_scope(charger)
        bucket["locationPdcIds"].update(location_ids)
        if location_ids:
            scope_counts["location_with_pdc_ids"] += 1
        if entry_ids:
            scope_counts["entry_with_pdc_ids"] += 1
        if charger_ids:
            scope_counts["charger_with_pdc_ids"] += 1

        connectors = []
        signatures = []
        for connector_index, connector in enumerate(charger.get("connectors") or []):
            connector_count += 1
            signature = tariff_signature((connector or {}).get("tariff") or {})
            if signature:
                signatures.append(signature)
            by_path = explicit_connector_pdc_ids(connector, canonical_ids)
            exact_ids = sorted({pid for ids in by_path.values() for pid in ids})
            for path, ids in by_path.items():
                explicit_paths[path] += len(ids)
            if len(exact_ids) == 1:
                explicit_unique_connectors += 1
            elif len(exact_ids) > 1:
                explicit_ambiguous_connectors += 1
            else:
                connector_without_explicit_id += 1
            connectors.append({
                "connectorIndex": connector_index,
                "signature": signature,
                "explicitPdcIds": exact_ids,
                "schema": scalar_schema(connector),
            })

        unique_signatures = sorted(set(sig for sig in signatures if sig))
        if connectors and len(unique_signatures) == 1:
            uniform_entries += 1
        elif len(unique_signatures) > 1:
            heterogeneous_entries += 1
            if len(schema_samples) < 20:
                schema_samples.append({
                    "entryIndex": entry_index,
                    "location": bucket["location"],
                    "entryPdcIds": sorted(entry_ids),
                    "chargerPdcIds": sorted(charger_ids),
                    "connectorCount": len(connectors),
                    "signatureCount": len(unique_signatures),
                    "connectors": [{
                        "connectorIndex": row["connectorIndex"],
                        "explicitPdcIds": row["explicitPdcIds"],
                        "schema": row["schema"],
                        "tariff": json.loads(row["signature"]) if row["signature"] else None,
                    } for row in connectors[:12]],
                })

        bucket["entries"].append({
            "entryIndex": entry_index,
            "specificPdcIds": sorted(entry_ids | charger_ids),
            "connectors": connectors,
            "uniformSignature": unique_signatures[0] if len(unique_signatures) == 1 else "",
            "signatureCount": len(unique_signatures),
        })

    assignments = defaultdict(list)
    strategy_counts = Counter()
    uniform_locations = 0
    heterogeneous_locations = 0
    diagnostics = []

    for key, bucket in locations.items():
        loc = bucket["location"]
        loc_ids = set(bucket["locationPdcIds"])
        location_signatures = sorted({
            connector["signature"]
            for entry in bucket["entries"]
            for connector in entry["connectors"]
            if connector["signature"]
        })
        if len(location_signatures) == 1:
            uniform_locations += 1
        elif len(location_signatures) > 1:
            heterogeneous_locations += 1

        connector_assigned = set()
        for entry in bucket["entries"]:
            for connector in entry["connectors"]:
                ids = connector["explicitPdcIds"]
                if len(ids) == 1 and connector["signature"]:
                    pid = ids[0]
                    add_assignment(assignments, pid, connector["signature"], "connector_explicit_id", {
                        "locationKey": key,
                        "entryIndex": entry["entryIndex"],
                        "connectorIndex": connector["connectorIndex"],
                    })
                    connector_assigned.add(pid)
                    strategy_counts["connector_explicit_id"] += 1

        entry_assigned = set()
        for entry in bucket["entries"]:
            ids = set(entry["specificPdcIds"])
            exact_ids = {pid for pid in ids if pid in canonical_ids}
            signature = entry["uniformSignature"]
            if ids and exact_ids == ids and signature:
                for pid in exact_ids - connector_assigned:
                    add_assignment(assignments, pid, signature, "entry_group_uniform", {
                        "locationKey": key,
                        "entryIndex": entry["entryIndex"],
                    })
                    entry_assigned.add(pid)
                    strategy_counts["entry_group_uniform"] += 1

        exact_location_ids = {pid for pid in loc_ids if pid in canonical_ids}
        if loc_ids and exact_location_ids == loc_ids and len(location_signatures) == 1:
            for pid in exact_location_ids - connector_assigned - entry_assigned:
                add_assignment(assignments, pid, location_signatures[0], "location_group_uniform", {"locationKey": key})
                strategy_counts["location_group_uniform"] += 1

        referenced = set(loc_ids)
        for entry in bucket["entries"]:
            referenced.update(entry["specificPdcIds"])
        referenced = {pid for pid in referenced if pid in canonical_ids}
        resolved = {pid for pid in referenced if pid in assignments}
        canonical_stations = sorted({station_by_pdc.get(pid, "") for pid in referenced if station_by_pdc.get(pid, "")})
        if len(canonical_stations) > 1 or referenced - resolved:
            diagnostics.append({
                "locationKey": key,
                "name": loc["name"],
                "city": loc["city"],
                "canonicalStationIds": canonical_stations,
                "referencedPdcCount": len(referenced),
                "resolvedPdcCount": len(resolved),
                "unresolvedPdcIds": sorted(referenced - resolved),
                "locationTariffSignatureCount": len(location_signatures),
                "entries": [{
                    "entryIndex": entry["entryIndex"],
                    "specificPdcIds": entry["specificPdcIds"],
                    "connectorCount": len(entry["connectors"]),
                    "signatureCount": entry["signatureCount"],
                    "explicitConnectorIdentityCount": sum(1 for c in entry["connectors"] if len(c["explicitPdcIds"]) == 1),
                } for entry in bucket["entries"]],
            })

    safe_rows = []
    conflicts = []
    best_rank = {"connector_explicit_id": 0, "entry_group_uniform": 1, "location_group_uniform": 2}
    for pid, candidates in assignments.items():
        signatures = {row["signature"] for row in candidates}
        if len(signatures) != 1:
            conflicts.append({
                "pdcId": pid,
                "candidateCount": len(candidates),
                "signatureCount": len(signatures),
                "strategies": sorted({row["strategy"] for row in candidates}),
            })
            continue
        chosen = min(candidates, key=lambda row: best_rank[row["strategy"]])
        safe_rows.append({
            "pdcId": pid,
            "stationId": station_by_pdc.get(pid),
            "strategy": chosen["strategy"],
            "tariff": json.loads(chosen["signature"]),
            "provenance": chosen["provenance"],
        })

    referenced_ids = set()
    for bucket in locations.values():
        referenced_ids.update(pid for pid in bucket["locationPdcIds"] if pid in canonical_ids)
        for entry in bucket["entries"]:
            referenced_ids.update(pid for pid in entry["specificPdcIds"] if pid in canonical_ids)
    safe_ids = {row["pdcId"] for row in safe_rows}

    report = {
        "schemaVersion": "2.0.0",
        "dataset": "powerdot-connector-pdc-identity-audit",
        "productionReady": False,
        "policy": {
            "connectorOrderMayImplyPdcIdentity": False,
            "arbitraryScalarEqualityMayImplyPdcIdentity": False,
            "explicitConnectorIdentityKeys": sorted(EXPLICIT_CONNECTOR_ID_KEYS),
            "physicalInventoryAuthority": "PAN IRVE static",
            "safeStrategies": ["connector_explicit_id", "entry_group_uniform", "location_group_uniform"],
            "heterogeneousGroupWithoutExplicitConnectorIdentityRankable": False,
            "conflictingTariffsRankable": False,
        },
        "summary": {
            "sourceEntryCount": len(data.get("chargers") or []),
            "sourceLocationCount": len(locations),
            "sourceConnectorCount": connector_count,
            "canonicalPdcReferencedAtExplicitScope": len(referenced_ids),
            "connectorExplicitUniquePdcCount": explicit_unique_connectors,
            "connectorExplicitAmbiguousPdcCount": explicit_ambiguous_connectors,
            "connectorWithoutExplicitPdcIdCount": connector_without_explicit_id,
            "uniformEntryCount": uniform_entries,
            "heterogeneousEntryCount": heterogeneous_entries,
            "uniformLocationCount": uniform_locations,
            "heterogeneousLocationCount": heterogeneous_locations,
            "safeCanonicalPdcTariffCount": len(safe_ids),
            "safeCanonicalPdcTariffPctOfReferenced": round(100 * len(safe_ids) / len(referenced_ids), 2) if referenced_ids else 0,
            "unresolvedCanonicalPdcCount": len(referenced_ids - safe_ids),
            "conflictingCanonicalPdcCount": len(conflicts),
        },
        "pdcIdScopeCounts": dict(scope_counts),
        "connectorExplicitPdcPayloadPaths": dict(explicit_paths),
        "safeAssignmentStrategies": dict(strategy_counts),
        "conflictingPdc": conflicts[:100],
        "heterogeneousConnectorSchemaSamples": schema_samples,
        "diagnostics": diagnostics[:300],
    }

    out_dir = Path(args.out_dir)
    dump_json(out_dir / "powerdot_connector_identity_report_v2.json", report, pretty=True)
    dump_json(out_dir / "powerdot_safe_pdc_tariff_candidates_v2.json.gz", sorted(safe_rows, key=lambda row: row["pdcId"]))
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    print("PDC scopes:", json.dumps(report["pdcIdScopeCounts"], ensure_ascii=False))
    print("Explicit connector identity paths:", json.dumps(report["connectorExplicitPdcPayloadPaths"], ensure_ascii=False))
    print("Safe strategies:", json.dumps(report["safeAssignmentStrategies"], ensure_ascii=False))
    if schema_samples:
        print("First heterogeneous connector schema sample:")
        print(json.dumps(schema_samples[0], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
