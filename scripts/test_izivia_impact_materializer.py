#!/usr/bin/env python3
from __future__ import annotations

import copy
import importlib.util
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "materialize_france_izivia_impact_offers",
    ROOT / "scripts/materialize_france_izivia_impact_offers.py",
)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)
SOURCE = MODULE.load_json(ROOT / "data/izivia_impact_direct_tariffs_v1.json")


def close(actual, expected, epsilon=1e-9):
    assert abs(float(actual) - float(expected)) <= epsilon, (actual, expected)


def fixtures_from_source(source):
    stations = []
    pdcs = []
    for row in source["stations"]:
        station_id = row["stationId"]
        stations.append({
            "stationId": station_id,
            "idStationItinerance": station_id,
            "tariffNetworkId": "izivia-impact",
            "physicalOperatorId": "izivia",
            "name": station_id,
        })
        for pdc_id, power in zip(row["pdcIds"], row["powersKw"]):
            pdcs.append({
                "stationId": station_id,
                "pdcId": pdc_id,
                "idPdcItinerance": pdc_id,
                "tariffNetworkId": "izivia-impact",
                "physicalOperatorId": "izivia",
                "powerKw": power,
                "connectors": {"type2": power <= 43, "comboCcs": power > 43},
            })
    return stations, pdcs


def formula(formula_id):
    return next(row for row in SOURCE["formulas"] if row["id"] == formula_id)


def reference_formula(formula_id):
    return next(row for row in SOURCE["referenceFormulas"] if row["id"] == formula_id)


def started_units(value, epsilon=1e-9):
    return max(0, math.ceil(float(value) - epsilon))


def rule_cost(rule, energy_kwh, post_charge_minutes=0):
    total = rule["connectionFee"]
    total += max(0, started_units(energy_kwh, rule["roundingEpsilon"]) - rule["includedEnergyKwh"]) * rule["pricePerKwh"]
    if rule["occupancyBilling"] == "started_minute":
        total += started_units(post_charge_minutes, rule["roundingEpsilon"]) * rule["occupancyPerMinute"]
    elif rule["occupancyBilling"] == "started_block":
        blocks = started_units(post_charge_minutes / rule["occupancyBlockMinutes"], rule["roundingEpsilon"])
        total += blocks * rule["occupancyBlockFee"]
    return total


def test_source_and_pricing_semantics():
    formulas, reference_formulas, stations, bindings = MODULE.validate_source(SOURCE)
    expected = SOURCE["expected"]
    assert len(formulas) == expected["formulaCount"]
    assert len(reference_formulas) == expected["referenceFormulaCount"]
    assert len(stations) == expected["stationCount"]
    assert len(bindings) == expected["pdcCount"]

    # Only the complete rapid formula is eligible for pricing-rule conversion.
    assert set(formulas) == {"direct-rapid-055-post-2-per-5"}
    assert set(reference_formulas) == {
        "live-mixed-040-night-6",
        "saint-nazaire-ac-night-6",
    }

    rapid = MODULE.pricing_rules(formulas["direct-rapid-055-post-2-per-5"])[0]
    assert rapid["scope"] == "allDay" and rapid["timeWindowSelection"] is None
    assert rapid["occupancyBilling"] == "started_block"
    assert rapid["occupancyBlockMinutes"] == 5
    assert rapid["occupancyBlockFee"] == 2
    close(rule_cost(rapid, 10.01, 5.01), 11 * 0.55 + 4)

    # Day/night figures remain audited evidence only: the cross-window selector
    # is unpublished, so these catalogues must never be sent to pricing_rules.
    expected_reference_day = {
        "live-mixed-040-night-6": (0.40, 0.06667),
        "saint-nazaire-ac-night-6": (0.38, 0.05),
    }
    for formula_id, (day_rate, post_charge_rate) in expected_reference_day.items():
        evidence = reference_formulas[formula_id]
        assert MODULE.validate_reference_formula(evidence) == "day_night_included_energy"
        assert evidence["tariffSelection"] == "unpublished"
        assert evidence["timeZone"] == "Europe/Paris"
        assert (evidence["day"]["start"], evidence["day"]["end"]) == ("08:00", "20:00")
        assert (evidence["night"]["start"], evidence["night"]["end"]) == ("20:00", "08:00")
        assert evidence["day"]["energy"]["billing"] == "started_kwh"
        close(evidence["day"]["energy"]["ratePerKwhEur"], day_rate)
        assert evidence["day"]["postCharge"]["billing"] == "started_minute"
        close(evidence["day"]["postCharge"]["ratePerMinuteEur"], post_charge_rate)
        assert evidence["night"]["extraEnergy"]["billing"] == "started_kwh"
        close(evidence["night"]["connectionFeeEur"], 6)
        close(evidence["night"]["includedEnergyKwh"], 20)
        close(evidence["night"]["extraEnergy"]["ratePerKwhEur"], 0.30)

    reference_pdc_counts = {formula_id: 0 for formula_id in reference_formulas}
    for binding in bindings.values():
        direct = binding["direct"]
        reference_formula_id = direct.get("referenceFormulaId")
        if reference_formula_id:
            assert direct["status"] == "blocked"
            assert not direct.get("formulaId")
            assert "cross_window_tariff_selection_unpublished" in direct["blockedReasons"]
            reference_pdc_counts[reference_formula_id] += 1
    assert reference_pdc_counts == expected["referenceFormulaPdcCounts"]


