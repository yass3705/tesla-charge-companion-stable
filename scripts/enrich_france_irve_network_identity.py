#!/usr/bin/env python3
"""Enrich a canonical PAN IRVE build with two distinct identities.

- physicalOperatorId: technical CPO identity derived from PAN nom_operateur.
- tariffNetworkId: customer-facing network/brand that may own the direct tariff.

A non-empty unknown brand NEVER inherits a generic technical-CPO tariff. This
is deliberate: e.g. TotalEnergies Marketing France can technically operate
Belib', and Bouygues Energies & Services operates multiple tariff networks.
"""
from __future__ import annotations

import argparse
import gzip
import json
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


def alias_score(value_norm, alias_norm):
    if not value_norm or not alias_norm:
        return 0
    if value_norm == alias_norm:
        return 100000 + len(alias_norm)
    # Four-character names such as Lidl/WAAT are common and safe with word boundaries.
    if len(alias_norm) >= 4 and re.search(rf"(?:^| ){re.escape(alias_norm)}(?: |$)", value_norm):
        return 50000 + len(alias_norm)
    return 0


def resolve_by_alias(value, specs, field="aliases", require_fallback=False):
    value_norm = norm(value)
    matches = []
    for spec in specs:
        if require_fallback and not spec.get("operatorFallback"):
            continue
        best = 0
        for alias in spec.get(field, []):
            best = max(best, alias_score(value_norm, norm(alias)))
        if best:
            matches.append((best, spec))
    if not matches:
        return None, "none"
    matches.sort(key=lambda item: (-item[0], item[1].get("id", "")))
    if len(matches) > 1 and matches[0][0] == matches[1][0]:
        return None, "ambiguous"
    return matches[0][1], "alias"


def resolve_physical_operator(raw_operator, operator_specs, network_specs):
    spec, mode = resolve_by_alias(raw_operator, operator_specs, field="aliases")
    if spec:
        return spec.get("id"), mode
    # The network registry also contains extra technical aliases discovered in PAN.
    nspec, nmode = resolve_by_alias(raw_operator, network_specs, field="operatorAliases")
    if nspec:
        return nspec.get("id"), "network_operator_alias"
    return None, mode if mode == "ambiguous" else nmode


def resolve_by_station_id(station_id, physical_operator_id, network_specs):
    """Resolve declarative PAN station-prefix scopes before brand aliases.

    Some IZIVIA commercial programmes publish generic or legacy PAN brands
    (for example ``MAX_002`` or simply ``IZIVIA``).  Their eMI3 station
    prefixes are the stable customer-network boundary.  A prefix rule is only
    valid when its explicitly required technical CPO also matches.
    """
    station_id = clean(station_id).upper()
    if not station_id:
        return None, "none"
    matches = []
    for spec in network_specs:
        for prefix in spec.get("stationIdPrefixes") or []:
            prefix = clean(prefix).upper()
            if prefix and station_id.startswith(prefix):
                matches.append((len(prefix), spec))
    if not matches:
        return None, "none"
    longest = max(length for length, _ in matches)
    candidates = {spec.get("id"): spec for length, spec in matches if length == longest}
    if len(candidates) != 1:
        return None, "ambiguous_station_id_prefix"
    spec = next(iter(candidates.values()))
    required = clean(spec.get("stationIdPhysicalOperatorRequired"))
    if required and clean(physical_operator_id) != required:
        return None, "station_id_physical_operator_mismatch"
    return spec, "station_id_prefix"


