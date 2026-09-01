#!/usr/bin/env python3
from __future__ import annotations
import argparse, datetime as dt, gzip, json, re, unicodedata
from pathlib import Path


def clean(v): return str(v or '').strip()
def norm(v):
    s=unicodedata.normalize('NFD',clean(v)); s=''.join(c for c in s if unicodedata.category(c)!='Mn')
    return re.sub(r'[^a-z0-9]+',' ',s.lower()).strip()
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
def truthy(v): return norm(v) in {'true','vrai','1','oui','yes'}

def validate_source(d):
    if d.get('dataset')!='sey-ma-borne-direct-tariffs-france' or d.get('networkId')!='seymaborne' or d.get('country')!='FR': raise ValueError('unexpected SEY source')
    s=d.get('scope') or {}
    required={'canonicalTariffNetworkId':'seymaborne','explicitPanBrandRequired':True,'requiresPanContractingAuthorityMatch':False,'directNetworkOnly':True,'physicalInventoryFromIrveOnly':True,'roamingMspTariffsRemainSeparate':True,'parkingExcludedFromChargingTariff':True,'genericAlizeLiberteNeverInheritsSeyTariff':True}
    for k,v in required.items():
        if s.get(k)!=v: raise ValueError(f'invalid SEY scope: {k}')
    a=d.get('access') or {}
    if a.get('monthlySubscriptionFeeEur')!=0.0 or a.get('badgeRequired') is not False or a.get('freeAlizeAppAccess') is not True: raise ValueError('invalid SEY access')
    fam={x.get('id'):x for x in d.get('tariffFamilies') or []}
    if set(fam)!={'sey-22-ac-standard','sey-dc-30plus-standard'}: raise ValueError('incomplete SEY tariff families')
    ac=fam['sey-22-ac-standard']; dc=fam['sey-dc-30plus-standard']
    if ac.get('kind')!='AC' or float(ac.get('maxPowerKw'))!=22.5 or ac.get('rankable') is not True: raise ValueError('invalid SEY AC family')
    if dc.get('kind')!='DC' or float(dc.get('minPowerKw'))!=30 or dc.get('rankable') is not True: raise ValueError('invalid SEY DC family')
    def energy(f): return next(r for r in f['pricingRules'] if r.get('scope')=='allDay')
    if float(energy(ac).get('pricePerKwh'))!=0.36 or float(energy(dc).get('pricePerKwh'))!=0.46: raise ValueError('invalid SEY energy prices')
    card=d.get('cardPaymentReference') or {}
    if card.get('rankable') is not False or float(card.get('durationRateEurPerHour'))!=4.0: raise ValueError('invalid SEY card reference')
    return s,fam,card

