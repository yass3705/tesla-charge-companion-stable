#!/usr/bin/env python3
"""Materialize locked IZIVIA Express V8 formulas on canonical PAN PDCs.

The V8 source is station/configuration specific.  It is never converted to a
national IZIVIA rule.  A rankable V9-contract offer requires all of:

- the canonical PAN tariff network is exactly ``izivia-express``;
- the PDC itinerance id exists in the official inventory locked with V8;
- the PDC still belongs to the same official station;
- that station exposes one unambiguous exact V8 formula.

PAN remains the sole physical inventory.  Changed, new, unpublished or
ambiguous rows are reported and fail closed.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import hashlib
import json
from collections import Counter
from pathlib import Path


POWER_TOLERANCE_KW = 2.1
ROUNDING_EPSILON = 1e-9


def clean(value):
    return str(value or "").strip()


def number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def truthy(value):
    if isinstance(value, bool):
        return value
    return clean(value).lower() in {"1", "true", "vrai", "yes", "oui", "y", "x"}


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


def file_sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_lock(lock, v8_path, inventory_path):
    if lock.get("dataset") != "izivia-express-direct-v8-source-lock" or lock.get("schemaVersion") != "1.0.0":
        raise ValueError("unexpected IZIVIA Express source lock")
    policy = lock.get("policy") or {}
    required_policy = {
        "directCpoOnly": True,
        "roamingExcluded": True,
        "subscriptionsExcluded": True,
        "exactPdcIdentityRequired": True,
        "panRemainsPhysicalInventory": True,
        "unknownOrChangedPdcFailsClosed": True,
        "productionReady": False,
    }
    for key, expected in required_policy.items():
        if policy.get(key) is not expected:
            raise ValueError(f"invalid IZIVIA Express lock policy: {key}")
    files = lock.get("files") or {}
    checks = (
        ("v8Tariffs", v8_path),
        ("officialInventory", inventory_path),
    )
    for key, path in checks:
        expected = clean((files.get(key) or {}).get("sha256"))
        actual = file_sha256(path)
        if not expected or actual != expected:
            raise ValueError(f"IZIVIA Express locked source checksum mismatch for {key}: {actual}")


def validate_energy(component):
    if not isinstance(component, dict):
        raise ValueError("missing IZIVIA Express energy component")
    if component.get("billing") not in {"started_kwh", "linear_kwh"}:
        raise ValueError("unsupported IZIVIA Express energy billing")
    rate = number(component.get("ratePerKwhEur"))
    if rate is None or rate < 0:
        raise ValueError("invalid IZIVIA Express energy rate")


def validate_post_charge(component, required=False):
    if component is None:
        if required:
            raise ValueError("missing IZIVIA Express post-charge component")
        return
    billing = component.get("billing")
    if billing == "started_block":
        minutes = number(component.get("blockMinutes"))
        fee = number(component.get("blockFeeEur"))
        if minutes is None or minutes <= 0 or fee is None or fee < 0:
            raise ValueError("invalid IZIVIA Express post-charge block")
        return
    if billing not in {"started_minute", "linear_minute"}:
        raise ValueError("unsupported IZIVIA Express post-charge billing")
    rate = number(component.get("ratePerMinuteEur"))
    if rate is None or rate < 0:
        raise ValueError("invalid IZIVIA Express post-charge rate")


def validate_exact_formula(exact):
    if not isinstance(exact, dict) or exact.get("currency") != "EUR":
        raise ValueError("invalid IZIVIA Express exact formula")
    family = exact.get("family")
    if family == "session_cap":
        validate_energy(exact.get("energy"))
        validate_post_charge(exact.get("postCharge"), required=True)
        cap = number(exact.get("sessionCapEur"))
        if cap is None or cap <= 0:
            raise ValueError("invalid IZIVIA Express session cap")
        return family
    if family == "simple_postcharge":
        validate_energy(exact.get("energy"))
        validate_post_charge(exact.get("postCharge"), required=True)
        return family
    if family == "day_night_included_energy":
        if exact.get("tariffSelection") != "connection_start_local_time":
            raise ValueError("invalid IZIVIA Express day/night selection")
        day = exact.get("day") or {}
        night = exact.get("night") or {}
        if (day.get("start"), day.get("end"), night.get("start"), night.get("end")) != (
            "08:00", "20:00", "20:00", "08:00"
        ):
            raise ValueError("unexpected IZIVIA Express day/night windows")
        validate_energy(day.get("energy"))
        validate_post_charge(day.get("postCharge"))
        validate_energy(night.get("extraEnergy"))
        fee = number(night.get("connectionFeeEur"))
        included = number(night.get("includedEnergyKwh"))
        if fee is None or fee < 0 or included is None or included < 0:
            raise ValueError("invalid IZIVIA Express included-energy band")
        return family
    raise ValueError(f"unknown IZIVIA Express formula family: {family!r}")


def exact_formula(location):
    unique = {}
    for config in location.get("configurations") or []:
        exact = ((config.get("pricing") or {}).get("iziviaExact"))
        validate_exact_formula(exact)
        key = json.dumps(exact, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        unique[key] = exact
    if not unique:
        return None
    if len(unique) != 1:
        raise ValueError(f"ambiguous IZIVIA Express formulas at {location.get('stationId')}")
    return next(iter(unique.values()))


def validate_sources(v8, inventory, lock, strict=True):
    if v8.get("dataset") != "izivia-express-direct-tcc-v8-france" or v8.get("schemaVersion") != "1.0.0":
        raise ValueError("unexpected IZIVIA Express V8 source")
    scope = v8.get("scope") or {}
    if (
        scope.get("countryCode") != "FR"
        or scope.get("onlyDirectCpo") is not True
        or scope.get("roamingIncluded") is not False
        or scope.get("subscriptionDiscountsIncluded") is not False
        or scope.get("failClosed") is not True
        or scope.get("pricingSemantics") != "exact_custom_runtime"
    ):
        raise ValueError("invalid IZIVIA Express V8 scope")
    metadata = inventory.get("metadata") or {}
    if metadata.get("operator") != "IZIVIA" or clean(metadata.get("network")).lower() != "izivia express":
        raise ValueError("invalid IZIVIA Express official inventory scope")
    if metadata.get("principle") != "No roaming; no silent tariff approximation; only charging_location pricing is treated as direct simulation pricing.":
        raise ValueError("IZIVIA Express official inventory safety principle changed")
    expected = (lock or {}).get("expected") or {}
    if strict:
        counts = v8.get("counts") or {}
        count_keys = (
            "officialStationRows",
            "tccLocations",
            "directPricePublishedRows",
            "directPriceNotPublishedRows",
            "pricedTccLocations",
            "exactConfigurations",
            "excludedAmbiguousConfigurations",
            "distinctRawTariffs",
            "formulaRows",
        )
        for key in count_keys:
            if counts.get(key) != expected.get(key):
                raise ValueError(f"unexpected IZIVIA Express V8 count {key}={counts.get(key)!r}")
        if counts.get("familyFormulaRows") != expected.get("familyFormulaRows"):
            raise ValueError("unexpected IZIVIA Express V8 family counts")
        inventory_expected = {
            "officialStations": expected.get("officialStationRows"),
            "officialPdcRows": expected.get("officialPdcRows"),
            "resolvedStations": expected.get("officialStationRows"),
            "stationsDirectPricePublished": expected.get("directPricePublishedRows"),
            "stationsDirectPriceNotPublished": expected.get("directPriceNotPublishedRows"),
            "distinctDirectRawTariffs": expected.get("distinctRawTariffs"),
        }
        for key, value in inventory_expected.items():
            if metadata.get(key) != value:
                raise ValueError(f"unexpected IZIVIA Express inventory count {key}={metadata.get(key)!r}")
        generated = expected.get("sourceGeneratedAt")
        if v8.get("sourceGeneratedAt") != generated or metadata.get("generatedAt") != generated:
            raise ValueError("IZIVIA Express locked sources were not generated together")

    locations = v8.get("stations") or []
    official_rows = inventory.get("stations") or []
    location_by_official = {}
    priced_locations = 0
    configurations = 0
    for location in locations:
        formula = exact_formula(location)
        published = location.get("directPricePublished") is True
        if published != (formula is not None):
            raise ValueError(f"IZIVIA Express publication/formula mismatch at {location.get('stationId')}")
        if formula is not None:
            priced_locations += 1
        configurations += len(location.get("configurations") or [])
        for station_id in location.get("officialStationIds") or []:
            if station_id in location_by_official:
                raise ValueError(f"duplicate IZIVIA Express official station id: {station_id}")
            location_by_official[station_id] = location

    source_pdc_owner = {}
    for row in official_rows:
        station_id = clean(row.get("officialStationId"))
        if not station_id or station_id not in location_by_official:
            raise ValueError(f"IZIVIA Express inventory station missing from V8: {station_id!r}")
        location = location_by_official[station_id]
        if bool(row.get("directPricePublished")) != bool(location.get("directPricePublished")):
            raise ValueError(f"IZIVIA Express price publication mismatch at {station_id}")
        for pdc_id in row.get("pdcIds") or []:
            if pdc_id in source_pdc_owner:
                raise ValueError(f"duplicate IZIVIA Express source PDC id: {pdc_id}")
            source_pdc_owner[pdc_id] = station_id

    if strict:
        if len(locations) != expected.get("tccLocations") or len(official_rows) != expected.get("officialStationRows"):
            raise ValueError("IZIVIA Express locked source row count changed")
        if len(source_pdc_owner) != expected.get("officialPdcRows"):
            raise ValueError("IZIVIA Express locked PDC inventory count changed")
        if priced_locations != expected.get("pricedTccLocations") or configurations != expected.get("exactConfigurations"):
            raise ValueError("IZIVIA Express locked configuration coverage changed")
    return location_by_official, source_pdc_owner


def canonical_kind(pdc):
    connectors = pdc.get("connectors") or {}
    power = number(pdc.get("powerKw"))
    if truthy(connectors.get("comboCcs")) or truthy(connectors.get("chademo")):
        return "DC"
    if (truthy(connectors.get("type2")) or truthy(connectors.get("ef"))) and power is not None and power <= 43:
        return "AC"
    if power is not None and power > 43:
        return "DC"
    return None


def configuration_proof(pdc, location):
    kind = canonical_kind(pdc)
    power = number(pdc.get("powerKw"))
    configs = location.get("configurations") or []
    if kind is None or power is None:
        return "exact_pdc_station_formula", None, kind
    same_kind = [row for row in configs if clean(row.get("kind")).upper() == kind]
    exact = [row for row in same_kind if abs(float(row.get("powerKw")) - power) <= ROUNDING_EPSILON]
    if len(exact) == 1:
        return "exact_configuration_power", exact[0], kind
    tolerant = [row for row in same_kind if abs(float(row.get("powerKw")) - power) <= POWER_TOLERANCE_KW]
    if len(tolerant) == 1:
        return "configuration_power_tolerance_2_1kw", tolerant[0], kind
    # Exact PDC identity plus one unique formula at the station is stronger than
    # guessing a configuration.  The selector records that no power match was used.
    return "exact_pdc_station_formula", None, kind


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
        "timeWindowSelection": None,
        "rounding": None,
        "roundingEpsilon": ROUNDING_EPSILON,
        "formulaFamily": None,
        "notes": None,
    }
    row.update(overrides)
    return row


def rounding_label(energy, post_charge=None):
    parts = []
    if (energy or {}).get("billing") == "started_kwh":
        parts.append("started_kwh")
    billing = (post_charge or {}).get("billing")
    if billing == "started_minute":
        parts.append("post_charge_started_minute")
    elif billing == "started_block":
        parts.append("post_charge_started_block")
    return "+".join(parts) or None


def apply_post_charge(rule, post_charge):
    if post_charge is None:
        return rule
    billing = post_charge["billing"]
    rule.update({
        "occupancyBilling": billing,
        "occupancyTrigger": "after_charging_stops",
        "occupancyDurationBasis": "connected_minutes_minus_charging_minutes",
        "missingUnplugTimePolicy": "zero_post_charge",
    })
    if billing == "started_block":
        rule["occupancyBlockMinutes"] = int(post_charge["blockMinutes"])
        rule["occupancyBlockFee"] = float(post_charge["blockFeeEur"])
    else:
        rule["occupancyPerMinute"] = float(post_charge["ratePerMinuteEur"])
    return rule


def component_rule(family, energy, post_charge=None, **overrides):
    row = blank_rule(
        formulaFamily=family,
        pricePerKwh=float(energy["ratePerKwhEur"]),
        energyBilling=energy["billing"],
        rounding=rounding_label(energy, post_charge),
        **overrides,
    )
    return apply_post_charge(row, post_charge)


def pricing_rules(exact):
    family = validate_exact_formula(exact)
    if family in {"session_cap", "simple_postcharge"}:
        return [component_rule(
            family,
            exact["energy"],
            exact.get("postCharge"),
            totalTransactionCap=float(exact["sessionCapEur"]) if family == "session_cap" else None,
            notes="Exact energy plus post-charge formula converted from the locked IZIVIA Express V8 source.",
        )]
    day = exact["day"]
    night = exact["night"]
    return [
        component_rule(
            family,
            day["energy"],
            day.get("postCharge"),
            scope="timeWindow",
            start=day["start"],
            end=day["end"],
            timeWindowSelection="connection_start_local_time",
            notes="Day tariff selected from the local connection start time.",
        ),
        component_rule(
            family,
            night["extraEnergy"],
            None,
            scope="timeWindow",
            start=night["start"],
            end=night["end"],
            connectionFee=float(night["connectionFeeEur"]),
            includedEnergyKwh=float(night["includedEnergyKwh"]),
            timeWindowSelection="connection_start_local_time",
            notes="Night connection fee includes the stated energy allowance; extra energy is billed only above it.",
        ),
    ]


def source_url(lock):
    repository = clean((lock or {}).get("sourceRepository"))
    commit = clean((lock or {}).get("sourceCommit"))
    path = clean((((lock or {}).get("files") or {}).get("v8Tariffs") or {}).get("path"))
    if repository and commit and path:
        return f"https://raw.githubusercontent.com/{repository}/{commit}/{path}"
    return "data:izivia-express-v8-source"


def offer_for(pdc, station, source_station_id, location, exact, lock, source_updated_at, normalized_at):
    pdc_id = clean(pdc.get("pdcId"))
    station_id = clean(pdc.get("stationId"))
    proof, config, kind = configuration_proof(pdc, location)
    selectors = {
        "network": "IZIVIA Express",
        "formulaFamily": exact["family"],
        "formulaScope": "station_configuration",
        "configurationProof": proof,
        "sourceConfigurationId": (config or {}).get("id"),
        "sourceConfigurationKind": (config or {}).get("kind"),
        "sourceConfigurationPowerKw": (config or {}).get("powerKw"),
        "canonicalPowerKw": pdc.get("powerKw"),
        "roamingSeparate": True,
        "subscriptionSeparate": True,
        "lockedSourceCommit": (lock or {}).get("sourceCommit"),
    }
    power = number(pdc.get("powerKw"))
    return {
        "offerId": f"izivia-express:direct:{pdc_id}",
        "physicalOperatorId": pdc.get("physicalOperatorId") or station.get("physicalOperatorId"),
        "tariffNetworkId": "izivia-express",
        "provider": "IZIVIA Express direct",
        "channel": "direct",
        "sourceMode": "station_evse",
        "sourceStationId": source_station_id,
        "sourceEvseId": pdc_id,
        "canonicalStationId": station_id,
        "canonicalPdcId": pdc_id,
        "matchMethod": "exact_pdc_itinerance",
        "matchDistanceMeters": None,
        "selectors": selectors,
        "kind": kind,
        "minPowerKw": power,
        "maxPowerKw": power,
        "pricingRules": pricing_rules(exact),
        "subscriptionId": None,
        "validFrom": None,
        "validTo": None,
        "rankable": True,
        "blockedReasons": [],
        "sourceUrl": source_url(lock),
        "sourceUpdatedAt": source_updated_at,
        "normalizedAt": normalized_at,
    }


def materialize(v8, inventory, stations, pdcs, lock=None, normalized_at=None, strict=True):
    location_by_official, source_pdc_owner = validate_sources(v8, inventory, lock or {}, strict=strict)
    station_map = {clean(row.get("stationId")): row for row in stations if row.get("stationId")}
    eligible = [row for row in pdcs if row.get("tariffNetworkId") == "izivia-express"]
    eligible_station_ids = {clean(row.get("stationId")) for row in eligible}
    normalized_at = normalized_at or dt.datetime.now(dt.timezone.utc).isoformat()
    offers = []
    unresolved = []
    reasons = Counter()
    proof_counts = Counter()
    family_counts = Counter()
    source_exact_pdc_matches = 0

    def fail(pdc, reason, **details):
        reasons[reason] += 1
        if len(unresolved) < 250:
            unresolved.append({
                "canonicalStationId": clean(pdc.get("stationId")),
                "canonicalPdcId": clean(pdc.get("pdcId")),
                "powerKw": pdc.get("powerKw"),
                "connectors": pdc.get("connectors"),
                "reason": reason,
                **details,
            })

    for pdc in eligible:
        pdc_id = clean(pdc.get("pdcId"))
        station_id = clean(pdc.get("stationId"))
        station = station_map.get(station_id)
        if station is None or station.get("tariffNetworkId") != "izivia-express":
            fail(pdc, "canonical_station_scope_mismatch")
            continue
        location = location_by_official.get(station_id)
        if location is None:
            fail(pdc, "station_not_in_locked_source")
            continue
        source_station_id = source_pdc_owner.get(pdc_id)
        if source_station_id == station_id:
            source_exact_pdc_matches += 1
        exact = exact_formula(location)
        if exact is None:
            fail(pdc, "direct_price_not_published")
            continue
        if source_station_id != station_id:
            fail(pdc, "pdc_not_in_locked_source_inventory", sourceStationId=source_station_id)
            continue
        offer = offer_for(
            pdc,
            station,
            source_station_id,
            location,
            exact,
            lock or {},
            v8.get("sourceGeneratedAt"),
            normalized_at,
        )
        offers.append(offer)
        proof_counts[offer["selectors"]["configurationProof"]] += 1
        family_counts[exact["family"]] += 1

    covered = {row["canonicalPdcId"] for row in offers}
    priced_station_ids = {row["canonicalStationId"] for row in offers}
    source_station_ids = set(location_by_official)
    report = {
        "schemaVersion": "1.0.0",
        "dataset": "france-izivia-express-canonical-audit",
        "productionReady": False,
        "source": {
            "repository": (lock or {}).get("sourceRepository"),
            "commit": (lock or {}).get("sourceCommit"),
            "generatedAt": v8.get("sourceGeneratedAt"),
            "v8Sha256": ((((lock or {}).get("files") or {}).get("v8Tariffs") or {}).get("sha256")),
            "inventorySha256": ((((lock or {}).get("files") or {}).get("officialInventory") or {}).get("sha256")),
        },
        "summary": {
            "sourceOfficialStationRowCount": len(inventory.get("stations") or []),
            "sourceOfficialPdcRowCount": len(source_pdc_owner),
            "sourceTccLocationCount": len(v8.get("stations") or []),
            "canonicalEligibleStationCount": len(eligible_station_ids),
            "canonicalEligiblePdcCount": len(eligible),
            "sourceStationMatchedCount": len(eligible_station_ids & source_station_ids),
            "sourceExactPdcMatchedCount": source_exact_pdc_matches,
            "pricedCoveredStationCount": len(priced_station_ids),
            "rankableCoveredPdcCount": len(covered),
            "materializedOfferCount": len(offers),
            "rankableOfferCount": len(offers),
            "failClosedPdcCount": len(eligible) - len(covered),
            "physicalInventoryMutationCount": 0,
        },
        "formulaFamilyPdcCounts": dict(sorted(family_counts.items())),
        "configurationProofPdcCounts": dict(sorted(proof_counts.items())),
        "unresolvedReasonPdcCounts": dict(sorted(reasons.items())),
        "sourceOnlyOfficialStationIds": sorted(source_station_ids - eligible_station_ids),
        "canonicalOnlyStationIds": sorted(eligible_station_ids - source_station_ids),
        "unresolved": unresolved,
    }
    offers.sort(key=lambda row: (row["canonicalStationId"], row["canonicalPdcId"], row["offerId"]))
    return offers, report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-v8", required=True)
    parser.add_argument("--source-inventory", required=True)
    parser.add_argument("--source-lock", default="data/izivia_express_direct_v8_source_lock_v1.json")
    parser.add_argument("--canonical-dir", default="build/france_irve_identity")
    parser.add_argument("--out-dir", default="build/france_irve_offers")
    args = parser.parse_args()

    lock = load_json(args.source_lock)
    validate_lock(lock, args.source_v8, args.source_inventory)
    v8 = load_json(args.source_v8)
    inventory = load_json(args.source_inventory)
    canonical = Path(args.canonical_dir)
    offers, report = materialize(
        v8,
        inventory,
        load_json(canonical / "stations.json.gz"),
        load_json(canonical / "charge_points.json.gz"),
        lock=lock,
        strict=True,
    )
    out = Path(args.out_dir)
    dump_json(out / "izivia_express_pdc_offers_contract_v1_1.json.gz", offers)
    dump_json(out / "izivia_express_materialization_report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
