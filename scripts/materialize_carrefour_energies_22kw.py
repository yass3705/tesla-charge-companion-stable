#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gzip
import json
import re
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path

GENERIC = {"carrefour", "energies", "energie", "recharge", "station", "borne", "bornes"}


def load_json(path):
    path = Path(path)
    if path.suffix == ".gz":
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            return json.load(handle)
    return json.loads(path.read_text(encoding="utf-8"))


def dump_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def norm(value):
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn").lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def label(value):
    return " ".join(token for token in norm(value).split() if token not in GENERIC)


def department_match(site, station):
    department = str(site.get("department") or "")
    if not department:
        return None
    text = f"{station.get('address', '')} {station.get('codeInsee', '')}"
    return bool(
        re.search(rf"\b{re.escape(department)}\d{{3}}\b", text)
        or str(station.get("codeInsee") or "").startswith(department)
    )


def score(site, station):
    query = label(site.get("siteName"))
    name = label(station.get("name"))
    address = label(station.get("address"))
    if not query or not name:
        return 0.0
    if query == name:
        base = 1.0
    elif query in name or name in query:
        base = 0.96
    else:
        query_tokens = set(query.split())
        name_tokens = set(name.split())
        address_tokens = set(address.split())
        name_jaccard = len(query_tokens & name_tokens) / len(query_tokens | name_tokens) if query_tokens | name_tokens else 0
        address_jaccard = len(query_tokens & address_tokens) / len(query_tokens | address_tokens) if query_tokens | address_tokens else 0
        base = max(
            SequenceMatcher(None, query, name).ratio(),
            0.90 * name_jaccard,
            0.82 * address_jaccard,
        )
    department = department_match(site, station)
    if department is True:
        base = min(1.0, base + 0.02)
    elif department is False:
        base = max(0.0, base - 0.03)
    return round(base, 6)


