#!/usr/bin/env python3
import argparse,gzip,json
from collections import Counter
from pathlib import Path

def load_json(path):
    return json.loads(Path(path).read_text())

def load_gzip_json(path):
    return json.loads(gzip.decompress(Path(path).read_bytes()))

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--sites',default='build/germany-sites/all.json.gz')
    p.add_argument('--aliases',default='data/v9/germany-operator-aliases.json')
    p.add_argument('--aliases-extension',default='data/v9/germany-operator-aliases-extension.json')
    p.add_argument('--min-coverage',type=float,default=0.35)
    p.add_argument('--top',type=int,default=25)
    a=p.parse_args()

    rows=load_gzip_json(a.sites)
    configs=[load_json(a.aliases)]
    ext=Path(a.aliases_extension)
    if ext.exists(): configs.append(load_json(ext))
    assert all(cfg.get('country')=='DE' for cfg in configs)
    assert rows, 'Germany grouped site dataset is empty'

    alias_owner={}
    canonicals=set()
    for cfg in configs:
      for item in cfg.get('operators',[]):
        canonical=str(item.get('canonical','')).strip()
        assert canonical, 'blank canonical operator'
        canonicals.add(canonical)
        for alias in item.get('aliases',[]):
            alias=str(alias).strip()
            assert alias, f'blank alias under {canonical}'
            previous=alias_owner.get(alias)
            assert previous in (None,canonical), f'alias conflict: {alias!r} -> {previous!r}/{canonical!r}'
            alias_owner[alias]=canonical

    counts=Counter(str(r[5] or '').strip() for r in rows)
    total=len(rows)
    recognized=set(canonicals)|set(alias_owner)
    canonical_sites=sum(n for op,n in counts.items() if op in recognized and op!='Tesla')
    coverage=canonical_sites/total
    assert coverage>=a.min_coverage, f'operator canonical coverage {coverage:.2%} below {a.min_coverage:.2%}'
    assert 'Tesla' not in counts, 'Tesla leaked into non-Tesla grouped runtime baseline'

    unmatched=[(op,n) for op,n in counts.most_common() if op not in recognized]
    report={
        'siteCount':total,
        'canonicalSiteCount':canonical_sites,
        'canonicalCoverage':round(coverage,6),
        'canonicalOperatorCount':len(canonicals)-('Tesla' in canonicals),
        'distinctGroupedOperators':len(counts),
        'topUnmatchedOperators':[{'operator':op,'siteCount':n} for op,n in unmatched[:a.top]]
    }
    print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__':
    # This audit is intentionally rerun whenever Germany operator alias coverage changes.
    main()
