#!/usr/bin/env python3
from __future__ import annotations

import copy
import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "materialize_france_grand_lyon_offers",
    ROOT / "scripts/materialize_france_grand_lyon_offers.py",
)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)
SOURCE = MODULE.load_json(ROOT / "data/grand_lyon_izivia_direct_tariffs_v1.json")


def close(actual, expected, epsilon=1e-9):
    assert abs(float(actual) - float(expected)) <= epsilon, (actual, expected)


def in_window(minute, start, end):
    def parse(value):
        hour, minutes = value.split(":")
        return (int(hour) * 60 + int(minutes)) % 1440

    a, b = parse(start), parse(end)
    return a <= minute < b if a < b else minute >= a or minute < b


def single_window_cost(rules, start_minute, connected_minutes, energy_kwh):
    candidates = [
        rule for rule in rules
        if rule["scope"] == "allDay" or in_window(start_minute, rule["start"], rule["end"])
    ]
    assert len(candidates) == 1, candidates
    rule = candidates[0]
    extra_energy = max(0.0, energy_kwh - rule["includedEnergyKwh"])
    duration = max(0.0, connected_minutes - rule["durationThresholdMinutes"])
    return rule["connectionFee"] + extra_energy * rule["pricePerKwh"] + duration * rule["durationPerMinute"]


def station(station_id, network="grand-lyon", physical="izivia"):
    return {"stationId": station_id, "tariffNetworkId": network, "physicalOperatorId": physical}


def pdc(station_id, pdc_id, power, network="grand-lyon", physical="izivia"):
    return {
        "stationId": station_id,
        "pdcId": pdc_id,
        "tariffNetworkId": network,
        "physicalOperatorId": physical,
        "powerKw": power,
        "connectors": {},
    }


def test_source_and_formula_semantics():
    bands, profiles, subscriptions = MODULE.validate_source(SOURCE)
    assert set(bands) == {"le7", "le24", "le50", "ge100"}
    assert set(profiles) == {"visitor", "standard", "frequency"}
    assert {row["id"] for row in subscriptions} == {
        "izivia-grand-lyon-standard",
        "izivia-grand-lyon-frequency",
    }

    slow_7_visitor = MODULE.pricing_rules(SOURCE, "le7", "visitor")
    close(slow_7_visitor[0]["durationPerMinute"], 3.5 / 60)
    assert all(rule["timeWindowSelection"] == "elapsed_local_clock" for rule in slow_7_visitor)
    close(single_window_cost(slow_7_visitor, 600, 90, 18), 5.25)
    close(single_window_cost(slow_7_visitor, 1260, 600, 19.9), 6)
    close(single_window_cost(slow_7_visitor, 1260, 600, 20.1), 6.038)
    # A cross-window session applies day connected minutes and night-consumed
    # energy separately; it is not priced solely from its 19:30 start time.
    day, night = slow_7_visitor
    cross_window = 30 * day["durationPerMinute"] + night["connectionFee"] + (25 - night["includedEnergyKwh"]) * night["pricePerKwh"]
    close(cross_window, 9.65)
    assert slow_7_visitor[0]["formulaFamily"] == "grand_lyon_day_slow_connected_duration"
    assert slow_7_visitor[1]["formulaFamily"] == "grand_lyon_night_slow_included_energy"
    assert slow_7_visitor[1]["includedEnergyKwh"] == 20
    assert slow_7_visitor[1]["pricePerKwh"] == 0.38

    slow_24_frequency = MODULE.pricing_rules(SOURCE, "le24", "frequency")
    close(single_window_cost(slow_24_frequency, 600, 90, 30), 6)
    close(single_window_cost(slow_24_frequency, 1260, 900, 20), 4)

    fast_50_visitor = MODULE.pricing_rules(SOURCE, "le50", "visitor")
    assert len(fast_50_visitor) == 1 and fast_50_visitor[0]["scope"] == "allDay"
    assert fast_50_visitor[0]["timeWindowSelection"] is None
    close(single_window_cost(fast_50_visitor, 600, 60, 10), 7.5)
    close(single_window_cost(fast_50_visitor, 1260, 60, 10), 7.5)
    assert fast_50_visitor[0]["durationThresholdMinutes"] == 45
    assert fast_50_visitor[0]["durationPerMinute"] == 0.2
    assert fast_50_visitor[0]["occupancyPerMinute"] == 0

    fast_100_frequency = MODULE.pricing_rules(SOURCE, "ge100", "frequency")
    close(single_window_cost(fast_100_frequency, 600, 60, 10), 7)
    assert [rule["pricePerKwh"] for rule in fast_100_frequency] == [0.4]
    assert in_window(479, "20:00", "08:00")
    assert in_window(480, "08:00", "20:00")
    assert in_window(1199, "08:00", "20:00")
    assert in_window(1200, "20:00", "08:00")


