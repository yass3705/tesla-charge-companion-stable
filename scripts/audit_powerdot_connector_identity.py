#!/usr/bin/env python3
"""Audit connector/PDC identity in the Powerdot direct dataset.

This is deliberately conservative. It never assumes that connector order and
IRVE PDC order are equivalent. A tariff may be assigned to a canonical PDC only
when either:
1. the connector contains the exact canonical PDC id somewhere in its payload;
2. an entry/charger explicitly carries PDC ids and every connector in that
   entry has the same structured tariff; or
3. the location explicitly carries PDC ids and every connector at that
   location has the same structured tariff.

PAN IRVE remains the physical inventory authority.
"""
from __future__ import annotations

import argparse
import gzip
import json
from collections import Counter, defaultdict
from pathlib import Path


def clean(value):
    return str(value or "").strip()


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
        path.write_text(
            json.dumps(value, ensure_ascii=False, indent=2 if pretty else None) + "\n",
            encoding="utf-8",
        )


def as_list(value):
    if isinstance(value, list):
        return [clean(item) for item in value if clean(item)]
    value = clean(value)
    return [value] if value else []


def location_key(location):
    explicit = clean(location.get("id")) or clean(location.get("uid"))
    if explicit:
        return f"id:{explicit}"
    return "geo:{}|{}|{}".format(
        location.get("latitude"),
        location.get("longitude"),
        clean(location.get("name")).lower(),
    )


def pdc_ids_from_scope(value):
    ids = set()
    if not isinstance(value, dict):
        return ids
    for key in ("irvePdcIds", "irve_pdc_ids", "idPdcItinerance", "id_pdc_itinerance"):
        ids.update(as_list(value.get(key)))
    return ids


def canonical_tariff(tariff):
    """Return a stable pricing-only representation for equality comparisons."""
    if not isinstance(tariff, dict):
        return None
    elements = []
    for element in tariff.get("elements") or []:
        restrictions = element.get("restrictions") or {}
        r = {
            key: restrictions.get(key)
            for key in sorted(restrictions)
            if restrictions.get(key) not in (None, "", [], {})
        }
        components = []
        for component in element.get("priceComponents") or []:
            if not isinstance(component, dict):
                continue
            row = {
                key: component.get(key)
                for key in sorted(component)
                if component.get(key) not in (None, "", [], {})
            }
            components.append(row)
        if components:
            elements.append({"restrictions": r, "priceComponents": components})
    if not elements:
        return None
    return {
        "currencyCode": clean(tariff.get("currencyCode")).upper() or "EUR",
        "subscriptionActive": tariff.get("subscriptionActive") is True,
        "elements": elements,
    }


def tariff_signature(tariff):
    canonical = canonical_tariff(tariff)
    if canonical is None:
        return ""
    return json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def exact_pdc_values(value, canonical_pdc_ids, found=None, path=""):
    """Find scalar values in a connector payload that exactly equal a PAN PDC id."""
    if found is None:
        found = defaultdict(set)
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}" if path else key
            exact_pdc_values(child, canonical_pdc_ids, found, child_path)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            exact_pdc_values(child, canonical_pdc_ids, found, f"{path}[{index}]")
    elif isinstance(value, (str, int)):
        text = clean(value)
        if text in canonical_pdc_ids:
            found[path].add(text)
    return found


