#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "materialize_france_izivia_express_offers",
    ROOT / "scripts/materialize_france_izivia_express_offers.py",
)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


CAP = {
    "family": "session_cap",
    "currency": "EUR",
    "energy": {"ratePerKwhEur": 0.55, "billing": "started_kwh"},
    "postCharge": {"billing": "started_block", "blockMinutes": 5, "blockFeeEur": 1.0},
    "sessionCapEur": 50.0,
    "raw": "cap fixture",
}
DAY_NIGHT = {
    "family": "day_night_included_energy",
    "currency": "EUR",
    "tariffSelection": "connection_start_local_time",
    "day": {
        "start": "08:00",
        "end": "20:00",
        "energy": {"ratePerKwhEur": 0.42, "billing": "started_kwh"},
        "postCharge": {"billing": "started_minute", "ratePerMinuteEur": 4 / 60},
    },
    "night": {
        "start": "20:00",
        "end": "08:00",
        "connectionFeeEur": 6.0,
        "includedEnergyKwh": 20.0,
        "extraEnergy": {"ratePerKwhEur": 0.30, "billing": "started_kwh"},
    },
    "raw": "day/night fixture",
}
SIMPLE = {
    "family": "simple_postcharge",
    "currency": "EUR",
    "energy": {"ratePerKwhEur": 0.55, "billing": "started_kwh"},
    "postCharge": {"billing": "started_block", "blockMinutes": 5, "blockFeeEur": 2.0},
    "raw": "simple fixture",
}
LINEAR_SIMPLE = {
    "family": "simple_postcharge",
    "currency": "EUR",
    "energy": {"ratePerKwhEur": 0.52, "billing": "linear_kwh"},
    "postCharge": {"billing": "linear_minute", "ratePerMinuteEur": 0.4167},
    "raw": "linear fixture",
}


def started_units(value, epsilon):
    value = max(0.0, float(value))
    return math.ceil(value - epsilon) if value > epsilon else 0


def in_window(minute, start, end):
    def parse(value):
        hour, minutes = value.split(":")
        return (int(hour) * 60 + int(minutes)) % 1440

    a, b = parse(start), parse(end)
    return a <= minute < b if a < b else minute >= a or minute < b


def contract_cost(rules, start_minute, charge_minutes, energy_kwh, occupied_minutes):
    candidates = [
        rule for rule in rules
        if rule["scope"] == "allDay" or in_window(start_minute, rule["start"], rule["end"])
    ]
    assert len(candidates) == 1, candidates
    rule = candidates[0]
    epsilon = rule["roundingEpsilon"]
    extra_energy = max(0.0, energy_kwh - rule["includedEnergyKwh"])
    energy_units = (
        started_units(extra_energy, epsilon)
        if rule["energyBilling"] == "started_kwh"
        else extra_energy
    )
    energy_cost = energy_units * rule["pricePerKwh"]
    post_minutes = max(0.0, occupied_minutes - charge_minutes)
    if rule["occupancyBilling"] == "started_block":
        post_cost = started_units(post_minutes / rule["occupancyBlockMinutes"], epsilon) * rule["occupancyBlockFee"]
    elif rule["occupancyBilling"] == "started_minute":
        post_cost = started_units(post_minutes, epsilon) * rule["occupancyPerMinute"]
    elif rule["occupancyBilling"] == "linear_minute":
        post_cost = post_minutes * rule["occupancyPerMinute"]
    else:
        post_cost = 0.0
    raw = rule["connectionFee"] + energy_cost + post_cost
    total = min(raw, rule["totalTransactionCap"]) if rule["totalTransactionCap"] is not None else raw
    return total, energy_cost, post_cost


def exact_energy_cost(component, energy_kwh):
    units = (
        started_units(energy_kwh, MODULE.ROUNDING_EPSILON)
        if component["billing"] == "started_kwh"
        else max(0.0, energy_kwh)
    )
    return units * component["ratePerKwhEur"]


def exact_post_cost(component, post_minutes):
    if component is None or post_minutes <= MODULE.ROUNDING_EPSILON:
        return 0.0
    if component["billing"] == "started_block":
        return started_units(post_minutes / component["blockMinutes"], MODULE.ROUNDING_EPSILON) * component["blockFeeEur"]
    units = (
        started_units(post_minutes, MODULE.ROUNDING_EPSILON)
        if component["billing"] == "started_minute"
        else post_minutes
    )
    return units * component["ratePerMinuteEur"]


