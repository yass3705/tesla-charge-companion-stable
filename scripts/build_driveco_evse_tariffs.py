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
# The app wording is identical on the verified samples: the unjustified-parking
# fee starts 15 minutes after charging ends, only while the vehicle remains plugged in.
FIRST_PARTY_APP_VALIDATION = {
    'sourceType': 'first_party_driveco_app_screenshots',
    'validatedAt': '2026-08-26',
    'commonOccupancySemantics': {
        'trigger': 'connected_after_charge_end',
        'graceMinutes': 15,
        'billingUnit': 'minute',
    },
    'samples': [
        {
            'stationName': 'Carrefour Market - Saint-Remy-Les-Chevreuse',
            'address': 'ZAC De Beauplan Av. des Buissons, 78470 Saint-Rémy-lès-Chevreuse',
            'validated': [
                {'powerKw': 50, 'pricePerKwhEur': 0.51, 'occupancyRatePerMinuteEur': 0.20},
                {'powerKw': 22, 'pricePerKwhEur': 0.39, 'occupancyRatePerMinuteEur': 0.20},
            ],
            'provesMatrixSignatures': ['single_020_after_15m', 'multi_020_after_15m'],
        },
        {
            'stationName': 'Carrefour Market - Vernouillet',
            'address': 'Rue de la Grosse Pierre, 78540 Vernouillet',
            'validated': [
                {'powerKw': 150, 'pricePerKwhEur': 0.55, 'occupancyRatePerMinuteEur': 0.30},
            ],
            'provesMatrixSignatures': ['single_030_after_15m'],
        },
        {
            'stationName': 'La Maison Villacoublay - Vélizy-Villacoublay',
            'address': '1 Rue André Citroën, 78140 Vélizy-Villacoublay',
            'validated': [
                {'powerKw': 300, 'pricePerKwhEur': 0.59, 'occupancyRatePerMinuteEur': 0.30},
                {'powerKw': 200, 'pricePerKwhEur': 0.55, 'occupancyRatePerMinuteEur': 0.30},
            ],
            'sourceTariffStatus': 'missing_in_driveco_published_source_at_validation_time',
        },
    ],
}

# Exact unresolved source EVSEs belonging to the Vélizy station proven by the app.
# We whitelist EVSE ids rather than applying a station-wide/national fallback.
VELIZY_SCREENSHOT_EVSES = {
    'FRDRVEBMNV1': (300.0, 0.59),
    'FRDRVEBMNV2': (300.0, 0.59),
    'FRDRVEGJLT1': (300.0, 0.59),
    'FRDRVEGJLT2': (300.0, 0.59),
    'FRDRVEADFZ1': (300.0, 0.59),
    'FRDRVEADFZ2': (300.0, 0.59),
    'FRDRVEDLPZ1': (200.0, 0.55),
    'FRDRVEDLPZ2': (200.0, 0.55),
    'FRDRVEDFWY1': (200.0, 0.55),
    'FRDRVEDFWY2': (200.0, 0.55),
}
VELIZY_STATION_ID = 'FRDRVPDJRZ'


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


def validated_single_osf_rate(raw_osf):
    """Return the proven occupancy rate for an exact one-entry OSF signature."""
    if len(raw_osf) != 1 or not isinstance(raw_osf[0], dict):
        return None
    e = raw_osf[0]
    if not (
        e.get('duration') == 0
        and e.get('interval') == 1
        and e.get('gracePeriodBeforeOSF') == 900
    ):
        return None
    if close(e.get('price'), 0.20):
        return 0.20
    if close(e.get('price'), 0.30):
        return 0.30
    return None


def validated_multi_osf_rate(raw_osf):
    """Return 0.20 only for the exact two-entry shape proven at Saint-Rémy.

    The DRIVECO app shows that this raw shape means a 15-minute post-charge grace
    followed by €0.20/min while still plugged in; the second zero-price entry is
    part of DRIVECO's raw OSF encoding, not a second customer-facing fee.
    """
    if len(raw_osf) != 2 or not all(isinstance(e, dict) for e in raw_osf):
        return None
    first, second = raw_osf
    if not (
        first.get('duration') == 0
        and first.get('interval') == 1
        and close(first.get('price'), 0.20)
        and first.get('gracePeriodBeforeOSF') == 900
        and second.get('duration') == 15
        and second.get('interval') == 1
        and close(second.get('price'), 0)
        and second.get('gracePeriodBeforeOSF') == 0
    ):
        return None
    return 0.20


def occupancy(rate_per_minute, validation_source):
    return {
        'trigger': 'connected_after_charge_end',
        'graceMinutes': 15,
        'ratePerMinuteEur': float(rate_per_minute),
        'billingUnit': 'minute',
        'validationSource': validation_source,
    }


