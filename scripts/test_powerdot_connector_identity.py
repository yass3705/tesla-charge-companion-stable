#!/usr/bin/env python3
"""Regression test for scoped Powerdot connector/PDC identity matching."""
from __future__ import annotations

import gzip
import json
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "audit_powerdot_connector_identity.py"


def dump_gzip(path, value):
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        json.dump(value, handle)


with tempfile.TemporaryDirectory() as tmp:
    tmp_path = Path(tmp)
    source_path = tmp_path / "powerdot.json.gz"
    canonical_dir = tmp_path / "canonical"
    out_dir = tmp_path / "out"
    canonical_dir.mkdir()

    scoped_id = "FRPD1ETEST0001"
    dump_gzip(
        source_path,
        {
            "chargers": [{
                "location": {"id": "location-1"},
                "irvePdcIds": [scoped_id],
                "charger": {
                    "connectors": [{
                        "physicalReference": scoped_id,
                        "type": 2,
                        "format": 4,
                        "tariff": {
                            "currencyCode": "EUR",
                            "elements": [{
                                "priceComponents": [{"type": "ENERGY", "pricePerUnit": 0.42}]
                            }],
                        },
                    }],
                },
            }],
        },
    )
    dump_gzip(
        canonical_dir / "charge_points.json.gz",
        [
            {"idPdcItinerance": "2", "stationId": "bad-short-2"},
            {"idPdcItinerance": "4", "stationId": "bad-short-4"},
            {"idPdcItinerance": scoped_id, "stationId": "station-1"},
        ],
    )

    subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--powerdot-gzip", str(source_path),
            "--canonical-dir", str(canonical_dir),
            "--out-dir", str(out_dir),
        ],
        check=True,
    )
    report = json.loads((out_dir / "powerdot_connector_identity_report.json").read_text(encoding="utf-8"))
    summary = report["summary"]
    assert summary["connectorExactUniquePdcCount"] == 1
    assert summary["conflictingCanonicalPdcCount"] == 0
    assert report["connectorExactPdcPayloadPaths"] == {"physicalReference": 1}
    assert report["policy"]["connectorScalarMatchMustBeExplicitlyScoped"] is True

print("Powerdot scoped connector identity regression: OK")
