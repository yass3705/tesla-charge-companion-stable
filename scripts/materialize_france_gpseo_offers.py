#!/usr/bin/env python3
from __future__ import annotations
import argparse,csv,datetime as dt,gzip,json,re,unicodedata
from pathlib import Path

def clean(v): return str(v or '').strip()
def norm(v):
    s=unicodedata.normalize('NFD',clean(v)); s=''.join(c for c in s if unicodedata.category(c)!='Mn')
    return re.sub(r'[^a-z0-9]+',' ',s.lower()).strip()
def truthy(v): return norm(v) in {'true','vrai','1','oui','yes'}
def load_json(path):
    p=Path(path)
    if p.suffix=='.gz':
        with gzip.open(p,'rt',encoding='utf-8') as f:return json.load(f)
    return json.loads(p.read_text(encoding='utf-8'))
def dump_json(path,value):
    p=Path(path);p.parent.mkdir(parents=True,exist_ok=True)
    if p.suffix=='.gz':
        with gzip.open(p,'wt',encoding='utf-8',compresslevel=9) as f:json.dump(value,f,ensure_ascii=False,separators=(',',':'))
    else:p.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def detect_dialect(path):
    with open(path,'r',encoding='utf-8-sig',newline='') as f:sample=f.read(65536)
    try:return csv.Sniffer().sniff(sample,delimiters=',;\t|')
    except csv.Error:return csv.excel
def first(row,*keys):
    for k in keys:
        x=clean(row.get(k))
        if x:return x
    return ''
def station_id(row):return first(row,'id_station_itinerance') or first(row,'id_station_local')
def read_authorities(static_csv):
    out={};dialect=detect_dialect(static_csv)
    with open(static_csv,'r',encoding='utf-8-sig',newline='') as f:
        for row in csv.DictReader(f,dialect=dialect):
            sid=station_id(row)
            if sid and sid not in out:out[sid]=first(row,'nom_amenageur')
    return out

def validate_source(d):
    if d.get('dataset')!='gpseo-direct-tariffs-france' or d.get('networkId')!='gpseo' or d.get('country')!='FR':raise ValueError('unexpected GPSEO source')
    s=d.get('scope') or {};required={'canonicalUmbrellaTariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','requiresExactPanContractingAuthority':True,'directNetworkOnly':True,'physicalInventoryFromIrveOnly':True,'roamingMspTariffsRemainSeparate':True,'parkingExcludedFromChargingTariff':True,'genericAlizeLiberteNeverInheritsGpseoTariff':True}
    for k,v in required.items():
        if s.get(k)!=v:raise ValueError(f'invalid GPSEO scope {k}')
    fam={x['id']:x for x in d.get('tariffFamilies') or []}
    if set(fam)!={'gpseo-slow-7kw-direct','gpseo-normal-22kw-direct'}:raise ValueError('incomplete GPSEO families')
    if fam['gpseo-slow-7kw-direct']['pricingRules'][0]['pricePerKwh']!=0.35 or fam['gpseo-normal-22kw-direct']['pricingRules'][0]['pricePerKwh']!=0.35:raise ValueError('bad GPSEO energy price')
    if fam['gpseo-slow-7kw-direct']['pricingRules'][1]['durationThresholdMinutes']!=720 or fam['gpseo-normal-22kw-direct']['pricingRules'][1]['durationThresholdMinutes']!=180:raise ValueError('bad GPSEO duration thresholds')
    card=d.get('contactlessBankCardReference') or {}
    if card.get('rankable') is not False or float(card.get('pricePerKwh',-1))!=0.50:raise ValueError('bad GPSEO card reference')
    return s,fam,card

