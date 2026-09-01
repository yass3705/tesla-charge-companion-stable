#!/usr/bin/env python3
from __future__ import annotations
import csv,gzip,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];SCRIPT=ROOT/'scripts/materialize_france_cpark_rennes_offers.py';SOURCE=ROOT/'data/cpark_rennes_direct_tariffs_v1.json'
def gzwrite(path,obj):
    with gzip.open(path,'wt',encoding='utf-8') as f:json.dump(obj,f,ensure_ascii=False)
def gzread(path):
    with gzip.open(path,'rt',encoding='utf-8') as f:return json.load(f)
def main():
    with tempfile.TemporaryDirectory() as td:
        d=Path(td);c=d/'canonical';o=d/'out';c.mkdir()
        stations=[
          {'stationId':'FRCITP35001001','name':'Rennes Parking Arsenal C-PARK','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','address':'Rennes'},
          {'stationId':'FROTHP35002001','name':'Other Alize','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','address':'Other'},
          {'stationId':'FRCITP35003001','name':'Wrong CPO','tariffNetworkId':'alize-liberte','physicalOperatorId':'other-cpo','address':'Rennes'}]
        pdcs=[
          {'pdcId':'FRCITE350010011','stationId':'FRCITP35001001','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','powerKw':11.0,'connectors':{'type2':True}},
          {'pdcId':'FROTHE350020011','stationId':'FROTHP35002001','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','powerKw':11.0,'connectors':{'type2':True}},
          {'pdcId':'FRCITE350030011','stationId':'FRCITP35003001','tariffNetworkId':'alize-liberte','physicalOperatorId':'other-cpo','powerKw':11.0,'connectors':{'type2':True}}]
        gzwrite(c/'stations.json.gz',stations);gzwrite(c/'charge_points.json.gz',pdcs)
        static=d/'static.csv'
        with static.open('w',encoding='utf-8',newline='') as f:
            w=csv.DictWriter(f,fieldnames=['id_station_itinerance','nom_amenageur','nom_operateur','nom_enseigne','adresse_station']);w.writeheader();w.writerow({'id_station_itinerance':'FRCITP35001001','nom_amenageur':'CITEDIA METROPOLE','nom_operateur':'Bouygues Energies & Services','nom_enseigne':'Alizé Liberté 2','adresse_station':'Rennes'});w.writerow({'id_station_itinerance':'FROTHP35002001','nom_amenageur':'Autre aménageur','nom_operateur':'Bouygues Energies & Services','nom_enseigne':'Alizé Liberté 2','adresse_station':'Other'});w.writerow({'id_station_itinerance':'FRCITP35003001','nom_amenageur':'CITEDIA METROPOLE','nom_operateur':'Autre CPO','nom_enseigne':'Alizé Liberté 2','adresse_station':'Rennes'})
        subprocess.run([sys.executable,str(SCRIPT),'--source',str(SOURCE),'--canonical-dir',str(c),'--static-csv',str(static),'--out-dir',str(o)],check=True)
        offers=gzread(o/'cpark_rennes_pdc_offers_contract_v1_1.json.gz');r=json.loads((o/'cpark_rennes_materialization_report.json').read_text(encoding='utf-8'));s=r['summary']
        assert s=={'eligibleStationCount':1,'eligiblePdcCount':1,'rankableCoveredPdcCount':1,'rankableOfferCount':1,'referenceOfferCount':1,'unresolvedPdcCount':0,'physicalInventoryMutationCount':0},s
        rank=[x for x in offers if x['rankable']];ref=[x for x in offers if not x['rankable']]
        assert len(rank)==len(ref)==1
        assert rank[0]['tariffNetworkId']=='cpark-rennes' and rank[0]['subscriptionId']=='alize-liberte'
        assert rank[0]['pricingRules'][0]['connectionFee']==1.0 and rank[0]['pricingRules'][0]['pricePerKwh']==0.40
        assert rank[0]['pricingRules'][0]['parkingPerMinute']==0
        assert ref[0]['blockedReasons']==['third_party_operator_service_fee_may_apply']
    print('C-Park Rennes materializer regression tests OK')
if __name__=='__main__':main()
