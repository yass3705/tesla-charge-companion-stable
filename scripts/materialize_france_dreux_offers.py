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
    if d.get('dataset')!='dreux-direct-tariffs-france' or d.get('networkId')!='dreux' or d.get('country')!='FR':raise ValueError('unexpected Dreux source')
    s=d.get('scope') or {};required={'canonicalUmbrellaTariffNetworkId':'alize-liberte','physicalOperatorId':'bouygues-energies-services','requiredCodeInsee':'28134','requiresExactLocalScope':True,'directNetworkOnly':True,'physicalInventoryFromIrveOnly':True,'roamingMspTariffsRemainSeparate':True,'parkingExcludedFromChargingTariff':True,'genericAlizeLiberteNeverInheritsDreuxTariff':True,'otherRMobNetworksNeverInheritDreuxTariff':True}
    for k,v in required.items():
        if s.get(k)!=v:raise ValueError(f'invalid Dreux scope {k}')
    fam={x['id']:x for x in d.get('tariffFamilies') or []}
    if set(fam)!={'dreux-citadine-ac','dreux-citadine-dc','dreux-express-150'}:raise ValueError('incomplete Dreux families')
    if (fam['dreux-citadine-ac']['subscriberPricePerKwh'],fam['dreux-citadine-ac']['publicPricePerKwh'])!=(0.39,0.49):raise ValueError('bad Dreux AC tariff')
    if (fam['dreux-citadine-dc']['subscriberPricePerKwh'],fam['dreux-citadine-dc']['publicPricePerKwh'])!=(0.49,0.49):raise ValueError('bad Dreux DC tariff')
    if (fam['dreux-express-150']['subscriberPricePerKwh'],fam['dreux-express-150']['publicPricePerKwh'])!=(0.54,0.54):raise ValueError('bad Dreux express tariff')
    a=d.get('access') or {}
    if a.get('subscriptionOptIn') is not True or float(a.get('dreuxSubscriptionMonthlyFeeEur',-1))!=10 or float(a.get('badgePurchaseEur',-1))!=12:raise ValueError('bad Dreux access')
    return s,fam,a

def energy_rule(price):
    return {'scope':'allDay','currency':'EUR','pricePerKwh':price,'chargePerMinute':0,'chargeThresholdMinutes':0,'durationPerMinute':0,'durationThresholdMinutes':0,'durationStart':None,'durationEnd':None,'connectionFee':0,'parkingPerMinute':0,'notes':'Energy component.'}
def duration_rule(rate,threshold,start=None,end=None,notes=None):
    return {'scope':'timeWindow' if start else 'allDay','currency':'EUR','pricePerKwh':0,'chargePerMinute':0,'chargeThresholdMinutes':0,'durationPerMinute':rate,'durationThresholdMinutes':threshold,'durationStart':start,'durationEnd':end,'connectionFee':0,'parkingPerMinute':0,'notes':notes or 'Connection-duration component.'}
