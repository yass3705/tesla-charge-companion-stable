#!/usr/bin/env python3
"""Overlay exact Neogy direct and Alperia EasyCharge tariffs onto Italy V9.

The canonical data-lab candidate contains every current Neogy PUN EVSE with
its province, current type, power and official tariff class.  This publisher
intersects it with the served compact catalogue, emits direct QR/card pricing
only for the 1,537 unambiguous EVSEs, and keeps EasyCharge Light and Plus as
separate opt-in subscription layers on exact Neogy identities only.
"""
from __future__ import annotations

import argparse
import gzip
import json
from collections import Counter
from pathlib import Path
from typing import Any, Callable


DIRECT_PROVIDER = "Neogy"
SUBSCRIPTION_PROVIDER = "Alperia Charge"
OPERATOR = "NEOGY SRL"
DIRECT_SOURCE_ID = "neogy-italy-qr-direct"
SUBSCRIPTION_SOURCE_ID = "alperia-easycharge-neogy-italy"
DIRECT_SOURCE = "https://www.neogy.it/en/public-network-charging/direct-payment.html"
POST_CHARGE_SOURCE = "https://www.neogy.it/en/public-charging-stations.html"
EASYCHARGE_SOURCE = "https://www.alperia.eu/de/easycharge/"
HYPER_100_SOURCE = (
    "https://www.alperiagroup.eu/it/"
    "auto-elettriche-33-nuove-stazioni-di-ricarica-veloce-alto-adige"
)
HYPER_400_SOURCE = (
    "https://www.alperiagroup.eu/it/"
    "neogy-centro-di-ricarica-allavanguardia-presso-fiera-bolzano"
)
PLUS_VALID_FROM = "2025-03-01"
PLUS_VALID_THROUGH = "2027-02-28"
DIRECT_RATES = {
    "OTHER_ITALY_FAST": 0.79,
    "OTHER_ITALY_HYPER": 0.98,
    "OTHER_ITALY_QUICK": 0.67,
    "SOUTH_TYROL_DC": 0.55,
    "SOUTH_TYROL_QUICK": 0.45,
}


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_gz_json(path: Path) -> Any:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return json.load(handle)


def exact_ids(offer: dict[str, Any]) -> set[str]:
    return {str(value).strip() for value in offer.get("evseIds") or [] if str(value).strip()}


