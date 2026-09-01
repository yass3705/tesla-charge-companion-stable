#!/usr/bin/env python3
from __future__ import annotations
import csv,gzip,json,tempfile
from pathlib import Path
import subprocess,sys

ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/'scripts/materialize_france_dreux_offers.py'
SOURCE=ROOT/'data/dreux_direct_tariffs_v1.json'

def write_gz(path,obj):
    with gzip.open(path,'wt',encoding='utf-8') as f:json.dump(obj,f)

def main():
    with tempfile.TemporaryDirectory() as td:
        t=Path(td);c=t/'canonical';o=t/'out';c.mkdir();o.mkdir()
        stations=[
            {'stationId':'FRTESTDREUX01','name':'Ville de Dreux - Citadine','codeInsee':'28134','physicalOperatorId':'bouygues-energies-services'},
            {'stationId':'FRTESTDREUX02','name':'Ville de Dreux - Express','codeInsee':'28134','physicalOperatorId':'bouygues-energies-services'},
            {'stationId':'FRTESTOTHER','name':'Ville de Chartres','codeInsee':'28085','physicalOperatorId':'bouygues-energies-services'}]
        pdcs=[
            {'stationId':'FRTESTDREUX01','pdcId':'A','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','powerKw':22.08,'connectors':{'type2':True,'comboCcs':False,'chademo':False}},
            {'stationId':'FRTESTDREUX01','pdcId':'B','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','powerKw':30.4,'connectors':{'type2':False,'comboCcs':True,'chademo':False}},
            {'stationId':'FRTESTDREUX02','pdcId':'C','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','powerKw':150.4,'connectors':{'type2':False,'comboCcs':True,'chademo':False}},
            {'stationId':'FRTESTDREUX02','pdcId':'D','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','powerKw':22.08,'connectors':{'type2':True,'comboCcs':False,'chademo':False}},
            {'stationId':'FRTESTOTHER','pdcId':'X','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','powerKw':22.08,'connectors':{'type2':True}}]
        write_gz(c/'stations.json.gz',stations);write_gz(c/'charge_points.json.gz',pdcs)
        static=t/'static.csv'
        with static.open('w',encoding='utf-8',newline='') as f:
            w=csv.DictWriter(f,fieldnames=['id_station_itinerance','nom_amenageur','code_insee_commune','nom_enseigne']);w.writeheader()
            w.writerow({'id_station_itinerance':'FRTESTDREUX01','nom_amenageur':'R-Mob','code_insee_commune':'28134','nom_enseigne':'Alizé Liberté 2'})
            w.writerow({'id_station_itinerance':'FRTESTDREUX02','nom_amenageur':'R-Mob','code_insee_commune':'28134','nom_enseigne':'Alizé Liberté 2'})
            w.writerow({'id_station_itinerance':'FRTESTOTHER','nom_amenageur':'R-Mob','code_insee_commune':'28085','nom_enseigne':'Alizé Liberté 2'})
        subprocess.check_call([sys.executable,str(SCRIPT),'--source',str(SOURCE),'--canonical-dir',str(c),'--static-csv',str(static),'--out-dir',str(o)])
        report=json.load(open(o/'dreux_materialization_report.json',encoding='utf-8'))
        assert report['summary']['eligibleStationCount']==2
        assert report['summary']['eligiblePdcCount']==4
        assert report['summary']['coveredPdcCount']==4
        assert report['summary']['unresolvedPdcCount']==0
        assert report['familyPdcCounts']=={'dreux-citadine-ac':1,'dreux-citadine-dc':1,'dreux-express-150':2}
        with gzip.open(o/'dreux_pdc_offers_contract_v1_1.json.gz','rt',encoding='utf-8') as f:offers=json.load(f)
        assert len(offers)==8
        by={(x['canonicalPdcId'],x['subscriptionId']):x for x in offers}
        assert by[('A',None)]['pricingRules'][0]['pricePerKwh']==0.49
        assert by[('A','dreux')]['pricingRules'][0]['pricePerKwh']==0.39
        assert by[('A','dreux')]['pricingRules'][1]['durationStart']=='08:00' and by[('A','dreux')]['pricingRules'][1]['durationEnd']=='21:00'
        assert by[('B',None)]['pricingRules'][0]['pricePerKwh']==0.49 and by[('B','dreux')]['pricingRules'][0]['pricePerKwh']==0.49
        assert by[('C',None)]['pricingRules'][0]['pricePerKwh']==0.54 and by[('D','dreux')]['pricingRules'][0]['pricePerKwh']==0.54
        assert all(x['canonicalPdcId']!='X' for x in offers)
        print('Dreux materializer regression tests OK')
if __name__=='__main__':main()
