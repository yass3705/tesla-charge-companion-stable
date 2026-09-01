#!/usr/bin/env python3
from __future__ import annotations
import csv, gzip, json, subprocess, sys, tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/'scripts/materialize_france_sey_ma_borne_offers.py'
SOURCE=ROOT/'data/sey_ma_borne_direct_tariffs_v1.json'

def gzwrite(path,obj):
    with gzip.open(path,'wt',encoding='utf-8') as f: json.dump(obj,f,ensure_ascii=False)
def gzread(path):
    with gzip.open(path,'rt',encoding='utf-8') as f: return json.load(f)

def main():
    with tempfile.TemporaryDirectory() as td:
        d=Path(td); c=d/'canonical'; o=d/'out'; c.mkdir()
        stations=[
          {'stationId':'FRBE3P78001001','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services'},
          {'stationId':'FRBE3P78002001','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services'},
          {'stationId':'FRBE3P78003001','tariffNetworkId':'alize-liberte','physicalOperatorId':'other-cpo'}]
        pdcs=[
          {'pdcId':'FRBE3E780010011','stationId':'FRBE3P78001001','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','powerKw':22.08,'connectors':{'type2':'true','comboCcs':'false','chademo':'false'}},
          {'pdcId':'FRBE3E780010012','stationId':'FRBE3P78001001','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','powerKw':36.0,'connectors':{'type2':'false','comboCcs':'true','chademo':'false'}},
          {'pdcId':'FRBE3E780020011','stationId':'FRBE3P78002001','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','powerKw':22.08,'connectors':{'type2':'true'}},
          {'pdcId':'FRBE3E780030011','stationId':'FRBE3P78003001','tariffNetworkId':'alize-liberte','physicalOperatorId':'other-cpo','powerKw':22.08,'connectors':{'type2':'true'}}]
        gzwrite(c/'stations.json.gz',stations); gzwrite(c/'charge_points.json.gz',pdcs)
        static=d/'static.csv'
        with static.open('w',encoding='utf-8',newline='') as f:
            w=csv.DictWriter(f,fieldnames=['id_station_itinerance','nom_amenageur']); w.writeheader()
            w.writerow({'id_station_itinerance':'FRBE3P78001001','nom_amenageur':"Syndicat d'Énergie des Yvelines"})
            w.writerow({'id_station_itinerance':'FRBE3P78002001','nom_amenageur':'Autre aménageur'})
            w.writerow({'id_station_itinerance':'FRBE3P78003001','nom_amenageur':"Syndicat d'Energie des Yvelines"})
        subprocess.run([sys.executable,str(SCRIPT),'--source',str(SOURCE),'--canonical-dir',str(c),'--static-csv',str(static),'--out-dir',str(o)],check=True)
        offers=gzread(o/'sey_ma_borne_pdc_offers_contract_v1_1.json.gz')
        report=json.loads((o/'sey_ma_borne_materialization_report.json').read_text(encoding='utf-8'))
        assert report['summary']=={'eligibleStationCount':1,'eligiblePdcCount':2,'rankableCoveredPdcCount':2,'rankableOfferCount':2,'referenceOfferCount':2,'unresolvedPdcCount':0,'physicalInventoryMutationCount':0}, report
        rank=[x for x in offers if x['rankable']]
        assert {x['canonicalPdcId'] for x in rank}=={'FRBE3E780010011','FRBE3E780010012'}
        ac=next(x for x in rank if x['kind']=='AC'); dc=next(x for x in rank if x['kind']=='DC')
        assert ac['tariffNetworkId']=='sey-ma-borne' and ac['pricingRules'][0]['pricePerKwh']==0.36
        assert ac['pricingRules'][1]['durationThresholdMinutes']==120 and abs(ac['pricingRules'][2]['durationPerMinute']-0.005)<1e-12
        assert dc['pricingRules'][0]['pricePerKwh']==0.46 and dc['pricingRules'][1]['durationThresholdMinutes']==0
        assert all(x['physicalOperatorId']=='bouygues-energies-services' for x in offers)
        assert not any(x['canonicalStationId'] in {'FRBE3P78002001','FRBE3P78003001'} for x in offers)
    print('SEY ma Borne materializer tests: OK')
if __name__=='__main__': main()
