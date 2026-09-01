#!/usr/bin/env python3
"""Overlay validated Repower Recharge Around prices onto Italy V9.

The canonical data-lab candidate contains connector-level prices from
Repower's official API and exact current PUN identities. Identity conflicts,
unsupported price components and ambiguous site matches stay fail-closed.
Unknown post-charge fees also remain non-comparable at runtime.
"""
from __future__ import annotations

import argparse
import gzip
import json
from collections import Counter
from pathlib import Path
from typing import Any


PROVIDER = "Repower"
OPERATOR = "Repower Vendita Italia SpA"
SOURCE_ID = "repower-italy-recharge-around-direct"
APP_SOURCE = "https://www.repower.com/it/e-mobility/recharge-around"
NETWORK_SOURCE = (
    "https://www.repower.com/it/e-mobility/network-di-ricarica/repower-charging-net"
)
API_BASE = "https://api-chargearound.repower.com/rest/api/location"
GOOGLE_PLAY = "https://play.google.com/store/apps/details?id=com.repower.rechargearound"
APP_VERSION = "3.7.6"
NETWORK_ID = "4d523120-f7c9-ec11-8103-005056b948ae"
PAID_VALID_FROM = "2024-03-20T00:00:00.00000+01:00"
SUPPORTED_RATES = {0.0, 0.48, 0.5856}


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


def is_existing_overlay(offer: dict[str, Any]) -> bool:
    return offer.get("provider") == PROVIDER and offer.get("sourceId") == SOURCE_ID


