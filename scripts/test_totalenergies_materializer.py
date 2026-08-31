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
        "dataset": "totalenergies-official-france",
        "generatedAt": "2026-08-19T21:19:17Z",
        "country": "FR",
        "classification": {"singleNationalOperatorTariff": False},
        "operatorDirect": {
            "stationServiceFrance": {
                "effectiveSince": "2025-03-05",
                "upToAndIncluding50KwEurPerKwh": 0.52,
                "over50KwEurPerKwh": 0.62,
                "sessionFeeEur": 0,
                "occupationFee": {"eurPerMin": 0.5, "startsAfterConsecutiveConnectedMinutes": 45},
            }
        },
        "mobilityProvider": {
            "chargePlus": {
                "classification": "eMSP_roaming",
                "operatorDirect": False,
                "zen": {
                    "monthlyFeeEur": 3.9,
                    "discountPercent": 15,
                    "discountAppliesTo": "public kWh price",
                    "eligibleOperatorBrand": "TotalEnergies",
                    "minimumPowerKw": 50,
                    "geography": "France metropolitan, excluding Corsica",
                },
            }
        },
        "zenEligibleInventory": {"stationLevelEligibilityListAvailable": True},
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
        assert by_pdc["T1-50"]["pricingRules"][0]["pricePerKwh"] == 0.52
        assert by_pdc["T1-150"]["pricingRules"][0]["pricePerKwh"] == 0.62
        assert by_pdc["T1-150"]["pricingRules"][0]["occupancyPerMinute"] == 0.5
        assert by_pdc["T1-150"]["pricingRules"][0]["occupancyThresholdMinutes"] == 45
        assert all(r["subscriptionDiscountPercent"] == 15 for r in zen)
        assert all("pricePerKwh" not in r or r.get("pricePerKwh") is None for r in zen)
        assert all(r["pricingRules"] == [] for r in zen)
        assert report["summary"]["zenFlatPricePerKwh"] is None
        assert report["summary"]["physicalInventoryMutationCount"] == 0
        assert report["summary"]["rankableOfferCount"] == 0
    print("TotalEnergies canonical materializer tests OK")


if __name__ == "__main__":
    main()
