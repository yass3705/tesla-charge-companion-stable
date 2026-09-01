#!/usr/bin/env python3
"""Materialize the official IZIVIA Grand Lyon grid on canonical PAN PDCs.

Safety invariants:
- PAN IRVE remains the sole physical inventory.
- Both tariffNetworkId == ``grand-lyon`` and physicalOperatorId == ``izivia``
  are required; other IZIVIA networks never inherit this grid.
- Power must fall in an official class (<=7, <=24, <=50 or >=100 kW).
- Visitor pricing is direct; Standard and Fréquence remain opt-in plans.
- Local-clock day connected-time, night included-energy packages and the 45-minute fast
  duration component are kept as distinct contract semantics.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
from collections import Counter
from pathlib import Path


PROFILES = ("visitor", "standard", "frequency")
NETWORK_ID = "grand-lyon"
PHYSICAL_OPERATOR_ID = "izivia"


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


def require_number(actual, expected, label):
    if number(actual) != float(expected):
        raise ValueError(f"unexpected Grand Lyon {label}: {actual!r}")


def validate_source(data):
    expected = {
        "schemaVersion": "1.1.1",
        "dataset": "grand-lyon-izivia-direct-tariffs-france",
        "networkId": NETWORK_ID,
        "network": "IZIVIA Grand Lyon",
        "operator": "IZIVIA",
        "country": "FR",
    }
    for key, value in expected.items():
        if data.get(key) != value:
            raise ValueError(f"unexpected Grand Lyon source {key}={data.get(key)!r}")

    scope = data.get("scope") or {}
    true_flags = (
        "directNetworkOnly",
        "physicalInventoryFromIrveOnly",
        "subscriberOffersRequireSelection",
        "adHocUsesVisitorTariff",
        "failClosed",
    )
    false_flags = ("stationLevelPriceLookupRequired", "roamingIncluded", "roamingTariffsPromotedToDirect", "monthlyFeesAllocatedToSession")
    if any(scope.get(key) is not True for key in true_flags) or any(scope.get(key) is not False for key in false_flags):
        raise ValueError("Grand Lyon source safety policy changed")
    if scope.get("physicalOperatorRequired") != PHYSICAL_OPERATOR_ID:
        raise ValueError("Grand Lyon physical CPO guard changed")

    evidence = data.get("sourceEvidence") or {}
    expected_evidence = {
        "officialNetworkPage": "https://grandlyon.izivia.com/",
        "officialOffersPage": "https://grandlyon.izivia.com/nos-offres/",
        "officialTariffTableSvg": "https://grandlyon.izivia.com/wp-content/uploads/2024/01/Tarifs-GrandLyon-01-03-2024.svg",
        "officialExtractDataset": "data-lab/operator_direct/izivia_official_france.json",
        "officialExtractFingerprintSha256": "23a65232f7c51c0462321e83e3d10260c4ac8353bd65d50cf40f4df51d3511d4",
    }
    if any(evidence.get(key) != value for key, value in expected_evidence.items()):
        raise ValueError("Grand Lyon official source lock changed")
    if data.get("tariffMatrixExtractedAt") != "2026-09-01" or data.get("officialPageRecheckedAt") != "2026-09-01":
        raise ValueError("Grand Lyon source verification date changed")

    semantics = data.get("billingSemantics") or {}
    expected_semantics = {
        "dayWindow": "08:00-20:00",
        "nightWindow": "20:00-08:00",
        "timeWindowSelection": "elapsed_local_clock",
        "crossWindowPolicy": "apply_each_component_to_its_local_clock_window",
        "daySlowBilling": "linear_connected_minute_within_day_window",
        "nightSlowBilling": "night_connection_package_includes_20_kwh_consumed_within_night_window_then_linear_extra_kwh",
        "fastBilling": "linear_kwh_plus_linear_connected_minute_after_45",
        "separateParkingFee": False,
    }
    if any(semantics.get(key) != value for key, value in expected_semantics.items()):
        raise ValueError("Grand Lyon billing semantics changed")

    bands = {clean(row.get("id")): row for row in data.get("powerBands") or []}
    if set(bands) != {"le7", "le24", "le50", "ge100"}:
        raise ValueError("Grand Lyon power classes changed")
    expected_bands = {
        "le7": (0, None, 7, "AC"),
        "le24": (7, None, 24, "AC"),
        "le50": (24, None, 50, "DC"),
        "ge100": (None, 100, None, "DC"),
    }
    for band_id, (minimum_exclusive, minimum, maximum, kind) in expected_bands.items():
        row = bands[band_id]
        if number(row.get("minPowerKwExclusive")) != minimum_exclusive:
            raise ValueError(f"Grand Lyon lower exclusive bound changed: {band_id}")
        if number(row.get("minPowerKw")) != minimum:
            raise ValueError(f"Grand Lyon lower bound changed: {band_id}")
        if number(row.get("maxPowerKw")) != maximum or row.get("kind") != kind:
            raise ValueError(f"Grand Lyon upper bound/kind changed: {band_id}")

    subscriptions = {clean(row.get("id")): row for row in data.get("subscriptions") or []}
    expected_subscriptions = {
        "izivia-grand-lyon-standard": 5,
        "izivia-grand-lyon-frequency": 20,
    }
    if set(subscriptions) != set(expected_subscriptions):
        raise ValueError("Grand Lyon subscription set changed")
    for sub_id, monthly in expected_subscriptions.items():
        row = subscriptions[sub_id]
        require_number(row.get("monthlyFeeEur"), monthly, f"{sub_id} monthly fee")
        require_number(row.get("initialPassRegistrationEur"), 15, f"{sub_id} registration fee")
        if row.get("defaultSelected") is not False or row.get("quotaBased") is not False or row.get("rankableWhenSelected") is not True:
            raise ValueError(f"Grand Lyon subscription selection policy changed: {sub_id}")

    profiles = {clean(row.get("id")): row for row in data.get("profiles") or []}
    if set(profiles) != set(PROFILES):
        raise ValueError("Grand Lyon customer profiles changed")
    expected_profile_scope = {
        "visitor": ("direct", None),
        "standard": ("subscription", "izivia-grand-lyon-standard"),
        "frequency": ("subscription", "izivia-grand-lyon-frequency"),
    }
    for profile, (channel, subscription_id) in expected_profile_scope.items():
        if profiles[profile].get("channel") != channel or profiles[profile].get("subscriptionId") != subscription_id:
            raise ValueError(f"Grand Lyon profile scope changed: {profile}")

    tariffs = data.get("tariffs") or {}
    day, night = tariffs.get("day") or {}, tariffs.get("night") or {}
    if (day.get("start"), day.get("end"), night.get("start"), night.get("end")) != ("08:00", "20:00", "20:00", "08:00"):
        raise ValueError("Grand Lyon tariff windows changed")
    expected_hourly = {
        "le7": {"visitor": 3.5, "standard": 2.5, "frequency": 1.5},
        "le24": {"visitor": 6, "standard": 5, "frequency": 4},
    }
    expected_packages = {"visitor": 6, "standard": 5, "frequency": 4}
    for band_id, prices in expected_hourly.items():
        for profile, price in prices.items():
            require_number(day.get(band_id, {}).get(f"{profile}EurPerHour"), price, f"{band_id} {profile} day")
            require_number(night.get(band_id, {}).get(f"{profile}ConnectionFeeEur"), expected_packages[profile], f"{band_id} {profile} night")
        require_number(night.get(band_id, {}).get("includedEnergyKwh"), 20, f"{band_id} included energy")
        require_number(night.get(band_id, {}).get("extraEnergyEurPerKwh"), 0.38, f"{band_id} extra energy")
    expected_fast = {
        "le50": {"visitor": 0.45, "standard": 0.40, "frequency": 0.30},
        "ge100": {"visitor": 0.55, "standard": 0.50, "frequency": 0.40},
    }
    for window_name, window in (("day", day), ("night", night)):
        for band_id, prices in expected_fast.items():
            for profile, price in prices.items():
                require_number(window.get(band_id, {}).get(f"{profile}EurPerKwh"), price, f"{band_id} {profile} {window_name}")
            require_number(window.get(band_id, {}).get("durationEurPerMinute"), 0.20, f"{band_id} duration rate")
            require_number(window.get(band_id, {}).get("durationThresholdMinutes"), 45, f"{band_id} duration threshold")
    return bands, profiles, list(subscriptions.values())


def classify_power(value):
    power = number(value)
    if power is None:
        return None, "missing_power"
    if power <= 0:
        return None, "invalid_power"
    if power <= 7:
        return "le7", "official_power_band_le7"
    if power <= 24:
        return "le24", "official_power_band_le24"
    if power <= 50:
        return "le50", "official_power_band_le50"
    if power >= 100:
        return "ge100", "official_power_band_ge100"
    return None, "unpublished_power_gap_50_100"


def blank_rule(**overrides):
    row = {
        "scope": "allDay",
        "start": "00:00",
        "end": "24:00",
        "days": None,
        "currency": "EUR",
        "pricePerKwh": 0,
        "energyBilling": "linear_kwh",
        "includedEnergyKwh": 0,
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
        "occupancyBilling": None,
        "occupancyBlockMinutes": None,
        "occupancyBlockFee": None,
        "occupancyTrigger": None,
        "occupancyDurationBasis": None,
        "missingUnplugTimePolicy": None,
        "parkingPerMinute": 0,
        "totalTransactionCap": None,
        "timeWindowSelection": "elapsed_local_clock",
        "rounding": None,
        "roundingEpsilon": 1e-9,
        "formulaFamily": None,
        "notes": None,
    }
    row.update(overrides)
    return row


def pricing_rules(data, band_id, profile):
    tariffs = data["tariffs"]
    day, night = tariffs["day"], tariffs["night"]
    if band_id in {"le7", "le24"}:
        hourly = number(day[band_id][f"{profile}EurPerHour"])
        package = number(night[band_id][f"{profile}ConnectionFeeEur"])
        return [
            blank_rule(
                scope="timeWindow",
                start=day["start"],
                end=day["end"],
                durationPerMinute=hourly / 60,
                formulaFamily="grand_lyon_day_slow_connected_duration",
                notes="Day price is billed linearly for connected minutes falling inside 08:00-20:00 local time; parking is not a separate fee.",
            ),
            blank_rule(
                scope="timeWindow",
                start=night["start"],
                end=night["end"],
                pricePerKwh=number(night[band_id]["extraEnergyEurPerKwh"]),
                includedEnergyKwh=number(night[band_id]["includedEnergyKwh"]),
                connectionFee=package,
                formulaFamily="grand_lyon_night_slow_included_energy",
                notes="Night connection package includes 20 kWh consumed inside 20:00-08:00 local time; only additional night energy is billed at the extra-energy rate.",
            ),
        ]
    # The official table publishes identical rapid/ultra pricing by day and by
    # night.  One all-day rule preserves the single 45-minute session threshold
    # when a charge crosses 08:00 or 20:00.
    source = day[band_id]
    return [blank_rule(
        pricePerKwh=number(source[f"{profile}EurPerKwh"]),
        durationPerMinute=number(source["durationEurPerMinute"]),
        durationThresholdMinutes=number(source["durationThresholdMinutes"]),
        timeWindowSelection=None,
        formulaFamily="grand_lyon_fast_energy_plus_duration",
        notes="Uniform day/night energy price plus one connected-duration component after 45 session minutes; not a post-charge occupancy fee.",
    )]


def offer_for(pdc, data, band, profile, profile_spec, normalized_at, match_method):
    pid = clean(pdc.get("pdcId"))
    sid = clean(pdc.get("stationId"))
    power = number(pdc.get("powerKw"))
    source_band = next(row for row in data["powerBands"] if row["id"] == band)
    return {
        "offerId": f"grand-lyon:{profile}:{pid}",
        "physicalOperatorId": PHYSICAL_OPERATOR_ID,
        "tariffNetworkId": NETWORK_ID,
        "provider": f"IZIVIA Grand Lyon · {profile_spec.get('label') or profile}",
        "channel": profile_spec["channel"],
        "sourceMode": "network_rule",
        "sourceStationId": None,
        "sourceEvseId": None,
        "canonicalStationId": sid,
        "canonicalPdcId": pid,
        "matchMethod": "network_scope",
        "matchDistanceMeters": None,
        "selectors": {
            "network": "IZIVIA Grand Lyon",
            "customerProfile": profile,
            "powerBand": band,
            "powerBandLabel": source_band.get("label"),
            "canonicalPowerKw": power,
            "powerClassProof": match_method,
            "roamingSeparate": True,
            "subscriptionRequiresSelection": profile != "visitor",
        },
        "kind": source_band.get("kind"),
        "minPowerKw": power,
        "maxPowerKw": power,
        "pricingRules": pricing_rules(data, band, profile),
        "subscriptionId": profile_spec.get("subscriptionId"),
        "validFrom": None,
        "validTo": None,
        "rankable": True,
        "blockedReasons": [],
        "sourceUrl": (data.get("sourceEvidence") or {}).get("officialOffersPage"),
        "sourceUpdatedAt": data.get("officialPageRecheckedAt"),
        "normalizedAt": normalized_at,
    }


def materialize(data, stations, pdcs, normalized_at=None):
    bands, profiles, subscriptions = validate_source(data)
    station_map = {clean(row.get("stationId")): row for row in stations if row.get("stationId")}
    grand_stations = {sid: row for sid, row in station_map.items() if row.get("tariffNetworkId") == NETWORK_ID}
    eligible = [row for row in pdcs if row.get("tariffNetworkId") == NETWORK_ID]
    normalized_at = normalized_at or dt.datetime.now(dt.timezone.utc).isoformat()
    offers = []
    unresolved = []
    counters = Counter()

    def fail(pdc, reason):
        counters[f"unresolved_{reason}"] += 1
        if len(unresolved) < 150:
            unresolved.append({
                "canonicalStationId": clean(pdc.get("stationId")),
                "canonicalPdcId": clean(pdc.get("pdcId")),
                "powerKw": pdc.get("powerKw"),
                "physicalOperatorId": pdc.get("physicalOperatorId"),
                "reason": reason,
            })

    for pdc in eligible:
        sid = clean(pdc.get("stationId"))
        station = grand_stations.get(sid)
        if not station:
            fail(pdc, "canonical_station_scope_mismatch")
            continue
        physical = clean(pdc.get("physicalOperatorId") or station.get("physicalOperatorId"))
        if physical != PHYSICAL_OPERATOR_ID:
            fail(pdc, "physical_cpo_not_izivia")
            continue
        band, method = classify_power(pdc.get("powerKw"))
        if band not in bands:
            fail(pdc, method)
            continue
        counters[f"pdc_band_{band}"] += 1
        for profile in PROFILES:
            offers.append(offer_for(pdc, data, band, profile, profiles[profile], normalized_at, method))
            counters[f"offer_profile_{profile}"] += 1

    offers.sort(key=lambda row: (row["canonicalStationId"], row["canonicalPdcId"], row["offerId"]))
    if len({row["offerId"] for row in offers}) != len(offers):
        raise AssertionError("duplicate Grand Lyon offer id")
    eligible_ids = {clean(row.get("pdcId")) for row in eligible}
    if any(
        row.get("canonicalPdcId") not in eligible_ids
        or row.get("tariffNetworkId") != NETWORK_ID
        or row.get("physicalOperatorId") != PHYSICAL_OPERATOR_ID
        or row.get("rankable") is not True
        for row in offers
    ):
        raise AssertionError("Grand Lyon materializer escaped canonical network/CPO scope")

    covered_pdcs = {row["canonicalPdcId"] for row in offers}
    covered_stations = {row["canonicalStationId"] for row in offers}
    summary = {
        "canonicalGrandLyonStationCount": len(grand_stations),
        "canonicalGrandLyonPdcCount": len(eligible),
        "materializedOfferCount": len(offers),
        "rankableOfferCount": len(offers),
        "directRankableOfferCount": sum(1 for row in offers if row["channel"] == "direct"),
        "subscriptionRankableOfferCount": sum(1 for row in offers if row["channel"] == "subscription"),
        "rankableCoveredStationCount": len(covered_stations),
        "rankableCoveredPdcCount": len(covered_pdcs),
        "unresolvedPdcCount": len(eligible) - len(covered_pdcs),
        "physicalInventoryMutationCount": 0,
        "subscriptionCount": len(subscriptions),
        "counters": dict(counters),
    }
    return offers, subscriptions, summary, unresolved


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="data/grand_lyon_izivia_direct_tariffs_v1.json")
    parser.add_argument("--canonical-dir", default="build/france_irve_identity")
    parser.add_argument("--out-dir", default="build/france_irve_offers")
    args = parser.parse_args()
    data = load_json(args.source)
    canonical = Path(args.canonical_dir)
    offers, subscriptions, summary, unresolved = materialize(
        data,
        load_json(canonical / "stations.json.gz"),
        load_json(canonical / "charge_points.json.gz"),
    )
    out = Path(args.out_dir)
    dump_json(out / "grand_lyon_pdc_offers_contract_v1_1.json.gz", offers)
    dump_json(out / "grand_lyon_subscriptions_contract_v1_1.json", {
        "schemaVersion": "1.1.1",
        "networkId": NETWORK_ID,
        "subscriptions": subscriptions,
    })
    report = {
        "schemaVersion": "1.1.1",
        "dataset": "france-grand-lyon-canonical-audit",
        "productionReady": False,
        "summary": summary,
        "unresolvedExamples": unresolved,
    }
    dump_json(out / "grand_lyon_materialization_report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
