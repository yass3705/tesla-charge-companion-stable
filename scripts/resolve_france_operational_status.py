#!/usr/bin/env python3
"""Resolve France PDC operational state with direct-CPO-first precedence.

Occupation is intentionally ignored. Static PAN presence is never interpreted
as operational availability. With no normalized direct-CPO status inputs, this
resolver safely falls back to PAN IRVE dynamic, then `inconnu`.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
from collections import Counter, defaultdict
from pathlib import Path


KNOWN = {"en_service", "hors_service"}


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


def clean(value):
    return str(value or "").strip()


def canonical_state(value):
    raw = clean(value).lower().replace("-", "_").replace(" ", "_")
    if raw in {"en_service", "available", "operational", "in_service", "online", "active"}:
        return "en_service"
    if raw in {"hors_service", "out_of_service", "unavailable", "offline", "faulted", "inactive"}:
        return "hors_service"
    return "inconnu"


def parse_stamp(value):
    text = clean(value)
    if not text:
        return None
    try:
        parsed = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return parsed.astimezone(dt.timezone.utc)
    except ValueError:
        return None


def iter_direct_rows(payload):
    if isinstance(payload, list):
        yield from (row for row in payload if isinstance(row, dict))
        return
    if not isinstance(payload, dict):
        return
    for key in ("statuses", "chargePoints", "charge_points", "items"):
        rows = payload.get(key)
        if isinstance(rows, list):
            yield from (row for row in rows if isinstance(row, dict))
            return


def direct_key_candidates(row):
    return [
        ("canonical", clean(row.get("canonicalPdcId") or row.get("pdcId"))),
        ("itinerance", clean(row.get("idPdcItinerance") or row.get("id_pdc_itinerance"))),
    ]


def load_direct_statuses(paths):
    by_key = defaultdict(list)
    source_rows = Counter()
    rejected = Counter()
    for raw_path in paths or []:
        path = Path(raw_path)
        payload = load_json(path)
        for row in iter_direct_rows(payload):
            state = canonical_state(row.get("state") or row.get("etat_pdc") or row.get("status"))
            source = clean(row.get("source")) or path.name
            stamp_text = clean(row.get("timestamp") or row.get("horodatage") or row.get("updatedAt"))
            stamp = parse_stamp(stamp_text)
            keys = [(kind, value) for kind, value in direct_key_candidates(row) if value]
            if not keys:
                rejected["missing_identifier"] += 1
                continue
            candidate = {
                "state": state,
                "source": source,
                "timestamp": stamp_text or None,
                "_stamp": stamp,
            }
            for key in keys:
                by_key[key].append(candidate)
            source_rows[source] += 1
    return by_key, source_rows, rejected


def choose_direct(candidates):
    known = [row for row in candidates if row.get("state") in KNOWN]
    if not known:
        return None
    known.sort(key=lambda row: (row.get("_stamp") is not None, row.get("_stamp") or dt.datetime.min.replace(tzinfo=dt.timezone.utc)), reverse=True)
    return known[0]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--canonical-dir", default="build/france_irve_identity")
    parser.add_argument("--policy", default="data/france_status_precedence_v1.json")
    parser.add_argument("--direct-status", action="append", default=[])
    parser.add_argument("--out-dir", default="build/france_irve_status")
    args = parser.parse_args()

    policy = load_json(args.policy)
    charge_points = load_json(Path(args.canonical_dir) / "charge_points.json.gz")
    direct, direct_source_rows, rejected = load_direct_statuses(args.direct_status)

    source_counts = Counter()
    state_counts = Counter()
    resolved = []

    for pdc in charge_points:
        pid = clean(pdc.get("pdcId"))
        itinerance = clean(pdc.get("idPdcItinerance"))
        candidates = []
        if pid:
            candidates.extend(direct.get(("canonical", pid), []))
        if itinerance:
            candidates.extend(direct.get(("itinerance", itinerance), []))
        direct_choice = choose_direct(candidates)

        if direct_choice:
            state = direct_choice["state"]
            source_class = "direct_cpo"
            source = direct_choice["source"]
            timestamp = direct_choice.get("timestamp")
        else:
            dyn = pdc.get("status") if isinstance(pdc.get("status"), dict) else {}
            dyn_state = canonical_state(dyn.get("etat_pdc"))
            if dyn_state in KNOWN:
                state = dyn_state
                source_class = "irve_dynamic"
                source = "PAN IRVE dynamic"
                timestamp = clean(dyn.get("horodatage")) or None
            else:
                state = "inconnu"
                source_class = "unknown"
                source = None
                timestamp = None

        source_counts[source_class] += 1
        state_counts[state] += 1
        resolved.append({
            "pdcId": pid,
            "idPdcItinerance": itinerance or None,
            "stationId": pdc.get("stationId"),
            "state": state,
            "sourceClass": source_class,
            "source": source,
            "timestamp": timestamp,
        })

    out_dir = Path(args.out_dir)
    dump_json(out_dir / "charge_point_status.json.gz", resolved)
    report = {
        "schemaVersion": "1.0.0",
        "productionReady": False,
        "occupationIgnored": True,
        "precedence": policy.get("precedence"),
        "summary": {
            "pdcCount": len(resolved),
            "stateCounts": dict(state_counts),
            "sourceCounts": dict(source_counts),
            "directInputFiles": len(args.direct_status),
            "directSourceRows": dict(direct_source_rows),
            "rejectedDirectRows": dict(rejected),
        },
    }
    dump_json(out_dir / "status_resolution_report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
