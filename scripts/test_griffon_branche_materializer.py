#!/usr/bin/env python3
from __future__ import annotations
import csv,gzip,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];SCRIPT=ROOT/'scripts/materialize_france_griffon_branche_offers.py';SOURCE=ROOT/'data/griffon_branche_direct_tariffs_v1.json'
def gzwrite(p,o):
    with gzip.open(p,'wt',encoding='utf-8') as f:json.dump(o,f,ensure_ascii=False)
def gzread(p):
    with gzip.open(p,'rt',encoding='utf-8') as f:return json.load(f)
def main():
    with tempfile.TemporaryDirectory() as td:
        d=Path(td);c=d/'canonical';o=d/'out';c.mkdir()
        stations=[
          {'stationId':'FRBE3P22278001','name':'Griffon Branché - Ville de Saint Brieuc - A','codeInsee':'22278','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services'},
          {'stationId':'FRBE3P22278002','name':'Griffon Branché - Ville de Saint Brieuc - Express','codeInsee':'22278','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services'},
          {'stationId':'FRBE3P33000001','name':'Other R-Mob','codeInsee':'33000','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services'}]
        pdcs=[
          {'pdcId':'A1','stationId':'FRBE3P22278001','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','powerKw':22.0,'connectors':{'type2':True}},
          {'pdcId':'A2','stationId':'FRBE3P22278001','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','powerKw':30.0,'connectors':{'comboCcs':True}},
          {'pdcId':'E1','stationId':'FRBE3P22278002','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','powerKw':180.0,'connectors':{'comboCcs':True}},
          {'pdcId':'E2','stationId':'FRBE3P22278002','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','powerKw':22.0,'connectors':{'type2':True}},
          {'pdcId':'X1','stationId':'FRBE3P33000001','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','powerKw':22.0,'connectors':{'type2':True}}]
        gzwrite(c/'stations.json.gz',stations);gzwrite(c/'charge_points.json.gz',pdcs)
        static=d/'static.csv'
        with static.open('w',encoding='utf-8',newline='') as f:
            w=csv.DictWriter(f,fieldnames=['id_station_itinerance','nom_amenageur','code_insee_commune','nom_enseigne']);w.writeheader();w.writerow({'id_station_itinerance':'FRBE3P22278001','nom_amenageur':'R-Mob','code_insee_commune':'22278','nom_enseigne':'Alizé Liberté 2'});w.writerow({'id_station_itinerance':'FRBE3P22278002','nom_amenageur':'R-Mob','code_insee_commune':'22278','nom_enseigne':'Alizé Liberté 2'});w.writerow({'id_station_itinerance':'FRBE3P33000001','nom_amenageur':'R-Mob','code_insee_commune':'33000','nom_enseigne':'Alizé Liberté 2'})
        subprocess.run([sys.executable,str(SCRIPT),'--source',str(SOURCE),'--canonical-dir',str(c),'--static-csv',str(static),'--out-dir',str(o)],check=True)
        offers=gzread(o/'griffon_branche_pdc_offers_contract_v1_1.json.gz');r=json.loads((o/'griffon_branche_materialization_report.json').read_text(encoding='utf-8'));s=r['summary']
        assert s['eligibleStationCount']==2 and s['eligiblePdcCount']==4 and s['coveredPdcCount']==4 and s['unresolvedPdcCount']==0,s
        assert s['publicOfferCount']==4 and s['subscriberOfferCount']==4
        pub={x['canonicalPdcId']:x for x in offers if x['subscriptionId'] is None};sub={x['canonicalPdcId']:x for x in offers if x['subscriptionId']=='griffon-branche'}
        assert pub['A1']['pricingRules'][0]['pricePerKwh']==0.45 and sub['A1']['pricingRules'][0]['pricePerKwh']==0.39
        assert pub['A2']['pricingRules'][0]['pricePerKwh']==0.55 and sub['A2']['pricingRules'][0]['pricePerKwh']==0.49
        assert pub['E1']['pricingRules'][0]['pricePerKwh']==0.59 and pub['E2']['pricingRules'][0]['pricePerKwh']==0.59
        assert not any(x['canonicalPdcId']=='X1' for x in offers)
    print('Griffon Branche materializer regression tests OK')
if __name__=='__main__':main()
