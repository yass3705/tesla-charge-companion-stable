#!/usr/bin/env python3
from __future__ import annotations
import gzip,json,tempfile,subprocess,sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/'scripts/materialize_france_la_borne_bleue_offers.py'
SOURCE=ROOT/'data/la_borne_bleue_direct_tariffs_v1.json'

def write_gz(path,obj):
    with gzip.open(path,'wt',encoding='utf-8') as f: json.dump(obj,f)

def main():
    with tempfile.TemporaryDirectory() as td:
        t=Path(td); c=t/'canonical'; o=t/'out'; c.mkdir(); o.mkdir()
        stations=[
            {'stationId':'S1','name':'La Borne Bleue 7.4','tariffNetworkId':'labornebleue','physicalOperatorId':'bouygues-energies-services'},
            {'stationId':'S2','name':'La Borne Bleue 22','tariffNetworkId':'labornebleue','physicalOperatorId':'bouygues-energies-services'},
            {'stationId':'S3','name':'La Borne Bleue AC 43','tariffNetworkId':'labornebleue','physicalOperatorId':'bouygues-energies-services'},
            {'stationId':'S4','name':'La Borne Bleue DC 100','tariffNetworkId':'labornebleue','physicalOperatorId':'bouygues-energies-services'},
            {'stationId':'S5','name':'La Borne Bleue DC 50','tariffNetworkId':'labornebleue','physicalOperatorId':'bouygues-energies-services'},
            {'stationId':'X','name':'Alize generic','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services'}]
        pdcs=[
            {'stationId':'S1','pdcId':'P74','tariffNetworkId':'labornebleue','physicalOperatorId':'bouygues-energies-services','powerKw':7.36,'connectors':{'type2':True,'comboCcs':False,'chademo':False}},
            {'stationId':'S2','pdcId':'P22','tariffNetworkId':'labornebleue','physicalOperatorId':'bouygues-energies-services','powerKw':22.08,'connectors':{'type2':True,'comboCcs':False,'chademo':False}},
            {'stationId':'S3','pdcId':'PAC43','tariffNetworkId':'labornebleue','physicalOperatorId':'bouygues-energies-services','powerKw':43.0,'connectors':{'type2':True,'comboCcs':False,'chademo':False}},
            {'stationId':'S4','pdcId':'PDC100','tariffNetworkId':'labornebleue','physicalOperatorId':'bouygues-energies-services','powerKw':100.0,'connectors':{'type2':False,'comboCcs':True,'chademo':False}},
            {'stationId':'S5','pdcId':'PDC50','tariffNetworkId':'labornebleue','physicalOperatorId':'bouygues-energies-services','powerKw':50.0,'connectors':{'type2':False,'comboCcs':True,'chademo':False}},
            {'stationId':'X','pdcId':'NO','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','powerKw':22.08,'connectors':{'type2':True,'comboCcs':False,'chademo':False}}]
        write_gz(c/'stations.json.gz',stations); write_gz(c/'charge_points.json.gz',pdcs)
        subprocess.check_call([sys.executable,str(SCRIPT),'--source',str(SOURCE),'--canonical-dir',str(c),'--out-dir',str(o)])
        r=json.load(open(o/'la_borne_bleue_materialization_report.json',encoding='utf-8'))
        s=r['summary']
        assert s['eligibleStationCount']==5
        assert s['eligiblePdcCount']==5
        assert s['coveredPdcCount']==4
        assert s['unresolvedPdcCount']==1
        assert r['familyPdcCounts']=={
            'labornebleue-ac-22':1,
            'labornebleue-ac-7_4':1,
            'labornebleue-ac-above-22':1,
            'labornebleue-dc-above-50':1,
        }
        assert r['unresolved'][0]['canonicalPdcId']=='PDC50'
        assert r['unresolved'][0]['reason']=='dc_at_or_below_50kw_unpublished'
        with gzip.open(o/'la_borne_bleue_pdc_offers_contract_v1_1.json.gz','rt',encoding='utf-8') as f: offers=json.load(f)
        assert len(offers)==8
        assert all(x['canonicalPdcId']!='NO' for x in offers)
        assert all(x['canonicalPdcId']!='PDC50' for x in offers)
        by={(x['canonicalPdcId'],x['subscriptionId']):x for x in offers}
        assert by[('P74',None)]['pricingRules'][0]['durationPerMinute']==4.5/60
        assert by[('P74','labornebleue-annual')]['pricingRules'][1]['durationCap']==12.0
        assert by[('P22',None)]['pricingRules'][0]['durationPerMinute']==6.5/60
        assert by[('P22','labornebleue-annual')]['pricingRules'][1]['durationCap']==12.0
        assert by[('PAC43',None)]['pricingRules'][0]['durationPerMinute']==12.0/60
        assert by[('PAC43','labornebleue-annual')]['pricingRules'][0]['durationPerMinute']==11.0/60
        assert by[('PDC100',None)]['pricingRules'][0]['pricePerKwh']==0.50
        assert by[('PDC100','labornebleue-annual')]['pricingRules'][0]['pricePerKwh']==0.45
        assert by[('PDC100',None)]['pricingRules'][1]['durationThresholdMinutes']==30
        assert all(x['pricingRules'][0]['parkingPerMinute']==0 for x in offers)
        print('La Borne Bleue materializer regression tests OK')

if __name__=='__main__': main()
