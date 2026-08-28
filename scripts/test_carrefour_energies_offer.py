#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


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

    print("OK: Carrefour Energies 22 kW tariff and loyalty benefits validated")


if __name__ == "__main__":
    main()
