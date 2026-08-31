#!/usr/bin/env python3
"""Materialize the official Lidl Plus France tariff on canonical Lidl PDCs.

Safety invariants:
- PAN IRVE remains the only physical inventory.
- Only PDCs whose customer-facing tariffNetworkId is exactly ``lidl`` qualify.
- The official source is network-wide; it never creates a station or PDC.
- Lidl Plus pricing stays distinct from Intercharge/ad-hoc payment pricing.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
from collections import Counter
from pathlib import Path


def clean(value):
    return str(value or "").strip()


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


def truthy(value):
    if isinstance(value, bool):
        return value
    return clean(value).lower() in {"1", "true", "vrai", "yes", "oui", "y", "x"}


def validate_source(data):
    expected = {
        "schemaVersion": "1.0.0",
        "dataset": "operator-direct-lidl-plus-france",
        "source": "operator_direct",
        "provider": "Lidl Plus",
        "operator": "Lidl",
        "country": "FR",
    }
    for key, value in expected.items():
        if data.get(key) != value:
            raise ValueError(f"unexpected Lidl source {key}={data.get(key)!r}")
    scope = data.get("networkScope") or {}
    if scope.get("kind") != "all_lidl_charging_sites_france":
        raise ValueError("Lidl source is not national network scope")
    if scope.get("confirmedByOfficialSource") is not True:
        raise ValueError("Lidl national scope is not confirmed")
    if scope.get("stationLevelPriceLookupRequired") is not False:
        raise ValueError("Lidl source unexpectedly requires station pricing")
    evidence = data.get("sourceEvidence") or {}
    if evidence.get("officialPage") is not True or evidence.get("sameTariffEverywhereFrance") is not True:
        raise ValueError("Lidl official national-price evidence missing")

    pricing = {}
    for row in data.get("pricing") or []:
        kind = clean(row.get("currentType")).upper()
        price = number(row.get("pricePerKwh"))
        if kind not in {"AC", "DC"}:
            raise ValueError(f"unexpected Lidl current type: {kind!r}")
        if clean(row.get("currency")) != "EUR" or clean(row.get("billingUnit")).lower() != "kwh":
            raise ValueError(f"unsupported Lidl billing for {kind}")
        if price is None or price < 0:
            raise ValueError(f"invalid Lidl price for {kind}")
        pricing[kind] = dict(row)
    if set(pricing) != {"AC", "DC"}:
        raise ValueError("Lidl source must expose both AC and DC pricing")
    return pricing


def connector_kinds(pdc):
    connectors = pdc.get("connectors") or {}
    kinds = []
    if truthy(connectors.get("ef")) or truthy(connectors.get("type2")):
        kinds.append("AC")
    if truthy(connectors.get("comboCcs")) or truthy(connectors.get("chademo")):
        kinds.append("DC")
    return kinds


def pricing_rule(kind, source_row):
    promo = source_row.get("promotion") is True
    notes = ["Official Lidl Plus France network tariff."]
    preauth = number(source_row.get("preauthorizationAmountEur"))
    if preauth is not None:
        notes.append(f"Payment preauthorization: {preauth:g} EUR; not included in charging cost.")
    if promo:
        end = clean(source_row.get("promotionEnd"))
        if end:
            notes.append(f"Promotional {kind} price until {end}.")
        else:
            notes.append("Promotional DC price; current official page states no end date.")
    return {
        "scope": "allDay",
        "start": "00:00",
        "end": "24:00",
        "days": None,
        "currency": "EUR",
        "pricePerKwh": number(source_row.get("pricePerKwh")),
        "chargePerMinute": 0,
        "connectionFee": 0,
        "durationPerMinute": 0,
        "durationThresholdMinutes": 0,
        "occupancyPerMinute": 0,
        "occupancyThresholdMinutes": 0,
        "occupancyCap": 0,
        "parkingPerMinute": 0,
        "notes": " ".join(notes),
    }


def offer_for(pdc, station, kind, source_row, source, normalized_at, *, inferred_all_types=False):
    pid = clean(pdc.get("pdcId"))
    sid = clean(pdc.get("stationId"))
    promo = source_row.get("promotion") is True if not inferred_all_types else None
    selector = {
        "networkScope": "all_lidl_charging_sites_france",
        "currentType": kind if not inferred_all_types else "AC_OR_DC_EQUAL_CURRENT_PRICE",
    }
    if promo is not None:
        selector["promotion"] = promo
        if promo:
            selector["promotionEnd"] = source_row.get("promotionEnd")
            selector["promotionEndSourceStatus"] = source_row.get("promotionEndSourceStatus")
    return {
        "offerId": f"lidl-plus:{pid}:{kind.lower() if not inferred_all_types else 'all-current-types'}",
        "physicalOperatorId": pdc.get("physicalOperatorId") or station.get("physicalOperatorId"),
        "tariffNetworkId": "lidl",
        "provider": "Lidl Plus",
        "channel": "direct",
        "sourceMode": "network_rule",
        "sourceStationId": None,
        "sourceEvseId": None,
        "canonicalStationId": sid,
        "canonicalPdcId": pid,
        "matchMethod": "network_scope",
        "matchDistanceMeters": None,
        "selectors": selector,
        "kind": None if inferred_all_types else kind,
        "minPowerKw": None,
        "maxPowerKw": None,
        "pricingRules": [pricing_rule(kind, source_row)],
        "subscriptionId": None,
        "validFrom": source.get("generatedAt"),
        "validTo": source_row.get("promotionEnd") if promo else None,
        "rankable": True,
        "blockedReasons": [],
        "sourceUrl": clean((source.get("sourceEvidence") or {}).get("url")) or "data-lab:lidl_plus_france.json",
        "sourceUpdatedAt": source.get("generatedAt"),
        "normalizedAt": normalized_at,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--canonical-dir", default="build/france_irve_identity")
    parser.add_argument("--out-dir", default="build/france_irve_offers")
    args = parser.parse_args()

    source = load_json(args.source)
    pricing = validate_source(source)
    canonical_dir = Path(args.canonical_dir)
    stations = load_json(canonical_dir / "stations.json.gz")
    pdcs = load_json(canonical_dir / "charge_points.json.gz")
    stations_by_id = {clean(row.get("stationId")): row for row in stations if row.get("stationId")}
    canonical_lidl_stations = {sid for sid, row in stations_by_id.items() if row.get("tariffNetworkId") == "lidl"}
    canonical_lidl_pdcs = [row for row in pdcs if row.get("tariffNetworkId") == "lidl"]

    now = dt.datetime.now(dt.timezone.utc).isoformat()
    offers = []
    counters = Counter()
    unresolved = []
    equal_current_prices = pricing["AC"]["pricePerKwh"] == pricing["DC"]["pricePerKwh"]

    for pdc in canonical_lidl_pdcs:
        pid = clean(pdc.get("pdcId"))
        sid = clean(pdc.get("stationId"))
        station = stations_by_id.get(sid)
        if not station or station.get("tariffNetworkId") != "lidl":
            raise AssertionError(f"Lidl PDC escaped Lidl station scope: {pid}")
        kinds = connector_kinds(pdc)
        if kinds:
            for kind in kinds:
                offers.append(offer_for(pdc, station, kind, pricing[kind], source, now))
                counters[f"offer_{kind.lower()}"] += 1
            if len(kinds) > 1:
                counters["mixed_connector_pdc"] += 1
        elif equal_current_prices:
            # Safe only while official AC and DC marginal charging prices are equal.
            offers.append(offer_for(pdc, station, "AC", pricing["AC"], source, now, inferred_all_types=True))
            counters["offer_unknown_connector_equal_price"] += 1
        else:
            counters["unresolved_connector_type"] += 1
            if len(unresolved) < 100:
                unresolved.append({"pdcId": pid, "stationId": sid, "powerKw": pdc.get("powerKw")})

    offers.sort(key=lambda row: (row["canonicalStationId"], row["canonicalPdcId"], row["offerId"]))
    pdc_ids = {clean(row.get("pdcId")) for row in pdcs if row.get("pdcId")}
    if any(
        row.get("canonicalStationId") not in canonical_lidl_stations
        or row.get("canonicalPdcId") not in pdc_ids
        or row.get("tariffNetworkId") != "lidl"
        or row.get("channel") != "direct"
        for row in offers
    ):
        raise AssertionError("Lidl materializer escaped canonical network scope")

    covered_pdcs = {row["canonicalPdcId"] for row in offers if row.get("rankable")}
    covered_stations = {row["canonicalStationId"] for row in offers if row.get("rankable")}
    report = {
        "schemaVersion": "1.1.1",
        "dataset": "france-lidl-plus-canonical-direct-audit",
        "productionReady": False,
        "summary": {
            "canonicalLidlStationCount": len(canonical_lidl_stations),
            "canonicalLidlPdcCount": len(canonical_lidl_pdcs),
            "materializedOfferCount": len(offers),
            "rankableOfferCount": sum(1 for row in offers if row.get("rankable")),
            "rankableCoveredStationCount": len(covered_stations),
            "rankableCoveredPdcCount": len(covered_pdcs),
            "unresolvedPdcCount": len(canonical_lidl_pdcs) - len(covered_pdcs),
            "physicalInventoryMutationCount": 0,
            "currentAcPriceEurPerKwh": pricing["AC"]["pricePerKwh"],
            "currentDcPriceEurPerKwh": pricing["DC"]["pricePerKwh"],
            "dcPromotion": pricing["DC"].get("promotion") is True,
            "dcPromotionEnd": pricing["DC"].get("promotionEnd"),
            "equalCurrentAcDcPrices": equal_current_prices,
            "counters": dict(counters),
        },
        "unresolvedExamples": unresolved,
    }
    out = Path(args.out_dir)
    dump_json(out / "lidl_pdc_offers_contract_v1_1.json.gz", offers)
    dump_json(out / "lidl_materialization_report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
