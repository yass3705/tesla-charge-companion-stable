#!/usr/bin/env python3
"""Build a TCC-oriented coverage audit from the local REVE locations snapshot.

This script performs no network request. It only measures fields actually present
in the incrementally collected REVE snapshot so missing commercial/status data is
never inferred.
"""

from __future__ import annotations

import gzip
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DATA_DIR = Path("data/spain_reve")
SNAPSHOT = DATA_DIR / "reve_locations_raw.json.gz"
METADATA = DATA_DIR / "metadata.json"
OUTPUT = DATA_DIR / "coverage.json"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def present(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict, tuple, set)):
        return bool(value)
    return True


def metric(count: int, total: int) -> dict[str, Any]:
    return {
        "count": count,
        "total": total,
        "pct": round((count / total) * 100, 2) if total else 0.0,
    }


def has_any(obj: dict[str, Any], keys: tuple[str, ...]) -> bool:
    return any(present(obj.get(key)) for key in keys)


def main() -> int:
    if not SNAPSHOT.exists():
        print("No REVE snapshot yet; coverage audit skipped.")
        return 0

    with gzip.open(SNAPSHOT, "rt", encoding="utf-8") as f:
        snapshot = json.load(f)
    metadata = {}
    if METADATA.exists():
        metadata = json.loads(METADATA.read_text(encoding="utf-8"))

    raw_locations = snapshot.get("locations", {})
    locations = list(raw_locations.values()) if isinstance(raw_locations, dict) else list(raw_locations or [])

    loc_total = len(locations)
    loc_coords = loc_address = loc_cpo = loc_evses = 0
    evse_total = evse_id = evse_status = 0
    connector_total = connector_standard = connector_format = connector_power_type = 0
    connector_power = connector_voltage = connector_amperage = connector_tariff = 0
    cpos: dict[tuple[str, str], dict[str, Any]] = defaultdict(lambda: {"locations": 0, "evses": 0, "connectors": 0})

    for loc in locations:
        if not isinstance(loc, dict):
            continue
        coords = loc.get("coordinates")
        if isinstance(coords, dict) and present(coords.get("latitude")) and present(coords.get("longitude")):
            loc_coords += 1
        if present(loc.get("address")) and present(loc.get("city")):
            loc_address += 1
        party_id = str(loc.get("party_id") or "").strip()
        cpo_name = str(loc.get("cpo_name") or "").strip()
        if party_id or cpo_name:
            loc_cpo += 1
        key = (party_id, cpo_name)
        cpos[key]["locations"] += 1

        evses = loc.get("evses") or []
        if isinstance(evses, list) and evses:
            loc_evses += 1
        for evse in evses if isinstance(evses, list) else []:
            if not isinstance(evse, dict):
                continue
            evse_total += 1
            cpos[key]["evses"] += 1
            if has_any(evse, ("evse_id", "id")):
                evse_id += 1
            if has_any(evse, ("status", "operational_status")):
                evse_status += 1

            connectors = evse.get("connectors") or []
            for connector in connectors if isinstance(connectors, list) else []:
                if not isinstance(connector, dict):
                    continue
                connector_total += 1
                cpos[key]["connectors"] += 1
                connector_standard += int(present(connector.get("standard")))
                connector_format += int(present(connector.get("format")))
                connector_power_type += int(present(connector.get("power_type")))
                connector_power += int(present(connector.get("max_electric_power")))
                connector_voltage += int(present(connector.get("max_voltage")))
                connector_amperage += int(present(connector.get("max_amperage")))
                connector_tariff += int(has_any(connector, ("tariff_id", "tariff_ids", "tariffs", "tariff")))

    registry_total = metadata.get("registryTotalCount") or snapshot.get("registryTotalCount")
    try:
        registry_total = int(registry_total) if registry_total is not None else None
    except (TypeError, ValueError):
        registry_total = None

    cpo_items = [
        {
            "partyId": party_id or None,
            "cpoName": cpo_name or None,
            **counts,
        }
        for (party_id, cpo_name), counts in sorted(cpos.items(), key=lambda x: ((x[0][1] or "").lower(), x[0][0]))
    ]

    report = {
        "schemaVersion": 1,
        "country": "ES",
        "source": "REVE",
        "generatedAt": utc_now(),
        "integrationStatus": "PRE_INTEGRATION_ONLY",
        "snapshot": {
            "locationsStored": loc_total,
            "registryTotalCount": registry_total,
            "registryCoveragePct": round((loc_total / registry_total) * 100, 2) if registry_total else None,
            "totalPages": metadata.get("totalPages"),
            "nextPage": metadata.get("nextPage"),
            "complete": bool(metadata.get("complete")),
        },
        "locations": {
            "coordinates": metric(loc_coords, loc_total),
            "addressAndCity": metric(loc_address, loc_total),
            "cpoIdentity": metric(loc_cpo, loc_total),
            "withEvses": metric(loc_evses, loc_total),
        },
        "evses": {
            "total": evse_total,
            "identifier": metric(evse_id, evse_total),
            "embeddedStatus": metric(evse_status, evse_total),
        },
        "connectors": {
            "total": connector_total,
            "standard": metric(connector_standard, connector_total),
            "format": metric(connector_format, connector_total),
            "powerType": metric(connector_power_type, connector_total),
            "maxElectricPower": metric(connector_power, connector_total),
            "maxVoltage": metric(connector_voltage, connector_total),
            "maxAmperage": metric(connector_amperage, connector_total),
            "embeddedTariffReference": metric(connector_tariff, connector_total),
        },
        "tariffs": {
            "connectorTariffEndpointCollected": False,
            "note": "Dedicated /connectors/tariffs collection is audited separately; no tariff is inferred from missing location fields.",
        },
        "cpos": {
            "distinct": len(cpo_items),
            "items": cpo_items,
        },
    }

    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report["snapshot"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
