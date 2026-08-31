#!/usr/bin/env python3
"""Materialize verified Révéo direct offers on the France canonical inventory.

Safety invariants:
- PAN IRVE remains the sole physical inventory.
- Only canonical rows whose tariffNetworkId is exactly ``reveo`` qualify.
- Only the explicitly verified FR*S34 party (Hérault, outside Montpellier
  Méditerranée Métropole) is rankable in this revision.
- Public and subscriber offers stay separate; the subscriber price is emitted
  only with subscriptionId ``reveo-subscription``.
- Roaming tariffs never become direct CPO tariffs.
- Other Révéo territories stay unresolved rather than inheriting S34 prices.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import re
from collections import Counter
from pathlib import Path


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
    if scope.get("rankableTerritories") != ["S34"]:
        raise ValueError("only S34 may be rankable in this revision")

    sub = data.get("subscription") or {}
    if sub.get("selectionId") != "reveo-subscription" or sub.get("defaultSelected") is not False:
        raise ValueError("Révéo subscription selection policy invalid")
    if number(sub.get("monthlyFeeEur")) != 1.5 or number(sub.get("badgePurchaseEur")) != 12.0:
        raise ValueError("Révéo subscription terms changed")

    territory = (data.get("territories") or {}).get("S34") or {}
    if territory.get("partyId") != "FR*S34":
        raise ValueError("Révéo S34 party id missing")
    if territory.get("status") != "rankable_public_and_subscriber":
        raise ValueError("Révéo S34 must be explicitly verified")
    for profile_name in ("public", "subscriber"):
        profile = territory.get(profile_name)
        if not isinstance(profile, list) or not profile:
            raise ValueError(f"Révéo S34 {profile_name} grid missing")
    return territory, sub


def party_id_from_pdc(pdc):
    raw = clean(pdc.get("idPdcItinerance") or pdc.get("pdcId")).upper().replace(" ", "")
    match = re.match(r"^(FR\*[A-Z0-9]{3})", raw)
    return match.group(1) if match else ""


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
        # AC pricing is connector-specific and identical across normal/rapid/
        # ultra station classes in the official S34 grid. The PAN nominal PDC
        # power can represent the station/DC side, so AC must not be rejected
        # merely because the nominal PDC power exceeds 22 kW.
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


def make_offer(pdc, station, territory, subscription, profile_name, kind, band, normalized_at):
    pid = clean(pdc.get("pdcId"))
    sid = clean(pdc.get("stationId"))
    is_sub = profile_name == "subscriber"
    provider = "Révéo Abonné" if is_sub else "Révéo Direct"
    channel = "subscription" if is_sub else "direct"
    return {
        "offerId": f"reveo-s34-{profile_name}:{kind.lower()}:{pid}",
        "physicalOperatorId": pdc.get("physicalOperatorId") or station.get("physicalOperatorId"),
        "tariffNetworkId": "reveo",
        "provider": provider,
        "channel": channel,
        "sourceMode": "official_party_grid",
        "sourceStationId": None,
        "sourceEvseId": pdc.get("idPdcItinerance"),
        "canonicalStationId": sid,
        "canonicalPdcId": pid,
        "matchMethod": "exact_ocpi_party_id_FR*S34",
        "matchDistanceMeters": None,
        "selectors": {
            "territory": "S34",
            "partyId": territory.get("partyId"),
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
        "validFrom": territory.get("effectiveFrom"),
        "validTo": None,
        "rankable": True,
        "blockedReasons": [],
        "sourceUrl": "https://www.herault-energies.fr/sites/default/files/2025-04/tarifs_reveo_au_1_avril_2025_4.pdf",
        "sourceUpdatedAt": territory.get("effectiveFrom"),
        "normalizedAt": normalized_at,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--canonical-dir", default="build/france_irve_identity")
    parser.add_argument("--out-dir", default="build/france_irve_offers")
    args = parser.parse_args()

    source = load_json(args.source)
    territory, subscription = validate_source(source)
    canonical_dir = Path(args.canonical_dir)
    stations = load_json(canonical_dir / "stations.json.gz")
    pdcs = load_json(canonical_dir / "charge_points.json.gz")
    stations_by_id = {clean(row.get("stationId")): row for row in stations if row.get("stationId")}

    reveo_stations = {clean(r.get("stationId")) for r in stations if r.get("tariffNetworkId") == "reveo"}
    reveo_pdcs = [r for r in pdcs if r.get("tariffNetworkId") == "reveo"]
    s34_pdcs = [r for r in reveo_pdcs if party_id_from_pdc(r) == "FR*S34"]
    s34_station_ids = {clean(r.get("stationId")) for r in s34_pdcs}

    now = dt.datetime.now(dt.timezone.utc).isoformat()
    offers = []
    unresolved_s34 = []
    counters = Counter()

    for pdc in s34_pdcs:
        sid = clean(pdc.get("stationId"))
        station = stations_by_id.get(sid)
        if not station or station.get("tariffNetworkId") != "reveo":
            raise AssertionError(f"Révéo S34 PDC escaped network scope: {pdc.get('pdcId')}")
        kinds = connector_kinds(pdc)
        power = number(pdc.get("powerKw"))
        if not kinds or power is None:
            unresolved_s34.append({
                "canonicalPdcId": pdc.get("pdcId"),
                "canonicalStationId": sid,
                "reason": "connector_or_power_unresolved",
                "partyId": party_id_from_pdc(pdc),
            })
            continue
        long_duration = explicit_long_duration(station)
        if long_duration:
            counters["explicit_long_duration_station_pdc"] += 1
        for kind in kinds:
            for profile_name in ("public", "subscriber"):
                band = band_for(territory.get(profile_name), kind, power, long_duration=long_duration)
                if band is None:
                    counters[f"unmatched_{profile_name}_{kind.lower()}_band"] += 1
                    continue
                offers.append(make_offer(pdc, station, territory, subscription, profile_name, kind, band, now))
                counters[f"materialized_{profile_name}_{kind.lower()}"] += 1

    offers.sort(key=lambda r: (r["canonicalStationId"], r["canonicalPdcId"], r["channel"], r["kind"]))
    if len({r["offerId"] for r in offers}) != len(offers):
        raise AssertionError("duplicate Révéo canonical offerId")
    if any(r.get("tariffNetworkId") != "reveo" or r.get("matchMethod") != "exact_ocpi_party_id_FR*S34" for r in offers):
        raise AssertionError("Révéo offer escaped exact S34 scope")
    if any(r.get("channel") == "subscription" and r.get("subscriptionId") != "reveo-subscription" for r in offers):
        raise AssertionError("Révéo subscription offer escaped opt-in selection")
    if any(r.get("channel") == "direct" and r.get("subscriptionId") is not None for r in offers):
        raise AssertionError("Révéo public direct offer incorrectly requires subscription")

    covered_pdc_ids = {r["canonicalPdcId"] for r in offers}
    unresolved_other_territories = len(reveo_pdcs) - len(s34_pdcs)
    report = {
        "schemaVersion": "1.1.1",
        "dataset": "france-reveo-canonical-direct-audit",
        "productionReady": False,
        "summary": {
            "canonicalReveoStationCount": len(reveo_stations),
            "canonicalReveoPdcCount": len(reveo_pdcs),
            "canonicalS34StationCount": len(s34_station_ids),
            "canonicalS34PdcCount": len(s34_pdcs),
            "materializedOfferCount": len(offers),
            "rankableOfferCount": len(offers),
            "rankableCoveredS34PdcCount": len(covered_pdc_ids),
            "unresolvedS34PdcCount": len(s34_pdcs) - len(covered_pdc_ids),
            "unresolvedOtherTerritoryPdcCount": unresolved_other_territories,
            "physicalInventoryMutationCount": 0,
            "subscriptionMonthlyFeeEur": number(subscription.get("monthlyFeeEur")),
            "badgePurchaseEur": number(subscription.get("badgePurchaseEur")),
            "counters": dict(counters),
        },
        "unresolvedS34Examples": unresolved_s34[:100],
        "blockedTerritories": [
            {"id": key, "status": value.get("status")}
            for key, value in (source.get("territories") or {}).items()
            if key != "S34"
        ],
        "nextSteps": [
            "verify and canonicalize current direct grids for Révéo 2025 departments 09/11/46/65/66",
            "verify current direct grids for FR*S12 (Aveyron), FR*M31 (Toulouse) and FR*S48 (Lozère)",
            "keep Montpellier Métropole outside the S34 tariff family",
            "keep roaming/OCPI eMSP tariffs separate from Révéo direct CPO tariffs",
        ],
    }
    out = Path(args.out_dir)
    dump_json(out / "reveo_pdc_offers_contract_v1_1.json.gz", offers)
    dump_json(out / "reveo_materialization_report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
