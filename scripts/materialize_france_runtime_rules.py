#!/usr/bin/env python3
"""Materialize already-verified TCC runtime tariff rules into contract v1.1.

This is a migration utility only: it does not create stations or PDCs and it
never turns incomplete evidence into a rankable offer.
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


def window_parts(value):
    text = str(value or "00:00-24:00")
    if "-" not in text:
        return "00:00", "24:00"
    return tuple(text.split("-", 1))


def base_template(network, offer, normalized_at):
    return {
        "offerId": offer["id"],
        "physicalOperatorId": None,
        "tariffNetworkId": network["networkId"],
        "provider": offer.get("label") or offer["id"],
        "channel": offer.get("channel", "direct"),
        "sourceMode": "network_rule",
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
        "pricingRules": [],
        "subscriptionId": offer.get("subscriptionId"),
        "validFrom": None,
        "validTo": None,
        "rankable": True,
        "blockedReasons": [],
        "sourceUrl": network.get("upstream") or network.get("source"),
        "sourceUpdatedAt": network.get("verifiedAt"),
        "normalizedAt": normalized_at,
    }


def simple_rule(pricing, **extra):
    rule = {
        "scope": "allDay",
        "start": "00:00",
        "end": "24:00",
        "days": None,
        "currency": pricing.get("currency", "EUR"),
        "pricePerKwh": pricing.get("pricePerKwh"),
        "chargePerMinute": pricing.get("chargePerMinute", 0),
        "durationPerMinute": pricing.get("durationPerMinute", 0),
        "durationThresholdMinutes": pricing.get("durationThresholdMinutes", 0),
        "durationCap": pricing.get("durationCapEur", 0),
        "connectionFee": pricing.get("connectionFeeEur", 0),
        "occupancyPerMinute": pricing.get("occupancyPerMinute", 0),
        "occupancyThresholdMinutes": pricing.get("occupancyThresholdMinutes", 0),
        "occupancyCap": pricing.get("occupancyCap", 0),
        "parkingPerMinute": pricing.get("parkingPerMinute", 0),
        "notes": None,
    }
    rule.update(extra)
    return rule


def materialize_r3(network, normalized_at):
    out = []
    for offer in network.get("offers", []):
        row = base_template(network, offer, normalized_at)
        row["pricingRules"] = [simple_rule(offer.get("pricing") or {})]
        out.append(row)
    return out


def materialize_stations_e(network, normalized_at):
    out = []
    configs = {row["id"]: row for row in network.get("supportedConfigurations", [])}
    occupancy = {}
    for row in network.get("occupancyRules", []):
        occupancy.setdefault(row["configurationId"], []).append(row)
    subscription_labels = {row["id"]: row.get("label") for row in network.get("subscriptions", [])}

    for offer in network.get("offers", []):
        for config_id, price in (offer.get("pricingByConfiguration") or {}).items():
            cfg = configs.get(config_id) or {}
            clone_offer = dict(offer)
            clone_offer["id"] = f"{offer['id']}:{config_id}"
            clone_offer["label"] = subscription_labels.get(offer.get("subscriptionId")) or offer["id"]
            clone_offer["selectors"] = {"configurationId": config_id, "kind": cfg.get("kind")}
            row = base_template(network, clone_offer, normalized_at)
            target = cfg.get("targetPowerKw")
            tol = cfg.get("toleranceKw", 0)
            if target is not None:
                row["minPowerKw"] = target - tol
                row["maxPowerKw"] = target + tol
                row["selectors"].update({"targetPowerKw": target, "toleranceKw": tol})
            occ_rows = occupancy.get(config_id) or []
            if not occ_rows:
                row["pricingRules"] = [simple_rule({"currency": "EUR", "pricePerKwh": price})]
            else:
                rules = []
                for occ in occ_rows:
                    start, end = window_parts(occ.get("window"))
                    rules.append(simple_rule(
                        {"currency": "EUR", "pricePerKwh": price},
                        scope="allDay" if (start, end) == ("00:00", "24:00") else "timeWindow",
                        start=start,
                        end=end,
                        occupancyPerMinute=occ.get("postChargeEurPerMinute", 0),
                        occupancyThresholdMinutes=occ.get("postChargeGraceMinutes", 0),
                        notes="post-charge occupancy; started kWh remains chargeable" if occ.get("startedKwhCharged") else "post-charge occupancy",
                    ))
                row["pricingRules"] = rules
            out.append(row)
    return out


def materialize_vianeo(network, normalized_at):
    out = []
    subscription_labels = {row["id"]: row.get("label") for row in network.get("subscriptions", [])}
    for offer in network.get("offers", []):
        clone_offer = dict(offer)
        clone_offer["label"] = subscription_labels.get(offer.get("subscriptionId")) or offer["id"]
        row = base_template(network, clone_offer, normalized_at)
        row["pricingRules"] = [simple_rule(offer.get("pricing") or {})]
        if offer.get("preserveDirectLocalFees"):
            row["rankable"] = False
            row["blockedReasons"] = ["requires_materialized_direct_local_fees"]
        out.append(row)
    return out


def materialize_ouest_charge(network, normalized_at):
    out = []
    common = network.get("common") or {}
    classification = network.get("classification") or {}
    for department, classes in (network.get("departments") or {}).items():
        for class_id, pricing in classes.items():
            offer = {
                "id": f"ouest-charge:{department}:{class_id}",
                "label": f"Ouest Charge direct · {department} · {class_id}",
                "channel": "direct",
                "selectors": {"department": department, "siteClass": class_id, **(classification.get(class_id) or {})},
            }
            row = base_template(network, offer, normalized_at)
            duration_start, duration_end = window_parts(pricing.get("durationWindow"))
            duration_rate = common.get("durationSurchargeEurPerMinute", 0) if pricing.get("durationThresholdMinutes") else 0
            row["pricingRules"] = [simple_rule({
                "currency": common.get("currency", "EUR"),
                "pricePerKwh": pricing.get("pricePerKwh"),
                "connectionFeeEur": common.get("connectionFeeEur", 0),
                "durationPerMinute": duration_rate,
                "durationThresholdMinutes": pricing.get("durationThresholdMinutes", 0),
                "durationCapEur": pricing.get("durationCapEur", 0),
            }, durationStart=duration_start, durationEnd=duration_end)]
            out.append(row)
    return out


def materialize_ecocharge(network, normalized_at):
    out = []
    classes = network.get("classification") or {}
    for offer in network.get("offers", []):
        class_id = offer.get("class")
        variants = classes.get(class_id) or [{}]
        for index, selector in enumerate(variants):
            clone_offer = dict(offer)
            clone_offer["id"] = offer["id"] if len(variants) == 1 else f"{offer['id']}:{index+1}"
            clone_offer["label"] = offer["id"]
            clone_offer["selectors"] = {"siteClass": class_id, **selector}
            row = base_template(network, clone_offer, normalized_at)
            row["kind"] = selector.get("kind")
            row["minPowerKw"] = selector.get("minPowerKw")
            row["maxPowerKw"] = selector.get("maxPowerKw")
            duration = offer.get("durationRule") or {}
            start, end = window_parts(duration.get("window"))
            row["pricingRules"] = [simple_rule({
                **(offer.get("pricing") or {}),
                "durationPerMinute": duration.get("eurPerMinute", 0),
                "durationThresholdMinutes": duration.get("afterMinutes", 0),
            }, durationStart=start, durationEnd=end)]
            out.append(row)
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="data/france_runtime_extracted_tariff_rules_v1.json")
    parser.add_argument("--out-dir", default="build/france_irve_offers")
    args = parser.parse_args()

    data = load(args.input)
    normalized_at = dt.datetime.now(dt.timezone.utc).isoformat()
    templates = []
    per_network = {}

    handlers = {
        "r3": materialize_r3,
        "stations-e": materialize_stations_e,
        "engie-vianeo": materialize_vianeo,
        "ouest-charge": materialize_ouest_charge,
        "ecocharge77": materialize_ecocharge,
    }

    for network in data.get("networks", []):
        network_id = network.get("networkId")
        handler = handlers.get(network_id)
        if not handler:
            per_network[network_id or "<unknown>"] = {"status": "unsupported", "templateCount": 0}
            continue
        rows = handler(network, normalized_at)
        templates.extend(rows)
        per_network[network_id] = {
            "status": "materialized",
            "templateCount": len(rows),
            "rankableCount": sum(1 for row in rows if row.get("rankable")),
        }

    out_dir = Path(args.out_dir)
    dump(out_dir / "runtime_rule_templates.json", templates)
    report = {
        "schemaVersion": "1.1.0",
        "generatedAt": normalized_at,
        "productionReady": False,
        "templateCount": len(templates),
        "rankableCount": sum(1 for row in templates if row.get("rankable")),
        "networks": per_network,
    }
    dump(out_dir / "runtime_rule_materialization_report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
