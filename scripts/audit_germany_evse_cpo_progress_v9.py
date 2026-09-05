#!/usr/bin/env python3
import csv, glob, io, json, re, unicodedata, urllib.request
from collections import Counter, defaultdict
from pathlib import Path

URL = 'https://data.bundesnetzagentur.de/Bundesnetzagentur/DE/Fachthemen/ElektrizitaetundGas/E-Mobilitaet/Ladesaeulenregister_BNetzA_2026-07-28.csv'


def norm(value):
    s = unicodedata.normalize('NFKD', str(value or '').strip())
    s = ''.join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r'[^a-z0-9]+', '_', s).strip('_')


def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def prefix(evse):
    s = re.sub(r'[\s\-]', '', str(evse or '').upper())
    match = re.match(r'([A-Z]{2})\*?([A-Z0-9]{3})\*?E', s)
    return f'{match.group(1)}*{match.group(2)}' if match else None


def alias_map():
    mapping = {}
    for path in ('data/v9/germany-operator-aliases.json', 'data/v9/germany-operator-aliases-extension.json'):
        if not Path(path).exists():
            continue
        for item in load(path).get('operators', []):
            canonical = item.get('canonical')
            if not canonical:
                continue
            mapping[norm(canonical)] = canonical
            for alias in item.get('aliases', []):
                mapping[norm(alias)] = canonical
    return mapping


def deferred_records(data):
    """Accept both historical `cpos` and newer `deferred` record containers."""
    return [*data.get('cpos', []), *data.get('deferred', [])]


def treatment_index(amap):
    direct = set()
    station = set()
    station_prefixes = defaultdict(set)
    station_any_prefixes = set()
    collectors = set()
    partial_collectors = set()
    deferred = {}

    for path in glob.glob('data/v9/germany-direct-offers*.json'):
        try:
            data = load(path)
        except Exception:
            continue
        for offer in data.get('directOffers', []):
            for key in ('operatorAliases', 'networkAliases'):
                for name in offer.get(key, []):
                    direct.add(norm(amap.get(norm(name), name)))

    for path in glob.glob('data/v9/germany-station-pricing*.json'):
        try:
            data = load(path)
        except Exception:
            continue
        default_op = data.get('operator')
        for entry in data.get('entries', []):
            evse_prefix = prefix(entry.get('evseId'))
            if evse_prefix:
                station_any_prefixes.add(evse_prefix)
            operator = entry.get('operator') or default_op
            if not operator:
                continue
            opn = norm(amap.get(norm(operator), operator))
            station.add(opn)
            if evse_prefix:
                station_prefixes[opn].add(evse_prefix)

    collectors_path = Path('data/v9/germany-station-pricing-collectors.json')
    if collectors_path.exists():
        for collector in load(collectors_path).get('collectors', []):
            if not collector.get('operator'):
                continue
            opn = norm(amap.get(norm(collector['operator']), collector['operator']))
            if collector.get('status') == 'active_validated':
                collectors.add(opn)
            elif collector.get('status') == 'active_partial':
                partial_collectors.add(opn)

    for path in glob.glob('data/v9/germany-cpo-deferred-pricing*.json'):
        try:
            data = load(path)
        except Exception:
            continue
        for record in deferred_records(data):
            operator = record.get('operator') or record.get('cpo')
            if not operator:
                continue
            canonical = amap.get(norm(operator), operator)
            deferred[norm(canonical)] = record.get('status', '')
            for alias in record.get('operatorAliases', []):
                deferred[norm(amap.get(norm(alias), alias))] = record.get('status', '')

    operator_done = direct | collectors | partial_collectors | set(deferred)
    return {
        'operatorDone': operator_done,
        'direct': direct,
        'station': station,
        'stationPrefixes': station_prefixes,
        'stationAnyPrefixes': station_any_prefixes,
        'collectors': collectors,
        'partialCollectors': partial_collectors,
        'deferred': deferred,
    }