def normalized_rules(rows):
    out=[]
    for r in rows:
        x=dict(r); x.setdefault('days',None); x.setdefault('chargeThresholdMinutes',0); x.setdefault('durationThresholdMinutes',0); x.setdefault('durationStart',None); x.setdefault('durationEnd',None); x.setdefault('durationCap',None); x.setdefault('occupancyPerMinute',0); x.setdefault('occupancyThresholdMinutes',0); x.setdefault('occupancyStart',None); x.setdefault('occupancyEnd',None); x.setdefault('occupancyCap',None); x.setdefault('totalTransactionCap',None); x.setdefault('rounding',None)
        out.append(x)
    return out

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--source',required=True); ap.add_argument('--canonical-dir',required=True); ap.add_argument('--static-csv'); ap.add_argument('--out-dir',required=True); a=ap.parse_args()
    source=load_json(a.source); scope,families,card=validate_source(source)
    stations=load_json(Path(a.canonical_dir)/'stations.json.gz'); pdcs=load_json(Path(a.canonical_dir)/'charge_points.json.gz')
    station_by={clean(s.get('stationId')):s for s in stations}
    offers=[]; unresolved=[]; eligible=[]; now=dt.datetime.now(dt.timezone.utc).isoformat(); target=scope['canonicalTariffNetworkId']
    for p in pdcs:
        sid=clean(p.get('stationId')); st=station_by.get(sid) or {}
        if p.get('tariffNetworkId')!=target: continue
        eligible.append(p); pid=clean(p.get('pdcId')); power=p.get('powerKw'); con=p.get('connectors') or {}
        try: pw=float(power)
        except (TypeError,ValueError): pw=None
        dc=truthy(con.get('comboCcs')) or truthy(con.get('chademo'))
        family=None
        if not dc and pw is not None and pw<=22.5: family=families['sey-22-ac-standard']
        elif dc and pw is not None and pw>=30: family=families['sey-dc-30plus-standard']
        if family is None:
            unresolved.append({'canonicalStationId':sid,'canonicalPdcId':pid,'powerKw':power,'connectors':con,'physicalOperatorId':p.get('physicalOperatorId') or st.get('physicalOperatorId'),'reason':'unproved_sey_tariff_class'}); continue
        physical=p.get('physicalOperatorId') or st.get('physicalOperatorId'); kind=family['kind']
        standard={'offerId':f"seymaborne:{family['id']}:{pid}",'physicalOperatorId':physical,'tariffNetworkId':'seymaborne','provider':'SEY ma Borne via Alizé','channel':'direct','sourceMode':'network_rule','sourceStationId':None,'sourceEvseId':None,'canonicalStationId':sid,'canonicalPdcId':pid,'matchMethod':'network_scope','matchDistanceMeters':None,'selectors':{'explicitPanTariffNetworkId':'seymaborne','paymentProfile':'alize_app_or_sey_badge','badgeRequired':False,'parkingExcluded':True,'roamingSeparate':True},'kind':kind,'minPowerKw':family.get('minPowerKw'),'maxPowerKw':family.get('maxPowerKw'),'pricingRules':normalized_rules(family['pricingRules']),'subscriptionId':None,'validFrom':source.get('effectiveFrom'),'validTo':None,'rankable':True,'blockedReasons':[],'sourceUrl':(source.get('sources') or {}).get('officialCommitteeMinutes'),'sourceUpdatedAt':source.get('verifiedAt'),'normalizedAt':now}
        offers.append(standard)
        energy=0.36 if kind=='AC' else 0.46; threshold=int(card['acDurationThresholdMinutes'] if kind=='AC' else card['dcDurationThresholdMinutes'])
        offers.append({**standard,'offerId':f'seymaborne:card-reference:{pid}','provider':'SEY ma Borne — carte bancaire','channel':'reference','sourceMode':'reference_only','selectors':{**standard['selectors'],'paymentProfile':'bank_card','nightReduction':False},'pricingRules':normalized_rules([{'scope':'allDay','currency':'EUR','pricePerKwh':energy,'chargePerMinute':0,'durationPerMinute':4/60,'durationThresholdMinutes':threshold,'connectionFee':0,'parkingPerMinute':0,'notes':'Bank-card payment keeps the 4 EUR/hour duration rate without night reduction.'}]),'rankable':False,'blockedReasons':['payment_method_selector_not_yet_modeled']})
    covered={o['canonicalPdcId'] for o in offers if o['rankable']}; station_ids={clean(p.get('stationId')) for p in eligible}
    physical_counts={}
    for p in eligible:
        st=station_by.get(clean(p.get('stationId'))) or {}; key=str(p.get('physicalOperatorId') or st.get('physicalOperatorId') or 'unknown'); physical_counts[key]=physical_counts.get(key,0)+1
    report={'schemaVersion':'1.0.1','dataset':'france-sey-ma-borne-canonical-audit','productionReady':False,'summary':{'eligibleStationCount':len(station_ids),'eligiblePdcCount':len(eligible),'rankableCoveredPdcCount':len(covered),'rankableOfferCount':sum(1 for o in offers if o['rankable']),'referenceOfferCount':sum(1 for o in offers if not o['rankable']),'unresolvedPdcCount':len(unresolved),'physicalInventoryMutationCount':0},'physicalOperatorPdcCounts':physical_counts,'unresolved':unresolved[:500]}
    out=Path(a.out_dir); dump_json(out/'sey_ma_borne_pdc_offers_contract_v1_1.json.gz',offers); dump_json(out/'sey_ma_borne_materialization_report.json',report); print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__': main()
