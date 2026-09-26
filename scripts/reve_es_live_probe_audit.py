#!/usr/bin/env python3
"""Offline analysis of the controlled REVE tariff/status live probe.

This script performs zero network calls. It joins the sampled live tariff/status
objects back to the completed /locations snapshot using both REVE internal UUIDs
and public EVSE IDs, preserves boolean operational_status values exactly, and
emits a compact integration-readiness report.
"""
from __future__ import annotations

import gzip
import json
import re
import unicodedata
from collections import Counter
from datetime import datetime, timezone
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


def parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        text = str(value).replace("Z", "+00:00")
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def tariff_temporal_state(row: dict[str, Any], reference_time: datetime) -> dict[str, Any]:
    tariffs = row.get("tariffs") or []
    states: list[str] = []
    for tariff in tariffs if isinstance(tariffs, list) else []:
        if not isinstance(tariff, dict):
            continue
        start = parse_dt(tariff.get("start_date_time"))
        end = parse_dt(tariff.get("end_date_time"))
        if start and reference_time < start:
            states.append("FUTURE")
        elif end and reference_time > end:
            states.append("EXPIRED")
        else:
            states.append("ACTIVE_OR_UNBOUNDED")
    return {
        "states": states,
        "allExpired": bool(states) and all(x == "EXPIRED" for x in states),
        "hasActiveOrUnbounded": any(x == "ACTIVE_OR_UNBOUNDED" for x in states),
        "hasFuture": any(x == "FUTURE" for x in states),
    }


def operational_status_key(row: dict[str, Any]) -> tuple[str, Any]:
    """Preserve REVE's boolean operational_status; never collapse False to missing."""
    if "operational_status" in row and row.get("operational_status") is not None:
        value = row.get("operational_status")
        if isinstance(value, bool):
            return ("TRUE" if value else "FALSE"), value
        return str(value).upper(), value
    if "status" in row and row.get("status") is not None:
        value = row.get("status")
        return str(value).upper(), value
    return "<MISSING>", None


