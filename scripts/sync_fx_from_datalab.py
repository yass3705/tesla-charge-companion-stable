#!/usr/bin/env python3
"""Mirror Data Lab's validated FX output for the historical Stable site."""

import argparse
import hashlib
import json
import math
import re
from pathlib import Path

SUPPORTED = (
    "EUR", "CHF", "GBP", "NOK", "SEK", "DKK", "PLN",
    "CZK", "HUF", "RON", "BGN", "MAD", "DZD", "TND",
)


def validate(payload):
    required = {"base", "date", "providerDate", "checkedAt", "source", "rates"}
    if not isinstance(payload, dict) or required - payload.keys():
        raise ValueError("Data Lab FX payload is incomplete")
    if payload["base"] != "EUR" or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(payload["date"])):
        raise ValueError("Data Lab FX base or date is invalid")
    rates = payload["rates"]
    if not isinstance(rates, dict) or set(rates) != set(SUPPORTED) or rates["EUR"] != 1:
        raise ValueError("Data Lab FX currency coverage is invalid")
    if any(not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) or v <= 0 for v in rates.values()):
        raise ValueError("Data Lab FX contains an invalid rate")


def mirror(source, data_dir, data_lab_sha):
    if not re.fullmatch(r"[0-9a-f]{40}", data_lab_sha):
        raise ValueError("Data Lab commit is not immutable")
    raw = source.read_bytes()
    payload = json.loads(raw)
    validate(payload)
    target = data_dir / "exchange_rates.json"
    if target.exists():
        previous = json.loads(target.read_text(encoding="utf-8"))
        if str(payload["date"]) < str(previous.get("date", "")):
            raise ValueError("Data Lab FX provider date regressed; preserving Stable last-good")
    metadata_path = data_dir / "metadata.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8")) if metadata_path.exists() else {}
    metadata.update({
        "version": "7.1.0",
        "fxUpdated": payload["date"],
        "fxCheckedAt": payload["checkedAt"],
        "fxSource": payload["source"],
        "fxDataLabSha": data_lab_sha,
    })
    provenance = {
        "schemaVersion": 1,
        "dataLabSha": data_lab_sha,
        "sourcePath": "data/fx/exchange_rates.json",
        "sourceSha256": hashlib.sha256(raw).hexdigest(),
        "providerDate": payload["date"],
    }
    data_dir.mkdir(parents=True, exist_ok=True)
    target.write_bytes(raw)
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (data_dir / "fx-datalab-provenance.json").write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
    return provenance


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--data-lab-sha", required=True)
    args = parser.parse_args()
    print(json.dumps(mirror(args.source, args.data_dir, args.data_lab_sha)))


if __name__ == "__main__":
    main()