def classify(opn, evse_prefix, index):
    status = index['deferred'].get(opn, '')
    if status:
        if status.startswith('blocked_'):
            return 'blocked'
        if any(token in status for token in ('in_progress', 'partial', 'deferred', 'app_only')):
            return 'partial'
        if status.startswith('direct_dc_resolved') or status.startswith('direct_ac_resolved'):
            return 'partial'
        return 'complete'
    if opn in index['partialCollectors']:
        return 'partial'
    if opn in index['collectors']:
        return 'complete'
    if opn in index['direct']:
        return 'complete'
    if evse_prefix in index['stationAnyPrefixes']:
        return 'partial'
    if evse_prefix in index['stationPrefixes'].get(opn, set()):
        return 'partial'
    return None


def reader():
    request = urllib.request.Request(URL, headers={'User-Agent': 'TCC-V9-DE-EVSE-CPO-audit/1.4'})
    with urllib.request.urlopen(request, timeout=180) as response:
        raw = response.read()
    text = None
    for encoding in ('utf-8-sig', 'utf-8', 'cp1252', 'latin-1'):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            pass
    lines = text.splitlines(True)
    start = next((i for i, line in enumerate(lines[:100]) if line.lstrip('\ufeff').startswith('Ladeeinrichtungs-ID;Betreiber;')), None)
    if start is None:
        raise RuntimeError('header not found')
    return csv.DictReader(io.StringIO(''.join(lines[start:])), delimiter=';', quotechar='"')


def main():
    amap = alias_map()
    index = treatment_index(amap)
    owners = defaultdict(Counter)
    points = Counter()
    no_prefix = Counter()

    for row in reader():
        raw_operator = (row.get('Betreiber') or '').strip()
        operator = amap.get(norm(raw_operator), raw_operator)
        if norm(operator) == 'tesla':
            continue
        found = False
        for i in range(1, 7):
            evse_prefix = prefix((row.get(f'EVSE-ID{i}') or '').strip())
            if not evse_prefix:
                continue
            found = True
            points[evse_prefix] += 1
            owners[evse_prefix][operator] += 1
        if not found and raw_operator:
            no_prefix[operator] += 1

    rows = []
    treated_count = 0
    classes = Counter()
    treated_rows = []
    for evse_prefix, count in points.most_common():
        dominant, dominant_count = owners[evse_prefix].most_common(1)[0]
        canonical = amap.get(norm(dominant), dominant)
        classification = classify(norm(canonical), evse_prefix, index)
        is_done = classification is not None
        if is_done:
            treated_count += 1
            classes[classification] += 1
            treated_rows.append({
                'evsePrefix': evse_prefix,
                'dominantOperator': canonical,
                'classification': classification,
                'points': count,
            })
        rows.append({
            'evsePrefix': evse_prefix,
            'points': count,
            'dominantOperator': canonical,
            'dominantShare': round(dominant_count / count, 4),
            'treated': is_done,
            'classification': classification,
            'topOwners': owners[evse_prefix].most_common(5),
        })

    total = len(rows)
    untreated = [row for row in rows if not row['treated']]
    out = {
        'schemaVersion': 4,
        'country': 'DE',
        'method': 'unique EVSE party prefix',
        'totalCpoCount': total,
        'treatedCpoCount': treated_count,
        'remainingCpoCount': total - treated_count,
        'treatedShare': round(treated_count / total, 4) if total else 0,
        'classificationCounts': {
            'complete': classes['complete'],
            'partial': classes['partial'],
            'blocked': classes['blocked'],
        },
        'treatedCpos': treated_rows,
        'topUntreated': untreated[:100],
        'ownerLabelsWithoutRecognizableEvsePrefix': len(no_prefix),
        'topOwnerLabelsWithoutPrefix': no_prefix.most_common(50),
        'note': 'EVSE prefixes are the primary CPO identity counter. Operator-wide direct offers, validated collectors and explicit deferred/status records classify all prefixes dominated by that canonical physical operator. Both historical cpos and newer deferred containers are accepted. Exact station-pricing seeds classify only the EVSE party prefixes actually present in those seeds. Owner labels without a recognizable EVSE prefix are tracked separately and are not automatically counted as distinct CPOs.',
    }
    assert treated_count == sum(classes.values())
    assert treated_count + (total - treated_count) == total
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
