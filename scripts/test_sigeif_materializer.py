#!/usr/bin/env python3
from __future__ import annotations
import gzip,json,tempfile,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];SCRIPT=ROOT/'scripts/materialize_france_sigeif_offers.py';SOURCE=ROOT/'data/sigeif_direct_tariffs_v1.json'
def write_gz(path,obj):
    with gzip.open(path,'wt',encoding='utf-8') as f:json.dump(obj,f)
def main():
    with tempfile.TemporaryDirectory() as td:
        t=Path(td);c=t/'canonical';o=t/'out';c.mkdir();o.mkdir()
        stations=[{'stationId':'S1'},{'stationId':'S2'},{'stationId':'S3'},{'stationId':'X'}]
        pdcs=[
          {'stationId':'S1','pdcId':'A','tariffNetworkId':'sigeif','physicalOperatorId':'izivia','powerKw':22.0,'connectors':{'type2':True}},
          {'stationId':'S2','pdcId':'B','tariffNetworkId':'sigeif','physicalOperatorId':'izivia','powerKw':24.0,'connectors':{'comboCcs':True}},
          {'stationId':'S3','pdcId':'C','tariffNetworkId':'sigeif','physicalOperatorId':'izivia','powerKw':100.0,'connectors':{'comboCcs':True}},
          {'stationId':'S3','pdcId':'D','tariffNetworkId':'sigeif','physicalOperatorId':'izivia','powerKw':22.0,'connectors':{'type2':True}},
          {'stationId':'X','pdcId':'NO','tariffNetworkId':'izivia','physicalOperatorId':'izivia','powerKw':50.0,'connectors':{'comboCcs':True}}]
        write_gz(c/'stations.json.gz',stations);write_gz(c/'charge_points.json.gz',pdcs)
        subprocess.check_call([sys.executable,str(SCRIPT),'--source',str(SOURCE),'--canonical-dir',str(c),'--out-dir',str(o)])
        r=json.load(open(o/'sigeif_materialization_report.json',encoding='utf-8'));assert r['summary']['eligibleStationCount']==3;assert r['summary']['eligiblePdcCount']==4;assert r['summary']['coveredPdcCount']==4;assert r['summary']['unresolvedPdcCount']==0
        assert r['familyPdcCounts']=={'sigeif-douce-22':1,'sigeif-rapid-100':2,'sigeif-semi-rapid-24':1}
        with gzip.open(o/'sigeif_pdc_offers_contract_v1_1.json.gz','rt',encoding='utf-8') as f:offers=json.load(f)
        assert len(offers)==4;by={x['canonicalPdcId']:x for x in offers}
        assert by['A']['pricingRules'][0]['pricePerKwh']==0.39
        assert by['A']['pricingRules'][1]['durationStart']=='08:00' and by['A']['pricingRules'][2]['durationCap']==4.0
        assert by['B']['pricingRules'][0]['pricePerKwh']==0.45 and by['B']['pricingRules'][1]['durationThresholdMinutes']==120
        assert by['C']['pricingRules'][0]['pricePerKwh']==0.49 and by['C']['pricingRules'][1]['durationPerMinute']==0.30
        assert by['D']['pricingRules'][0]['pricePerKwh']==0.49, 'T2 on a rapid station must keep the rapid station tariff'
        assert all(x['canonicalPdcId']!='NO' for x in offers)
        assert all(all(rr['parkingPerMinute']==0 for rr in x['pricingRules']) for x in offers)
        print('SIGEIF materializer regression tests OK')
if __name__=='__main__':main()
