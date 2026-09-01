#!/usr/bin/env python3
from __future__ import annotations
import argparse,csv,datetime as dt,gzip,json,re,unicodedata
from collections import defaultdict
from pathlib import Path

def clean(v): return str(v or '').strip()
def norm(v):
    s=unicodedata.normalize('NFD',clean(v));s=''.join(c for c in s if unicodedata.category(c)!='Mn')
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
def read_meta(static_csv):
    out={};d=detect_dialect(static_csv)
    with open(static_csv,'r',encoding='utf-8-sig',newline='') as f:
        for row in csv.DictReader(f,dialect=d):
            sid=station_id(row)
            if sid and sid not in out:out[sid]={'authority':first(row,'nom_amenageur'),'codeInsee':first(row,'code_insee_commune','code_insee'),'brand':first(row,'nom_enseigne')}
    return out

def validate_source(d):
    if d.get('dataset')!='griffon-branche-direct-tariffs-france' or d.get('networkId')!='griffon-branche' or d.get('country')!='FR':raise ValueError('unexpected Griffon source')
    s=d.get('scope') or {};required={'canonicalUmbrellaTariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','requiredCodeInsee':'22278','requiresExactLocalScope':True,'directNetworkOnly':True,'physicalInventoryFromIrveOnly':True,'roamingMspTariffsRemainSeparate':True,'parkingExcludedFromChargingTariff':True,'genericAlizeLiberteNeverInheritsGriffonTariff':True,'otherRMobNetworksNeverInheritGriffonTariff':True}
    for k,v in required.items():
        if s.get(k)!=v:raise ValueError(f'invalid Griffon scope {k}')
    fam={x['id']:x for x in d.get('tariffFamilies') or []}
    if set(fam)!={'griffon-ac-22','griffon-dc-30','griffon-dc-180'}:raise ValueError('incomplete Griffon families')
    expected={'griffon-ac-22':(0.39,0.45,0.10,180),'griffon-dc-30':(0.49,0.55,0.15,60),'griffon-dc-180':(0.54,0.59,0.20,40)}
    for k,e in expected.items():
        f=fam[k]
        if (float(f['subscriberPricePerKwh']),float(f['publicPricePerKwh']),float(f['durationPerMinute']),int(f['durationThresholdMinutes']))!=e:raise ValueError(f'bad Griffon family {k}')
    a=d.get('access') or {}
    if a.get('subscriptionOptIn') is not True or float(a.get('griffonSubscriptionMonthlyFeeEur',-1))!=8 or float(a.get('badgePurchaseEur',-1))!=12:raise ValueError('bad Griffon access')
    return s,fam,a

