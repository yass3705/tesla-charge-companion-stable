#!/usr/bin/env python3
from __future__ import annotations

import copy
import importlib.util
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "materialize_france_izivia_max_offers",
    ROOT / "scripts/materialize_france_izivia_max_offers.py",
)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)
SOURCE = MODULE.load_json(ROOT / "data/izivia_max_direct_tariffs_v1.json")


def close(actual, expected, epsilon=1e-9):
    assert abs(float(actual) - float(expected)) <= epsilon, (actual, expected)


def started_cost(rule, energy_kwh, connected_without_charging_minutes):
    epsilon = rule["roundingEpsilon"]
    energy_units = max(0, math.ceil(float(energy_kwh) - epsilon))
    idle_units = max(0, math.ceil(float(connected_without_charging_minutes) - epsilon))
    return energy_units * rule["pricePerKwh"] + idle_units * rule["occupancyPerMinute"]


def fixtures_from_source(source):
    stations = []
    pdcs = []
    for binding in source["panBindings"]:
        station_id = binding["canonicalStationId"]
        stations.append({
            "stationId": station_id,
            "tariffNetworkId": "izivia-max",
            "physicalOperatorId": "izivia",
        })
        for unit in binding["units"]:
            for pdc_id in unit["pdcIds"]:
                power = unit["powerKw"]
                pdcs.append({
                    "stationId": station_id,
                    "pdcId": pdc_id,
                    "tariffNetworkId": "izivia-max",
                    "physicalOperatorId": "izivia",
                    "powerKw": power,
                    "connectors": {"comboCcs": power > 43, "type2": power <= 43},
                })
    return stations, pdcs


def test_source_and_started_unit_semantics():
    formulas, locations, bindings, pdc_bindings = MODULE.validate_source(SOURCE)
    assert len(formulas) == 3
    assert len(locations) == len(bindings) == 24
    assert len(pdc_bindings) == 92

    rule = MODULE.pricing_rule(formulas["energy-049-idle-040"])
    assert rule["energyBilling"] == "started_kwh"
    assert rule["occupancyBilling"] == "started_minute"
    assert rule["occupancyTrigger"] == "while_connected_without_charging"
    assert rule["occupancyDurationBasis"] == "connected_minutes_minus_charging_minutes"
    assert rule["missingUnplugTimePolicy"] == "zero_post_charge"
    assert rule["parkingPerMinute"] == 0
    assert rule["rounding"] == "started_kwh_and_started_minute"
    close(started_cost(rule, 0, 0), 0)
    close(started_cost(rule, 0.01, 0), 0.49)
    close(started_cost(rule, 1, 1), 0.89)
    close(started_cost(rule, 1.000001, 1.000001), 1.78)

    cheap = MODULE.pricing_rule(formulas["energy-035-idle-008333"])
    close(started_cost(cheap, 10, 3), 3.5 + 3 * 0.08333)


def test_full_locked_materialization():
    stations, pdcs = fixtures_from_source(SOURCE)
    offers, summary, unresolved = MODULE.materialize(
        SOURCE,
        stations,
        pdcs,
        normalized_at="2026-09-01T00:00:00+00:00",
    )
    assert summary["canonicalIziviaMaxStationCount"] == 24
    assert summary["canonicalIziviaMaxPdcCount"] == 92
    assert summary["sourceBoundStationCount"] == 24
    assert summary["sourceBoundPdcCount"] == 92
    assert summary["sourceBoundPdcAbsentFromCanonicalCount"] == 0
    assert summary["materializedOfferCount"] == summary["rankableOfferCount"] == 92
    assert summary["directRankableOfferCount"] == 92
    assert summary["subscriptionOfferCount"] == 0
    assert summary["rankableCoveredStationCount"] == 24
    assert summary["rankableCoveredPdcCount"] == 92
    assert summary["unresolvedPdcCount"] == 0
    assert summary["physicalInventoryMutationCount"] == 0
    assert not unresolved
    assert summary["counters"] == {
        "rankable_formula_energy-035-idle-008333": 6,
        "rankable_formula_energy-045-idle-040": 8,
        "rankable_formula_energy-049-idle-040": 78,
    }
    assert len({row["offerId"] for row in offers}) == len(offers)
    assert all(row["tariffNetworkId"] == "izivia-max" for row in offers)
    assert all(row["physicalOperatorId"] == "izivia" for row in offers)
    assert all(row["channel"] == "direct" and row["subscriptionId"] is None for row in offers)
    assert all(row["sourceMode"] == "station_power" for row in offers)
    assert all(row["matchMethod"] == "exact_pdc_itinerance" and row["rankable"] for row in offers)

    by_id = {row["canonicalPdcId"]: row for row in offers}
    assert by_id["FRIMXEIMAX111"]["pricingRules"][0]["pricePerKwh"] == 0.49
    assert by_id["FRIMXEIMAX141"]["pricingRules"][0]["pricePerKwh"] == 0.45
    assert by_id["FRIMXEIMAX1311"]["pricingRules"][0]["pricePerKwh"] == 0.35
    assert by_id["FRIMXEIMAX1311"]["pricingRules"][0]["occupancyPerMinute"] == 0.08333
    assert by_id["FRIMXEIMAX1371"]["pricingRules"][0]["pricePerKwh"] == 0.49


