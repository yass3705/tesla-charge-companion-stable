#!/usr/bin/env python3
"""Overlay Ewiva's validated contactless-direct tariff onto Italy V9.

The canonical data-lab candidate contains exact PUN EVSE identities produced
from Ewiva's active-site inventory and official ``nopos_ids`` exclusion rule.
This publisher intersects that snapshot with the current served catalogue, so
stale identities and every unresolved site remain fail-closed.
"""
from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path
from typing import Any


PROVIDER = "Ewiva"
SOURCE_ID = "ewiva-italy-pos-direct"
PRICE_SOURCE = "https://ewiva.com/nuova-tariffa-agosto-2026/"
ELIGIBILITY_SOURCE = "https://ewiva.com/colonnine-ricarica/"
VALID_FROM = "2026-08-01"
PRICE_EUR_PER_KWH = 0.80


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_gz_json(path: Path) -> Any:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return json.load(handle)


def exact_ids(offer: dict[str, Any]) -> set[str]:
    return {str(value).strip() for value in offer.get("evseIds") or [] if str(value).strip()}


def physical_evse(rows: list[list[Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        operator = str(row[5] or "")
        for evse in row[8] or []:
            evse_id = str(evse[0] or "").strip()
            if not evse_id:
                continue
            if evse_id in out:
                raise RuntimeError(f"duplicate physical EVSE identity {evse_id}")
            out[evse_id] = {"row": row, "operator": operator, "kind": evse[2], "powerKw": evse[3]}
    return out


def is_existing_overlay(offer: dict[str, Any]) -> bool:
    return offer.get("provider") == PROVIDER and offer.get("sourceId") == SOURCE_ID


def replace_existing_overlay_preserving_order(
    baseline_direct: list[dict[str, Any]], new_offers: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Refresh this provider without reordering overlays from other providers."""
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
    values = [str(value) for value in (baseline.get("generatedAt"), candidate.get("generatedAt")) if value]
    return max(values) if values else None


def validate_candidate_entry(entry: dict[str, Any]) -> None:
    evse_id = str(entry.get("evseId") or "")
    if not evse_id.startswith("IT*EWI*E"):
        raise RuntimeError(f"invalid Ewiva EVSE identity {evse_id!r}")
    if entry.get("partyId") != "EWI" or entry.get("operator") != PROVIDER:
        raise RuntimeError(f"invalid Ewiva identity metadata for {evse_id}")
    site_code = str(entry.get("officialSiteCode") or "")
    if not site_code.startswith("EW_") or site_code.startswith("TEST_"):
        raise RuntimeError(f"invalid Ewiva official site code for {evse_id}: {site_code!r}")
    distance = float(entry.get("matchDistanceMeters"))
    if distance > 25:
        raise RuntimeError(f"Ewiva match exceeds 25 m for {evse_id}")
    evidence = entry.get("matchEvidence") or {}
    if evidence.get("region") is not True or not (evidence.get("city") is True or evidence.get("street") is True):
        raise RuntimeError(f"insufficient Ewiva match evidence for {evse_id}")
    tariff = entry.get("directTariff") or {}
    expected = {
        "pricingType": "flat",
        "energyEurPerKwh": PRICE_EUR_PER_KWH,
        "currency": "EUR",
        "validFrom": VALID_FROM,
        "validThrough": None,
        "paymentMethod": "contactless_pos",
        "rankable": True,
    }
    for key, value in expected.items():
        if tariff.get(key) != value:
            raise RuntimeError(f"unexpected Ewiva tariff {key} for {evse_id}: {tariff.get(key)!r}")
    if tariff.get("tariffSource") != PRICE_SOURCE:
        raise RuntimeError(f"unexpected Ewiva tariff evidence for {evse_id}")


def build_offer(entry: dict[str, Any]) -> dict[str, Any]:
    evse_id = str(entry["evseId"])
    return {
        "id": f"it:direct:ewiva-pos:{evse_id}",
        "provider": PROVIDER,
        "evseIds": [evse_id],
        "verifiedScope": "exact_evse",
        "countries": ["IT"],
        "currency": "EUR",
        "priority": 130,
        "source": PRICE_SOURCE,
        "sourceId": SOURCE_ID,
        "directOperatorOnly": True,
        "validFrom": VALID_FROM,
        "validityBasis": "session_start_local_date",
        "pricing": {
            "type": "kwh",
            "pricePerKwh": PRICE_EUR_PER_KWH,
            "postChargeFeeUnknown": True,
        },
        "metadata": {
            "channel": "operator_direct_contactless",
            "network": PROVIDER,
            "operator": PROVIDER,
            "paymentMethod": "contactless_pos",
            "officialSiteCode": str(entry["officialSiteCode"]),
            "stationId": str(entry["stationId"]),
            "matchDistanceMeters": float(entry["matchDistanceMeters"]),
            "matchEvidence": dict(entry["matchEvidence"]),
            "timeZone": "Europe/Rome",
            "eligibilitySource": ELIGIBILITY_SOURCE,
            "authorizationHoldExcludedFromSessionCost": True,
            "unknownPostChargeFeeFailClosed": True,
        },
    }


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
        raise RuntimeError("unexpected country in Ewiva overlay inputs")
    if candidate.get("operator") != PROVIDER or candidate.get("partyId") != "EWI":
        raise RuntimeError("unexpected operator in Ewiva canonical candidate")
    if not isinstance(rows, list) or len(rows) != 29696:
        raise RuntimeError("unexpected Italy physical catalogue")

    entries = list(candidate.get("entries") or [])
    for entry in entries:
        validate_candidate_entry(entry)
    candidate_ids = [str(entry["evseId"]) for entry in entries]
    if len(candidate_ids) != len(set(candidate_ids)):
        raise RuntimeError("duplicate canonical Ewiva EVSE identity")

    physical = physical_evse(rows)
    physical_ids = set(physical)
    physical_ewiva_ids = {
        evse_id
        for evse_id, item in physical.items()
        if evse_id.startswith("IT*EWI*E")
        and ("ewiva" in item["operator"].casefold() or item["operator"].casefold() == "ewi")
    }
    current_entries = [entry for entry in entries if str(entry["evseId"]) in physical_ewiva_ids]
    current_ids = {str(entry["evseId"]) for entry in current_entries}
    stale_candidate_ids = sorted(set(candidate_ids) - physical_ids)
    wrong_operator_ids = sorted((set(candidate_ids) & physical_ids) - physical_ewiva_ids)
    new_offers = [build_offer(entry) for entry in sorted(current_entries, key=lambda row: str(row["evseId"]))]

    baseline_direct = list(baseline.get("directOffers") or [])
    subscriptions = list(baseline.get("subscriptionOffers") or [])
    emsp = list(baseline.get("emspOffers") or [])
    previous_overlay = [offer for offer in baseline_direct if is_existing_overlay(offer)]
    retained_direct = [offer for offer in baseline_direct if not is_existing_overlay(offer)]
    retained_offer_ids = {str(offer.get("id") or "") for offer in retained_direct}
    retained_evse_ids = set().union(*(exact_ids(offer) for offer in retained_direct)) if retained_direct else set()
    new_offer_ids = {str(offer["id"]) for offer in new_offers}
    offer_id_collisions = sorted(retained_offer_ids & new_offer_ids)
    direct_evse_collisions = sorted(retained_evse_ids & current_ids)

    overlay = dict(baseline)
    overlay["generatedAt"] = latest_generated_at(baseline, candidate)
    overlay["directOffers"] = replace_existing_overlay_preserving_order(baseline_direct, new_offers)
    overlay["subscriptionOffers"] = subscriptions
    overlay["emspOffers"] = emsp
    overlay.setdefault("policy", {})["offerValidityDatesEnforced"] = True
    overlay["policy"]["ewivaPosDirectExactEvseOnly"] = True
    overlay["policy"]["ewivaPosEligibilityFromOfficialMap"] = True
    overlay["policy"]["ewivaPosUnmatchedAndAmbiguousFailClosed"] = True
    overlay["policy"]["ewivaDirectAndEnelEmspCommercialSeparation"] = True
    if args.publish:
        overlay.pop("publicationAllowed", None)
    else:
        overlay["publicationAllowed"] = False

    candidate_counts = candidate.get("counts") or {}
    policy = candidate.get("policy") or {}
    offer_text = json.dumps(new_offers, ensure_ascii=False).casefold()
    gates = {
        "physicalStations29696": len(rows) == 29696,
        "physicalEvse75025": len(physical_ids) == 75025,
        "physicalEwivaPartyEvse1753": len(physical_ewiva_ids) == 1753,
        "candidateEntries1271": len(entries) == 1271 and candidate_counts.get("rankableDirectEvse") == 1271,
        "candidateStrictStationCounts": candidate_counts.get("matchedPunStations") == 647 and candidate_counts.get("matchedOfficialPosSites") == 346,
        "candidateOfficialScopeCounts": candidate_counts.get("officialActivePosLocations") == 380 and candidate_counts.get("officialNoPosIdsUnique") == 72,
        "candidateSafetyPolicy": policy.get("officialNoPosIdsExcluded") is True and policy.get("ambiguousMatchesFailClosed") is True and policy.get("neverExpandPriceToAllEwivaStations") is True,
        "currentExactEwivaEntries1271": len(current_entries) == 1271 and len(current_ids) == 1271,
        "noStaleCandidateIdentity": not stale_candidate_ids,
        "noWrongOperatorIdentity": not wrong_operator_ids,
        "baselineCoreDirect49643": len(retained_direct) == 49643,
        "baselineSubscriptions50008": len(subscriptions) == 50008,
        "baselineEmsp1678": len(emsp) == 1678,
        "previousOverlayIdempotent": len(previous_overlay) in {0, 1271},
        "noOfferIdCollision": not offer_id_collisions and len(new_offer_ids) == len(new_offers),
        "noOtherDirectEvseCollision": not direct_evse_collisions,
        "overlayDirect50914": len(overlay["directOffers"]) == 50914,
        "otherDirectOffersPreservedExactly": [offer for offer in overlay["directOffers"] if not is_existing_overlay(offer)] == retained_direct,
        "subscriptionsPreservedExactly": overlay["subscriptionOffers"] == subscriptions,
        "emspPreservedExactly": overlay["emspOffers"] == emsp,
        "tariffExactly080": all((offer.get("pricing") or {}).get("pricePerKwh") == PRICE_EUR_PER_KWH for offer in new_offers),
        "validFromExact": all(offer.get("validFrom") == VALID_FROM and offer.get("validityBasis") == "session_start_local_date" for offer in new_offers),
        "unknownPostChargeFailsClosed": all((offer.get("pricing") or {}).get("postChargeFeeUnknown") is True for offer in new_offers),
        "authorizationHoldAbsentFromPricing": all("authorizationhold" not in json.dumps(offer.get("pricing") or {}).casefold() for offer in new_offers),
        "noSubscriptionOrEmspMasquerade": all(offer.get("directOperatorOnly") is True and (offer.get("metadata") or {}).get("channel") == "operator_direct_contactless" for offer in new_offers),
        "publicationModeCorrect": (args.publish and "publicationAllowed" not in overlay) or (not args.publish and overlay.get("publicationAllowed") is False),
        "candidateEvidenceRetained": all((offer.get("metadata") or {}).get("matchDistanceMeters", 999) <= 25 for offer in new_offers),
        "candidateEligibilitySourceRetained": ELIGIBILITY_SOURCE in offer_text,
    }
    report = {
        "schemaVersion": 1,
        "publicationAllowed": bool(args.publish),
        "baseline": {
            "direct": len(baseline_direct),
            "existingEwivaPosOverlay": len(previous_overlay),
            "coreDirect": len(retained_direct),
            "subscriptions": len(subscriptions),
            "emsp": len(emsp),
        },
        "candidate": {
            "entries": len(entries),
            "currentExactEwivaEntries": len(current_entries),
            "staleIds": stale_candidate_ids,
            "wrongOperatorIds": wrong_operator_ids,
        },
        "overlay": {
            "direct": len(overlay["directOffers"]),
            "subscriptions": len(overlay["subscriptionOffers"]),
            "emsp": len(overlay["emspOffers"]),
            "ewivaPosDirect": len(new_offers),
            "offerIdCollisions": offer_id_collisions[:50],
            "directEvseCollisions": direct_evse_collisions[:50],
        },
        "gates": gates,
    }
    Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if not all(gates.values()):
        raise SystemExit("Ewiva Italy POS overlay gates failed")
    Path(args.out).write_text(json.dumps(overlay, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
