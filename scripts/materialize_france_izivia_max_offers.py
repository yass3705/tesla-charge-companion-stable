#!/usr/bin/env python3
"""Materialize official IZIVIA MAX tariffs on exact locked PAN PDCs.

The public source is station/configuration-specific.  PAN remains the sole
physical inventory, and a rankable offer requires the explicit ``izivia-max``
tariff identity, the IZIVIA technical CPO, an exact locked PDC itinerance id,
the same canonical station and the same audited power.  New or changed rows
fail closed; FRIGF, FRILF, generic IZIVIA, subscriptions and roaming never
inherit this tariff.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
from collections import Counter
from pathlib import Path


NETWORK_ID = "izivia-max"
PHYSICAL_OPERATOR_ID = "izivia"
POWER_TOLERANCE_KW = 0.01
ROUNDING_EPSILON = 1e-9


def clean(value):
    return str(value or "").strip()


def number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def truthy(value):
    if isinstance(value, bool):
        return value
    return clean(value).lower() in {"1", "true", "vrai", "yes", "oui", "y", "x"}


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


def require_number(actual, expected, label):
    if number(actual) != float(expected):
        raise ValueError(f"unexpected IZIVIA MAX {label}: {actual!r}")


def validate_source(data):
    expected_root = {
        "schemaVersion": "1.0.0",
        "dataset": "izivia-max-direct-pan-bindings-france",
        "networkId": NETWORK_ID,
        "network": "IZIVIA MAX",
        "operator": "IZIVIA",
        "country": "FR",
    }
    for key, expected in expected_root.items():
        if data.get(key) != expected:
            raise ValueError(f"unexpected IZIVIA MAX source {key}={data.get(key)!r}")

    evidence = data.get("sourceEvidence") or {}
    expected_evidence = {
        "officialNetworkPage": "https://izivia.com/izivia-max-une-station-de-recharge-ultra-rapide-sur-votre-parking",
        "officialMapPage": "https://izivia.com/carte-bornes-de-recharge-izivia",
        "publicMapFrontend": "https://fronts-map.izivia.com/",
        "marketingNetworkId": "68bee3751d8c086416baa3aa",
        "auditRepository": "https://github.com/yass3705/tesla-charge-companion-data-lab",
        "auditBranch": "audit/izivia-max-20260901",
        "auditCommit": "1746ea664aaa29eb2edf2bd5c0e1d61b5e1b4a59",
        "auditWorkflowRun": "https://github.com/yass3705/tesla-charge-companion-data-lab/actions/runs/33526137082",
        "auditArtifactDigestSha256": "abe9ae8cebb1b1a1f7ab3525cfb8ae8d2ec4aa08619d6fb5b6af60a00b73b5da",
        "mapBundleSha256": "9dc5023f17f1c30f76d58b29504a1adda5535db331dc696b562707d83d91494d",
        "extractedAt": "2026-09-01T15:32:05Z",
    }
    if any(evidence.get(key) != expected for key, expected in expected_evidence.items()):
        raise ValueError("IZIVIA MAX official source lock changed")

    scope = data.get("scope") or {}
    expected_scope = {
        "directCpoOnly": True,
        "physicalOperatorRequired": PHYSICAL_OPERATOR_ID,
        "tariffNetworkRequired": NETWORK_ID,
        "stationPrefixRequired": "FRIMXPIMAX",
        "physicalInventoryFromPanOnly": True,
        "exactLockedPdcIdentityRequired": True,
        "unknownOrChangedPdcFailsClosed": True,
        "roamingIncluded": False,
        "subscriptionsIncluded": False,
        "emptySubscriptionNodeMeansStationGrouping": True,
        "grandFraisFrigfIncluded": False,
        "impactLfFrilfIncluded": False,
        "genericIziviaIncluded": False,
        "failClosed": True,
    }
    if any(scope.get(key) != expected for key, expected in expected_scope.items()):
        raise ValueError("IZIVIA MAX source safety policy changed")

    expected_counts = {
        "officialMapLocationCount": 45,
        "officialMapDetailCount": 45,
        "officialMapPricingHttp200Count": 45,
        "officialMapNonEmptyPricingLocationCount": 45,
        "boundSourceLocationCount": 24,
        "unboundSourceLocationCount": 21,
        "boundPanStationCount": 24,
        "boundPanPdcCount": 92,
        "formulaCount": 3,
        "groupedBoundSourceLocationCount": 3,
    }
    counts = data.get("counts") or {}
    if any(counts.get(key) != expected for key, expected in expected_counts.items()):
        raise ValueError("IZIVIA MAX locked source counts changed")

    semantics = data.get("billingSemantics") or {}
    expected_semantics = {
        "energy": "each started kWh is due",
        "connectedWithoutCharging": "each started minute connected without charging is due",
        "occupancyTrigger": "while_connected_without_charging",
        "occupancyDurationBasis": "connected_minutes_minus_charging_minutes",
        "missingUnplugTimePolicy": "zero_post_charge",
        "parkingSeparate": True,
        "sessionCap": None,
    }
    if any(semantics.get(key) != expected for key, expected in expected_semantics.items()):
        raise ValueError("IZIVIA MAX billing semantics changed")

    expected_formulas = {
        "energy-049-idle-040": (
            "0.49€/kWh + 0.4€/min si branchement sans charge. Toute énergie au kWh et minute entamée est due.",
            0.49,
            0.4,
        ),
        "energy-045-idle-040": (
            "0.45€/kWh + 0.4€/min si branchement sans charge. Toute énergie au kWh et minute entamée est due",
            0.45,
            0.4,
        ),
        "energy-035-idle-008333": (
            "0.35€/kWh + 0.08333€/min si branchement sans charge. Toute énergie au kWh et minute entamée est due.",
            0.35,
            0.08333,
        ),
    }
    formulas = {clean(row.get("id")): row for row in data.get("formulaCatalog") or []}
    if set(formulas) != set(expected_formulas):
        raise ValueError("IZIVIA MAX formula catalogue changed")
    for formula_id, (raw, energy, idle) in expected_formulas.items():
        row = formulas[formula_id]
        if row.get("raw") != raw or row.get("currency") != "EUR":
            raise ValueError(f"IZIVIA MAX raw formula changed: {formula_id}")
        require_number(row.get("energyEurPerKwh"), energy, f"{formula_id} energy rate")
        require_number(row.get("connectedWithoutChargingEurPerMinute"), idle, f"{formula_id} idle rate")
        if row.get("energyBilling") != "started_kwh" or row.get("connectedWithoutChargingBilling") != "started_minute":
            raise ValueError(f"IZIVIA MAX rounding changed: {formula_id}")

    expected_codes = {
        "IMAX1", "IMAX2", "IMAX3", "IMAX5", "IMAX6", "IMAX7", "IMAX8", "IMAX9",
        "IMAX10", "IMAX11", "IMAX13", "IMAX14", "IMAX15", "IMAX17", "IMAX18",
        "IMAX19", "IMAX20", "IMAX21", "IMAX23", "IMAX25", "IMAX26", "IMAX34",
        "IMAX35", "IMAX36",
    }
    locations = {}
    source_ids = set()
    grouped_codes = set()
    source_group_formula_counts = {}
    for row in data.get("locations") or []:
        code = clean(row.get("code"))
        source_id = clean(row.get("sourceLocationId"))
        if not code or code in locations or not source_id or source_id in source_ids:
            raise ValueError("duplicate or blank IZIVIA MAX source location")
        if row.get("legacyId") != f"FR*SOD*P*IMAX*{code[4:]}*_*_*_" or not clean(row.get("name")):
            raise ValueError(f"invalid IZIVIA MAX location identity: {code}")
        source_ids.add(source_id)
        locations[code] = row
        if row.get("sourceStructureType") == "charging_location_leaf":
            if row.get("formulaId") not in formulas or row.get("sourceChargerGroups"):
                raise ValueError(f"invalid IZIVIA MAX location-level formula: {code}")
        elif row.get("sourceStructureType") == "empty_subscription_node_grouping":
            grouped_codes.add(code)
            if row.get("formulaId"):
                raise ValueError(f"grouped IZIVIA MAX location flattened: {code}")
            charger_names = set()
            per_formula = Counter()
            for group in row.get("sourceChargerGroups") or []:
                formula_id = group.get("formulaId")
                names = [clean(name) for name in group.get("sourceChargerNames") or []]
                if formula_id not in formulas or not names or any(not name for name in names):
                    raise ValueError(f"invalid IZIVIA MAX source charger group: {code}")
                if charger_names.intersection(names):
                    raise ValueError(f"duplicate IZIVIA MAX source charger name: {code}")
                charger_names.update(names)
                per_formula[formula_id] += len(names)
            source_group_formula_counts[code] = per_formula
        else:
            raise ValueError(f"unknown IZIVIA MAX source structure: {code}")
    if set(locations) != expected_codes or grouped_codes != {"IMAX1", "IMAX7", "IMAX13"}:
        raise ValueError("IZIVIA MAX bound source location set changed")

    bindings = {}
    pdc_bindings = {}
    formula_pdc_counts = Counter()
    for binding in data.get("panBindings") or []:
        station_id = clean(binding.get("canonicalStationId"))
        code = clean(binding.get("sourceLocationCode"))
        if not station_id or station_id in bindings or code not in locations:
            raise ValueError("duplicate or invalid IZIVIA MAX PAN station binding")
        if station_id != f"FRIMXP{code}":
            raise ValueError(f"IZIVIA MAX station/location mismatch: {station_id} / {code}")
        if code in grouped_codes and not clean(binding.get("mappingEvidence")):
            raise ValueError(f"IZIVIA MAX grouped source lacks mapping evidence: {code}")
        unit_ids = set()
        unit_formula_counts = Counter()
        for unit in binding.get("units") or []:
            unit_id = clean(unit.get("unit"))
            formula_id = clean(unit.get("formulaId"))
            power = number(unit.get("powerKw"))
            pdc_ids = [clean(pdc_id) for pdc_id in unit.get("pdcIds") or []]
            if not unit_id or unit_id in unit_ids or formula_id not in formulas or power is None or power <= 0:
                raise ValueError(f"invalid IZIVIA MAX unit binding: {station_id}")
            if not pdc_ids or any(not pdc_id for pdc_id in pdc_ids) or len(pdc_ids) != len(set(pdc_ids)):
                raise ValueError(f"invalid IZIVIA MAX PDC set: {station_id} unit {unit_id}")
            unit_ids.add(unit_id)
            unit_formula_counts[formula_id] += 1
            formula_pdc_counts[formula_id] += len(pdc_ids)
            for pdc_id in pdc_ids:
                if pdc_id in pdc_bindings:
                    raise ValueError(f"duplicate IZIVIA MAX PAN PDC binding: {pdc_id}")
                pdc_bindings[pdc_id] = {
                    "canonicalStationId": station_id,
                    "sourceLocationCode": code,
                    "unit": unit_id,
                    "formulaId": formula_id,
                    "powerKw": power,
                }
        if not unit_ids:
            raise ValueError(f"IZIVIA MAX station has no locked unit: {station_id}")
        if code in grouped_codes and unit_formula_counts != source_group_formula_counts[code]:
            raise ValueError(f"IZIVIA MAX grouped charger/unit mapping count changed: {code}")
        if code not in grouped_codes and set(unit_formula_counts) != {locations[code].get("formulaId")}:
            raise ValueError(f"IZIVIA MAX location formula leaked across units: {code}")
        bindings[station_id] = binding

    if set(bindings) != {f"FRIMXP{code}" for code in expected_codes}:
        raise ValueError("IZIVIA MAX PAN station binding set changed")
    if len(pdc_bindings) != 92 or formula_pdc_counts != Counter({
        "energy-049-idle-040": 78,
        "energy-045-idle-040": 8,
        "energy-035-idle-008333": 6,
    }):
        raise ValueError("IZIVIA MAX PAN PDC/formula binding counts changed")
    return formulas, locations, bindings, pdc_bindings


def canonical_kind(pdc):
    connectors = pdc.get("connectors") or {}
    power = number(pdc.get("powerKw"))
    if truthy(connectors.get("comboCcs")) or truthy(connectors.get("chademo")):
        return "DC"
    if (truthy(connectors.get("type2")) or truthy(connectors.get("ef"))) and power is not None and power <= 43:
        return "AC"
    if power is not None and power > 43:
        return "DC"
    return None


def pricing_rule(formula):
    return {
        "scope": "allDay",
        "start": "00:00",
        "end": "24:00",
        "days": None,
        "currency": "EUR",
        "pricePerKwh": number(formula.get("energyEurPerKwh")),
        "energyBilling": "started_kwh",
        "includedEnergyKwh": 0,
        "chargePerMinute": 0,
        "chargeThresholdMinutes": 0,
        "durationPerMinute": 0,
        "durationThresholdMinutes": 0,
        "durationStart": None,
        "durationEnd": None,
        "durationCap": None,
        "connectionFee": 0,
        "occupancyPerMinute": number(formula.get("connectedWithoutChargingEurPerMinute")),
        "occupancyThresholdMinutes": 0,
        "occupancyStart": None,
        "occupancyEnd": None,
        "occupancyCap": None,
        "occupancyBilling": "started_minute",
        "occupancyBlockMinutes": None,
        "occupancyBlockFee": None,
        "occupancyTrigger": "while_connected_without_charging",
        "occupancyDurationBasis": "connected_minutes_minus_charging_minutes",
        "missingUnplugTimePolicy": "zero_post_charge",
        "parkingPerMinute": 0,
        "totalTransactionCap": None,
        "timeWindowSelection": None,
        "rounding": "started_kwh_and_started_minute",
        "roundingEpsilon": ROUNDING_EPSILON,
        "formulaFamily": "izivia_max_started_energy_plus_connected_without_charging",
        "notes": formula.get("raw"),
    }


def offer_for(pdc, formula, location, binding, data, normalized_at):
    pdc_id = clean(pdc.get("pdcId"))
    station_id = clean(pdc.get("stationId"))
    power = number(pdc.get("powerKw"))
    return {
        "offerId": f"izivia-max:direct:{pdc_id}",
        "physicalOperatorId": PHYSICAL_OPERATOR_ID,
        "tariffNetworkId": NETWORK_ID,
        "provider": "IZIVIA MAX · paiement direct",
        "channel": "direct",
        "sourceMode": "station_power",
        "sourceStationId": location.get("sourceLocationId"),
        "sourceEvseId": None,
        "canonicalStationId": station_id,
        "canonicalPdcId": pdc_id,
        "matchMethod": "exact_pdc_itinerance",
        "matchDistanceMeters": None,
        "selectors": {
            "network": "IZIVIA MAX",
            "sourceLocationCode": binding.get("sourceLocationCode"),
            "sourceLegacyId": location.get("legacyId"),
            "sourceFormulaId": binding.get("formulaId"),
            "sourceRawPricing": formula.get("raw"),
            "panUnit": binding.get("unit"),
            "canonicalPowerKw": power,
            "exactLockedPanPdc": True,
            "roamingSeparate": True,
            "subscriptionsSeparate": True,
            "parkingSeparate": True,
        },
        "kind": canonical_kind(pdc),
        "minPowerKw": power,
        "maxPowerKw": power,
        "pricingRules": [pricing_rule(formula)],
        "subscriptionId": None,
        "validFrom": None,
        "validTo": None,
        "rankable": True,
        "blockedReasons": [],
        "sourceUrl": (data.get("sourceEvidence") or {}).get("officialMapPage"),
        "sourceUpdatedAt": (data.get("sourceEvidence") or {}).get("extractedAt"),
        "normalizedAt": normalized_at,
    }


def materialize(data, stations, pdcs, normalized_at=None):
    formulas, locations, source_stations, pdc_bindings = validate_source(data)
    station_map = {clean(row.get("stationId")): row for row in stations if clean(row.get("stationId"))}
    max_stations = {sid: row for sid, row in station_map.items() if row.get("tariffNetworkId") == NETWORK_ID}
    eligible = [row for row in pdcs if row.get("tariffNetworkId") == NETWORK_ID]
    normalized_at = normalized_at or dt.datetime.now(dt.timezone.utc).isoformat()
    offers = []
    unresolved = []
    counters = Counter()

    def fail(pdc, reason, binding=None):
        counters[f"unresolved_{reason}"] += 1
        if len(unresolved) < 150:
            unresolved.append({
                "canonicalStationId": clean(pdc.get("stationId")),
                "canonicalPdcId": clean(pdc.get("pdcId")),
                "powerKw": pdc.get("powerKw"),
                "physicalOperatorId": pdc.get("physicalOperatorId"),
                "expectedStationId": (binding or {}).get("canonicalStationId"),
                "expectedPowerKw": (binding or {}).get("powerKw"),
                "reason": reason,
            })

    for pdc in eligible:
        pdc_id = clean(pdc.get("pdcId"))
        station_id = clean(pdc.get("stationId"))
        station = max_stations.get(station_id)
        if not station:
            fail(pdc, "canonical_station_scope_mismatch")
            continue
        physical = clean(pdc.get("physicalOperatorId") or station.get("physicalOperatorId"))
        if physical != PHYSICAL_OPERATOR_ID:
            fail(pdc, "physical_cpo_not_izivia")
            continue
        binding = pdc_bindings.get(pdc_id)
        if not binding:
            fail(pdc, "source_pdc_not_locked")
            continue
        if binding["canonicalStationId"] != station_id:
            fail(pdc, "source_station_binding_mismatch", binding)
            continue
        power = number(pdc.get("powerKw"))
        if power is None:
            fail(pdc, "missing_power", binding)
            continue
        if abs(power - binding["powerKw"]) > POWER_TOLERANCE_KW:
            fail(pdc, "source_power_binding_mismatch", binding)
            continue
        formula = formulas[binding["formulaId"]]
        location = locations[binding["sourceLocationCode"]]
        offers.append(offer_for(pdc, formula, location, binding, data, normalized_at))
        counters[f"rankable_formula_{binding['formulaId']}"] += 1

    offers.sort(key=lambda row: (row["canonicalStationId"], row["canonicalPdcId"], row["offerId"]))
    if len({row["offerId"] for row in offers}) != len(offers):
        raise AssertionError("duplicate IZIVIA MAX offer id")
    eligible_ids = {clean(row.get("pdcId")) for row in eligible}
    if any(
        row.get("canonicalPdcId") not in eligible_ids
        or row.get("tariffNetworkId") != NETWORK_ID
        or row.get("physicalOperatorId") != PHYSICAL_OPERATOR_ID
        or row.get("channel") != "direct"
        or row.get("subscriptionId") is not None
        or row.get("matchMethod") != "exact_pdc_itinerance"
        or row.get("rankable") is not True
        for row in offers
    ):
        raise AssertionError("IZIVIA MAX materializer escaped exact direct network/CPO scope")

    covered_pdcs = {row["canonicalPdcId"] for row in offers}
    covered_stations = {row["canonicalStationId"] for row in offers}
    canonical_ids = {clean(row.get("pdcId")) for row in pdcs}
    source_ids = set(pdc_bindings)
    summary = {
        "canonicalIziviaMaxStationCount": len(max_stations),
        "canonicalIziviaMaxPdcCount": len(eligible),
        "sourceBoundStationCount": len(source_stations),
        "sourceBoundPdcCount": len(source_ids),
        "sourceBoundPdcAbsentFromCanonicalCount": len(source_ids - canonical_ids),
        "materializedOfferCount": len(offers),
        "rankableOfferCount": len(offers),
        "directRankableOfferCount": len(offers),
        "subscriptionOfferCount": 0,
        "rankableCoveredStationCount": len(covered_stations),
        "rankableCoveredPdcCount": len(covered_pdcs),
        "unresolvedPdcCount": len(eligible_ids - covered_pdcs),
        "physicalInventoryMutationCount": 0,
        "counters": dict(counters),
    }
    return offers, summary, unresolved


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="data/izivia_max_direct_tariffs_v1.json")
    parser.add_argument("--canonical-dir", default="build/france_irve_identity")
    parser.add_argument("--out-dir", default="build/france_irve_offers")
    args = parser.parse_args()
    data = load_json(args.source)
    canonical = Path(args.canonical_dir)
    offers, summary, unresolved = materialize(
        data,
        load_json(canonical / "stations.json.gz"),
        load_json(canonical / "charge_points.json.gz"),
    )
    out = Path(args.out_dir)
    dump_json(out / "izivia_max_pdc_offers_contract_v1_1.json.gz", offers)
    report = {
        "schemaVersion": "1.1.1",
        "dataset": "france-izivia-max-canonical-audit",
        "productionReady": False,
        "summary": summary,
        "unresolvedExamples": unresolved,
    }
    dump_json(out / "izivia_max_materialization_report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
