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
    script = root / "scripts" / "materialize_france_lidl_offers.py"
    source = {
        "schemaVersion": "1.0.0",
        "dataset": "operator-direct-lidl-plus-france",
        "generatedAt": "2026-08-19T17:07:02Z",
        "source": "operator_direct",
        "provider": "Lidl Plus",
        "operator": "Lidl",
        "country": "FR",
        "networkScope": {
            "kind": "all_lidl_charging_sites_france",
            "confirmedByOfficialSource": True,
            "stationLevelPriceLookupRequired": False,
        },
        "pricing": [
            {"currentType": "AC", "pricePerKwh": 0.29, "currency": "EUR", "billingUnit": "kWh", "preauthorizationAmountEur": 25, "promotion": False},
            {"currentType": "DC", "pricePerKwh": 0.29, "currency": "EUR", "billingUnit": "kWh", "preauthorizationAmountEur": 40, "promotion": True, "promotionEnd": None, "promotionEndSourceStatus": "not_stated_on_current_official_page"},
        ],
        "sourceEvidence": {"url": "https://www.lidl.fr/c/e-mobilite/s10037236", "officialPage": True, "sameTariffEverywhereFrance": True},
    }
    stations = [
        {"stationId": "LIDL1", "tariffNetworkId": "lidl", "physicalOperatorId": "lidl"},
        {"stationId": "OTHER1", "tariffNetworkId": "other", "physicalOperatorId": "freshmile"},
    ]
    pdcs = [
        {"pdcId": "LIDL1-A", "stationId": "LIDL1", "tariffNetworkId": "lidl", "physicalOperatorId": "lidl", "connectors": {"type2": "true", "comboCcs": "false", "chademo": "false", "ef": "false"}, "powerKw": 22},
        {"pdcId": "LIDL1-D", "stationId": "LIDL1", "tariffNetworkId": "lidl", "physicalOperatorId": "lidl", "connectors": {"type2": "false", "comboCcs": "true", "chademo": "false", "ef": "false"}, "powerKw": 180},
        {"pdcId": "LIDL1-U", "stationId": "LIDL1", "tariffNetworkId": "lidl", "physicalOperatorId": "lidl", "connectors": {}, "powerKw": None},
        {"pdcId": "OTHER1-A", "stationId": "OTHER1", "tariffNetworkId": "other", "physicalOperatorId": "freshmile", "connectors": {"type2": "true"}, "powerKw": 22},
    ]
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        canonical = tmp / "canonical"
        out = tmp / "out"
        canonical.mkdir()
        source_path = tmp / "lidl.json"
        source_path.write_text(json.dumps(source), encoding="utf-8")
        dump_gz(canonical / "stations.json.gz", stations)
        dump_gz(canonical / "charge_points.json.gz", pdcs)
        subprocess.run(
            [sys.executable, str(script), "--source", str(source_path), "--canonical-dir", str(canonical), "--out-dir", str(out)],
            check=True,
            capture_output=True,
            text=True,
        )
        with gzip.open(out / "lidl_pdc_offers_contract_v1_1.json.gz", "rt", encoding="utf-8") as handle:
            offers = json.load(handle)
        report = json.loads((out / "lidl_materialization_report.json").read_text(encoding="utf-8"))
        ids = {row["canonicalPdcId"] for row in offers}
        assert ids == {"LIDL1-A", "LIDL1-D", "LIDL1-U"}, ids
        assert all(row["tariffNetworkId"] == "lidl" for row in offers)
        assert all(row["channel"] == "direct" and row["subscriptionId"] is None for row in offers)
        assert not any(row["canonicalPdcId"] == "OTHER1-A" for row in offers)
        ac = next(row for row in offers if row["canonicalPdcId"] == "LIDL1-A")
        dc = next(row for row in offers if row["canonicalPdcId"] == "LIDL1-D")
        unknown = next(row for row in offers if row["canonicalPdcId"] == "LIDL1-U")
        assert ac["kind"] == "AC" and ac["pricingRules"][0]["pricePerKwh"] == 0.29
        assert dc["kind"] == "DC" and dc["selectors"]["promotion"] is True
        assert unknown["kind"] is None and unknown["selectors"]["currentType"] == "AC_OR_DC_EQUAL_CURRENT_PRICE"
        summary = report["summary"]
        assert summary["canonicalLidlPdcCount"] == 3
        assert summary["rankableCoveredPdcCount"] == 3
        assert summary["unresolvedPdcCount"] == 0
        assert summary["physicalInventoryMutationCount"] == 0
    print("Lidl canonical materializer tests OK")


if __name__ == "__main__":
    main()
