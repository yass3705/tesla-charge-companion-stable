#!/usr/bin/env python3
from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from urllib.request import Request, urlopen

SUPPORTED = (
    "EUR", "CHF", "GBP", "NOK", "SEK", "DKK", "PLN",
    "CZK", "HUF", "RON", "BGN", "MAD", "DZD", "TND",
)
PRIMARY_URL = "https://open.er-api.com/v6/latest/EUR"
FALLBACK_URL = "https://api.frankfurter.app/latest?from=EUR"
USER_AGENT = "TeslaChargeCompanion/7.0"

def fetch_json(url: str) -> dict:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))

def read_previous(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {"rates": {"EUR": 1}}

def filter_rates(raw: dict) -> dict[str, float]:
    rates = {"EUR": 1.0}
    for code in SUPPORTED:
        value = raw.get(code)
        if code == "EUR":
            continue
        if isinstance(value, (int, float)) and value > 0:
            rates[code] = float(value)
    return rates

def main() -> int:
    data_dir = Path("data")
    data_dir.mkdir(parents=True, exist_ok=True)
    rates_path = data_dir / "exchange_rates.json"
    previous = read_previous(rates_path)
    previous_rates = filter_rates(previous.get("rates", {}))

    source = ""
    remote_date = None
    fresh_rates: dict[str, float] = {}

    try:
        data = fetch_json(PRIMARY_URL)
        if data.get("result") not in (None, "success"):
            raise RuntimeError(data.get("error-type") or "Réponse primaire invalide")
        fresh_rates = filter_rates(data.get("rates", {}))
        remote_date = data.get("time_last_update_utc") or data.get("time_last_update_unix")
        source = "open.er-api.com"
    except Exception as primary_error:
        data = fetch_json(FALLBACK_URL)
        fresh_rates = filter_rates(data.get("rates", {}))
        remote_date = data.get("date")
        source = f"frankfurter.app (secours; primaire indisponible: {type(primary_error).__name__})"

    merged = {**previous_rates, **fresh_rates, "EUR": 1.0}
    missing = [code for code in SUPPORTED if code not in merged]
    if missing:
        raise RuntimeError("Taux manquants sans valeur précédente : " + ", ".join(missing))

    out = {
        "base": "EUR",
        "date": date.today().isoformat(),
        "providerDate": remote_date,
        "source": source,
        "rates": {code: merged[code] for code in SUPPORTED},
    }
    rates_path.write_text(
        json.dumps(out, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    metadata_path = data_dir / "metadata.json"
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        metadata = {}
    metadata["fxUpdated"] = out["date"]
    metadata["fxSource"] = source
    metadata_path.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"{len(out['rates'])} devises enregistrées via {source}.")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