def rules(rows):
    out=[]
    for r in rows:
        x=dict(r);x.setdefault('days',None);x.setdefault('chargeThresholdMinutes',0);x.setdefault('durationThresholdMinutes',0);x.setdefault('durationStart',None);x.setdefault('durationEnd',None);x.setdefault('durationCap',None);x.setdefault('occupancyPerMinute',0);x.setdefault('occupancyThresholdMinutes',0);x.setdefault('occupancyStart',None);x.setdefault('occupancyEnd',None);x.setdefault('occupancyCap',None);x.setdefault('totalTransactionCap',None);x.setdefault('rounding',None);out.append(x)
    return out

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--source',required=True);ap.add_argument('--canonical-dir',required=True);ap.add_argument('--static-csv',required=True);ap.add_argument('--out-dir',required=True);a=ap.parse_args()
    src=load_json(a.source);scope,families,card=validate_source(src);stations=load_json(Path(a.canonical_dir)/'stations.json.gz');pdcs=load_json(Path(a.canonical_dir)/'charge_points.json.gz');station_by={clean(s.get('stationId')):s for s in stations};auth=read_authorities(a.static_csv);aliases={norm(x) for x in scope.get('contractingAuthorityAliases') or []};offers=[];unresolved=[];eligible=[];now=dt.datetime.now(dt.timezone.utc).isoformat()
    for p in pdcs:
        sid=clean(p.get('stationId'));st=station_by.get(sid) or {};physical=p.get('physicalOperatorId') or st.get('physicalOperatorId')
        if p.get('tariffNetworkId')!='alize-liberte' or physical!='bouygues-energies-services' or norm(auth.get(sid)) not in aliases:continue
        eligible.append(p);pid=clean(p.get('pdcId'));con=p.get('connectors') or {};dc=truthy(con.get('comboCcs')) or truthy(con.get('chademo'))
        try:pw=float(p.get('powerKw'))
        except (TypeError,ValueError):pw=None
        family=None
        if not dc and pw is not None and pw<=7.4:family=families['gpseo-slow-7kw-direct']
        elif not dc and pw is not None and 7.4<pw<=22.5:family=families['gpseo-normal-22kw-direct']
        if family is None:
            unresolved.append({'canonicalStationId':sid,'canonicalPdcId':pid,'powerKw':p.get('powerKw'),'connectors':con,'contractingAuthority':auth.get(sid),'reason':'unproved_gpseo_power_class'});continue
        base={'physicalOperatorId':'bouygues-energies-services','tariffNetworkId':'gpseo','sourceStationId':None,'sourceEvseId':None,'canonicalStationId':sid,'canonicalPdcId':pid,'matchMethod':'network_scope','matchDistanceMeters':None,'selectors':{'umbrellaTariffNetworkId':'alize-liberte','contractingAuthority':auth.get(sid),'parkingExcluded':True,'roamingSeparate':True},'kind':'AC','minPowerKw':family.get('minPowerKwExclusive'),'maxPowerKw':family.get('maxPowerKw'),'validFrom':None,'validTo':None,'sourceUrl':(src.get('sources') or {}).get('officialGpseoPage'),'sourceUpdatedAt':src.get('verifiedAt'),'normalizedAt':now}
        offers.append({**base,'offerId':f"gpseo:{family['id']}:{pid}",'provider':'Grand Paris Seine & Oise','channel':'direct','sourceMode':'network_rule','selectors':{**base['selectors'],'paymentProfile':'qr_app_or_partner_badge'},'pricingRules':rules(family['pricingRules']),'subscriptionId':None,'rankable':True,'blockedReasons':[]})
        offers.append({**base,'offerId':f'gpseo:contactless-card-reference:{pid}','provider':'Grand Paris Seine & Oise — CB sans contact','channel':'reference','sourceMode':'reference_only','selectors':{**base['selectors'],'paymentProfile':'contactless_bank_card'},'pricingRules':rules([{'scope':'allDay','currency':'EUR','pricePerKwh':0.50,'chargePerMinute':0,'durationPerMinute':0,'durationThresholdMinutes':0,'connectionFee':0,'parkingPerMinute':0,'notes':'Contactless bank-card official energy-only tariff.'}]),'subscriptionId':None,'rankable':False,'blockedReasons':['payment_method_selector_not_yet_modeled']})
    covered={o['canonicalPdcId'] for o in offers if o['rankable']};station_ids={clean(p.get('stationId')) for p in eligible};report={'schemaVersion':'1.0.0','dataset':'france-gpseo-canonical-audit','productionReady':False,'summary':{'eligibleStationCount':len(station_ids),'eligiblePdcCount':len(eligible),'rankableCoveredPdcCount':len(covered),'rankableOfferCount':sum(1 for o in offers if o['rankable']),'referenceOfferCount':sum(1 for o in offers if not o['rankable']),'unresolvedPdcCount':len(unresolved),'physicalInventoryMutationCount':0},'contractingAuthorities':sorted({auth.get(s) for s in station_ids}),'unresolved':unresolved[:500]}
    out=Path(a.out_dir);dump_json(out/'gpseo_pdc_offers_contract_v1_1.json.gz',offers);dump_json(out/'gpseo_materialization_report.json',report);print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
