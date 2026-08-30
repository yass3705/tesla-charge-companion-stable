#!/usr/bin/env python3
import argparse,gzip,json
from datetime import datetime,timezone
from pathlib import Path

def load(path):
    p=Path(path)
    if p.suffix=='.gz':
        with gzip.open(p,'rt',encoding='utf-8') as f:return json.load(f)
    return json.loads(p.read_text(encoding='utf-8'))

def walk_points(obj):
    if isinstance(obj,dict):
        if isinstance(obj.get('idPdcItinerance'),str) and ('rankable' in obj or 'components' in obj or 'rules' in obj):
            yield obj
        for v in obj.values():
            if isinstance(v,(dict,list)): yield from walk_points(v)
    elif isinstance(obj,list):
        for v in obj:
            if isinstance(v,(dict,list)): yield from walk_points(v)

def norm_price(v):
    if v is None:return None
    try:return round(float(v),6)
    except:return None

def build_pricing(point):
    comp=point.get('components') or {}
    rules=point.get('rules') or []
    energy=norm_price(comp.get('energyEurPerKwh'))
    time_h=norm_price(comp.get('timeEurPerHour'))
    flat=norm_price(comp.get('flatFeeEur'))
    minimum=norm_price(comp.get('minPriceEur'))
    if not any(v is not None for v in (energy,time_h,flat,minimum)) and not rules:
        return None
    pricing={'type':'rules','rules':[]}
    base={}
    if energy is not None: base['pricePerKwh']=energy
    if time_h is not None: base['connectedTimePerMinuteEur']=round(time_h/60.0,8)
    if flat is not None: base['sessionFeeEur']=flat
    if minimum is not None: base['minimumSessionEur']=minimum
    if base: pricing['rules'].append(base)
    if rules: pricing['sourceRules']=rules
    parking=point.get('parkingText')
    if parking: pricing['parkingText']=parking
    return pricing

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--tariffs',required=True)
    ap.add_argument('--crosswalk',default='data/v9/france-provider-crosswalk.json')
    ap.add_argument('--output',default='data/v9/france-bump-offers.json')
    args=ap.parse_args()
    source=load(args.tariffs)
    cross=load(args.crosswalk)
    exact={}
    for entry in cross.get('entries',[]):
        cid=entry.get('canonicalId')
        for s in entry.get('sourceIds',[]) or []:
            if s.get('source')=='bump' and s.get('match')=='exact_irve_identifier':
                exact[str(s.get('id'))]=cid
    offers=[];deferred=[];seen=set()
    for point in walk_points(source):
        pid=str(point.get('idPdcItinerance') or '').strip()
        if not pid or pid in seen:continue
        seen.add(pid)
        if point.get('rankable') is not True:
            deferred.append({'idPdcItinerance':pid,'reason':'source_not_rankable'});continue
        cid=exact.get(pid)
        if not cid:
            deferred.append({'idPdcItinerance':pid,'reason':'no_exact_bump_crosswalk'});continue
        pricing=build_pricing(point)
        if not pricing:
            deferred.append({'idPdcItinerance':pid,'reason':'no_rankable_price_components'});continue
        power=point.get('powerKw')
        offer={
          'id':f'bump-direct-{pid.lower()}',
          'selectionId':f'bump-direct-{pid.lower()}',
          'provider':'Bump direct',
          'countries':['FR'],
          'canonicalStationIds':[cid],
          'evseIds':[pid],
          'currency':'EUR','priority':125,
          'pricing':pricing,
          'source':'data-lab/data/national/bump_direct_tariffs_tcc_france.json.gz',
          'directOperatorOnly':True,'verifiedScope':'exact_irve_pdc',
          'defaultSelected':False,
          'metadata':{
            'tariffId':point.get('tariffId'),'tariffGroupId':point.get('tariffGroupId'),
            'tariffName':point.get('tariffName'),'appEvseId':point.get('appEvseId'),
            'timeChanging':bool((point.get('components') or {}).get('isTariffChangingInTime')),
            'sourceStatus':point.get('status'),'powerKw':power
          }
        }
        if power is not None:
            try:
                offer['minPowerKw']=float(power);offer['maxPowerKw']=float(power)
            except:pass
        offers.append(offer)
    payload={
      'schemaVersion':1,'country':'FR','generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),
      'mode':'exact_pdc_direct_tariffs','policy':{
        'exactPdcRequired':True,'geographicFallbackAllowed':False,'tariffDataCannotCreatePhysicalStations':True,
        'sourceRankableRequired':True,'complexSourceRulesPreserved':True,'subscriptionsOptIn':True
      },
      'directOffers':offers,'subscriptionOffers':[],'deferred':deferred,
      'summary':{'exactBumpAliases':len(exact),'offers':len(offers),'deferred':len(deferred)}
    }
    out=Path(args.output);out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(payload['summary'],indent=2))
if __name__=='__main__':main()