def exact_cost(exact, start_minute, charge_minutes, energy_kwh, occupied_minutes):
    post_minutes = max(0.0, occupied_minutes - charge_minutes)
    if exact["family"] == "day_night_included_energy":
        if 480 <= start_minute < 1200:
            return exact_energy_cost(exact["day"]["energy"], energy_kwh) + exact_post_cost(exact["day"].get("postCharge"), post_minutes)
        extra = max(0.0, energy_kwh - exact["night"]["includedEnergyKwh"])
        return exact["night"]["connectionFeeEur"] + exact_energy_cost(exact["night"]["extraEnergy"], extra)
    raw = exact_energy_cost(exact["energy"], energy_kwh) + exact_post_cost(exact.get("postCharge"), post_minutes)
    return min(raw, exact["sessionCapEur"]) if exact["family"] == "session_cap" else raw


def close(actual, expected, epsilon=1e-9):
    assert abs(actual - expected) <= epsilon, (actual, expected)


def config(kind, power, exact):
    return {
        "id": f"cfg:{kind}:{power}",
        "kind": kind,
        "powerKw": power,
        "pricing": {"iziviaExact": exact},
    }


def location(station_id, exact, kind="AC", power=22.0):
    return {
        "stationId": station_id,
        "officialStationIds": [station_id],
        "directPricePublished": exact is not None,
        "configurations": [] if exact is None else [config(kind, power, exact)],
    }


def station(station_id, network="izivia-express"):
    return {"stationId": station_id, "tariffNetworkId": network, "physicalOperatorId": "izivia"}


def pdc(station_id, pdc_id, power, network="izivia-express", dc=False):
    return {
        "stationId": station_id,
        "pdcId": pdc_id,
        "tariffNetworkId": network,
        "physicalOperatorId": "izivia",
        "powerKw": power,
        "connectors": {"type2": not dc, "comboCcs": dc, "chademo": False, "ef": False},
    }


def test_formula_conversion():
    cap_rules = MODULE.pricing_rules(CAP)
    assert len(cap_rules) == 1
    cap = cap_rules[0]
    assert cap["energyBilling"] == "started_kwh"
    assert cap["occupancyBilling"] == "started_block"
    assert cap["occupancyBlockMinutes"] == 5 and cap["occupancyBlockFee"] == 1.0
    assert cap["totalTransactionCap"] == 50.0
    assert cap["rounding"] == "started_kwh+post_charge_started_block"
    assert cap["occupancyDurationBasis"] == "connected_minutes_minus_charging_minutes"
    assert cap["missingUnplugTimePolicy"] == "zero_post_charge"
    total, energy, post = contract_cost(cap_rules, 600, 30, 10.1, 36)
    close(energy, 6.05)
    close(post, 2.0)
    close(total, 8.05)
    close(contract_cost(cap_rules, 600, 30, 100.1, 120)[0], 50.0)
    close(contract_cost(cap_rules, 600, 30, 10.1, 30)[0], 6.05)

    day_night_rules = MODULE.pricing_rules(DAY_NIGHT)
    assert len(day_night_rules) == 2
    assert all(rule["timeWindowSelection"] == "connection_start_local_time" for rule in day_night_rules)
    assert day_night_rules[1]["includedEnergyKwh"] == 20.0
    assert day_night_rules[1]["connectionFee"] == 6.0
    total, energy, post = contract_cost(day_night_rules, 600, 20, 10.1, 24)
    close(energy, 4.62)
    close(post, 4 * (4 / 60))
    close(total, 4.62 + 4 * (4 / 60))
    close(contract_cost(day_night_rules, 1260, 20, 19.9, 20)[0], 6.0)
    close(contract_cost(day_night_rules, 1260, 20, 20.1, 20)[0], 6.3)
    close(contract_cost(day_night_rules, 1260, 20, 21.2, 20)[0], 6.6)
    assert in_window(479, "20:00", "08:00")
    assert in_window(480, "08:00", "20:00")
    assert in_window(1199, "08:00", "20:00")
    assert in_window(1200, "20:00", "08:00")

    simple_rules = MODULE.pricing_rules(SIMPLE)
    total, energy, post = contract_cost(simple_rules, 600, 30, 20.1, 36)
    close(energy, 11.55)
    close(post, 4.0)
    close(total, 15.55)

    linear_rules = MODULE.pricing_rules(LINEAR_SIMPLE)
    assert linear_rules[0]["rounding"] is None
    total, energy, post = contract_cost(linear_rules, 600, 30, 20.1, 36.25)
    close(energy, 20.1 * 0.52)
    close(post, 6.25 * 0.4167)
    close(total, energy + post)


