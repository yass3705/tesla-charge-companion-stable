#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "passpass_electrique_direct_tariffs_v1.json"


def close(actual, expected):
    assert abs(float(actual) - float(expected)) < 1e-9, (actual, expected)


def main():
    data = json.loads(DATA.read_text(encoding="utf-8"))
    assert data["networkId"] == "passpass"
    assert data["validFrom"] == "2025-04-01"
    assert data["scope"]["billingContinuesWhileConnected"] is True
    assert data["scope"]["monthlySubscriberCapsRemovedSince"] == "2025-04-01"
    offers = {row["id"]: row for row in data["offers"]}

    normal_public = offers["passpass-public-normal"]
    assert normal_public["selectors"]["siteClass"] == "normal"
    day, night = normal_public["pricingRules"]
    close(day["pricePerKwh"], 0.38)
    close(day["durationPerMinute"], 0.08)
    close(night["durationPerMinute"], 0.02)
    assert day["durationThresholdMinutes"] == 180

    normal_sub = offers["passpass-account-normal"]
    day, night = normal_sub["pricingRules"]
    close(day["pricePerKwh"], 0.32)
    close(day["durationPerMinute"], 0.04)
    close(night["durationPerMinute"], 0.01)
    close(night["durationCap"], 1.20)

    rapid_public = offers["passpass-public-rapid"]["pricingRules"][0]
    rapid_sub = offers["passpass-account-rapid"]["pricingRules"][0]
    close(rapid_public["pricePerKwh"], 0.51)
    close(rapid_public["durationPerMinute"], 0.40)
    assert rapid_public["durationThresholdMinutes"] == 90
    close(rapid_sub["pricePerKwh"], 0.44)
    close(rapid_sub["durationPerMinute"], 0.20)

    ultra_public = offers["passpass-public-ultra"]["pricingRules"][0]
    ultra_sub = offers["passpass-account-ultra"]["pricingRules"][0]
    assert ultra_public["durationThresholdMinutes"] == 45
    assert ultra_sub["durationThresholdMinutes"] == 45

    long_public = offers["passpass-public-long-stay"]["pricingRules"][0]
    long_sub = offers["passpass-account-long-stay"]["pricingRules"][0]
    assert long_public["durationThresholdMinutes"] == 840
    close(long_public["durationPerMinute"] * 60, 0.20)
    close(long_sub["durationPerMinute"] * 60, 0.10)

    subscription = data["subscriptions"][0]
    assert subscription["id"] == "passpass-electrique-account"
    assert subscription["defaultSelected"] is False
    assert subscription["rankableWhenSelected"] is True
    assert data["classification"]["long_stay"]["requiresExplicitSiteTag"] is True

    print("OK: Pass Pass électrique tariffs validated")


if __name__ == "__main__":
    main()
