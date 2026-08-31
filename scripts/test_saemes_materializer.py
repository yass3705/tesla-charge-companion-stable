#!/usr/bin/env python3
from __future__ import annotations
import gzip, json, subprocess, sys, tempfile
from pathlib import Path

def dump_gz(path, value):
    with gzip.open(path, 'wt', encoding='utf-8') as f: json.dump(value, f)

def main():
    root=Path(__file__).resolve().parents[1]
    script=root/'scripts'/'materialize_france_saemes_offers.py'
    source=root/'data'/'saemes_direct_tariffs_v1.json'
    stations=[
        {'stationId':'SAE1','tariffNetworkId':'saemes','physicalOperatorId':'saemes'},
        {'stationId':'ELE1','tariffNetworkId':'electra','physicalOperatorId':'saemes'},
        {'stationId':'OTH1','tariffNetworkId':'other','physicalOperatorId':'other'},
    ]
    pdcs=[
        {'pdcId':'SAE1-P1','stationId':'SAE1','tariffNetworkId':'saemes','physicalOperatorId':'saemes','powerKw':22,'connectors':{'type2':True}},
        {'pdcId':'ELE1-P1','stationId':'ELE1','tariffNetworkId':'electra','physicalOperatorId':'saemes','powerKw':150,'connectors':{'comboCcs':True}},
        {'pdcId':'OTH1-P1','stationId':'OTH1','tariffNetworkId':'other','physicalOperatorId':'other','powerKw':22,'connectors':{'type2':True}},
    ]
    with tempfile.TemporaryDirectory() as td:
        td=Path(td); canonical=td/'canonical'; out=td/'out'; canonical.mkdir()
        dump_gz(canonical/'stations.json.gz',stations); dump_gz(canonical/'charge_points.json.gz',pdcs)
        subprocess.run([sys.executable,str(script),'--source',str(source),'--canonical-dir',str(canonical),'--out-dir',str(out)],check=True,capture_output=True,text=True)
        with gzip.open(out/'saemes_pdc_offers_contract_v1_1.json.gz','rt',encoding='utf-8') as f: offers=json.load(f)
        report=json.loads((out/'saemes_materialization_report.json').read_text(encoding='utf-8'))
        assert len(offers)==1
        row=offers[0]
        assert row['canonicalPdcId']=='SAE1-P1'
        assert row['canonicalStationId']=='SAE1'
        assert row['tariffNetworkId']=='saemes'
        assert row['channel']=='direct' and row['subscriptionId'] is None
        assert row['matchMethod']=='network_scope' and row['sourceMode']=='network_rule'
        assert row['rankable'] is True
        assert not any(r['canonicalPdcId']=='ELE1-P1' for r in offers)
        rule=row['pricingRules'][0]
        assert float(rule['pricePerKwh'])==0.5
        assert float(rule['connectionFee'])==0.5
        assert float(rule['durationThresholdMinutes'])==900
        assert abs(float(rule['durationPerMinute'])-(10/60))<1e-8
        assert float(rule['parkingPerMinute'])==0
        s=report['summary']
        assert s['canonicalSaemesStationCount']==1
        assert s['canonicalSaemesPdcCount']==1
        assert s['rankableCoveredPdcCount']==1
        assert s['unresolvedPdcCount']==0
        assert s['physicalInventoryMutationCount']==0
    print('SAEMES canonical materializer tests OK')

if __name__=='__main__': main()
