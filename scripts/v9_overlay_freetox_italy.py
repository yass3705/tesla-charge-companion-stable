#!/usr/bin/env python3
"""Overlay validated Free To X card tariffs onto the served Italy V9 catalogue.

Only exact PUN EVSE identities with an unambiguous official price are emitted:
stable AC card pricing and the date-bounded <=64 kW DC promotion. The unresolved
DC/HPC population remains absent, card authorization holds are never treated as
costs, and the unknown post-charge surcharge fails closed at runtime.
"""
from __future__ import annotations

import argparse
import gzip
import json
from collections import Counter
from pathlib import Path
from typing import Any


PROVIDER = "Free To X"
OPERATOR = "Free To X S.p.A."
SOURCE_ID = "freetox-italy-card-direct"
CARD_SOURCE = "https://freeto-x.it/metodi-di-pagamento/pagamento-con-carta-di-credito/"
PROMO_SOURCE = "https://freeto-x.it/promo/"
PROMO_FROM = "2026-07-15"
PROMO_THROUGH = "2026-09-30"


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_gz_json(path: Path) -> Any:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return json.load(handle)


def exact_ids(offer: dict[str, Any]) -> set[str]:
    return {str(value).strip() for value in offer.get("evseIds") or [] if str(value).strip()}


def physical_evse_ids(rows: list[list[Any]]) -> set[str]:
    out: set[str] = set()
    for row in rows:
        for evse in row[8] or []:
            evse_id = str(evse[0] or "").strip()
            if evse_id:
                out.add(evse_id)
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
    evse_id = str(entry.get("evseId") or "").strip()
    if not evse_id or not evse_id.startswith("IT*F2X*E"):
        raise RuntimeError(f"invalid Free To X EVSE identity: {evse_id!r}")
    if entry.get("partyId") != "F2X" or entry.get("operator") not in {"F2X", OPERATOR}:
        raise RuntimeError(f"unexpected Free To X identity metadata for {evse_id}")
    if entry.get("tariffClass") not in {"AC", "DC_PROMO_LE64", "DC_GT64_UNRESOLVED"}:
        raise RuntimeError(f"unexpected tariff class for {evse_id}: {entry.get('tariffClass')}")


