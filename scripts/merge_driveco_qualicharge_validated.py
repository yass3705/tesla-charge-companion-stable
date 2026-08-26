#!/usr/bin/env python3
from __future__ import annotations
import csv, io, json, re, urllib.request
from collections import Counter
from pathlib import Path

MAP_PATH = Path('data/driveco_evse_tariffs_v1.json')
QUALICHARGE_URL = 'https://www.data.gouv.fr/api/1/datasets/r/eb76d20a-8501-400e-b336-d85724de5435'
MANUAL_VALIDATION_URL = 'https://raw.githubusercontent.com/yass3705/tesla-charge-companion-data-lab/main/data/manual_verification/driveco_app_validation_2026-08-26.json'
RESOURCE_ID = '8bb0a6e2-1016-42ba-aaee-f72f55c82e9f'
UA = 'TeslaChargeCompanion/8 DRIVECO validated QualiCharge merger'

VALIDATED_TTC = {
    0.45: 0.54,
    0.4583: 0.55,
    0.4917: 0.59,
}


def get_bytes(url: str) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'text/csv,application/json,*/*;q=0.8'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def canonical(v):
    return ''.join(ch for ch in str(v or '').upper() if ch.isalnum())


def value(row, *names):
    d = {str(k).strip().lower(): (v or '').strip() for k, v in row.items() if k is not None}
    for n in names:
        v = d.get(n.lower())
        if v:
            return v
    return ''


def numeric_only(s):
    s = str(s or '').strip().replace(',', '.')
    if not re.fullmatch(r'\d+(?:\.\d+)?', s):
        return None
    return float(s)


def number(s):
    m = re.search(r'-?\d+(?:[,.]\d+)?', str(s or ''))
    return float(m.group(0).replace(',', '.')) if m else None


def validated_price(raw):
    for src, ttc in VALIDATED_TTC.items():
        if abs(float(raw) - src) < 1e-6:
            return ttc
    return None


