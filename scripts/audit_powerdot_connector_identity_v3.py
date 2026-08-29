#!/usr/bin/env python3
from __future__ import annotations
import argparse,json,math
from collections import Counter,defaultdict
from pathlib import Path
from audit_powerdot_connector_identity_v2 import clean,dump_json,load_json,pdc_ids_from_scope,tariff_signature

def num(v):
    try:
        x=float(v); return x if math.isfinite(x) else None
    except (TypeError,ValueError): return None

def yes(v): return clean(v).lower() in {'1','true','yes','oui','vrai'}
def pan_kind(p):
    c=p.get('connectors') or {}
    if yes(c.get('comboCcs')) or yes(c.get('chademo')): return 'DC'
    if yes(c.get('type2')): return 'AC'
    w=num(p.get('powerKw')); return '' if w is None else ('AC' if w<=43 else 'DC')
def src_kind(c):
    t=int(num((c or {}).get('type')) or 0); w=num((c or {}).get('maxPowerKw'))
    if t==1:return 'AC'
    if t==2:return 'DC'
    return '' if w is None else ('AC' if w<=22.5 else 'DC')
def tol(a,b):
    h=max(abs(a),abs(b)); return .6 if h<=25 else max(1.0,h*.01)
def compatible(a,b): return a is not None and b is not None and abs(a-b)<=tol(a,b)+1e-9
def rounded(v): return round(float(v),3)

