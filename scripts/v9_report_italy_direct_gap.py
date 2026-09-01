#!/usr/bin/env python3
"""Audit Italy V9 direct-tariff coverage by exact PUN EVSE and CPO.

The browser catalogue is the physical source of truth. Direct commercial coverage
comes only from exact-EVSE direct offers already published by the V9 builder.
No eMSP or selected-subscription offer is counted as a CPO-direct tariff.

This audit is intentionally rerun after the full Go Electric publication.
"""
from __future__ import annotations

import argparse
import gzip
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def load_catalogue(path: Path) -> list[list[Any]]:
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        rows = json.load(fh)
    if not isinstance(rows, list):
        raise SystemExit("Italy compact catalogue must be a JSON list")
    return rows


def load_direct_ids(path: Path) -> set[str]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("country") != "IT":
        raise SystemExit("Italy offers payload has unexpected country")
    direct_ids: set[str] = set()
    for offer in payload.get("directOffers") or []:
        if not isinstance(offer, dict):
            continue
        if offer.get("verifiedScope") != "exact_evse" or offer.get("directOperatorOnly") is not True:
            raise SystemExit(f"non-exact or non-direct offer in directOffers: {offer.get('id')}")
        for evse_id in offer.get("evseIds") or []:
            eid = str(evse_id or "").strip()
            if eid:
                direct_ids.add(eid)
    return direct_ids


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalogue", default="data/v9/italy-static/all.json.gz")
    ap.add_argument("--offers", default="data/v9/italy-offers.json")
    ap.add_argument("--json-out", default="data/v9/italy-direct-gap-report.json")
    ap.add_argument("--markdown-out", default="data/v9/italy-direct-gap-report.md")
    args = ap.parse_args()

    rows = load_catalogue(Path(args.catalogue))
    direct_ids = load_direct_ids(Path(args.offers))

    evse_to_cpo: dict[str, str] = {}
    evse_to_station: dict[str, str] = {}
    cpo_stations: dict[str, set[str]] = defaultdict(set)
    collisions: list[dict[str, str]] = []

    for row in rows:
        if not isinstance(row, list) or len(row) < 12:
            raise SystemExit("unexpected Italy compact station row schema")
        station_id = str(row[0] or "").strip()
        cpo = str(row[11] or row[5] or "UNKNOWN").strip() or "UNKNOWN"
        configs = row[8] if isinstance(row[8], list) else []
        for cfg in configs:
            if not isinstance(cfg, list) or not cfg:
                continue
            eid = str(cfg[0] or "").strip()
            if not eid:
                continue
            prior_cpo = evse_to_cpo.get(eid)
            if prior_cpo is not None and prior_cpo != cpo:
                collisions.append({"evseId": eid, "firstCpo": prior_cpo, "secondCpo": cpo})
                continue
            evse_to_cpo[eid] = cpo
            evse_to_station[eid] = station_id
            cpo_stations[cpo].add(station_id)

    if collisions:
        raise SystemExit(f"EVSE-to-CPO collisions detected: {collisions[:5]}")

    physical_ids = set(evse_to_cpo)
    matched_direct_ids = physical_ids & direct_ids
    orphan_direct_ids = direct_ids - physical_ids

    by_cpo: dict[str, dict[str, Any]] = {}
    cpo_evse: dict[str, set[str]] = defaultdict(set)
    for eid, cpo in evse_to_cpo.items():
        cpo_evse[cpo].add(eid)

    for cpo, ids in cpo_evse.items():
        covered = ids & direct_ids
        gap = ids - direct_ids
        gap_stations = {evse_to_station[eid] for eid in gap}
        by_cpo[cpo] = {
            "cpo": cpo,
            "stations": len(cpo_stations[cpo]),
            "physicalEvse": len(ids),
            "directCoveredEvse": len(covered),
            "uncoveredEvse": len(gap),
            "stationsWithGap": len(gap_stations),
            "directCoveragePct": round(100.0 * len(covered) / len(ids), 2) if ids else 0.0,
        }

    ranking = sorted(
        by_cpo.values(),
        key=lambda x: (-x["uncoveredEvse"], -x["physicalEvse"], x["cpo"].casefold()),
    )

    generated_at = now_iso()
    report = {
        "schemaVersion": 1,
        "country": "IT",
        "generatedAt": generated_at,
        "method": "exact PUN EVSE identity vs V9 exact-EVSE CPO-direct offers",
        "commercialChannelsExcludedFromDirectCoverage": ["emsp", "selected_subscription", "national_fallback"],
        "summary": {
            "stations": len(rows),
            "physicalEvse": len(physical_ids),
            "directOfferEvseIds": len(direct_ids),
            "matchedDirectEvse": len(matched_direct_ids),
            "uncoveredEvse": len(physical_ids - direct_ids),
            "directCoveragePct": round(100.0 * len(matched_direct_ids) / len(physical_ids), 2) if physical_ids else 0.0,
            "orphanDirectOfferEvseIds": len(orphan_direct_ids),
            "cpoCount": len(by_cpo),
        },
        "ranking": ranking,
        "orphanDirectOfferEvseIds": sorted(orphan_direct_ids),
    }

    Path(args.json_out).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    md = [
        "# Italy V9 direct-tariff gap audit",
        "",
        f"Generated: `{generated_at}`",
        "",
        "Coverage counts only validated **CPO-direct exact-EVSE** offers. eMSP, selected subscriptions and national fallback are intentionally excluded.",
        "",
        f"- Physical stations: **{report['summary']['stations']:,}**",
        f"- Physical EVSE: **{report['summary']['physicalEvse']:,}**",
        f"- Direct-covered EVSE: **{report['summary']['matchedDirectEvse']:,}**",
        f"- Uncovered EVSE: **{report['summary']['uncoveredEvse']:,}**",
        f"- Direct coverage: **{report['summary']['directCoveragePct']:.2f}%**",
        f"- Orphan direct-offer EVSE IDs: **{report['summary']['orphanDirectOfferEvseIds']:,}**",
        "",
        "## CPO priority ranking",
        "",
        "| Rank | PUN CPO | Physical EVSE | Direct covered | Gap | Stations with gap | Coverage |",
        "|---:|---|---:|---:|---:|---:|---:|",
    ]
    for rank, item in enumerate(ranking, 1):
        md.append(
            f"| {rank} | {item['cpo'].replace('|', '\\|')} | {item['physicalEvse']:,} | "
            f"{item['directCoveredEvse']:,} | {item['uncoveredEvse']:,} | {item['stationsWithGap']:,} | "
            f"{item['directCoveragePct']:.2f}% |"
        )
    Path(args.markdown_out).write_text("\n".join(md) + "\n", encoding="utf-8")

    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    print("Top uncovered CPOs:")
    for item in ranking[:15]:
        print(f"{item['cpo']}: gap={item['uncoveredEvse']} / physical={item['physicalEvse']} ({item['directCoveragePct']}% covered)")


if __name__ == "__main__":
    main()
