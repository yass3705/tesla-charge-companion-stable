#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path


def clean(value):
    return str(value or "").strip()


def norm(value):
    text = unicodedata.normalize("NFD", clean(value))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def truthy(value):
    return norm(value) in {"true", "vrai", "1", "oui", "yes"}


def number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def load_json(path):
    path = Path(path)
    if path.suffix == ".gz":
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            return json.load(handle)
    return json.loads(path.read_text(encoding="utf-8"))


def dump_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix == ".gz":
        with gzip.open(path, "wt", encoding="utf-8", compresslevel=9) as handle:
            json.dump(value, handle, ensure_ascii=False, separators=(",", ":"))
    else:
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def validate_source(data):
    if data.get("dataset") != "la-borne-bleue-direct-tariffs-france":
        raise ValueError("unexpected La Borne Bleue source")
    if data.get("networkId") != "labornebleue" or data.get("country") != "FR":
        raise ValueError("unexpected La Borne Bleue scope")
    scope = data.get("scope") or {}
    required = {
        "directNetworkOnly": True,
        "physicalInventoryFromIrveOnly": True,
        "requiresExplicitTariffNetworkId": True,
        "partnerRoamingSeparate": True,
        "parkingExcludedFromChargingTariff": True,
        "subscriptionOptIn": True,
        "dcAtOrBelow50KwUnresolved": True,
        "unknownConnectorNeverInheritsDcTariff": True,
    }
    for key, expected in required.items():
        if scope.get(key) != expected:
            raise ValueError(f"invalid La Borne Bleue scope: {key}")
    subscription = data.get("subscription") or {}
    if subscription.get("id") != "labornebleue-annual" or float(subscription.get("annualFeeEur", -1)) != 10.0:
        raise ValueError("invalid La Borne Bleue subscription")
    if subscription.get("rankableWhenSelected") is not True:
        raise ValueError("subscription must be opt-in rankable")
    families = {row.get("id"): row for row in data.get("tariffFamilies") or []}
    expected_ids = {
        "labornebleue-ac-7_4",
        "labornebleue-ac-22",
        "labornebleue-ac-above-22",
        "labornebleue-dc-above-50",
    }
    if set(families) != expected_ids:
        raise ValueError("incomplete La Borne Bleue tariff families")
    if float(families["labornebleue-ac-7_4"]["subscriberNightCapEur"]) != 12.0:
        raise ValueError("invalid 7.4 kW subscriber night cap")
    if float(families["labornebleue-ac-22"]["subscriberNightCapEur"]) != 12.0:
        raise ValueError("invalid 22 kW subscriber night cap")
    dc = families["labornebleue-dc-above-50"]
    if (float(dc["subscriberPricePerKwh"]), float(dc["publicPricePerKwh"])) != (0.45, 0.50):
        raise ValueError("invalid La Borne Bleue DC energy tariff")
    if float(dc["additionalPerHourAfter30Minutes"]) != 12.0 or int(dc["durationThresholdMinutes"]) != 30:
        raise ValueError("invalid La Borne Bleue DC duration tariff")
    return families, subscription


def blank_rule(**overrides):
    row = {
        "scope": "allDay",
        "currency": "EUR",
        "pricePerKwh": 0,
        "chargePerMinute": 0,
        "chargeThresholdMinutes": 0,
        "durationPerMinute": 0,
        "durationThresholdMinutes": 0,
        "durationStart": None,
        "durationEnd": None,
        "durationCap": None,
        "connectionFee": 0,
        "occupancyPerMinute": 0,
        "occupancyThresholdMinutes": 0,
        "occupancyStart": None,
        "occupancyEnd": None,
        "occupancyCap": None,
        "parkingPerMinute": 0,
        "totalTransactionCap": None,
        "rounding": None,
        "days": None,
        "notes": None,
    }
    row.update(overrides)
    return row


def duration_window(hourly, start, end, cap=None, notes=None):
    return blank_rule(
        scope="timeWindow",
        durationPerMinute=float(hourly) / 60.0,
        durationStart=start,
        durationEnd=end,
        durationCap=cap,
        notes=notes,
    )


def duration_all_day(hourly, threshold=0, notes=None):
    return blank_rule(
        durationPerMinute=float(hourly) / 60.0,
        durationThresholdMinutes=int(threshold),
        notes=notes,
    )