def base_record(row, network, price, tariff, raw_osf, full_safe, occ=None, block_reason=None):
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
        'rankingBlockReason': None if full_safe else block_reason,
    }
    if occ:
        rec['occupancy'] = occ
    return rec


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
    validated_single_020_count = 0
    validated_single_030_count = 0
    validated_multi_020_count = 0
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
        block_reason = None
        if not raw_osf:
            full_safe = True
        else:
            rate = validated_single_osf_rate(raw_osf)
            if rate is not None:
                full_safe = True
                validation_source = f'first_party_app_validated_single_matrix_{int(round(rate * 100)):03d}'
                occ = occupancy(rate, validation_source)
                if close(rate, 0.20):
                    validated_single_020_count += 1
                elif close(rate, 0.30):
                    validated_single_030_count += 1
            else:
                rate = validated_multi_osf_rate(raw_osf)
                if rate is not None:
                    full_safe = True
                    validation_source = 'first_party_app_validated_multi_matrix_020'
                    occ = occupancy(rate, validation_source)
                    validated_multi_020_count += 1
                else:
                    full_safe = False
                    block_reason = 'driveco_matrix_osf_multi_tier_semantics_unvalidated' if len(raw_osf) > 1 else 'driveco_matrix_osf_semantics_unvalidated'
                    if len(raw_osf) > 1:
                        unresolved_multitier_count += 1

        if full_safe:
            rankable_count += 1
        network = row.get('networkClass') or 'unknown'
        network_counts[network] += 1
        price_counts[(network, float(price))] += 1
        evses[evse_id] = base_record(row, network, price, tariff, raw_osf, full_safe, occ, block_reason)

    source_resolved_count = len(evses)
    expected = int(src.get('summary', {}).get('resolvedEnergyPriceRows') or 0)
    assert source_resolved_count == expected == 1601, (source_resolved_count, expected)

    # Promote only the ten Vélizy EVSEs explicitly identified in the source inventory
    # and proven by the first-party app screenshots. No power-class or national fallback.
    promoted_count = 0
    for row in src.get('unresolved', []):
        evse_id = canonical_evse(row.get('evseId'))
        spec = VELIZY_SCREENSHOT_EVSES.get(evse_id)
        if not spec:
            continue
        assert canonical_evse(row.get('stationId')) == VELIZY_STATION_ID, (evse_id, row.get('stationId'))
        expected_power, price = spec
        assert close(row.get('powerKw'), expected_power, 0.35), (evse_id, row.get('powerKw'), expected_power)
        assert 'villacoublay' in norm(row.get('stationName'))
        assert '78140' in norm(row.get('address'))
        assert evse_id not in evses
        network = row.get('networkClass') or 'driveco_network'
        tariff = {
            'fixedPriceEur': 0.0,
            'minimumBillingEur': 0.0,
            'matrix': [],
            'hasDynamicTarif': None,
            'ecoHour': None,
        }
        occ = occupancy(0.30, 'first_party_app_screenshot_velizy_station_power_exact')
        rec = base_record(row, network, price, tariff, [], True, occ, None)
        rec['sourceTariffResolved'] = False
        rec['firstPartyPromotedFromUnresolved'] = True
        evses[evse_id] = rec
        network_counts[network] += 1
        price_counts[(network, float(price))] += 1
        rankable_count += 1
        promoted_count += 1

    assert promoted_count == len(VELIZY_SCREENSHOT_EVSES) == 10, promoted_count
    assert len(evses) == 1611, len(evses)

    # Guard the exact signatures observed during validation. New signatures remain blocked
    # until separately proven rather than silently inheriting a rule.
    assert validated_single_020_count == 715, validated_single_020_count
    assert validated_single_030_count == 172, validated_single_030_count
    assert validated_multi_020_count == 710, validated_multi_020_count
    assert unresolved_multitier_count == 4, unresolved_multitier_count
    assert rankable_count == 1607, rankable_count

    numeric_counts = Counter()
    for g in numeric.get('groups', []):
        if str(g.get('operator') or '').strip().upper() != 'DRIVECO':
            continue
        raw = g.get('rawNumericTariff')
        rows = int(g.get('rows') or 0)
        numeric_counts[str(raw)] += rows
    assert sum(numeric_counts.values()) == int(numeric.get('drivecoOperatorNumericRows') or 0) == 184

    source_unresolved = int(src.get('summary', {}).get('unresolvedRows') or 0)
    payload = {
        'schemaVersion': '1.2.0',
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
            'unvalidatedMatrixOSFExcludedFromRanking': True,
            'firstPartyScreenshotPromotionOnlyByWhitelistedEvse': True,
        },
        'firstPartyAppValidation': FIRST_PARTY_APP_VALIDATION,
        'validatedInventory': {
            'sourceRowCount': src.get('summary', {}).get('rowCount'),
            'sourceResolvedEnergyEvseCount': source_resolved_count,
            'sourceUnresolvedRows': source_unresolved,
            'firstPartyPromotedUnresolvedEvseCount': promoted_count,
            'remainingUnresolvedSourceRows': source_unresolved - promoted_count,
            'exactEnergyPriceEvseCount': len(evses),
            'networkClassExactCounts': dict(network_counts),
            'rawMatrixOSFEvseCount': raw_osf_count,
            'fullSessionCostSafeEvseCount': rankable_count,
            'validatedSingleMatrix020EvseCount': validated_single_020_count,
            'validatedSingleMatrix030EvseCount': validated_single_030_count,
            'validatedMultiTierMatrix020EvseCount': validated_multi_020_count,
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
