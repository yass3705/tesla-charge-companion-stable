#!/usr/bin/env python3
"""Build strict last-resort tariff candidates from PAN IRVE `tarification`.

The free-text IRVE field is never authoritative over structured direct or
roaming offers. This script only identifies safe candidates; final activation
must happen after all better tariff layers have been attached.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path


PAN_STATIC_SOURCE = "https://transport.data.gouv.fr/resources/84013/download"


def clean(value):
    return str(value or "").strip()


def norm(value):
    text = unicodedata.normalize("NFD", clean(value))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return re.sub(r"\s+", " ", text.lower()).strip()


def detect_dialect(path):
    with open(path, "r", encoding="utf-8-sig", newline="") as handle:
        sample = handle.read(65536)
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        return csv.excel


def rows(path):
    dialect = detect_dialect(path)
    with open(path, "r", encoding="utf-8-sig", newline="") as handle:
        yield from csv.DictReader(handle, dialect=dialect)


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


def parse_simple_kwh(text):
    raw = clean(text)
    if not raw:
        return None, "empty"
    normalized = norm(raw)

    # Any extra tariff dimension makes a kWh-only extraction unsafe.
    unsafe_tokens = [
        "minute", " min", "/min", "heure", "/h", "session", "forfait",
        "abonn", "membre", "resident", "non resident", "parking",
        "stationnement", "occupation", "connexion", "connection",
        "a partir", "jusqu a", "selon", "variable", "voir application",
        "voir l application", "voir conditions", "gratuit puis",
    ]
    if any(token in normalized for token in unsafe_tokens):
        return None, "compound_or_conditional"

    pattern = re.compile(
        r"(?<!\d)(\d{1,2}(?:[\.,]\d{1,4})?)\s*(?:€|eur(?:os?)?)\s*(?:/|par)\s*k\s*w\s*h",
        re.IGNORECASE,
    )
    values = []
    for match in pattern.finditer(raw):
        try:
            value = float(match.group(1).replace(",", "."))
        except ValueError:
            continue
        if 0 <= value <= 5:
            values.append(round(value, 6))

    unique = sorted(set(values))
    if len(unique) == 1:
        return unique[0], "parsed_kwh"
    if len(unique) > 1:
        return None, "multiple_kwh_prices"
    return None, "text_only"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--static-csv", required=True)
    parser.add_argument("--canonical-dir", default="build/france_irve_identity")
    parser.add_argument("--out-dir", default="build/france_irve_offers")
    args = parser.parse_args()

    charge_points = load_json(Path(args.canonical_dir) / "charge_points.json.gz")
    by_itinerance = {
        clean(row.get("idPdcItinerance")): row
        for row in charge_points
        if clean(row.get("idPdcItinerance"))
    }

    best_text = {}
    for row in rows(args.static_csv):
        itinerance = clean(row.get("id_pdc_itinerance"))
        if not itinerance or itinerance not in by_itinerance:
            continue
        text = clean(row.get("tarification"))
        if text and itinerance not in best_text:
            best_text[itinerance] = text

    counters = Counter()
    candidates = []
    for itinerance, pdc in by_itinerance.items():
        raw = best_text.get(itinerance, "")
        price, status = parse_simple_kwh(raw)
        counters[status] += 1
        if not raw:
            continue
        blocked = [] if status == "parsed_kwh" else ["irve_free_text_not_unambiguous"]
        candidates.append({
            "offerId": f"irve-fallback:{pdc.get('pdcId')}",
            "physicalOperatorId": pdc.get("physicalOperatorId"),
            "tariffNetworkId": pdc.get("tariffNetworkId"),
            "provider": "IRVE fallback",
            "channel": "reference" if blocked else "direct",
            "sourceMode": "reference_only" if blocked else "network_rule",
            "sourceStationId": None,
            "sourceEvseId": itinerance,
            "canonicalStationId": pdc.get("stationId"),
            "canonicalPdcId": pdc.get("pdcId"),
            "matchMethod": "exact_pdc_itinerance",
            "matchDistanceMeters": None,
            "selectors": {"fallbackOnly": True},
            "kind": None,
            "minPowerKw": pdc.get("powerKw"),
            "maxPowerKw": pdc.get("powerKw"),
            "pricingRules": ([{
                "scope": "allDay",
                "start": "00:00",
                "end": "24:00",
                "days": None,
                "currency": "EUR",
                "pricePerKwh": price,
                "chargePerMinute": 0,
                "durationPerMinute": 0,
                "durationThresholdMinutes": 0,
                "durationCap": 0,
                "connectionFee": 0,
                "occupancyPerMinute": 0,
                "occupancyThresholdMinutes": 0,
                "occupancyCap": 0,
                "parkingPerMinute": 0,
                "notes": "Strict parse of PAN IRVE free-text tarification; activate only if no structured offer exists."
            }] if price is not None else []),
            "subscriptionId": None,
            "validFrom": None,
            "validTo": None,
            "rankable": price is not None,
            "blockedReasons": blocked,
            "rawTarification": raw,
            "parserStatus": status,
            "sourceUrl": PAN_STATIC_SOURCE,
            "sourceUpdatedAt": None,
            "normalizedAt": None,
        })

    out_dir = Path(args.out_dir)
    dump_json(out_dir / "irve_tariff_fallback_candidates.json.gz", candidates)
    report = {
        "schemaVersion": "1.0.0",
        "productionReady": False,
        "activationPolicy": "only_when_no_structured_direct_subscription_or_roaming_offer_exists",
        "pdcWithTarificationText": len(candidates),
        "rankableCandidateCount": sum(1 for row in candidates if row.get("rankable")),
        "parserStatusCounts": dict(counters),
    }
    dump_json(out_dir / "irve_tariff_fallback_report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
