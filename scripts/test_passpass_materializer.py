#!/usr/bin/env python3
from __future__ import annotations
import gzip,json,subprocess,sys,tempfile
from pathlib import Path

def dump_gz(path, value):
    with gzip.open(path,'wt',encoding='utf-8') as h: json.dump(value,h)

def main():
    root=Path(__file__).resolve().parents[1]
    script=root/'scripts'/'materialize_france_passpass_offers.py'
    source=json.loads((root/'data'/'passpass_electrique_direct_tariffs_v1.json').read_text(encoding='utf-8'))
    stations=[
        {'stationId':'N','tariffNetworkId':'passpass','name':'Centre-ville'},
        {'stationId':'R','tariffNetworkId':'passpass','name':'Borne rapide'},
        {'stationId':'U','tariffNetworkId':'passpass','name':'Nouveau site HPC'},
        {'stationId':'P','tariffNetworkId':'passpass','name':'P+R Gare'},
        {'stationId':'X','tariffNetworkId':'other','name':'Other'},
    ]
    pdcs=[
        {'pdcId':'N1','stationId':'N','tariffNetworkId':'passpass','powerKw':22},
        {'pdcId':'R1','stationId':'R','tariffNetworkId':'passpass','powerKw':50},
        {'pdcId':'U1','stationId':'U','tariffNetworkId':'passpass','powerKw':150},
        {'pdcId':'P1','stationId':'P','tariffNetworkId':'passpass','powerKw':22},
        {'pdcId':'N0','stationId':'N','tariffNetworkId':'passpass','powerKw':None},
        {'pdcId':'X1','stationId':'X','tariffNetworkId':'other','powerKw':22},
    ]
    with tempfile.TemporaryDirectory() as tmp:
        tmp=Path(tmp); c=tmp/'canonical'; o=tmp/'out'; c.mkdir()
        dump_gz(c/'stations.json.gz',stations); dump_gz(c/'charge_points.json.gz',pdcs)
        subprocess.run([sys.executable,str(script),'--source',str(root/'data'/'passpass_electrique_direct_tariffs_v1.json'),'--canonical-dir',str(c),'--out-dir',str(o)],check=True,capture_output=True,text=True)
        offers=json.load(gzip.open(o/'passpass_pdc_offers_contract_v1_1.json.gz','rt',encoding='utf-8'))
        report=json.loads((o/'passpass_materialization_report.json').read_text(encoding='utf-8'))
        by_pdc={}
        for row in offers: by_pdc.setdefault(row['canonicalPdcId'],[]).append(row)
        assert set(by_pdc)=={'N1','R1','U1','P1'}
        assert all(r['rankable'] for r in by_pdc['N1'])
        assert all(r['rankable'] for r in by_pdc['R1'])
        assert all(not r['rankable'] for r in by_pdc['U1'])
        assert all(r['selectors']['siteClass']=='long_stay' and r['rankable'] for r in by_pdc['P1'])
        assert not any(r['canonicalPdcId']=='X1' for r in offers)
        subs=[r for r in offers if r.get('subscriptionId')]
        assert subs and all(r['subscriptionId']=='passpass-electrique-account' for r in subs)
        s=report['summary']
        assert s['canonicalPassPassPdcCount']==5
        assert s['rankableCoveredPdcCount']==3
        assert s['referenceCoveredPdcCount']==1
        assert s['unresolvedPdcCount']==1
        assert s['physicalInventoryMutationCount']==0
    print('Pass Pass canonical materializer tests OK')

if __name__=='__main__': main()
