#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    return json.loads((ROOT / "data" / name).read_text(encoding="utf-8"))


def by_id(rows):
    return {row["id"]: row for row in rows}


def assert_close(actual, expected):
    assert abs(float(actual) - float(expected)) < 1e-9, (actual, expected)


def test_indigo():
    data = load("indigo_recharge_direct_tariffs_v1.json")
    assert data["networkId"] == "indigo"
    offers = by_id(data["offers"])
    public = offers["indigo-public-standard"]
    rule = public["pricingRules"][0]
    assert_close(rule["pricePerKwh"], 0.55)
    assert_close(rule["connectionFee"], 0.99)
    assert_close(rule["durationPerMinute"], 0.10)
    assert rule["durationThresholdMinutes"] == 600
    card = offers["indigo-a-la-carte-standard"]["pricingRules"][0]
    assert_close(card["pricePerKwh"], 0.45)
    assert_close(card["connectionFee"], 0.49)
    assert_close(card["durationPerMinute"], 0.05)
    legacy = offers["indigo-a-la-carte-legacy-city"]
    assert "Saint-Germain-en-Laye" in legacy["selectors"]["cities"]
    assert_close(legacy["pricingRules"][0]["pricePerKwh"], 0.30)
    assert_close(legacy["pricingRules"][0]["chargePerMinute"], 0.03)
    assert offers["indigo-public-legacy-city-unresolved"]["rankable"] is False
    subs = by_id(data["subscriptions"])
    assert subs["indigo-recharge-a-la-carte"]["defaultSelected"] is False
    for sid in ("indigo-recharge-100", "indigo-recharge-200", "indigo-recharge-300"):
        assert subs[sid]["quotaBased"] is True
        assert subs[sid]["rankableWhenSelected"] is False


def test_eborn():
    data = load("eborn_direct_tariffs_v1.json")
    assert data["networkId"] == "eborn"
    offers = by_id(data["offers"])
    expected_public = {
        "eborn-public-accelerated": (0.433, 0.075),
        "eborn-public-rapid": (0.573, 0.12),
        "eborn-public-ultra": (0.650, 0.12),
    }
    expected_card = {
        "eborn-card-accelerated": (0.310, 0.05),
        "eborn-card-rapid": (0.433, 0.075),
        "eborn-card-ultra": (0.588, 0.075),
    }
    for oid, (energy, idle) in {**expected_public, **expected_card}.items():
        rule = offers[oid]["pricingRules"][0]
        assert_close(rule["pricePerKwh"], energy)
        assert_close(rule["occupancyPerMinute"], idle)
        assert rule["occupancyThresholdMinutes"] == 30
    assert offers["eborn-public-accelerated"]["pricingRules"][0]["occupancyWindow"] == "08:00-20:00"
    assert offers["eborn-card-accelerated"]["pricingRules"][0]["occupancyWindow"] == "08:00-20:00"
    subs = by_id(data["subscriptions"])
    assert subs["eborn-a-la-carte"]["feeEur"] == 14
    assert subs["eborn-a-la-carte"]["feePeriod"] == "year"
    assert subs["eborn-au-forfait"]["includedKwh"] == 250
    assert subs["eborn-au-forfait"]["rankableWhenSelected"] is False
    assert data["partnerRoaming"]["pricingRule"] == "partner_network_tariff_plus_15_percent"


def test_mobive():
    data = load("mobive_direct_tariffs_v1.json")
    assert data["networkId"] == "mobive"
    assert len(data["grids"]) == 2
    main = next(row for row in data["grids"] if row["id"] == "mobive-main-2025")
    py64 = next(row for row in data["grids"] if row["id"] == "mobive-pyrenees-atlantiques-2023")
    assert set(main["departments"]) == {"16", "17", "19", "23", "24", "33", "40", "47", "87"}
    assert py64["departments"] == ["64"]
    main_offers = by_id(main["offers"])
    assert_close(main_offers["mobive-public-ac-le8"]["pricePerKwh"], 0.40)
    assert main_offers["mobive-public-ac-le8"]["durationThresholdMinutes"] == 600
    assert main_offers["mobive-public-ac-le8"]["durationWindow"] == "07:00-22:00"
    assert main_offers["mobive-public-dc-gt60"]["durationThresholdMinutes"] == 30
    assert main_offers["mobive-public-dc-gt60"]["transactionCapEur"] == 90
    assert main_offers["mobive-pass-dc-gt60"]["transactionCapEur"] == 50
    py64_offers = by_id(py64["offers"])
    assert_close(py64_offers["mobive64-public-ac-gt7"]["pricePerKwh"], 0.55)
    assert py64_offers["mobive64-public-ac-gt7"]["durationWindow"] == "07:00-23:00"
    assert py64_offers["mobive64-pass-dc-gt60"]["transactionCapEur"] == 30
    sub = data["subscriptions"][0]
    assert sub["feeEur"] == 18 and sub["feePeriod"] == "year"
    assert sub["defaultSelected"] is False


def test_network_only_invariants():
    for name in (
        "indigo_recharge_direct_tariffs_v1.json",
        "eborn_direct_tariffs_v1.json",
        "mobive_direct_tariffs_v1.json",
    ):
        raw = json.dumps(load(name), ensure_ascii=False).lower()
        assert '"latitude"' not in raw
        assert '"longitude"' not in raw
        assert '"canonicalstationid"' not in raw
        assert '"canonicalpdcid"' not in raw


def main():
    test_indigo()
    test_eborn()
    test_mobive()
    test_network_only_invariants()
    print("OK: Indigo, eborn and Mobive tariff bases validated")


if __name__ == "__main__":
    main()
