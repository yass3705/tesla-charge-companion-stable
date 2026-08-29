#!/usr/bin/env python3
"""Enforce exact-PDC structured-offer precedence over IRVE free-text fallback."""
from __future__ import annotations
import argparse,gzip,json
from pathlib import Path

def load(path):
    p=Path(path);op=gzip.open if p.suffix=='.gz' else open
    with op(p,'rt',encoding='utf-8') as f:return json.load(f)
def dump(path,value,pretty=False):
    p=Path(path);p.parent.mkdir(parents=True,exist_ok=True)
    if p.suffix=='.gz':
        with gzip.open(p,'wt',encoding='utf-8',compresslevel=9) as f:json.dump(value,f,ensure_ascii=False,separators=(',',':'))
    else:p.write_text(json.dumps(value,ensure_ascii=False,indent=2 if pretty else None)+'\n',encoding='utf-8')
def text(v):return str(v or '').strip()

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--fallback',required=True);ap.add_argument('--structured-offers',action='append',default=[]);ap.add_argument('--report',required=True);a=ap.parse_args()
    fallback=load(a.fallback); structured_ids=set(); source_counts={}
    for path in a.structured_offers:
        rows=load(path);count=0
        for r in rows if isinstance(rows,list) else []:
            pid=text(r.get('canonicalPdcId') or r.get('pdcId'))
            if pid and bool(r.get('rankable')):
                structured_ids.add(pid);count+=1
        source_counts[path]=count
    suppressed=0;rankable_before=sum(1 for r in fallback if r.get('rankable'))
    for row in fallback:
        pid=text(row.get('canonicalPdcId') or row.get('pdcId'))
        if not pid or pid not in structured_ids:continue
        selectors=dict(row.get('selectors') or {});selectors['fallbackOnly']=True;selectors['suppressedByStructuredExactPdc']=True;row['selectors']=selectors
        reasons=list(row.get('blockedReasons') or [])
        if 'structured_exact_pdc_offer_precedence' not in reasons:reasons.append('structured_exact_pdc_offer_precedence')
        row['blockedReasons']=reasons;row['rankable']=False;row['channel']='reference';row['sourceMode']='reference_only';suppressed+=1
    dump(a.fallback,fallback)
    report={'schemaVersion':'1.0.0','productionReady':False,'policy':'rankable structured exact-PDC offers suppress rankable IRVE free-text fallback for the same canonical PDC','structuredRankablePdcCount':len(structured_ids),'structuredOfferSourceCounts':source_counts,'fallbackCandidateCount':len(fallback),'fallbackRankableBefore':rankable_before,'fallbackSuppressedByStructuredExactPdc':suppressed,'fallbackRankableAfter':sum(1 for r in fallback if r.get('rankable'))}
    dump(a.report,report,pretty=True);print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