def test_full_locked_materialization_and_territories():
    stations, pdcs = fixtures_from_source(SOURCE)
    offers, summary, unresolved = MODULE.materialize(
        SOURCE,
        stations,
        pdcs,
        normalized_at="2026-09-01T00:00:00+00:00",
    )
    expected = SOURCE["expected"]
    assert summary["canonicalIziviaImpactStationCount"] == expected["stationCount"]
    assert summary["canonicalIziviaImpactPdcCount"] == expected["pdcCount"]
    assert summary["sourceBoundStationCount"] == expected["stationCount"]
    assert summary["sourceBoundPdcCount"] == expected["pdcCount"]
    assert summary["sourceBoundPdcAbsentFromCanonicalCount"] == 0
    assert summary["materializedOfferCount"] == len(offers) == expected["pdcCount"]
    assert summary["rankableOfferCount"] == summary["directRankableOfferCount"] == expected["rankablePdcCount"]
    assert summary["referenceOfferCount"] == summary["referenceCoveredPdcCount"] == expected["blockedPdcCount"]
    assert summary["rankableCoveredStationCount"] == expected["rankableStationCount"]
    assert summary["rankableCoveredPdcCount"] == expected["rankablePdcCount"]
    assert summary["unresolvedPdcCount"] == 0
    assert summary["physicalInventoryMutationCount"] == 0
    assert not unresolved
    assert len({row["offerId"] for row in offers}) == len(offers)
    assert len({row["canonicalPdcId"] for row in offers}) == len(offers)

    by_pdc = {row["canonicalPdcId"]: row for row in offers}
    source_by_station = {row["stationId"]: row for row in SOURCE["stations"]}
    formula_by_id = {row["id"]: row for row in SOURCE["formulas"]}
    reference_formula_by_id = {row["id"]: row for row in SOURCE["referenceFormulas"]}
    for row in offers:
        source_station = source_by_station[row["canonicalStationId"]]
        assert row["tariffNetworkId"] == "izivia-impact"
        assert row["physicalOperatorId"] == "izivia"
        assert row["matchMethod"] == "exact_pdc_itinerance"
        assert row["sourceStationId"] == row["canonicalStationId"]
        assert row["sourceEvseId"] == row["canonicalPdcId"]
        assert row["selectors"]["territory"] == source_station["territory"]
        assert row["selectors"]["tariffClass"] == source_station["tariffClass"]
        assert row["selectors"]["intendedChannel"] == "direct"
        assert row["selectors"]["blocksGenericFallback"] is True
        assert row["subscriptionId"] is None
        assert row["kind"] == ("AC" if source_station["tariffClass"] == "ac_22" else None)
        if row["rankable"]:
            assert row["channel"] == "direct" and row["sourceMode"] == "station_evse"
            assert row["pricingRules"] and not row["blockedReasons"]
            expected_formula = formula_by_id[source_station["direct"]["formulaId"]]
            assert source_station["tariffClass"] == "rapid"
            assert source_station["direct"]["formulaId"] == "direct-rapid-055-post-2-per-5"
            assert row["selectors"]["formulaId"] == expected_formula["id"]
            assert row["selectors"]["referenceFormulaId"] is None
            assert row["selectors"]["referenceFormulaFamily"] is None
            assert row["selectors"]["tariffTimeZone"] == expected_formula.get("timeZone")
            assert row["selectors"]["referenceTimeZone"] is None
        else:
            assert row["channel"] == "reference" and row["sourceMode"] == "reference_only"
            assert row["pricingRules"] == [] and row["blockedReasons"]
            assert row["selectors"]["formulaId"] is None
            assert row["selectors"]["tariffTimeZone"] is None
            reference_formula_id = source_station["direct"].get("referenceFormulaId")
            assert row["selectors"]["referenceFormulaId"] == reference_formula_id
            if reference_formula_id:
                evidence = reference_formula_by_id[reference_formula_id]
                assert row["selectors"]["referenceFormulaFamily"] == evidence["family"]
                assert row["selectors"]["referenceTimeZone"] == evidence["timeZone"]
                assert "cross_window_tariff_selection_unpublished" in row["blockedReasons"]
            else:
                assert row["selectors"]["referenceFormulaFamily"] is None
                assert row["selectors"]["referenceTimeZone"] is None

    # Exact matching is significant: the two station ids share a textual prefix.
    for station_id in ("FRIIMPIZIM153", "FRIIMPIZIM1531"):
        source_station = source_by_station[station_id]
        assert source_station["pdcIds"]
        for pdc_id in source_station["pdcIds"]:
            assert by_pdc[pdc_id]["canonicalStationId"] == station_id

    live_station = source_by_station["FRIIMPIZIM134"]
    live_offer = by_pdc[live_station["pdcIds"][0]]
    assert live_offer["rankable"] is False
    assert live_offer["pricingRules"] == []
    assert live_offer["selectors"]["tariffTimeZone"] is None
    assert live_offer["selectors"]["referenceFormulaId"] == "live-mixed-040-night-6"
    assert live_offer["selectors"]["referenceTimeZone"] == "Europe/Paris"
    assert live_offer["sourceUrl"] == SOURCE["sources"]["officialLiveMap"]["frontend"]
    rapid_station = next(row for row in SOURCE["stations"] if row["direct"].get("formulaId") == "direct-rapid-055-post-2-per-5")
    rapid_offer = by_pdc[rapid_station["pdcIds"][0]]
    assert rapid_offer["selectors"]["tariffTimeZone"] is None
    assert rapid_offer["selectors"]["referenceFormulaId"] is None
    assert rapid_offer["selectors"]["referenceTimeZone"] is None

    territory_expected = {territory: {"stationCount": 0, "pdcCount": 0} for territory in MODULE.TERRITORIES}
    for source_station in SOURCE["stations"]:
        item = territory_expected[source_station["territory"]]
        item["stationCount"] += 1
        item["pdcCount"] += len(source_station["pdcIds"])
    for territory, counts in territory_expected.items():
        actual = summary["territories"][territory]
        assert actual["canonicalStationCount"] == counts["stationCount"]
        assert actual["canonicalPdcCount"] == counts["pdcCount"]


