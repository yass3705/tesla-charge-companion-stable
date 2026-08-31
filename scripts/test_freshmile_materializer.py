#!/usr/bin/env python3
"""Safety tests for the canonical Freshmile direct materializer."""
import gzip
import json
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCRIPT = ROOT / "materialize_france_freshmile_offers.py"


def dump_gz(path, value):
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        json.dump(value, handle)


def config(evse, price=0.39):
    return {
        "freshmileDirect": True,
        "freshmileVerified": True,
        "freshmileStrictExact": True,
        "offerType": "operator_direct",
        "kind": "DC",
        "powerKw": 150,
        "stalls": 1,
        "freshmileEvseIds": [evse],
        "pricing": {"freshmileExact": {"currency": "EUR", "energy": {"amount": price, "billing": "linear_kwh"}}},
    }


def main():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        canonical = tmp / "canonical"
        out = tmp / "out"
        canonical.mkdir()
        out.mkdir()
        dump_gz(canonical / "stations.json.gz", [
            {"stationId":"FRFMP1","idStationItinerance":"FR*FM*S1","physicalOperatorId":"freshmile","tariffNetworkId":"freshmile","latitude":48.0,"longitude":2.0},
            {"stationId":"FRA11P1","idStationItinerance":"FR*A11*S1","physicalOperatorId":"freshmile","tariffNetworkId":"reseau-a11","latitude":48.1,"longitude":2.1},
        ])
        dump_gz(canonical / "charge_points.json.gz", [
            {"pdcId":"FRFME1","idPdcItinerance":"FR*FM*E1","stationId":"FRFMP1","physicalOperatorId":"freshmile","tariffNetworkId":"freshmile"},
            {"pdcId":"FRA11E1","idPdcItinerance":"FR*A11*E1","stationId":"FRA11P1","physicalOperatorId":"freshmile","tariffNetworkId":"reseau-a11"},
        ])
        source = tmp / "freshmile.json.gz"
        dump_gz(source, {
            "schemaVersion":"1.0.0", "dataset":"freshmile-direct-tcc-v8-france",
            "scope":{"countryCode":"FR","onlyDirectCpo":True,"onlyStrictTccExact":True,"roamingIncluded":False,"configuredRegionalNetworksIncluded":False,"preferentialTariffsIncluded":False},
            "counts":{"strictPublishedStations":2},
            "stations":[
                {"stationId":"FRFR0001","latitude":48.0,"longitude":2.0,"configurations":[config("FR*FM*E1")]},
                {"stationId":"FRFR0002","latitude":48.1,"longitude":2.1,"configurations":[config("FR*A11*E1")]},
            ],
        })
        subprocess.run(["python", str(SCRIPT), "--freshmile-gzip", str(source), "--canonical-dir", str(canonical), "--out-dir", str(out)], check=True, capture_output=True, text=True)
        with gzip.open(out / "freshmile_station_offers_contract_v1_1.json.gz", "rt", encoding="utf-8") as handle:
            offers = json.load(handle)
        report = json.loads((out / "freshmile_materialization_report.json").read_text(encoding="utf-8"))
        assert len(offers) == 1, offers
        assert offers[0]["canonicalStationId"] == "FRFMP1"
        assert offers[0]["canonicalPdcId"] == "FRFME1"
        assert offers[0]["tariffNetworkId"] == "freshmile"
        assert offers[0]["matchMethod"] == "exact_source_evse"
        assert offers[0]["rankable"] is True
        assert all(row["canonicalStationId"] != "FRA11P1" for row in offers)
        assert report["summary"]["physicalInventoryMutationCount"] == 0
        assert report["summary"]["counters"]["non_freshmile_pdc_hits"] == 1
        print("Freshmile canonical materializer tests OK")


if __name__ == "__main__":
    main()
