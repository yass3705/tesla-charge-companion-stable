#!/usr/bin/env python3
from __future__ import annotations
import json, urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

SOURCE = 'https://raw.githubusercontent.com/yass3705/tesla-charge-companion-data-lab/main/data/operator_direct/driveco_evse_tariffs.json'
NUMERIC_REPORT = 'https://raw.githubusercontent.com/yass3705/tesla-charge-companion-data-lab/main/reports/driveco/qualicharge_numeric_validation.json'
OUT = Path('data/driveco_evse_tariffs_v1.json')
UA = 'TeslaChargeCompanion/8 DRIVECO tariff publisher'

def get_json(url: str):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode('utf-8'))

def now_iso():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

def canonical_evse(v):
    return ''.join(ch for ch in str(v or '').upper() if ch.isalnum())

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

    for row in src.get('resolved', []):
        evse_id = canonical_evse(row.get('evseId'))
        tariff = row.get('tariff') or {}
        price = tariff.get('energyPriceEurPerKwh')
        if not evse_id or not isinstance(price, (int, float)):
            continue
        raw_osf = tariff.get('matrixOSF') if isinstance(tariff.get('matrixOSF'), list) else []
        full_safe = len(raw_osf) == 0
        if raw_osf:
            raw_osf_count += 1
        if full_safe:
            rankable_count += 1
        network = row.get('networkClass') or 'unknown'
        network_counts[network] += 1
        price_counts[(network, float(price))] += 1
        evses[evse_id] = {
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
            'rankingBlockReason': None if full_safe else 'driveco_matrix_osf_semantics_unvalidated',
        }

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
        'schemaVersion': '1.0.0',
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
            'matrixOSFStoredRawAndNotInterpreted': True,
        },
        'validatedInventory': {
            'sourceRowCount': src.get('summary', {}).get('rowCount'),
            'exactEnergyPriceEvseCount': len(evses),
            'unresolvedSourceRows': src.get('summary', {}).get('unresolvedRows'),
            'networkClassExactCounts': dict(network_counts),
            'rawMatrixOSFEvseCount': raw_osf_count,
            'fullSessionCostSafeEvseCount': rankable_count,
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