def build_offer(entry: dict[str, Any]) -> dict[str, Any]:
    evse_id = str(entry["evseId"])
    tariff_class = str(entry["tariffClass"])
    tariff = entry.get("directTariff")
    if entry.get("rankableDirectTariff") is not True or not isinstance(tariff, dict) or tariff.get("rankable") is not True:
        raise RuntimeError(f"attempted to publish non-rankable entry {evse_id}")
    if tariff.get("pricingType") != "flat" or float(tariff.get("energyEurPerKwh")) != 0.5:
        raise RuntimeError(f"unexpected Free To X price shape for {evse_id}")
    if tariff_class == "AC":
        if tariff.get("source") != CARD_SOURCE or tariff.get("validFrom") is not None or tariff.get("validThrough") is not None:
            raise RuntimeError(f"unexpected stable AC evidence for {evse_id}")
        if tariff.get("paymentMethod") not in {None, "credit_or_debit_card"}:
            raise RuntimeError(f"unexpected AC payment method for {evse_id}")
    elif tariff_class == "DC_PROMO_LE64":
        if float(entry.get("maxPowerKw")) > 64:
            raise RuntimeError(f"promo exceeds validated 64 kW ceiling for {evse_id}")
        if tariff.get("paymentMethod") != "credit_or_debit_card":
            raise RuntimeError(f"unexpected promotion payment method for {evse_id}")
        if tariff.get("source") != PROMO_SOURCE or tariff.get("validFrom") != PROMO_FROM or tariff.get("validThrough") != PROMO_THROUGH:
            raise RuntimeError(f"unexpected DC promotion evidence for {evse_id}")
    else:
        raise RuntimeError(f"unresolved DC/HPC entry reached publication for {evse_id}")

    offer: dict[str, Any] = {
        "id": f"it:direct:freetox-card:{evse_id}",
        "provider": PROVIDER,
        "evseIds": [evse_id],
        "verifiedScope": "exact_evse",
        "countries": ["IT"],
        "currency": "EUR",
        "priority": 130,
        "source": str(tariff["source"]),
        "sourceId": SOURCE_ID,
        "directOperatorOnly": True,
        "pricing": {
            "type": "kwh",
            "pricePerKwh": 0.5,
            "postChargeFeeUnknown": True,
        },
        "metadata": {
            "channel": "operator_direct_card",
            "operator": OPERATOR,
            "paymentMethod": "credit_or_debit_card",
            "stationId": str(entry.get("stationId") or ""),
            "tariffClass": tariff_class,
            "maxPowerKw": float(entry["maxPowerKw"]),
            "timeZone": "Europe/Rome",
            "unknownPostChargeSurchargeFailClosed": True,
        },
    }
    if tariff_class == "DC_PROMO_LE64":
        offer["validFrom"] = PROMO_FROM
        offer["validThrough"] = PROMO_THROUGH
        offer["validityBasis"] = "whole_session_local_date"
        offer["metadata"]["promotion"] = "Free To X DC card promotion up to 64 kW"
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
    physical = load_gz_json(Path(args.physical))
    candidate = load_gz_json(Path(args.candidate))
    if baseline.get("country") != "IT" or candidate.get("country") != "IT" or candidate.get("operator") != PROVIDER:
        raise RuntimeError("unexpected country/operator in Free To X overlay inputs")
    if not isinstance(physical, list) or len(physical) != 29696:
        raise RuntimeError(f"unexpected Italy physical station count: {len(physical) if isinstance(physical, list) else 'invalid'}")

    entries = list(candidate.get("evses") or [])
    for entry in entries:
        validate_candidate_entry(entry)
    candidate_ids = [str(entry["evseId"]) for entry in entries]
    if len(candidate_ids) != len(set(candidate_ids)):
        raise RuntimeError("duplicate Free To X candidate EVSE identity")

    physical_ids = physical_evse_ids(physical)
    candidate_orphans = sorted(set(candidate_ids) - physical_ids)
    rankable = [entry for entry in entries if entry.get("rankableDirectTariff") is True]
    unresolved = [entry for entry in entries if entry.get("tariffClass") == "DC_GT64_UNRESOLVED"]
    new_offers = [build_offer(entry) for entry in sorted(rankable, key=lambda row: str(row["evseId"]))]
    new_ids = [str(offer["id"]) for offer in new_offers]
    rankable_ids = {str(entry["evseId"]) for entry in rankable}
    unresolved_ids = {str(entry["evseId"]) for entry in unresolved}

    baseline_direct = list(baseline.get("directOffers") or [])
    baseline_subscriptions = list(baseline.get("subscriptionOffers") or [])
    baseline_emsp = list(baseline.get("emspOffers") or [])
    previous_overlay = [offer for offer in baseline_direct if is_existing_overlay(offer)]
    retained_direct = [offer for offer in baseline_direct if not is_existing_overlay(offer)]
    retained_offer_ids = {str(offer.get("id") or "") for offer in retained_direct}
    retained_direct_evse_ids = set().union(*(exact_ids(offer) for offer in retained_direct)) if retained_direct else set()
    id_collisions = sorted(retained_offer_ids & set(new_ids))
    evse_collisions = sorted(retained_direct_evse_ids & rankable_ids)

    overlay = dict(baseline)
    overlay["generatedAt"] = latest_generated_at(baseline, candidate)
    overlay["directOffers"] = replace_existing_overlay_preserving_order(baseline_direct, new_offers)
    overlay["subscriptionOffers"] = baseline_subscriptions
    overlay["emspOffers"] = baseline_emsp
    overlay.setdefault("policy", {})["offerValidityDatesEnforced"] = True
    overlay["policy"]["freeToXCardDirectExactEvseOnly"] = True
    overlay["policy"]["freeToXUnresolvedHighPowerFailClosed"] = True
    if args.publish:
        overlay.pop("publicationAllowed", None)
    else:
        overlay["publicationAllowed"] = False

    class_counts = Counter(str(entry.get("tariffClass")) for entry in entries)
    published_class_counts = Counter(str((offer.get("metadata") or {}).get("tariffClass")) for offer in new_offers)
    offer_text = json.dumps(new_offers, ensure_ascii=False).lower()
    candidate_counts = candidate.get("counts") or {}
    expected_direct = len(retained_direct) + len(new_offers)
    gates = {
        "physicalStations29696": len(physical) == 29696,
        "physicalEvse75025": len(physical_ids) == 75025,
        "candidateFreeToX894": len(entries) == 894 and candidate_counts.get("punF2xEvseCount") == 894,
        "candidateAllCurrentExactEvse": not candidate_orphans,
        "candidateClassCountsExact": class_counts == {"AC": 105, "DC_PROMO_LE64": 186, "DC_GT64_UNRESOLVED": 603},
        "candidateRankable291": len(rankable) == 291 and candidate_counts.get("rankableDirectEvseCount") == 291,
        "publishedAc105": published_class_counts.get("AC") == 105,
        "publishedPromoDc186": published_class_counts.get("DC_PROMO_LE64") == 186,
        "unresolvedHighPower603Absent": len(unresolved) == 603 and not (unresolved_ids & set().union(*(exact_ids(offer) for offer in new_offers))),
        "baselineCoreDirect50623": len(retained_direct) == 50623,
        "baselineSubscriptions50008": len(baseline_subscriptions) == 50008,
        "baselineEmsp1678": len(baseline_emsp) == 1678,
        "previousOverlayIdempotent": len(previous_overlay) in {0, 291},
        "noOfferIdCollision": not id_collisions and len(new_ids) == len(set(new_ids)),
        "noOtherDirectEvseCollision": not evse_collisions,
        "overlayDirect50914": len(overlay["directOffers"]) == 50914 and len(overlay["directOffers"]) == expected_direct,
        "otherDirectOffersPreservedExactly": [offer for offer in overlay["directOffers"] if not is_existing_overlay(offer)] == retained_direct,
        "subscriptionsPreservedExactly": overlay["subscriptionOffers"] == baseline_subscriptions,
        "emspPreservedExactly": overlay["emspOffers"] == baseline_emsp,
        "energyRateExactly050": all((offer.get("pricing") or {}).get("pricePerKwh") == 0.5 for offer in new_offers),
        "unknownPostChargeFailsClosed": all((offer.get("pricing") or {}).get("postChargeFeeUnknown") is True for offer in new_offers),
        "promoDatesExact": all(offer.get("validFrom") == PROMO_FROM and offer.get("validThrough") == PROMO_THROUGH and offer.get("validityBasis") == "whole_session_local_date" for offer in new_offers if (offer.get("metadata") or {}).get("tariffClass") == "DC_PROMO_LE64"),
        "authorizationHoldAbsent": "preauth" not in offer_text and "authorizationhold" not in offer_text,
        "publicationModeCorrect": (args.publish and "publicationAllowed" not in overlay) or (not args.publish and overlay.get("publicationAllowed") is False),
    }
    report = {
        "schemaVersion": 1,
        "publicationAllowed": bool(args.publish),
        "baseline": {
            "direct": len(baseline_direct),
            "existingFreeToXOverlay": len(previous_overlay),
            "coreDirect": len(retained_direct),
            "subscriptions": len(baseline_subscriptions),
            "emsp": len(baseline_emsp),
        },
        "candidate": {
            "evse": len(entries),
            "rankable": len(rankable),
            "unresolved": len(unresolved),
            "classCounts": dict(sorted(class_counts.items())),
            "orphans": candidate_orphans,
        },
        "overlay": {
            "direct": len(overlay["directOffers"]),
            "subscriptions": len(overlay["subscriptionOffers"]),
            "emsp": len(overlay["emspOffers"]),
            "freeToX": len(new_offers),
            "publishedClassCounts": dict(sorted(published_class_counts.items())),
            "idCollisions": id_collisions[:50],
            "directEvseCollisions": evse_collisions[:50],
        },
        "gates": gates,
    }

    Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if not all(gates.values()):
        raise SystemExit("Free To X Italy overlay gates failed")
    Path(args.out).write_text(json.dumps(overlay, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
