#!/usr/bin/env python3
from __future__ import annotations
import json, urllib.request, unicodedata
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

SOURCE = 'https://raw.githubusercontent.com/yass3705/tesla-charge-companion-data-lab/main/data/operator_direct/driveco_evse_tariffs.json'
NUMERIC_REPORT = 'https://raw.githubusercontent.com/yass3705/tesla-charge-companion-data-lab/main/reports/driveco/qualicharge_numeric_validation.json'
OUT = Path('data/driveco_evse_tariffs_v1.json')
UA = 'TeslaChargeCompanion/8 DRIVECO tariff publisher'

# First-party DRIVECO app evidence supplied 2026-08-26.
# Station: Carrefour Market - Saint-Remy-Les-Chevreuse
# Address: ZAC De Beauplan Av. des Buissons, 78470 Saint-Rémy-lès-Chevreuse
# App displays, for both 50 kW (€0.51/kWh) and 22 kW (€0.39/kWh):
#   "0,20 € / min — Frais de stationnement injustifié"
#   fees apply 15 minutes after charging ends if the vehicle is still plugged in.
SCREENSHOT_VALIDATION = {
    'sourceType': 'first_party_driveco_app_screenshot',
    'validatedAt': '2026-08-26',
    'stationName': 'Carrefour Market - Saint-Remy-Les-Chevreuse',
    'address': 'ZAC De Beauplan Av. des Buissons, 78470 Saint-Rémy-lès-Chevreuse',
    'rules': {
        'trigger': 'connected_after_charge_end',
        'graceMinutes': 15,
        'ratePerMinuteEur': 0.20,
        'validatedEnergyPrices': [
            {'powerKw': 50, 'pricePerKwhEur': 0.51},
            {'powerKw': 22, 'pricePerKwhEur': 0.39},
        ],
    },
}

def get_json(url: str):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode('utf-8'))

def now_iso():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

def canonical_evse(v):
    return ''.join(ch for ch in str(v or '').upper() if ch.isalnum())

def norm(v):
    s = unicodedata.normalize('NFD', str(v or ''))
    s = ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn').lower()
    return ' '.join(''.join(ch if ch.isalnum() else ' ' for ch in s).split())

def close(a, b, tol=1e-9):
    try:
        return abs(float(a) - float(b)) <= tol
    except (TypeError, ValueError):
        return False

def validated_single_osf(raw_osf):
    """Exact DRIVECO shape whose semantics are now proven by first-party app evidence."""
    if len(raw_osf) != 1 or not isinstance(raw_osf[0], dict):
        return False
    e = raw_osf[0]
    return (
        e.get('duration') == 0
        and e.get('interval') == 1
        and close(e.get('price'), 0.20)
        and e.get('gracePeriodBeforeOSF') == 900
    )

def is_saint_remy_screenshot_case(row, price):
    """Station-specific override proven by the supplied DRIVECO app screenshots."""
    station = norm(row.get('stationName'))
    address = norm(row.get('address'))
    location_match = (
        ('saint remy les chevreuse' in station)
        or ('saint remy les chevreuse' in address and ('beauplan' in address or '78470' in address))
    )
    if not location_match:
        return False
    power = row.get('powerKw')
    return (close(power, 50, 0.35) and close(price, 0.51)) or (close(power, 22, 0.35) and close(price, 0.39)) or (close(power, 22.08, 0.35) and close(price, 0.39))

def occupancy(validation_source):
    return {
        'trigger': 'connected_after_charge_end',
        'graceMinutes': 15,
        'ratePerMinuteEur': 0.20,
        'billingUnit': 'minute',
        'validationSource': validation_source,
    }

