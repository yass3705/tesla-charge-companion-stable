#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path
from typing import Any


def load_gz(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


def normalize_pricing(raw: dict[str, Any]) -> dict[str, Any]:
    rules = raw.get("rules")
    if raw.get("type") != "rules" or not isinstance(rules, list) or not rules:
        raise RuntimeError("invalid Ewiva rule pricing")
    post_charge = raw.get("postChargeFee")
    if not isinstance(post_charge, dict):
        raise RuntimeError("validated Ewiva post-charge fee missing")
    return {
        "type": "rules",
        "rules": rules,
        "priceSelectionBasis": "session_start_local_time",
        "postChargeFee": post_charge,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ewiva", required=True)
    ap.add_argument("--offers", default="data/v9/italy-offers.json")
    ap.add_argument("--report", default="data/v9/italy-build-report.json")
    args = ap.parse_args()

    ewiva = load_gz(Path(args.ewiva))
    offers_path = Path(args.offers)
    report_path = Path(args.report)
    offers = json.loads(offers_path.read_text(encoding="utf-8"))
    report = json.loads(report_path.read_text(encoding="utf-8"))

    counts = ewiva.get("counts") or {}
    expected = int(counts.get("ewivaEvse") or 0)
    if expected != 1678:
        raise RuntimeError(f"unexpected canonical Ewiva EVSE count {expected}")
    if (ewiva.get("rules") or {}).get("explorerFailClosed") is not True:
        raise RuntimeError("Ewiva Explorer must remain fail-closed")

    existing_emsp = {str(x.get("id")) for x in offers.get("emspOffers", [])}
    existing_sub = {str(x.get("id")) for x in offers.get("subscriptionOffers", [])}
    emsp_added = 0
    super_added = 0
    classes: dict[str, int] = {}

    for entry in ewiva.get("entries", []):
        eid = str(entry.get("evseId") or "").strip()
        cls = str(entry.get("tariffClass") or "").strip()
        if not eid or cls not in {"AC", "DC", "HPC"}:
            raise RuntimeError(f"invalid Ewiva entry {eid} class={cls}")
        classes[cls] = classes.get(cls, 0) + 1

        basic = entry.get("enelOnYourWayBasic") or {}
        if basic.get("channel") != "emsp" or basic.get("notCpoDirect") is not True or basic.get("rankable") is not True:
            raise RuntimeError(f"invalid Ewiva Basic commercial semantics for {eid}")
        raw_pricing = basic.get("pricing") or {}
        oid = f"it:emsp:enel-on-your-way-ewiva:{eid}"
        if oid not in existing_emsp:
            offers.setdefault("emspOffers", []).append({
                "id": oid,
                "provider": "Enel On Your Way",
                "evseIds": [eid],
                "verifiedScope": "exact_evse",
                "countries": ["IT"],
                "currency": "EUR",
                "priority": 100,
                "source": str(basic.get("source") or "validated Enel Ewiva source"),
                "sourceId": "italy-verified-offers",
                "pricing": normalize_pricing(raw_pricing),
                "metadata": {
                    "channel": "emsp",
                    "network": "Ewiva",
                    "operator": "Ewiva",
                    "rankableAsCpoDirect": False,
                    "timeZone": "Europe/Rome",
                    "priceSelectionBasis": "session_start_local_time",
                    "tariffClass": cls,
                    "validatedPostChargeFee": raw_pricing.get("postChargeFee"),
                    "postChargeFeeTemporarilyFailClosed": False,
                },
            })
            existing_emsp.add(oid)
            emsp_added += 1

        subs = entry.get("subscriptions") or []
        if len(subs) != 1 or subs[0].get("subscriptionId") != "enel_plug_and_go_super":
            raise RuntimeError(f"unexpected Ewiva subscriptions for {eid}")
        sub = subs[0]
        sid = f"it:subscription:enel_plug_and_go_super:ewiva:{eid}"
        if sid not in existing_sub:
            sub_pricing = sub.get("pricing") or {}
            offers.setdefault("subscriptionOffers", []).append({
                "id": sid,
                "selectionId": "enel_plug_and_go_super",
                "provider": "Enel On Your Way",
                "evseIds": [eid],
                "verifiedScope": "exact_evse",
                "countries": ["IT"],
                "currency": "EUR",
                "priority": 120,
                "source": str(sub.get("source") or "validated Enel Ewiva source"),
                "sourceId": "italy-verified-offers",
                "operatorIds": ["Ewiva"],
                "pricing": normalize_pricing(sub_pricing),
                "monthlyFeeEur": sub.get("monthlyFeeEur"),
                "validThrough": sub.get("validThrough"),
                "metadata": {
                    "network": "Ewiva",
                    "channel": "subscription",
                    "timeZone": "Europe/Rome",
                    "priceSelectionBasis": "session_start_local_time",
                    "tariffClass": cls,
                    "validatedPostChargeFee": sub_pricing.get("postChargeFee"),
                    "postChargeFeeTemporarilyFailClosed": False,
                    "explorerFailClosed": True,
                },
            })
            existing_sub.add(sid)
            super_added += 1

    if emsp_added != expected or super_added != expected:
        raise RuntimeError(f"unexpected Ewiva additions emsp={emsp_added} super={super_added} expected={expected}")
    if classes != {"AC": 7, "DC": 31, "HPC": 1640}:
        raise RuntimeError(f"unexpected Ewiva tariff classes {classes}")

    if any("ewiva" in str(o.get("id", "")).lower() and o.get("selectionId") == "enel_plug_and_go_explorer" for o in offers.get("subscriptionOffers", [])):
        raise RuntimeError("Explorer must not be published on Ewiva")
    if any(str(o.get("provider")) == "Ewiva" for o in offers.get("directOffers", [])):
        raise RuntimeError("No Ewiva CPO-direct tariff is validated by this layer")

    offers.setdefault("policy", {})["ewivaEnelEmspCommercialSeparation"] = True
    offers["policy"]["ewivaExplorerFailClosed"] = True
    offers["policy"]["sessionStartLockedPostChargeFeesSupported"] = True
    offers_path.write_text(json.dumps(offers, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")

    report["directOffers"] = len(offers.get("directOffers", []))
    report["subscriptionOffers"] = len(offers.get("subscriptionOffers", []))
    report["emspOffers"] = len(offers.get("emspOffers", []))
    report["ewivaEnelEmspOffers"] = emsp_added
    report["ewivaPlugAndGoSuperOffers"] = super_added
    report["ewivaExplorerOffers"] = 0
    report["ewivaTariffClasses"] = classes
    report["ewivaPostChargeFeesPublished"] = expected * 2
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(json.dumps({
        "directOffers": report["directOffers"],
        "subscriptionOffers": report["subscriptionOffers"],
        "emspOffers": report["emspOffers"],
        "ewivaEnelEmspOffers": emsp_added,
        "ewivaPlugAndGoSuperOffers": super_added,
        "ewivaExplorerOffers": 0,
        "ewivaTariffClasses": classes,
        "ewivaPostChargeFeesPublished": report["ewivaPostChargeFeesPublished"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
