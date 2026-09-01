#!/usr/bin/env python3
from __future__ import annotations
import gzip, json, subprocess, sys, tempfile
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
          {'stationId':'FRSEYP78001001','tariffNetworkId':'seymaborne','physicalOperatorId':'bouygues-energies-services'},
          {'stationId':'FRSEYP78002001','tariffNetworkId':'seymaborne','physicalOperatorId':'other-cpo'},
          {'stationId':'FRBE3P78003001','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services'}]
        pdcs=[
          {'pdcId':'FRSEYE780010011','stationId':'FRSEYP78001001','tariffNetworkId':'seymaborne','physicalOperatorId':'bouygues-energies-services','powerKw':22.08,'connectors':{'type2':'true','comboCcs':'false','chademo':'false'}},
          {'pdcId':'FRSEYE780010012','stationId':'FRSEYP78001001','tariffNetworkId':'seymaborne','physicalOperatorId':'bouygues-energies-services','powerKw':36.0,'connectors':{'type2':'false','comboCcs':'true','chademo':'false'}},
          {'pdcId':'FRSEYE780020011','stationId':'FRSEYP78002001','tariffNetworkId':'seymaborne','physicalOperatorId':'other-cpo','powerKw':22.08,'connectors':{'type2':'true','comboCcs':'false','chademo':'false'}},
          {'pdcId':'FRBE3E780030011','stationId':'FRBE3P78003001','tariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','powerKw':22.08,'connectors':{'type2':'true'}}]
        gzwrite(c/'stations.json.gz',stations); gzwrite(c/'charge_points.json.gz',pdcs)
        subprocess.run([sys.executable,str(SCRIPT),'--source',str(SOURCE),'--canonical-dir',str(c),'--out-dir',str(o)],check=True)
        offers=gzread(o/'sey_ma_borne_pdc_offers_contract_v1_1.json.gz')
        report=json.loads((o/'sey_ma_borne_materialization_report.json').read_text(encoding='utf-8'))
        assert report['summary']=={'eligibleStationCount':2,'eligiblePdcCount':3,'rankableCoveredPdcCount':3,'rankableOfferCount':3,'referenceOfferCount':3,'unresolvedPdcCount':0,'physicalInventoryMutationCount':0}, report
        rank=[x for x in offers if x['rankable']]
        assert {x['canonicalPdcId'] for x in rank}=={'FRSEYE780010011','FRSEYE780010012','FRSEYE780020011'}
        ac=next(x for x in rank if x['canonicalPdcId']=='FRSEYE780010011'); dc=next(x for x in rank if x['kind']=='DC')
        assert ac['tariffNetworkId']=='seymaborne' and ac['pricingRules'][0]['pricePerKwh']==0.36
        assert ac['pricingRules'][1]['durationThresholdMinutes']==120 and abs(ac['pricingRules'][2]['durationPerMinute']-0.005)<1e-12
        assert dc['pricingRules'][0]['pricePerKwh']==0.46 and dc['pricingRules'][1]['durationThresholdMinutes']==0
        assert all(x['selectors']['explicitPanTariffNetworkId']=='seymaborne' for x in offers)
        assert not any(x['canonicalStationId']=='FRBE3P78003001' for x in offers)
        assert report['physicalOperatorPdcCounts']=={'bouygues-energies-services':2,'other-cpo':1}
    print('SEY ma Borne materializer tests: OK')
if __name__=='__main__': main()
