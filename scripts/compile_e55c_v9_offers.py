#!/usr/bin/env python3
import argparse,json
from datetime import datetime,timezone
from pathlib import Path

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--station-verification',required=True)
    ap.add_argument('--operator-source',required=True)
    ap.add_argument('--output',default='data/v9/france-e55c-offers.json')
    args=ap.parse_args()
    station=json.loads(Path(args.station_verification).read_text(encoding='utf-8'))
    operator=json.loads(Path(args.operator_source).read_text(encoding='utf-8'))
    assert station['interpretation']['directCpoTariffResolved'] is True
    assert station['interpretation']['networkWideGeneralization'] is False
    assert operator['classification']['singleGuaranteedNationalConsumerDirectTariff'] is False
    windows=operator['indicativeWholesaleTariffsToMobilityOperators']
    assert windows['dayWindow']=='07:00-23:00' and windows['nightWindow']=='23:00-07:00'
    prices={x['label'].lower():x['eurPerMinute'] for x in station['directCpoPortalTariff']['pricing']}
    evse=station['directCpoPortalTariff']['evseId']
    power=station['connector']['powerKwDisplayed']
    offer={
      'id':'e55c-lons-le-saunier-lecourbe-direct',
      'selectionId':'e55c-lons-le-saunier-lecourbe-direct',
      'provider':'Electric 55 direct',
      'operatorAliases':['Electric 55','Electric 55 Charging','E55C'],
      'countries':['FR'],
      'evseIds':[evse],
      'connectorKinds':['AC'],
      'minPowerKw':power,'maxPowerKw':power,
      'currency':'EUR','priority':130,
      'pricing':{'type':'rules','rules':[
        {'scope':'timeWindow','start':'07:00','end':'23:00','currency':'EUR','connectedTimePerMinuteEur':prices['mode jour']},
        {'scope':'timeWindow','start':'23:00','end':'07:00','currency':'EUR','connectedTimePerMinuteEur':prices['mode nuit']}
      ]},
      'source':'data-lab/station_verifications/electric55_lons_le_saunier_rue_lecourbe_alize_2026_08_22.json',
      'directOperatorOnly':True,
      'verifiedScope':'exact_evse',
      'defaultSelected':False,
      'metadata':{
        'timeZone':'Europe/Paris','networkWideGeneralization':False,
        'stationName':station['station']['name'],'stationAddress':station['station']['address'],
        'verificationDate':station['verifiedAt'],'consumerPriceSource':'direct_cpo_portal',
        'dayNightWindowSource':'official_e55c_operator_reference',
        'alizeRetailKeptSeparate':True
      }
    }
    payload={
      'schemaVersion':1,'country':'FR','generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),
      'mode':'verified_exact_evse','policy':{
        'networkWideGeneralization':False,'exactEvseRequired':True,'wholesaleRatesExcluded':True,
        'emspPricesSeparate':True,'subscriptionsOptIn':True
      },
      'directOffers':[offer],'subscriptionOffers':[],
      'sourceEvidence':{'evseId':evse,'stationVerificationDate':station['verifiedAt'],'operatorFingerprint':operator['sourceEvidence']['relevantTariffFingerprintSha256']}
    }
    out=Path(args.output);out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'output':str(out),'offerCount':1,'evseId':evse,'networkWideGeneralization':False},ensure_ascii=False))

if __name__=='__main__':main()
