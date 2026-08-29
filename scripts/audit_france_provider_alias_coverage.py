#!/usr/bin/env python3
import argparse
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def status(exact, candidates):
    if exact > 0:
        return 'exact_runtime_aliases_available'
    if candidates > 0:
        return 'review_only_no_exact_runtime_alias'
    return 'no_evidence'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--overlay', default='data/v9/france-provider-crosswalk.json')
    ap.add_argument('--candidates', default='data/v9/france-crosswalk-candidates.json')
    ap.add_argument('--output', default='data/v9/france-provider-alias-coverage-report.json')
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

    output = {
        'schemaVersion': 1,
        'country': 'FR',
        'generatedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'policy': {
            'runtimeExactOnly': True,
            'geographicCandidatesReviewOnly': True,
            'noTariffActivationFromProximity': True,
            'providerAliasDoesNotImplyTariffAvailability': True,
        },
        'summary': {
            'providerCount': len(rows),
            'totalExactRuntimeAliases': sum(r['exactRuntimeAliasCount'] for r in rows),
            'totalExactCanonicalStations': len({cid for values in exact_stations.values() for cid in values}),
            'totalReviewOnlyCandidates': sum(r['reviewOnlyCandidateCount'] for r in rows),
            'aviaPicotyCombinedExactCanonicalStations': len(avia_ids),
            'aviaPicotyHasExactRuntimeIdentity': bool(avia_ids),
            'bumpHasExactRuntimeIdentity': focus['bump']['exactRuntimeAliasCount'] > 0,
            'powerdotHasExactRuntimeIdentity': focus['powerdot']['exactRuntimeAliasCount'] > 0,
        },
        'focus': focus,
        'providers': rows,
    }

    path = Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'summary': output['summary'], 'focus': focus}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
