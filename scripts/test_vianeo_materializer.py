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
    script = root / "scripts" / "materialize_france_vianeo_offers.py"
    source = {
        "schemaVersion": "1.0.0",
        "dataset": "engie-vianeo-official-france",
        "generatedAt": "2026-08-19T21:44:00Z",
        "operator": "ENGIE Vianeo",
        "country": "FR",
        "classification": {
            "stationLevelPriceLookupRequiredForExactSimulation": True,
            "nationalSubscriptionTariffExists": True,
        },
        "operatorDirect": {
            "vianeoMax": {
                "classification": "operator_direct_subscription",
                "monthlyFeeEur": 9.99,
                "eurPerKwh": 0.33,
                "allVianeoPassengerVehicleStationsFrance": True,
                "appOnly": True,
                "dailyEnergyCapKwh": 200,
                "excludesHeavyGoodsDedicatedPoints": True,
                "stationMinuteFeesCanStillApply": True,
            }
        },
    }
    stations = [
        {"stationId": "V1", "tariffNetworkId": "engie-vianeo", "physicalOperatorId": "engie-vianeo"},
        {"stationId": "O1", "tariffNetworkId": "other", "physicalOperatorId": "other"},
    ]
    pdcs = [
        {"pdcId": "V1-A", "stationId": "V1", "tariffNetworkId": "engie-vianeo", "physicalOperatorId": "engie-vianeo", "powerKw": 300},
        {"pdcId": "O1-A", "stationId": "O1", "tariffNetworkId": "other", "physicalOperatorId": "other", "powerKw": 22},
    ]
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        canonical = tmp / "canonical"
        out = tmp / "out"
        canonical.mkdir()
        src = tmp / "vianeo.json"
        src.write_text(json.dumps(source), encoding="utf-8")
        dump_gz(canonical / "stations.json.gz", stations)
        dump_gz(canonical / "charge_points.json.gz", pdcs)
        subprocess.run(
            [sys.executable, str(script), "--source", str(src), "--canonical-dir", str(canonical), "--out-dir", str(out)],
            check=True,
            capture_output=True,
            text=True,
        )
        with gzip.open(out / "vianeo_pdc_offers_contract_v1_1.json.gz", "rt", encoding="utf-8") as handle:
            offers = json.load(handle)
        report = json.loads((out / "vianeo_materialization_report.json").read_text(encoding="utf-8"))
        assert len(offers) == 1
        row = offers[0]
        assert row["canonicalPdcId"] == "V1-A"
        assert row["tariffNetworkId"] == "engie-vianeo"
        assert row["channel"] == "subscription"
        assert row["subscriptionId"] == "vianeo-max"
        assert row["pricingRules"][0]["pricePerKwh"] == 0.33
        assert row["rankable"] is False
        assert "station_specific_minute_fee_unresolved" in row["blockedReasons"]
        assert not any(r["canonicalPdcId"] == "O1-A" for r in offers)
        summary = report["summary"]
        assert summary["canonicalVianeoPdcCount"] == 1
        assert summary["referenceCoveredPdcCount"] == 1
        assert summary["rankableOfferCount"] == 0
        assert summary["physicalInventoryMutationCount"] == 0
    print("Vianeo canonical materializer tests OK")


if __name__ == "__main__":
    main()
