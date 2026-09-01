#!/usr/bin/env python3
"""Build a fail-closed Go Electric overlay on top of the currently served Italy V9 offers.

This deliberately does NOT replace the served Italy catalogue with the smaller data-lab
consolidation candidate. It preserves existing direct offers and subscriptions exactly,
adds only validated Go Electric direct offers, and removes only legacy NextCharge/
Go Electric eMSP offers tied to exact current Go Electric EVSE identities.
"""
from __future__ import annotations

import argparse
import gzip
import json
from collections import Counter
from pathlib import Path
from typing import Any

GE = "Go Electric Stations SRLS"


def load_json(path: str) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def load_gz_json(path: str) -> dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


def offer_ids(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        oid = str(row.get("id") or "").strip()
        if not oid:
            raise SystemExit("offer without id")
        if oid in out:
            raise SystemExit(f"duplicate offer id: {oid}")
        out[oid] = row
    return out


def exact_evse_ids(row: dict[str, Any]) -> set[str]:
    return {str(x).strip() for x in (row.get("evseIds") or []) if str(x).strip()}


def is_go_electric_physical_evse(evse: dict[str, Any]) -> bool:
    # Mirror the already-audited data-lab integration rule exactly.
    # Deliberately DO NOT compact/remove separators: IT*GE*S... is not ITGES....
    return str(evse.get("evseId") or "").upper().startswith("ITGES")


def is_legacy_go_electric_nextcharge_emsp(row: dict[str, Any], ge_evse_ids: set[str]) -> bool:
    ids = exact_evse_ids(row)
    if not ids or not ids.issubset(ge_evse_ids):
        return False
    provider = str(row.get("provider") or "").strip().lower()
    source = str(row.get("source") or "").strip().lower()
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    billed_by = str(metadata.get("billedBy") or "").strip().lower()
    return (
        provider == "nextcharge"
        or "go electric stations" in billed_by
        or "ges_nextcharge" in source
        or ("nextcharge" in source and "go electric" in source)
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--baseline", required=True)
    ap.add_argument("--candidate-offers", required=True)
    ap.add_argument("--candidate-source", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--report", required=True)
    args = ap.parse_args()

    baseline = load_json(args.baseline)
    candidate = load_json(args.candidate_offers)
    source = load_gz_json(args.candidate_source)

    if baseline.get("country") != "IT" or candidate.get("country") != "IT" or source.get("country") != "IT":
        raise SystemExit("unexpected country in Italy overlay inputs")

    baseline_direct = list(baseline.get("directOffers") or [])
    baseline_subs = list(baseline.get("subscriptionOffers") or [])
    baseline_emsp = list(baseline.get("emspOffers") or [])
    candidate_ge = [x for x in (candidate.get("directOffers") or []) if x.get("provider") == GE]

    ge_energy = [x for x in candidate_ge if (x.get("pricing") or {}).get("type") == "kwh"]
    ge_session = [x for x in candidate_ge if (x.get("pricing") or {}).get("type") == "rules"]

    ge_label_ids = {
        str(evse.get("evseId") or "").strip()
        for evse in (source.get("evses") or [])
        if str(evse.get("operator") or "").strip() == GE and str(evse.get("evseId") or "").strip()
    }
    ge_physical_ids = {
        str(evse.get("evseId") or "").strip()
        for evse in (source.get("evses") or [])
        if is_go_electric_physical_evse(evse) and str(evse.get("evseId") or "").strip()
    }

    baseline_direct_by_id = offer_ids(baseline_direct)
    candidate_ge_by_id = offer_ids(candidate_ge)
    collisions = sorted(set(baseline_direct_by_id) & set(candidate_ge_by_id))

    removed_emsp: list[dict[str, Any]] = []
    retained_emsp: list[dict[str, Any]] = []
    for row in baseline_emsp:
        if is_legacy_go_electric_nextcharge_emsp(row, ge_physical_ids):
            removed_emsp.append(row)
        else:
            retained_emsp.append(row)

    overlay = dict(baseline)
    overlay["generatedAt"] = candidate.get("generatedAt") or baseline.get("generatedAt")
    overlay["directOffers"] = baseline_direct + candidate_ge
    overlay["subscriptionOffers"] = baseline_subs
    overlay["emspOffers"] = retained_emsp

    # Fail closed: the overlay artifact itself remains QA-only until a separate publish gate flips this.
    overlay["publicationAllowed"] = False

    removed_provider_counts = Counter(str(x.get("provider") or "") for x in removed_emsp)
    removed_semantics_ok = all(is_legacy_go_electric_nextcharge_emsp(x, ge_physical_ids) for x in removed_emsp)
    removed_exact_ids_ok = all(exact_evse_ids(x) and exact_evse_ids(x).issubset(ge_physical_ids) for x in removed_emsp)

    # Validate Go Electric shapes again at overlay boundary.
    ge_shape_ok = True
    preauth_absent = True
    for offer in candidate_ge:
        text = json.dumps(offer, ensure_ascii=False).lower()
        if "preauth" in text:
            preauth_absent = False
        pricing = offer.get("pricing") or {}
        if pricing.get("type") == "kwh":
            if set(pricing) - {"type", "pricePerKwh", "postChargeFee"}:
                ge_shape_ok = False
        elif pricing.get("type") == "rules":
            rules = pricing.get("rules") or []
            if len(rules) != 1:
                ge_shape_ok = False
                continue
            rule = rules[0]
            if "pricePerKwh" not in rule or "sessionFeeEur" not in rule:
                ge_shape_ok = False
            if "connectedTimePerMinuteEur" in rule or "postChargeFee" in pricing:
                ge_shape_ok = False
        else:
            ge_shape_ok = False

    expected_overlay_direct = len(baseline_direct) + len(candidate_ge)
    expected_overlay_emsp = len(baseline_emsp) - len(removed_emsp)

    report = {
        "schemaVersion": 1,
        "publicationAllowed": False,
        "baseline": {
            "direct": len(baseline_direct),
            "subscriptions": len(baseline_subs),
            "emsp": len(baseline_emsp),
            "goElectricDirect": sum(1 for x in baseline_direct if x.get("provider") == GE),
        },
        "candidate": {
            "goElectricDirect": len(candidate_ge),
            "goElectricEnergyOnly": len(ge_energy),
            "goElectricEnergyPlusSession": len(ge_session),
            "goElectricPhysicalEvseByIdentity": len(ge_physical_ids),
            "goElectricPhysicalEvseByLegacyLabel": len(ge_label_ids),
            "identityVsLabelDelta": len(ge_physical_ids - ge_label_ids),
        },
        "overlay": {
            "direct": len(overlay["directOffers"]),
            "subscriptions": len(overlay["subscriptionOffers"]),
            "emsp": len(overlay["emspOffers"]),
            "removedLegacyGoElectricEmsp": len(removed_emsp),
            "removedLegacyEmspByProvider": dict(sorted(removed_provider_counts.items())),
            "directIdCollisions": collisions[:50],
        },
        "gates": {
            "baselineDirect48409": len(baseline_direct) == 48409,
            "baselineSubscriptions50008": len(baseline_subs) == 50008,
            "baselineEmsp3959": len(baseline_emsp) == 3959,
            "baselineGoElectricDirectZero": not any(x.get("provider") == GE for x in baseline_direct),
            "goElectricPhysical2453": len(ge_physical_ids) == 2453,
            "legacyLabel2413": len(ge_label_ids) == 2413,
            "identityAddsExactly40CurrentEvse": len(ge_physical_ids - ge_label_ids) == 40,
            "goElectricDirect943": len(candidate_ge) == 943,
            "goElectricEnergyOnly816": len(ge_energy) == 816,
            "goElectricEnergyPlusSession127": len(ge_session) == 127,
            "noDirectIdCollision": not collisions,
            "baselineDirectPreservedExactly": overlay["directOffers"][: len(baseline_direct)] == baseline_direct,
            "subscriptionsPreservedExactly": overlay["subscriptionOffers"] == baseline_subs,
            "removedLegacyEmsp2281": len(removed_emsp) == 2281,
            "removedEmspExactGoElectricEvseOnly": removed_exact_ids_ok,
            "removedEmspNextChargeGoElectricSemanticsOnly": removed_semantics_ok,
            "retainedEmspCountMatches": len(retained_emsp) == expected_overlay_emsp,
            "overlayDirect49352": len(overlay["directOffers"]) == 49352 and len(overlay["directOffers"]) == expected_overlay_direct,
            "overlaySubscriptions50008": len(overlay["subscriptionOffers"]) == 50008,
            "overlayEmsp1678": len(overlay["emspOffers"]) == 1678,
            "goElectricPricingShapesSafe": ge_shape_ok,
            "preAuthAbsent": preauth_absent,
            "publicationDisabled": overlay.get("publicationAllowed") is False,
        },
    }

    Path(args.out).write_text(json.dumps(overlay, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))

    if not all(report["gates"].values()):
        raise SystemExit("Go Electric Italy overlay gates failed")


if __name__ == "__main__":
    main()