def rules_for(f,price):
    out=[{'scope':'allDay','currency':'EUR','pricePerKwh':price,'chargePerMinute':0,'chargeThresholdMinutes':0,'durationPerMinute':0,'durationThresholdMinutes':0,'durationStart':None,'durationEnd':None,'connectionFee':0,'parkingPerMinute':0,'notes':'Energy component.'}]
    out.append({'scope':'timeWindow' if f.get('durationStart') else 'allDay','currency':'EUR','pricePerKwh':0,'chargePerMinute':0,'chargeThresholdMinutes':0,'durationPerMinute':f['durationPerMinute'],'durationThresholdMinutes':f['durationThresholdMinutes'],'durationStart':f.get('durationStart'),'durationEnd':f.get('durationEnd'),'connectionFee':0,'parkingPerMinute':0,'notes':f.get('notes') or 'Connection-duration component.'})
    for x in out:
        x.setdefault('days',None);x.setdefault('durationCap',None);x.setdefault('occupancyPerMinute',0);x.setdefault('occupancyThresholdMinutes',0);x.setdefault('occupancyStart',None);x.setdefault('occupancyEnd',None);x.setdefault('occupancyCap',None);x.setdefault('totalTransactionCap',None);x.setdefault('rounding',None)
    return out

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--source',required=True);ap.add_argument('--canonical-dir',required=True);ap.add_argument('--static-csv',required=True);ap.add_argument('--out-dir',required=True);a=ap.parse_args()
    src=load_json(a.source);scope,families,access=validate_source(src);stations=load_json(Path(a.canonical_dir)/'stations.json.gz');pdcs=load_json(Path(a.canonical_dir)/'charge_points.json.gz');station_by={clean(s.get('stationId')):s for s in stations};meta=read_meta(a.static_csv);authority_aliases={norm(x) for x in scope['contractingAuthorityAliases']};tokens=[norm(x) for x in scope['requiredStationNameTokens']];candidate=[]
    for p in pdcs:
        sid=clean(p.get('stationId'));st=station_by.get(sid) or {};m=meta.get(sid) or {};physical=p.get('physicalOperatorId') or st.get('physicalOperatorId');name=norm(st.get('name'))
        if p.get('tariffNetworkId')!='alize-liberte' or physical!='bouygues-energies-services':continue
        if norm(m.get('authority')) not in authority_aliases or clean(st.get('codeInsee') or m.get('codeInsee'))!='22278':continue
        if not all(t in name for t in tokens):continue
        candidate.append(p)
    station_max=defaultdict(float)
    for p in candidate:
        try:station_max[clean(p.get('stationId'))]=max(station_max[clean(p.get('stationId'))],float(p.get('powerKw') or 0))
        except (TypeError,ValueError):pass
    offers=[];unresolved=[];now=dt.datetime.now(dt.timezone.utc).isoformat();family_counts=defaultdict(int)
    for p in candidate:
        sid=clean(p.get('stationId'));pid=clean(p.get('pdcId'));con=p.get('connectors') or {};dc=truthy(con.get('comboCcs')) or truthy(con.get('chademo'))
        try:pw=float(p.get('powerKw'))
        except (TypeError,ValueError):pw=None
        family=None
        if station_max[sid]>30.5 and station_max[sid]<=180.5:family=families['griffon-dc-180']
        elif dc and pw is not None and 22.5<pw<=30.5:family=families['griffon-dc-30']
        elif not dc and pw is not None and pw<=22.5:family=families['griffon-ac-22']
        if family is None:
            unresolved.append({'canonicalStationId':sid,'canonicalPdcId':pid,'powerKw':p.get('powerKw'),'stationMaxPowerKw':station_max[sid],'connectors':con,'reason':'unproved_griffon_tariff_class'});continue
        family_counts[family['id']]+=1;base={'physicalOperatorId':'bouygues-energies-services','tariffNetworkId':'griffon-branche','sourceStationId':None,'sourceEvseId':None,'canonicalStationId':sid,'canonicalPdcId':pid,'matchMethod':'exact_local_scope','matchDistanceMeters':None,'selectors':{'umbrellaTariffNetworkId':'alize-liberte','contractingAuthority':(meta.get(sid) or {}).get('authority'),'codeInsee':'22278','parkingExcluded':True,'roamingSeparate':True},'kind':family['kind'],'minPowerKw':family.get('minPowerKwExclusive'),'maxPowerKw':family.get('maxPowerKw'),'validFrom':None,'validTo':None,'sourceUrl':src['sources']['officialAlizeNetworkPage'],'sourceUpdatedAt':src['verifiedAt'],'normalizedAt':now}
        offers.append({**base,'offerId':f"griffon-branche:public:{family['id']}:{pid}",'provider':'Griffon Branché','channel':'direct','sourceMode':'network_rule','selectors':{**base['selectors'],'paymentProfile':'public_alize'},'pricingRules':rules_for(family,family['publicPricePerKwh']),'subscriptionId':None,'rankable':True,'blockedReasons':[]})
        offers.append({**base,'offerId':f"griffon-branche:subscriber:{family['id']}:{pid}",'provider':'Griffon Branché — abonné','channel':'subscription','sourceMode':'network_rule','selectors':{**base['selectors'],'paymentProfile':'griffon_subscription','monthlyFeeEur':8.0,'badgePurchaseEur':12.0},'pricingRules':rules_for(family,family['subscriberPricePerKwh']),'subscriptionId':'griffon-branche','rankable':True,'blockedReasons':[]})
    station_ids={clean(p.get('stationId')) for p in candidate};covered={o['canonicalPdcId'] for o in offers};report={'schemaVersion':'1.0.0','dataset':'france-griffon-branche-canonical-audit','productionReady':False,'summary':{'eligibleStationCount':len(station_ids),'eligiblePdcCount':len(candidate),'coveredPdcCount':len(covered),'publicOfferCount':sum(1 for o in offers if o['subscriptionId'] is None),'subscriberOfferCount':sum(1 for o in offers if o['subscriptionId']=='griffon-branche'),'unresolvedPdcCount':len(unresolved),'physicalInventoryMutationCount':0},'familyPdcCounts':dict(sorted(family_counts.items())),'stations':sorted([{'stationId':s,'name':(station_by.get(s) or {}).get('name'),'stationMaxPowerKw':station_max[s]} for s in station_ids],key=lambda x:clean(x.get('name'))),'unresolved':unresolved[:100]}
    out=Path(a.out_dir);dump_json(out/'griffon_branche_pdc_offers_contract_v1_1.json.gz',offers);dump_json(out/'griffon_branche_materialization_report.json',report);print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
