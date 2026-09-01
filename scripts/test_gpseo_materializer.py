#!/usr/bin/env python3
from __future__ import annotations
import csv,gzip,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];SCRIPT=ROOT/'scripts/materialize_france_gpseo_offers.py';SOURCE=ROOT/'data/gpseo_direct_tariffs_v1.json'
def gzwrite(p,o):
    with gzip.open(p,'wt',encoding='utf-8') as f:json.dump(o,f,ensure_ascii=False)
def gzread(p):
    with gzip.open(p,'rt',encoding='utf-8') as f:return json.load(f)
def main():
    with tempfile.TemporaryDirectory() as td:
        d=Path(td);c=d/'canonical';o=d/'out';c.mkdir()
        stations=[{'stationId':'SLOW','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services'},{'stationId':'NORMAL','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services'},{'stationId':'OTHER','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services'}]
        pdcs=[{'pdcId':'E1','stationId':'SLOW','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','powerKw':7.0,'connectors':{'type2':'true','comboCcs':'false','chademo':'false'}},{'pdcId':'E2','stationId':'NORMAL','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','powerKw':22.0,'connectors':{'type2':'true','comboCcs':'false','chademo':'false'}},{'pdcId':'E3','stationId':'OTHER','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','powerKw':22.0,'connectors':{'type2':'true'}}]
        gzwrite(c/'stations.json.gz',stations);gzwrite(c/'charge_points.json.gz',pdcs)
        static=d/'static.csv'
        with static.open('w',encoding='utf-8',newline='') as f:
            w=csv.DictWriter(f,fieldnames=['id_station_itinerance','nom_amenageur']);w.writeheader();w.writerow({'id_station_itinerance':'SLOW','nom_amenageur':'Communauté urbaine Grand Paris Seine & Oise'});w.writerow({'id_station_itinerance':'NORMAL','nom_amenageur':'COMMUNAUTE URBAINE GRAND PARIS SEINE & OISE'});w.writerow({'id_station_itinerance':'OTHER','nom_amenageur':'Autre aménageur'})
        subprocess.run([sys.executable,str(SCRIPT),'--source',str(SOURCE),'--canonical-dir',str(c),'--static-csv',str(static),'--out-dir',str(o)],check=True)
        offers=gzread(o/'gpseo_pdc_offers_contract_v1_1.json.gz');r=json.loads((o/'gpseo_materialization_report.json').read_text(encoding='utf-8'));s=r['summary']
        assert s=={'eligibleStationCount':2,'eligiblePdcCount':2,'rankableCoveredPdcCount':2,'rankableOfferCount':2,'referenceOfferCount':2,'unresolvedPdcCount':0,'physicalInventoryMutationCount':0},r
        rank=[x for x in offers if x['rankable']];slow=next(x for x in rank if x['canonicalPdcId']=='E1');normal=next(x for x in rank if x['canonicalPdcId']=='E2')
        assert slow['pricingRules'][0]['pricePerKwh']==0.35 and slow['pricingRules'][1]['durationThresholdMinutes']==720
        assert normal['pricingRules'][0]['pricePerKwh']==0.35 and normal['pricingRules'][1]['durationThresholdMinutes']==180
        assert all(x['tariffNetworkId']=='gpseo' for x in offers);assert not any(x['canonicalPdcId']=='E3' for x in offers)
    print('GPSEO materializer tests: OK')
if __name__=='__main__':main()
