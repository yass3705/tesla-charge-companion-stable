#!/usr/bin/env python3
"""Offline REVE Spain tariff/status candidate audit.

Reads the completed /locations snapshot only. Performs zero REVE network calls.
It identifies representative EVSEs/connectors for the CPOs that must be
cross-checked before runtime publication, while preserving raw CPO identity.
"""
from __future__ import annotations

import gzip
import json
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DATA = Path("data/spain_reve")
SNAPSHOT = DATA / "reve_locations_raw.json.gz"
ALIASES = DATA / "operator_aliases_es.json"
OUTPUT = DATA / "tariff_status_candidates.json"

TARGETS = [
    "Iberdrola | bp pulse", "Endesa X Way", "Repsol", "Wenea", "Zunder",
    "Moeve", "Powerdot", "Eranovum", "Electra", "Atlante", "IONITY",
]


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def norm(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(c for c in text if not unicodedata.combining(c)).upper()
    return re.sub(r"[^A-Z0-9]+", " ", text).strip()


def operator_match(raw_name: str, alias_map: dict[str, list[str]]) -> tuple[str | None, str | None]:
    n = norm(raw_name)
    scored: list[tuple[int, int, str, str]] = []
    for canonical in TARGETS:
        for alias in [canonical, *alias_map.get(canonical, [])]:
            a = norm(alias)
            if not a:
                continue
            if n == a:
                scored.append((3, len(a), canonical, alias))
            elif len(a) >= 4 and (f" {a} " in f" {n} " or n.startswith(a + " ") or n.endswith(" " + a)):
                scored.append((2, len(a), canonical, alias))
            elif len(a) >= 6 and a in n:
                scored.append((1, len(a), canonical, alias))
    if not scored:
        return None, None
    scored.sort(reverse=True)
    best = scored[0]
    # Refuse ambiguous ties across canonical operators.
    tied = {x[2] for x in scored if x[:2] == best[:2]}
    if len(tied) != 1:
        return None, None
    return best[2], best[3]


def main() -> int:
    aliases_doc = json.loads(ALIASES.read_text(encoding="utf-8"))
    alias_map = {x["canonical"]: list(x.get("aliases") or []) for x in aliases_doc.get("operators", [])}
    with gzip.open(SNAPSHOT, "rt", encoding="utf-8") as f:
        snap = json.load(f)
    raw = snap.get("locations", {})
    locations = list(raw.values()) if isinstance(raw, dict) else list(raw or [])

    target_stats: dict[str, dict[str, Any]] = {
        t: {
            "rawCpoNames": Counter(), "partyIds": Counter(), "locations": 0,
            "evses": 0, "connectors": 0, "embeddedStatuses": Counter(), "candidates": []
        } for t in TARGETS
    }
    all_statuses = Counter()
    evse_total = 0
    evse_with_status = 0
    connector_total = 0
    connector_ids = 0
    unmatched_names = Counter()

    for loc in locations:
        if not isinstance(loc, dict):
            continue
        raw_cpo = str(loc.get("cpo_name") or "").strip()
        party_id = str(loc.get("party_id") or "").strip()
        canonical, matched_alias = operator_match(raw_cpo, alias_map)
        if raw_cpo and not canonical:
            unmatched_names[raw_cpo] += 1

        evses = loc.get("evses") or []
        if canonical:
            st = target_stats[canonical]
            st["locations"] += 1
            st["rawCpoNames"][raw_cpo or "<missing>"] += 1
            st["partyIds"][party_id or "<missing>"] += 1

        for evse in evses if isinstance(evses, list) else []:
            if not isinstance(evse, dict):
                continue
            evse_total += 1
            evse_id = str(evse.get("evse_id") or evse.get("id") or "").strip()
            status = str(evse.get("status") or evse.get("operational_status") or "").strip().upper()
            if status:
                evse_with_status += 1
                all_statuses[status] += 1
            connectors = evse.get("connectors") or []
            connector_total += len(connectors) if isinstance(connectors, list) else 0
            connector_ids += sum(1 for c in connectors if isinstance(c, dict) and str(c.get("id") or "").strip()) if isinstance(connectors, list) else 0

            if not canonical:
                continue
            st = target_stats[canonical]
            st["evses"] += 1
            if status:
                st["embeddedStatuses"][status] += 1
            st["connectors"] += len(connectors) if isinstance(connectors, list) else 0

            # Keep a tiny auditable sample per CPO; favor candidates with connector IDs.
            if len(st["candidates"]) < 4 and evse_id and isinstance(connectors, list) and connectors:
                cs = []
                for c in connectors[:3]:
                    if not isinstance(c, dict):
                        continue
                    cs.append({
                        "id": c.get("id"),
                        "standard": c.get("standard"),
                        "format": c.get("format"),
                        "powerType": c.get("power_type"),
                        "maxElectricPowerW": c.get("max_electric_power"),
                    })
                if any(x.get("id") for x in cs):
                    st["candidates"].append({
                        "canonicalOperator": canonical,
                        "matchedAlias": matched_alias,
                        "partyId": party_id or None,
                        "rawCpoName": raw_cpo or None,
                        "locationId": loc.get("id"),
                        "locationName": loc.get("name"),
                        "city": loc.get("city"),
                        "evseId": evse_id,
                        "embeddedStatus": status or None,
                        "connectors": cs,
                    })

    operators = []
    for canonical in TARGETS:
        st = target_stats[canonical]
        operators.append({
            "canonical": canonical,
            "matched": st["locations"] > 0,
            "locations": st["locations"],
            "evses": st["evses"],
            "connectors": st["connectors"],
            "partyIds": [{"value": k, "count": v} for k, v in st["partyIds"].most_common()],
            "rawCpoNames": [{"value": k, "count": v} for k, v in st["rawCpoNames"].most_common()],
            "embeddedStatuses": dict(st["embeddedStatuses"]),
            "candidates": st["candidates"],
        })

    report = {
        "schemaVersion": 1,
        "country": "ES",
        "source": "REVE",
        "generatedAt": now(),
        "integrationStatus": "PRE_INTEGRATION_ONLY",
        "networkRequests": 0,
        "snapshot": {
            "locations": len(locations),
            "evses": evse_total,
            "evsesWithEmbeddedStatus": evse_with_status,
            "embeddedStatusCoveragePct": round(evse_with_status / evse_total * 100, 2) if evse_total else 0.0,
            "connectors": connector_total,
            "connectorsWithId": connector_ids,
            "embeddedStatusValues": dict(all_statuses),
        },
        "requiredOperators": operators,
        "allRequiredOperatorsMatched": all(x["matched"] for x in operators),
        "unmatchedRawCpoNamesTop20": [{"value": k, "locations": v} for k, v in unmatched_names.most_common(20)],
        "nextGate": "Controlled live REVE tariff/status probe (<=5 requests/hour) using candidates above.",
        "note": "Matching is candidate-only and never rewrites raw CPO identity. Zero REVE API requests are performed by this audit.",
    }
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "allRequiredOperatorsMatched": report["allRequiredOperatorsMatched"],
        "statusCoveragePct": report["snapshot"]["embeddedStatusCoveragePct"],
        "operators": [{x["canonical"]: x["partyIds"][:2]} for x in operators],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