def main():
    src = get_json(SOURCE)
    numeric = get_json(NUMERIC_REPORT)
    assert src.get('dataset') == 'driveco-evse-direct-tariffs'
    assert src.get('policy', {}).get('operatorDirectOnly') is True
    assert src.get('policy', {}).get('roamingExcluded') is True
    assert src.get('policy', {}).get('referencePricesNeverUsedAsFallback') is True

    evses = {}
    price_counts = Counter()
    network_counts = Counter()
    rankable_count = 0
    raw_osf_count = 0
    validated_single_count = 0
    station_override_count = 0
    unresolved_multitier_count = 0

    for row in src.get('resolved', []):
        evse_id = canonical_evse(row.get('evseId'))
        tariff = row.get('tariff') or {}
        price = tariff.get('energyPriceEurPerKwh')
        if not evse_id or not isinstance(price, (int, float)):
            continue
        raw_osf = tariff.get('matrixOSF') if isinstance(tariff.get('matrixOSF'), list) else []
        if raw_osf:
            raw_osf_count += 1

        validation_source = None
        occ = None
        if not raw_osf:
            full_safe = True
        elif validated_single_osf(raw_osf):
            full_safe = True
            validation_source = 'first_party_app_validated_matrix_signature'
            occ = occupancy(validation_source)
            validated_single_count += 1
        elif is_saint_remy_screenshot_case(row, price):
            full_safe = True
            validation_source = 'first_party_app_screenshot_station_specific'
            occ = occupancy(validation_source)
            station_override_count += 1
        else:
            full_safe = False
            if len(raw_osf) > 1:
                unresolved_multitier_count += 1

        if full_safe:
            rankable_count += 1
        network = row.get('networkClass') or 'unknown'
        network_counts[network] += 1
        price_counts[(network, float(price))] += 1
        rec = {
            'stationId': row.get('stationId'),
            'stationName': row.get('stationName'),
            'address': row.get('address'),
            'postalCode': row.get('postalCode'),
            'city': row.get('city'),
            'powerKw': row.get('powerKw'),
            'networkClass': network,
            'pricePerKwhEur': float(price),
            'fixedPriceEur': tariff.get('fixedPriceEur'),
            'minimumBillingEur': tariff.get('minimumBillingEur'),
            'matrix': tariff.get('matrix') if isinstance(tariff.get('matrix'), list) else [],
            'matrixOSFRaw': raw_osf,
            'hasDynamicTarif': tariff.get('hasDynamicTarif'),
            'ecoHour': tariff.get('ecoHour'),
            'energyPriceExact': True,
            'fullSessionCostSafe': full_safe,
            'rankable': full_safe,
            'rankingBlockReason': None if full_safe else ('driveco_matrix_osf_multi_tier_semantics_unvalidated' if len(raw_osf) > 1 else 'driveco_matrix_osf_semantics_unvalidated'),
        }
        if occ:
            rec['occupancy'] = occ
        evses[evse_id] = rec

    expected = int(src.get('summary', {}).get('resolvedEnergyPriceRows') or 0)
    assert len(evses) == expected == 1601, (len(evses), expected)

    numeric_counts = Counter()
    for g in numeric.get('groups', []):
        if str(g.get('operator') or '').strip().upper() != 'DRIVECO':
            continue
        raw = g.get('rawNumericTariff')
        rows = int(g.get('rows') or 0)
        numeric_counts[str(raw)] += rows
    assert sum(numeric_counts.values()) == int(numeric.get('drivecoOperatorNumericRows') or 0) == 184

    payload = {
        'schemaVersion': '1.1.0',
        'generatedAt': now_iso(),
        'operator': 'DRIVECO',
        'country': 'FR',
        'source': SOURCE,
        'sourcePolicy': {
            'operatorDirectOnly': True,
            'includesDrivecoNetwork': True,
            'includesDrivecoPartnerNetworkWhenOperatedByDriveco': True,
            'roamingExcluded': True,
            'headlineReferencePricesNeverUsedAsFallback': True,
            'qualichargeNumericTariffsExcludedUntilVatSemanticsValidated': True,
            'matrixOSFInterpretedOnlyForValidatedPatterns': True,
            'unvalidatedMultiTierMatrixOSFExcludedFromRanking': True,
        },
        'firstPartyAppValidation': SCREENSHOT_VALIDATION,
        'validatedInventory': {
            'sourceRowCount': src.get('summary', {}).get('rowCount'),
            'exactEnergyPriceEvseCount': len(evses),
            'unresolvedSourceRows': src.get('summary', {}).get('unresolvedRows'),
            'networkClassExactCounts': dict(network_counts),
            'rawMatrixOSFEvseCount': raw_osf_count,
            'fullSessionCostSafeEvseCount': rankable_count,
            'validatedSingleMatrixEvseCount': validated_single_count,
            'saintRemyScreenshotOverrideEvseCount': station_override_count,
            'unresolvedMultiTierMatrixEvseCount': unresolved_multitier_count,
            'rankableOnlyWhenFullSessionCostKnown': True,
            'qualichargeNumericCandidateRowsHeldBack': sum(numeric_counts.values()),
            'qualichargeNumericCandidateRawCounts': dict(sorted(numeric_counts.items())),
        },
        'resolvedEnergyDistribution': [
            {'networkClass': network, 'pricePerKwhEur': price, 'evseCount': count}
            for (network, price), count in sorted(price_counts.items())
        ],
        'evses': evses,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(json.dumps(payload['validatedInventory'], ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