def test_power_boundaries():
    cases = [
        (None, (None, "missing_power")),
        (0, (None, "invalid_power")),
        (3.68, ("le7", "official_power_band_le7")),
        (7, ("le7", "official_power_band_le7")),
        (7.001, ("le24", "official_power_band_le24")),
        (24, ("le24", "official_power_band_le24")),
        (24.001, ("le50", "official_power_band_le50")),
        (50, ("le50", "official_power_band_le50")),
        (50.001, (None, "unpublished_power_gap_50_100")),
        (99.999, (None, "unpublished_power_gap_50_100")),
        (100, ("ge100", "official_power_band_ge100")),
        (150, ("ge100", "official_power_band_ge100")),
    ]
    for power, expected in cases:
        assert MODULE.classify_power(power) == expected, power


def test_scope_and_fail_closed_materialization():
    stations = [
        station("G1"),
        station("G2"),
        station("G3", physical="other"),
        station("X", network="izivia-fast"),
    ]
    pdcs = [
        pdc("G1", "P7", 7),
        pdc("G1", "P24", 7.4),
        pdc("G1", "P50", 50),
        pdc("G1", "P100", 100),
        pdc("G1", "PGAP", 75),
        pdc("G2", "PMISSING", None),
        pdc("G3", "POTHER-CPO", 24, physical="other"),
        pdc("X", "PFAST", 150, network="izivia-fast"),
    ]
    offers, subscriptions, summary, unresolved = MODULE.materialize(
        SOURCE,
        stations,
        pdcs,
        normalized_at="2026-09-01T00:00:00+00:00",
    )
    assert summary["canonicalGrandLyonStationCount"] == 3
    assert summary["canonicalGrandLyonPdcCount"] == 7
    assert summary["rankableCoveredPdcCount"] == 4
    assert summary["unresolvedPdcCount"] == 3
    assert summary["materializedOfferCount"] == summary["rankableOfferCount"] == 12
    assert summary["directRankableOfferCount"] == 4
    assert summary["subscriptionRankableOfferCount"] == 8
    assert summary["physicalInventoryMutationCount"] == 0
    assert summary["counters"]["pdc_band_le7"] == 1
    assert summary["counters"]["pdc_band_le24"] == 1
    assert summary["counters"]["pdc_band_le50"] == 1
    assert summary["counters"]["pdc_band_ge100"] == 1
    assert {row["reason"] for row in unresolved} == {
        "unpublished_power_gap_50_100",
        "missing_power",
        "physical_cpo_not_izivia",
    }
    assert len(subscriptions) == 2 and all(row["defaultSelected"] is False for row in subscriptions)
    assert {row["canonicalPdcId"] for row in offers} == {"P7", "P24", "P50", "P100"}
    assert all(row["tariffNetworkId"] == "grand-lyon" for row in offers)
    assert all(row["physicalOperatorId"] == "izivia" for row in offers)
    assert all(row["provider"].startswith("IZIVIA Grand Lyon · ") for row in offers)
    assert all(row["rankable"] is True and row["matchMethod"] == "network_scope" for row in offers)
    assert all(row["canonicalPdcId"] != "PFAST" for row in offers)
    visitor = [row for row in offers if row["channel"] == "direct"]
    subscriber = [row for row in offers if row["channel"] == "subscription"]
    assert len(visitor) == 4 and all(row["subscriptionId"] is None for row in visitor)
    assert {row["subscriptionId"] for row in subscriber} == {
        "izivia-grand-lyon-standard",
        "izivia-grand-lyon-frequency",
    }


def test_source_guards():
    unsafe = copy.deepcopy(SOURCE)
    unsafe["billingSemantics"]["timeWindowSelection"] = "connection_start_local_time"
    try:
        MODULE.validate_source(unsafe)
    except ValueError as exc:
        assert "billing semantics" in str(exc)
    else:
        raise AssertionError("connection-start-only window selection must fail closed")

    unsafe = copy.deepcopy(SOURCE)
    unsafe["scope"]["roamingTariffsPromotedToDirect"] = True
    try:
        MODULE.validate_source(unsafe)
    except ValueError as exc:
        assert "safety policy" in str(exc)
    else:
        raise AssertionError("roaming promotion must fail closed")

    unsafe = copy.deepcopy(SOURCE)
    unsafe["subscriptions"][0]["defaultSelected"] = True
    try:
        MODULE.validate_source(unsafe)
    except ValueError as exc:
        assert "selection policy" in str(exc)
    else:
        raise AssertionError("default-selected subscription must fail closed")

    unsafe = copy.deepcopy(SOURCE)
    unsafe["tariffs"]["night"]["le7"]["includedEnergyKwh"] = 0
    try:
        MODULE.validate_source(unsafe)
    except ValueError as exc:
        assert "included energy" in str(exc)
    else:
        raise AssertionError("night-package flattening must fail closed")


def main():
    test_source_and_formula_semantics()
    test_power_boundaries()
    test_scope_and_fail_closed_materialization()
    test_source_guards()
    print("Grand Lyon IZIVIA canonical materializer tests OK")


if __name__ == "__main__":
    main()
