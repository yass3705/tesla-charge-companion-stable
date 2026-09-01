#!/usr/bin/env python3
from __future__ import annotations
import argparse, csv, datetime as dt, gzip, json, re, unicodedata
from pathlib import Path


def clean(v): return str(v or '').strip()
def norm(v):
    s=unicodedata.normalize('NFD',clean(v)); s=''.join(c for c in s if unicodedata.category(c)!='Mn')
    return re.sub(r'[^a-z0-9]+',' ',s.lower()).strip()
def truthy(v): return norm(v) in {'true','vrai','1','oui','yes'}
def load_json(path):
    p=Path(path)
    if p.suffix=='.gz':
        with gzip.open(p,'rt',encoding='utf-8') as f: return json.load(f)
    return json.loads(p.read_text(encoding='utf-8'))
def dump_json(path,value):
    p=Path(path); p.parent.mkdir(parents=True,exist_ok=True)
    if p.suffix=='.gz':
        with gzip.open(p,'wt',encoding='utf-8',compresslevel=9) as f: json.dump(value,f,ensure_ascii=False,separators=(',',':'))
    else: p.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def detect_dialect(path):
    with open(path,'r',encoding='utf-8-sig',newline='') as f: sample=f.read(65536)
    try: return csv.Sniffer().sniff(sample,delimiters=',;\t|')
    except csv.Error: return csv.excel
def first(row,*keys):
    for k in keys:
        x=clean(row.get(k))
        if x: return x
    return ''
def station_id(row): return first(row,'id_station_itinerance') or first(row,'id_station_local')

def validate_review(d):
    if d.get('dataset')!='grenoble-alpes-metropole-tariff-review-france' or d.get('networkId')!='grenoble-alpes-metropole' or d.get('country')!='FR':
        raise ValueError('unexpected Grenoble source')
    p=d.get('policy') or {}
    required={'physicalInventoryFromIrveOnly':True,'directNetworkOnly':True,'parkingSeparatedFromCharging':True,'roamingMspTariffsRemainSeparate':True,'genericAlizeLiberteNeverInheritsGrenobleTariff':True,'streetZoneRequiredForTimeTariff':True,'publicParkingSubscriberSlowChargeMayBeRankedOnlyWithExactAmenageurAndPower':True,'failClosed':True}
    for k,v in required.items():
        if p.get(k)!=v: raise ValueError(f'invalid Grenoble policy: {k}')
    sub=((d.get('currentPublicNetwork') or {}).get('subscription') or {})
    if sub.get('id')!='grenoble-oura' or float(sub.get('monthlyFeeEur',-1))!=6 or sub.get('optIn') is not True:
        raise ValueError('invalid Grenoble subscription')
    pg=d.get('publicParkingPGam') or {}; safe=pg.get('safeRankableProfile') or {}
    if safe.get('subscriptionId')!='grenoble-oura' or safe.get('channel')!='subscription' or safe.get('kind')!='AC' or float(safe.get('maxPowerKw',-1))!=7.4 or float(safe.get('pricePerKwh',-1))!=0.29:
        raise ValueError('invalid Grenoble P-GAM safe profile')
    if safe.get('requiresCanonicalUmbrellaNetworkId')!='alize-liberte' or safe.get('requiresPhysicalOperatorId')!='bouygues-energies-services':
        raise ValueError('invalid Grenoble P-GAM identity guards')
    return sub,pg,safe

def read_amenageurs(static_csv):
    out={}; dialect=detect_dialect(static_csv)
    with open(static_csv,'r',encoding='utf-8-sig',newline='') as f:
        for row in csv.DictReader(f,dialect=dialect):
            sid=station_id(row)
            if sid and sid not in out: out[sid]=first(row,'nom_amenageur')
    return out

def normalized_rule(price):
    return {'scope':'allDay','start':None,'end':None,'days':None,'currency':'EUR','pricePerKwh':price,'chargePerMinute':0,'chargeThresholdMinutes':0,'durationPerMinute':0,'durationThresholdMinutes':0,'durationStart':None,'durationEnd':None,'durationCap':None,'connectionFee':0,'occupancyPerMinute':0,'occupancyThresholdMinutes':0,'occupancyStart':None,'occupancyEnd':None,'occupancyCap':None,'parkingPerMinute':0,'totalTransactionCap':None,'rounding':None,'notes':'Parking charge is separate from the charging transaction.'}

