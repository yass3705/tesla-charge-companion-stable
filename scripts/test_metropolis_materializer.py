#!/usr/bin/env python3
from __future__ import annotations
import gzip,json,tempfile,subprocess,sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/'scripts/materialize_france_metropolis_offers.py'
SOURCE=ROOT/'data/metropolis_direct_tariffs_v1.json'

def write_gz(path,obj):
    with gzip.open(path,'wt',encoding='utf-8') as f: json.dump(obj,f)

def main():
    with tempfile.TemporaryDirectory() as td:
        t=Path(td);c=t/'canonical';o=t/'out';c.mkdir();o.mkdir()
        stations=[
            {'stationId':'P','name':'Métropolis Proximité','address':'Paris','tariffNetworkId':'metropolis','physicalOperatorId':'test-cpo'},
            {'stationId':'C','name':'Métropolis Citadine','address':'Boulogne-Billancourt','tariffNetworkId':'metropolis','physicalOperatorId':'test-cpo'},
            {'stationId':'N','name':'Métropolis Citadine Neuilly-sur-Seine','address':'Neuilly-sur-Seine','tariffNetworkId':'metropolis','physicalOperatorId':'test-cpo'},
            {'stationId':'E','name':'Métropolis Express','address':'Paris','tariffNetworkId':'metropolis','physicalOperatorId':'test-cpo'},
            {'stationId':'U','name':'Métropolis unpublished DC','address':'Paris','tariffNetworkId':'metropolis','physicalOperatorId':'test-cpo'},
            {'stationId':'X','name':'Other network','address':'Paris','tariffNetworkId':'other','physicalOperatorId':'test-cpo'}]
        pdcs=[
            {'stationId':'P','pdcId':'P37','tariffNetworkId':'metropolis','physicalOperatorId':'test-cpo','powerKw':3.7,'connectors':{'type2':True,'comboCcs':False}},
            {'stationId':'C','pdcId':'C22','tariffNetworkId':'metropolis','physicalOperatorId':'test-cpo','powerKw':22.0,'connectors':{'type2':True,'comboCcs':False}},
            {'stationId':'N','pdcId':'N22','tariffNetworkId':'metropolis','physicalOperatorId':'test-cpo','powerKw':22.0,'connectors':{'type2':True,'comboCcs':False}},
            {'stationId':'E','pdcId':'E22','tariffNetworkId':'metropolis','physicalOperatorId':'test-cpo','powerKw':22.0,'connectors':{'type2':True,'comboCcs':False}},
            {'stationId':'E','pdcId':'E150','tariffNetworkId':'metropolis','physicalOperatorId':'test-cpo','powerKw':150.0,'connectors':{'type2':False,'comboCcs':True}},
            {'stationId':'U','pdcId':'U100','tariffNetworkId':'metropolis','physicalOperatorId':'test-cpo','powerKw':100.0,'connectors':{'type2':False,'comboCcs':True}},
            {'stationId':'X','pdcId':'NO','tariffNetworkId':'other','physicalOperatorId':'test-cpo','powerKw':22.0,'connectors':{'type2':True,'comboCcs':False}}]
        write_gz(c/'stations.json.gz',stations);write_gz(c/'charge_points.json.gz',pdcs)
        subprocess.check_call([sys.executable,str(SCRIPT),'--source',str(SOURCE),'--canonical-dir',str(c),'--out-dir',str(o)])
        r=json.load(open(o/'metropolis_materialization_report.json',encoding='utf-8'));s=r['summary']
        assert s['eligibleStationCount']==5 and s['eligiblePdcCount']==6
        assert s['coveredPdcCount']==5 and s['unresolvedPdcCount']==1
        assert s['publicRankableOfferCount']==5 and s['subscriptionReferenceOfferCount']==10
        assert r['unresolved'][0]['canonicalPdcId']=='U100' and r['unresolved'][0]['reason']=='unpublished_current_power_class'
        with gzip.open(o/'metropolis_pdc_offers_contract_v1_1.json.gz','rt',encoding='utf-8') as f:offers=json.load(f)
        assert len(offers)==15
        assert all(x['canonicalPdcId']!='NO' and x['canonicalPdcId']!='U100' for x in offers)
        by={(x['canonicalPdcId'],x['subscriptionId']):x for x in offers}
        assert by[('P37',None)]['pricingRules'][0]['pricePerKwh']==0.44
        assert by[('C22',None)]['pricingRules'][0]['pricePerKwh']==0.53
        nr=by[('N22',None)]['pricingRules'];assert len(nr)==2 and nr[0]['occupancyPerMinute']==0.20 and nr[1]['occupancyPerMinute']==0.10
        assert by[('E22',None)]['pricingRules'][0]['pricePerKwh']==0.53 and by[('E22',None)]['pricingRules'][0]['occupancyPerMinute']==0.20
        assert by[('E150',None)]['pricingRules'][0]['pricePerKwh']==0.63 and by[('E150',None)]['pricingRules'][0]['occupancyPerMinute']==0.20
        assert by[('E150','metropolis-mensuel')]['pricingRules'][0]['pricePerKwh']==0.53
        for x in offers:
            if x['subscriptionId'] is not None:
                assert x['rankable'] is False
                assert 'monthly_post_charge_allowance_state_not_tracked' in x['blockedReasons']
            for rule in x['pricingRules']: assert rule['parkingPerMinute']==0
        print('Metropolis materializer regression tests OK')

if __name__=='__main__':main()
