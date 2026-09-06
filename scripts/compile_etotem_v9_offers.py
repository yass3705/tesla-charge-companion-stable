#!/usr/bin/env python3
import argparse,json
from datetime import datetime,timezone
from pathlib import Path


def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--nantes',required=True)
    p.add_argument('--larochelle',required=True)
    p.add_argument('--montargis',required=True)
    p.add_argument('--output',default='data/v9/france-etotem-offers.json')
    a=p.parse_args()
    n=load(a.nantes); lr=load(a.larochelle); m=load(a.montargis)

    n_evse_plain=[f'FRETIE44172C1{i}' for i in range(1,7)]
    n_evse_star=[f'FR*ETI*E44172*C1{i}' for i in range(1,7)]
    dc=n_evse_plain[:4]+n_evse_star[:4]
    ac=n_evse_plain[4:]+n_evse_star[4:]

    offers=[
      {
        'id':'etotem-nantes-planchonnais-dc-standard','selectionId':'etotem-nantes-planchonnais-dc-standard','provider':'e-Totem direct',
        'operatorAliases':['e-Totem','E-Totem'],'countries':['FR'],'evseIds':dc,'connectorKinds':['DC'],'minPowerKw':180,'maxPowerKw':180,'currency':'EUR','priority':130,
        'pricing':{'type':'rules','rules':[{'scope':'allDay','pricePerKwh':float(n['dc']['standardEnergyEurPerKwh'])}],
                   'postChargeFee':{'graceMinutes':int(n['dc']['postChargeGraceMinutes']),'blockMinutes':int(n['dc']['postChargeBillingBlockMinutes']),'blockEur':float(n['dc']['postChargeFeeEurPerBlock']),'rounding':'started_block','trigger':'once_vehicle_is_charged'}},
        'source':'data-lab/station_verifications/nantes_etotem_sainte_luce_planchonnais_ac_dc_app_2026_08_22.json','directOperatorOnly':True,'verifiedScope':'exact_evse_set','defaultSelected':False,
        'metadata':{'timeZone':'Europe/Paris','networkWideGeneralization':False,'stationName':n['station']['name'],'city':n['station']['city'],'verificationDate':n['verifiedAt'],'ecoModeEurPerKwh':n['dc']['ecoModeEnergyEurPerKwh'],'ecoModeActivation':'not_modeled_yet'}
      },
      {
        'id':'etotem-nantes-planchonnais-ac-standard','selectionId':'etotem-nantes-planchonnais-ac-standard','provider':'e-Totem direct',
        'operatorAliases':['e-Totem','E-Totem'],'countries':['FR'],'evseIds':ac,'connectorKinds':['AC'],'minPowerKw':22,'maxPowerKw':22,'currency':'EUR','priority':130,
        'pricing':{'type':'rules','rules':[{'scope':'allDay','pricePerKwh':float(n['ac']['standardEnergyEurPerKwh'])}],
                   'postChargeFee':{'graceMinutes':int(n['ac']['postChargeGraceMinutes']),'blockMinutes':int(n['ac']['postChargeBillingBlockMinutes']),'blockEur':float(n['ac']['postChargeFeeEurPerBlock']),'rounding':'started_block','trigger':'once_vehicle_is_charged'}},
        'source':'data-lab/station_verifications/nantes_etotem_sainte_luce_planchonnais_ac_dc_app_2026_08_22.json','directOperatorOnly':True,'verifiedScope':'exact_evse_set','defaultSelected':False,
        'metadata':{'timeZone':'Europe/Paris','networkWideGeneralization':False,'stationName':n['station']['name'],'city':n['station']['city'],'verificationDate':n['verifiedAt'],'ecoModeEurPerKwh':n['ac']['ecoModeEnergyEurPerKwh'],'ecoModeActivation':'not_modeled_yet'}
      },
      {
        'id':'etotem-la-rochelle-jb-marcet-standard','selectionId':'etotem-la-rochelle-jb-marcet-standard','provider':'e-Totem direct',
        'operatorAliases':['e-Totem','E-Totem','E-TOTEM G10'],'countries':['FR'],'stationIds':['FR*G10*P17300*B','FRG10P17300B'],'currency':'EUR','priority':130,
        'pricing':{'type':'rules','rules':[{'scope':'allDay','pricePerKwh':float(lr['tariff']['energyEurPerKwh'])}],
                   'postChargeFee':{'graceMinutes':int(lr['tariff']['postChargeGraceMinutes']),'blockMinutes':int(lr['tariff']['postChargeFeeBlockMinutes']),'blockEur':float(lr['tariff']['postChargeFeeEurPerBlock']),'rounding':'started_block','trigger':'once_vehicle_is_charged'}},
        'source':'data-lab/station_verifications/la_rochelle_place_jb_marcet_etotem_g10_app_2026_08_22.json','directOperatorOnly':True,'verifiedScope':'exact_station','defaultSelected':False,
        'metadata':{'timeZone':'Europe/Paris','networkWideGeneralization':False,'stationName':lr['station']['name'],'verificationDate':lr['source']['evidenceDate'],'parkingTreatmentSiteSpecific':True}
      }
    ]
    out={
      'schemaVersion':1,'country':'FR','generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),'mode':'verified_exact_station_or_evse',
      'policy':{'networkWideGeneralization':False,'exactIdentityRequired':True,'ecoModeNotActivatedWithoutSelectionModel':True,'postChargeSeparateFromChargingTime':True,'subscriptionsOptIn':True},
      'directOffers':offers,'subscriptionOffers':[],
      'deferred':[{'station':m['station']['name'],'city':m['station']['city'],'reason':'exact_irve_station_or_evse_id_not_resolved_yet','verifiedTariff':m['tariff']}],
      'identityEvidence':{
        'nantes':{'stationName':n['station']['name'],'evseIdsPlain':n_evse_plain,'evseIdsStarred':n_evse_star,'resolution':'exact_pdc_identifiers'},
        'laRochelle':{'stationName':lr['station']['name'],'stationIds':['FR*G10*P17300*B','FRG10P17300B'],'resolution':'exact_station_identifier'},
        'montargis':{'stationName':m['station']['name'],'resolution':'deferred_no_exact_identifier'}
      }
    }
    path=Path(a.output);path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'offers':len(offers),'deferred':len(out['deferred']),'output':str(path)},indent=2))
if __name__=='__main__':main()