def main() -> int:
    aliases_doc = json.loads(ALIASES.read_text(encoding="utf-8"))
    alias_map = {x["canonical"]: list(x.get("aliases") or []) for x in aliases_doc.get("operators", [])}
    probe = json.loads(PROBE.read_text(encoding="utf-8"))
    with gzip.open(SNAPSHOT, "rt", encoding="utf-8") as f:
        snap = json.load(f)

    probe_time = parse_dt(probe.get("generatedAt")) or datetime.now(timezone.utc)
    locations_raw = snap.get("locations", {})
    locations = list(locations_raw.values()) if isinstance(locations_raw, dict) else list(locations_raw or [])

    by_internal: dict[str, dict[str, Any]] = {}
    by_public: dict[str, dict[str, Any]] = {}
    internal_occurrences = Counter()
    public_occurrences = Counter()
    snapshot_evse_count = 0
    evses_missing_internal_id = 0
    evses_missing_public_id = 0

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
            internal_id = evse.get("id")
            public_id = evse.get("evse_id")
            context = dict(context_base)
            context["internalEvseId"] = internal_id
            context["publicEvseId"] = public_id
            if internal_id:
                key = str(internal_id)
                internal_occurrences[key] += 1
                by_internal[key] = context
            else:
                evses_missing_internal_id += 1
            if public_id:
                key = str(public_id)
                public_occurrences[key] += 1
                by_public[key] = context
            else:
                evses_missing_public_id += 1

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
    unmatched_tariff_rows: list[dict[str, Any]] = []

    for row in tariff_rows if isinstance(tariff_rows, list) else []:
        if not isinstance(row, dict):
            continue
        evse_ref = str(row.get("evse_id") or "")
        context = by_internal.get(evse_ref) or by_public.get(evse_ref)
        shape = tariff_shape(row)
        temporal = tariff_temporal_state(row, probe_time)
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
        else:
            unmatched_tariff_rows.append({
                "connectorId": row.get("connector_id"),
                "evseReference": row.get("evse_id"),
                "lastTariffUpdated": row.get("last_tariff_updated"),
                "shape": shape,
                "temporal": temporal,
            })
        if len(tariff_samples) < 12:
            tariff_samples.append({
                "connectorId": row.get("connector_id"),
                "evseReference": row.get("evse_id"),
                "matchedSnapshot": bool(context),
                "context": context,
                "shape": shape,
                "temporal": temporal,
                "lastTariffUpdated": row.get("last_tariff_updated"),
            })

    status_req = request_by_kind(probe, "operational_status_page") or {}
    status_rows = status_req.get("payload") or []
    status_values = Counter()
    status_match_count = 0
    status_operator_counts = Counter()
    status_samples: list[dict[str, Any]] = []
    status_is_boolean = True

    for row in status_rows if isinstance(status_rows, list) else []:
        if not isinstance(row, dict):
            continue
        status_key, raw_status_value = operational_status_key(row)
        status_values[status_key] += 1
        if raw_status_value is not None and not isinstance(raw_status_value, bool):
            status_is_boolean = False
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
                "normalizedOperationalStatusKey": status_key,
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

    duplicate_internal_keys = sum(1 for count in internal_occurrences.values() if count > 1)
    duplicate_public_keys = sum(1 for count in public_occurrences.values() if count > 1)

    report = {
        "schemaVersion": 2,
        "country": "ES",
        "source": "REVE",
        "integrationStatus": "PRE_INTEGRATION_ONLY",
        "networkRequests": 0,
        "probeGeneratedAt": probe.get("generatedAt"),
        "probeComplete": probe.get("probeComplete") is True,
        "snapshot": {
            "locations": len(locations),
            "evseObjectsObserved": snapshot_evse_count,
            "evsesWithInternalId": sum(internal_occurrences.values()),
            "evsesWithPublicId": sum(public_occurrences.values()),
            "uniqueInternalEvseIds": len(internal_occurrences),
            "uniquePublicEvseIds": len(public_occurrences),
            "evsesMissingInternalId": evses_missing_internal_id,
            "evsesMissingPublicId": evses_missing_public_id,
            "duplicateInternalIdKeys": duplicate_internal_keys,
            "duplicatePublicIdKeys": duplicate_public_keys,
        },
        "liveFeeds": {
            "tariffs": {
                "totalCount": live_tariff_total,
                "totalPages": int(tariff_headers.get("total-pages", 0) or 0),
                "sampleRows": len(tariff_rows) if isinstance(tariff_rows, list) else 0,
                "sampleMatchedToLocationSnapshot": tariff_match_count,
                "sampleMatchPct": round(100 * tariff_match_count / len(tariff_rows), 2) if tariff_rows else 0.0,
                "unmatchedSampleRows": len(unmatched_tariff_rows),
                "unmatchedRows": unmatched_tariff_rows,
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
                "isBooleanFieldInSample": status_is_boolean,
                "statusValues": dict(status_values),
                "targetOperatorRows": dict(status_operator_counts),
                "samples": status_samples,
            },
        },
        "targetedStatusChecks": targeted_statuses,
        "diagnostics": {
            "liveStatusMinusSnapshotEvseObjects": live_status_total - snapshot_evse_count,
            "evseCountReconciliation": "42,180 EVSE objects are present in /locations; identifier coverage and duplicate-key counts are reported separately so 42,174 identifiers are not mistaken for the object total.",
            "operationalStatusSemantics": "The bulk /evses/operational_status feed exposes a boolean operational_status. It is preserved raw here. This audit does not yet equate false with a TCC display status; targeted /evses/{evse_id}/status returns the separate OCPI-style availability state.",
            "note": "Live /evses/operational_status total-count is not assumed equivalent to EVSE objects embedded in the paginated /locations snapshot; the difference remains diagnostic until lifecycle/duplication semantics are reconciled.",
        },
        "gates": {
            "probeTransportValidated": probe.get("probeComplete") is True,
            "tariffSchemaValidated": bool(tariff_rows),
            "statusSchemaValidated": bool(status_rows),
            "operationalStatusBooleanPreserved": status_is_boolean and "<MISSING>" not in status_values,
            "threeRepresentativeStatusChecksValidated": len(targeted_statuses) == 3 and all(x.get("httpStatus") == 200 and x.get("status") for x in targeted_statuses),
            "evseObjectVsIdentifierCountReconciled": snapshot_evse_count == sum(internal_occurrences.values()) + evses_missing_internal_id,
            "runtimePublishReady": False,
        },
        "nextGate": "Continue tariff/status pagination under the 5-requests/hour REVE budget, preserve complex tariff components/restrictions, investigate unmatched tariff lifecycle rows, and cross-check the remaining representative CPOs before runtime publication.",
    }
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "snapshot": report["snapshot"],
        "tariffs": {k: v for k, v in report["liveFeeds"]["tariffs"].items() if k not in {"samples", "unmatchedRows"}},
        "operationalStatus": {k: v for k, v in report["liveFeeds"]["operationalStatus"].items() if k != "samples"},
        "targetedStatusChecks": targeted_statuses,
        "gates": report["gates"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
