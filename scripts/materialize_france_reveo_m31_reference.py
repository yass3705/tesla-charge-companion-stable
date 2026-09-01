#!/usr/bin/env python3
"""Materialize non-rankable Révéo Toulouse Métropole (M31) tariff references.

This intentionally does NOT promote a Toulouse tariff to production ranking.
Current official Révéo documentation confirms M31 is a special tariff area but
no current detailed direct grid was found. The last detailed partner publication
and recent 2026 external observations conflict on the normal AC energy price.

Safety invariants:
- PAN IRVE remains the sole physical inventory.
- Only canonical tariffNetworkId == ``reveo`` and territory M31 are eligible.
- Alizé/Toulibéo is never merged into Révéo.
- Every emitted row is reference_only / channel=reference / rankable=false.
- No subscription or roaming/eMSP tariff is promoted to a direct tariff.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import importlib.util
import json
from collections import Counter
from pathlib import Path

V2_SCRIPT = Path(__file__).with_name("materialize_france_reveo_offers_v2.py")
spec = importlib.util.spec_from_file_location("reveo_v2_for_m31", V2_SCRIPT)
v2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v2)
base = v2.base


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


def validate_review(review):
    if review.get("dataset") != "reveo-m31-tariff-review-france" or review.get("country") != "FR":
        raise ValueError("unexpected Révéo M31 review")
    if review.get("territory") != "M31" or review.get("department") != "31":
        raise ValueError("unexpected Révéo M31 territory")
    policy = review.get("policy") or {}
    if policy.get("operatorDirectOnly") is not True:
        raise ValueError("M31 review must concern the direct CPO scope")
    if policy.get("rankable") is not False:
        raise ValueError("M31 review must remain non-rankable")
    if policy.get("physicalInventoryMutationAllowed") is not False:
        raise ValueError("M31 reference must not mutate physical inventory")
    if policy.get("roamingOrEmspPromotedToDirect") is not False:
        raise ValueError("M31 roaming/eMSP promotion forbidden")
    if policy.get("alizeToulibeoMergedIntoReveo") is not False:
        raise ValueError("Alizé/Toulibéo must remain separate from Révéo")
    decision = review.get("decision") or {}
    if decision.get("status") != "reference_only_price_conflict" or decision.get("rankable") is not False:
        raise ValueError("M31 conflict decision missing")
    bands = ((review.get("lastDetailedPublishedM31Grid") or {}).get("bands") or [])
    if {row.get("key") for row in bands} != {"ac-slow", "ac-normal", "dc-50", "dc-ultra"}:
        raise ValueError("M31 historical reference bands incomplete")
    return bands, list(decision.get("blockedReasons") or [])


def make_reference(pdc, station, band, match_method, blocked, review, normalized_at):
    pid = base.clean(pdc.get("pdcId"))
    sid = base.clean(pdc.get("stationId"))
    kind = base.clean(band.get("kind")).upper()
    observed = ((review.get("recent2026Observations") or {}).get("normalAc") or {}) if band.get("key") == "ac-normal" else None
    return {
        "offerId": f"reveo-m31-reference:{kind.lower()}:{pid}",
        "physicalOperatorId": pdc.get("physicalOperatorId") or station.get("physicalOperatorId"),
        "tariffNetworkId": "reveo",
        "provider": "Révéo Toulouse Métropole — référence à vérifier",
        "channel": "reference",
        "sourceMode": "reference_only",
        "sourceStationId": None,
        "sourceEvseId": pdc.get("idPdcItinerance"),
        "canonicalStationId": sid,
        "canonicalPdcId": pid,
        "matchMethod": match_method,
        "matchDistanceMeters": None,
        "selectors": {
            "territory": "M31",
            "department": "31",
            "codeInsee": base.insee_code(station),
            "tariffKey": band.get("key"),
            "connectorKind": kind,
            "historicalReferenceEdition": (review.get("lastDetailedPublishedM31Grid") or {}).get("edition"),
            "recentObservedPricePerKwh": observed.get("pricePerKwh") if observed else None,
            "recentObservedPerMinute": observed.get("additionalPerMinute") if observed else None,
            "recentObservedChannel": observed.get("channel") if observed else None,
        },
        "kind": kind,
        "minPowerKw": band.get("minPowerKwExclusive"),
        "maxPowerKw": band.get("maxPowerKw"),
        "pricingRules": base.pricing_rules(band),
        "subscriptionId": None,
        "validFrom": None,
        "validTo": None,
        "rankable": False,
        "blockedReasons": blocked,
        "sourceUrl": (review.get("lastDetailedPublishedM31Grid") or {}).get("sourceUrl"),
        "sourceUpdatedAt": review.get("checkedAt"),
        "normalizedAt": normalized_at,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--review", default="data/reveo_m31_tariff_review_20260831.json")
    parser.add_argument("--canonical-dir", default="build/france_irve_identity")
    parser.add_argument("--out-dir", default="build/france_irve_offers")
    args = parser.parse_args()

    review = load_json(args.review)
    bands, blocked = validate_review(review)
    canonical = Path(args.canonical_dir)
    stations = load_json(canonical / "stations.json.gz")
    pdcs = load_json(canonical / "charge_points.json.gz")
    stations_by_id = {base.clean(row.get("stationId")): row for row in stations if row.get("stationId")}

    m31_candidates = []
    non_m31_reveo = 0
    for pdc in pdcs:
        if pdc.get("tariffNetworkId") != "reveo":
            continue
        station = stations_by_id.get(base.clean(pdc.get("stationId")))
        if not station or station.get("tariffNetworkId") != "reveo":
            continue
        territory, method = v2.territory_match(pdc, station)
        if territory == "M31":
            m31_candidates.append((pdc, station, method))
        else:
            non_m31_reveo += 1

    normalized_at = dt.datetime.now(dt.timezone.utc).isoformat()
    references = []
    unresolved = []
    counters = Counter()
    stations_covered = set()
    pdcs_covered = set()

    for pdc, station, method in m31_candidates:
        kinds = base.connector_kinds(pdc)
        power = base.number(pdc.get("powerKw"))
        if not kinds or power is None:
            unresolved.append({
                "canonicalPdcId": pdc.get("pdcId"),
                "canonicalStationId": pdc.get("stationId"),
                "reason": "connector_or_power_unresolved",
            })
            continue
        before = len(references)
        for kind in kinds:
            band = base.band_for(bands, kind, power, long_duration=False)
            if not band:
                counters[f"unmatched_{kind.lower()}_band"] += 1
                continue
            references.append(make_reference(pdc, station, band, method, blocked, review, normalized_at))
            counters[f"reference_{band.get('key')}"] += 1
        if len(references) > before:
            stations_covered.add(base.clean(pdc.get("stationId")))
            pdcs_covered.add(base.clean(pdc.get("pdcId")))

    references.sort(key=lambda row: (row["canonicalStationId"], row["canonicalPdcId"], row["kind"]))
    if len({row["offerId"] for row in references}) != len(references):
        raise AssertionError("duplicate M31 reference offerId")
    if any(row.get("rankable") is not False for row in references):
        raise AssertionError("M31 reference became rankable")
    if any(row.get("channel") != "reference" or row.get("sourceMode") != "reference_only" for row in references):
        raise AssertionError("M31 reference escaped reference channel")
    if any(row.get("tariffNetworkId") != "reveo" for row in references):
        raise AssertionError("M31 reference escaped Révéo network")
    if any((row.get("selectors") or {}).get("territory") != "M31" for row in references):
        raise AssertionError("M31 reference escaped territory")
    if any(row.get("subscriptionId") is not None for row in references):
        raise AssertionError("M31 reference incorrectly attached a subscription")

    report = {
        "schemaVersion": "1.0.0",
        "dataset": "france-reveo-m31-reference-audit",
        "productionReady": False,
        "summary": {
            "canonicalM31StationCount": len({base.clean(pdc.get('stationId')) for pdc, _, _ in m31_candidates}),
            "canonicalM31PdcCount": len(m31_candidates),
            "coveredReferenceStationCount": len(stations_covered),
            "coveredReferencePdcCount": len(pdcs_covered),
            "referenceOfferCount": len(references),
            "rankableOfferCount": 0,
            "unresolvedPdcCount": len(m31_candidates) - len(pdcs_covered),
            "physicalInventoryMutationCount": 0,
            "otherReveoPdcCount": non_m31_reveo,
            "counters": dict(counters),
        },
        "decision": review.get("decision"),
        "unresolvedExamples": unresolved[:50],
    }

    out = Path(args.out_dir)
    dump_json(out / "reveo_m31_reference_offers_v1_1.json.gz", references)
    dump_json(out / "reveo_m31_reference_report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
