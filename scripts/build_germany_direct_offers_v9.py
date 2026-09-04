#!/usr/bin/env python3
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


def load(path):
    return json.loads(Path(path).read_text())


def parse_time(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None


def is_active(offer, now):
    until = parse_time(offer.get('validUntil'))
    return until is None or until >= now


def discover_extensions():
    """Discover every Germany direct-offer extension by repository convention.

    This deliberately replaces the historical hand-maintained default list so a
    newly verified CPO cannot be classified by the audits while being silently
    omitted from the consolidated direct-offer build. Explicit --extensions
    arguments remain supported for targeted tests.
    """
    return sorted(
        str(path)
        for path in Path('data/v9').glob('germany-direct-offers-*-extension.json')
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='data/v9/germany-direct-offers.json')
    parser.add_argument('--extensions', nargs='*', default=None)
    parser.add_argument('--out', default='build/germany-direct-offers.json')
    args = parser.parse_args()

    extensions = args.extensions if args.extensions is not None else discover_extensions()
    now = datetime.now(timezone.utc)
    base = load(args.base)
    raw = list(base.get('directOffers', []))
    seen = {offer['id'] for offer in raw}

    for path in extensions:
        data = load(path)
        assert data.get('country') == 'DE', path
        for offer in data.get('directOffers', []):
            if offer['id'] in seen:
                raise SystemExit(f'duplicate offer id: {offer["id"]}')
            raw.append(offer)
            seen.add(offer['id'])

    offers = [offer for offer in raw if is_active(offer, now)]
    expired = [offer['id'] for offer in raw if not is_active(offer, now)]

    out = dict(base)
    out['directOffers'] = offers
    out['generatedFrom'] = [args.base, *extensions]
    out['effectiveOfferCount'] = len(offers)
    out['expiredOfferIds'] = expired
    out['builtAt'] = now.isoformat()

    target = Path(args.out)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(out, separators=(',', ':'), ensure_ascii=False) + '\n')
    print(json.dumps({
        'country': out.get('country'),
        'effectiveOfferCount': len(offers),
        'expiredOfferIds': expired,
        'selectionCount': len({offer.get('selectionId') for offer in offers}),
        'extensionCount': len(extensions),
    }, indent=2))


if __name__ == '__main__':
    main()
