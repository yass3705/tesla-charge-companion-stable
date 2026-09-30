#!/usr/bin/env python3
"""Offline audit of persistent REVE Spain tariff/status streams.

Zero network requests. Joins raw tariff/status rows to the completed /locations
snapshot, preserves full tariff structures and boolean operational_status, and
reports representative CPO coverage without extrapolating sampled prices.
"""
from __future__ import annotations

import gzip
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from reve_es_live_probe_audit import (
    TARGETS,
    operator_match,
    operational_status_key,
    parse_dt,
    tariff_shape,
    tariff_temporal_state,
)

DATA = Path("data/spain_reve")
SNAPSHOT = DATA / "reve_locations_raw.json.gz"
ALIASES = DATA / "operator_aliases_es.json"
STATE = DATA / "tariff_status_stream_state.json"
LAST_RUN = DATA / "tariff_status_stream_last_run.json"
TARIFFS = DATA / "reve_connector_tariffs_raw.json.gz"
STATUSES = DATA / "reve_operational_status_raw.json.gz"
OUTPUT = DATA / "tariff_status_stream_analysis.json"


def load_gzip(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as f:
        value = json.load(f)
    return value if isinstance(value, dict) else {}


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def add_context(
    mapping: dict[str, dict[str, Any]], counts: Counter[str], key: Any, context: dict[str, Any]
) -> None:
    if key is None or str(key).strip() == "":
        return
    text = str(key)
    counts[text] += 1
    mapping[text] = context


def unique_lookup(
    mapping: dict[str, dict[str, Any]], counts: Counter[str], key: Any
) -> dict[str, Any] | None:
    if key is None:
        return None
    text = str(key)
    return mapping.get(text) if counts.get(text) == 1 else None


def main() -> int:
    aliases_doc = json.loads(ALIASES.read_text(encoding="utf-8"))
    alias_map = {x["canonical"]: list(x.get("aliases") or []) for x in aliases_doc.get("operators", [])}
    state = json.loads(STATE.read_text(encoding="utf-8"))
    last_run = json.loads(LAST_RUN.read_text(encoding="utf-8")) if LAST_RUN.exists() else {}
    tariffs_store = load_gzip(TARIFFS)
    statuses_store = load_gzip(STATUSES)
    with gzip.open(SNAPSHOT, "rt", encoding="utf-8") as f:
        snapshot = json.load(f)

    raw_locations = snapshot.get("locations", {})
    locations = list(raw_locations.values()) if isinstance(raw_locations, dict) else list(raw_locations or [])

    by_internal: dict[str, dict[str, Any]] = {}
    by_public: dict[str, dict[str, Any]] = {}
    by_connector: dict[str, dict[str, Any]] = {}
    internal_counts: Counter[str] = Counter()
    public_counts: Counter[str] = Counter()
    connector_counts: Counter[str] = Counter()
    snapshot_evse_objects = 0

    for loc in locations:
        if not isinstance(loc, dict):
            continue
        raw_cpo = str(loc.get("cpo_name") or "").strip()
        canonical = operator_match(raw_cpo, alias_map)
        base = {
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
            snapshot_evse_objects += 1
            context = dict(base)
            context["internalEvseId"] = evse.get("id")
            context["publicEvseId"] = evse.get("evse_id")
            add_context(by_internal, internal_counts, evse.get("id"), context)
            add_context(by_public, public_counts, evse.get("evse_id"), context)
            for connector in evse.get("connectors") or []:
                if not isinstance(connector, dict):
                    continue
                add_context(by_connector, connector_counts, connector.get("id"), context)

    reference_time = parse_dt(state.get("updatedAt")) or datetime.now(timezone.utc)

    tariff_rows = list(tariffs_store.values())
    tariff_match_basis: Counter[str] = Counter()
    tariff_target_counts: Counter[str] = Counter()
    tariff_component_occurrences: Counter[str] = Counter()
    tariff_restriction_occurrences: Counter[str] = Counter()
    tariff_currencies: Counter[str] = Counter()
    tariff_temporal: Counter[str] = Counter()
    tariff_simple = 0
    tariff_complex = 0
    tariff_unmatched = 0
    tariff_ambiguous_connector = 0
    tariff_samples: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for row in tariff_rows:
        if not isinstance(row, dict):
            continue
        connector_ref = row.get("connector_id")
        evse_ref = row.get("evse_id")
        context = unique_lookup(by_connector, connector_counts, connector_ref)
        basis = "connector_id" if context else None
        if connector_ref is not None and connector_counts.get(str(connector_ref), 0) > 1:
            tariff_ambiguous_connector += 1
        if context is None:
            context = unique_lookup(by_internal, internal_counts, evse_ref)
            basis = "internal_evse_id" if context else basis
        if context is None:
            context = unique_lookup(by_public, public_counts, evse_ref)
            basis = "public_evse_id" if context else basis
        if context:
            tariff_match_basis[basis or "unknown"] += 1
            canonical = context.get("canonicalOperator")
            if canonical:
                tariff_target_counts[str(canonical)] += 1
        else:
            tariff_unmatched += 1
            canonical = None

        shape = tariff_shape(row)
        if shape.get("simpleEnergyOnly"):
            tariff_simple += 1
        else:
            tariff_complex += 1
        for currency in shape.get("currencies") or []:
            tariff_currencies[str(currency)] += 1
        temporal = tariff_temporal_state(row, reference_time)
        if temporal.get("allExpired"):
            tariff_temporal["allExpired"] += 1
        if temporal.get("hasActiveOrUnbounded"):
            tariff_temporal["hasActiveOrUnbounded"] += 1
        if temporal.get("hasFuture"):
            tariff_temporal["hasFuture"] += 1

        for tariff in row.get("tariffs") or []:
            if not isinstance(tariff, dict):
                continue
            for element in tariff.get("elements") or []:
                if not isinstance(element, dict):
                    continue
                restrictions = element.get("restrictions") or {}
                if isinstance(restrictions, dict):
                    for key in restrictions:
                        tariff_restriction_occurrences[str(key)] += 1
                for component in element.get("price_components") or []:
                    if isinstance(component, dict) and component.get("type"):
                        tariff_component_occurrences[str(component.get("type"))] += 1

        sample_key = str(canonical or "<unmatched>")
        if len(tariff_samples[sample_key]) < 3:
            tariff_samples[sample_key].append({
                "connectorId": connector_ref,
                "evseReference": evse_ref,
                "matchBasis": basis,
                "context": context,
                "shape": shape,
                "temporal": temporal,
                "lastTariffUpdated": row.get("last_tariff_updated"),
            })

    status_rows = list(statuses_store.values())
    status_values: Counter[str] = Counter()
    status_target_counts: Counter[str] = Counter()
    status_match_basis: Counter[str] = Counter()
    status_unmatched = 0
    status_non_boolean = 0
    status_samples: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for row in status_rows:
        if not isinstance(row, dict):
            continue
        key, raw_value = operational_status_key(row)
        status_values[key] += 1
        if raw_value is not None and not isinstance(raw_value, bool):
            status_non_boolean += 1
        context = unique_lookup(by_internal, internal_counts, row.get("id"))
        basis = "internal_evse_id" if context else None
        if context is None:
            context = unique_lookup(by_public, public_counts, row.get("evse_id"))
            basis = "public_evse_id" if context else basis
        if context:
            status_match_basis[basis or "unknown"] += 1
            canonical = context.get("canonicalOperator")
            if canonical:
                status_target_counts[str(canonical)] += 1
        else:
            status_unmatched += 1
            canonical = None
        sample_key = str(canonical or "<unmatched>")
        if len(status_samples[sample_key]) < 3:
            status_samples[sample_key].append({
                "evseId": row.get("evse_id"),
                "internalId": row.get("id"),
                "operationalStatus": raw_value,
                "lastOperationalStatusUpdated": row.get("last_operational_status_updated"),
                "matchBasis": basis,
                "context": context,
            })

    target_matrix = []
    for target in TARGETS:
        target_matrix.append({
            "canonical": target,
            "tariffRowsObserved": tariff_target_counts.get(target, 0),
            "statusRowsObserved": status_target_counts.get(target, 0),
            "tariffObserved": tariff_target_counts.get(target, 0) > 0,
            "statusObserved": status_target_counts.get(target, 0) > 0,
        })

    state_tariffs_ok = state.get("tariffRowsStored") == len(tariffs_store)
    state_status_ok = state.get("statusRowsStored") == len(statuses_store)
    tariff_match_count = len(tariff_rows) - tariff_unmatched
    status_match_count = len(status_rows) - status_unmatched

    report = {
        "schemaVersion": 1,
        "country": "ES",
        "source": "REVE",
        "generatedAt": now(),
        "integrationStatus": "PRE_INTEGRATION_ONLY",
        "networkRequests": 0,
        "state": state,
        "lastLiveRun": {
            "generatedAt": last_run.get("generatedAt"),
            "requestsAttempted": last_run.get("requestsAttempted"),
            "requestsSucceeded": last_run.get("requestsSucceeded"),
            "plan": last_run.get("plan"),
        },
        "snapshot": {
            "locations": len(locations),
            "evseObjectsObserved": snapshot_evse_objects,
            "uniqueInternalEvseIds": len(internal_counts),
            "uniquePublicEvseIds": len(public_counts),
            "duplicateInternalEvseIdKeys": sum(1 for n in internal_counts.values() if n > 1),
            "duplicatePublicEvseIdKeys": sum(1 for n in public_counts.values() if n > 1),
            "uniqueConnectorIds": len(connector_counts),
            "duplicateConnectorIdKeys": sum(1 for n in connector_counts.values() if n > 1),
        },
        "tariffs": {
            "rowsStored": len(tariff_rows),
            "pagesCollected": state.get("tariffPagesCollected") or [],
            "totalPages": state.get("tariffTotalPages"),
            "pageCoveragePct": round(100 * len(state.get("tariffPagesCollected") or []) / int(state.get("tariffTotalPages") or 1), 3),
            "matchedToSnapshot": tariff_match_count,
            "matchPct": round(100 * tariff_match_count / len(tariff_rows), 2) if tariff_rows else 0.0,
            "matchBasis": dict(tariff_match_basis),
            "unmatchedRows": tariff_unmatched,
            "ambiguousConnectorKeysSeen": tariff_ambiguous_connector,
            "simpleEnergyOnlyRows": tariff_simple,
            "complexRows": tariff_complex,
            "componentOccurrences": dict(tariff_component_occurrences),
            "restrictionOccurrences": dict(tariff_restriction_occurrences),
            "currenciesByRow": dict(tariff_currencies),
            "temporalRows": dict(tariff_temporal),
            "targetOperatorRows": dict(tariff_target_counts),
            "representativeSamples": dict(tariff_samples),
        },
        "operationalStatus": {
            "rowsStored": len(status_rows),
            "pagesCollected": state.get("statusPagesCollected") or [],
            "totalPages": state.get("statusTotalPages"),
            "pageCoveragePct": round(100 * len(state.get("statusPagesCollected") or []) / int(state.get("statusTotalPages") or 1), 3),
            "matchedToSnapshot": status_match_count,
            "matchPct": round(100 * status_match_count / len(status_rows), 2) if status_rows else 0.0,
            "matchBasis": dict(status_match_basis),
            "unmatchedRows": status_unmatched,
            "nonBooleanRows": status_non_boolean,
            "statusValues": dict(status_values),
            "targetOperatorRows": dict(status_target_counts),
            "representativeSamples": dict(status_samples),
        },
        "requiredOperatorCoverage": target_matrix,
        "gates": {
            "stateCountsMatchStores": state_tariffs_ok and state_status_ok,
            "tariffSchemaObserved": bool(tariff_rows),
            "statusSchemaObserved": bool(status_rows),
            "operationalStatusBooleanPreserved": status_non_boolean == 0 and "<MISSING>" not in status_values,
            "tariffJoinRateAtLeast90Pct": (tariff_match_count / len(tariff_rows) >= 0.90) if tariff_rows else False,
            "statusJoinRateAtLeast90Pct": (status_match_count / len(status_rows) >= 0.90) if status_rows else False,
            "allRequiredOperatorsHaveTariffSample": all(x["tariffObserved"] for x in target_matrix),
            "allRequiredOperatorsHaveStatusSample": all(x["statusObserved"] for x in target_matrix),
            "runtimePublishReady": False,
        },
        "nextLivePlan": {
            "hardRequestLimit": 5,
            "tariffPages": [int(state.get("nextTariffPage") or 1) + i for i in range(3)],
            "statusPages": [int(state.get("nextStatusPage") or 1) + i for i in range(2)],
        },
        "note": "Observed stream rows are samples from collected pages, not operator-wide tariff declarations. Full tariff structures, restrictions and raw boolean operational_status remain authoritative; no sampled price is extrapolated to a CPO or to runtime.",
    }
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "networkRequests": 0,
        "tariffRows": len(tariff_rows),
        "tariffMatchPct": report["tariffs"]["matchPct"],
        "statusRows": len(status_rows),
        "statusMatchPct": report["operationalStatus"]["matchPct"],
        "targetCoverage": target_matrix,
        "gates": report["gates"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