def physical_evse(rows: list[list[Any]]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        station_id = str(row[0] or "").strip()
        operator = str(row[5] or "").strip()
        status = str(row[10] or "").strip()
        for evse in row[8] or []:
            evse_id = str(evse[0] or "").strip()
            if not evse_id:
                continue
            if evse_id in result:
                raise RuntimeError(f"duplicate physical EVSE identity {evse_id}")
            result[evse_id] = {
                "stationId": station_id,
                "operator": operator,
                "status": status,
                "kind": str(evse[2] or "").upper(),
                "powerKw": float(evse[3]),
            }
    return result


def is_existing_direct(offer: dict[str, Any]) -> bool:
    return offer.get("provider") == DIRECT_PROVIDER and offer.get("sourceId") == DIRECT_SOURCE_ID


def is_existing_subscription(offer: dict[str, Any]) -> bool:
    return offer.get("provider") == SUBSCRIPTION_PROVIDER and offer.get("sourceId") == SUBSCRIPTION_SOURCE_ID


def replace_existing_preserving_order(
    baseline: list[dict[str, Any]],
    new_offers: list[dict[str, Any]],
    predicate: Callable[[dict[str, Any]], bool],
) -> list[dict[str, Any]]:
    """Refresh this overlay without reordering offers from other providers."""
    new_by_id = {str(offer["id"]): offer for offer in new_offers}
    used: set[str] = set()
    composed: list[dict[str, Any]] = []
    for offer in baseline:
        if not predicate(offer):
            composed.append(offer)
            continue
        offer_id = str(offer.get("id") or "")
        replacement = new_by_id.get(offer_id)
        if replacement is not None:
            composed.append(replacement)
            used.add(offer_id)
    composed.extend(offer for offer in new_offers if str(offer["id"]) not in used)
    return composed


def latest_generated_at(baseline: dict[str, Any], candidate: dict[str, Any]) -> str | None:
    values = [str(value) for value in (baseline.get("generatedAt"), candidate.get("generatedAt")) if value]
    return max(values) if values else None


def validate_post_charge(entry: dict[str, Any]) -> None:
    evse_id = str(entry.get("evseId") or "")
    policy = entry.get("postChargePolicy") or {}
    if policy.get("source") != POST_CHARGE_SOURCE or policy.get("graceMinutes") != 60:
        raise RuntimeError(f"unexpected Neogy post-charge evidence for {evse_id}")
    rate = float(policy.get("eurPerMinute"))
    windows = policy.get("exemptLocalWindows") or []
    if entry.get("connectorKind") == "AC" and float(entry.get("maxPowerKw")) <= 22.2:
        if rate != 0.08 or windows != [{"start": "23:00", "end": "07:00"}]:
            raise RuntimeError(f"unexpected Neogy Quick post-charge rule for {evse_id}")
    elif rate != 0.15 or windows:
        raise RuntimeError(f"unexpected Neogy AC43/DC post-charge rule for {evse_id}")


def validate_candidate_entry(entry: dict[str, Any]) -> None:
    evse_id = str(entry.get("evseId") or "").strip()
    if not evse_id.startswith("IT*") or "*E" not in evse_id:
        raise RuntimeError(f"invalid Neogy EVSE identity {evse_id!r}")
    if entry.get("operator") != OPERATOR:
        raise RuntimeError(f"unexpected Neogy operator for {evse_id}")
    if entry.get("geography") not in {"south_tyrol", "other_italy"}:
        raise RuntimeError(f"unexpected Neogy geography for {evse_id}")
    if entry.get("connectorKind") not in {"AC", "DC"} or float(entry.get("maxPowerKw")) <= 0:
        raise RuntimeError(f"unexpected Neogy connector evidence for {evse_id}")
    tariff_class = str(entry.get("tariffClass") or "")
    direct = entry.get("directTariff")
    if tariff_class == "AC_43_UNRESOLVED":
        if entry.get("rankableDirectTariff") is not False or direct is not None or not entry.get("directBlockingReason"):
            raise RuntimeError(f"unresolved Neogy AC43 tariff leaked for {evse_id}")
    else:
        if tariff_class not in DIRECT_RATES or entry.get("rankableDirectTariff") is not True:
            raise RuntimeError(f"unexpected rankable Neogy tariff class for {evse_id}")
        if not isinstance(direct, dict) or direct.get("source") != DIRECT_SOURCE:
            raise RuntimeError(f"missing Neogy direct evidence for {evse_id}")
        if direct.get("paymentMethod") != "qr_credit_card" or direct.get("rankable") is not True:
            raise RuntimeError(f"unexpected Neogy direct channel for {evse_id}")
        if float(direct.get("energyEurPerKwh")) != DIRECT_RATES[tariff_class]:
            raise RuntimeError(f"unexpected Neogy direct price for {evse_id}")
    light = entry.get("easyChargeLight") or {}
    plus = entry.get("easyChargePlus") or {}
    if light.get("selectionId") != "alperia_easycharge_light" or light.get("source") != EASYCHARGE_SOURCE:
        raise RuntimeError(f"unexpected EasyCharge Light evidence for {evse_id}")
    if plus.get("selectionId") != "alperia_easycharge_plus" or plus.get("source") != EASYCHARGE_SOURCE:
        raise RuntimeError(f"unexpected EasyCharge Plus evidence for {evse_id}")
    if float(light.get("activationFeeEur")) != 25 or float(plus.get("activationFeeEur")) != 25:
        raise RuntimeError(f"unexpected EasyCharge activation fee for {evse_id}")
    if float(plus.get("energyEurPerKwh")) != 0.35:
        raise RuntimeError(f"unexpected EasyCharge Plus rate for {evse_id}")
    if plus.get("validFrom") != PLUS_VALID_FROM or plus.get("validThrough") != PLUS_VALID_THROUGH:
        raise RuntimeError(f"unexpected EasyCharge Plus validity for {evse_id}")
    if plus.get("requiresAlperiaCronEnergyOrBenElectricityCustomer") is not True:
        raise RuntimeError(f"EasyCharge Plus eligibility unresolved for {evse_id}")
    validate_post_charge(entry)


def post_charge_pricing(entry: dict[str, Any]) -> dict[str, Any]:
    policy = entry["postChargePolicy"]
    fee: dict[str, Any] = {
        "graceMinutes": int(policy["graceMinutes"]),
        "eurPerMinute": float(policy["eurPerMinute"]),
        "trigger": str(policy["trigger"]),
    }
    windows = list(policy.get("exemptLocalWindows") or [])
    if windows:
        fee["exemptLocalWindows"] = windows
    return fee


def common_metadata(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        "network": DIRECT_PROVIDER,
        "operator": OPERATOR,
        "stationId": str(entry["stationId"]),
        "province": str(entry.get("province") or ""),
        "region": str(entry.get("region") or ""),
        "geography": str(entry["geography"]),
        "connectorKind": str(entry["connectorKind"]),
        "maxPowerKw": float(entry["maxPowerKw"]),
        "tariffClass": str(entry["tariffClass"]),
        "timeZone": "Europe/Rome",
        "postChargeSource": POST_CHARGE_SOURCE,
        "postChargeBillableLocalWindow": dict(entry["postChargePolicy"]["billableLocalWindow"]),
    }


def build_direct(entry: dict[str, Any]) -> dict[str, Any]:
    evse_id = str(entry["evseId"])
    tariff = entry.get("directTariff")
    if entry.get("rankableDirectTariff") is not True or not isinstance(tariff, dict):
        raise RuntimeError(f"attempted to publish unresolved Neogy direct EVSE {evse_id}")
    metadata = common_metadata(entry)
    metadata.update(
        {
            "channel": "operator_direct_qr_credit_card",
            "paymentMethod": "qr_credit_card",
            "hyperchargerClassificationSources": [HYPER_100_SOURCE, HYPER_400_SOURCE]
            if entry["tariffClass"] == "OTHER_ITALY_HYPER"
            else [],
        }
    )
    return {
        "id": f"it:direct:neogy-card:{evse_id}",
        "provider": DIRECT_PROVIDER,
        "evseIds": [evse_id],
        "verifiedScope": "exact_evse",
        "countries": ["IT"],
        "currency": "EUR",
        "priority": 130,
        "source": DIRECT_SOURCE,
        "sourceId": DIRECT_SOURCE_ID,
        "directOperatorOnly": True,
        "pricing": {
            "type": "kwh",
            "pricePerKwh": float(tariff["energyEurPerKwh"]),
            "postChargeFee": post_charge_pricing(entry),
        },
        "metadata": metadata,
    }


def build_subscription(entry: dict[str, Any], product: str) -> dict[str, Any]:
    evse_id = str(entry["evseId"])
    if product == "light":
        tariff = entry["easyChargeLight"]
        selection_id = "alperia_easycharge_light"
        metadata_product = "EasyCharge Light"
    elif product == "plus":
        tariff = entry["easyChargePlus"]
        selection_id = "alperia_easycharge_plus"
        metadata_product = "EasyCharge Plus"
    else:
        raise RuntimeError(f"unknown EasyCharge product {product}")
    metadata = common_metadata(entry)
    metadata.update(
        {
            "channel": "subscription",
            "subscriptionProduct": metadata_product,
            "exactNeogyEvseOnly": True,
            "mustNotOverwriteDirectTariff": True,
            "activationFeeEur": 25.0,
            "activationFeeExcludedFromSessionCost": True,
            "partnerRoamingScopeUnresolvedFailClosed": True,
        }
    )
    if product == "plus":
        metadata["requiresAlperiaCronEnergyOrBenElectricityCustomer"] = True
    else:
        metadata["forNonAlperiaElectricityCustomers"] = True
    offer: dict[str, Any] = {
        "id": f"it:subscription:{selection_id}:{evse_id}",
        "selectionId": selection_id,
        "provider": SUBSCRIPTION_PROVIDER,
        "evseIds": [evse_id],
        "verifiedScope": "exact_evse",
        "countries": ["IT"],
        "currency": "EUR",
        "priority": 120,
        "source": EASYCHARGE_SOURCE,
        "sourceId": SUBSCRIPTION_SOURCE_ID,
        "operatorIds": [OPERATOR],
        "pricing": {
            "type": "kwh",
            "pricePerKwh": float(tariff["energyEurPerKwh"]),
            "postChargeFee": post_charge_pricing(entry),
        },
        "metadata": metadata,
    }
    if product == "plus":
        offer["validFrom"] = PLUS_VALID_FROM
        offer["validThrough"] = PLUS_VALID_THROUGH
        offer["validityBasis"] = "session_start_local_date"
    return offer


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", default="data/v9/italy-offers.json")
    parser.add_argument("--physical", default="data/v9/italy-static/all.json.gz")
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args()

    baseline = load_json(Path(args.baseline))
    rows = load_gz_json(Path(args.physical))
    candidate = load_gz_json(Path(args.candidate))
    if baseline.get("country") != "IT" or candidate.get("country") != "IT":
        raise RuntimeError("unexpected country in Neogy overlay inputs")
    if candidate.get("operator") != OPERATOR or candidate.get("dataset") != "neogy-alperia-italy-v9-candidate":
        raise RuntimeError("unexpected canonical Neogy candidate")
    if not isinstance(rows, list) or len(rows) != 29696:
        raise RuntimeError("unexpected Italy physical catalogue")
    expected_sources = {
        "directTariffs": DIRECT_SOURCE,
        "postChargeFees": POST_CHARGE_SOURCE,
        "easyCharge": EASYCHARGE_SOURCE,
        "hypercharger100To150Kw": HYPER_100_SOURCE,
        "hypercharger400Kw": HYPER_400_SOURCE,
    }
    if candidate.get("sources") != expected_sources:
        raise RuntimeError("unexpected Neogy/Alperia source set")

    entries = list(candidate.get("entries") or [])
    for entry in entries:
        validate_candidate_entry(entry)
    candidate_ids = [str(entry["evseId"]) for entry in entries]
    if len(candidate_ids) != len(set(candidate_ids)):
        raise RuntimeError("duplicate canonical Neogy EVSE identity")

    physical = physical_evse(rows)
    physical_ids = set(physical)
    physical_neogy_ids = {
        evse_id for evse_id, item in physical.items() if item["operator"].casefold() == OPERATOR.casefold()
    }
    current_entries = [entry for entry in entries if str(entry["evseId"]) in physical_neogy_ids]
    current_ids = {str(entry["evseId"]) for entry in current_entries}
    stale_candidate_ids = sorted(set(candidate_ids) - physical_ids)
    wrong_operator_ids = sorted((set(candidate_ids) & physical_ids) - physical_neogy_ids)
    physical_shape_mismatches = sorted(
        str(entry["evseId"])
        for entry in current_entries
        if abs(physical[str(entry["evseId"])]["powerKw"] - float(entry["maxPowerKw"])) > 0.001
        or physical[str(entry["evseId"])]["stationId"] != str(entry["stationId"])
    )
    compact_kind_disagreements = sorted(
        str(entry["evseId"])
        for entry in current_entries
        if physical[str(entry["evseId"])]["kind"] != entry["connectorKind"]
    )
    compact_kind_disagreement_ids = set(compact_kind_disagreements)
    expected_lossy_compact_kind_disagreements = all(
        entry["connectorKind"] == "AC"
        and float(entry["maxPowerKw"]) > 22
        and physical[str(entry["evseId"])]["kind"] == "DC"
        for entry in current_entries
        if str(entry["evseId"]) in compact_kind_disagreement_ids
    )

    direct_entries = [entry for entry in current_entries if entry.get("rankableDirectTariff") is True]
    unresolved_entries = [entry for entry in current_entries if entry.get("rankableDirectTariff") is not True]
    new_direct = [build_direct(entry) for entry in sorted(direct_entries, key=lambda row: str(row["evseId"]))]
    new_subscriptions = [
        *[build_subscription(entry, "light") for entry in sorted(current_entries, key=lambda row: str(row["evseId"]))],
        *[build_subscription(entry, "plus") for entry in sorted(current_entries, key=lambda row: str(row["evseId"]))],
    ]

    baseline_direct = list(baseline.get("directOffers") or [])
    baseline_subscriptions = list(baseline.get("subscriptionOffers") or [])
    baseline_emsp = list(baseline.get("emspOffers") or [])
    previous_direct = [offer for offer in baseline_direct if is_existing_direct(offer)]
    previous_subscriptions = [offer for offer in baseline_subscriptions if is_existing_subscription(offer)]
    retained_direct = [offer for offer in baseline_direct if not is_existing_direct(offer)]
    retained_subscriptions = [offer for offer in baseline_subscriptions if not is_existing_subscription(offer)]

    retained_direct_offer_ids = {str(offer.get("id") or "") for offer in retained_direct}
    retained_direct_evse_ids = set().union(*(exact_ids(offer) for offer in retained_direct)) if retained_direct else set()
    retained_subscription_offer_ids = {str(offer.get("id") or "") for offer in retained_subscriptions}
    new_direct_offer_ids = [str(offer["id"]) for offer in new_direct]
    new_subscription_offer_ids = [str(offer["id"]) for offer in new_subscriptions]
    direct_id_collisions = sorted(retained_direct_offer_ids & set(new_direct_offer_ids))
    direct_evse_collisions = sorted(retained_direct_evse_ids & {str(entry["evseId"]) for entry in direct_entries})
    subscription_id_collisions = sorted(retained_subscription_offer_ids & set(new_subscription_offer_ids))

    overlay = dict(baseline)
    overlay["generatedAt"] = latest_generated_at(baseline, candidate)
    overlay["directOffers"] = replace_existing_preserving_order(baseline_direct, new_direct, is_existing_direct)
    overlay["subscriptionOffers"] = replace_existing_preserving_order(
        baseline_subscriptions, new_subscriptions, is_existing_subscription
    )
    overlay["emspOffers"] = baseline_emsp
    overlay.setdefault("policy", {})["offerValidityDatesEnforced"] = True
    overlay["policy"]["neogyDirectExactEvseOnly"] = True
    overlay["policy"]["neogyAc43DirectFailClosed"] = True
    overlay["policy"]["neogyPostChargeFeesIncluded"] = True
    overlay["policy"]["alperiaEasyChargeSubscriptionsOptIn"] = True
    overlay["policy"]["alperiaEasyChargeExactNeogyEvseOnly"] = True
    overlay["policy"]["alperiaEasyChargePartnerRoamingFailClosed"] = True
    if args.publish:
        overlay.pop("publicationAllowed", None)
    else:
        overlay["publicationAllowed"] = False

    candidate_counts = candidate.get("counts") or {}
    candidate_policy = candidate.get("policy") or {}
    direct_class_counts = Counter(str(entry["tariffClass"]) for entry in direct_entries)
    unresolved_class_counts = Counter(str(entry["tariffClass"]) for entry in unresolved_entries)
    direct_price_counts = Counter(float(offer["pricing"]["pricePerKwh"]) for offer in new_direct)
    light_price_counts = Counter(
        float(offer["pricing"]["pricePerKwh"])
        for offer in new_subscriptions
        if offer["selectionId"] == "alperia_easycharge_light"
    )
    plus_price_counts = Counter(
        float(offer["pricing"]["pricePerKwh"])
        for offer in new_subscriptions
        if offer["selectionId"] == "alperia_easycharge_plus"
    )
    unresolved_ids = {str(entry["evseId"]) for entry in unresolved_entries}
    published_direct_ids = set().union(*(exact_ids(offer) for offer in new_direct)) if new_direct else set()
    expected_direct = len(retained_direct) + len(new_direct)
    expected_subscriptions = len(retained_subscriptions) + len(new_subscriptions)
    gates = {
        "physicalStations29696": len(rows) == 29696,
        "physicalEvse75025": len(physical_ids) == 75025,
        "physicalNeogyExact1563": len(physical_neogy_ids) == 1563,
        "physicalNeogyOperationalOnly": all(physical[evse_id]["status"] == "OPERATIONAL" for evse_id in physical_neogy_ids),
        "candidateNeogyExact1563": len(entries) == 1563 and candidate_counts.get("neogyEvse") == 1563,
        "candidateAllCurrentExactEvse": current_ids == physical_neogy_ids and not stale_candidate_ids and not wrong_operator_ids,
        "candidateStationAndPowerExact": not physical_shape_mismatches,
        "knownCompactKindFallbackContained": len(compact_kind_disagreements) == 973
        and expected_lossy_compact_kind_disagreements,
        "candidateSafetyPolicy": candidate_policy.get("acAboveQuickCeilingDirectFailsClosed") is True
        and candidate_policy.get("easyChargeSubscriptionsOptIn") is True
        and candidate_policy.get("easyChargePartnerRoamingScopeFailsClosed") is True,
        "candidateSafetyGates": all((candidate.get("safetyGates") or {}).values()),
        "direct1537": len(new_direct) == 1537 and candidate_counts.get("rankableDirectEvse") == 1537,
        "directClassesExact": dict(direct_class_counts)
        == {"OTHER_ITALY_FAST": 85, "OTHER_ITALY_HYPER": 20, "OTHER_ITALY_QUICK": 789, "SOUTH_TYROL_DC": 241, "SOUTH_TYROL_QUICK": 402},
        "directPricesExact": dict(direct_price_counts) == {0.45: 402, 0.55: 241, 0.67: 789, 0.79: 85, 0.98: 20},
        "unresolvedAc43Exact26": len(unresolved_entries) == 26
        and dict(unresolved_class_counts) == {"AC_43_UNRESOLVED": 26}
        and not (unresolved_ids & published_direct_ids),
        "easyChargeLight1563": sum(offer["selectionId"] == "alperia_easycharge_light" for offer in new_subscriptions) == 1563,
        "easyChargeLightPricesExact": dict(light_price_counts) == {0.45: 421, 0.55: 241, 0.79: 901},
        "easyChargePlus1563At035": dict(plus_price_counts) == {0.35: 1563},
        "easyChargePlusValidityExact": all(
            offer.get("validFrom") == PLUS_VALID_FROM
            and offer.get("validThrough") == PLUS_VALID_THROUGH
            and offer.get("validityBasis") == "session_start_local_date"
            for offer in new_subscriptions
            if offer["selectionId"] == "alperia_easycharge_plus"
        ),
        "activationFeeMetadataOnly": all(
            offer["metadata"]["activationFeeEur"] == 25
            and offer["metadata"]["activationFeeExcludedFromSessionCost"] is True
            and "activationFeeEur" not in offer["pricing"]
            for offer in new_subscriptions
        ),
        "baselineCoreDirectPreserved": len(retained_direct) >= 50914,
        "baselineCoreSubscriptions50008": len(retained_subscriptions) == 50008,
        "baselineEmsp1678": len(baseline_emsp) == 1678,
        "previousDirectIdempotent": len(previous_direct) in {0, 1537},
        "previousSubscriptionsIdempotent": len(previous_subscriptions) in {0, 3126},
        "newOfferIdsUnique": len(new_direct_offer_ids) == len(set(new_direct_offer_ids))
        and len(new_subscription_offer_ids) == len(set(new_subscription_offer_ids)),
        "noOfferIdCollision": not direct_id_collisions and not subscription_id_collisions,
        "noOtherDirectEvseCollision": not direct_evse_collisions,
        "overlayDirectComposed": len(overlay["directOffers"]) == expected_direct,
        "overlaySubscriptionsComposed": len(overlay["subscriptionOffers"])
        == expected_subscriptions,
        "otherDirectOffersPreservedExactly": [offer for offer in overlay["directOffers"] if not is_existing_direct(offer)]
        == retained_direct,
        "otherSubscriptionsPreservedExactly": [
            offer for offer in overlay["subscriptionOffers"] if not is_existing_subscription(offer)
        ]
        == retained_subscriptions,
        "emspPreservedExactly": overlay["emspOffers"] == baseline_emsp,
        "postChargeFeesResolved": all("postChargeFee" in offer["pricing"] for offer in [*new_direct, *new_subscriptions]),
        "subscriptionCommercialSeparation": all(
            offer["metadata"]["channel"] == "subscription"
            and offer["metadata"]["partnerRoamingScopeUnresolvedFailClosed"] is True
            for offer in new_subscriptions
        ),
        "publicationModeCorrect": (args.publish and "publicationAllowed" not in overlay)
        or (not args.publish and overlay.get("publicationAllowed") is False),
    }
    report = {
        "schemaVersion": 1,
        "publicationAllowed": bool(args.publish),
        "baseline": {
            "direct": len(baseline_direct),
            "existingNeogyDirect": len(previous_direct),
            "coreDirect": len(retained_direct),
            "subscriptions": len(baseline_subscriptions),
            "existingEasyChargeSubscriptions": len(previous_subscriptions),
            "coreSubscriptions": len(retained_subscriptions),
            "emsp": len(baseline_emsp),
        },
        "candidate": {
            "entries": len(entries),
            "currentExactNeogyEntries": len(current_entries),
            "rankableDirect": len(direct_entries),
            "unresolvedDirect": len(unresolved_entries),
            "staleIds": stale_candidate_ids,
            "wrongOperatorIds": wrong_operator_ids,
            "physicalShapeMismatches": physical_shape_mismatches,
            "compactKindDisagreementCount": len(compact_kind_disagreements),
            "compactKindDisagreementSample": compact_kind_disagreements[:50],
        },
        "overlay": {
            "direct": len(overlay["directOffers"]),
            "subscriptions": len(overlay["subscriptionOffers"]),
            "emsp": len(overlay["emspOffers"]),
            "neogyDirect": len(new_direct),
            "easyChargeLight": sum(offer["selectionId"] == "alperia_easycharge_light" for offer in new_subscriptions),
            "easyChargePlus": sum(offer["selectionId"] == "alperia_easycharge_plus" for offer in new_subscriptions),
            "directClassCounts": dict(sorted(direct_class_counts.items())),
            "directPriceCounts": {str(key): value for key, value in sorted(direct_price_counts.items())},
            "lightPriceCounts": {str(key): value for key, value in sorted(light_price_counts.items())},
            "directIdCollisions": direct_id_collisions[:50],
            "subscriptionIdCollisions": subscription_id_collisions[:50],
            "directEvseCollisions": direct_evse_collisions[:50],
        },
        "gates": gates,
    }
    Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if not all(gates.values()):
        raise SystemExit("Neogy and Alperia Italy overlay gates failed")
    Path(args.out).write_text(json.dumps(overlay, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
