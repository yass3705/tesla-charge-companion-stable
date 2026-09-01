#!/usr/bin/env python3
from __future__ import annotations
import csv,gzip,json,tempfile,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];SCRIPT=ROOT/'scripts/materialize_france_arcachon_offers.py';SOURCE=ROOT/'data/arcachon_direct_tariffs_v1.json'
def write_gz(path,obj):
    with gzip.open(path,'wt',encoding='utf-8') as f:json.dump(obj,f)
def main():
    with tempfile.TemporaryDirectory() as td:
        t=Path(td);c=t/'canonical';o=t/'out';c.mkdir();o.mkdir()
        stations=[
          {'stationId':'A1','name':"Ville d'Arcachon - Proximité",'codeInsee':'33009','physicalOperatorId':'bouygues-energies-services'},
          {'stationId':'A2','name':"Ville d'Arcachon - Citadine",'codeInsee':'33009','physicalOperatorId':'bouygues-energies-services'},
          {'stationId':'A3','name':"Ville d'Arcachon - Express",'codeInsee':'33009','physicalOperatorId':'bouygues-energies-services'},
          {'stationId':'X','name':'Ville de Bordeaux','codeInsee':'33063','physicalOperatorId':'bouygues-energies-services'}]
        pdcs=[
          {'stationId':'A1','pdcId':'P','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','powerKw':22.08,'connectors':{'type2':True,'comboCcs':False}},
          {'stationId':'A2','pdcId':'CA','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','powerKw':22.08,'connectors':{'type2':True,'comboCcs':False}},
          {'stationId':'A2','pdcId':'CD','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','powerKw':30.4,'connectors':{'type2':False,'comboCcs':True}},
          {'stationId':'A3','pdcId':'E','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','powerKw':240.4,'connectors':{'type2':False,'comboCcs':True}},
          {'stationId':'X','pdcId':'NO','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','powerKw':22.08,'connectors':{'type2':True}}]
        write_gz(c/'stations.json.gz',stations);write_gz(c/'charge_points.json.gz',pdcs)
        static=t/'static.csv'
        with static.open('w',encoding='utf-8',newline='') as f:
            w=csv.DictWriter(f,fieldnames=['id_station_itinerance','nom_amenageur','code_insee_commune','nom_enseigne']);w.writeheader()
            for sid,ci in [('A1','33009'),('A2','33009'),('A3','33009'),('X','33063')]:w.writerow({'id_station_itinerance':sid,'nom_amenageur':'R-Mob','code_insee_commune':ci,'nom_enseigne':'Alizé Liberté 2'})
        subprocess.check_call([sys.executable,str(SCRIPT),'--source',str(SOURCE),'--canonical-dir',str(c),'--static-csv',str(static),'--out-dir',str(o)])
        r=json.load(open(o/'arcachon_materialization_report.json',encoding='utf-8'));assert r['summary']['eligibleStationCount']==3;assert r['summary']['eligiblePdcCount']==4;assert r['summary']['coveredPdcCount']==4;assert r['summary']['unresolvedPdcCount']==0
        assert r['familyPdcCounts']=={'arcachon-citadine-ac':1,'arcachon-citadine-dc':1,'arcachon-express-240':1,'arcachon-proximity-ac':1}
        with gzip.open(o/'arcachon_pdc_offers_contract_v1_1.json.gz','rt',encoding='utf-8') as f:offers=json.load(f)
        assert len(offers)==8;by={(x['canonicalPdcId'],x['subscriptionId']):x for x in offers}
        assert by[('P',None)]['pricingRules'][0]['pricePerKwh']==0.49 and by[('P','arcachon-resident')]['pricingRules'][0]['pricePerKwh']==0.25
        assert by[('P',None)]['pricingRules'][1]['durationStart']=='07:00' and by[('P',None)]['pricingRules'][1]['durationEnd']=='23:00'
        assert by[('CA',None)]['pricingRules'][0]['pricePerKwh']==0.55 and by[('CA','arcachon-resident')]['pricingRules'][0]['pricePerKwh']==0.25
        assert by[('CD',None)]['pricingRules'][0]['pricePerKwh']==0.55 and by[('CD','arcachon-resident')]['pricingRules'][0]['pricePerKwh']==0.55
        assert by[('E',None)]['pricingRules'][0]['pricePerKwh']==0.65 and by[('E','arcachon-resident')]['pricingRules'][1]['durationThresholdMinutes']==40
        assert all(x['canonicalPdcId']!='NO' for x in offers);assert all(x['selectors'].get('residencyRequired') is True for x in offers if x['subscriptionId']=='arcachon-resident')
        print('Arcachon materializer regression tests OK')
if __name__=='__main__':main()
