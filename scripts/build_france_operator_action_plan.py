#!/usr/bin/env python3
"""Build a prioritized France IRVE operator action plan from audit reports.

This helper is intentionally non-production. It consumes the canonical PAN IRVE
operator gap report plus the tariff-network identity report and emits a compact,
machine-readable queue for the next tariff-base work. Tariff sources remain
strict enrichment layers and never create physical stations.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

STATUS_ORDER = {
    "missing_base": 0,
    "reference_only": 1,
    "normalize": 2,
    "staged": 3,
    "ready": 4,
}


def load(path: str):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def score(row: dict) -> tuple:
    status = row.get("coverageStatus") or "missing_base"
    priority = int(row.get("priority") or 3)
    pdc = int(row.get("pdcCount") or row.get("irvePdcCount") or 0)
    stations = int(row.get("stationCount") or row.get("irveStationCount") or 0)
    return (STATUS_ORDER.get(status, 9), priority, -pdc, -stations, str(row.get("label") or row.get("operatorId") or "").lower())


def action_for(status: str) -> str:
    return {
        "missing_base": "research_and_build_direct_base",
        "reference_only": "refresh_tariff_evidence_then_materialize",
        "normalize": "normalize_existing_source_to_canonical_contract",
        "staged": "validate_matching_then_promote",
        "ready": "monitor_only",
    }.get(status, "triage")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--operator-gap", required=True)
    parser.add_argument("--network-gap", required=True)
    parser.add_argument("--out", default="build/france_irve/operator_action_plan.json")
    args = parser.parse_args()

    operator_gap = load(args.operator_gap)
    network_gap = load(args.network_gap)

    by_id = {}
    for row in operator_gap.get("operators", []):
        by_id[row.get("operatorId")] = {
            "operatorId": row.get("operatorId"),
            "label": row.get("label"),
            "coverageStatus": row.get("coverageStatus"),
            "priority": row.get("priority", 3),
            "pdcCount": row.get("irvePdcCount", 0),
            "stationCount": row.get("irveStationCount", 0),
            "artifactPaths": row.get("artifactPaths", []),
            "currentIntegration": row.get("currentIntegration"),
            "notes": row.get("notes", ""),
        }

    # Prefer the tariff-network resolver's measured queue when present because it
    # reflects network/brand identity after canonical physical inventory build.
    for row in network_gap.get("workQueue", []):
        oid = row.get("operatorId") or row.get("networkId")
        if not oid:
            continue
        base = by_id.setdefault(oid, {"operatorId": oid, "label": row.get("label") or oid})
        for key in ("label", "coverageStatus", "priority", "pdcCount", "stationCount", "notes"):
            if row.get(key) is not None:
                base[key] = row.get(key)

    queue = []
    for row in by_id.values():
        status = row.get("coverageStatus") or "missing_base"
        if status == "ready" or int(row.get("pdcCount") or 0) <= 0:
            continue
        row = dict(row)
        row["recommendedAction"] = action_for(status)
        queue.append(row)
    queue.sort(key=score)

    unresolved = []
    for row in network_gap.get("unresolvedNetworks", []):
        unresolved.append({
            "networkRaw": row.get("networkRaw"),
            "pdcCount": row.get("pdcCount", 0),
            "stationCount": row.get("stationCount", 0),
            "recommendedAction": "resolve_network_identity_before_tariff_research",
        })
    unresolved.sort(key=lambda r: (-int(r["pdcCount"] or 0), -int(r["stationCount"] or 0), str(r["networkRaw"] or "").lower()))

    unregistered = []
    for row in operator_gap.get("unregisteredOperators", []):
        unregistered.append({
            "rawOperator": row.get("rawOperator"),
            "pdcCount": row.get("pdcCount", 0),
            "stationCount": row.get("stationCount", 0),
            "examples": row.get("examples", []),
            "recommendedAction": "register_or_alias_operator_before_tariff_research",
        })
    unregistered.sort(key=lambda r: (-int(r["pdcCount"] or 0), -int(r["stationCount"] or 0), str(r["rawOperator"] or "").lower()))

    payload = {
        "schemaVersion": "1.0.0",
        "country": "FR",
        "productionReady": False,
        "inventoryPolicy": "PAN IRVE canonical physical inventory; tariffs never create stations",
        "summary": {
            "operatorQueueCount": len(queue),
            "operatorQueuePdcCount": sum(int(r.get("pdcCount") or 0) for r in queue),
            "unresolvedNetworkCount": len(unresolved),
            "unregisteredOperatorCount": len(unregistered),
        },
        "operatorQueue": queue,
        "unresolvedNetworks": unresolved,
        "unregisteredOperators": unregistered,
    }

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload["summary"], ensure_ascii=False, indent=2))
    print("\nTop operator actions:")
    for row in queue[:25]:
        print(f"- {row.get('label')}: {row.get('pdcCount', 0)} PDC / {row.get('stationCount', 0)} stations [{row.get('coverageStatus')}] -> {row.get('recommendedAction')}")


if __name__ == "__main__":
    main()