def energy_rule(price, notes=None):
    return blank_rule(pricePerKwh=float(price), notes=notes)


def connector_kind(pdc):
    connectors = pdc.get("connectors") or {}
    has_dc = truthy(connectors.get("comboCcs")) or truthy(connectors.get("chademo"))
    has_ac = truthy(connectors.get("type2")) or truthy(connectors.get("ef"))
    if has_dc:
        return "DC"
    if has_ac:
        return "AC"
    return None


def classify(pdc, families):
    power = number(pdc.get("powerKw"))
    kind = connector_kind(pdc)
    if power is None:
        return None, "missing_power"
    if kind == "DC":
        if power > 50.0:
            return families["labornebleue-dc-above-50"], "dc_connector_above_50kw"
        return None, "dc_at_or_below_50kw_unpublished"
    if kind != "AC":
        return None, "unknown_connector_kind"
    if power <= 0:
        return None, "invalid_power"
    if power <= 7.5:
        return families["labornebleue-ac-7_4"], "ac_power_7_4_class"
    if power <= 22.5:
        return families["labornebleue-ac-22"], "ac_power_22_class"
    return families["labornebleue-ac-above-22"], "ac_power_above_22_class"


def pricing_rules(family, subscriber):
    fid = family["id"]
    if fid == "labornebleue-ac-7_4":
        if subscriber:
            return [
                duration_window(family["subscriberDayPerHour"], family["dayStart"], family["dayEnd"], notes="Subscriber daytime charging-session duration price."),
                duration_window(family["subscriberNightPerHour"], family["nightStart"], family["nightEnd"], cap=family["subscriberNightCapEur"], notes="Subscriber night charging-session duration price; official night cap is 12 EUR."),
            ]
        return [
            duration_window(family["publicDayPerHour"], family["dayStart"], family["dayEnd"], notes="Non-subscriber daytime charging-session duration price."),
            duration_window(family["publicNightPerHour"], family["nightStart"], family["nightEnd"], notes="Non-subscriber night charging-session duration price; no subscriber cap is inherited."),
        ]
    if fid == "labornebleue-ac-22":
        if subscriber:
            return [
                duration_window(family["subscriberPerHour"], family["dayStart"], family["dayEnd"], notes="Subscriber daytime charging-session duration price."),
                duration_window(family["subscriberPerHour"], family["nightStart"], family["nightEnd"], cap=family["subscriberNightCapEur"], notes="Subscriber night charging-session duration price; official night cap is 12 EUR."),
            ]
        return [duration_all_day(family["publicPerHour"], notes="Non-subscriber charging-session duration price.")]
    if fid == "labornebleue-ac-above-22":
        hourly = family["subscriberPerHour"] if subscriber else family["publicPerHour"]
        return [duration_all_day(hourly, notes="Charging-session duration price for AC above 22 kVA.")]
    if fid == "labornebleue-dc-above-50":
        price = family["subscriberPricePerKwh"] if subscriber else family["publicPricePerKwh"]
        return [
            energy_rule(price, notes="Energy component for La Borne Bleue DC above 50 kW."),
            duration_all_day(family["additionalPerHourAfter30Minutes"], threshold=family["durationThresholdMinutes"], notes="Additional time component after 30 minutes of the charging session."),
        ]
    raise AssertionError(fid)