def test_scope_and_fail_closed_materialization():
    v8 = {
        "dataset": "izivia-express-direct-tcc-v8-france",
        "schemaVersion": "1.0.0",
        "sourceGeneratedAt": "fixture",
        "scope": {
            "countryCode": "FR",
            "onlyDirectCpo": True,
            "roamingIncluded": False,
            "subscriptionDiscountsIncluded": False,
            "failClosed": True,
            "pricingSemantics": "exact_custom_runtime",
        },
        "stations": [
            location("A", CAP),
            location("B", DAY_NIGHT, kind="DC", power=50.0),
            location("C", SIMPLE),
            location("U", None),
        ],
    }
    inventory = {
        "metadata": {
            "operator": "IZIVIA",
            "network": "Izivia Express",
            "principle": "No roaming; no silent tariff approximation; only charging_location pricing is treated as direct simulation pricing.",
        },
        "stations": [
            {"officialStationId": "A", "directPricePublished": True, "pdcIds": ["A1", "A2"]},
            {"officialStationId": "B", "directPricePublished": True, "pdcIds": ["B1"]},
            {"officialStationId": "C", "directPricePublished": True, "pdcIds": ["C1"]},
            {"officialStationId": "U", "directPricePublished": False, "pdcIds": ["U1"]},
        ],
    }
    stations = [station(x) for x in ["A", "B", "C", "U", "N"]] + [station("X", "other")]
    pdcs = [
        pdc("A", "A1", 22.0),
        pdc("A", "A2", 55.0, dc=True),
        pdc("A", "A3", 22.0),
        pdc("B", "B1", 50.0, dc=True),
        pdc("C", "C1", 22.0),
        pdc("U", "U1", 22.0),
        pdc("N", "N1", 22.0),
        pdc("X", "X1", 22.0, network="other"),
    ]
    offers, report = MODULE.materialize(
        v8,
        inventory,
        stations,
        pdcs,
        lock={"sourceCommit": "fixture"},
        normalized_at="2026-09-01T00:00:00+00:00",
        strict=False,
    )
    summary = report["summary"]
    assert summary["canonicalEligiblePdcCount"] == 7
    assert summary["rankableCoveredPdcCount"] == summary["materializedOfferCount"] == 4
    assert summary["failClosedPdcCount"] == 3
    assert report["unresolvedReasonPdcCounts"] == {
        "direct_price_not_published": 1,
        "pdc_not_in_locked_source_inventory": 1,
        "station_not_in_locked_source": 1,
    }
    by_pdc = {row["canonicalPdcId"]: row for row in offers}
    assert set(by_pdc) == {"A1", "A2", "B1", "C1"}
    assert by_pdc["A1"]["selectors"]["configurationProof"] == "exact_configuration_power"
    assert by_pdc["A2"]["selectors"]["configurationProof"] == "exact_pdc_station_formula"
    assert by_pdc["A1"]["pricingRules"][0]["pricePerKwh"] == 0.55
    assert by_pdc["B1"]["pricingRules"][0]["pricePerKwh"] == 0.42
    assert all(row["matchMethod"] == "exact_pdc_itinerance" for row in offers)
    assert all(row["sourceEvseId"] == row["canonicalPdcId"] for row in offers)
    assert all(row["tariffNetworkId"] == "izivia-express" and row["channel"] == "direct" for row in offers)
    assert all(row["subscriptionId"] is None and row["rankable"] is True for row in offers)
    assert all(rule["parkingPerMinute"] == 0 for row in offers for rule in row["pricingRules"])


def test_invalid_formula_rejected():
    bad = dict(CAP, currency="USD")
    try:
        MODULE.pricing_rules(bad)
    except ValueError:
        pass
    else:
        raise AssertionError("non-EUR IZIVIA Express formula must fail closed")


def test_locked_source_parity(path):
    source = json.loads(Path(path).read_text(encoding="utf-8"))
    unique = {}
    for location_row in source.get("stations") or []:
        for source_config in location_row.get("configurations") or []:
            exact = source_config["pricing"]["iziviaExact"]
            unique[json.dumps(exact, ensure_ascii=False, sort_keys=True)] = exact
    assert len(unique) == 18, len(unique)
    starts = [0, 479, 480, 600, 1199, 1200, 1260, 1439]
    energies = [0, 1e-10, 0.1, 0.999999999, 1.0, 1.000000001, 10.1, 19.9, 20.0, 20.1, 21.2, 100.1]
    post_minutes = [0, 0.1, 1, 4, 5, 5.1, 6, 12.25]
    comparisons = 0
    for exact in unique.values():
        rules = MODULE.pricing_rules(exact)
        for start in starts:
            for energy in energies:
                for post in post_minutes:
                    expected = exact_cost(exact, start, 30, energy, 30 + post)
                    actual = contract_cost(rules, start, 30, energy, 30 + post)[0]
                    close(actual, expected, epsilon=1e-8)
                    comparisons += 1
    print(f"IZIVIA Express locked-source parity: {len(unique)} formulas / {comparisons} cost cases OK")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-v8")
    args = parser.parse_args()
    test_formula_conversion()
    test_scope_and_fail_closed_materialization()
    test_invalid_formula_rejected()
    if args.source_v8:
        test_locked_source_parity(args.source_v8)
    print("IZIVIA Express V8 -> V9 contract materializer regression tests OK")


if __name__ == "__main__":
    main()
