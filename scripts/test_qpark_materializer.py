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
    script = root / "scripts" / "materialize_france_qpark_offers.py"
    source = {
        "schemaVersion": "1.1.1",
        "dataset": "qpark-izivia-tariffs-france",
        "networkId": "qpark",
        "country": "FR",
        "verifiedAt": "2026-09-01",
        "source": "https://www.q-park.fr/fr-fr/produits/bornes-de-recharge/",
        "scope": {
            "physicalInventoryFromIrveOnly": True,
            "qparkIsCommercialHost": True,
            "chargingProvider": "IZIVIA",
            "requirePhysicalOperatorId": "izivia",
            "excludeOtherTechnicalCpos": True,
            "parkingExcludedFromChargingTariff": True,
            "otherMspTariffsRemainSeparate": True,
            "payNowTariffUnresolved": True,
        },
        "subscriptions": [{
            "id": "izivia-pass-access", "provider": "Pass IZIVIA Access",
            "offerType": "access_product", "feeEur": 15, "feePeriod": "one_time",
            "monthlyFeeEur": 0, "defaultSelected": False, "quotaBased": False,
            "rankableWhenSelected": True,
        }],
        "offers": [
            {
                "id": "qpark-izivia-pass-access", "channel": "subscription",
                "provider": "IZIVIA Pass · Q-Park", "subscriptionId": "izivia-pass-access",
                "selectors": {"physicalOperatorIds": ["izivia"]}, "rankable": True,
                "pricingRules": [{"scope": "allDay", "start": "00:00", "end": "24:00", "currency": "EUR", "pricePerKwh": 0.55, "connectionFee": 1.20, "parkingPerMinute": 0}],
            },
            {
                "id": "qpark-izivia-paynow-unresolved", "channel": "reference",
                "provider": "IZIVIA PayNow · Q-Park", "selectors": {"physicalOperatorIds": ["izivia"]},
                "pricingRules": [], "rankable": False,
                "blockedReasons": ["adhoc_paynow_tariff_not_published_on_qpark_source"],
            },
        ],
    }
    stations = [
        {"stationId": "QP1", "tariffNetworkId": "qpark", "physicalOperatorId": "izivia"},
        {"stationId": "QP2", "tariffNetworkId": "qpark", "physicalOperatorId": "electra"},
        {"stationId": "OTHER", "tariffNetworkId": "izivia-fast", "physicalOperatorId": "izivia"},
    ]
    pdcs = [
        {"pdcId": "QP1-A", "stationId": "QP1", "tariffNetworkId": "qpark", "physicalOperatorId": "izivia"},
        {"pdcId": "QP2-A", "stationId": "QP2", "tariffNetworkId": "qpark", "physicalOperatorId": "electra"},
        {"pdcId": "OTHER-A", "stationId": "OTHER", "tariffNetworkId": "izivia-fast", "physicalOperatorId": "izivia"},
    ]
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp); canonical = tmp / "canonical"; out = tmp / "out"; canonical.mkdir()
        source_path = tmp / "source.json"; source_path.write_text(json.dumps(source), encoding="utf-8")
        dump_gz(canonical / "stations.json.gz", stations); dump_gz(canonical / "charge_points.json.gz", pdcs)
        subprocess.run([sys.executable, str(script), "--source", str(source_path), "--canonical-dir", str(canonical), "--out-dir", str(out)], check=True, capture_output=True, text=True)
        offers = json.load(gzip.open(out / "qpark_pdc_offers_contract_v1_1.json.gz", "rt", encoding="utf-8"))
        report = json.loads((out / "qpark_materialization_report.json").read_text(encoding="utf-8"))
        assert len(offers) == 2
        assert {r["canonicalPdcId"] for r in offers} == {"QP1-A"}
        access = next(r for r in offers if r["rankable"])
        paynow = next(r for r in offers if not r["rankable"])
        assert access["channel"] == "subscription" and access["subscriptionId"] == "izivia-pass-access"
        assert access["pricingRules"][0]["pricePerKwh"] == 0.55 and access["pricingRules"][0]["connectionFee"] == 1.20
        assert access["pricingRules"][0]["parkingPerMinute"] == 0
        assert paynow["channel"] == "reference" and paynow["pricingRules"] == []
        s = report["summary"]
        assert s["canonicalQparkPdcCount"] == 2 and s["eligibleIziviaPdcCount"] == 1
        assert s["blockedOtherCpoPdcCount"] == 1 and s["rankableCoveredPdcCount"] == 1
        assert s["physicalInventoryMutationCount"] == 0
    print("Q-Park canonical materializer tests OK")


if __name__ == "__main__":
    main()