def main():
    p = json.loads(MAP_PATH.read_text(encoding='utf-8'))
    assert p.get('operator') == 'DRIVECO'
    assert p.get('country') == 'FR'

    manual = json.loads(get_bytes(MANUAL_VALIDATION_URL).decode('utf-8'))
    conclusion = manual.get('conclusion') or {}
    assert conclusion.get('globalGeneralizationToKnownRawNumericValues') is True
    mappings = conclusion.get('validatedMappings') or {}
    assert mappings == {'0.45': 0.54, '0.4583': 0.55, '0.4917': 0.59}

    raw = get_bytes(QUALICHARGE_URL).decode('utf-8-sig', errors='replace')
    try:
        dialect = csv.Sniffer().sniff(raw[:30000], delimiters=',;\t')
        rows = csv.DictReader(io.StringIO(raw), dialect=dialect)
    except csv.Error:
        rows = csv.DictReader(io.StringIO(raw), delimiter=';')

    evses = p.setdefault('evses', {})
    numeric_rows = 0
    overlaps = 0
    added = 0
    raw_counts = Counter()
    added_price_counts = Counter()
    conflict_count = 0

    for row in rows:
        if value(row, 'nom_operateur').strip().upper() != 'DRIVECO':
            continue
        if value(row, 'datagouv_resource_id') and value(row, 'datagouv_resource_id') != RESOURCE_ID:
            continue
        raw_price = numeric_only(value(row, 'tarification'))
        if raw_price is None:
            continue
        ttc = validated_price(raw_price)
        if ttc is None:
            continue
        evse_id = canonical(value(row, 'id_pdc_itinerance', 'id_pdc_local', 'id_pdc'))
        if not evse_id:
            continue
        numeric_rows += 1
        raw_counts[f'{raw_price:g}'] += 1

        existing = evses.get(evse_id)
        if existing:
            overlaps += 1
            old = existing.get('pricePerKwhEur')
            if old is not None and abs(float(old) - ttc) > 0.005:
                conflict_count += 1
                raise AssertionError((evse_id, old, ttc, raw_price))
            existing['qualichargeValidatedNumeric'] = {
                'rawEurPerKwhExVat': raw_price,
                'ttcEurPerKwh': ttc,
                'vatMultiplier': 1.20,
                'resourceId': RESOURCE_ID,
                'validationSource': 'first_party_driveco_app_crosscheck_2026-08-26',
            }
            continue

        power = number(value(row, 'puissance_nominale'))
        rec = {
            'stationId': value(row, 'id_station_itinerance', 'id_station_local', 'id_station') or None,
            'stationName': value(row, 'nom_station') or None,
            'address': value(row, 'adresse_station', 'adresse') or None,
            'postalCode': value(row, 'code_postal', 'code_postal_station') or None,
            'city': value(row, 'consolidated_commune', 'nom_commune', 'commune', 'ville') or None,
            'powerKw': power,
            'networkClass': 'driveco_network',
            'pricePerKwhEur': ttc,
            'fixedPriceEur': 0.0,
            'minimumBillingEur': 0.0,
            'matrix': [],
            'matrixOSFRaw': [],
            'hasDynamicTarif': None,
            'ecoHour': None,
            'energyPriceExact': True,
            'fullSessionCostSafe': False,
            'rankable': False,
            'rankingBlockReason': 'driveco_occupancy_fee_not_available_in_qualicharge_numeric_source',
            'sourceTariffResolved': True,
            'qualichargeValidatedNumeric': {
                'rawEurPerKwhExVat': raw_price,
                'ttcEurPerKwh': ttc,
                'vatMultiplier': 1.20,
                'resourceId': RESOURCE_ID,
                'validationSource': 'first_party_driveco_app_crosscheck_2026-08-26',
            },
        }
        evses[evse_id] = rec
        added += 1
        added_price_counts[f'{ttc:.2f}'] += 1

    assert numeric_rows == 184, numeric_rows
    assert sum(raw_counts.values()) == 184
    assert raw_counts == Counter({'0.45': 6, '0.4583': 156, '0.4917': 22}), raw_counts
    assert conflict_count == 0

    inv = p.setdefault('validatedInventory', {})
    inv['qualichargeNumericCandidateRowsHeldBack'] = 0
    inv['qualichargeNumericValidatedRows'] = numeric_rows
    inv['qualichargeNumericOverlapWithExistingEvse'] = overlaps
    inv['qualichargeNumericNewExactEnergyEvse'] = added
    inv['qualichargeNumericValidatedRawCounts'] = dict(sorted(raw_counts.items()))
    inv['qualichargeNumericAddedTtcPriceCounts'] = dict(sorted(added_price_counts.items()))
    inv['exactEnergyPriceEvseCount'] = len(evses)
    inv['fullSessionCostSafeEvseCount'] = sum(1 for v in evses.values() if v.get('fullSessionCostSafe') is True)
    inv['qualichargeNumericEnergyOnlyNotRankableCount'] = sum(
        1 for v in evses.values()
        if v.get('qualichargeValidatedNumeric') and v.get('rankable') is not True
    )

    p.setdefault('sourcePolicy', {})['qualichargeNumericTariffsExcludedUntilVatSemanticsValidated'] = False
    p['sourcePolicy']['qualichargeNumericTtcTransformValidated'] = True
    p['sourcePolicy']['qualichargeNumericOccupancyNotInferred'] = True
    p['qualichargeNumericValidation'] = {
        'validatedAt': '2026-08-26',
        'resourceId': RESOURCE_ID,
        'vatMultiplier': 1.20,
        'validatedMappings': mappings,
        'manualEvidence': MANUAL_VALIDATION_URL,
        'occupancyGeneralization': False,
    }

    MAP_PATH.write_text(json.dumps(p, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(json.dumps({
        'numericRows': numeric_rows,
        'overlaps': overlaps,
        'addedExactEnergyEvse': added,
        'totalExactEnergyEvse': len(evses),
        'fullSessionSafeEvse': inv['fullSessionCostSafeEvseCount'],
        'energyOnlyNotRankable': inv['qualichargeNumericEnergyOnlyNotRankableCount'],
        'rawCounts': dict(raw_counts),
        'addedTtcPriceCounts': dict(added_price_counts),
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