def test_fail_closed_and_network_separation():
    stations, pdcs = fixtures_from_source(SOURCE)
    rankable_station = next(row for row in SOURCE["stations"] if row["direct"]["status"] == "rankable")
    blocked_station = next(row for row in SOURCE["stations"] if row["direct"]["status"] == "blocked")
    changed_power_id = rankable_station["pdcIds"][0]
    changed_cpo_id = blocked_station["pdcIds"][0]
    drift_network_id = next(
        pdc_id for row in SOURCE["stations"] for pdc_id in row["pdcIds"]
        if pdc_id not in {changed_power_id, changed_cpo_id}
    )
    for pdc in pdcs:
        if pdc["pdcId"] == changed_power_id:
            pdc["powerKw"] += 1
        if pdc["pdcId"] == changed_cpo_id:
            pdc["physicalOperatorId"] = "other"
        if pdc["pdcId"] == drift_network_id:
            pdc["tariffNetworkId"] = "izivia-impact-lf"
    pdcs.append({
        "stationId": rankable_station["stationId"],
        "pdcId": "FRIIMEIZIMNEW1",
        "idPdcItinerance": "FRIIMEIZIMNEW1",
        "tariffNetworkId": "izivia-impact",
        "physicalOperatorId": "izivia",
        "powerKw": rankable_station["powersKw"][0],
        "connectors": {},
    })
    leakage = [
        ("FRILFPLFREM1", "FRILFELFREM11", "izivia-impact-lf"),
        ("FRIGFPGF61", "FRIGFEGF611", "izivia-grand-frais"),
        ("FRIMXPIMAX1", "FRIMXEIMAX111", "izivia-max"),
        ("FREXPP1", "FREXPE1", "izivia-express"),
    ]
    for station_id, pdc_id, network in leakage:
        stations.append({"stationId": station_id, "tariffNetworkId": network, "physicalOperatorId": "izivia"})
        pdcs.append({
            "stationId": station_id, "pdcId": pdc_id, "tariffNetworkId": network,
            "physicalOperatorId": "izivia", "powerKw": 150, "connectors": {"comboCcs": True},
        })

    offers, summary, unresolved = MODULE.materialize(SOURCE, stations, pdcs)
    assert summary["canonicalIziviaImpactPdcCount"] == SOURCE["expected"]["pdcCount"]
    assert summary["sourceBoundPdcAbsentFromCanonicalCount"] == 1
    assert summary["materializedOfferCount"] == SOURCE["expected"]["pdcCount"] - 3
    assert summary["unresolvedPdcCount"] == 3
    assert {row["reason"] for row in unresolved} == {
        "source_power_binding_mismatch", "physical_cpo_not_izivia", "source_pdc_not_locked",
    }
    offer_ids = {row["canonicalPdcId"] for row in offers}
    assert changed_power_id not in offer_ids and changed_cpo_id not in offer_ids
    assert drift_network_id not in offer_ids
    assert "FRIIMEIZIMNEW1" not in offer_ids
    assert not offer_ids.intersection({pdc_id for _, pdc_id, _ in leakage})