def resolve_tariff_network(brand, raw_operator, network_specs, station_id="", physical_operator_id=None):
    brand_text = clean(brand)
    operator_text = clean(raw_operator)
    station_spec, station_mode = resolve_by_station_id(station_id, physical_operator_id, network_specs)
    if station_spec or station_mode != "none":
        return station_spec, station_mode
    if brand_text:
        spec, mode = resolve_by_alias(brand_text, network_specs, field="aliases")
        if spec:
            return spec, "brand_alias"
        # If PAN repeats the exact technical operator as the brand, an explicitly
        # allowed self-network fallback is safe. Otherwise unknown brand stays unknown.
        if norm(brand_text) == norm(operator_text):
            spec, op_mode = resolve_by_alias(operator_text, network_specs, field="operatorAliases", require_fallback=True)
            if spec:
                return spec, "same_brand_operator_fallback"
        return None, "unregistered_brand" if mode != "ambiguous" else "ambiguous_brand"

    spec, mode = resolve_by_alias(operator_text, network_specs, field="operatorAliases", require_fallback=True)
    if spec:
        return spec, "blank_brand_operator_fallback"
    return None, "blank_brand_unresolved" if mode != "ambiguous" else "ambiguous_operator_fallback"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--canonical-dir", default="build/france_irve")
    parser.add_argument("--operator-registry", default="data/france_irve_operator_registry_v1.json")
    parser.add_argument("--network-registry", default="data/france_irve_tariff_network_registry_v1.json")
    parser.add_argument("--out-dir", default="build/france_irve_identity")
    args = parser.parse_args()

    canonical_dir = Path(args.canonical_dir)
    out_dir = Path(args.out_dir)
    operator_registry = load_json(args.operator_registry)
    network_registry = load_json(args.network_registry)
    operator_specs = operator_registry.get("operators", [])
    network_specs = network_registry.get("networks", [])
    network_by_id = {row["id"]: row for row in network_specs}

    stations = load_json(canonical_dir / "stations.json.gz")
    charge_points = load_json(canonical_dir / "charge_points.json.gz")

    physical_modes = Counter()
    network_modes = Counter()
    network_pdc = Counter()
    network_stations = Counter()
    network_status_pdc = Counter()
    unresolved_brand = defaultdict(lambda: {"pdcCount": 0, "stationCount": 0, "operators": Counter(), "examples": []})
    station_identity = {}

    for station in stations:
        sid = clean(station.get("stationId"))
        raw_operator = clean(station.get("operatorRaw"))
        brand = clean(station.get("brand"))
        pdc_count = len(station.get("pdcIds") or [])

        physical_id, physical_mode = resolve_physical_operator(raw_operator, operator_specs, network_specs)
        network_spec, network_mode = resolve_tariff_network(
            brand,
            raw_operator,
            network_specs,
            station_id=sid,
            physical_operator_id=physical_id,
        )
        network_id = network_spec.get("id") if network_spec else None
        network_status = network_spec.get("coverageStatus") if network_spec else None

        physical_modes[physical_mode] += pdc_count
        network_modes[network_mode] += pdc_count
        if network_id:
            network_pdc[network_id] += pdc_count
            network_stations[network_id] += 1
            network_status_pdc[network_status or "unknown"] += pdc_count
        else:
            key = brand or "<blank>"
            bucket = unresolved_brand[key]
            bucket["pdcCount"] += pdc_count
            bucket["stationCount"] += 1
            bucket["operators"][raw_operator or "<blank>"] += pdc_count
            if len(bucket["examples"]) < 3:
                bucket["examples"].append({
                    "stationId": sid,
                    "name": station.get("name"),
                    "operatorRaw": raw_operator,
                    "address": station.get("address"),
                })

        station["physicalOperatorRaw"] = raw_operator
        station["physicalOperatorId"] = physical_id
        station["networkRaw"] = brand
        station["tariffNetworkId"] = network_id
        station["tariffNetworkStatus"] = network_status
        station["identityResolution"] = {
            "physicalOperator": physical_mode,
            "tariffNetwork": network_mode,
        }
        station_identity[sid] = (physical_id, network_id, network_status)

    for pdc in charge_points:
        physical_id, network_id, network_status = station_identity.get(clean(pdc.get("stationId")), (None, None, None))
        pdc["physicalOperatorId"] = physical_id
        pdc["tariffNetworkId"] = network_id
        pdc["tariffNetworkStatus"] = network_status

    network_rows = []
    for network_id, count in network_pdc.items():
        spec = network_by_id[network_id]
        network_rows.append({
            "networkId": network_id,
            "label": spec.get("label"),
            "coverageStatus": spec.get("coverageStatus"),
            "priority": spec.get("priority", 3),
            "pdcCount": count,
            "stationCount": network_stations[network_id],
            "artifacts": spec.get("artifacts", []),
            "notes": spec.get("notes", ""),
        })
    network_rows.sort(key=lambda row: (row["priority"], -row["pdcCount"], row["label"] or ""))

    unresolved_rows = []
    for brand, values in unresolved_brand.items():
        unresolved_rows.append({
            "networkRaw": brand,
            "pdcCount": values["pdcCount"],
            "stationCount": values["stationCount"],
            "topTechnicalOperators": [
                {"operatorRaw": name, "pdcCount": count}
                for name, count in values["operators"].most_common(5)
            ],
            "examples": values["examples"],
        })
    unresolved_rows.sort(key=lambda row: (-row["pdcCount"], -row["stationCount"], row["networkRaw"]))

    # `partial_ready` stays visible: the network has usable structured data, but
    # still needs explicit exception/coverage follow-up before production rollout.
    missing_statuses = {"missing_base", "partial_ready", "scope_to_resolve", "extract_runtime", "normalize", "staged", "reference_only"}
    work_queue = [row for row in network_rows if row["coverageStatus"] in missing_statuses]
    work_queue.sort(key=lambda row: (row["priority"], -row["pdcCount"], row["label"] or ""))

    resolved_pdc = sum(network_pdc.values())
    total_pdc = len(charge_points)
    report = {
        "schemaVersion": "1.0.0",
        "policy": network_registry.get("policy", {}),
        "summary": {
            "stationCount": len(stations),
            "pdcCount": total_pdc,
            "tariffNetworkResolvedPdc": resolved_pdc,
            "tariffNetworkResolvedPct": round(100 * resolved_pdc / total_pdc, 2) if total_pdc else 0,
            "tariffNetworkUnresolvedPdc": total_pdc - resolved_pdc,
            "recognizedNetworkCount": len(network_rows),
            "unresolvedRawNetworkCount": len(unresolved_rows),
        },
        "physicalOperatorResolutionPdc": dict(physical_modes),
        "tariffNetworkResolutionPdc": dict(network_modes),
        "coverageStatusPdc": dict(network_status_pdc),
        "networks": network_rows,
        "workQueue": work_queue,
        "unresolvedNetworks": unresolved_rows,
    }

    out_dir.mkdir(parents=True, exist_ok=True)
    dump_json(out_dir / "stations.json.gz", stations)
    dump_json(out_dir / "charge_points.json.gz", charge_points)
    dump_json(out_dir / "network_gap_report.json", report, pretty=True)
    dump_json(out_dir / "manifest.json", {
        "schemaVersion": "1.0.0",
        "dataset": "france-irve-canonical-network-identity-audit",
        "productionReady": False,
        "stationCount": len(stations),
        "pdcCount": total_pdc,
        "tariffNetworkResolvedPdc": resolved_pdc,
        "files": {
            "stations": "stations.json.gz",
            "chargePoints": "charge_points.json.gz",
            "networkGapReport": "network_gap_report.json",
        },
    }, pretty=True)

    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    print("\nPrioritized known network work queue:")
    for row in work_queue[:40]:
        print(f"- {row['label']}: {row['pdcCount']} PDC / {row['stationCount']} stations [{row['coverageStatus']}]")
    print("\nTop unresolved network/brand names:")
    for row in unresolved_rows[:40]:
        print(f"- {row['networkRaw']}: {row['pdcCount']} PDC / {row['stationCount']} stations")


if __name__ == "__main__":
    main()
