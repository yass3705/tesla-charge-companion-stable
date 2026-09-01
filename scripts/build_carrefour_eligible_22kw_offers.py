#!/usr/bin/env python3
"""Map Carrefour's official participating-hypermarket list to canonical IRVE PDCs.

The official PDF is the eligibility authority. A Carrefour-looking IRVE station
that is absent from that list never receives the 0.23 EUR/kWh offer.

Matching is constrained by the technical operator printed in Carrefour's PDF
(Allego or Powerdot), optional department, and a unique name/address score.
Only already-existing canonical 22 kW PDCs receive an offer; this script cannot
create a station or PDC.
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path


ALIAS_EQUIVALENCE_MAX_DISTANCE_M = 250.0


def clean(value):
    return str(value or "").strip()


def norm(value):
    text = unicodedata.normalize("NFD", clean(value))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = text.lower().replace("s/", " sur ")
    text = re.sub(r"\bst\b", "saint", text)
    text = re.sub(r"\bste\b", "sainte", text)
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def load_json(path):
    path = Path(path)
    if path.suffix == ".gz":
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            return json.load(handle)
    return json.loads(path.read_text(encoding="utf-8"))


def dump_json(path, value, pretty=True):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix == ".gz":
        with gzip.open(path, "wt", encoding="utf-8", compresslevel=9) as handle:
            json.dump(value, handle, ensure_ascii=False, separators=(",", ":"))
    else:
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2 if pretty else None) + "\n", encoding="utf-8")


def number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def department_from_insee(value):
    value = clean(value).upper()
    if value.startswith(("2A", "2B")):
        return value[:2]
    return value[:2] if len(value) >= 2 else ""


def numeric_tail(value):
    match = re.search(r"(\d{6,})$", clean(value).upper())
    return match.group(1) if match else None


def pdc_tail_signature(rows):
    tails = [numeric_tail(row.get("pdcId") or row.get("idPdcItinerance")) for row in rows]
    if not rows or any(not tail for tail in tails) or len(set(tails)) != len(tails):
        return None
    return tuple(sorted(tails))


def haversine_m(a, b):
    try:
        lat1 = math.radians(float(a.get("latitude")))
        lon1 = math.radians(float(a.get("longitude")))
        lat2 = math.radians(float(b.get("latitude")))
        lon2 = math.radians(float(b.get("longitude")))
    except (TypeError, ValueError):
        return None
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * 6371000.0 * math.asin(math.sqrt(value))


def equivalent_station_alias(a, b, pdc_tail_signatures, max_distance_m):
    if clean(a.get("physicalOperatorId")) != clean(b.get("physicalOperatorId")):
        return False
    a_signature = pdc_tail_signatures.get(clean(a.get("stationId")))
    b_signature = pdc_tail_signatures.get(clean(b.get("stationId")))
    if not a_signature or a_signature != b_signature:
        return False
    distance = haversine_m(a, b)
    return distance is not None and distance <= max_distance_m


def parse_participants(text, operator_map):
    # Some PDF text extractors glue the last row of one page to the first row of
    # the next one. Splitting before every subsequent "Carrefour " repairs that
    # without relying on PDF page geometry.
    # Do not split the operator label "New Carrefour Powerdot" itself.
    text = re.sub(r"(?<=[^\n])(?<!New )(?=Carrefour\s)", "\n", text)
    rows = []
    seen = set()
    ignored = []
    for raw_line in text.splitlines():
        line = re.sub(r"\s+", " ", raw_line).strip()
        if not line or line.lower().startswith("nom du site"):
            continue
        operator_label = None
        format_label = None
        site_label = None
        match = re.match(r"^(Carrefour .+?)\s+HM\s+(Allego)\s*$", line, flags=re.IGNORECASE)
        if match:
            site_label, operator_label, format_label = match.group(1), match.group(2), "HM"
        else:
            match = re.match(r"^(Carrefour .+?)\s+New Carrefour\s+(Powerdot)\s*$", line, flags=re.IGNORECASE)
            if match:
                site_label, operator_label, format_label = match.group(1), match.group(2), "New Carrefour"
        if not match:
            if "carrefour" in line.lower():
                ignored.append(line)
            continue
        operator_key = next((key for key in operator_map if key.lower() == operator_label.lower()), None)
        physical_operator_id = operator_map.get(operator_key) if operator_key else None
        if not physical_operator_id:
            ignored.append(line)
            continue
        dept_match = re.findall(r"\(([0-9]{2}|2A|2B)\)", site_label, flags=re.IGNORECASE)
        department = dept_match[-1].upper() if dept_match else None
        site_label = site_label.replace("*", "").strip()
        key = (norm(site_label), physical_operator_id, department)
        if key in seen:
            continue
        seen.add(key)
        rows.append({
            "siteLabel": site_label,
            "format": format_label,
            "operatorLabel": operator_label,
            "physicalOperatorId": physical_operator_id,
            "department": department,
        })
    return rows, ignored


STOP_WORDS = {
    "carrefour", "hm", "new", "le", "la", "les", "de", "des", "du",
    "sur", "sous", "en", "au", "aux", "centre", "commercial",
}


def site_tokens(label):
    label = re.sub(r"\((?:[0-9]{2}|2A|2B)\)", " ", clean(label), flags=re.IGNORECASE)
    return [token for token in norm(label).split() if token not in STOP_WORDS]


def fuzzy_token_matches(site_token, station_tokens):
    if site_token in station_tokens:
        return 1.0
    if len(site_token) < 5:
        return 0.0
    best = 0.0
    for candidate in station_tokens:
        if len(candidate) < 5:
            continue
        ratio = SequenceMatcher(None, site_token, candidate).ratio()
        if ratio > best:
            best = ratio
    return best if best >= 0.84 else 0.0


def station_score(participant, station):
    tokens = site_tokens(participant["siteLabel"])
    hay = norm(" ".join([
        clean(station.get("name")), clean(station.get("brand")), clean(station.get("address"))
    ]))
    station_tokens = set(hay.split())
    if not tokens:
        return 0.0, []
    matches = []
    exact_count = 0
    fuzzy_count = 0
    for token in tokens:
        ratio = fuzzy_token_matches(token, station_tokens)
        if ratio == 1.0:
            exact_count += 1
            matches.append({"token": token, "mode": "exact"})
        elif ratio:
            fuzzy_count += 1
            matches.append({"token": token, "mode": "fuzzy", "ratio": round(ratio, 3)})
    weighted_matches = exact_count + fuzzy_count * 0.7
    coverage = weighted_matches / len(tokens)
    compact_site = " ".join(tokens)
    station_name = norm(station.get("name"))
    seq = SequenceMatcher(None, compact_site, station_name).ratio()
    first_bonus = 0.5 if tokens and fuzzy_token_matches(tokens[0], station_tokens) else 0.0
    phrase_bonus = 0.75 if compact_site and compact_site in hay else 0.0
    network_bonus = 0.15 if station.get("tariffNetworkId") == "carrefour-energies" else 0.0
    score = 2.0 * weighted_matches + coverage + seq + first_bonus + phrase_bonus + network_bonus
    return score, matches


def match_participant(
    participant,
    stations,
    pdc_tail_signatures=None,
    alias_max_distance_m=ALIAS_EQUIVALENCE_MAX_DISTANCE_M,
):
    pdc_tail_signatures = pdc_tail_signatures or {}
    candidates = []
    for station in stations:
        if clean(station.get("physicalOperatorId")) != participant["physicalOperatorId"]:
            continue
        if participant.get("department") and department_from_insee(station.get("codeInsee")) != participant["department"]:
            continue
        searchable = norm(" ".join([
            clean(station.get("name")), clean(station.get("brand")), clean(station.get("address"))
        ]))
        if "carrefour" not in searchable:
            continue
        score, token_matches = station_score(participant, station)
        if score > 0:
            candidates.append((score, station, token_matches))
    candidates.sort(key=lambda item: (-item[0], clean(item[1].get("stationId"))))
    if not candidates:
        return {"status": "unmatched", "station": None, "candidates": []}
    best_score, best, best_matches = candidates[0]
    # Safety thresholds intentionally favor false negatives over wrong tariffs.
    if best_score < 2.50:
        return {"status": "unmatched", "station": None, "candidates": candidates[:5]}

    # PAN may publish the same physical station under operator and retailer
    # prefixes. Collapse contenders only when they are close and expose the
    # exact same full set of terminal PDC identifiers. Name similarity alone is
    # never enough to remove an ambiguity.
    equivalent_ids = {clean(best.get("stationId"))}
    relevant = [row for row in candidates if row[0] >= 2.50]
    changed = True
    while changed:
        changed = False
        equivalents = [row[1] for row in relevant if clean(row[1].get("stationId")) in equivalent_ids]
        for _, station, _ in relevant:
            station_id = clean(station.get("stationId"))
            if station_id in equivalent_ids:
                continue
            if any(
                equivalent_station_alias(station, other, pdc_tail_signatures, alias_max_distance_m)
                for other in equivalents
            ):
                equivalent_ids.add(station_id)
                changed = True

    distinct_scores = [
        score for score, station, _ in relevant
        if clean(station.get("stationId")) not in equivalent_ids
    ]
    second_score = max(distinct_scores, default=0.0)
    if second_score >= 2.50 and best_score - second_score < 0.75:
        return {"status": "ambiguous", "station": None, "candidates": candidates[:5]}
    return {
        "status": "matched",
        "station": best,
        "score": round(best_score, 3),
        "scoreMargin": round(best_score - second_score, 3),
        "tokenMatches": best_matches,
        "aliasEquivalentStationIds": sorted(equivalent_ids - {clean(best.get("stationId"))}),
        "matchMethod": (
            "unique_exact_pdc_tail_alias_cluster"
            if len(equivalent_ids) > 1
            else "unique_station"
        ),
        "candidates": candidates[:5],
    }


def candidate_summary(candidates):
    return [
        {
            "stationId": row.get("stationId"),
            "name": row.get("name"),
            "address": row.get("address"),
            "physicalOperatorId": row.get("physicalOperatorId"),
            "score": round(score, 3),
        }
        for score, row, _ in candidates
    ]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--participants-text", required=True)
    parser.add_argument("--canonical-dir", default="build/france_irve_physical")
    parser.add_argument("--config", default="data/carrefour_energies_22kw_offer_v1.json")
    parser.add_argument("--benefits", default="data/carrefour_energies_benefits_v1.json")
    parser.add_argument("--out-dir", default="build/france_irve_offers")
    parser.add_argument("--min-match-rate", type=float, default=0.0)
    args = parser.parse_args()

    config = load_json(args.config)
    benefits = load_json(args.benefits)
    stations = load_json(Path(args.canonical_dir) / "stations.json.gz")
    charge_points = load_json(Path(args.canonical_dir) / "charge_points.json.gz")
    pdc_by_station = defaultdict(list)
    for pdc in charge_points:
        pdc_by_station[clean(pdc.get("stationId"))].append(pdc)
    pdc_tail_signatures = {
        station_id: pdc_tail_signature(rows)
        for station_id, rows in pdc_by_station.items()
    }

    text = Path(args.participants_text).read_text(encoding="utf-8", errors="replace")
    operator_map = config["policy"]["eligibleTechnicalOperators"]
    participants, ignored = parse_participants(text, operator_map)

    match_rows = []
    offers = []
    emitted_pdc_ids = set()
    counters = Counter()
    operator_counts = Counter()
    target = float(config["policy"]["targetPowerKw"])
    tolerance = float(config["policy"]["powerToleranceKw"])
    offer_cfg = config["offer"]

    for participant in participants:
        operator_counts[participant["physicalOperatorId"]] += 1
        result = match_participant(participant, stations, pdc_tail_signatures)
        counters[result["status"]] += 1
        row = {
            **participant,
            "status": result["status"],
            "canonicalStationId": None,
            "matchedPdcCount": 0,
        }
        if result["status"] != "matched":
            row["candidates"] = candidate_summary(result.get("candidates", []))
            match_rows.append(row)
            continue

        station = result["station"]
        station_id = clean(station.get("stationId"))
        row.update({
            "canonicalStationId": station_id,
            "stationAliases": station.get("physicalAliasStationIds", []),
            "matchScore": result["score"],
            "matchScoreMargin": result["scoreMargin"],
            "tokenMatches": result["tokenMatches"],
            "matchMethod": result["matchMethod"],
            "aliasEquivalentStationIds": result["aliasEquivalentStationIds"],
        })
        eligible_pdcs = []
        for pdc in pdc_by_station.get(station_id, []):
            power = number(pdc.get("powerKw"))
            if power is None or abs(power - target) > tolerance:
                continue
            eligible_pdcs.append(pdc)
        if not eligible_pdcs:
            counters["matched_without_22kw_pdc"] += 1
            row["status"] = "matched_without_22kw_pdc"
            match_rows.append(row)
            continue

        for pdc in eligible_pdcs:
            pid = clean(pdc.get("pdcId"))
            if not pid or pid in emitted_pdc_ids:
                continue
            emitted_pdc_ids.add(pid)
            offers.append({
                "offerId": f"{offer_cfg['idPrefix']}:{pid}",
                "physicalOperatorId": station.get("physicalOperatorId"),
                "tariffNetworkId": config["tariffNetworkId"],
                "provider": offer_cfg["provider"],
                "channel": config["policy"].get("channel", "direct"),
                "sourceMode": "station_evse",
                "sourceStationId": participant["siteLabel"],
                "sourceEvseId": None,
                "canonicalStationId": station_id,
                "canonicalPdcId": pid,
                "canonicalStationAliases": station.get("physicalAliasStationIds", []),
                "canonicalPdcAliases": pdc.get("physicalAliasPdcIds", []),
                "matchMethod": (
                    "official_carrefour_site_"
                    f"{result['matchMethod']}_then_22kw_pdc"
                ),
                "matchDistanceMeters": None,
                "selectors": {
                    "targetPowerKw": target,
                    "powerToleranceKw": tolerance,
                    "officialParticipantOperator": participant["operatorLabel"],
                    "department": participant.get("department"),
                    "activationSurface": config["policy"].get("activationSurface"),
                    "aliasEquivalentStationIds": result["aliasEquivalentStationIds"],
                },
                "kind": "AC",
                "minPowerKw": max(0, target - tolerance),
                "maxPowerKw": target + tolerance,
                "pricingRules": [{
                    "scope": "allDay",
                    "start": "00:00",
                    "end": "24:00",
                    "days": None,
                    "currency": offer_cfg["currency"],
                    "pricePerKwh": offer_cfg["pricePerKwh"],
                    "chargePerMinute": offer_cfg.get("chargePerMinute", 0),
                    "durationPerMinute": offer_cfg.get("durationPerMinute", 0),
                    "connectionFee": offer_cfg.get("connectionFee", 0),
                    "occupancyPerMinute": offer_cfg.get("occupancyPerMinute", 0),
                    "parkingPerMinute": offer_cfg.get("parkingPerMinute", 0),
                }],
                "subscriptionId": None,
                "validFrom": config.get("validFrom"),
                "validTo": None,
                "rankable": True,
                "blockedReasons": [],
                "sourceUrl": config.get("eligibleSitesSource"),
                "sourceUpdatedAt": config.get("verifiedAt"),
                "normalizedAt": config.get("verifiedAt"),
            })
        row["matchedPdcCount"] = len(eligible_pdcs)
        match_rows.append(row)

    total = len(participants)
    matched = counters["matched"]
    matched_with_pdc = sum(1 for row in match_rows if row["status"] == "matched" and row["matchedPdcCount"] > 0)
    match_rate = matched / total if total else 0.0
    pdc_match_rate = matched_with_pdc / total if total else 0.0
    report = {
        "schemaVersion": "1.0.0",
        "productionReady": False,
        "source": config.get("eligibleSitesSource"),
        "participantSiteCount": total,
        "participantsByPhysicalOperator": dict(operator_counts),
        "matchedSiteCount": matched,
        "matchedSiteRate": round(match_rate, 4),
        "matchedSiteWith22KwPdcCount": matched_with_pdc,
        "matchedSiteWith22KwPdcRate": round(pdc_match_rate, 4),
        "offerPdcCount": len(offers),
        "statusCounts": dict(counters),
        "aliasEquivalencePolicy": {
            "maxDistanceMeters": ALIAS_EQUIVALENCE_MAX_DISTANCE_M,
            "requiresSamePhysicalOperator": True,
            "requiresExactFullPdcNumericTailSet": True,
            "fuzzyNameOnlyMayResolveAmbiguity": False,
        },
        "ignoredCarrefourTextLines": ignored[:50],
        "matches": match_rows,
    }

    out_dir = Path(args.out_dir)
    dump_json(out_dir / "carrefour_22kw_station_offers.json.gz", offers, pretty=False)
    dump_json(out_dir / "carrefour_22kw_match_report.json", report, pretty=True)
    dump_json(out_dir / "carrefour_loyalty_benefits.json", benefits, pretty=True)
    print(json.dumps({key: value for key, value in report.items() if key not in {"matches", "ignoredCarrefourTextLines"}}, ensure_ascii=False, indent=2))

    if args.min_match_rate and pdc_match_rate < args.min_match_rate:
        raise SystemExit(
            f"Carrefour safe match rate {pdc_match_rate:.1%} below required {args.min_match_rate:.1%}; "
            "inspect carrefour_22kw_match_report.json instead of relaxing matching blindly."
        )


if __name__ == "__main__":
    main()
