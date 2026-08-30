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
        if isinstance(obj.get('idPdcItinerance'),str) and ('rankable' in obj or 'components' in obj or 'rules' in obj):yield obj
        for v in obj.values():
            if isinstance(v,(dict,list)):yield from walk_points(v)
    elif isinstance(obj,list):
        for v in obj:
            if isinstance(v,(dict,list)):yield from walk_points(v)

def norm_price(v):
    if v is None:return None
    try:return round(float(v),6)
    except:return None

def build_static_pricing(point):
    comp=point.get('components') or {}
    energy=norm_price(comp.get('energyEurPerKwh'));time_h=norm_price(comp.get('timeEurPerHour'));flat=norm_price(comp.get('flatFeeEur'));minimum=norm_price(comp.get('minPriceEur'))
    if not any(v is not None for v in (energy,time_h,flat,minimum)):return None
    base={'scope':'allDay'}
    if energy is not None:base['pricePerKwh']=energy
    if time_h is not None:base['connectedTimePerMinuteEur']=round(time_h/60.0,8)
    if flat is not None:base['sessionFeeEur']=flat
    if minimum is not None:base['minimumSessionEur']=minimum
    pricing={'type':'rules','rules':[base]}
    if point.get('parkingText'):pricing['parkingText']=point.get('parkingText')
    return pricing

def build_exact_temporal_pricing(point):
    rules=point.get('rules') or []
    if not isinstance(rules,list) or len(rules)!=3 or not all(isinstance(r,dict) for r in rules):return None,None
    by_kind={r.get('kind'):r for r in rules};kinds=set(by_kind)
    if kinds=={'minimum_total','energy','post_charge_occupancy'}:
        minimum_rule=by_kind['minimum_total'];energy_rule=by_kind['energy'];occupancy=by_kind['post_charge_occupancy']
        if set(minimum_rule)!={'kind','amountEur'} or set(energy_rule)!={'kind','eurPerKwh'} or set(occupancy)!={'kind','eurPerMinute','graceMinutes'}:return None,None
        minimum=norm_price(minimum_rule.get('amountEur'));energy=norm_price(energy_rule.get('eurPerKwh'));per_minute=norm_price(occupancy.get('eurPerMinute'));grace=norm_price(occupancy.get('graceMinutes'))
        if minimum is None or minimum<0 or energy is None or energy<0 or per_minute is None or per_minute<0 or grace is None or grace<0:return None,None
        pricing={'type':'rules','rules':[{'scope':'allDay','pricePerKwh':energy}],'postChargeFee':{'graceMinutes':grace,'eurPerMinute':per_minute},'minimumTotalEur':minimum}
        if point.get('parkingText'):pricing['parkingText']=point.get('parkingText')
        return pricing,'minimum_energy_post_charge_occupancy'
    if kinds=={'minimum_total','energy','flat_fee'}:
        minimum_rule=by_kind['minimum_total'];energy_rule=by_kind['energy'];flat_rule=by_kind['flat_fee']
        if set(minimum_rule)!={'kind','amountEur'} or set(energy_rule)!={'kind','eurPerKwh'} or set(flat_rule)!={'kind','amountEur','conditions'}:return None,None
        conditions=flat_rule.get('conditions')
        if not isinstance(conditions,list) or len(conditions) not in (1,2) or not all(isinstance(c,dict) and set(c)=={'kind','value'} for c in conditions):return None,None
        allowed={'energy_above_kwh','session_duration_after_minutes'}
        condition_kinds=[c.get('kind') for c in conditions]
        if any(k not in allowed for k in condition_kinds) or len(set(condition_kinds))!=len(condition_kinds) or 'energy_above_kwh' not in condition_kinds:return None,None
        normalized=[]
        for condition in conditions:
            threshold=norm_price(condition.get('value'))
            if threshold is None or threshold<0:return None,None
            normalized.append({'kind':condition.get('kind'),'value':threshold})
        minimum=norm_price(minimum_rule.get('amountEur'));energy=norm_price(energy_rule.get('eurPerKwh'));flat=norm_price(flat_rule.get('amountEur'))
        if any(v is None or v<0 for v in (minimum,energy,flat)):return None,None
        pricing={'type':'rules','rules':[{'scope':'allDay','pricePerKwh':energy}],'conditionalSessionFees':[{'amountEur':flat,'conditions':normalized}],'minimumTotalEur':minimum}
        if point.get('parkingText'):pricing['parkingText']=point.get('parkingText')
        family='minimum_energy_duration_conditional_flat_fee' if 'session_duration_after_minutes' in condition_kinds else 'minimum_energy_conditional_flat_fee'
        return pricing,family
    if kinds=={'minimum_total','energy','session_duration_surcharge'}:
        minimum_rule=by_kind['minimum_total'];energy_rule=by_kind['energy'];duration_rule=by_kind['session_duration_surcharge']
        if set(minimum_rule)!={'kind','amountEur'} or set(energy_rule)!={'kind','eurPerKwh'} or set(duration_rule)!={'kind','eurPerMinute','afterMinutes'}:return None,None
        minimum=norm_price(minimum_rule.get('amountEur'));energy=norm_price(energy_rule.get('eurPerKwh'));per_minute=norm_price(duration_rule.get('eurPerMinute'));after=norm_price(duration_rule.get('afterMinutes'))
        if any(v is None or v<0 for v in (minimum,energy,per_minute,after)):return None,None
        pricing={'type':'rules','rules':[{'scope':'allDay','pricePerKwh':energy,'connectedTimeFreeMinutes':after,'connectedTimePerMinuteAfterFreeEur':per_minute}],'minimumTotalEur':minimum}
        if point.get('parkingText'):pricing['parkingText']=point.get('parkingText')
        return pricing,'minimum_energy_session_duration_surcharge'
    return None,None