def add_assignment(assignments, pdc_id, signature, strategy, provenance):
    if not pdc_id or not signature:
        return
    assignments[pdc_id].append({
        "signature": signature,
        "strategy": strategy,
        "provenance": provenance,
    })


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--powerdot-gzip", required=True)
    parser.add_argument("--canonical-dir", required=True)
    parser.add_argument("--out-dir", default="build/france_irve_powerdot")
    args = parser.parse_args()

    data = load_json(args.powerdot_gzip)
    canonical = load_json(Path(args.canonical_dir) / "charge_points.json.gz")
    canonical_pdc_ids = {
        clean(pdc.get("idPdcItinerance")) or clean(pdc.get("pdcId"))
        for pdc in canonical
        if clean(pdc.get("idPdcItinerance")) or clean(pdc.get("pdcId"))
    }
    station_by_pdc = {}
    for pdc in canonical:
        pid = clean(pdc.get("idPdcItinerance")) or clean(pdc.get("pdcId"))
        if pid:
            station_by_pdc[pid] = clean(pdc.get("stationId"))

    locations = defaultdict(lambda: {
        "location": {},
        "locationPdcIds": set(),
        "entries": [],
    })
    payload_match_paths = Counter()
    scope_counts = Counter()
    entry_uniform_count = 0
    entry_heterogeneous_count = 0
    connector_exact_unique_count = 0
    connector_exact_ambiguous_count = 0
    connector_without_exact_id_count = 0
    connector_count = 0

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

        connector_rows = []
        signatures = []
        for connector_index, connector in enumerate(charger.get("connectors") or []):
            connector_count += 1
            signature = tariff_signature((connector or {}).get("tariff") or {})
            if signature:
                signatures.append(signature)
            matches_by_path = exact_pdc_values(connector, canonical_pdc_ids)
            exact_ids = sorted({pid for ids in matches_by_path.values() for pid in ids})
            for path, ids in matches_by_path.items():
                if ids:
                    payload_match_paths[path] += len(ids)
            if len(exact_ids) == 1:
                connector_exact_unique_count += 1
            elif len(exact_ids) > 1:
                connector_exact_ambiguous_count += 1
            else:
                connector_without_exact_id_count += 1
            connector_rows.append({
                "connectorIndex": connector_index,
                "signature": signature,
                "exactPdcIdsInPayload": exact_ids,
            })

        unique_signatures = sorted(set(sig for sig in signatures if sig))
        if len(unique_signatures) == 1 and connector_rows:
            entry_uniform_count += 1
        elif len(unique_signatures) > 1:
            entry_heterogeneous_count += 1

        bucket["entries"].append({
            "entryIndex": entry_index,
            "entryPdcIds": sorted(entry_ids),
            "chargerPdcIds": sorted(charger_ids),
            "specificPdcIds": sorted(entry_ids | charger_ids),
            "connectors": connector_rows,
            "uniformSignature": unique_signatures[0] if len(unique_signatures) == 1 else "",
            "signatureCount": len(unique_signatures),
        })

    assignments = defaultdict(list)
    diagnostics = []
    strategy_counts = Counter()
    location_uniform_count = 0
    location_heterogeneous_count = 0

    for key, bucket in locations.items():
        loc = bucket["location"]
        loc_ids = set(bucket["locationPdcIds"])
        all_connector_signatures = [
            c["signature"]
            for entry in bucket["entries"]
            for c in entry["connectors"]
            if c["signature"]
        ]
        location_signatures = sorted(set(all_connector_signatures))
        if len(location_signatures) == 1 and all_connector_signatures:
            location_uniform_count += 1
        elif len(location_signatures) > 1:
            location_heterogeneous_count += 1

        connector_mapped_pdc = set()
        for entry in bucket["entries"]:
            for connector in entry["connectors"]:
                ids = connector["exactPdcIdsInPayload"]
                if len(ids) == 1 and connector["signature"]:
                    pid = ids[0]
                    connector_mapped_pdc.add(pid)
                    add_assignment(
                        assignments, pid, connector["signature"], "connector_exact",
                        {"locationKey": key, "entryIndex": entry["entryIndex"], "connectorIndex": connector["connectorIndex"]},
                    )
                    strategy_counts["connector_exact"] += 1

        entry_group_pdc = set()
        for entry in bucket["entries"]:
            ids = set(entry["specificPdcIds"])
            sig = entry["uniformSignature"]
            exact_ids = {pid for pid in ids if pid in canonical_pdc_ids}
            if ids and exact_ids == ids and sig:
                for pid in exact_ids - connector_mapped_pdc:
                    add_assignment(
                        assignments, pid, sig, "entry_group_uniform",
                        {"locationKey": key, "entryIndex": entry["entryIndex"]},
                    )
                    entry_group_pdc.add(pid)
                    strategy_counts["entry_group_uniform"] += 1

        exact_loc_ids = {pid for pid in loc_ids if pid in canonical_pdc_ids}
        if loc_ids and exact_loc_ids == loc_ids and len(location_signatures) == 1:
            sig = location_signatures[0]
            for pid in exact_loc_ids - connector_mapped_pdc - entry_group_pdc:
                add_assignment(
                    assignments, pid, sig, "location_group_uniform",
                    {"locationKey": key},
                )
                strategy_counts["location_group_uniform"] += 1

        all_source_ids = set(loc_ids)
        for entry in bucket["entries"]:
            all_source_ids.update(entry["specificPdcIds"])
        exact_source_ids = {pid for pid in all_source_ids if pid in canonical_pdc_ids}
        resolved_here = {pid for pid in exact_source_ids if pid in assignments}
        station_ids = sorted({station_by_pdc.get(pid, "") for pid in exact_source_ids if station_by_pdc.get(pid, "")})
        if len(station_ids) > 1 or exact_source_ids - resolved_here:
            diagnostics.append({
                "locationKey": key,
                "name": loc["name"],
                "city": loc["city"],
                "canonicalStationIds": station_ids,
                "sourceExactPdcCount": len(exact_source_ids),
                "resolvedPdcCount": len(resolved_here),
                "unresolvedPdcIds": sorted(exact_source_ids - resolved_here),
                "locationTariffSignatureCount": len(location_signatures),
                "entryCount": len(bucket["entries"]),
                "entrySummary": [{
                    "entryIndex": e["entryIndex"],
                    "specificPdcIds": e["specificPdcIds"],
                    "connectorCount": len(e["connectors"]),
                    "signatureCount": e["signatureCount"],
                    "connectorExactPdcCount": sum(1 for c in e["connectors"] if len(c["exactPdcIdsInPayload"]) == 1),
                } for e in bucket["entries"]],
            })

    safe_rows = []
    conflicting_pdc = []
    for pid, candidates in assignments.items():
        signatures = {row["signature"] for row in candidates}
        if len(signatures) != 1:
            conflicting_pdc.append({
                "pdcId": pid,
                "candidateCount": len(candidates),
                "strategies": sorted({row["strategy"] for row in candidates}),
                "signatureCount": len(signatures),
            })
            continue
        best_rank = {"connector_exact": 0, "entry_group_uniform": 1, "location_group_uniform": 2}
        chosen = min(candidates, key=lambda row: best_rank[row["strategy"]])
        safe_rows.append({
            "pdcId": pid,
            "stationId": station_by_pdc.get(pid),
            "strategy": chosen["strategy"],
            "tariff": json.loads(chosen["signature"]),
            "provenance": chosen["provenance"],
        })

    source_location_ids = set()
    for bucket in locations.values():
        source_location_ids.update(pid for pid in bucket["locationPdcIds"] if pid in canonical_pdc_ids)
        for entry in bucket["entries"]:
            source_location_ids.update(pid for pid in entry["specificPdcIds"] if pid in canonical_pdc_ids)

    safe_pdc_ids = {row["pdcId"] for row in safe_rows}
    report = {
        "schemaVersion": "1.0.0",
        "dataset": "powerdot-connector-pdc-identity-audit",
        "productionReady": False,
        "policy": {
            "connectorOrderMayImplyPdcIdentity": False,
            "physicalInventoryAuthority": "PAN IRVE static",
            "safeStrategies": ["connector_exact", "entry_group_uniform", "location_group_uniform"],
            "conflictingTariffsRankable": False,
        },
        "summary": {
            "sourceEntryCount": len(data.get("chargers") or []),
            "sourceLocationCount": len(locations),
            "sourceConnectorCount": connector_count,
            "canonicalPdcReferencedAtSpecificOrLocationScope": len(source_location_ids),
            "connectorExactUniquePdcCount": connector_exact_unique_count,
            "connectorExactAmbiguousPdcCount": connector_exact_ambiguous_count,
            "connectorWithoutExactPdcIdCount": connector_without_exact_id_count,
            "uniformEntryCount": entry_uniform_count,
            "heterogeneousEntryCount": entry_heterogeneous_count,
            "uniformLocationCount": location_uniform_count,
            "heterogeneousLocationCount": location_heterogeneous_count,
            "safeCanonicalPdcTariffCount": len(safe_pdc_ids),
            "safeCanonicalPdcTariffPctOfReferenced": round(100 * len(safe_pdc_ids) / len(source_location_ids), 2) if source_location_ids else 0,
            "conflictingCanonicalPdcCount": len(conflicting_pdc),
        },
        "pdcIdScopeCounts": dict(scope_counts),
        "connectorExactPdcPayloadPaths": dict(payload_match_paths),
        "safeAssignmentStrategies": dict(strategy_counts),
        "conflictingPdc": conflicting_pdc[:100],
        "diagnostics": diagnostics[:200],
    }

    out_dir = Path(args.out_dir)
    dump_json(out_dir / "powerdot_connector_identity_report.json", report, pretty=True)
    dump_json(out_dir / "powerdot_safe_pdc_tariff_candidates.json.gz", sorted(safe_rows, key=lambda row: row["pdcId"]))
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    print("PDC id scope counts:", json.dumps(report["pdcIdScopeCounts"], ensure_ascii=False))
    print("Connector exact PDC payload paths:", json.dumps(report["connectorExactPdcPayloadPaths"], ensure_ascii=False))
    print("Safe assignment strategies:", json.dumps(report["safeAssignmentStrategies"], ensure_ascii=False))


if __name__ == "__main__":
    main()
