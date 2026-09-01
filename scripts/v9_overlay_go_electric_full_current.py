#!/usr/bin/env python3
from __future__ import annotations
import argparse,gzip,importlib.util,json
from pathlib import Path

OPERATOR='Go Electric Stations SRLS'

def load_json(path): return json.loads(Path(path).read_text(encoding='utf-8'))
def load_gz(path):
    with gzip.open(path,'rt',encoding='utf-8') as fh:return json.load(fh)

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--candidate',required=True); ap.add_argument('--current',default='data/v9/italy-offers.json'); ap.add_argument('--out',default='data/v9/italy-offers.json'); ap.add_argument('--report',default='data/v9/italy-go-electric-full-overlay-report.json'); a=ap.parse_args()
    current=load_json(a.current); candidate=load_gz(a.candidate)
    spec=importlib.util.spec_from_file_location('ge_builder',Path(__file__).with_name('v9_build_italy_catalog_go_electric_full.py'))
    if spec is None or spec.loader is None: raise SystemExit('cannot load Go Electric builder')
    mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    physical={}
    for e in candidate.get('evses') or []:
        t=e.get('tccV9DirectTariff') or {}
        if t.get('operator')!=OPERATOR: continue
        eid=str(e.get('evseId') or '').strip()
        if not eid: continue
        pricing=mod.direct_pricing(t)
        if pricing is None: raise SystemExit(f'{eid}: validated Go Electric pricing rejected by stable builder')
        physical[eid]={'tariff':t,'pricing':pricing}
    if len(physical)!=2214: raise SystemExit(f'Go Electric candidate count {len(physical)}')
    direct=current.get('directOffers'); subs=current.get('subscriptionOffers'); emsp=current.get('emspOffers')
    if not isinstance(direct,list) or not isinstance(subs,list) or not isinstance(emsp,list): raise SystemExit('invalid current Italy offers payload')
    current_by_eid={}
    for o in direct:
        ids=o.get('evseIds') or []
        if len(ids)!=1: raise SystemExit('Italy direct offer not exact singleton')
        eid=str(ids[0]);
        if eid in current_by_eid: raise SystemExit(f'duplicate current direct EVSE {eid}')
        current_by_eid[eid]=o
    ge_ids=set(physical)
    existing_ge={eid:o for eid,o in current_by_eid.items() if o.get('provider')==OPERATOR}
    foreign_conflicts={eid:o for eid,o in current_by_eid.items() if eid in ge_ids and o.get('provider')!=OPERATOR}
    if foreign_conflicts: raise SystemExit(f'foreign direct conflicts on Go Electric identities: {list(foreign_conflicts)[:5]}')
    preserved=[o for o in direct if str((o.get('evseIds') or [''])[0]) not in ge_ids]
    generated=str(current.get('generatedAt') or candidate.get('generatedAt') or '')
    ge=[]
    for eid,row in sorted(physical.items()):
        t=row['tariff']; ge.append({
            'id':f'it:direct:{eid}','provider':OPERATOR,'evseIds':[eid],'verifiedScope':'exact_evse','countries':['IT'],'currency':'EUR','priority':130,'source':str(t.get('source') or 'NextCharge official Go Electric B2C tariff'),'sourceId':'italy-verified-offers','directOperatorOnly':True,'pricing':row['pricing'],
            'metadata':{'channel':'operator_direct','tariffClass':t.get('tariffClass'),'feePolicy':t.get('feePolicy'),'occupancyPolicy':t.get('occupancyPolicy'),'timeZone':t.get('timeZone'),'postChargeFeePolicy':t.get('postChargeFeePolicy'),'termsSource':t.get('termsSource'),'goElectricFullComponents':True,'semanticsQaRun':33551150109}
        })
    out={**current,'directOffers':preserved+ge,'subscriptionOffers':subs,'emspOffers':emsp}
    ids=[]
    for o in out['directOffers']:
        ids.extend(str(x) for x in (o.get('evseIds') or []))
    if len(ids)!=len(set(ids)): raise SystemExit('direct EVSE collision after overlay')
    if len(out['directOffers'])!=len(preserved)+2214: raise SystemExit('direct total accounting error')
    if len(subs)!=(len(current.get('subscriptionOffers') or [])) or len(emsp)!=(len(current.get('emspOffers') or [])): raise SystemExit('commercial overlay preservation failed')
    report={'currentDirect':len(direct),'existingGoElectricDirect':len(existing_ge),'newGoElectricDirect':2214,'addedGoElectricDirect':2214-len(existing_ge),'preservedNonGoElectricDirect':len(preserved),'resultDirect':len(out['directOffers']),'subscriptionOffers':len(subs),'emspOffers':len(emsp),'foreignDirectConflicts':0,'directEvseCollisions':0,'generatedAtSource':generated}
    Path(a.out).write_text(json.dumps(out,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8'); Path(a.report).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8'); print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__': main()
