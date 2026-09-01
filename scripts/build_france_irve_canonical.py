#!/usr/bin/env python3
"""Build a non-production canonical France IRVE audit snapshot.

The PAN static IRVE dataset is the only source allowed to create physical
stations/charge points. Operator datasets are classified as tariff/enrichment
layers through france_irve_operator_registry_v1.json; they never create a
physical station in this build.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import gzip
import hashlib
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


def first(row, *keys):
    for key in keys:
        value = clean(row.get(key))
        if value:
            return value
    return ""


def num(value):
    try:
        value = str(value).strip().replace(",", ".")
        x = float(value)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def parse_coords(value):
    text = clean(value)
    if not text:
        return None, None
    try:
        parsed = json.loads(text.replace("'", '"'))
        if isinstance(parsed, (list, tuple)) and len(parsed) >= 2:
            lon, lat = num(parsed[0]), num(parsed[1])
            if lat is not None and lon is not None:
                return lat, lon
    except Exception:
        pass
    values = re.findall(r"-?\d+(?:[.,]\d+)?", text)
    if len(values) >= 2:
        lon, lat = num(values[0]), num(values[1])
        if lat is not None and lon is not None:
            return lat, lon
    return None, None


def detect_dialect(path):
    with open(path, "r", encoding="utf-8-sig", newline="") as handle:
        sample = handle.read(65536)
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        return csv.excel


def read_csv(path):
    dialect = detect_dialect(path)
    with open(path, "r", encoding="utf-8-sig", newline="") as handle:
        yield from csv.DictReader(handle, dialect=dialect)


def operator_text(row):
    return " | ".join(
        part
        for part in (
            first(row, "nom_operateur"),
            first(row, "nom_enseigne"),
            first(row, "nom_amenageur"),
        )
        if part
    )


def is_tesla(row):
    return "tesla" in norm(operator_text(row))


def alias_match(raw, aliases):
    raw_n = norm(raw)
    if not raw_n:
        return False
    for alias in aliases:
        alias_n = norm(alias)
        if not alias_n:
            continue
        if raw_n == alias_n:
            return True
        if len(alias_n) >= 5 and re.search(rf"(?:^| ){re.escape(alias_n)}(?: |$)", raw_n):
            return True
    return False


def classify_operator(row, operators):
    candidates = [
        first(row, "nom_operateur"),
        first(row, "nom_enseigne"),
        first(row, "nom_amenageur"),
    ]
    matches = []
    for spec in operators:
        if any(alias_match(value, spec.get("aliases", [])) for value in candidates if value):
            matches.append(spec)
    if len(matches) == 1:
        return matches[0], "alias"
    if len(matches) > 1:
        op_name = first(row, "nom_operateur")
        exact = [
            spec for spec in matches
            if any(norm(op_name) == norm(alias) for alias in spec.get("aliases", []))
        ]
        if len(exact) == 1:
            return exact[0], "operator_exact"
        return None, "ambiguous"
    return None, "unregistered"


def stable_fallback(prefix, values):
    raw = "|".join(norm(v) for v in values)
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:20]
    return f"{prefix}:fallback:{digest}"


def station_id(row):
    explicit = first(row, "id_station_itinerance")
    if explicit:
        return explicit
    local = first(row, "id_station_local")
    op = first(row, "nom_operateur")
    if local:
        return stable_fallback("station", [op, local])
    lat, lon = parse_coords(first(row, "coordonneesXY"))
    return stable_fallback(
        "station",
        [
            op,
            first(row, "nom_station"),
            first(row, "adresse_station"),
            f"{lat:.5f}" if lat is not None else "",
            f"{lon:.5f}" if lon is not None else "",
        ],
    )


def pdc_id(row):
    explicit = first(row, "id_pdc_itinerance")
    if explicit:
        return explicit
    local = first(row, "id_pdc_local")
    if local:
        return stable_fallback("pdc", [station_id(row), local])
    return stable_fallback(
        "pdc",
        [
            station_id(row),
            first(row, "puissance_nominale"),
            first(row, "prise_type_2"),
            first(row, "prise_type_combo_ccs"),
            first(row, "prise_type_chademo"),
        ],
    )


def parse_timestamp(value):
    text = clean(value)
    if not text:
        return None
    try:
        return dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def load_dynamic(path):
    if not path:
        return {}
    latest = {}
    for row in read_csv(path):
        key = first(row, "id_pdc_itinerance")
        if not key:
            continue
        stamp_text = first(row, "horodatage", "last_updated", "date_maj")
        stamp = parse_timestamp(stamp_text)
        current = latest.get(key)
        if current is not None and stamp is not None and current["_stamp"] is not None and stamp <= current["_stamp"]:
            continue
        latest[key] = {
            "etat_pdc": first(row, "etat_pdc") or "inconnu",
            "occupation_pdc": first(row, "occupation_pdc") or "inconnu",
            "horodatage": stamp_text,
            "_stamp": stamp,
        }
    for value in latest.values():
        value.pop("_stamp", None)
    return latest


def json_gzip(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with gzip.open(path, "wb", compresslevel=9) as handle:
        handle.write(payload)
    return len(payload)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--static-csv", required=True)
    parser.add_argument("--dynamic-csv")
    parser.add_argument("--registry", default="data/france_irve_operator_registry_v1.json")
    parser.add_argument("--out-dir", default="build/france_irve")
    args = parser.parse_args()

    registry = json.loads(Path(args.registry).read_text(encoding="utf-8"))
    operators = registry.get("operators", [])
    dynamic = load_dynamic(args.dynamic_csv)
    out_dir = Path(args.out_dir)

    stations = {}
    charge_points = {}
    raw_operator_pdc = Counter()
    raw_operator_stations = defaultdict(set)
    canonical_pdc = Counter()
    canonical_stations = defaultdict(set)
    classification_modes = Counter()
    excluded_tesla_pdc = 0
    ambiguous_rows = []
    unregistered = defaultdict(lambda: {"pdcCount": 0, "stations": set(), "examples": []})

    for row in read_csv(args.static_csv):
        if is_tesla(row):
            excluded_tesla_pdc += 1
            continue

        sid = station_id(row)
        pid = pdc_id(row)
        lat, lon = parse_coords(first(row, "coordonneesXY"))
        raw_op = first(row, "nom_operateur") or first(row, "nom_enseigne") or first(row, "nom_amenageur") or "INCONNU"
        spec, mode = classify_operator(row, operators)
        classification_modes[mode] += 1

        canonical_id = spec["id"] if spec else None
        raw_operator_pdc[raw_op] += 1
        raw_operator_stations[raw_op].add(sid)
        if canonical_id:
            canonical_pdc[canonical_id] += 1
            canonical_stations[canonical_id].add(sid)
        else:
            bucket = unregistered[raw_op]
            bucket["pdcCount"] += 1
            bucket["stations"].add(sid)
            if len(bucket["examples"]) < 3:
                bucket["examples"].append({"stationId": sid, "stationName": first(row, "nom_station"), "address": first(row, "adresse_station")})
            if mode == "ambiguous" and len(ambiguous_rows) < 1000:
                ambiguous_rows.append({"operator": raw_op, "stationId": sid, "pdcId": pid})

        station = stations.get(sid)
        if station is None:
            station = {
                "stationId": sid,
                "idStationItinerance": first(row, "id_station_itinerance"),
                "idStationLocal": first(row, "id_station_local"),
                "name": first(row, "nom_station"),
                "operatorRaw": raw_op,
                "operatorId": canonical_id,
                "brand": first(row, "nom_enseigne"),
                "address": first(row, "adresse_station"),
                "codeInsee": first(row, "code_insee_commune"),
                "latitude": lat,
                "longitude": lon,
                "access": first(row, "condition_acces"),
                "hours": first(row, "horaires"),
                "declaredPdcCount": num(first(row, "nbre_pdc")),
                "pdcIds": [],
            }
            stations[sid] = station
        if pid not in station["pdcIds"]:
            station["pdcIds"].append(pid)

        charge_points[pid] = {
            "pdcId": pid,
            "stationId": sid,
            "idPdcItinerance": first(row, "id_pdc_itinerance"),
            "idPdcLocal": first(row, "id_pdc_local"),
            "operatorId": canonical_id,
            "powerKw": num(first(row, "puissance_nominale")),
            "connectors": {
                "ef": first(row, "prise_type_ef"),
                "type2": first(row, "prise_type_2"),
                "comboCcs": first(row, "prise_type_combo_ccs"),
                "chademo": first(row, "prise_type_chademo"),
                "other": first(row, "prise_type_autre"),
            },
            "status": dynamic.get(first(row, "id_pdc_itinerance")) if dynamic else None,
        }

    operator_rows = []
    for spec in operators:
        oid = spec["id"]
        operator_rows.append({
            "operatorId": oid,
            "label": spec["label"],
            "coverageStatus": spec["coverageStatus"],
            "priority": spec.get("priority", 3),
            "irvePdcCount": canonical_pdc[oid],
            "irveStationCount": len(canonical_stations[oid]),
            "artifactPaths": spec.get("artifactPaths", []),
            "currentIntegration": spec.get("currentIntegration"),
            "needsOwnBase": spec["coverageStatus"] in {"normalize", "staged", "reference_only", "missing_base"},
            "notes": spec.get("notes", ""),
        })
    operator_rows.sort(key=lambda item: (0 if item["needsOwnBase"] else 1, item["priority"], -item["irvePdcCount"], item["label"].lower()))

    missing_raw = []
    for raw_op, values in unregistered.items():
        missing_raw.append({
            "rawOperator": raw_op,
            "pdcCount": values["pdcCount"],
            "stationCount": len(values["stations"]),
            "examples": values["examples"],
        })
    missing_raw.sort(key=lambda item: (-item["pdcCount"], -item["stationCount"], item["rawOperator"].lower()))

    status_counts = Counter()
    occupation_counts = Counter()
    dynamic_matched = 0
    if dynamic:
        for pdc in charge_points.values():
            status = pdc.get("status")
            if status:
                dynamic_matched += 1
                status_counts[status.get("etat_pdc") or "inconnu"] += 1
                occupation_counts[status.get("occupation_pdc") or "inconnu"] += 1

    generated_at = dt.datetime.now(dt.timezone.utc).isoformat()
    audit = {
        "schemaVersion": "1.0.0",
        "generatedAt": generated_at,
        "source": {"staticCsv": str(args.static_csv), "dynamicCsv": str(args.dynamic_csv) if args.dynamic_csv else None, "registry": str(args.registry)},
        "policy": registry.get("inventoryPolicy", {}),
        "summary": {
            "stationCount": len(stations),
            "pdcCount": len(charge_points),
            "teslaRowsExcluded": excluded_tesla_pdc,
            "registeredOperatorCount": len(operators),
            "registeredOperatorsSeen": sum(1 for row in operator_rows if row["irvePdcCount"] > 0),
            "unregisteredRawOperatorCount": len(missing_raw),
            "dynamicPdcMatched": dynamic_matched,
            "dynamicCoveragePct": round(100 * dynamic_matched / len(charge_points), 2) if charge_points else 0,
        },
        "dynamic": {"etatPdc": dict(status_counts), "occupationPdc": dict(occupation_counts)},
        "classificationModes": dict(classification_modes),
        "operators": operator_rows,
        "unregisteredOperators": missing_raw,
        "ambiguousRows": ambiguous_rows,
        "rawOperatorsTop100": [{"rawOperator": raw, "pdcCount": count, "stationCount": len(raw_operator_stations[raw])} for raw, count in raw_operator_pdc.most_common(100)],
    }

    stations_list = sorted(stations.values(), key=lambda item: item["stationId"])
    pdc_list = sorted(charge_points.values(), key=lambda item: item["pdcId"])
    static_bytes = json_gzip(out_dir / "stations.json.gz", stations_list)
    pdc_bytes = json_gzip(out_dir / "charge_points.json.gz", pdc_list)
    (out_dir / "operator_gap_report.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    manifest = {
        "schemaVersion": "1.0.0",
        "dataset": "france-irve-canonical-audit",
        "generatedAt": generated_at,
        "productionReady": False,
        "stationCount": len(stations_list),
        "pdcCount": len(pdc_list),
        "dynamicPdcMatched": dynamic_matched,
        "files": {"stations": "stations.json.gz", "chargePoints": "charge_points.json.gz", "operatorGapReport": "operator_gap_report.json"},
        "uncompressedJsonBytes": {"stations": static_bytes, "chargePoints": pdc_bytes},
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    print("Top unregistered operators:")
    for row in missing_raw[:30]:
        print(f"- {row['rawOperator']}: {row['pdcCount']} PDC / {row['stationCount']} stations")


if __name__ == "__main__":
    main()
