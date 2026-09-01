#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from build_carrefour_eligible_22kw_offers import (
    equivalent_station_alias,
    match_participant,
    parse_participants,
)


def load(name):
    return json.loads((ROOT / "data" / name).read_text(encoding="utf-8"))


def main():
    offer = load("carrefour_energies_22kw_offer_v1.json")
    benefits = load("carrefour_energies_benefits_v1.json")

    assert offer["tariffNetworkId"] == "carrefour-energies"
    assert offer["validFrom"] == "2026-08-01"
    assert offer["policy"]["stationSpecificEligibilityRequired"] is True
    assert offer["policy"]["eligibleSiteMustMatchUniqueIrveStation"] is True
    assert offer["policy"]["only22KwChargePoints"] is True
    assert offer["policy"]["targetPowerKw"] == 22
    assert set(offer["policy"]["eligibleTechnicalOperators"].values()) == {"allego", "powerdot"}
    assert abs(float(offer["offer"]["pricePerKwh"]) - 0.23) < 1e-9
    assert offer["offer"]["connectionFee"] == 0

    assert benefits["tariffNetworkId"] == "carrefour-energies"
    rows = {row["id"]: row for row in benefits["benefits"]}
    assert rows["carrefour-club-10pct-cashback"]["cashbackPercent"] == 10
    assert rows["carrefour-pass-15pct-cashback"]["cashbackPercent"] == 15
    daily = rows["carrefour-pass-first-hour-22kw-full-cashback"]
    assert daily["cashbackPercent"] == 100
    assert daily["scope"]["firstMinutes"] == 60
    assert daily["scope"]["maxUsesPerDay"] == 1
    assert all(row["rankableAsChargingPrice"] is False for row in rows.values())

    participants, ignored = parse_participants(
        "Carrefour Chalon Sud HM AllegoCarrefour Chalons en Champagne HM Allego\n"
        "Carrefour Alès (30) New Carrefour Powerdot\n",
        offer["policy"]["eligibleTechnicalOperators"],
    )
    assert [row["siteLabel"] for row in participants] == [
        "Carrefour Chalon Sud",
        "Carrefour Chalons en Champagne",
        "Carrefour Alès (30)",
    ]
    assert [row["physicalOperatorId"] for row in participants] == [
        "allego", "allego", "powerdot",
    ]
    assert ignored == []

    participant = {"siteLabel": "Carrefour Testville", "physicalOperatorId": "allego", "department": None}
    primary = {
        "stationId": "FRALLPTEST",
        "name": "TESTVILLE",
        "brand": "Carrefour Energies",
        "address": "Carrefour Testville",
        "physicalOperatorId": "allego",
        "latitude": 48.0,
        "longitude": 2.0,
    }
    alias = {
        **primary,
        "stationId": "FREVCPTEST",
        "name": "Carrefour Energies - Testville",
        "latitude": 48.0001,
    }
    signatures = {"FRALLPTEST": ("123456",), "FREVCPTEST": ("123456",)}
    assert equivalent_station_alias(primary, alias, signatures, 250) is True
    matched = match_participant(participant, [primary, alias], signatures)
    assert matched["status"] == "matched"
    assert matched["matchMethod"] == "unique_exact_pdc_tail_alias_cluster"
    assert len(matched["aliasEquivalentStationIds"]) == 1

    signatures["FREVCPTEST"] = ("654321",)
    assert equivalent_station_alias(primary, alias, signatures, 250) is False
    assert match_participant(participant, [primary, alias], signatures)["status"] == "ambiguous"

    print("OK: Carrefour Energies 22 kW tariff and loyalty benefits validated")


if __name__ == "__main__":
    main()