def materialize(data, stations, pdcs, normalized_at=None):
    families, subscription = validate_source(data)
    station_map = {clean(row.get("stationId")): row for row in stations if row.get("stationId")}
    eligible_pdcs = [row for row in pdcs if row.get("tariffNetworkId") == "labornebleue"]
    eligible_station_ids = {clean(row.get("stationId")) for row in eligible_pdcs}
    normalized_at = normalized_at or dt.datetime.now(dt.timezone.utc).isoformat()
    offers = []
    unresolved = []
    counters = Counter()
    operators = Counter()

    for pdc in eligible_pdcs:
        pid = clean(pdc.get("pdcId")); sid = clean(pdc.get("stationId")); station = station_map.get(sid) or {}
        family, method = classify(pdc, families)
        counters[f"method_{method}"] += 1
        physical = pdc.get("physicalOperatorId") or station.get("physicalOperatorId")
        operators[clean(physical) or "unknown"] += 1
        if family is None:
            if len(unresolved) < 200:
                unresolved.append({
                    "canonicalStationId": sid,
                    "canonicalPdcId": pid,
                    "powerKw": pdc.get("powerKw"),
                    "connectors": pdc.get("connectors"),
                    "reason": method,
                })
            continue
        counters[f"family_{family['id']}"] += 1
        base = {
            "physicalOperatorId": physical,
            "tariffNetworkId": "labornebleue",
            "sourceStationId": None,
            "sourceEvseId": None,
            "canonicalStationId": sid,
            "canonicalPdcId": pid,
            "matchMethod": "network_scope",
            "matchDistanceMeters": None,
            "selectors": {
                "tariffFamily": family["id"],
                "classProof": method,
                "powerKw": pdc.get("powerKw"),
                "partnerRoamingSeparate": True,
                "parkingExcluded": True,
            },
            "kind": family["kind"],
            "minPowerKw": family.get("minPowerKwExclusive"),
            "maxPowerKw": family.get("maxPowerKw"),
            "validFrom": data.get("validFrom"),
            "validTo": None,
            "sourceUrl": data["sources"]["officialTariffPage"],
            "sourceUpdatedAt": data.get("verifiedAt"),
            "normalizedAt": normalized_at,
        }
        offers.append({
            **base,
            "offerId": f"labornebleue:public:{family['id']}:{pid}",
            "provider": "La Borne Bleue",
            "channel": "direct",
            "sourceMode": "network_rule",
            "selectors": {**base["selectors"], "paymentProfile": "non_subscriber_app_card"},
            "pricingRules": pricing_rules(family, subscriber=False),
            "subscriptionId": None,
            "rankable": True,
            "blockedReasons": [],
        })
        offers.append({
            **base,
            "offerId": f"labornebleue:subscriber:{family['id']}:{pid}",
            "provider": "La Borne Bleue — abonné",
            "channel": "subscription",
            "sourceMode": "network_rule",
            "selectors": {**base["selectors"], "paymentProfile": "labornebleue_subscription", "annualFeeEur": float(subscription["annualFeeEur"])},
            "pricingRules": pricing_rules(family, subscriber=True),
            "subscriptionId": subscription["id"],
            "rankable": True,
            "blockedReasons": [],
        })

    covered = {row["canonicalPdcId"] for row in offers}
    family_counts = {key.removeprefix("family_"): value for key, value in counters.items() if key.startswith("family_")}
    report = {
        "schemaVersion": "1.0.0",
        "dataset": "france-la-borne-bleue-canonical-audit",
        "productionReady": False,
        "summary": {
            "eligibleStationCount": len(eligible_station_ids),
            "eligiblePdcCount": len(eligible_pdcs),
            "coveredPdcCount": len(covered),
            "publicOfferCount": sum(1 for row in offers if row["subscriptionId"] is None),
            "subscriberOfferCount": sum(1 for row in offers if row["subscriptionId"] == subscription["id"]),
            "rankableOfferCount": len(offers),
            "unresolvedPdcCount": len(eligible_pdcs) - len(covered),
            "physicalInventoryMutationCount": 0,
        },
        "familyPdcCounts": dict(sorted(family_counts.items())),
        "physicalOperatorPdcCounts": dict(sorted(operators.items())),
        "counters": dict(sorted(counters.items())),
        "unresolved": unresolved,
    }
    offers.sort(key=lambda row: (row["canonicalStationId"], row["canonicalPdcId"], row["offerId"]))
    return offers, report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="data/la_borne_bleue_direct_tariffs_v1.json")
    parser.add_argument("--canonical-dir", default="build/france_irve_identity")
    parser.add_argument("--out-dir", default="build/france_irve_offers")
    args = parser.parse_args()
    data = load_json(args.source)
    canonical = Path(args.canonical_dir)
    offers, report = materialize(
        data,
        load_json(canonical / "stations.json.gz"),
        load_json(canonical / "charge_points.json.gz"),
    )
    out = Path(args.out_dir)
    dump_json(out / "la_borne_bleue_pdc_offers_contract_v1_1.json.gz", offers)
    dump_json(out / "la_borne_bleue_materialization_report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
