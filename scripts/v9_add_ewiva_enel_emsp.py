#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path
from typing import Any

PENALTY_EUR_PER_MIN = {"AC": 0.10, "DC": 0.20, "HPC": 0.30}


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_gz(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


def validated_post_charge_fee(tariff_class: str) -> dict[str, Any]:
    if tariff_class not in PENALTY_EUR_PER_MIN:
        raise ValueError(f"unsupported Ewiva tariff class {tariff_class!r}")
    fee: dict[str, Any] = {
        "eurPerMinute": PENALTY_EUR_PER_MIN[tariff_class],
        "graceMinutes": 0,
    }
    if tariff_class == "AC":
        fee["exemptLocalWindows"] = [{"start": "23:00", "end": "07:00"}]
    return fee


def normalize_pricing(src: dict[str, Any], tariff_class: str) -> tuple[dict[str, Any], dict[str, Any]]:
    pricing = dict(src)
    tz = pricing.pop("timeZone", None)
    # The current Enel tariff PDF independently validates these post-charge fees.
    # Re-assert them at the stable publication boundary so an upstream omission
    # can never silently remove an applicable final-cost component.
    pricing["postChargeFee"] = validated_post_charge_fee(tariff_class)
    metadata = {"timeZone": tz or "Europe/Rome"}
    return pricing, metadata


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidate", required=True)
    ap.add_argument("--offers", default="data/v9/italy-offers.json")
    ap.add_argument("--report", default="data/v9/italy-build-report.json")
    args = ap.parse_args()

    candidate = load_gz(Path(args.candidate))
    offers_path = Path(args.offers)
    offers = load_json(offers_path)
    report_path = Path(args.report)
    report = load_json(report_path)

    subscriptions = offers.get("subscriptionOffers") or []
    emsp = offers.get("emspOffers") or []

    subscriptions = [o for o in subscriptions if not str(o.get("id") or "").startswith("it:subscription:enel_plug_and_go_super:ewiva:")]
    emsp = [o for o in emsp if not str(o.get("id") or "").startswith("it:emsp:enel-on-your-way:ewiva:")]

    added_emsp = 0
    added_super = 0
    classes: dict[str, int] = {}
    for entry in candidate.get("entries") or []:
        eid = str(entry.get("evseId") or "").strip()
        cls = str(entry.get("tariffClass") or "").strip()
        basic = entry.get("enelOnYourWayBasic") if isinstance(entry.get("enelOnYourWayBasic"), dict) else None
        if not eid or not basic or basic.get("rankable") is not True:
            continue
        pricing, meta = normalize_pricing(basic.get("pricing") or {}, cls)
        emsp.append({
            "id": f"it:emsp:enel-on-your-way:ewiva:{eid}",
            "provider": "Enel On Your Way",
            "evseIds": [eid],
            "verifiedScope": "exact_evse",
            "countries": ["IT"],
            "currency": "EUR",
            "priority": 100,
            "source": basic.get("source"),
            "sourceId": "italy-verified-offers",
            "pricing": pricing,
            "metadata": {
                **meta,
                "channel": "emsp",
                "network": "Ewiva",
                "billedBy": basic.get("billedBy") or "Enel X S.r.l.",
                "rankableAsCpoDirect": False,
                "tariffClass": cls,
            },
        })
        added_emsp += 1
        classes[cls] = classes.get(cls, 0) + 1

        for sub in entry.get("subscriptions") or []:
            if sub.get("subscriptionId") != "enel_plug_and_go_super" or sub.get("rankableWhenSelected") is not True:
                continue
            spricing, smeta = normalize_pricing(sub.get("pricing") or {}, cls)
            subscriptions.append({
                "id": f"it:subscription:enel_plug_and_go_super:ewiva:{eid}",
                "selectionId": "enel_plug_and_go_super",
                "provider": "Enel On Your Way",
                "evseIds": [eid],
                "verifiedScope": "exact_evse",
                "countries": ["IT"],
                "currency": "EUR",
                "priority": 120,
                "source": sub.get("source"),
                "sourceId": "italy-verified-offers",
                "operatorIds": ["ewiva"],
                "pricing": spricing,
                "monthlyFeeEur": sub.get("monthlyFeeEur"),
                "validThrough": sub.get("validThrough"),
                "metadata": {
                    **smeta,
                    "channel": "subscription",
                    "network": "Ewiva",
                    "tariffClass": cls,
                    "rankableOnlyWhenSelected": True,
                },
            })
            added_super += 1

    expected = int((candidate.get("counts") or {}).get("ewivaEvse") or 0)
    if added_emsp != expected or added_super != expected:
        raise SystemExit(f"Ewiva count mismatch: expected={expected} emsp={added_emsp} super={added_super}")

    for offer in [o for o in emsp if str(o.get("id") or "").startswith("it:emsp:enel-on-your-way:ewiva:")]:
        cls = str((offer.get("metadata") or {}).get("tariffClass") or "")
        fee = (offer.get("pricing") or {}).get("postChargeFee") or {}
        if float(fee.get("eurPerMinute") or 0) != PENALTY_EUR_PER_MIN.get(cls):
            raise SystemExit(f"missing/invalid Ewiva post-charge fee for {offer.get('id')}")

    offers["subscriptionOffers"] = subscriptions
    offers["emspOffers"] = emsp
    policy = offers.setdefault("policy", {})
    policy["ewivaEnelOnYourWayIsEmspNotDirect"] = True
    policy["ewivaExplorerFailClosedPendingHpcReconciliation"] = True
    offers_path.write_text(json.dumps(offers, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")

    report["subscriptionOffers"] = len(subscriptions)
    report["emspOffers"] = len(emsp)
    report["ewivaEnelOnYourWay"] = {
        "stations": (candidate.get("counts") or {}).get("ewivaStations"),
        "evse": expected,
        "basicEmspOffers": added_emsp,
        "plugAndGoSuperOffers": added_super,
        "byTariffClass": classes,
        "postChargeEurPerMin": PENALTY_EUR_PER_MIN,
        "explorerRankable": False,
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report["ewivaEnelOnYourWay"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
