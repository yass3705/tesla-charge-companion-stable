#!/usr/bin/env python3
import argparse
import csv
import gzip
import json
from collections import Counter, defaultdict
from pathlib import Path


def load_gzip_json(path: Path):
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


def clean(value):
    return str(value or "").strip()


def first(row, *keys):
    for key in keys:
        value = clean(row.get(key))
        if value:
            return value
    return ""


def read_csv(path):
    with open(path, "r", encoding="utf-8-sig", newline="") as fh:
        sample = fh.read(65536)
        fh.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        except csv.Error:
            dialect = csv.excel
        yield from csv.DictReader(fh, dialect=dialect)


def department_from_insee(code):
    s = str(code or "").strip()
    if not s:
        return "unknown"
    if s.startswith("2A") or s.startswith("2B"):
        return s[:2]
    return s[:2] if len(s) >= 2 else "unknown"


def prefix(value, n=5):
    s = str(value or "").strip().upper()
    return s[:n] if s else "unknown"


def power_bucket(power):
    try:
        p = float(power)
    except (TypeError, ValueError):
        return "unknown"
    if p <= 3.7:
        return "<=3.7"
    if p <= 7.4:
        return "3.7-7.4"
    if p <= 22.5:
        return "7.4-22.5"
    if p <= 50:
        return "22.5-50"
    if p <= 90:
        return "50-90"
    if p <= 150:
        return "90-150"
    return ">150"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--canonical-dir", required=True)
    ap.add_argument("--review", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--static-csv")
    args = ap.parse_args()

    canonical = Path(args.canonical_dir)
    stations = load_gzip_json(canonical / "stations.json.gz")
    pdcs = load_gzip_json(canonical / "charge_points.json.gz")
    review = json.load(open(args.review, encoding="utf-8"))

    station_by_id = {s.get("stationId"): s for s in stations}
    target_pdcs = [p for p in pdcs if p.get("tariffNetworkId") == "alize-liberte"]
    target_pdc_ids = {p.get("pdcId") for p in target_pdcs if p.get("pdcId")}
    target_station_ids = {p.get("stationId") for p in target_pdcs if p.get("stationId")}
    target_stations = [station_by_id[sid] for sid in target_station_ids if sid in station_by_id]

    dept_pdcs = Counter()
    dept_stations = defaultdict(set)
    physical = Counter()
    raw_ops = Counter()
    brands = Counter()
    station_prefixes = Counter()
    pdc_prefixes = Counter()
    powers = Counter()
    examples = defaultdict(list)

    for p in target_pdcs:
        s = station_by_id.get(p.get("stationId"), {})
        dept = department_from_insee(s.get("codeInsee"))
        dept_pdcs[dept] += 1
        if p.get("stationId"):
            dept_stations[dept].add(p.get("stationId"))
        physical[str(p.get("physicalOperatorId") or s.get("physicalOperatorId") or "unknown")] += 1
        raw_ops[str(s.get("operatorRaw") or "unknown")] += 1
        brands[str(s.get("brand") or "unknown")] += 1
        station_prefixes[prefix(s.get("stationId"))] += 1
        pdc_prefixes[prefix(p.get("pdcId"))] += 1
        powers[power_bucket(p.get("powerKw"))] += 1
        if len(examples[dept]) < 4:
            examples[dept].append({
                "stationId": s.get("stationId"),
                "pdcId": p.get("pdcId"),
                "name": s.get("name"),
                "codeInsee": s.get("codeInsee"),
                "physicalOperatorId": p.get("physicalOperatorId") or s.get("physicalOperatorId"),
                "operatorRaw": s.get("operatorRaw"),
                "powerKw": p.get("powerKw"),
            })

    amenageur_rows = []
    static_match_count = 0
    if args.static_csv:
        static_meta = {}
        for row in read_csv(args.static_csv):
            pid = first(row, "id_pdc_itinerance")
            if pid not in target_pdc_ids:
                continue
            static_meta[pid] = {
                "amenageur": first(row, "nom_amenageur") or "unknown",
                "operator": first(row, "nom_operateur") or "unknown",
                "brand": first(row, "nom_enseigne") or "unknown",
            }
        static_match_count = len(static_meta)

        amenageur_pdcs = Counter()
        amenageur_stations = defaultdict(set)
        amenageur_departments = defaultdict(Counter)
        amenageur_powers = defaultdict(Counter)
        for p in target_pdcs:
            pid = p.get("pdcId")
            meta = static_meta.get(pid) or {}
            amenageur = meta.get("amenageur") or "unknown"
            s = station_by_id.get(p.get("stationId"), {})
            dept = department_from_insee(s.get("codeInsee"))
            amenageur_pdcs[amenageur] += 1
            if p.get("stationId"):
                amenageur_stations[amenageur].add(p.get("stationId"))
            amenageur_departments[amenageur][dept] += 1
            amenageur_powers[amenageur][power_bucket(p.get("powerKw"))] += 1

        for amenageur, count in amenageur_pdcs.most_common():
            amenageur_rows.append({
                "amenageur": amenageur,
                "stationCount": len(amenageur_stations[amenageur]),
                "pdcCount": count,
                "departments": dict(amenageur_departments[amenageur].most_common()),
                "powerBuckets": dict(amenageur_powers[amenageur].most_common()),
            })

    report = {
        "schemaVersion": "1.1.0",
        "dataset": "france-alize-liberte-canonical-scope-audit",
        "productionReady": False,
        "reviewVerifiedAt": review.get("verifiedAt"),
        "summary": {
            "canonicalAlizeLiberteStationCount": len(target_stations),
            "canonicalAlizeLibertePdcCount": len(target_pdcs),
            "rankableOfferCount": 0,
            "physicalInventoryMutationCount": 0,
            "classification": review.get("classification"),
            "requiresLocalTariffMapping": True,
            "staticPanPdcMatchedForAmenageur": static_match_count,
        },
        "departmentInventory": [
            {"department": d, "stationCount": len(dept_stations[d]), "pdcCount": dept_pdcs[d]}
            for d in sorted(dept_pdcs, key=lambda x: (-dept_pdcs[x], x))
        ],
        "amenageurInventory": amenageur_rows,
        "physicalOperatorPdcCounts": dict(physical.most_common()),
        "operatorRawPdcCounts": dict(raw_ops.most_common()),
        "brandPdcCounts": dict(brands.most_common()),
        "stationIdPrefixPdcCounts": dict(station_prefixes.most_common()),
        "pdcIdPrefixPdcCounts": dict(pdc_prefixes.most_common()),
        "powerBucketPdcCounts": dict(powers.most_common()),
        "examplesByDepartment": dict(examples),
    }

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