def haversine_m(first, second):
    import math
    try:
        lat1, lon1, lat2, lon2 = map(
            float,
            [first["latitude"], first["longitude"], second["latitude"], second["longitude"]],
        )
    except (TypeError, ValueError, KeyError):
        return 1e12
    radius = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    value = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(value))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--canonical-dir", required=True)
    parser.add_argument("--offer", required=True)
    parser.add_argument("--eligible-sites", required=True)
    parser.add_argument("--out-dir", required=True)
    args = parser.parse_args()

    canonical_dir = Path(args.canonical_dir)
    out_dir = Path(args.out_dir)
    stations = load_json(canonical_dir / "stations.json.gz")
    charge_points = load_json(canonical_dir / "charge_points.json.gz")
    offer = load_json(args.offer)
    eligible = load_json(args.eligible_sites)

    pdc_by_station = {}
    for pdc in charge_points:
        pdc_by_station.setdefault(pdc.get("stationId"), []).append(pdc)

    target = float(offer["policy"]["targetPowerKw"])
    tolerance = float(offer["policy"]["powerToleranceKw"])
    stations_by_operator = {}
    for station in stations:
        operator_id = station.get("physicalOperatorId")
        if not operator_id:
            continue
        target_pdcs = [
            pdc
            for pdc in pdc_by_station.get(station.get("stationId"), [])
            if pdc.get("powerKw") is not None and abs(float(pdc["powerKw"]) - target) <= tolerance
        ]
        if not target_pdcs:
            continue
        # Prevent Carrefour Market/Contact or generic Powerdot locations from inheriting
        # the hypermarket offer. Allego candidates must already look like Carrefour scope.
        if operator_id == "powerdot" and "carrefour" not in norm(station.get("name")):
            continue
        if (
            operator_id == "allego"
            and station.get("tariffNetworkId") != "carrefour-energies"
            and "carrefour" not in norm(station.get("address"))
        ):
            continue
        stations_by_operator.setdefault(operator_id, []).append(station)

    output_offers = []
    matched_sites = []
    ambiguous_sites = []
    unmatched_sites = []

    for site in eligible.get("sites", []):
        operator_id = site["expectedPhysicalOperatorId"]
        candidates = stations_by_operator.get(operator_id, [])
        ranked = sorted(
            [(score(site, station), station) for station in candidates],
            key=lambda item: (-item[0], item[1].get("stationId", "")),
        )
        strong = [
            item
            for item in ranked
            if item[0] >= 0.90 and (not ranked or item[0] >= ranked[0][0] - 0.03)
        ]
        chosen = []
        if strong:
            base = strong[0][1]
            labels = {label(station.get("name")) for _, station in strong}
            if len(strong) == 1:
                chosen = [strong[0][1]]
            elif len(labels) == 1:
                # PAN may contain a legacy and a replacement identifier for the same
                # commercial site. Identical normalized labels are treated as one site cluster.
                chosen = [station for _, station in strong]
            elif all(haversine_m(base, station) <= 250 for _, station in strong[1:]):
                chosen = [station for _, station in strong]
            else:
                ambiguous_sites.append(
                    {
                        "siteId": site["id"],
                        "siteName": site["siteName"],
                        "expectedPhysicalOperatorId": operator_id,
                        "topCandidates": [
                            {
                                "score": candidate_score,
                                "stationId": station["stationId"],
                                "name": station.get("name"),
                                "address": station.get("address"),
                            }
                            for candidate_score, station in strong[:5]
                        ],
                    }
                )
                continue
        else:
            unmatched_sites.append(
                {
                    "siteId": site["id"],
                    "siteName": site["siteName"],
                    "expectedPhysicalOperatorId": operator_id,
                    "department": site.get("department"),
                    "topCandidates": [
                        {
                            "score": candidate_score,
                            "stationId": station["stationId"],
                            "name": station.get("name"),
                            "address": station.get("address"),
                        }
                        for candidate_score, station in ranked[:3]
                    ],
                }
            )
            continue

        matched_pdc_count = 0
        for station in chosen:
            for pdc in pdc_by_station.get(station["stationId"], []):
                power = pdc.get("powerKw")
                if power is None or abs(float(power) - target) > tolerance:
                    continue
                matched_pdc_count += 1
                output_offers.append(
                    {
                        "offerId": f"{offer['offer']['idPrefix']}:{pdc['pdcId']}",
                        "physicalOperatorId": operator_id,
                        "tariffNetworkId": offer["tariffNetworkId"],
                        "provider": offer["offer"]["provider"],
                        "channel": "direct",
                        "sourceMode": "station_evse",
                        "sourceStationId": site["id"],
                        "sourceEvseId": None,
                        "canonicalStationId": station["stationId"],
                        "canonicalPdcId": pdc["pdcId"],
                        "matchMethod": "official_site_list_cluster" if len(chosen) > 1 else "official_site_list_unique",
                        "matchDistanceMeters": None,
                        "selectors": {
                            "officialEligibleSiteId": site["id"],
                            "officialSiteName": site["siteName"],
                            "expectedPhysicalOperatorId": operator_id,
                            "targetPowerKw": target,
                            "powerToleranceKw": tolerance,
                        },
                        "kind": None,
                        "minPowerKw": target - tolerance,
                        "maxPowerKw": target + tolerance,
                        "pricingRules": [
                            {
                                "scope": "allDay",
                                "start": "00:00",
                                "end": "24:00",
                                "days": None,
                                "currency": offer["offer"]["currency"],
                                "pricePerKwh": offer["offer"]["pricePerKwh"],
                                "chargePerMinute": offer["offer"]["chargePerMinute"],
                                "durationPerMinute": offer["offer"]["durationPerMinute"],
                                "connectionFee": offer["offer"]["connectionFee"],
                                "occupancyPerMinute": offer["offer"]["occupancyPerMinute"],
                                "parkingPerMinute": offer["offer"]["parkingPerMinute"],
                            }
                        ],
                        "subscriptionId": None,
                        "validFrom": offer.get("validFrom"),
                        "validTo": None,
                        "rankable": True,
                        "blockedReasons": [],
                        "sourceUrl": offer.get("source"),
                        "sourceUpdatedAt": offer.get("verifiedAt"),
                    }
                )
        matched_sites.append(
            {
                "siteId": site["id"],
                "siteName": site["siteName"],
                "expectedPhysicalOperatorId": operator_id,
                "stationIds": [station["stationId"] for station in chosen],
                "stationNames": [station.get("name") for station in chosen],
                "matchedPdcCount": matched_pdc_count,
                "matchMode": "cluster" if len(chosen) > 1 else "unique",
                "bestScore": ranked[0][0] if ranked else None,
            }
        )

    report = {
        "schemaVersion": "1.0.0",
        "productionReady": False,
        "eligibleSiteCount": len(eligible.get("sites", [])),
        "matchedSiteCount": len(matched_sites),
        "ambiguousSiteCount": len(ambiguous_sites),
        "unmatchedSiteCount": len(unmatched_sites),
        "offerPdcCount": len(output_offers),
        "matchedCanonicalStationCount": len({row["canonicalStationId"] for row in output_offers}),
        "matchedByOperator": {
            operator_id: sum(1 for row in matched_sites if row["expectedPhysicalOperatorId"] == operator_id)
            for operator_id in sorted({row["expectedPhysicalOperatorId"] for row in eligible.get("sites", [])})
        },
        "matchedSites": matched_sites,
        "ambiguousSites": ambiguous_sites,
        "unmatchedSites": unmatched_sites,
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    dump_json(out_dir / "carrefour_22kw_station_offers.json", output_offers)
    dump_json(out_dir / "carrefour_22kw_match_report.json", report)
    print(
        json.dumps(
            {key: value for key, value in report.items() if key not in {"matchedSites", "ambiguousSites", "unmatchedSites"}},
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
