#!/usr/bin/env python3
"""Regression tests: Tesla tariff priority after Mac update and beyond day 10."""
from __future__ import annotations
import copy
from tesla_v9_tariff_priority_safe import select_tariffs

def station(cc,observed=None,site_id="location-a",currency="EUR",rate=0.55,
            last_updated="2026-07-22",cfg_rates=None):
    cfg_rates=cfg_rates or [rate]
    rule=lambda n:{"type":"rules","rules":[{"scope":"allDay","billing":"kwh","currency":currency,
                                           "pricePerKwh":n}]}
    v={"id":f"tesla-{cc}-{site_id}","countryCode":cc,"teslaUrl":f"https://www.tesla.com/findus/location/supercharger/{site_id}",
       "lastUpdated":last_updated,"pricing":rule(rate),
       "chargingConfigurations":[{"id":f"{site_id}-{i}","powerKw":250,
                                   "pricing":rule(n)} for i,n in enumerate(cfg_rates)]}
    if observed:v["sourceObservedAt"]=observed
    return v

def suc(cc,observed,site_id="location-a",currency="EUR",rate=0.4):
    row=station(cc,site_id=site_id,currency=currency,rate=rate)
    row["sourceObservedAt"]=observed
    row["sucTracker"]={"sourceStationId":site_id,"lastSuccessfulAt":observed}
    return row

def updates(cc,date_str=None):
    return {"schemaVersion":1,"timeZone":"Europe/Paris",
            "countries":{cc:{"updatedOn":date_str}} if date_str else {}}

def run(name,mac,suc_rows,date,expected_src,expected_rate,metadata=None):
    data,report=select_tariffs([copy.deepcopy(mac)],[copy.deepcopy(x) for x in suc_rows],
       metadata if metadata is not None else updates(mac['countryCode']),date)
    country=report["countries"][mac["countryCode"]]
    v=data[0]["pricing"]["rules"][0]["pricePerKwh"]
    ok=(v==expected_rate and country["preferredTariffSource"]==expected_src and
        country['stations']==1)
    print("TESLA_PRIORITY_TEST",name,{"ok":ok,"source":country["preferredTariffSource"],
       "rate":v,"reason":country})
    if not ok:raise SystemExit('Priority regression '+name)

def main():
    fr=station('FR')
    fr_suc_old=suc('FR','2026-10-02T13:00:00Z')
    fr_suc_future=suc('FR','2026-10-25T13:00:00Z')
    run('fresh_mac_oct9','FR' and fr,[fr_suc_future],'2026-10-10','Mac',0.55,updates('FR','2026-10-09'))
    run('mac_older_ten_days_but_suc_older',fr,[fr_suc_old],'2026-10-20','Mac',0.55,updates('FR','2026-10-09'))
    run('mac_older_ten_days_suc_newer',fr,[fr_suc_future],'2026-10-28','SuC Tracker',0.4,updates('FR','2026-10-09'))
    run('mac_newer_even_after_ten_days',fr,[fr_suc_old],'2026-11-15','Mac',0.55,updates('FR','2026-10-09'))
    run('morocco_mac_always',station('MA',rate=1.2,currency='MAD'),[suc('MA','2026-10-25T01:00:00Z',rate=.2,currency='MAD')],
        '2026-11-20','Mac',1.2,updates('MA','2026-10-07'))
    run('de_old_legacy_suc_newer',station('DE'),[suc('DE','2026-10-02T01:00:00Z')],
        '2026-10-10','SuC Tracker',0.4,updates('DE'))
    run('source_id_mismatch_reject',fr,[suc('FR','2026-10-25T01:00:00Z','other-id')],
        '2026-11-20','Mac',0.55,updates('FR','2026-10-09'))
    run('suc_missing_observation_reject',fr,[station('FR',rate=.3)],
        '2026-11-20','Mac',0.55,updates('FR','2026-10-09'))
    run('per_configuration_mac_tiers_not_flattened',station('FR',cfg_rates=[.5,.7]),
        [suc('FR','2026-11-14T01:00:00Z')],'2026-11-20','Mac',0.55,updates('FR','2026-10-09'))
    # Source freshness is COUNTRY-WIDE, even if individual station's old
    # metadata would suggest a different observation date.
    multi_mac=[station('FR',site_id='a',observed='2026-10-27T01:00:00Z'),
               station('FR',site_id='b',last_updated='2026-07-22')]
    multi_suc=[suc('FR','2026-10-25T01:00:00Z',site_id='a'),
               suc('FR','2026-10-25T01:00:00Z',site_id='b')]
    out,report=select_tariffs(multi_mac,multi_suc,updates('FR','2026-10-09'),'2026-10-28')
    assert report['countries']['FR']['preferredTariffSource']=='SuC Tracker',report
    assert report['countries']['FR']['sucTariffs']==2,report
    assert all(x['pricing']['rules'][0]['pricePerKwh']==0.4 for x in out),out
    print('TESLA_PRIORITY_TEST country_uniform_even_when_station_dates_vary PASS')

    # One older SuC station is enough to keep the whole country Mac;
    # avoid mixing source age station by station.
    multi_suc[1]['sourceObservedAt']='2026-10-02T01:00:00Z'
    multi_suc[1]['sucTracker']['lastSuccessfulAt']='2026-10-02T01:00:00Z'
    out,report=select_tariffs(multi_mac,multi_suc,updates('FR','2026-10-09'),'2026-10-28')
    assert report['countries']['FR']['preferredTariffSource']=='Mac',report
    assert report['countries']['FR']['macTariffs']==2
    print('TESLA_PRIORITY_TEST heterogeneous_suc_country_dates_fail_closed PASS')

    # Station-level comparison ONLY for missing station in either source.
    out,report=select_tariffs(
        [station('DE',site_id='only-mac'),station('DE',site_id='both')],
        [suc('DE','2026-10-25T01:00:00Z',site_id='both'),
         suc('DE','2026-10-25T01:00:00Z',site_id='only-suc')],
         updates('DE'),'2026-10-28')
    info=report['countries']['DE']
    assert info['preferredTariffSource']=='SuC Tracker',info
    assert info['sucTariffs']==1 and info['onlyMacStations']==1 and info['sucOnlyStations']==1,info
    assert len(out)==2 and len(info['sourceExceptionRows'])==2,info
    assert sorted(x['type'] for x in info['sourceExceptionRows'])==['only_mac','only_suc_unverified_access']
    print('TESLA_PRIORITY_TEST source_presence_exceptions_only PASS')

    # Morocco remains Mac for every station independently of SuC ages.
    out,report=select_tariffs(
        [station('MA',site_id='a',currency='MAD'),station('MA',site_id='b',currency='MAD')],
        [suc('MA','2026-11-18T01:00:00Z',site_id='a',currency='MAD'),
         suc('MA','2026-11-18T01:00:00Z',site_id='b',currency='MAD')],
        updates('MA','2026-10-07'),'2026-11-20')
    assert report['countries']['MA']['preferredTariffSource']=='Mac'
    assert report['countries']['MA']['sucTariffs']==0
    print('TESLA_PRIORITY_TEST morocco_country_mac_only PASS')

    print('TESLA_PRIORITY_TESTS_PASS=13/13')

if __name__=='__main__':
    main()