def recover_entry(entry,pan):
    charger=entry.get('charger') or {}; ids=pdc_ids_from_scope(entry)|pdc_ids_from_scope(charger)
    if not ids:return [],'no_explicit_scope'
    cg=defaultdict(list); sg=defaultdict(list)
    for pid in sorted(ids):
        p=pan.get(pid); w=num((p or {}).get('powerKw')); k=pan_kind(p or {})
        if not p or w is None or not k:return [],'pan_identity_missing'
        cg[(k,rounded(w))].append(pid)
    for i,c in enumerate(charger.get('connectors') or []):
        w=num((c or {}).get('maxPowerKw')); k=src_kind(c or {}); s=tariff_signature((c or {}).get('tariff') or {})
        if w is None or not k or not s:return [],'source_identity_missing'
        sg[(k,rounded(w))].append((i,s))
    sc=defaultdict(list); cc=defaultdict(list); us={}
    for sk,rows in sg.items():
        sigs={s for _,s in rows}
        if len(sigs)!=1:continue
        us[sk]=next(iter(sigs)); kind,power=sk
        for ck,pids in cg.items():
            if kind==ck[0] and len(rows)==len(pids) and compatible(power,ck[1]):
                sc[sk].append(ck); cc[ck].append(sk)
    out=[]
    for sk,cands in sc.items():
        if len(cands)!=1:continue
        ck=cands[0]
        if len(cc.get(ck,[]))!=1:continue
        for pid in cg[ck]:
            out.append({'pdcId':pid,'strategy':'entry_power_kind_uniform','tariff':json.loads(us[sk]),'provenance':{'sourceKind':sk[0],'sourcePowerKw':sk[1],'sourceConnectorCount':len(sg[sk]),'canonicalKind':ck[0],'canonicalPowerKw':ck[1],'canonicalPdcCount':len(cg[ck]),'powerToleranceKw':tol(sk[1],ck[1])}})
    return out,'resolved' if out else 'no_bijective_uniform_bucket'

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--powerdot-gzip',required=True); ap.add_argument('--canonical-dir',required=True); ap.add_argument('--v2-safe',required=True); ap.add_argument('--out-dir',default='build/france_irve_powerdot'); a=ap.parse_args()
    data=load_json(a.powerdot_gzip); pdcs=load_json(Path(a.canonical_dir)/'charge_points.json.gz'); base=load_json(a.v2_safe)
    pan={}; station={}
    for p in pdcs:
        pid=clean(p.get('idPdcItinerance')) or clean(p.get('pdcId'))
        if pid:pan[pid]=p;station[pid]=clean(p.get('stationId'))
    base_by={clean(r.get('pdcId')):r for r in base if clean(r.get('pdcId'))}; props=defaultdict(list); stats=Counter(); diags=[]
    for idx,e in enumerate(data.get('chargers') or []):
        sigs={tariff_signature((c or {}).get('tariff') or {}) for c in ((e.get('charger') or {}).get('connectors') or [])}; sigs.discard('')
        if len(sigs)<=1:stats['uniform_or_empty_skipped']+=1;continue
        stats['heterogeneous_considered']+=1; rows,reason=recover_entry(e,pan); stats['heterogeneous_with_recovery' if rows else 'heterogeneous_without_recovery']+=1
        for r in rows:r['provenance']['entryIndex']=idx;props[r['pdcId']].append(r)
        if len(diags)<200:diags.append({'entryIndex':idx,'reason':reason,'recoveredPdcCount':len(rows)})
    recovered=[]; conflicts=[]; base_conf=[]; duplicate=0
    for pid,rows in props.items():
        sigs={tariff_signature(r.get('tariff') or {}) for r in rows}
        if len(sigs)!=1:conflicts.append({'pdcId':pid,'signatureCount':len(sigs)});continue
        row=rows[0]
        if pid in base_by:
            if tariff_signature(base_by[pid].get('tariff') or {})!=next(iter(sigs)):base_conf.append({'pdcId':pid})
            else:duplicate+=1
            continue
        recovered.append({'pdcId':pid,'stationId':station.get(pid),'strategy':'entry_power_kind_uniform','tariff':row['tariff'],'provenance':row['provenance']})
    combined_by={clean(r.get('pdcId')):r for r in base if clean(r.get('pdcId'))}
    for r in recovered:combined_by[r['pdcId']]=r
    referenced=set()
    for e in data.get('chargers') or []:referenced.update(pid for pid in (pdc_ids_from_scope(e)|pdc_ids_from_scope(e.get('charger') or {})) if pid in pan)
    safe=set(combined_by); unresolved=sorted(referenced-safe)
    report={'schemaVersion':'3.0.0','dataset':'powerdot-connector-pdc-identity-audit-v3','productionReady':False,'policy':{'physicalInventoryAuthority':'PAN IRVE static','connectorOrderMayImplyPdcIdentity':False,'physicalReferenceMayImplyPdcIdentityAlone':False,'evseNumberMayImplyPdcIdentityAlone':False,'requiresBijectivePowerKindMatch':True,'requiresEqualCardinality':True,'requiresUniformTariff':True,'ambiguousBucketRankable':False},'summary':{'canonicalPdcReferenced':len(referenced),'baselineV2SafePdcCount':len(base_by),'recoveredV3PdcCount':len(recovered),'safeCanonicalPdcTariffCount':len(safe),'safeCanonicalPdcTariffPctOfReferenced':round(100*len(safe)/len(referenced),2) if referenced else 0,'unresolvedCanonicalPdcCount':len(unresolved),'proposalConflictPdcCount':len(conflicts),'baselineConflictPdcCount':len(base_conf),'duplicateSameTariffProposalCount':duplicate},'entryStats':dict(stats),'proposalConflicts':conflicts[:100],'baselineConflicts':base_conf[:100],'unresolvedPdcIdsSample':unresolved[:200],'diagnostics':diags}
    out=Path(a.out_dir);dump_json(out/'powerdot_safe_pdc_tariff_candidates_v3.json.gz',sorted(combined_by.values(),key=lambda r:clean(r.get('pdcId'))));dump_json(out/'powerdot_connector_identity_report_v3.json',report,pretty=True);print(json.dumps(report['summary'],ensure_ascii=False,indent=2));print(json.dumps(report['entryStats'],ensure_ascii=False))
if __name__=='__main__':main()
