#!/usr/bin/env python3
from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from urllib.request import Request, urlopen

FX_URL = "https://api.frankfurter.app/latest?from=EUR"
USER_AGENT = "TeslaChargeCompanion/3.0"

def main() -> int:
    request = Request(FX_URL, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urlopen(request, timeout=30) as response:
        data = json.loads(response.read().decode("utf-8"))

    out = {
        "base": "EUR",
        "date": data.get("date") or date.today().isoformat(),
        "rates": {"EUR": 1, **data.get("rates", {})},
    }

    data_dir = Path("data")
    (data_dir / "exchange_rates.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    metadata_path = data_dir / "metadata.json"
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        metadata = {}
    metadata["fxUpdated"] = out["date"]
    metadata_path.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