def is_ac_slow(pdc):
    con=pdc.get('connectors') or {}
    dc=truthy(con.get('comboCcs')) or truthy(con.get('chademo'))
    try: power=float(pdc.get('powerKw'))
    except (TypeError,ValueError): return False
    return (not dc) and power<=7.4

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--review',required=True); ap.add_argument('--canonical-dir',required=True); ap.add_argument('--static-csv',required=True); ap.add_argument('--out-dir',required=True); a=ap.parse_args()
    review=load_json(a.review); sub,pg,safe=validate_review(review)
    stations=load_json(Path(a.canonical_dir)/'stations.json.gz'); pdcs=load_json(Path(a.canonical_dir)/'charge_points.json.gz')
    station_by={clean(s.get('stationId')):s for s in stations}; amenageur=read_amenageurs(a.static_csv)
    pgam_aliases={norm(x) for x in pg.get('panAmenageurAliases') or []}
    explicit=[]; pgam=[]; offers=[]; now=dt.datetime.now(dt.timezone.utc).isoformat(); source=(review.get('sources') or {}).get('officialMetropoleSeptember2026News')

    for pdc in pdcs:
        sid=clean(pdc.get('stationId')); st=station_by.get(sid) or {}; pid=clean(pdc.get('pdcId'))
        if pdc.get('tariffNetworkId')=='grenoble-alpes-metropole':
            explicit.append(pdc)
            offers.append({'offerId':f'grenoble:street-reference:{pid}','physicalOperatorId':pdc.get('physicalOperatorId') or st.get('physicalOperatorId'),'tariffNetworkId':'grenoble-alpes-metropole','provider':'Grenoble-Alpes Métropole','channel':'reference','sourceMode':'reference_only','sourceStationId':None,'sourceEvseId':None,'canonicalStationId':sid,'canonicalPdcId':pid,'matchMethod':'network_scope','matchDistanceMeters':None,'selectors':{'scope':'voirie_or_park_ride','zoneRequired':True,'parkingExcluded':True,'roamingSeparate':True},'kind':None,'minPowerKw':None,'maxPowerKw':None,'pricingRules':[],'subscriptionId':None,'validFrom':None,'validTo':None,'rankable':False,'blockedReasons':['street_zone_or_site_class_not_mapped'],'sourceUrl':(review.get('sources') or {}).get('officialAlizeNetworkPage'),'sourceUpdatedAt':review.get('verifiedAt'),'normalizedAt':now})
            continue
        physical=pdc.get('physicalOperatorId') or st.get('physicalOperatorId')
        if pdc.get('tariffNetworkId')!='alize-liberte' or physical!='bouygues-energies-services' or norm(amenageur.get(sid)) not in pgam_aliases:
            continue
        pgam.append(pdc)
        base={'physicalOperatorId':'bouygues-energies-services','tariffNetworkId':'grenoble-alpes-metropole','sourceStationId':None,'sourceEvseId':None,'canonicalStationId':sid,'canonicalPdcId':pid,'matchMethod':'network_scope','matchDistanceMeters':None,'selectors':{'umbrellaTariffNetworkId':'alize-liberte','amenageur':amenageur.get(sid),'siteClass':'public_parking_pgam','parkingExcluded':True,'roamingSeparate':True},'validFrom':'2026-09-01','validTo':None,'sourceUrl':source,'sourceUpdatedAt':review.get('verifiedAt'),'normalizedAt':now}
        if is_ac_slow(pdc):
            offers.append({**base,'offerId':f'grenoble:pgam-subscriber-7kw:{pid}','provider':'Grenoble-Alpes Métropole — Oùra','channel':'subscription','sourceMode':'network_rule','kind':'AC','minPowerKw':None,'maxPowerKw':7.4,'pricingRules':[normalized_rule(0.29)],'subscriptionId':'grenoble-oura','rankable':True,'blockedReasons':[]})
        else:
            offers.append({**base,'offerId':f'grenoble:pgam-reference:{pid}','provider':'Grenoble-Alpes Métropole — P-GAM','channel':'reference','sourceMode':'reference_only','kind':None,'minPowerKw':None,'maxPowerKw':None,'pricingRules':[],'subscriptionId':None,'rankable':False,'blockedReasons':['pgam_higher_power_or_connector_class_not_verified_for_september_2026_tariff']})

    rankable=[o for o in offers if o.get('rankable')]; pgam_ids={clean(p.get('pdcId')) for p in pgam}; rankable_ids={o['canonicalPdcId'] for o in rankable}
    if not rankable_ids.issubset(pgam_ids): raise AssertionError('Grenoble rankable offer escaped P-GAM scope')
    if any(o.get('subscriptionId')!='grenoble-oura' for o in rankable): raise AssertionError('Grenoble rankable offer missing opt-in subscription')
    report={'schemaVersion':'1.0.0','dataset':'france-grenoble-alpes-metropole-canonical-audit','productionReady':False,'summary':{'explicitGrenobleNetworkStationCount':len({clean(p.get('stationId')) for p in explicit}),'explicitGrenobleNetworkPdcCount':len(explicit),'explicitNetworkReferenceOfferCount':sum(1 for o in offers if o['offerId'].startswith('grenoble:street-reference:')),'pgamStationCount':len({clean(p.get('stationId')) for p in pgam}),'pgamPdcCount':len(pgam),'pgamRankableSubscriberPdcCount':len(rankable_ids),'pgamReferencePdcCount':len(pgam)-len(rankable_ids),'rankableOfferCount':len(rankable),'referenceOfferCount':sum(1 for o in offers if not o.get('rankable')),'physicalInventoryMutationCount':0},'pgamAmenageurs':sorted({amenageur.get(clean(p.get('stationId'))) for p in pgam}), 'subscription':sub}
    out=Path(a.out_dir); dump_json(out/'grenoble_pdc_offers_contract_v1_1.json.gz',offers); dump_json(out/'grenoble_materialization_report.json',report); print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__': main()
