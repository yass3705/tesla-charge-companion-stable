#!/usr/bin/env python3
"""Offline analysis of the controlled REVE tariff/status live probe.

This script performs zero network calls. It joins the sampled live tariff/status
objects back to the completed /locations snapshot using both REVE internal UUIDs
and public EVSE IDs, then emits a compact integration-readiness report.
"""
from __future__ import annotations

import gzip
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Any

DATA = Path("data/spain_reve")
SNAPSHOT = DATA / "reve_locations_raw.json.gz"
ALIASES = DATA / "operator_aliases_es.json"
PROBE = DATA / "live_tariff_status_probe.json"
OUTPUT = DATA / "live_tariff_status_analysis.json"
TARGETS = [
    "Iberdrola | bp pulse", "Endesa X Way", "Repsol", "Wenea", "Zunder",
    "Moeve", "Powerdot", "Eranovum", "Electra", "Atlante", "IONITY",
]


def norm(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(c for c in text if not unicodedata.combining(c)).upper()
    return re.sub(r"[^A-Z0-9]+", " ", text).strip()


def operator_match(raw_name: str, alias_map: dict[str, list[str]]) -> str | None:
    n = norm(raw_name)
    scored: list[tuple[int, int, str]] = []
    for canonical in TARGETS:
        for alias in [canonical, *alias_map.get(canonical, [])]:
            a = norm(alias)
            if not a:
                continue
            if n == a:
                scored.append((3, len(a), canonical))
            elif len(a) >= 4 and (f" {a} " in f" {n} " or n.startswith(a + " ") or n.endswith(" " + a)):
                scored.append((2, len(a), canonical))
            elif len(a) >= 6 and a in n:
                scored.append((1, len(a), canonical))
    if not scored:
        return None
    scored.sort(reverse=True)
    best = scored[0]
    tied = {x[2] for x in scored if x[:2] == best[:2]}
    return best[2] if len(tied) == 1 else None


def request_by_kind(probe: dict[str, Any], kind: str) -> dict[str, Any] | None:
    for req in probe.get("requests", []):
        if req.get("kind") == kind:
            return req
    return None


def tariff_shape(row: dict[str, Any]) -> dict[str, Any]:
    types: list[str] = []
    restriction_keys: list[str] = []
    currencies: list[str] = []
    components = 0
    elements = 0
    tariffs = row.get("tariffs") or []
    for tariff in tariffs if isinstance(tariffs, list) else []:
        if not isinstance(tariff, dict):
            continue
        if tariff.get("currency"):
            currencies.append(str(tariff.get("currency")))
        for element in tariff.get("elements") or []:
            if not isinstance(element, dict):
                continue
            elements += 1
            restrictions = element.get("restrictions") or {}
            if isinstance(restrictions, dict):
                restriction_keys.extend(str(k) for k in restrictions.keys())
            for pc in element.get("price_components") or []:
                if not isinstance(pc, dict):
                    continue
                components += 1
                if pc.get("type"):
                    types.append(str(pc.get("type")))
    simple_energy_only = (
        len(tariffs) == 1
        and elements == 1
        and components == 1
        and types == ["ENERGY"]
        and not restriction_keys
    )
    return {
        "tariffCount": len(tariffs) if isinstance(tariffs, list) else 0,
        "elementCount": elements,
        "componentCount": components,
        "componentTypes": sorted(set(types)),
        "restrictionKeys": sorted(set(restriction_keys)),
        "currencies": sorted(set(currencies)),
        "simpleEnergyOnly": simple_energy_only,
    }


def main() -> int:
    aliases_doc = json.loads(ALIASES.read_text(encoding="utf-8"))
    alias_map = {x["canonical"]: list(x.get("aliases") or []) for x in aliases_doc.get("operators", [])}
    probe = json.loads(PROBE.read_text(encoding="utf-8"))
    with gzip.open(SNAPSHOT, "rt", encoding="utf-8") as f:
        snap = json.load(f)

    locations_raw = snap.get("locations", {})
    locations = list(locations_raw.values()) if isinstance(locations_raw, dict) else list(locations_raw or [])

    by_internal: dict[str, dict[str, Any]] = {}
    by_public: dict[str, dict[str, Any]] = {}
    snapshot_evse_count = 0
    for loc in locations:
        if not isinstance(loc, dict):
            continue
        raw_cpo = str(loc.get("cpo_name") or "").strip()
        canonical = operator_match(raw_cpo, alias_map)
        context_base = {
            "locationId": loc.get("id"),
            "locationName": loc.get("name"),
            "city": loc.get("city"),
            "partyId": loc.get("party_id"),
            "rawCpoName": raw_cpo or None,
            "canonicalOperator": canonical,
        }
        for evse in loc.get("evses") or []:
            if not isinstance(evse, dict):
                continue
            snapshot_evse_count += 1
            context = dict(context_base)
            context["internalEvseId"] = evse.get("id")
            context["publicEvseId"] = evse.get("evse_id")
            if evse.get("id"):
                by_internal[str(evse.get("id"))] = context
            if evse.get("evse_id"):
                by_public[str(evse.get("evse_id"))] = context

    tariffs_req = request_by_kind(probe, "tariffs_page") or {}
    tariff_rows = tariffs_req.get("payload") or []
    tariff_match_count = 0
    tariff_operator_counts = Counter()
    component_types = Counter()
    restriction_keys = Counter()
    currencies = Counter()
    simple_energy_only = 0
    complex_tariffs = 0
    tariff_samples: list[dict[str, Any]] = []

    for row in tariff_rows if isinstance(tariff_rows, list) else []:
        if not isinstance(row, dict):
            continue
        evse_ref = str(row.get("evse_id") or "")
        context = by_internal.get(evse_ref) or by_public.get(evse_ref)
        shape = tariff_shape(row)
        for t in shape["componentTypes"]:
            component_types[t] += 1
        for k in shape["restrictionKeys"]:
            restriction_keys[k] += 1
        for c in shape["currencies"]:
            currencies[c] += 1
        if shape["simpleEnergyOnly"]:
            simple_energy_only += 1
        else:
            complex_tariffs += 1
        if context:
            tariff_match_count += 1
            if context.get("canonicalOperator"):
                tariff_operator_counts[str(context["canonicalOperator"])] += 1
        if len(tariff_samples) < 12:
            tariff_samples.append({
                "connectorId": row.get("connector_id"),
                "evseReference": row.get("evse_id"),
                "matchedSnapshot": bool(context),
                "context": context,
                "shape": shape,
                "lastTariffUpdated": row.get("last_tariff_updated"),
            })

    status_req = request_by_kind(probe, "operational_status_page") or {}
    status_rows = status_req.get("payload") or []
    status_values = Counter()
    status_match_count = 0
    status_operator_counts = Counter()
    status_samples: list[dict[str, Any]] = []
    for row in status_rows if isinstance(status_rows, list) else []:
        if not isinstance(row, dict):
            continue
        status = str(row.get("status") or row.get("operational_status") or "<missing>").upper()
        status_values[status] += 1
        refs = [row.get("id"), row.get("evse_id")]
        context = None
        for ref in refs:
            if ref is None:
                continue
            context = by_internal.get(str(ref)) or by_public.get(str(ref))
            if context:
                break
        if context:
            status_match_count += 1
            if context.get("canonicalOperator"):
                status_operator_counts[str(context["canonicalOperator"])] += 1
        if len(status_samples) < 12:
            status_samples.append({
                "raw": row,
                "matchedSnapshot": bool(context),
                "context": context,
            })

    targeted_statuses = []
    for req in probe.get("requests", []):
        if req.get("kind") != "evse_status":
            continue
        payload = req.get("payload") if isinstance(req.get("payload"), dict) else {}
        targeted_statuses.append({
            "operator": req.get("operator"),
            "evseId": req.get("evseId"),
            "httpStatus": req.get("status"),
            "status": payload.get("status"),
            "internalId": payload.get("id"),
            "lastStatusUpdated": payload.get("last_status_updated"),
        })

    tariff_headers = tariffs_req.get("headers") or {}
    status_headers = status_req.get("headers") or {}
    live_tariff_total = int(tariff_headers.get("total-count", 0) or 0)
    live_status_total = int(status_headers.get("total-count", 0) or 0)

    report = {
        "schemaVersion": 1,
        "country": "ES",
        "source": "REVE",
        "integrationStatus": "PRE_INTEGRATION_ONLY",
        "networkRequests": 0,
        "probeGeneratedAt": probe.get("generatedAt"),
        "probeComplete": probe.get("probeComplete") is True,
        "snapshot": {
            "locations": len(locations),
            "evsesObservedInLocations": snapshot_evse_count,
        },
        "liveFeeds": {
            "tariffs": {
                "totalCount": live_tariff_total,
                "totalPages": int(tariff_headers.get("total-pages", 0) or 0),
                "sampleRows": len(tariff_rows) if isinstance(tariff_rows, list) else 0,
                "sampleMatchedToLocationSnapshot": tariff_match_count,
                "sampleMatchPct": round(100 * tariff_match_count / len(tariff_rows), 2) if tariff_rows else 0.0,
                "targetOperatorRows": dict(tariff_operator_counts),
                "componentTypes": dict(component_types),
                "restrictionKeys": dict(restriction_keys),
                "currencies": dict(currencies),
                "simpleEnergyOnlyRows": simple_energy_only,
                "complexRows": complex_tariffs,
                "samples": tariff_samples,
            },
            "operationalStatus": {
                "totalCount": live_status_total,
                "totalPages": int(status_headers.get("total-pages", 0) or 0),
                "sampleRows": len(status_rows) if isinstance(status_rows, list) else 0,
                "sampleMatchedToLocationSnapshot": status_match_count,
                "sampleMatchPct": round(100 * status_match_count / len(status_rows), 2) if status_rows else 0.0,
                "statusValues": dict(status_values),
                "targetOperatorRows": dict(status_operator_counts),
                "samples": status_samples,
            },
        },
        "targetedStatusChecks": targeted_statuses,
        "diagnostics": {
            "liveStatusMinusSnapshotEvseCount": live_status_total - snapshot_evse_count,
            "note": "Live /evses/operational_status total-count is not assumed equivalent to EVSEs embedded in the paginated /locations snapshot; the difference remains diagnostic until lifecycle/duplication semantics are reconciled.",
        },
        "gates": {
            "probeTransportValidated": probe.get("probeComplete") is True,
            "tariffSchemaValidated": bool(tariff_rows),
            "statusSchemaValidated": bool(status_rows),
            "threeRepresentativeStatusChecksValidated": len(targeted_statuses) == 3 and all(x.get("httpStatus") == 200 and x.get("status") for x in targeted_statuses),
            "runtimePublishReady": False,
        },
        "nextGate": "Continue tariff/status pagination under the 5-requests/hour REVE budget, preserve complex tariff components/restrictions, and reconcile live EVSE lifecycle counts before runtime publication.",
    }
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "tariffs": report["liveFeeds"]["tariffs"],
        "operationalStatus": {k: v for k, v in report["liveFeeds"]["operationalStatus"].items() if k != "samples"},
        "targetedStatusChecks": targeted_statuses,
        "diagnostics": report["diagnostics"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
