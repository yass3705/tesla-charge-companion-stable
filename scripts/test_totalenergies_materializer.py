#!/usr/bin/env python3
from __future__ import annotations

import gzip
import json
import subprocess
import sys
import tempfile
from pathlib import Path


def dump_gz(path, value):
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        json.dump(value, handle)


def main():
    root = Path(__file__).resolve().parents[1]
    script = root / "scripts" / "materialize_france_totalenergies_offers.py"
    source = {
        "dataset": "totalenergies-france-v9-official-review",
        "reviewedAt": "2026-08-31",
        "country": "FR",
        "classification": {
            "singleNationalExactCpoTariff": False,
            "stationLevelPriceRequiredForExactSimulation": True,
            "chargePlusIsEmspNotCpoDirect": True,
        },
        "stationServiceFrance": {
            "upToAndIncluding50Kw": {"minEurPerKwh": 0.52, "maxEurPerKwh": 0.55},
            "over50Kw": {"minEurPerKwh": 0.62, "maxEurPerKwh": 0.65},
            "occupationFee": {"eurPerMin": 0.5, "startsAfterConsecutiveConnectedMinutes": 45},
            "sessionFeeEur": 0,
            "local059Exceptions": [
                {"name": "A", "eurPerKwh": 0.59}, {"name": "B", "eurPerKwh": 0.59},
                {"name": "C", "eurPerKwh": 0.59}, {"name": "D", "eurPerKwh": 0.59},
                {"name": "E", "eurPerKwh": 0.59}, {"name": "F", "eurPerKwh": 0.59}
            ],
            "source": "https://services.totalenergies.fr/example",
        },
        "chargePlusZen": {
            "classification": "subscription_emsp_discount",
            "monthlyFeeEur": 3.9,
            "discountPercent": 15,
            "discountAppliesTo": "public kWh price",
            "minimumPowerKw": 50,
            "brandScope": "TotalEnergies",
            "geography": "France metropolitan excluding Corsica",
            "excludedOperatorCodes": ["FRHXW"],
            "excludedOperatorLabel": "Hexawatt",
            "exactEligibleStationIdentityRequired": True,
            "underlyingPublicPriceRequired": True,
            "source": "https://chargingservices.totalenergies.com/example",
        },
    }
    stations = [
        {"stationId": "T1", "tariffNetworkId": "totalenergies", "physicalOperatorId": "totalenergies"},
        {"stationId": "O1", "tariffNetworkId": "other", "physicalOperatorId": "other"},
    ]
    pdcs = [
        {"pdcId": "T1-50", "stationId": "T1", "tariffNetworkId": "totalenergies", "physicalOperatorId": "totalenergies", "powerKw": 50},
        {"pdcId": "T1-150", "stationId": "T1", "tariffNetworkId": "totalenergies", "physicalOperatorId": "totalenergies", "powerKw": 150},
        {"pdcId": "O1-150", "stationId": "O1", "tariffNetworkId": "other", "physicalOperatorId": "other", "powerKw": 150},
    ]
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        canonical = tmp / "canonical"
        out = tmp / "out"
        canonical.mkdir()
        src = tmp / "source.json"
        src.write_text(json.dumps(source), encoding="utf-8")
        dump_gz(canonical / "stations.json.gz", stations)
        dump_gz(canonical / "charge_points.json.gz", pdcs)
        subprocess.run(
            [sys.executable, str(script), "--source", str(src), "--canonical-dir", str(canonical), "--out-dir", str(out)],
            check=True,
            capture_output=True,
            text=True,
        )
        with gzip.open(out / "totalenergies_pdc_offers_contract_v1_1.json.gz", "rt", encoding="utf-8") as handle:
            offers = json.load(handle)
        report = json.loads((out / "totalenergies_materialization_report.json").read_text(encoding="utf-8"))

        direct = [r for r in offers if r["channel"] == "direct"]
        zen = [r for r in offers if r["subscriptionId"] == "totalenergies-charge-plus-zen"]
        assert len(direct) == 2
        assert len(zen) == 2
        assert all(r["rankable"] is False for r in offers)
        assert not any(r["canonicalPdcId"] == "O1-150" for r in offers)
        by_pdc = {r["canonicalPdcId"]: r for r in direct}
        assert by_pdc["T1-50"]["pricingRules"][0]["pricePerKwh"] is None
        assert by_pdc["T1-50"]["selectors"]["publishedPriceMinEurPerKwh"] == 0.52
        assert by_pdc["T1-50"]["selectors"]["publishedPriceMaxEurPerKwh"] == 0.55
        assert by_pdc["T1-150"]["pricingRules"][0]["pricePerKwh"] is None
        assert by_pdc["T1-150"]["selectors"]["publishedPriceMinEurPerKwh"] == 0.62
        assert by_pdc["T1-150"]["selectors"]["publishedPriceMaxEurPerKwh"] == 0.65
        assert by_pdc["T1-150"]["pricingRules"][0]["occupancyPerMinute"] == 0.5
        assert by_pdc["T1-150"]["pricingRules"][0]["occupancyThresholdMinutes"] == 45
        assert all("exact_kwh_price_station_specific" in r["blockedReasons"] for r in direct)
        assert all(r["subscriptionDiscountPercent"] == 15 for r in zen)
        assert all(r["pricingRules"] == [] for r in zen)
        assert all("FRHXW" in r["selectors"]["excludedOperatorCodes"] for r in zen)
        assert all("hexawatt_frhxw_exclusion_must_be_enforced" in r["blockedReasons"] for r in zen)
        assert report["summary"]["stationServiceUpTo50PublishedRangeEurPerKwh"] == [0.52, 0.55]
        assert report["summary"]["stationServiceOver50PublishedRangeEurPerKwh"] == [0.62, 0.65]
        assert report["summary"]["stationService059ExceptionCount"] == 6
        assert report["summary"]["zenFlatPricePerKwh"] is None
        assert report["summary"]["physicalInventoryMutationCount"] == 0
        assert report["summary"]["rankableOfferCount"] == 0
    print("TotalEnergies canonical materializer tests OK")


if __name__ == "__main__":
    main()