def finalize_rules(rows):
    for x in rows:
        x.setdefault('days',None);x.setdefault('durationCap',None);x.setdefault('occupancyPerMinute',0);x.setdefault('occupancyThresholdMinutes',0);x.setdefault('occupancyStart',None);x.setdefault('occupancyEnd',None);x.setdefault('occupancyCap',None);x.setdefault('totalTransactionCap',None);x.setdefault('rounding',None)
    return rows

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--source',required=True);ap.add_argument('--canonical-dir',required=True);ap.add_argument('--static-csv',required=True);ap.add_argument('--out-dir',required=True);a=ap.parse_args()
    src=load_json(a.source);scope,families,access=validate_source(src);stations=load_json(Path(a.canonical_dir)/'stations.json.gz');pdcs=load_json(Path(a.canonical_dir)/'charge_points.json.gz');station_by={clean(s.get('stationId')):s for s in stations};meta=read_meta(a.static_csv);authority_aliases={norm(x) for x in scope['contractingAuthorityAliases']};tokens=[norm(x) for x in scope['requiredStationNameTokens']];candidate=[]
    for p in pdcs:
        sid=clean(p.get('stationId'));st=station_by.get(sid) or {};m=meta.get(sid) or {};physical=p.get('physicalOperatorId') or st.get('physicalOperatorId');name=norm(st.get('name'))
        if p.get('tariffNetworkId')!='alize-liberte' or physical!='bouygues-energies-services':continue
        if norm(m.get('authority')) not in authority_aliases or clean(st.get('codeInsee') or m.get('codeInsee'))!='28134':continue
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
        if 30.5<station_max[sid]<=160.0:family=families['dreux-express-150']
        elif dc and pw is not None and pw<=30.5:family=families['dreux-citadine-dc']
        elif not dc and pw is not None and pw<=30.5:family=families['dreux-citadine-ac']
        if family is None:
            unresolved.append({'canonicalStationId':sid,'canonicalPdcId':pid,'powerKw':p.get('powerKw'),'stationMaxPowerKw':station_max[sid],'connectors':con,'reason':'unproved_dreux_tariff_class'});continue
        family_counts[family['id']]+=1;base={'physicalOperatorId':'bouygues-energies-services','tariffNetworkId':'dreux','sourceStationId':None,'sourceEvseId':None,'canonicalStationId':sid,'canonicalPdcId':pid,'matchMethod':'exact_local_scope','matchDistanceMeters':None,'selectors':{'umbrellaTariffNetworkId':'alize-liberte','contractingAuthority':(meta.get(sid) or {}).get('authority'),'codeInsee':'28134','parkingExcluded':True,'roamingSeparate':True,'stationClass':family['stationClass']},'kind':family['kind'],'minPowerKw':None,'maxPowerKw':family.get('stationMaxPowerKw'),'validFrom':None,'validTo':None,'sourceUrl':src['sources']['officialAlizeNetworkPage'],'sourceUpdatedAt':src['verifiedAt'],'normalizedAt':now}
        public_rules=[energy_rule(family['publicPricePerKwh'])]
        subscriber_rules=[energy_rule(family['subscriberPricePerKwh'])]
        if family['id']=='dreux-citadine-ac':
            public_rules.append(duration_rule(0.08,120,notes='Rotation fee after two connection hours.'))
            subscriber_rules.append(duration_rule(0.08,120,start='08:00',end='21:00',notes='Rotation fee after two connection hours; official subscriber night exemption is 21:00-08:00 on AC.'))
        elif family['id']=='dreux-citadine-dc':
            public_rules.append(duration_rule(0.08,120,notes='Rotation fee after two connection hours.'))
            subscriber_rules.append(duration_rule(0.08,120,notes='Rotation fee after two connection hours.'))
        else:
            public_rules.append(duration_rule(0,0,notes='Official Express rotation component is 0.00 EUR/min.'))
            subscriber_rules.append(duration_rule(0,0,notes='Official Express rotation component is 0.00 EUR/min.'))
        offers.append({**base,'offerId':f"dreux:public:{family['id']}:{pid}",'provider':'Ville de Dreux','channel':'direct','sourceMode':'network_rule','selectors':{**base['selectors'],'paymentProfile':'public_card'},'pricingRules':finalize_rules(public_rules),'subscriptionId':None,'rankable':True,'blockedReasons':[]})
        offers.append({**base,'offerId':f"dreux:subscriber:{family['id']}:{pid}",'provider':'Ville de Dreux — abonné','channel':'subscription','sourceMode':'network_rule','selectors':{**base['selectors'],'paymentProfile':'dreux_subscription','monthlyFeeEur':10.0,'badgePurchaseEur':12.0},'pricingRules':finalize_rules(subscriber_rules),'subscriptionId':'dreux','rankable':True,'blockedReasons':[]})
    station_ids={clean(p.get('stationId')) for p in candidate};covered={o['canonicalPdcId'] for o in offers};report={'schemaVersion':'1.0.0','dataset':'france-dreux-canonical-audit','productionReady':False,'summary':{'eligibleStationCount':len(station_ids),'eligiblePdcCount':len(candidate),'coveredPdcCount':len(covered),'publicOfferCount':sum(1 for o in offers if o['subscriptionId'] is None),'subscriberOfferCount':sum(1 for o in offers if o['subscriptionId']=='dreux'),'unresolvedPdcCount':len(unresolved),'physicalInventoryMutationCount':0},'officialTopology':src['topology'],'familyPdcCounts':dict(sorted(family_counts.items())),'stations':sorted([{'stationId':s,'name':(station_by.get(s) or {}).get('name'),'stationMaxPowerKw':station_max[s]} for s in station_ids],key=lambda x:clean(x.get('name'))),'unresolved':unresolved[:100]}
    out=Path(a.out_dir);dump_json(out/'dreux_pdc_offers_contract_v1_1.json.gz',offers);dump_json(out/'dreux_materialization_report.json',report);print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
