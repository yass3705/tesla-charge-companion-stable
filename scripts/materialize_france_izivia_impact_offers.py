#!/usr/bin/env python3
"""Materialize territory-specific IZIVIA Impact tariffs on exact PAN PDCs.

PAN remains the sole physical inventory.  A source row is only applicable when
the canonical tariff network is ``izivia-impact``, the physical CPO is IZIVIA,
the station/PDC itinerance identities match exactly and the audited power has
not changed.  Complete direct formulas become rankable direct offers; blocked
direct plans become non-rankable references.  New, changed or foreign-network
rows fail closed.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
from collections import Counter, defaultdict
from pathlib import Path


NETWORK_ID = "izivia-impact"
PHYSICAL_OPERATOR_ID = "izivia"
TERRITORIES = {"m2a", "angouleme", "saint_nazaire"}
TARIFF_CLASSES = {"ac_22", "ac22_dc24", "rapid"}
ALLOWED_FORMULAS_BY_TERRITORY_CLASS = {
    ("m2a", "rapid"): {"direct-rapid-055-post-2-per-5"},
    ("angouleme", "rapid"): {"direct-rapid-055-post-2-per-5"},
}
ALLOWED_REFERENCE_FORMULAS_BY_TERRITORY_CLASS = {
    ("m2a", "ac22_dc24"): {"live-mixed-040-night-6"},
    ("saint_nazaire", "ac_22"): {"saint-nazaire-ac-night-6"},
    ("saint_nazaire", "ac22_dc24"): {"live-mixed-040-night-6"},
}
POWER_TOLERANCE_KW = 0.01
ROUNDING_EPSILON = 1e-9


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


def require_number(actual, label, minimum=0):
    value = number(actual)
    if value is None or value < minimum:
        raise ValueError(f"invalid IZIVIA Impact {label}: {actual!r}")
    return value


def validate_energy(component, label):
    if not isinstance(component, dict):
        raise ValueError(f"missing IZIVIA Impact {label} energy component")
    if component.get("billing") != "started_kwh":
        raise ValueError(f"unsupported IZIVIA Impact {label} energy billing")
    require_number(component.get("ratePerKwhEur"), f"{label} energy rate")


def validate_post_charge(component, label):
    if not isinstance(component, dict):
        raise ValueError(f"missing IZIVIA Impact {label} post-charge component")
    billing = component.get("billing")
    if billing == "started_minute":
        require_number(component.get("ratePerMinuteEur"), f"{label} post-charge rate")
        return
    if billing == "started_block":
        require_number(component.get("blockMinutes"), f"{label} post-charge block minutes", minimum=1e-12)
        require_number(component.get("blockFeeEur"), f"{label} post-charge block fee")
        return
    raise ValueError(f"unsupported IZIVIA Impact {label} post-charge billing")


def validate_formula(formula):
    formula_id = clean(formula.get("id"))
    if not formula_id or formula.get("currency") != "EUR":
        raise ValueError("invalid IZIVIA Impact formula identity/currency")
    if formula.get("missingUnplugTimePolicy") != "zero_post_charge":
        raise ValueError(f"IZIVIA Impact missing-unplug policy changed: {formula_id}")
    family = formula.get("family")
    if family == "simple_postcharge":
        validate_energy(formula.get("energy"), formula_id)
        validate_post_charge(formula.get("postCharge"), formula_id)
        return family
    if family == "day_night_included_energy":
        if formula.get("tariffSelection") != "connection_start_local_time":
            raise ValueError(f"IZIVIA Impact day/night selection changed: {formula_id}")
        if formula.get("timeZone") != "Europe/Paris":
            raise ValueError(f"IZIVIA Impact timeZone changed: {formula_id}")
        day = formula.get("day") or {}
        night = formula.get("night") or {}
        if (day.get("start"), day.get("end"), night.get("start"), night.get("end")) != (
            "08:00", "20:00", "20:00", "08:00"
        ):
            raise ValueError(f"IZIVIA Impact day/night windows changed: {formula_id}")
        validate_energy(day.get("energy"), f"{formula_id} day")
        validate_post_charge(day.get("postCharge"), f"{formula_id} day")
        validate_energy(night.get("extraEnergy"), f"{formula_id} night")
        require_number(night.get("connectionFeeEur"), f"{formula_id} night connection fee")
        included = require_number(night.get("includedEnergyKwh"), f"{formula_id} night included energy")
        if included != 20:
            raise ValueError(f"IZIVIA Impact included-energy quantity changed: {formula_id}")
        return family
    raise ValueError(f"unknown IZIVIA Impact formula family: {family!r}")


def validate_reference_formula(formula):
    formula_id = clean(formula.get("id"))
    if formula.get("family") != "day_night_included_energy" or formula.get("currency") != "EUR":
        raise ValueError(f"invalid IZIVIA Impact reference formula: {formula_id!r}")
    if formula.get("tariffSelection") != "unpublished" or formula.get("timeZone") != "Europe/Paris":
        raise ValueError(f"IZIVIA Impact reference cross-window semantics were promoted: {formula_id}")
    if formula.get("missingUnplugTimePolicy") != "zero_post_charge":
        raise ValueError(f"IZIVIA Impact reference missing-unplug policy changed: {formula_id}")
    day = formula.get("day") or {}
    night = formula.get("night") or {}
    if (day.get("start"), day.get("end"), night.get("start"), night.get("end")) != (
        "08:00", "20:00", "20:00", "08:00"
    ):
        raise ValueError(f"IZIVIA Impact reference day/night windows changed: {formula_id}")
    validate_energy(day.get("energy"), f"{formula_id} reference day")
    validate_post_charge(day.get("postCharge"), f"{formula_id} reference day")
    validate_energy(night.get("extraEnergy"), f"{formula_id} reference night")
    require_number(night.get("connectionFeeEur"), f"{formula_id} reference night connection fee")
    included = require_number(night.get("includedEnergyKwh"), f"{formula_id} reference night included energy")
    if included != 20:
        raise ValueError(f"IZIVIA Impact reference included-energy quantity changed: {formula_id}")
    return formula.get("family")


def _check_expected(expected, key, actual):
    if key in expected and expected.get(key) != actual:
        raise ValueError(f"IZIVIA Impact expected {key} changed: {actual!r}")


def validate_source(data):
    if data.get("schemaVersion") != "1.0.0" or data.get("dataset") != "izivia-impact-direct-tariffs":
        raise ValueError("unexpected IZIVIA Impact source")
    if data.get("productionReady") is not False or not clean(data.get("generatedAt")):
        raise ValueError("invalid IZIVIA Impact source publication state")

    scope = data.get("scope") or {}
    expected_scope = {
        "country": "FR",
        "tariffNetworkId": NETWORK_ID,
        "physicalOperatorId": PHYSICAL_OPERATOR_ID,
        "directCpoOnly": True,
        "physicalInventoryFromPanOnly": True,
        "exactStationAndPdcIdentityRequired": True,
        "stationLevelFormulaBindingRequired": True,
        "unknownOrChangedPdcFailsClosed": True,
        "blockedDirectBecomesReferenceOnly": True,
        "roamingIncluded": False,
        "accessOffersIncluded": False,
        "subscriptionsIncluded": False,
        "failClosed": True,
    }
    if any(scope.get(key) != value for key, value in expected_scope.items()):
        raise ValueError("IZIVIA Impact source safety scope changed")

    policy = data.get("policy") or {}
    expected_policy = {
        "accessOrSubscriptionTariffsNeverPromotedToDirect": True,
        "monthlyOrRegistrationFeesAllocatedToSession": False,
        "postChargeDurationBasis": "connected_minutes_minus_charging_minutes",
        "missingUnplugTimePolicy": "zero_post_charge",
    }
    if any(policy.get(key) != value for key, value in expected_policy.items()):
        raise ValueError("IZIVIA Impact source safety policy changed")
    if not data.get("sources"):
        raise ValueError("missing IZIVIA Impact source evidence")

    formulas = {}
    for formula in data.get("formulas") or []:
        formula_id = clean(formula.get("id"))
        if not formula_id or formula_id in formulas:
            raise ValueError("duplicate or blank IZIVIA Impact formula id")
        validate_formula(formula)
        formulas[formula_id] = formula
    if not formulas:
        raise ValueError("missing IZIVIA Impact formula catalogue")

    reference_formulas = {}
    for formula in data.get("referenceFormulas") or []:
        formula_id = clean(formula.get("id"))
        if not formula_id or formula_id in formulas or formula_id in reference_formulas:
            raise ValueError("duplicate or blank IZIVIA Impact reference formula id")
        validate_reference_formula(formula)
        reference_formulas[formula_id] = formula
    if not reference_formulas:
        raise ValueError("missing IZIVIA Impact reference formula catalogue")

    stations = {}
    pdc_bindings = {}
    rankable_station_count = rankable_pdc_count = 0
    blocked_station_count = blocked_pdc_count = 0
    used_formulas = set()
    used_reference_formulas = set()
    formula_pdc_counts = Counter()
    reference_formula_pdc_counts = Counter()
    inventory_counts = defaultdict(lambda: Counter(stationCount=0, pdcCount=0))
    rankable_counts = defaultdict(lambda: Counter(stationCount=0, pdcCount=0))
    blocked_counts = defaultdict(lambda: Counter(stationCount=0, pdcCount=0))

    for row in data.get("stations") or []:
        station_id = clean(row.get("stationId"))
        territory = clean(row.get("territory"))
        tariff_class = clean(row.get("tariffClass"))
        pdc_ids = [clean(value) for value in row.get("pdcIds") or []]
        powers = [number(value) for value in row.get("powersKw") or []]
        if not station_id.startswith("FRIIMPIZIM") or station_id in stations:
            raise ValueError(f"duplicate or invalid IZIVIA Impact station id: {station_id!r}")
        if territory not in TERRITORIES or tariff_class not in TARIFF_CLASSES:
            raise ValueError(f"invalid IZIVIA Impact territory/class: {station_id}")
        if not pdc_ids or len(pdc_ids) != len(powers) or len(pdc_ids) != len(set(pdc_ids)):
            raise ValueError(f"invalid IZIVIA Impact PDC/power binding: {station_id}")
        if any(not pdc_id.startswith("FRIIMEIZIM") for pdc_id in pdc_ids):
            raise ValueError(f"invalid IZIVIA Impact PDC identity: {station_id}")
        if any(power is None or power <= 0 for power in powers):
            raise ValueError(f"invalid IZIVIA Impact PDC power: {station_id}")

        direct = row.get("direct") or {}
        status = direct.get("status")
        formula_id = clean(direct.get("formulaId"))
        reference_formula_id = clean(direct.get("referenceFormulaId"))
        evidence = direct.get("evidence") or []
        if status not in {"rankable", "blocked"} or not evidence:
            raise ValueError(f"invalid IZIVIA Impact direct decision/evidence: {station_id}")
        if status == "rankable":
            if formula_id not in formulas or reference_formula_id or direct.get("blockedReasons"):
                raise ValueError(f"invalid IZIVIA Impact rankable formula binding: {station_id}")
            if formula_id not in ALLOWED_FORMULAS_BY_TERRITORY_CLASS.get((territory, tariff_class), set()):
                raise ValueError(f"invalid IZIVIA Impact territory/class formula binding: {station_id}")
            used_formulas.add(formula_id)
            formula_pdc_counts[formula_id] += len(pdc_ids)
            rankable_station_count += 1
            rankable_pdc_count += len(pdc_ids)
            rankable_counts[(territory, tariff_class)].update(stationCount=1, pdcCount=len(pdc_ids))
        else:
            reasons = [clean(value) for value in direct.get("blockedReasons") or []]
            if formula_id or not reasons or any(not reason for reason in reasons):
                raise ValueError(f"invalid IZIVIA Impact blocked direct decision: {station_id}")
            if reference_formula_id:
                if reference_formula_id not in reference_formulas:
                    raise ValueError(f"invalid IZIVIA Impact reference formula binding: {station_id}")
                if reference_formula_id not in ALLOWED_REFERENCE_FORMULAS_BY_TERRITORY_CLASS.get((territory, tariff_class), set()):
                    raise ValueError(f"invalid IZIVIA Impact territory/class reference formula binding: {station_id}")
                if "cross_window_tariff_selection_unpublished" not in reasons:
                    raise ValueError(f"missing IZIVIA Impact cross-window fail-closed reason: {station_id}")
                used_reference_formulas.add(reference_formula_id)
                reference_formula_pdc_counts[reference_formula_id] += len(pdc_ids)
            blocked_station_count += 1
            blocked_pdc_count += len(pdc_ids)
            blocked_counts[(territory, tariff_class)].update(stationCount=1, pdcCount=len(pdc_ids))

        inventory_counts[(territory, tariff_class)].update(stationCount=1, pdcCount=len(pdc_ids))
        stations[station_id] = row
        for pdc_id, power in zip(pdc_ids, powers):
            if pdc_id in pdc_bindings:
                raise ValueError(f"duplicate IZIVIA Impact PAN PDC binding: {pdc_id}")
            pdc_bindings[pdc_id] = {
                "canonicalStationId": station_id,
                "territory": territory,
                "tariffClass": tariff_class,
                "powerKw": power,
                "direct": direct,
            }

    if not stations or used_formulas != set(formulas) or used_reference_formulas != set(reference_formulas):
        raise ValueError("IZIVIA Impact source station/formula coverage changed")
    expected = data.get("expected") or {}
    _check_expected(expected, "stationCount", len(stations))
    _check_expected(expected, "pdcCount", len(pdc_bindings))
    _check_expected(expected, "formulaCount", len(formulas))
    _check_expected(expected, "referenceFormulaCount", len(reference_formulas))
    _check_expected(expected, "rankableStationCount", rankable_station_count)
    _check_expected(expected, "rankablePdcCount", rankable_pdc_count)
    _check_expected(expected, "blockedStationCount", blocked_station_count)
    _check_expected(expected, "blockedPdcCount", blocked_pdc_count)
    if expected.get("formulaPdcCounts") != dict(sorted(formula_pdc_counts.items())):
        raise ValueError("IZIVIA Impact expected formula PDC counts changed")
    if expected.get("referenceFormulaPdcCounts") != dict(sorted(reference_formula_pdc_counts.items())):
        raise ValueError("IZIVIA Impact expected reference formula PDC counts changed")

    def validate_matrix(key, actual):
        declared = expected.get(key)
        if declared is None:
            return
        normalized = {
            territory: {
                tariff_class: dict(actual[(territory, tariff_class)])
                for tariff_class in sorted(TARIFF_CLASSES)
            }
            for territory in sorted(TERRITORIES)
        }
        # Empty Counter serializes to {}, while the source records explicit zeroes.
        for territory in normalized.values():
            for values in territory.values():
                values.setdefault("stationCount", 0)
                values.setdefault("pdcCount", 0)
        if declared != normalized:
            raise ValueError(f"IZIVIA Impact expected {key} matrix changed")

    validate_matrix("inventoryByTerritoryAndClass", inventory_counts)
    validate_matrix("rankableByTerritoryAndClass", rankable_counts)
    validate_matrix("blockedByTerritoryAndClass", blocked_counts)
    return formulas, reference_formulas, stations, pdc_bindings


def blank_rule(**overrides):
    row = {
        "scope": "allDay", "start": "00:00", "end": "24:00", "days": None,
        "currency": "EUR", "pricePerKwh": 0, "energyBilling": "started_kwh",
        "includedEnergyKwh": 0, "chargePerMinute": 0, "chargeThresholdMinutes": 0,
        "durationPerMinute": 0, "durationThresholdMinutes": 0, "durationStart": None,
        "durationEnd": None, "durationCap": None, "connectionFee": 0,
        "occupancyPerMinute": 0, "occupancyThresholdMinutes": 0,
        "occupancyStart": None, "occupancyEnd": None, "occupancyCap": None,
        "occupancyBilling": None, "occupancyBlockMinutes": None,
        "occupancyBlockFee": None, "occupancyTrigger": None,
        "occupancyDurationBasis": None, "missingUnplugTimePolicy": None,
        "parkingPerMinute": 0, "totalTransactionCap": None,
        "timeWindowSelection": None, "rounding": "started_kwh",
        "roundingEpsilon": ROUNDING_EPSILON, "formulaFamily": None, "notes": None,
    }
    row.update(overrides)
    return row


def apply_post_charge(rule, component):
    billing = component["billing"]
    rule.update({
        "occupancyBilling": billing,
        "occupancyTrigger": "after_charging_stops",
        "occupancyDurationBasis": "connected_minutes_minus_charging_minutes",
        "missingUnplugTimePolicy": "zero_post_charge",
    })
    if billing == "started_minute":
        rule["occupancyPerMinute"] = number(component.get("ratePerMinuteEur"))
        rule["rounding"] = "started_kwh+post_charge_started_minute"
    else:
        rule["occupancyBlockMinutes"] = number(component.get("blockMinutes"))
        rule["occupancyBlockFee"] = number(component.get("blockFeeEur"))
        rule["rounding"] = "started_kwh+post_charge_started_block"
    return rule


def pricing_rules(formula):
    family = validate_formula(formula)
    if family == "simple_postcharge":
        rule = blank_rule(
            pricePerKwh=number(formula["energy"]["ratePerKwhEur"]),
            formulaFamily=family,
            notes="Exact direct energy plus post-charge formula.",
        )
        return [apply_post_charge(rule, formula["postCharge"])]
    day, night = formula["day"], formula["night"]
    day_rule = blank_rule(
        scope="timeWindow", start=day["start"], end=day["end"],
        pricePerKwh=number(day["energy"]["ratePerKwhEur"]),
        timeWindowSelection="connection_start_local_time", formulaFamily=family,
        notes="Day direct tariff selected from the Europe/Paris connection start time.",
    )
    apply_post_charge(day_rule, day["postCharge"])
    night_rule = blank_rule(
        scope="timeWindow", start=night["start"], end=night["end"],
        pricePerKwh=number(night["extraEnergy"]["ratePerKwhEur"]),
        includedEnergyKwh=number(night["includedEnergyKwh"]),
        connectionFee=number(night["connectionFeeEur"]),
        timeWindowSelection="connection_start_local_time", formulaFamily=family,
        notes="Night connection fee includes 20 kWh; additional started kWh are billed above it.",
    )
    return [day_rule, night_rule]


def source_url(data, territory, evidence):
    sources = data.get("sources") or {}
    live = sources.get("officialLiveMap") or {}
    live_url = live.get("frontend") if isinstance(live, dict) else clean(live) or None
    if "official_live_map_charging_location" in (evidence or []):
        return live_url
    territory_source = sources.get({"saint_nazaire": "saintNazaire"}.get(territory, territory))
    if isinstance(territory_source, str):
        return territory_source
    if isinstance(territory_source, dict):
        for key in ("officialPage", "officialIziviaPage", "officialLiveMap", "tariffImage"):
            if clean(territory_source.get(key)):
                return territory_source[key]
    return live_url


def offer_for(pdc, binding, formula, reference_formula, data, normalized_at):
    pdc_id = clean(pdc.get("pdcId"))
    station_id = clean(pdc.get("stationId"))
    direct = binding["direct"]
    rankable = direct.get("status") == "rankable"
    formula_id = clean(direct.get("formulaId")) or None
    reference_formula_id = clean(direct.get("referenceFormulaId")) or None
    power = number(pdc.get("powerKw"))
    return {
        "offerId": f"izivia-impact:{'direct' if rankable else 'reference'}:{pdc_id}",
        "physicalOperatorId": PHYSICAL_OPERATOR_ID,
        "tariffNetworkId": NETWORK_ID,
        "provider": f"IZIVIA Impact · {binding['territory']}",
        "channel": "direct" if rankable else "reference",
        "sourceMode": "station_evse" if rankable else "reference_only",
        "sourceStationId": station_id,
        "sourceEvseId": pdc_id,
        "canonicalStationId": station_id,
        "canonicalPdcId": pdc_id,
        "matchMethod": "exact_pdc_itinerance",
        "matchDistanceMeters": None,
        "selectors": {
            "network": "IZIVIA Impact",
            "territory": binding["territory"],
            "tariffClass": binding["tariffClass"],
            "formulaId": formula_id,
            "referenceFormulaId": reference_formula_id,
            "referenceFormulaFamily": (
                reference_formula.get("family") if isinstance(reference_formula, dict) else None
            ),
            "tariffTimeZone": formula.get("timeZone") if isinstance(formula, dict) else None,
            "referenceTimeZone": (
                reference_formula.get("timeZone") if isinstance(reference_formula, dict) else None
            ),
            "canonicalPowerKw": power,
            "exactLockedPanPdc": True,
            "intendedChannel": "direct",
            "blocksGenericFallback": True,
            "directEvidence": list(direct.get("evidence") or []),
            "roamingSeparate": True,
            "subscriptionsSeparate": True,
            "genericIziviaSeparate": True,
            "impactLfSeparate": True,
        },
        # PAN connector flags do not reliably identify the connector behind one
        # PDC on mixed/rapid Impact stations.  Only the audited AC-only class is
        # safe to expose as a kind selector.
        "kind": "AC" if binding["tariffClass"] == "ac_22" else None,
        "minPowerKw": power,
        "maxPowerKw": power,
        "pricingRules": pricing_rules(formula) if rankable else [],
        "subscriptionId": None,
        "validFrom": None,
        "validTo": None,
        "rankable": rankable,
        "blockedReasons": [] if rankable else list(direct.get("blockedReasons") or []),
        "sourceUrl": source_url(data, binding["territory"], direct.get("evidence") or []),
        "sourceUpdatedAt": data.get("generatedAt"),
        "normalizedAt": normalized_at,
    }


def materialize(data, stations, pdcs, normalized_at=None):
    formulas, reference_formulas, source_stations, pdc_bindings = validate_source(data)
    station_map = {clean(row.get("stationId")): row for row in stations if clean(row.get("stationId"))}
    impact_stations = {sid: row for sid, row in station_map.items() if row.get("tariffNetworkId") == NETWORK_ID}
    eligible = [row for row in pdcs if row.get("tariffNetworkId") == NETWORK_ID]
    eligible_ids = [clean(row.get("pdcId")) for row in eligible]
    if any(not value for value in eligible_ids) or len(eligible_ids) != len(set(eligible_ids)):
        raise ValueError("duplicate or blank canonical IZIVIA Impact PDC id")
    normalized_at = normalized_at or dt.datetime.now(dt.timezone.utc).isoformat()
    offers = []
    unresolved = []
    counters = Counter()

    def fail(pdc, reason, binding=None):
        counters[f"unresolved_{reason}"] += 1
        if len(unresolved) < 250:
            unresolved.append({
                "canonicalStationId": clean(pdc.get("stationId")),
                "canonicalPdcId": clean(pdc.get("pdcId")),
                "powerKw": pdc.get("powerKw"),
                "physicalOperatorId": pdc.get("physicalOperatorId"),
                "expectedStationId": (binding or {}).get("canonicalStationId"),
                "expectedPowerKw": (binding or {}).get("powerKw"),
                "reason": reason,
            })

    for pdc in eligible:
        pdc_id = clean(pdc.get("pdcId"))
        station_id = clean(pdc.get("stationId"))
        station = impact_stations.get(station_id)
        if not station:
            fail(pdc, "canonical_station_scope_mismatch")
            continue
        if clean(station.get("idStationItinerance")) != station_id:
            fail(pdc, "canonical_station_itinerance_mismatch")
            continue
        if clean(pdc.get("idPdcItinerance")) != pdc_id:
            fail(pdc, "canonical_pdc_itinerance_mismatch")
            continue
        if clean(station.get("physicalOperatorId")) != PHYSICAL_OPERATOR_ID:
            fail(pdc, "station_physical_cpo_not_izivia")
            continue
        if clean(pdc.get("physicalOperatorId")) != PHYSICAL_OPERATOR_ID:
            fail(pdc, "physical_cpo_not_izivia")
            continue
        binding = pdc_bindings.get(pdc_id)
        if not binding:
            fail(pdc, "source_pdc_not_locked")
            continue
        if binding["canonicalStationId"] != station_id or station_id not in source_stations:
            fail(pdc, "source_station_binding_mismatch", binding)
            continue
        power = number(pdc.get("powerKw"))
        if power is None:
            fail(pdc, "missing_power", binding)
            continue
        if abs(power - binding["powerKw"]) > POWER_TOLERANCE_KW:
            fail(pdc, "source_power_binding_mismatch", binding)
            continue
        formula_id = clean(binding["direct"].get("formulaId"))
        reference_formula_id = clean(binding["direct"].get("referenceFormulaId"))
        offer = offer_for(
            pdc,
            binding,
            formulas.get(formula_id),
            reference_formulas.get(reference_formula_id),
            data,
            normalized_at,
        )
        offers.append(offer)
        if offer["rankable"]:
            counters[f"rankable_formula_{formula_id}"] += 1
        elif reference_formula_id:
            counters[f"reference_formula_{reference_formula_id}"] += 1
        else:
            counters[f"reference_class_{binding['territory']}_{binding['tariffClass']}"] += 1

    offers.sort(key=lambda row: (row["canonicalStationId"], row["canonicalPdcId"], row["offerId"]))
    if len({row["offerId"] for row in offers}) != len(offers) or len({row["canonicalPdcId"] for row in offers}) != len(offers):
        raise AssertionError("duplicate IZIVIA Impact materialized offer/PDC id")
    eligible_set = set(eligible_ids)
    if any(
        row.get("canonicalPdcId") not in eligible_set
        or row.get("tariffNetworkId") != NETWORK_ID
        or row.get("physicalOperatorId") != PHYSICAL_OPERATOR_ID
        or row.get("subscriptionId") is not None
        or row.get("matchMethod") != "exact_pdc_itinerance"
        or (row.get("rankable") and (row.get("channel") != "direct" or not row.get("pricingRules") or row.get("blockedReasons")))
        or (not row.get("rankable") and (row.get("channel") != "reference" or row.get("sourceMode") != "reference_only" or row.get("pricingRules") or not row.get("blockedReasons")))
        for row in offers
    ):
        raise AssertionError("IZIVIA Impact materializer escaped exact fail-closed scope")

    covered_ids = {row["canonicalPdcId"] for row in offers}
    rankable = [row for row in offers if row["rankable"]]
    references = [row for row in offers if not row["rankable"]]
    territory_summary = {}
    for territory in sorted(TERRITORIES):
        canonical_station_ids = {
            sid for sid, row in source_stations.items()
            if row.get("territory") == territory and sid in impact_stations
        }
        canonical_pdc_ids = {
            pdc_id for pdc_id, binding in pdc_bindings.items()
            if binding["territory"] == territory and pdc_id in eligible_set
        }
        territory_summary[territory] = {
            "canonicalStationCount": len(canonical_station_ids),
            "canonicalPdcCount": len(canonical_pdc_ids),
            "rankableStationCount": len({row["canonicalStationId"] for row in rankable if row["selectors"]["territory"] == territory}),
            "rankablePdcCount": sum(row["selectors"]["territory"] == territory for row in rankable),
            "referenceStationCount": len({row["canonicalStationId"] for row in references if row["selectors"]["territory"] == territory}),
            "referencePdcCount": sum(row["selectors"]["territory"] == territory for row in references),
        }

    summary = {
        "canonicalIziviaImpactStationCount": len(impact_stations),
        "canonicalIziviaImpactPdcCount": len(eligible),
        "sourceBoundStationCount": len(source_stations),
        "sourceBoundPdcCount": len(pdc_bindings),
        "sourceBoundPdcAbsentFromCanonicalCount": len(set(pdc_bindings) - eligible_set),
        "materializedOfferCount": len(offers),
        "rankableOfferCount": len(rankable),
        "referenceOfferCount": len(references),
        "directRankableOfferCount": len(rankable),
        "referenceCoveredPdcCount": len({row["canonicalPdcId"] for row in references}),
        "rankableCoveredStationCount": len({row["canonicalStationId"] for row in rankable}),
        "rankableCoveredPdcCount": len({row["canonicalPdcId"] for row in rankable}),
        "unresolvedPdcCount": len(eligible_set - covered_ids),
        "physicalInventoryMutationCount": 0,
        "territories": territory_summary,
        "counters": dict(sorted(counters.items())),
    }
    return offers, summary, unresolved


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="data/izivia_impact_direct_tariffs_v1.json")
    parser.add_argument("--canonical-dir", default="build/france_irve_identity")
    parser.add_argument("--out-dir", default="build/france_irve_offers")
    args = parser.parse_args()
    data = load_json(args.source)
    canonical = Path(args.canonical_dir)
    offers, summary, unresolved = materialize(
        data,
        load_json(canonical / "stations.json.gz"),
        load_json(canonical / "charge_points.json.gz"),
    )
    out = Path(args.out_dir)
    dump_json(out / "izivia_impact_pdc_offers_contract_v1_1.json.gz", offers)
    report = {
        "schemaVersion": "1.1.1",
        "dataset": "france-izivia-impact-canonical-audit",
        "productionReady": False,
        "summary": summary,
        "unresolvedExamples": unresolved,
    }
    dump_json(out / "izivia_impact_materialization_report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
