#!/usr/bin/env python3
import argparse
import gzip
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


def load(path):
    path = Path(path)
    if path.suffix == '.gz':
        with gzip.open(path, 'rt', encoding='utf-8') as handle:
            return json.load(handle)
    return json.loads(path.read_text(encoding='utf-8'))


def status(exact, candidates):
    if exact > 0:
        return 'exact_runtime_aliases_available'
    if candidates > 0:
        return 'review_only_no_exact_runtime_alias'
    return 'no_evidence'


def walk(obj, path=''):
    if isinstance(obj, dict):
        yield path, obj
        for key, value in obj.items():
            child = f'{path}.{key}' if path else str(key)
            yield from walk(value, child)
    elif isinstance(obj, list):
        for index, value in enumerate(obj):
            yield from walk(value, f'{path}[{index}]')


def pricing_key_profile(obj):
    tokens = ('tariff', 'tarification', 'price', 'pricing', 'cost', 'rate', 'fee')
    counts = Counter()
    samples = []
    for path, record in walk(obj):
        if not isinstance(record, dict):
            continue
        for key, value in record.items():
            normalized = str(key).lower().replace('_', '').replace('-', '')
            if any(token in normalized for token in tokens):
                counts[str(key)] += 1
                if len(samples) < 20 and value not in (None, '', [], {}):
                    text = str(value)
                    if len(text) > 160:
                        text = text[:157] + '...'
                    samples.append({'path': f'{path}.{key}' if path else str(key), 'value': text})
    return dict(sorted(counts.items())), samples


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--overlay', default='data/v9/france-provider-crosswalk.json')
    ap.add_argument('--candidates', default='data/v9/france-crosswalk-candidates.json')
    ap.add_argument('--output', default='data/v9/france-provider-alias-coverage-report.json')
    ap.add_argument('--avia-index', default='data-lab/data/national/avia_volt_picoty_station_index.json')
    ap.add_argument('--avia-direct', default='data-lab/data/national/avia_picoty_direct_stations_france.json.gz')
    args = ap.parse_args()

    overlay = load(args.overlay)
    candidates = load(args.candidates)
    assert overlay.get('kind') == 'provider-crosswalk-overlay'
    assert candidates.get('policy') == 'review_only_never_runtime'

    exact_aliases = defaultdict(set)
    exact_stations = defaultdict(set)
    exact_files = defaultdict(set)
    for entry in overlay.get('entries', []):
        cid = entry.get('canonicalId')
        for source in entry.get('sourceIds', []) or []:
            provider = str(source.get('source') or '').strip()
            sid = str(source.get('id') or '').strip()
            if not provider or not sid:
                continue
            assert source.get('match') == 'exact_irve_identifier', source
            exact_aliases[provider].add((cid, sid))
            exact_stations[provider].add(cid)
            if source.get('file'):
                exact_files[provider].add(source['file'])

    candidate_counts = Counter()
    candidate_kinds = defaultdict(Counter)
    candidate_files = defaultdict(set)
    for row in candidates.get('candidates', []) or []:
        provider = str(row.get('provider') or '').strip()
        if not provider:
            continue
        candidate_counts[provider] += 1
        candidate_kinds[provider][str(row.get('kind') or 'unknown')] += 1
        if row.get('file'):
            candidate_files[provider].add(row['file'])

    providers = sorted(set(exact_aliases) | set(candidate_counts))
    rows = []
    for provider in providers:
        exact = len(exact_aliases[provider])
        stations = len(exact_stations[provider])
        review = candidate_counts[provider]
        rows.append({
            'provider': provider,
            'status': status(exact, review),
            'exactRuntimeAliasCount': exact,
            'exactCanonicalStationCount': stations,
            'reviewOnlyCandidateCount': review,
            'reviewOnlyCandidateKinds': dict(sorted(candidate_kinds[provider].items())),
            'exactSourceFiles': sorted(exact_files[provider]),
            'candidateSourceFiles': sorted(candidate_files[provider]),
        })

    by_provider = {row['provider']: row for row in rows}
    avia_ids = set(exact_stations['avia-picoty']) | set(exact_stations['avia-volt'])
    avia_dual = set(exact_stations['avia-picoty']) & set(exact_stations['avia-volt'])
    focus = {}
    for provider in ('avia-picoty', 'avia-volt', 'bump', 'powerdot'):
        focus[provider] = by_provider.get(provider, {
            'provider': provider,
            'status': 'no_evidence',
            'exactRuntimeAliasCount': 0,
            'exactCanonicalStationCount': 0,
            'reviewOnlyCandidateCount': 0,
            'reviewOnlyCandidateKinds': {},
            'exactSourceFiles': [],
            'candidateSourceFiles': [],
        })

    avia_readiness = {
        'identityStatus': 'exact_runtime_identity_available' if avia_ids else 'identity_unresolved',
        'exactCanonicalStationCount': len(avia_ids),
        'dualConfirmedCanonicalStationCount': len(avia_dual),
        'directTariffStatus': 'not_assessed',
        'irveTariffFallbackStatus': 'not_assessed',
        'runtimeTariffEligible': False,
        'reason': 'No tariff may be activated from identity alone.',
    }
    index_path = Path(args.avia_index)
    if index_path.exists():
        index = load(index_path)
        counts = index.get('counts', {}) or {}
        station_count = int(counts.get('stationCount') or 0)
        pdc_count = int(counts.get('panRowsMatched') or 0)
        pdc_with_tariff = int(counts.get('pdcWithTarificationRaw') or 0)
        stations_with_tariff = int(counts.get('stationsWithTarificationRaw') or 0)
        avia_readiness['irveIndex'] = {
            'source': args.avia_index,
            'stationCount': station_count,
            'pdcCount': pdc_count,
            'pdcWithTarificationRaw': pdc_with_tariff,
            'stationsWithTarificationRaw': stations_with_tariff,
        }
        avia_readiness['irveTariffFallbackStatus'] = (
            'raw_tariff_available_requires_compilation' if pdc_with_tariff > 0 or stations_with_tariff > 0
            else 'unavailable_no_raw_tarification'
        )

    direct_path = Path(args.avia_direct)
    if direct_path.exists():
        direct = load(direct_path)
        keys, samples = pricing_key_profile(direct)
        avia_readiness['directSnapshot'] = {
            'source': args.avia_direct,
            'pricingLikeKeys': keys,
            'nonEmptyPricingLikeSamples': samples,
        }
        meaningful = bool(samples)
        avia_readiness['directTariffStatus'] = (
            'pricing_signals_present_requires_semantic_validation' if meaningful
            else 'unavailable_no_nonempty_pricing_signal'
        )

    direct_ready = avia_readiness['directTariffStatus'] == 'validated_direct_tariffs_available'
    fallback_ready = avia_readiness['irveTariffFallbackStatus'] == 'compiled_irve_fallback_available'
    avia_readiness['runtimeTariffEligible'] = bool(avia_ids) and (direct_ready or fallback_ready)
    if not avia_ids:
        avia_readiness['reason'] = 'No exact canonical AVIA identity is available.'
    elif direct_ready:
        avia_readiness['reason'] = 'Exact identity and validated direct AVIA tariff are available.'
    elif fallback_ready:
        avia_readiness['reason'] = 'Exact identity and compiled IRVE fallback tariff are available.'
    else:
        avia_readiness['reason'] = 'Exact AVIA identity exists, but no validated rankable tariff source is currently available; keep stations visible without inventing a price.'

    output = {
        'schemaVersion': 2,
        'country': 'FR',
        'generatedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'policy': {
            'runtimeExactOnly': True,
            'geographicCandidatesReviewOnly': True,
            'noTariffActivationFromProximity': True,
            'providerAliasDoesNotImplyTariffAvailability': True,
            'noSyntheticNetworkWideTariff': True,
        },
        'summary': {
            'providerCount': len(rows),
            'totalExactRuntimeAliases': sum(r['exactRuntimeAliasCount'] for r in rows),
            'totalExactCanonicalStations': len({cid for values in exact_stations.values() for cid in values}),
            'totalReviewOnlyCandidates': sum(r['reviewOnlyCandidateCount'] for r in rows),
            'aviaPicotyCombinedExactCanonicalStations': len(avia_ids),
            'aviaPicotyDualConfirmedCanonicalStations': len(avia_dual),
            'aviaPicotyHasExactRuntimeIdentity': bool(avia_ids),
            'aviaPicotyHasRankableTariff': avia_readiness['runtimeTariffEligible'],
            'bumpHasExactRuntimeIdentity': focus['bump']['exactRuntimeAliasCount'] > 0,
            'powerdotHasExactRuntimeIdentity': focus['powerdot']['exactRuntimeAliasCount'] > 0,
        },
        'aviaPicotyTariffReadiness': avia_readiness,
        'focus': focus,
        'providers': rows,
    }

    path = Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'summary': output['summary'], 'aviaPicotyTariffReadiness': avia_readiness, 'focus': focus}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
