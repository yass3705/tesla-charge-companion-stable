#!/usr/bin/env python3
"""Build the V8 e-Vadea EVSE tariff map from the validated public IRVE inventory.

Conservative rules:
- exact EVSE is the primary mapping key;
- road context must resolve from the published station name/address;
- power must be present;
- any new/unknown context makes the build fail instead of guessing.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import ssl
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

SOURCE = "https://www.data.gouv.fr/api/1/datasets/r/29f5db7c-5148-4353-a78c-25085a119394"
OUT = Path("data/evadea_evse_tariffs_v1.json")
UA = "TeslaChargeCompanion/8.0 e-Vadea public map builder"

MOTORWAY_RE = re.compile(
    r"(?:\bA\s?\d{1,3}\b|\bautoroute\b|\baire\s+(?:de|d['’])|"
    r"\baires?\s+de\s+service\b|\baires?\s+de\s+repos\b|\bp[eé]age\b)",
    re.I,
)
OFFROAD_RE = re.compile(
    r"(?:\brue\b|\bavenue\b|\bboulevard\b|\broute\s+de\b|\bchemin\b|"
    r"\bparking\b|\bcentre\b|\bzone\b|\bzac\b|\bza\b|\bplace\b)",
    re.I,
)


def fetch() -> bytes:
    req = urllib.request.Request(
        SOURCE,
        headers={"User-Agent": UA, "Accept": "text/csv,*/*;q=0.8", "Cache-Control": "no-cache"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=45, context=ssl.create_default_context()) as r:
        return r.read(4_000_000)


def clean_header(value: str) -> str:
    return str(value or "").strip().lower().lstrip("\ufeff")


def pick(row: dict[str, str], *names: str) -> str:
    lower = {clean_header(k): (v or "").strip() for k, v in row.items()}
    for name in names:
        value = lower.get(clean_header(name), "")
        if value:
            return value
    return ""


def number(value: str) -> float | None:
    m = re.search(r"\d+(?:[.,]\d+)?", str(value or ""))
    return float(m.group(0).replace(",", ".")) if m else None


def truthy(value: str) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "vrai", "oui", "yes"}


def context_for(name: str, address: str) -> str:
    text = f"{name} {address}"
    if MOTORWAY_RE.search(text):
        return "motorway"
    if OFFROAD_RE.search(text):
        return "off_motorway"
    return "unknown"


def tariff(context: str, power_kw: float) -> tuple[float, float]:
    """Return (EUR/kWh, EUR per started 15-minute occupancy block)."""
    if context == "motorway":
        return (0.48 if power_kw < 100 else 0.62, 6.00)
    if context == "off_motorway":
        price = 0.40 if power_kw < 30 else (0.48 if power_kw < 60 else 0.58)
        block_fee = 0.50 if power_kw < 30 else 5.00
        return price, block_fee
    raise ValueError(f"unknown road context: {context}")


def kind_hint(row: dict[str, str]) -> str:
    dc = truthy(pick(row, "prise_type_combo_ccs")) or truthy(pick(row, "prise_type_chademo"))
    ac = truthy(pick(row, "prise_type_2")) or truthy(pick(row, "prise_type_ef"))
    if dc and not ac:
        return "DC"
    if ac and not dc:
        return "AC"
    return ""


def main() -> None:
    raw = fetch()
    text = raw.decode("utf-8-sig", errors="strict")
    rows = list(csv.DictReader(io.StringIO(text), delimiter=";"))
    if not rows:
        raise SystemExit("e-Vadea inventory is empty")

    evses: dict[str, dict] = {}
    contexts: Counter[str] = Counter()
    station_ids: set[str] = set()

    for row in rows:
        station_id = pick(row, "id_station_itinerance", "id_station_local")
        station_name = pick(row, "nom_station", "nom_enseigne")
        address = pick(row, "adresse_station")
        evse_id = pick(row, "id_pdc_itinerance", "id_pdc_local").upper().replace("*", "")
        power_kw = number(pick(row, "puissance_nominale"))
        context = context_for(station_name, address)

        if not station_name or not address or not evse_id or power_kw is None or power_kw <= 0:
            raise SystemExit(f"incomplete published row: station={station_name!r} evse={evse_id!r} power={power_kw!r}")
        if not re.fullmatch(r"FREVAE[A-Z0-9]+", evse_id):
            raise SystemExit(f"unexpected e-Vadea EVSE id: {evse_id}")
        if context == "unknown":
            raise SystemExit(f"road context unresolved for {evse_id}: {station_name} / {address}")
        if evse_id in evses:
            raise SystemExit(f"duplicate EVSE id: {evse_id}")

        price, occupancy_block_fee = tariff(context, power_kw)
        contexts[context] += 1
        if station_id:
            station_ids.add(station_id)

        evses[evse_id] = {
            "stationId": station_id,
            "stationName": station_name,
            "address": address,
            "powerKw": power_kw,
            "kindHint": kind_hint(row),
            "context": context,
            "pricePerKwhEur": price,
            "energyBilling": {"startedKwhCharged": True},
            "occupancy": {
                "trigger": "connected_without_energy",
                "graceMinutes": 5,
                "startedBlockMinutes": 15,
                "blockFeeEur": occupancy_block_fee,
            },
        }

    # The current inventory was independently validated in Data Lab before integration.
    # Fail closed if the upstream file changes until the new rows are reviewed.
    expected = {"rows": 331, "motorway": 325, "off_motorway": 6}
    actual = {
        "rows": len(rows),
        "motorway": contexts["motorway"],
        "off_motorway": contexts["off_motorway"],
    }
    if actual != expected:
        raise SystemExit(f"validated inventory fingerprint changed: expected={expected}, actual={actual}")

    payload = {
        "schemaVersion": "1.0.0",
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "operator": "e-Vadea",
        "country": "FR",
        "source": SOURCE,
        "sourceSha256": hashlib.sha256(raw).hexdigest(),
        "validatedInventory": {
            "rowCount": len(rows),
            "uniqueEvseCount": len(evses),
            "uniqueStationCount": len(station_ids),
            "contextCounts": dict(sorted(contexts.items())),
            "rankableOnlyWhenMapped": True,
            "addressPowerFallbackRequiresExactNormalizedAddress": True,
        },
        "tariffGrid": {
            "motorway": {"lt100Kw": 0.48, "gte100Kw": 0.62},
            "offMotorway": {"lt30Kw": 0.40, "gte30Lt60Kw": 0.48, "gte60Kw": 0.58},
            "occupancy": {
                "graceMinutes": 5,
                "startedBlockMinutes": 15,
                "motorwayBlockFeeEur": 6.00,
                "offMotorwayLt30KwBlockFeeEur": 0.50,
                "offMotorwayGte30KwBlockFeeEur": 5.00,
            },
            "startedKwhCharged": True,
        },
        "evses": dict(sorted(evses.items())),
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"e-Vadea map built: {len(evses)} EVSE / "
        f"{contexts['motorway']} motorway / {contexts['off_motorway']} off-motorway"
    )


if __name__ == "__main__":
    main()