def test_fail_closed_and_network_separation():
    first = SOURCE["panBindings"][0]
    units = first["units"]
    station_id = first["canonicalStationId"]
    stations = [
        {"stationId": station_id, "tariffNetworkId": "izivia-max", "physicalOperatorId": "izivia"},
        {"stationId": "FRIGFPGF61", "tariffNetworkId": "izivia-grand-frais", "physicalOperatorId": "izivia"},
        {"stationId": "FRILFPLFREM1", "tariffNetworkId": "izivia-impact-lf", "physicalOperatorId": "izivia"},
    ]
    pdcs = [
        {"stationId": station_id, "pdcId": units[0]["pdcIds"][0], "tariffNetworkId": "izivia-max", "physicalOperatorId": "izivia", "powerKw": 150, "connectors": {}},
        {"stationId": station_id, "pdcId": units[0]["pdcIds"][1], "tariffNetworkId": "izivia-max", "physicalOperatorId": "izivia", "powerKw": 149, "connectors": {}},
        {"stationId": station_id, "pdcId": "FRIMXEIMAX1NEW", "tariffNetworkId": "izivia-max", "physicalOperatorId": "izivia", "powerKw": 150, "connectors": {}},
        {"stationId": station_id, "pdcId": units[1]["pdcIds"][0], "tariffNetworkId": "izivia-max", "physicalOperatorId": "other", "powerKw": 150, "connectors": {}},
        {"stationId": "FRIGFPGF61", "pdcId": "FRIGFE1", "tariffNetworkId": "izivia-grand-frais", "physicalOperatorId": "izivia", "powerKw": 150, "connectors": {}},
        {"stationId": "FRILFPLFREM1", "pdcId": "FRILFE1", "tariffNetworkId": "izivia-impact-lf", "physicalOperatorId": "izivia", "powerKw": 150, "connectors": {}},
    ]
    offers, summary, unresolved = MODULE.materialize(SOURCE, stations, pdcs)
    assert len(offers) == 1
    assert summary["canonicalIziviaMaxPdcCount"] == 4
    assert summary["rankableCoveredPdcCount"] == 1
    assert summary["unresolvedPdcCount"] == 3
    assert {row["reason"] for row in unresolved} == {
        "source_power_binding_mismatch",
        "source_pdc_not_locked",
        "physical_cpo_not_izivia",
    }
    assert all(row["canonicalPdcId"] not in {"FRIGFE1", "FRILFE1"} for row in offers)


def test_source_guards():
    unsafe = copy.deepcopy(SOURCE)
    unsafe["scope"]["grandFraisFrigfIncluded"] = True
    try:
        MODULE.validate_source(unsafe)
    except ValueError as exc:
        assert "safety policy" in str(exc)
    else:
        raise AssertionError("FRIGF leakage must fail closed")

    unsafe = copy.deepcopy(SOURCE)
    unsafe["formulaCatalog"][0]["energyBilling"] = "linear_kwh"
    try:
        MODULE.validate_source(unsafe)
    except ValueError as exc:
        assert "rounding" in str(exc)
    else:
        raise AssertionError("started-kWh semantics must fail closed")

    unsafe = copy.deepcopy(SOURCE)
    unsafe["panBindings"][0]["units"][0]["pdcIds"].append(
        unsafe["panBindings"][1]["units"][0]["pdcIds"][0]
    )
    try:
        MODULE.validate_source(unsafe)
    except ValueError as exc:
        assert "duplicate" in str(exc)
    else:
        raise AssertionError("duplicate PDC bindings must fail closed")

    unsafe = copy.deepcopy(SOURCE)
    unsafe["panBindings"][0].pop("mappingEvidence")
    try:
        MODULE.validate_source(unsafe)
    except ValueError as exc:
        assert "mapping evidence" in str(exc)
    else:
        raise AssertionError("grouped-source mapping without evidence must fail closed")


def main():
    test_source_and_started_unit_semantics()
    test_full_locked_materialization()
    test_fail_closed_and_network_separation()
    test_source_guards()
    print("IZIVIA MAX canonical materializer tests OK")


if __name__ == "__main__":
    main()