def replace_existing_overlay_preserving_order(
    baseline_direct: list[dict[str, Any]], new_offers: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Refresh this provider without reordering any other overlay."""
    new_by_id = {str(offer["id"]): offer for offer in new_offers}
    used: set[str] = set()
    composed: list[dict[str, Any]] = []
    for offer in baseline_direct:
        if not is_existing_overlay(offer):
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
    values = [
        str(value)
        for value in (baseline.get("generatedAt"), candidate.get("generatedAt"))
        if value
    ]
    return max(values) if values else None


def validate_candidate_entry(entry: dict[str, Any]) -> None:
    evse_id = str(entry.get("evseId") or "").strip()
    if not evse_id or not (evse_id.startswith("IT*REV") or evse_id.startswith("ITREP")):
        raise RuntimeError(f"invalid Repower EVSE identity {evse_id!r}")
    if entry.get("operator") != OPERATOR:
        raise RuntimeError(f"unexpected Repower operator for {evse_id}")
    method = str(entry.get("matchMethod") or "")
    if method not in {"connector_uuid", "external_id", "station_address_connector"}:
        raise RuntimeError(f"unexpected Repower match method for {evse_id}: {method!r}")
    distance = float(entry.get("distanceMeters"))
    if distance > (25 if method == "station_address_connector" else 75):
        raise RuntimeError(f"Repower identity distance exceeds policy for {evse_id}")
    if method == "station_address_connector":
        evidence = entry.get("matchEvidence") or {}
        if (
            evidence.get("addressExact") is not True
            or evidence.get("punStationCandidateCount") != 1
            or evidence.get("punEvseCandidateCount") != 1
            or evidence.get("targetHadExactIdentity") is not False
        ):
            raise RuntimeError(f"insufficient strict site evidence for {evse_id}")

    tariff = entry.get("directTariff") or {}
    try:
        rate = float(tariff.get("energyEurPerKwh"))
    except (TypeError, ValueError) as exc:
        raise RuntimeError(f"invalid Repower energy price for {evse_id}") from exc
    if rate not in SUPPORTED_RATES:
        raise RuntimeError(f"unsupported Repower energy price for {evse_id}: {rate}")
    expected_type = "free" if rate == 0 else "flat"
    if (
        tariff.get("pricingType") != expected_type
        or tariff.get("currency") != "EUR"
        or tariff.get("paymentMethod") != "one_shot"
        or tariff.get("rankable") is not True
        or tariff.get("source") != APP_SOURCE
    ):
        raise RuntimeError(f"unexpected Repower tariff shape for {evse_id}")
    if rate == 0:
        if entry.get("freeCharge") is not True or tariff.get("validFrom") is not None:
            raise RuntimeError(f"Repower free tariff lacks official free evidence for {evse_id}")
    elif entry.get("freeCharge") is True or tariff.get("validFrom") != PAID_VALID_FROM:
        raise RuntimeError(f"unexpected Repower paid tariff validity for {evse_id}")


def build_offer(entry: dict[str, Any]) -> dict[str, Any]:
    evse_id = str(entry["evseId"])
    tariff = entry["directTariff"]
    rate = float(tariff["energyEurPerKwh"])
    free = rate == 0
    metadata: dict[str, Any] = {
        "channel": "operator_direct_one_shot",
        "network": "Repower Charging Net",
        "operator": OPERATOR,
        "paymentMethod": "one_shot",
        "stationId": str(entry["stationId"]),
        "officialLocationId": str(entry["officialLocationId"]),
        "officialIdentifier": str(entry.get("officialIdentifier") or ""),
        "officialConnectorId": str(entry["officialConnectorId"]),
        "officialConnectorName": str(entry["officialConnectorName"]),
        "matchMethod": str(entry["matchMethod"]),
        "matchDistanceMeters": float(entry["distanceMeters"]),
        "timeZone": "Europe/Rome",
        "officialPriceComponentModel": (
            "official_free_flag_without_price_components"
            if free
            else "single_energy_eur_per_kwh_component"
        ),
        "officialFreeCharge": bool(entry.get("freeCharge")),
        "unknownPostChargeFeeFailClosed": True,
        "authorizationHoldExcludedFromSessionCost": True,
    }
    if entry.get("matchEvidence") is not None:
        metadata["matchEvidence"] = dict(entry["matchEvidence"])
    offer: dict[str, Any] = {
        "id": f"it:direct:repower-recharge-around:{evse_id}",
        "provider": PROVIDER,
        "evseIds": [evse_id],
        "verifiedScope": "exact_evse",
        "countries": ["IT"],
        "currency": "EUR",
        "priority": 130,
        "source": APP_SOURCE,
        "sourceId": SOURCE_ID,
        "directOperatorOnly": True,
        "pricing": {
            "type": "kwh",
            "pricePerKwh": rate,
            "postChargeFeeUnknown": True,
        },
        "metadata": metadata,
    }
    if tariff.get("validFrom"):
        offer["validFrom"] = str(tariff["validFrom"])[:10]
        offer["validityBasis"] = "session_start_local_date"
        offer["metadata"]["officialTariffValidFrom"] = str(tariff["validFrom"])
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
        raise RuntimeError("unexpected country in Repower overlay inputs")
    if (
        candidate.get("operator") != OPERATOR
        or candidate.get("dataset") != "repower-italy-v9-direct-candidate"
    ):
        raise RuntimeError("unexpected canonical Repower candidate")
    if not isinstance(rows, list) or len(rows) != 29696:
        raise RuntimeError("unexpected Italy physical catalogue")
    expected_sources = {
        "repowerApp": APP_SOURCE,
        "repowerChargingNet": NETWORK_SOURCE,
        "officialApiBase": API_BASE,
        "googlePlay": GOOGLE_PLAY,
    }
    if candidate.get("sources") != expected_sources:
        raise RuntimeError("unexpected Repower source set")
    source_snapshot = candidate.get("sourceSnapshot") or {}
    if (
        source_snapshot.get("appVersion") != APP_VERSION
        or source_snapshot.get("apiHost") != "api-chargearound.repower.com"
        or source_snapshot.get("networkId") != NETWORK_ID
    ):
        raise RuntimeError("unexpected Repower official source snapshot")

    entries = list(candidate.get("entries") or [])
    for entry in entries:
        validate_candidate_entry(entry)
    candidate_ids = [str(entry["evseId"]) for entry in entries]
    if len(candidate_ids) != len(set(candidate_ids)):
        raise RuntimeError("duplicate canonical Repower EVSE identity")

    physical = physical_evse(rows)
    physical_ids = set(physical)
    physical_repower_ids = {
        evse_id
        for evse_id, item in physical.items()
        if item["operator"].casefold() == OPERATOR.casefold()
    }
    current_entries = [entry for entry in entries if str(entry["evseId"]) in physical_repower_ids]
    current_ids = {str(entry["evseId"]) for entry in current_entries}
    stale_candidate_ids = sorted(set(candidate_ids) - physical_ids)
    wrong_operator_ids = sorted((set(candidate_ids) & physical_ids) - physical_repower_ids)
    station_id_mismatches = sorted(
        str(entry["evseId"])
        for entry in current_entries
        if physical[str(entry["evseId"])]["stationId"] != str(entry["stationId"])
    )
    new_offers = [
        build_offer(entry) for entry in sorted(current_entries, key=lambda row: str(row["evseId"]))
    ]

    baseline_direct = list(baseline.get("directOffers") or [])
    subscriptions = list(baseline.get("subscriptionOffers") or [])
    emsp = list(baseline.get("emspOffers") or [])
    previous_overlay = [offer for offer in baseline_direct if is_existing_overlay(offer)]
    retained_direct = [offer for offer in baseline_direct if not is_existing_overlay(offer)]
    retained_offer_ids = {str(offer.get("id") or "") for offer in retained_direct}
    retained_evse_ids = (
        set().union(*(exact_ids(offer) for offer in retained_direct)) if retained_direct else set()
    )
    new_offer_ids = [str(offer["id"]) for offer in new_offers]
    offer_id_collisions = sorted(retained_offer_ids & set(new_offer_ids))
    direct_evse_collisions = sorted(retained_evse_ids & current_ids)

    overlay = dict(baseline)
    overlay["generatedAt"] = latest_generated_at(baseline, candidate)
    overlay["directOffers"] = replace_existing_overlay_preserving_order(
        baseline_direct, new_offers
    )
    overlay["subscriptionOffers"] = subscriptions
    overlay["emspOffers"] = emsp
    overlay.setdefault("policy", {})["repowerRechargeAroundDirectExactEvseOnly"] = True
    overlay["policy"]["repowerOfficialConnectorPricesOnly"] = True
    overlay["policy"]["repowerUnsupportedPriceComponentsFailClosed"] = True
    overlay["policy"]["repowerAmbiguousMatchesFailClosed"] = True
    overlay["policy"]["repowerFreeChargeOfficialFlagOnly"] = True
    overlay["policy"]["repowerUnknownPostChargeFeesFailClosed"] = True
    if args.publish:
        overlay.pop("publicationAllowed", None)
    else:
        overlay["publicationAllowed"] = False

    candidate_counts = candidate.get("counts") or {}
    candidate_policy = candidate.get("policy") or {}
    match_counts = Counter(str(entry["matchMethod"]) for entry in current_entries)
    price_counts = Counter(float(offer["pricing"]["pricePerKwh"]) for offer in new_offers)
    status_counts = Counter(physical[evse_id]["status"] for evse_id in current_ids)
    strict_entries = [
        entry for entry in current_entries if entry["matchMethod"] == "station_address_connector"
    ]
    free_entries = [entry for entry in current_entries if entry.get("freeCharge") is True]
    expected_direct = len(retained_direct) + len(new_offers)
    offer_text = json.dumps(new_offers, ensure_ascii=False).casefold()
    gates = {
        "physicalStations29696": len(rows) == 29696,
        "physicalEvse75025": len(physical_ids) == 75025,
        "physicalRepower1155": len(physical_repower_ids) == 1155,
        "candidateEntries661": len(entries) == 661
        and candidate_counts.get("rankableDirectEvse") == 661,
        "candidateScopeExact": candidate_counts.get("repowerPunStations") == 982
        and candidate_counts.get("repowerPunEvse") == 1155,
        "candidateOfficialInventoryExact": candidate_counts.get("officialLocations") == 1086
        and candidate_counts.get("officialConnectors") == 1130,
        "candidateSafetyGates": all((candidate.get("safetyGates") or {}).values()),
        "candidateSafetyPolicy": candidate_policy.get("exactPunIdentifiersOnly") is True
        and candidate_policy.get("unsupportedPriceComponentsFailClosed") is True
        and candidate_policy.get("ambiguousSiteMatchesExcluded") is True,
        "currentExactRepowerEntries661": len(current_entries) == 661
        and current_ids == set(candidate_ids),
        "noStaleCandidateIdentity": not stale_candidate_ids,
        "noWrongOperatorIdentity": not wrong_operator_ids,
        "candidateStationIdentityExact": not station_id_mismatches,
        "matchMethodsExact": dict(match_counts)
        == {"connector_uuid": 302, "external_id": 349, "station_address_connector": 10},
        "strictSiteFallbackExact10": len(strict_entries) == 10
        and all(float(entry["distanceMeters"]) <= 25 for entry in strict_entries),
        "pricesExact": dict(price_counts) == {0.0: 1, 0.48: 3, 0.5856: 657},
        "officialFreeExact1": len(free_entries) == 1
        and all(float(entry["directTariff"]["energyEurPerKwh"]) == 0 for entry in free_entries),
        "baselineCoreDirectComposed": len(retained_direct) == len(baseline_direct) - len(previous_overlay),
        "baselineSubscriptions53134": len(subscriptions) == 53134,
        "baselineEmsp1678": len(emsp) == 1678,
        "previousOverlayIdempotent": len(previous_overlay) in {0, 661},
        "newOfferIdsUnique": len(new_offer_ids) == len(set(new_offer_ids)),
        "noOfferIdCollision": not offer_id_collisions,
        "noOtherDirectEvseCollision": not direct_evse_collisions,
        "overlayDirectComposed": len(overlay["directOffers"]) == expected_direct,
        "otherDirectOffersPreservedExactly": [
            offer for offer in overlay["directOffers"] if not is_existing_overlay(offer)
        ]
        == retained_direct,
        "subscriptionsPreservedExactly": overlay["subscriptionOffers"] == subscriptions,
        "emspPreservedExactly": overlay["emspOffers"] == emsp,
        "unknownPostChargeFailsClosed": all(
            offer["pricing"].get("postChargeFeeUnknown") is True for offer in new_offers
        ),
        "authorizationHoldAbsentFromPricing": all(
            "authorizationhold" not in json.dumps(offer["pricing"]).casefold()
            and "preauth" not in json.dumps(offer["pricing"]).casefold()
            for offer in new_offers
        ),
        "noCommercialChannelMasquerade": all(
            offer.get("directOperatorOnly") is True
            and offer["metadata"].get("channel") == "operator_direct_one_shot"
            for offer in new_offers
        ),
        "publicationModeCorrect": (args.publish and "publicationAllowed" not in overlay)
        or (not args.publish and overlay.get("publicationAllowed") is False),
    }
    report = {
        "schemaVersion": 1,
        "publicationAllowed": bool(args.publish),
        "baseline": {
            "direct": len(baseline_direct),
            "existingRepowerOverlay": len(previous_overlay),
            "coreDirect": len(retained_direct),
            "subscriptions": len(subscriptions),
            "emsp": len(emsp),
        },
        "candidate": {
            "entries": len(entries),
            "currentExactRepowerEntries": len(current_entries),
            "physicalRepowerEvse": len(physical_repower_ids),
            "staleIds": stale_candidate_ids,
            "wrongOperatorIds": wrong_operator_ids,
            "stationIdMismatches": station_id_mismatches,
            "matchMethodCounts": dict(sorted(match_counts.items())),
            "physicalStatusCounts": dict(sorted(status_counts.items())),
        },
        "overlay": {
            "direct": len(overlay["directOffers"]),
            "subscriptions": len(overlay["subscriptionOffers"]),
            "emsp": len(overlay["emspOffers"]),
            "repowerDirect": len(new_offers),
            "priceCounts": {str(key): value for key, value in sorted(price_counts.items())},
            "offerIdCollisions": offer_id_collisions[:50],
            "directEvseCollisions": direct_evse_collisions[:50],
        },
        "gates": gates,
    }
    Path(args.report).write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if not all(gates.values()):
        raise SystemExit("Repower Italy overlay gates failed")
    Path(args.out).write_text(
        json.dumps(overlay, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
