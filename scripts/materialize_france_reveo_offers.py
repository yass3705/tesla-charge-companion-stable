#!/usr/bin/env python3
"""Materialize verified Révéo direct offers on the France canonical inventory.

Safety invariants:
- PAN IRVE remains the sole physical inventory.
- Only canonical rows whose tariffNetworkId is exactly ``reveo`` qualify.
- Territory selection is based on an exact historical OCPI party id when
  available, otherwise on the canonical five-digit INSEE commune code.
- Hérault never leaks into Montpellier Méditerranée Métropole.
- The general public grid is rankable only on departments explicitly listed in
  the source. Its historical subscriber grid stays reference-only until a
  current direct Révéo source revalidates it.
- Public and subscriber offers stay separate; subscriber offers are emitted
  only for explicitly verified territories and require ``reveo-subscription``.
- Pyrénées-Orientales and Toulouse Métropole remain blocked until their current
  special direct grids are verified.
- Roaming tariffs never become direct CPO tariffs.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import re
from collections import Counter, defaultdict
from pathlib import Path


MONTPELLIER_METRO_INSEE = {
    "34022", "34027", "34057", "34058", "34077", "34087", "34088", "34090",
    "34095", "34116", "34120", "34123", "34129", "34134", "34164", "34169",
    "34172", "34179", "34198", "34202", "34217", "34227", "34244", "34249",
    "34256", "34259", "34270", "34295", "34307", "34327", "34337",
}

PARTY_TO_TERRITORY = {
    "FR*S34": "S34",
    "FR*S12": "S12",
    "FR*S48": "S48",
    "FR*M31": "M31",
}

DEPARTMENT_TO_TERRITORY = {
    "09": "D09",
    "11": "D11",
    "12": "S12",
    "30": "D30",
    "31": "M31",
    "34": "S34",
    "46": "D46",
    "48": "S48",
    "65": "D65",
    "66": "D66",
}

EXPECTED_RANKABLE = {"S34", "D09", "D11", "S12", "D30", "D46", "S48", "D65"}


def clean(value):
    return str(value or "").strip()


def number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def truthy(value):
    return clean(value).lower() in {"1", "true", "vrai", "yes", "oui", "x"}


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


def validate_source(data):
    if data.get("dataset") != "reveo-direct-tariffs-france" or data.get("country") != "FR":
        raise ValueError("unexpected Révéo direct source")
    scope = data.get("scope") or {}
    if scope.get("operatorDirectOnly") is not True or scope.get("roamingIncluded") is not False:
        raise ValueError("Révéo direct/roaming scope invalid")
    if scope.get("roamingTariffsPromotedToDirect") is not False:
        raise ValueError("Révéo roaming must never be promoted to direct")
    if scope.get("unverifiedTerritoriesAreRankable") is not False:
        raise ValueError("unverified Révéo territories must remain blocked")
    if scope.get("subscriberOffersRequireSelection") is not True:
        raise ValueError("Révéo subscriber offers must require selection")
    if set(scope.get("rankableTerritories") or []) != EXPECTED_RANKABLE:
        raise ValueError("unexpected Révéo rankable territory set")
    if set(scope.get("rankableSubscriberTerritories") or []) != {"S34"}:
        raise ValueError("only S34 subscriber prices may be rankable")

    sub = data.get("subscription") or {}
    if sub.get("selectionId") != "reveo-subscription" or sub.get("defaultSelected") is not False:
        raise ValueError("Révéo subscription selection policy invalid")
    if number(sub.get("monthlyFeeEur")) != 1.5 or number(sub.get("badgePurchaseEur")) != 12.0:
        raise ValueError("Révéo subscription terms changed")
    if set(sub.get("verifiedRankableTerritories") or []) != {"S34"}:
        raise ValueError("Révéo subscriber scope must remain S34-only")

    families = data.get("tariffFamilies") or {}
    s34 = families.get("S34_CURRENT") or {}
    general = families.get("GENERAL_PUBLIC_CURRENT") or {}
    if s34.get("status") != "rankable_public_and_subscriber":
        raise ValueError("Révéo S34 family missing")
    if general.get("status") != "rankable_public_subscriber_reference_only":
        raise ValueError("Révéo general public family missing")
    for profile_name in ("public", "subscriber"):
        if not isinstance(s34.get(profile_name), list) or not s34.get(profile_name):
            raise ValueError(f"Révéo S34 {profile_name} grid missing")
    if not isinstance(general.get("public"), list) or not general.get("public"):
        raise ValueError("Révéo general public grid missing")
    if not isinstance(general.get("subscriberReference"), list) or not general.get("subscriberReference"):
        raise ValueError("Révéo general subscriber reference missing")

    territories = data.get("territories") or {}
    for territory_id in EXPECTED_RANKABLE:
        territory = territories.get(territory_id) or {}
        profiles = territory.get("rankableProfiles") or []
        if not profiles or "public" not in profiles:
            raise ValueError(f"Révéo {territory_id} public profile missing")
        if territory_id == "S34":
            if set(profiles) != {"public", "subscriber"} or territory.get("tariffFamily") != "S34_CURRENT":
                raise ValueError("Révéo S34 profile/family mismatch")
        else:
            if profiles != ["public"] or territory.get("tariffFamily") != "GENERAL_PUBLIC_CURRENT":
                raise ValueError(f"Révéo {territory_id} must remain public-only")
    return territories, families, sub


def party_id_from_pdc(pdc):
    raw = clean(pdc.get("idPdcItinerance") or pdc.get("pdcId")).upper().replace(" ", "")
    match = re.match(r"^(FR\*[A-Z0-9]{3})", raw)
    return match.group(1) if match else ""


def insee_code(station):
    raw = clean(station.get("codeInsee"))
    digits = "".join(ch for ch in raw if ch.isdigit())
    return digits if len(digits) == 5 else ""


def territory_match(pdc, station):
    """Return (territory_id, safe_match_method)."""
    party = party_id_from_pdc(pdc)
    if party in PARTY_TO_TERRITORY:
        territory_id = PARTY_TO_TERRITORY[party]
        if territory_id == "S34":
            return territory_id, "exact_ocpi_party_id_FR*S34"
        return territory_id, f"exact_ocpi_party_id_{party}"

    code = insee_code(station)
    if not code:
        return "", ""
    if code in MONTPELLIER_METRO_INSEE:
        return "M34", "insee_montpellier_metro_exclusion"
    department = code[:2]
    territory_id = DEPARTMENT_TO_TERRITORY.get(department, "")
    if not territory_id:
        return "", ""
    if territory_id == "S34":
        return "S34", "insee_department_34_excluding_montpellier_metro"
    return territory_id, f"insee_department_{department}"


def explicit_long_duration(station):
    corpus = " ".join(clean(station.get(k)).lower() for k in ("name", "address"))
    return any(token in corpus for token in ("longue utilisation", "longue duree", "long duration"))


def connector_kinds(pdc):
    connectors = pdc.get("connectors") or {}
    kinds = []
    if truthy(connectors.get("type2")) or truthy(connectors.get("ef")):
        kinds.append("AC")
    if truthy(connectors.get("comboCcs")) or truthy(connectors.get("chademo")):
        kinds.append("DC")
    return kinds


def band_for(profile, kind, power_kw, long_duration=False):
    for band in profile or []:
        if clean(band.get("kind")).upper() != kind:
            continue
        if band.get("longDurationOnly") is True and not long_duration:
            continue
        if band.get("excludeLongDuration") is True and long_duration:
            continue
        minimum = number(band.get("minPowerKwExclusive")) or 0.0
        maximum = number(band.get("maxPowerKw"))
        maximum = float("inf") if maximum is None else maximum
        # PAN nominal PDC power may represent the DC side of a mixed connector
        # charger. AC Type 2 pricing must therefore be capped to the 22 kW AC
        # envelope before selecting an AC price band.
        candidate_power = min(power_kw, 22.0) if kind == "AC" and power_kw is not None else power_kw
        if candidate_power is None or candidate_power <= minimum or candidate_power > maximum:
            continue
        return band
    return None


def pricing_rules(band):
    price = number(band.get("pricePerKwh"))
    fee = band.get("durationFee") or {}
    rate = number(fee.get("ratePerMinute")) or 0.0
    threshold = number(fee.get("thresholdMinutes")) or 0.0
    window = fee.get("activeWindow") or {}

    def rule(start, end, active_rate, active_threshold):
        return {
            "scope": "allDay" if start == "00:00" and end == "24:00" else "timeWindow",
            "start": start,
            "end": end,
            "days": None,
            "currency": "EUR",
            "pricePerKwh": price,
            "chargePerMinute": 0,
            "connectionFee": 0,
            "durationPerMinute": active_rate,
            "durationThresholdMinutes": active_threshold,
            "occupancyPerMinute": 0,
            "occupancyThresholdMinutes": 0,
            "occupancyCap": None,
            "parkingPerMinute": 0,
        }

    start = clean(window.get("start"))
    end = clean(window.get("end"))
    if start and end:
        rules = []
        if start != "00:00":
            rules.append(rule("00:00", start, 0, 0))
        rules.append(rule(start, end, rate, threshold))
        if end != "24:00":
            rules.append(rule(end, "24:00", 0, 0))
        return rules
    return [rule("00:00", "24:00", rate, threshold)]


def make_offer(pdc, station, territory_id, territory, family, subscription, profile_name, kind, band, normalized_at, match_method):
    pid = clean(pdc.get("pdcId"))
    sid = clean(pdc.get("stationId"))
    is_sub = profile_name == "subscriber"
    provider = "Révéo Abonné" if is_sub else "Révéo Direct"
    channel = "subscription" if is_sub else "direct"
    return {
        "offerId": f"reveo-{territory_id.lower()}-{profile_name}:{kind.lower()}:{pid}",
        "physicalOperatorId": pdc.get("physicalOperatorId") or station.get("physicalOperatorId"),
        "tariffNetworkId": "reveo",
        "provider": provider,
        "channel": channel,
        "sourceMode": "official_territory_grid",
        "sourceStationId": None,
        "sourceEvseId": pdc.get("idPdcItinerance"),
        "canonicalStationId": sid,
        "canonicalPdcId": pid,
        "matchMethod": match_method,
        "matchDistanceMeters": None,
        "selectors": {
            "territory": territory_id,
            "partyId": territory.get("partyId"),
            "department": territory.get("department"),
            "codeInsee": insee_code(station),
            "tariffFamily": territory.get("tariffFamily"),
            "tariffKey": band.get("key"),
            "connectorKind": kind,
            "explicitLongDuration": explicit_long_duration(station),
        },
        "kind": kind,
        "minPowerKw": band.get("minPowerKwExclusive"),
        "maxPowerKw": band.get("maxPowerKw"),
        "pricingRules": pricing_rules(band),
        "subscriptionId": subscription.get("selectionId") if is_sub else None,
        "subscriptionMonthlyFeeEur": number(subscription.get("monthlyFeeEur")) if is_sub else None,
        "subscriptionBadgePurchaseEur": number(subscription.get("badgePurchaseEur")) if is_sub else None,
        "validFrom": family.get("effectiveFrom"),
        "validTo": None,
        "rankable": True,
        "blockedReasons": [],
        "sourceUrl": family.get("sourceUrl"),
        "sourceUpdatedAt": family.get("currentCheckedAt") or family.get("effectiveFrom"),
        "normalizedAt": normalized_at,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--canonical-dir", default="build/france_irve_identity")
    parser.add_argument("--out-dir", default="build/france_irve_offers")
    args = parser.parse_args()

    source = load_json(args.source)
    territories, families, subscription = validate_source(source)
    canonical_dir = Path(args.canonical_dir)
    stations = load_json(canonical_dir / "stations.json.gz")
    pdcs = load_json(canonical_dir / "charge_points.json.gz")
    stations_by_id = {clean(row.get("stationId")): row for row in stations if row.get("stationId")}

    reveo_stations = {clean(r.get("stationId")) for r in stations if r.get("tariffNetworkId") == "reveo"}
    reveo_pdcs = [r for r in pdcs if r.get("tariffNetworkId") == "reveo"]

    candidates = defaultdict(list)
    blocked_counts = Counter()
    classification_counters = Counter()
    unclassified = []
    for pdc in reveo_pdcs:
        station = stations_by_id.get(clean(pdc.get("stationId")))
        if not station or station.get("tariffNetworkId") != "reveo":
            continue
        territory_id, method = territory_match(pdc, station)
        if not territory_id:
            unclassified.append(pdc)
            continue
        classification_counters[method] += 1
        territory = territories.get(territory_id) or {}
        if territory_id in EXPECTED_RANKABLE and territory.get("rankableProfiles"):
            candidates[territory_id].append((pdc, method))
        else:
            blocked_counts[territory_id] += 1

    now = dt.datetime.now(dt.timezone.utc).isoformat()
    offers = []
    unresolved = defaultdict(list)
    counters = Counter()
    covered_by_territory = defaultdict(set)
    offer_counts_by_territory = Counter()
    public_covered = set()
    subscriber_covered = set()

    for territory_id in sorted(EXPECTED_RANKABLE):
        territory = territories[territory_id]
        family = families[territory["tariffFamily"]]
        profiles = territory.get("rankableProfiles") or []
        for pdc, match_method in candidates.get(territory_id, []):
            sid = clean(pdc.get("stationId"))
            station = stations_by_id.get(sid)
            if not station or station.get("tariffNetworkId") != "reveo":
                raise AssertionError(f"Révéo {territory_id} PDC escaped network scope: {pdc.get('pdcId')}")
            kinds = connector_kinds(pdc)
            power = number(pdc.get("powerKw"))
            if not kinds or power is None:
                unresolved[territory_id].append({
                    "canonicalPdcId": pdc.get("pdcId"),
                    "canonicalStationId": sid,
                    "reason": "connector_or_power_unresolved",
                    "partyId": party_id_from_pdc(pdc),
                    "codeInsee": insee_code(station),
                    "matchMethod": match_method,
                })
                continue
            long_duration = explicit_long_duration(station)
            if long_duration:
                counters["explicit_long_duration_station_pdc"] += 1
            pdc_offer_before = len(offers)
            for kind in kinds:
                for profile_name in profiles:
                    profile_grid = family.get(profile_name)
                    if not profile_grid:
                        raise AssertionError(f"rankable Révéo profile missing: {territory_id}/{profile_name}")
                    band = band_for(profile_grid, kind, power, long_duration=long_duration)
                    if band is None:
                        counters[f"unmatched_{territory_id}_{profile_name}_{kind.lower()}_band"] += 1
                        continue
                    offer = make_offer(
                        pdc, station, territory_id, territory, family, subscription,
                        profile_name, kind, band, now, match_method
                    )
                    offers.append(offer)
                    offer_counts_by_territory[territory_id] += 1
                    counters[f"materialized_{territory_id}_{profile_name}_{kind.lower()}"] += 1
                    if profile_name == "public":
                        public_covered.add(clean(pdc.get("pdcId")))
                    else:
                        subscriber_covered.add(clean(pdc.get("pdcId")))
            if len(offers) > pdc_offer_before:
                covered_by_territory[territory_id].add(clean(pdc.get("pdcId")))

    offers.sort(key=lambda r: (r["canonicalStationId"], r["canonicalPdcId"], r["channel"], r["kind"]))
    if len({r["offerId"] for r in offers}) != len(offers):
        raise AssertionError("duplicate Révéo canonical offerId")
    if any(r.get("tariffNetworkId") != "reveo" for r in offers):
        raise AssertionError("Révéo offer escaped tariff-network scope")
    if any((r.get("selectors") or {}).get("territory") not in EXPECTED_RANKABLE for r in offers):
        raise AssertionError("Révéo offer escaped verified territory scope")
    if any((r.get("selectors") or {}).get("codeInsee") in MONTPELLIER_METRO_INSEE for r in offers):
        raise AssertionError("Montpellier Métropole incorrectly inherited Hérault S34 tariff")
    if any(r.get("channel") == "subscription" and (r.get("selectors") or {}).get("territory") != "S34" for r in offers):
        raise AssertionError("unverified Révéo subscriber territory became rankable")
    if any(r.get("channel") == "subscription" and r.get("subscriptionId") != "reveo-subscription" for r in offers):
        raise AssertionError("Révéo subscription offer escaped opt-in selection")
    if any(r.get("channel") == "direct" and r.get("subscriptionId") is not None for r in offers):
        raise AssertionError("Révéo public direct offer incorrectly requires subscription")

    territory_coverage = {}
    rankable_candidate_pdc = 0
    rankable_covered_pdc = set()
    general_station_ids = set()
    general_pdc_count = 0
    general_covered = set()
    for territory_id in sorted(EXPECTED_RANKABLE):
        rows = candidates.get(territory_id, [])
        pdc_ids = {clean(pdc.get("pdcId")) for pdc, _ in rows}
        station_ids = {clean(pdc.get("stationId")) for pdc, _ in rows}
        covered = covered_by_territory.get(territory_id, set())
        rankable_candidate_pdc += len(pdc_ids)
        rankable_covered_pdc.update(covered)
        if territory_id != "S34":
            general_station_ids.update(station_ids)
            general_pdc_count += len(pdc_ids)
            general_covered.update(covered)
        territory_coverage[territory_id] = {
            "stationCount": len(station_ids),
            "pdcCount": len(pdc_ids),
            "coveredPdcCount": len(covered),
            "unresolvedPdcCount": len(pdc_ids - covered),
            "offerCount": offer_counts_by_territory[territory_id],
            "rankableProfiles": territories[territory_id].get("rankableProfiles") or [],
            "tariffFamily": territories[territory_id].get("tariffFamily"),
        }

    s34 = territory_coverage.get("S34", {})
    blocked_total = sum(blocked_counts.values()) + len(unclassified)
    report = {
        "schemaVersion": "1.2.0",
        "dataset": "france-reveo-canonical-direct-audit",
        "productionReady": False,
        "summary": {
            "canonicalReveoStationCount": len(reveo_stations),
            "canonicalReveoPdcCount": len(reveo_pdcs),
            "canonicalS34StationCount": s34.get("stationCount", 0),
            "canonicalS34PdcCount": s34.get("pdcCount", 0),
            "rankableCoveredS34PdcCount": s34.get("coveredPdcCount", 0),
            "unresolvedS34PdcCount": s34.get("unresolvedPdcCount", 0),
            "canonicalGeneralStationCount": len(general_station_ids),
            "canonicalGeneralPdcCount": general_pdc_count,
            "rankableCoveredGeneralPdcCount": len(general_covered),
            "rankableTerritoryPdcCount": rankable_candidate_pdc,
            "rankableCoveredPdcCount": len(rankable_covered_pdc),
            "unresolvedRankablePdcCount": rankable_candidate_pdc - len(rankable_covered_pdc),
            "publicRankableCoveredPdcCount": len(public_covered),
            "subscriberRankableCoveredPdcCount": len(subscriber_covered),
            "materializedOfferCount": len(offers),
            "rankableOfferCount": len(offers),
            "publicOfferCount": sum(1 for r in offers if r.get("channel") == "direct"),
            "subscriberOfferCount": sum(1 for r in offers if r.get("channel") == "subscription"),
            "excludedMontpellierMetroPdcCount": blocked_counts.get("M34", 0),
            "blockedSpecialGridPdcCount": blocked_counts.get("D66", 0) + blocked_counts.get("M31", 0),
            "unclassifiedReveoPdcCount": len(unclassified),
            "unresolvedOtherTerritoryPdcCount": blocked_total,
            "physicalInventoryMutationCount": 0,
            "subscriptionMonthlyFeeEur": number(subscription.get("monthlyFeeEur")),
            "badgePurchaseEur": number(subscription.get("badgePurchaseEur")),
            "classificationCounters": dict(classification_counters),
            "blockedTerritoryCounters": dict(blocked_counts),
            "counters": dict(counters),
        },
        "territoryCoverage": territory_coverage,
        "unresolvedRankableExamples": {
            key: value[:50] for key, value in unresolved.items() if value
        },
        "blockedTerritories": [
            {"id": key, "status": value.get("status"), "pdcCount": blocked_counts.get(key, 0)}
            for key, value in territories.items()
            if key not in EXPECTED_RANKABLE
        ],
        "nextSteps": [
            "verify current special direct grid for Pyrénées-Orientales (D66)",
            "verify current special direct grid for Toulouse Métropole (M31)",
            "reverify current subscriber prices for the general Révéo territory before ranking them",
            "keep Montpellier Méditerranée Métropole outside the S34 tariff family",
            "keep roaming/OCPI eMSP tariffs separate from Révéo direct CPO tariffs",
        ],
    }
    out = Path(args.out_dir)
    dump_json(out / "reveo_pdc_offers_contract_v1_1.json.gz", offers)
    dump_json(out / "reveo_materialization_report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
