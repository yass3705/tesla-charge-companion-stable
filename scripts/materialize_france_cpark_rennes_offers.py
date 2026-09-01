#!/usr/bin/env python3
from __future__ import annotations
import argparse,csv,datetime as dt,gzip,json,re,unicodedata
from pathlib import Path

def clean(v): return str(v or '').strip()
def norm(v):
    s=unicodedata.normalize('NFD',clean(v)); s=''.join(c for c in s if unicodedata.category(c)!='Mn')
    return re.sub(r'[^a-z0-9]+',' ',s.lower()).strip()
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
def read_pan_station_meta(static_csv):
    out={};d=detect_dialect(static_csv)
    with open(static_csv,'r',encoding='utf-8-sig',newline='') as f:
        for row in csv.DictReader(f,dialect=d):
            sid=station_id(row)
            if sid and sid not in out:
                out[sid]={'authority':first(row,'nom_amenageur'),'operator':first(row,'nom_operateur'),'brand':first(row,'nom_enseigne'),'address':first(row,'adresse_station')}
    return out

def normalized_rules(rows):
    out=[]
    for r in rows:
        x=dict(r);x.setdefault('days',None);x.setdefault('chargeThresholdMinutes',0);x.setdefault('durationThresholdMinutes',0);x.setdefault('durationStart',None);x.setdefault('durationEnd',None);x.setdefault('durationCap',None);x.setdefault('occupancyPerMinute',0);x.setdefault('occupancyThresholdMinutes',0);x.setdefault('occupancyStart',None);x.setdefault('occupancyEnd',None);x.setdefault('occupancyCap',None);x.setdefault('totalTransactionCap',None);x.setdefault('rounding',None);out.append(x)
    return out

def validate_source(d):
    if d.get('dataset')!='cpark-rennes-direct-tariffs-france' or d.get('networkId')!='cpark-rennes' or d.get('country')!='FR':raise ValueError('unexpected C-Park Rennes source')
    s=d.get('scope') or {};required={'canonicalUmbrellaTariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','requiresExactPanContractingAuthority':True,'directNetworkOnly':True,'physicalInventoryFromIrveOnly':True,'roamingMspTariffsRemainSeparate':True,'parkingExcludedFromChargingTariff':True,'genericAlizeLiberteNeverInheritsCparkTariff':True}
    for k,v in required.items():
        if s.get(k)!=v:raise ValueError(f'invalid C-Park scope {k}')
    f=d.get('tariffFamily') or {};rules=f.get('pricingRules') or []
    if f.get('rankableWithAlizeLiberte') is not True or len(rules)!=1:raise ValueError('invalid C-Park tariff family')
    r=rules[0]
    if float(r.get('pricePerKwh',-1))!=0.40 or float(r.get('connectionFee',-1))!=1.0 or float(r.get('parkingPerMinute',-1))!=0:raise ValueError('invalid C-Park tariff')
    a=d.get('access') or {}
    if float(a.get('alizeLiberteMonthlyFeeEur',-1))!=0 or float(a.get('alizeLiberteBadgePurchaseEur',-1))!=12 or a.get('rankableProfile')!='alize-liberte':raise ValueError('invalid Alize profile')
    t=d.get('thirdPartyOperatorReference') or {}
    if t.get('rankable') is not False or t.get('reason')!='third_party_operator_service_fee_may_apply':raise ValueError('invalid third-party reference')
    return s,f,r

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--source',required=True);ap.add_argument('--canonical-dir',required=True);ap.add_argument('--static-csv',required=True);ap.add_argument('--out-dir',required=True);a=ap.parse_args()
    src=load_json(a.source);scope,family,price_rule=validate_source(src);stations=load_json(Path(a.canonical_dir)/'stations.json.gz');pdcs=load_json(Path(a.canonical_dir)/'charge_points.json.gz');station_by={clean(s.get('stationId')):s for s in stations};meta=read_pan_station_meta(a.static_csv);aliases={norm(x) for x in scope.get('contractingAuthorityAliases') or []};offers=[];eligible=[];now=dt.datetime.now(dt.timezone.utc).isoformat()
    for p in pdcs:
        sid=clean(p.get('stationId'));st=station_by.get(sid) or {};m=meta.get(sid) or {};physical=p.get('physicalOperatorId') or st.get('physicalOperatorId')
        if p.get('tariffNetworkId')!='alize-liberte' or physical!='bouygues-energies-services' or norm(m.get('authority')) not in aliases:continue
        eligible.append(p);pid=clean(p.get('pdcId'))
        base={'physicalOperatorId':'bouygues-energies-services','tariffNetworkId':'cpark-rennes','sourceStationId':None,'sourceEvseId':None,'canonicalStationId':sid,'canonicalPdcId':pid,'matchMethod':'exact_contracting_authority','matchDistanceMeters':None,'selectors':{'umbrellaTariffNetworkId':'alize-liberte','contractingAuthority':m.get('authority'),'parkingExcluded':True,'roamingSeparate':True},'kind':'AC','minPowerKw':None,'maxPowerKw':11.0,'validFrom':None,'validTo':None,'sourceUrl':(src.get('sources') or {}).get('officialCguIrve'),'sourceUpdatedAt':src.get('verifiedAt'),'normalizedAt':now}
        offers.append({**base,'offerId':f'cpark-rennes:alize-liberte:{pid}','provider':'C-Park Rennes via Alizé Liberté','channel':'subscription','sourceMode':'network_rule','selectors':{**base['selectors'],'paymentProfile':'alize-liberte','alizeMonthlyFeeEur':0.0,'alizeBadgePurchaseEur':12.0},'pricingRules':normalized_rules([price_rule]),'subscriptionId':'alize-liberte','rankable':True,'blockedReasons':[]})
        offers.append({**base,'offerId':f'cpark-rennes:third-party-reference:{pid}','provider':'CITEDIA Métropole — tarif de référence','channel':'reference','sourceMode':'reference_only','selectors':{**base['selectors'],'paymentProfile':'third_party_operator'},'pricingRules':normalized_rules([price_rule]),'subscriptionId':None,'rankable':False,'blockedReasons':['third_party_operator_service_fee_may_apply']})
    station_ids={clean(p.get('stationId')) for p in eligible};ranked=[o for o in offers if o['rankable']]
    report={'schemaVersion':'1.0.0','dataset':'france-cpark-rennes-canonical-audit','productionReady':False,'summary':{'eligibleStationCount':len(station_ids),'eligiblePdcCount':len(eligible),'rankableCoveredPdcCount':len({o['canonicalPdcId'] for o in ranked}),'rankableOfferCount':len(ranked),'referenceOfferCount':sum(1 for o in offers if not o['rankable']),'unresolvedPdcCount':0,'physicalInventoryMutationCount':0},'contractingAuthorities':sorted({(meta.get(s) or {}).get('authority') for s in station_ids}),'stations':sorted([{'stationId':s,'name':(station_by.get(s) or {}).get('name'),'address':(station_by.get(s) or {}).get('address'),'panBrand':(meta.get(s) or {}).get('brand')} for s in station_ids],key=lambda x:clean(x.get('name'))),'unresolved':[]}
    out=Path(a.out_dir);dump_json(out/'cpark_rennes_pdc_offers_contract_v1_1.json.gz',offers);dump_json(out/'cpark_rennes_materialization_report.json',report);print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