def expect_source_failure(mutator, text):
    unsafe = copy.deepcopy(SOURCE)
    mutator(unsafe)
    try:
        MODULE.validate_source(unsafe)
    except ValueError as exc:
        assert text in str(exc), str(exc)
    else:
        raise AssertionError(f"unsafe IZIVIA Impact source accepted: {text}")


def test_source_guards():
    expect_source_failure(
        lambda source: source["scope"].__setitem__("accessOffersIncluded", True),
        "safety scope",
    )
    expect_source_failure(
        lambda source: source["referenceFormulas"][0].__setitem__(
            "tariffSelection", "connection_start_local_time"
        ),
        "reference cross-window semantics",
    )
    expect_source_failure(
        lambda source: source["referenceFormulas"][0]["day"]["energy"].__setitem__(
            "billing", "linear_kwh"
        ),
        "energy billing",
    )

    def duplicate_pdc(source):
        source["stations"][1]["pdcIds"][0] = source["stations"][0]["pdcIds"][0]

    expect_source_failure(duplicate_pdc, "duplicate")

    def rankable_without_formula(source):
        row = next(item for item in source["stations"] if item["direct"]["status"] == "rankable")
        row["direct"].pop("formulaId")

    expect_source_failure(rankable_without_formula, "rankable formula binding")

    def blocked_without_reason(source):
        row = next(item for item in source["stations"] if item["direct"]["status"] == "blocked")
        row["direct"]["blockedReasons"] = []

    expect_source_failure(blocked_without_reason, "blocked direct decision")

    def rapid_formula_on_wrong_tariff_class(source):
        row = next(
            item for item in source["stations"]
            if item["territory"] == "m2a" and item["tariffClass"] == "rapid" and item["direct"]["status"] == "rankable"
        )
        row["tariffClass"] = "ac_22"

    expect_source_failure(rapid_formula_on_wrong_tariff_class, "territory/class formula binding")

    def reference_without_cross_window_reason(source):
        row = next(item for item in source["stations"] if item["direct"].get("referenceFormulaId"))
        row["direct"]["blockedReasons"] = ["reference_evidence_only"]

    expect_source_failure(reference_without_cross_window_reason, "cross-window fail-closed reason")


def test_canonical_identity_guards():
    cases = (
        ("station_itinerance", lambda stations, pdcs: stations[0].__setitem__("idStationItinerance", "FRIIMPIZIMOTHER"), "canonical_station_itinerance_mismatch"),
        ("pdc_itinerance", lambda stations, pdcs: pdcs[0].__setitem__("idPdcItinerance", "FRIIMEIZIMOTHER"), "canonical_pdc_itinerance_mismatch"),
        ("station_cpo", lambda stations, pdcs: stations[0].__setitem__("physicalOperatorId", "other"), "station_physical_cpo_not_izivia"),
    )
    for _label, mutate, expected_reason in cases:
        stations, pdcs = fixtures_from_source(SOURCE)
        mutate(stations, pdcs)
        offers, summary, unresolved = MODULE.materialize(SOURCE, stations, pdcs)
        assert summary["unresolvedPdcCount"] >= 1
        assert expected_reason in {row["reason"] for row in unresolved}


def main():
    test_source_and_pricing_semantics()
    test_full_locked_materialization_and_territories()
    test_fail_closed_and_network_separation()
    test_source_guards()
    test_canonical_identity_guards()
    print("IZIVIA Impact canonical materializer tests OK")


if __name__ == "__main__":
    main()
