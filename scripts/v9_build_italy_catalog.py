#!/usr/bin/env python3
"""Convert the validated Italy V9 consolidated candidate into browser-ready V9 data.

Input is the data-lab Italy consolidation artifact. Output deliberately separates:
- PUN physical inventory/status -> tiled national compact catalogue
- validated direct/subscription/eMSP prices -> exact-EVSE offer payload

PUN tariff values are not promoted here because their consumer semantics are not
validated. Tesla precedence remains handled by the normal V9 source engine.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def finite(value: Any) -> float | None:
    try:
        n = float(value)
        return n if math.isfinite(n) else None
    except (TypeError, ValueError):
        return None


def write_gz_json(path: Path, payload: Any) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = (json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
    data = gzip.compress(raw, compresslevel=9, mtime=0)
    path.write_bytes(data)
    return hashlib.sha256(data).hexdigest()


def access_rows(opening: Any) -> list[list[Any]]:
    if not isinstance(opening, dict):
        return []
    if opening.get("twentyfourseven") is True or opening.get("twentyFourSeven") is True:
        return [[d, "00:00", "24:00"] for d in range(7)]
    regular = opening.get("regular_hours") or opening.get("regularHours") or []
    out: list[list[Any]] = []
    for row in regular if isinstance(regular, list) else []:
        if not isinstance(row, dict):
            continue
        weekday = row.get("weekday")
        try:
            weekday = int(weekday)
        except (TypeError, ValueError):
            continue
        # OCPI weekdays are 1=Monday..7=Sunday; JS Date is 0=Sunday..6=Saturday.
        day = weekday % 7 if 1 <= weekday <= 7 else weekday
        if not 0 <= day <= 6:
            continue
        begin = str(row.get("period_begin") or row.get("periodBegin") or "").strip()
        end = str(row.get("period_end") or row.get("periodEnd") or "").strip()
        if begin and end:
            out.append([day, begin, end])
    return out


def connector_kind(evse: dict[str, Any]) -> str:
    connectors = evse.get("connectors") or []
    for c in connectors:
        if "DC" in str((c or {}).get("powerType") or "").upper():
            return "DC"
    power = finite(evse.get("maxPowerKw"))
    return "DC" if power is not None and power > 22 else "AC"


def station_row(station: dict[str, Any], generated_at: str) -> list[Any] | None:
    coords = station.get("coordinates") or []
    if not isinstance(coords, list) or len(coords) < 2:
        return None
    lat, lon = finite(coords[0]), finite(coords[1])
    if lat is None or lon is None:
        return None
    station_id = str(station.get("stationId") or station.get("stationKey") or "").strip()
    if not station_id:
        return None
    operator = str(station.get("operator") or "PUN").strip()
    configs = []
    for evse in station.get("evses") or []:
        eid = str(evse.get("evseId") or "").strip()
        if not eid:
            continue
        configs.append([
            eid,
            f"{operator} · {eid}",
            connector_kind(evse),
            finite(evse.get("maxPowerKw")) or 0,
            1,
            [],
            [],
        ])
    if not configs:
        return None
    op_state = str(station.get("operationalState") or "unknown").lower()
    status = "OPERATIONAL" if op_state == "operational" else "NON_OPERATIONAL" if op_state == "non_operational" else "UNKNOWN"
    address = str(station.get("address") or "").strip()
    city = str(station.get("city") or "").strip()
    display_address = ", ".join(x for x in [address, city] if x)
    return [
        station_id,
        str(station.get("name") or f"{operator} – {city or station_id}"),
        display_address,
        lat,
        lon,
        operator,
        len(configs),
        access_rows(station.get("openingTimes")),
        configs,
        generated_at,
        status,
        operator,
    ]


def pricing_kwh(rate: float, post_charge: dict[str, Any] | None = None) -> dict[str, Any]:
    pricing: dict[str, Any] = {"type": "kwh", "pricePerKwh": rate}
    if post_charge:
        pricing["postChargeFee"] = post_charge
    return pricing


def post_charge_fee(tariff: dict[str, Any]) -> dict[str, Any] | None:
    rate = finite(tariff.get("occupancyEurPerMin"))
    policy = tariff.get("occupancyPolicy")
    if rate is None or rate <= 0 or not policy:
        return None
    text = json.dumps(policy, ensure_ascii=False).lower() if isinstance(policy, (dict, list)) else str(policy).lower()
    # Fail closed unless policy text clearly describes an idle/post-charge fee.
    if not any(token in text for token in ("idle", "post", "after", "occup", "sosta")):
        return None
    grace = 0
    if isinstance(policy, dict):
        for key in ("graceMinutes", "grace_minutes", "freeMinutes", "free_minutes"):
            if finite(policy.get(key)) is not None:
                grace = max(0, finite(policy.get(key)) or 0)
                break
    return {"eurPerMinute": rate, "graceMinutes": grace}


def exact_offer_common(evse_id: str, provider: str, source: str, priority: int) -> dict[str, Any]:
    return {
        "provider": provider,
        "evseIds": [evse_id],
        "verifiedScope": "exact_evse",
        "countries": ["IT"],
        "currency": "EUR",
        "priority": priority,
        "source": source,
        "sourceId": "italy-verified-offers",
    }


def build_offers(evses: list[dict[str, Any]], payload: dict[str, Any], generated_at: str) -> dict[str, Any]:
    direct, subscriptions, emsp = [], [], []
    for evse in evses:
        eid = str(evse.get("evseId") or "").strip()
        if not eid:
            continue
        d = evse.get("tccV9DirectTariff")
        if evse.get("tccV9RankableDirect") is True and isinstance(d, dict) and finite(d.get("eurPerKwh")) is not None:
            provider = str(d.get("operator") or evse.get("operator") or "Direct operator")
            rate = float(d["eurPerKwh"])
            direct.append({
                "id": f"it:direct:{eid}",
                **exact_offer_common(eid, provider, str(d.get("source") or "validated operator source"), 130),
                "directOperatorOnly": True,
                "pricing": pricing_kwh(rate, post_charge_fee(d)),
                "metadata": {"channel": "operator_direct", "tariffClass": d.get("tariffClass"), "feePolicy": d.get("feePolicy"), "occupancyPolicy": d.get("occupancyPolicy")},
            })
        for s in evse.get("tccV9SubscriptionTariffs") or []:
            if s.get("rankableWhenSelected") is not True or finite(s.get("eurPerKwh")) is None:
                continue
            selection = str(s.get("subscriptionId") or "").strip()
            if not selection:
                continue
            subscriptions.append({
                "id": f"it:subscription:{selection}:{eid}",
                "selectionId": selection,
                **exact_offer_common(eid, str(s.get("provider") or "Atlante"), "validated Italy subscription overlay", 120),
                "operatorIds": [str(s.get("network") or "").strip()],
                "pricing": pricing_kwh(float(s["eurPerKwh"])),
                "monthlyFeeEur": (payload.get("subscriptions") or {}).get(selection, {}).get("monthlyFeeEur"),
                "metadata": {"network": s.get("network"), "channel": "subscription", "mustNotOverwriteDirectTariff": bool(s.get("mustNotOverwriteDirectTariff", True))},
            })
        for m in evse.get("tccV9EmspTariffs") or []:
            if m.get("rankable") is not True or m.get("rankableAsCpoDirect") is not False:
                continue
            prices = m.get("prices") or {}
            energy = finite(prices.get("energyEurPerKwh"))
            time_rate = finite(prices.get("timeEurPerMin")) or 0
            parking_rate = finite(prices.get("parkingEurPerMin")) or 0
            session_fee = finite(prices.get("sessionEur")) or 0
            if energy is None and not time_rate and not parking_rate and not session_fee:
                continue
            rule: dict[str, Any] = {"scope": "allDay", "start": "00:00", "end": "24:00", "currency": "EUR"}
            if energy is not None:
                rule["pricePerKwh"] = energy
            if time_rate or parking_rate:
                rule["connectedTimePerMinuteEur"] = time_rate + parking_rate
            if session_fee:
                rule["connectedTimeComponentEur"] = session_fee
            emsp.append({
                "id": f"it:emsp:{str(m.get('provider') or 'emsp').lower()}:{eid}",
                **exact_offer_common(eid, str(m.get("provider") or "eMSP"), str(m.get("source") or "validated eMSP source"), 90),
                "pricing": {"type": "rules", "rules": [rule]},
                "metadata": {"channel": "emsp", "billedBy": m.get("billedBy"), "restrictions": m.get("restrictions") or {}, "originalPrices": prices, "rankableAsCpoDirect": False},
            })
    return {
        "schemaVersion": 1,
        "country": "IT",
        "generatedAt": generated_at,
        "policy": {
            "precedence": ["direct", "selected_subscription", "emsp", "national_fallback"],
            "exactEvseOnly": True,
            "punFallbackTariffPromoted": False,
            "emspNeverMasqueradesAsDirect": True,
        },
        "directOffers": direct,
        "subscriptionOffers": subscriptions,
        "emspOffers": emsp,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--out-root", default="data/v9/italy-static")
    ap.add_argument("--offers", default="data/v9/italy-offers.json")
    ap.add_argument("--report", default="data/v9/italy-build-report.json")
    args = ap.parse_args()

    with gzip.open(args.input, "rt", encoding="utf-8") as fh:
        src = json.load(fh)
    if src.get("country") != "IT" or src.get("backbone") != "GSE PUN":
        raise SystemExit("unexpected Italy consolidated candidate")
    generated_at = str(src.get("generatedAt") or now_iso())
    rows = [r for s in src.get("stations") or [] if (r := station_row(s, generated_at)) is not None]
    if len(rows) < 25000:
        raise SystemExit(f"Italy catalogue unexpectedly small: {len(rows)}")

    root = Path(args.out_root)
    root.mkdir(parents=True, exist_ok=True)
    all_sha = write_gz_json(root / "all.json.gz", rows)
    grouped: dict[tuple[int, int], list[list[Any]]] = defaultdict(list)
    for row in rows:
        grouped[(math.floor(float(row[3])), math.floor(float(row[4])))].append(row)
    tiles = []
    for (ilat, ilon), tile_rows in sorted(grouped.items()):
        name = f"tile_{ilat}_{ilon}.json.gz"
        sha = write_gz_json(root / name, tile_rows)
        lats = [float(r[3]) for r in tile_rows]
        lons = [float(r[4]) for r in tile_rows]
        tiles.append({"file": name, "count": len(tile_rows), "minLat": min(lats), "maxLat": max(lats), "minLon": min(lons), "maxLon": max(lons), "sha256": sha})
    manifest = {"schemaVersion": 4, "country": "IT", "generatedAt": generated_at, "allFile": "all.json.gz", "allSha256": all_sha, "stationCount": len(rows), "tiles": tiles}
    (root / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    offers = build_offers(src.get("evses") or [], src, generated_at)
    Path(args.offers).write_text(json.dumps(offers, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    report = {
        "generatedAt": generated_at,
        "stations": len(rows),
        "tiles": len(tiles),
        "directOffers": len(offers["directOffers"]),
        "subscriptionOffers": len(offers["subscriptionOffers"]),
        "emspOffers": len(offers["emspOffers"]),
        "sourceCounts": src.get("counts") or {},
    }
    Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
