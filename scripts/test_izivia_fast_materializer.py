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
    script = root / "scripts" / "materialize_france_izivia_fast_offers.py"
    source = {
        "schemaVersion": "1.0.0",
        "dataset": "izivia-fast-direct-france-v1",
        "generatedAt": "2026-08-27",
        "source": {"networkPage": "https://izivia.com/installation-bornes-de-recharge/izivia-bornes-recharge-ultra-rapide-mcdonalds-france"},
        "scope": {
            "countryCode": "FR",
            "network": "IZIVIA FAST",
            "host": "McDonald's France",
            "operator": "IZIVIA",
            "onlyDirectCpo": True,
            "roamingIncluded": False,
            "subscriptionDiscountsIncluded": False,
            "failClosed": True,
        },
        "matching": {"dcOnly": True},
        "tariff": {
            "currency": "EUR",
            "billing": "kwh",
            "windows": [
                {"start": "00:00", "end": "11:30", "pricePerKwh": 0.30, "label": "Happy Hour"},
                {"start": "11:30", "end": "15:00", "pricePerKwh": 0.35, "label": "Standard"},
                {"start": "15:00", "end": "18:00", "pricePerKwh": 0.30, "label": "Happy Hour"},
                {"start": "18:00", "end": "24:00", "pricePerKwh": 0.35, "label": "Standard"},
            ],
        },
    }
    stations = [
        {"stationId": "F1", "tariffNetworkId": "izivia-fast", "physicalOperatorId": "izivia"},
        {"stationId": "O1", "tariffNetworkId": "izivia-express", "physicalOperatorId": "izivia"},
    ]
    pdcs = [
        {"pdcId": "F1-150", "stationId": "F1", "tariffNetworkId": "izivia-fast", "physicalOperatorId": "izivia", "powerKw": 150, "connectors": {}},
        {"pdcId": "F1-22", "stationId": "F1", "tariffNetworkId": "izivia-fast", "physicalOperatorId": "izivia", "powerKw": 22, "connectors": {"type2": True}},
        {"pdcId": "O1-150", "stationId": "O1", "tariffNetworkId": "izivia-express", "physicalOperatorId": "izivia", "powerKw": 150, "connectors": {"comboCcs": True}},
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
        with gzip.open(out / "izivia_fast_pdc_offers_contract_v1_1.json.gz", "rt", encoding="utf-8") as handle:
            offers = json.load(handle)
        report = json.loads((out / "izivia_fast_materialization_report.json").read_text(encoding="utf-8"))
        assert len(offers) == 1
        row = offers[0]
        assert row["canonicalPdcId"] == "F1-150"
        assert row["tariffNetworkId"] == "izivia-fast"
        assert row["rankable"] is True
        assert row["selectors"]["dcEvidence"] == "fast_network_high_power_inference"
        assert [r["pricePerKwh"] for r in row["pricingRules"]] == [0.30, 0.35, 0.30, 0.35]
        assert not any(r["canonicalPdcId"] == "O1-150" for r in offers)
        summary = report["summary"]
        assert summary["canonicalIziviaFastPdcCount"] == 2
        assert summary["rankableCoveredPdcCount"] == 1
        assert summary["unresolvedPdcCount"] == 1
        assert summary["physicalInventoryMutationCount"] == 0
    print("IZIVIA FAST canonical materializer tests OK")


if __name__ == "__main__":
    main()
