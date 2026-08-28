#!/usr/bin/env python3
"""Materialize newly researched France network tariff bases to contract v1.1.

Physical stations remain exclusively PAN IRVE-derived. These templates attach
only to an already-resolved `tariffNetworkId`.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def dump(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def normalize_pricing_rules(rules):
    out = []
    for original in rules or []:
        rule = dict(original)
        window = rule.pop("occupancyWindow", None)
        if window and "-" in str(window):
            rule["occupancyStart"], rule["occupancyEnd"] = str(window).split("-", 1)
        out.append(rule)
    return out


def base_row(data, offer, normalized_at):
    blocked = list(offer.get("blockedReasons") or [])
    rankable = bool(offer.get("rankable", True) and not blocked)
    return {
        "offerId": offer["id"],
        "physicalOperatorId": None,
        "tariffNetworkId": data["networkId"],
        "provider": offer.get("provider") or data["networkId"],
        "channel": offer.get("channel", "direct"),
        "sourceMode": "network_rule" if rankable else "reference_only",
        "sourceStationId": None,
        "sourceEvseId": None,
        "canonicalStationId": None,
        "canonicalPdcId": None,
        "matchMethod": "network_scope",
        "matchDistanceMeters": None,
        "selectors": dict(offer.get("selectors") or {}),
        "kind": (offer.get("selectors") or {}).get("kind"),
        "minPowerKw": (offer.get("selectors") or {}).get("minPowerKw"),
        "maxPowerKw": (offer.get("selectors") or {}).get("maxPowerKw"),
        "pricingRules": normalize_pricing_rules(offer.get("pricingRules") or []),
        "subscriptionId": offer.get("subscriptionId"),
        "validFrom": offer.get("validFrom") or data.get("validFrom"),
        "validTo": offer.get("validTo"),
        "rankable": rankable,
        "blockedReasons": blocked,
        "sourceUrl": data.get("source"),
        "sourceUpdatedAt": data.get("verifiedAt"),
        "normalizedAt": normalized_at,
        "note": offer.get("note"),
    }


def materialize_simple(data, normalized_at):
    return [base_row(data, offer, normalized_at) for offer in data.get("offers", [])]


def split_window(value):
    text = str(value or "00:00-24:00")
    if "-" not in text:
        return "00:00", "24:00"
    return tuple(text.split("-", 1))


def materialize_mobive(data, normalized_at):
    result = []
    for grid in data.get("grids", []):
        departments = list(grid.get("departments") or [])
        for offer in grid.get("offers", []):
            start, end = split_window(offer.get("durationWindow"))
            selectors = dict(offer.get("selectors") or {})
            selectors["departments"] = departments
            selectors["tariffGridId"] = grid.get("id")
            item = {
                "id": offer["id"],
                "channel": offer.get("channel", "direct"),
                "subscriptionId": offer.get("subscriptionId"),
                "provider": offer.get("provider"),
                "selectors": selectors,
                "validFrom": grid.get("effectiveFrom"),
                "pricingRules": [{
                    "scope": "allDay",
                    "start": "00:00",
                    "end": "24:00",
                    "days": None,
                    "currency": "EUR",
                    "pricePerKwh": offer.get("pricePerKwh"),
                    "chargePerMinute": 0,
                    "durationPerMinute": offer.get("durationPerMinute", 0),
                    "durationThresholdMinutes": offer.get("durationThresholdMinutes", 0),
                    "durationStart": start,
                    "durationEnd": end,
                    "durationCap": 0,
                    "connectionFee": 0,
                    "occupancyPerMinute": 0,
                    "occupancyThresholdMinutes": 0,
                    "occupancyCap": 0,
                    "parkingPerMinute": 0,
                    "totalTransactionCap": offer.get("transactionCapEur"),
                    "rounding": "started_kwh_and_started_minute",
                    "notes": "Mobive connection-duration surcharge; AC surcharge is inactive outside the stated daytime window."
                }],
                "rankable": True,
            }
            result.append(base_row(data, item, normalized_at))
    return result


def materialize_subscriptions(data, normalized_at):
    out = []
    for sub in data.get("subscriptions") or []:
        item = dict(sub)
        item["tariffNetworkId"] = data["networkId"]
        item["sourceUrl"] = data.get("source")
        item["sourceUpdatedAt"] = data.get("verifiedAt")
        item["normalizedAt"] = normalized_at
        out.append(item)
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--indigo", default="data/indigo_recharge_direct_tariffs_v1.json")
    parser.add_argument("--eborn", default="data/eborn_direct_tariffs_v1.json")
    parser.add_argument("--mobive", default="data/mobive_direct_tariffs_v1.json")
    parser.add_argument("--saemes", default="data/saemes_direct_tariffs_v1.json")
    parser.add_argument("--qpark", default="data/qpark_izivia_tariffs_v1.json")
    parser.add_argument("--passpass", default="data/passpass_electrique_direct_tariffs_v1.json")
    parser.add_argument("--effia", default="data/effia_direct_tariffs_v1.json")
    parser.add_argument("--out-dir", default="build/france_irve_offers")
    args = parser.parse_args()

    normalized_at = dt.datetime.now(dt.timezone.utc).isoformat()
    templates = []
    subscriptions = []
    partner_rules = []
    reports = {}
    for path, handler in [
        (args.indigo, materialize_simple),
        (args.eborn, materialize_simple),
        (args.mobive, materialize_mobive),
        (args.saemes, materialize_simple),
        (args.qpark, materialize_simple),
        (args.passpass, materialize_simple),
        (args.effia, materialize_simple),
    ]:
        data = load(path)
        rows = handler(data, normalized_at)
        sub_rows = materialize_subscriptions(data, normalized_at)
        templates.extend(rows)
        subscriptions.extend(sub_rows)
        if data.get("partnerRoaming"):
            partner_rules.append({
                "tariffNetworkId": data["networkId"],
                "sourceUrl": data.get("source"),
                "sourceUpdatedAt": data.get("verifiedAt"),
                "normalizedAt": normalized_at,
                **dict(data["partnerRoaming"]),
            })
        reports[data["networkId"]] = {
            "source": path,
            "templateCount": len(rows),
            "rankableCount": sum(1 for row in rows if row.get("rankable")),
            "subscriptionCount": len(sub_rows),
            "partnerRuleCount": 1 if data.get("partnerRoaming") else 0,
        }

    out_dir = Path(args.out_dir)
    dump(out_dir / "new_network_rule_templates_v1_1.json", templates)
    dump(out_dir / "new_network_subscriptions_v1_1.json", subscriptions)
    dump(out_dir / "new_network_partner_rules_v1_1.json", partner_rules)
    report = {
        "schemaVersion": "1.1.4",
        "productionReady": False,
        "templateCount": len(templates),
        "rankableCount": sum(1 for row in templates if row.get("rankable")),
        "subscriptionCount": len(subscriptions),
        "partnerRuleCount": len(partner_rules),
        "networks": reports,
    }
    dump(out_dir / "new_network_materialization_report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
