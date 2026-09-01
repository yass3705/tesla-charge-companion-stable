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
    if d.get('dataset')!='arcachon-direct-tariffs-france' or d.get('networkId')!='arcachon' or d.get('country')!='FR':raise ValueError('unexpected Arcachon source')
    s=d.get('scope') or {};required={'canonicalUmbrellaTariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','requiredCodeInsee':'33009','requiresExactLocalScope':True,'directNetworkOnly':True,'physicalInventoryFromIrveOnly':True,'roamingMspTariffsRemainSeparate':True,'parkingExcludedFromChargingTariff':True,'genericAlizeLiberteNeverInheritsArcachonTariff':True,'otherRMobNetworksNeverInheritArcachonTariff':True}
    for k,v in required.items():
        if s.get(k)!=v:raise ValueError(f'invalid Arcachon scope {k}')
    fam={x['id']:x for x in d.get('tariffFamilies') or []}
    expected={'arcachon-proximity-ac','arcachon-citadine-ac','arcachon-citadine-dc','arcachon-express-240'}
    if set(fam)!=expected:raise ValueError('incomplete Arcachon tariff families')
    a=d.get('access') or {}
    if a.get('subscriptionOptIn') is not True or a.get('residencyRequired') is not True or float(a.get('arcachonSubscriptionMonthlyFeeEur',-1))!=10 or float(a.get('badgePurchaseEur',-1))!=12:raise ValueError('bad Arcachon access')
    checks={'arcachon-proximity-ac':(0.25,0.49,0.10,180),'arcachon-citadine-ac':(0.25,0.55,0.10,180),'arcachon-citadine-dc':(0.55,0.55,0.15,60),'arcachon-express-240':(0.65,0.65,0.20,40)}
    for k,e in checks.items():
        f=fam[k]
        if (float(f['subscriberPricePerKwh']),float(f['publicPricePerKwh']),float(f['durationPerMinute']),int(f['durationThresholdMinutes']))!=e:raise ValueError(f'bad Arcachon family {k}')
    if float(fam['arcachon-citadine-dc']['stationMaxPowerKw'])!=40.5 or float(fam['arcachon-express-240']['stationMinPowerKwExclusive'])!=40.5:raise ValueError('Arcachon PAN reconciliation threshold missing')
    return s,fam,a