def make_offer(point,pid,cid,pricing,time_changing,semantic_family=None):
    return {'id':f'bump-direct-{pid.lower()}','selectionId':f'bump-direct-{pid.lower()}','provider':'Bump direct','countries':['FR'],'canonicalStationIds':[cid],'evseIds':[pid],'currency':'EUR','priority':125,'pricing':pricing,'source':'data-lab/data/national/bump_direct_tariffs_tcc_france.json.gz','directOperatorOnly':True,'verifiedScope':'exact_evse','defaultSelected':False,'metadata':{'tariffId':point.get('tariffId'),'tariffGroupId':point.get('tariffGroupId'),'tariffName':point.get('tariffName'),'appEvseId':point.get('appEvseId'),'timeChanging':time_changing,'semanticFamily':semantic_family,'sourceStatus':point.get('status'),'powerKw':point.get('powerKw'),'timeZone':'Europe/Paris'}}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--tariffs',required=True);ap.add_argument('--crosswalk',default='data/v9/france-provider-crosswalk.json');ap.add_argument('--output',default='data/v9/france-bump-offers.json');args=ap.parse_args()
    source=load(args.tariffs);cross=load(args.crosswalk);exact={}
    for entry in cross.get('entries',[]):
        cid=entry.get('canonicalId')
        for s in entry.get('sourceIds',[]) or []:
            if s.get('source')=='bump' and s.get('match')=='exact_irve_identifier':exact[str(s.get('id'))]=cid
    offers=[];deferred=[];seen=set();time_changing_seen=0;temporal_compiled=0;static_compiled=0;family_counts={}
    for point in walk_points(source):
        pid=str(point.get('idPdcItinerance') or '').strip()
        if not pid or pid in seen:continue
        seen.add(pid)
        if point.get('rankable') is not True:deferred.append({'idPdcItinerance':pid,'reason':'source_not_rankable'});continue
        cid=exact.get(pid)
        if not cid:deferred.append({'idPdcItinerance':pid,'reason':'no_exact_bump_crosswalk'});continue
        comp=point.get('components') or {}
        if comp.get('isTariffChangingInTime') is True:
            time_changing_seen+=1;pricing,family=build_exact_temporal_pricing(point)
            if pricing:
                offers.append(make_offer(point,pid,cid,pricing,True,family));temporal_compiled+=1;family_counts[family]=family_counts.get(family,0)+1;continue
            deferred.append({'idPdcItinerance':pid,'reason':'unsupported_time_changing_rule_family','sourceRules':point.get('rules') or []});continue
        pricing=build_static_pricing(point)
        if not pricing:deferred.append({'idPdcItinerance':pid,'reason':'no_rankable_price_components'});continue
        offers.append(make_offer(point,pid,cid,pricing,False,'static_components'));static_compiled+=1
    payload={'schemaVersion':5,'country':'FR','generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),'mode':'exact_pdc_direct_tariffs','policy':{'exactPdcRequired':True,'geographicFallbackAllowed':False,'tariffDataCannotCreatePhysicalStations':True,'sourceRankableRequired':True,'unsupportedTimeChangingTariffsFailClosed':True,'conditionalFeeConditionsSupported':['energy_above_kwh','session_duration_after_minutes'],'conditionalFeeConditionsUseAndSemantics':True,'sessionDurationSurchargeSupported':True,'minimumTotalAppliedAfterAllSessionComponents':True,'subscriptionsOptIn':True},'directOffers':offers,'subscriptionOffers':[],'deferred':deferred,'summary':{'exactBumpAliases':len(exact),'offers':len(offers),'staticOffers':static_compiled,'timeChangingSeen':time_changing_seen,'temporalOffers':temporal_compiled,'temporalOffersByFamily':family_counts,'conditionalEnergyOffers':family_counts.get('minimum_energy_conditional_flat_fee',0),'combinedEnergyDurationOffers':family_counts.get('minimum_energy_duration_conditional_flat_fee',0),'postChargeOccupancyOffers':family_counts.get('minimum_energy_post_charge_occupancy',0),'sessionDurationSurchargeOffers':family_counts.get('minimum_energy_session_duration_surcharge',0),'timeChangingDeferred':time_changing_seen-temporal_compiled,'deferred':len(deferred)}}
    out=Path(args.output);out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(payload['summary'],indent=2))
if __name__=='__main__':main()