def rule(price=0,rate=0,threshold=0,start=None,end=None,notes=None):
    r={'scope':'timeWindow' if start else 'allDay','currency':'EUR','pricePerKwh':price,'chargePerMinute':0,'chargeThresholdMinutes':0,'durationPerMinute':rate,'durationThresholdMinutes':threshold,'durationStart':start,'durationEnd':end,'connectionFee':0,'parkingPerMinute':0,'notes':notes}
    for k,v in {'days':None,'durationCap':None,'occupancyPerMinute':0,'occupancyThresholdMinutes':0,'occupancyStart':None,'occupancyEnd':None,'occupancyCap':None,'totalTransactionCap':None,'rounding':None}.items():r.setdefault(k,v)
    return r

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--source',required=True);ap.add_argument('--canonical-dir',required=True);ap.add_argument('--static-csv',required=True);ap.add_argument('--out-dir',required=True);a=ap.parse_args()
    src=load_json(a.source);scope,fam,access=validate_source(src);stations=load_json(Path(a.canonical_dir)/'stations.json.gz');pdcs=load_json(Path(a.canonical_dir)/'charge_points.json.gz');station_by={clean(s.get('stationId')):s for s in stations};meta=read_meta(a.static_csv);authorities={norm(x) for x in scope['contractingAuthorityAliases']};tokens=[norm(x) for x in scope['requiredStationNameTokens']];candidate=[]
    for p in pdcs:
        sid=clean(p.get('stationId'));st=station_by.get(sid) or {};m=meta.get(sid) or {};name=norm(st.get('name'));physical=p.get('physicalOperatorId') or st.get('physicalOperatorId')
        if p.get('tariffNetworkId')!='alize-liberte' or physical!='bouygues-energies-services':continue
        if norm(m.get('authority')) not in authorities or clean(st.get('codeInsee') or m.get('codeInsee'))!='33009':continue
        if not all(t in name for t in tokens):continue
        candidate.append(p)
    station_max=defaultdict(float)
    for p in candidate:
        try:station_max[clean(p.get('stationId'))]=max(station_max[clean(p.get('stationId'))],float(p.get('powerKw') or 0))
        except (TypeError,ValueError):pass
    proximity_max=float(fam['arcachon-proximity-ac']['stationMaxPowerKw']);citadine_max=float(fam['arcachon-citadine-dc']['stationMaxPowerKw']);express_max=float(fam['arcachon-express-240']['stationMaxPowerKw'])
    offers=[];unresolved=[];counts=defaultdict(int);station_classes={};now=dt.datetime.now(dt.timezone.utc).isoformat()
    for sid,mx in station_max.items():
        if 0<mx<=proximity_max:station_classes[sid]='proximity'
        elif proximity_max<mx<=citadine_max:station_classes[sid]='citadine'
        elif citadine_max<mx<=express_max:station_classes[sid]='express'
        else:station_classes[sid]='unresolved'
    for p in candidate:
        sid=clean(p.get('stationId'));pid=clean(p.get('pdcId'));mx=station_max[sid];cls=station_classes[sid];con=p.get('connectors') or {};dc=truthy(con.get('comboCcs')) or truthy(con.get('chademo'))
        family=None
        if cls=='proximity' and not dc:family=fam['arcachon-proximity-ac']
        elif cls=='citadine' and dc:family=fam['arcachon-citadine-dc']
        elif cls=='citadine' and not dc:family=fam['arcachon-citadine-ac']
        elif cls=='express':family=fam['arcachon-express-240']
        if family is None:
            unresolved.append({'canonicalStationId':sid,'canonicalPdcId':pid,'powerKw':p.get('powerKw'),'stationMaxPowerKw':mx,'stationClass':cls,'connectors':con,'reason':'unproved_arcachon_tariff_class'});continue
        counts[family['id']]+=1
        selectors={'umbrellaTariffNetworkId':'alize-liberte','contractingAuthority':(meta.get(sid) or {}).get('authority'),'codeInsee':'33009','stationClass':family['stationClass'],'parkingExcluded':True,'roamingSeparate':True}
        base={'physicalOperatorId':'bouygues-energies-services','tariffNetworkId':'arcachon','sourceStationId':None,'sourceEvseId':None,'canonicalStationId':sid,'canonicalPdcId':pid,'matchMethod':'exact_local_scope_station_topology','matchDistanceMeters':None,'selectors':selectors,'kind':family['kind'],'minPowerKw':family.get('stationMinPowerKwExclusive'),'maxPowerKw':family.get('stationMaxPowerKw'),'validFrom':None,'validTo':None,'sourceUrl':src['sources']['officialAlizeNetworkPage'],'sourceUpdatedAt':src['verifiedAt'],'normalizedAt':now}
        def rules(price):
            rows=[rule(price=price,notes='Energy component.')]
            rows.append(rule(rate=family['durationPerMinute'],threshold=family['durationThresholdMinutes'],start=family.get('durationStart'),end=family.get('durationEnd'),notes='Connection-duration component; AC minute fee is disabled overnight when a time window is present.'))
            return rows
        offers.append({**base,'offerId':f"arcachon:public:{family['id']}:{pid}",'provider':"Ville d'Arcachon",'channel':'direct','sourceMode':'network_rule','selectors':{**selectors,'paymentProfile':'public_alize'},'pricingRules':rules(family['publicPricePerKwh']),'subscriptionId':None,'rankable':True,'blockedReasons':[]})
        offers.append({**base,'offerId':f"arcachon:resident:{family['id']}:{pid}",'provider':"Ville d'Arcachon — résident abonné",'channel':'subscription','sourceMode':'network_rule','selectors':{**selectors,'paymentProfile':'arcachon_resident_subscription','monthlyFeeEur':10.0,'badgePurchaseEur':12.0,'residencyRequired':True},'pricingRules':rules(family['subscriberPricePerKwh']),'subscriptionId':'arcachon-resident','rankable':True,'blockedReasons':[]})
    station_ids={clean(p.get('stationId')) for p in candidate};covered={o['canonicalPdcId'] for o in offers};class_counts=defaultdict(int)
    for sid in station_ids:class_counts[station_classes[sid]]+=1
    report={'schemaVersion':'1.0.0','dataset':'france-arcachon-canonical-audit','productionReady':False,'summary':{'eligibleStationCount':len(station_ids),'eligiblePdcCount':len(candidate),'coveredPdcCount':len(covered),'publicOfferCount':sum(1 for o in offers if o['subscriptionId'] is None),'subscriberOfferCount':sum(1 for o in offers if o['subscriptionId']=='arcachon-resident'),'unresolvedPdcCount':len(unresolved),'physicalInventoryMutationCount':0},'officialTopology':src['topology'],'stationClassCounts':dict(sorted(class_counts.items())),'familyPdcCounts':dict(sorted(counts.items())),'stations':sorted([{'stationId':s,'name':(station_by.get(s) or {}).get('name'),'stationMaxPowerKw':station_max[s],'stationClass':station_classes[s]} for s in station_ids],key=lambda x:clean(x.get('name'))),'unresolved':unresolved[:100]}
    out=Path(a.out_dir);dump_json(out/'arcachon_pdc_offers_contract_v1_1.json.gz',offers);dump_json(out/'arcachon_materialization_report.json',report);print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
