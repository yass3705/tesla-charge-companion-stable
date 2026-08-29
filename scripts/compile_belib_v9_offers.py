#!/usr/bin/env python3
import argparse,json
from datetime import datetime,timezone
from pathlib import Path

CLASSES={
  'moto':{'powerKw':3.7},
  'flex':{'powerKw':7},
  'boost':{'powerKw':22},
  'boostPlus':{'powerKw':50},
}

def pricing_rule(values,start='00:00',end='24:00'):
    rule={'scope':'allDay' if start=='00:00' and end=='24:00' else 'timeWindow','start':start,'end':end,'currency':'EUR'}
    if values.get('eurPerKwh') is not None: rule['pricePerKwh']=values['eurPerKwh']
    if values.get('eurPer15MinConnected') is not None:
        rule['connectedTimeBlockMinutes']=15
        rule['connectedTimeBlockEur']=values['eurPer15MinConnected']
        rule['connectedTimeBlockRounding']='started_block'
    if values.get('eurPerMinuteConnected') is not None:
        rule['connectedTimePerMinuteEur']=values['eurPerMinuteConnected']
    if values.get('connectedTimeComponentEur') is not None:
        rule['connectedTimeComponentEur']=values['connectedTimeComponentEur']
    return rule

def offer(offer_id,provider,klass,rules,source,subscription=False,annual_fee=None,profile=None):
    power=CLASSES[klass]['powerKw']
    row={
      'id':offer_id,'selectionId':offer_id,'provider':provider,'networkAliases':["Belib'",'Belib','BELIB'],
      'countries':['FR'],'minPowerKw':power,'maxPowerKw':power,'currency':'EUR','priority':115 if not subscription else 120,
      'pricing':{'type':'rules','rules':rules},'source':source,'directOperatorOnly':False,
      'verifiedScope':'network_brand_exact_power','defaultSelected':False,
      'customerProfile':profile,
      'metadata':{'network':'Belib','chargerClass':klass,'publishedPowerKw':power,'connectionBillingExact':True}
    }
    if subscription:
        row['monthlyFeeLabel']='7 €/an'
        row['annualFeeEur']=annual_fee
    return {k:v for k,v in row.items() if v is not None}

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--input',required=True)
    ap.add_argument('--output',default='data/v9/france-belib-offers.json')
    args=ap.parse_args()
    src=json.loads(Path(args.input).read_text(encoding='utf-8'))
    source='data-lab/belib_official_paris.json'
    direct=[];subs=[]
    for klass in CLASSES:
        direct.append(offer(f'belib-visitor-{klass}','Belib direct',klass,[pricing_rule(src['visitor'][klass])],source))
        subs.append(offer(f'belib-nonresident-{klass}',"Belib' abonné non-résident",klass,[pricing_rule(src['subscriptions']['nonResident'][klass])],source,True,src['subscriptions']['annualFeeEur'],'nonResident'))
        resident=src['subscriptions']['residentParis']
        rules=[
          pricing_rule(resident['day'][klass],'08:00','20:00'),
          pricing_rule(resident['night2000To2300'][klass],'20:00','23:00'),
          pricing_rule(resident['night2300To0800'][klass],'23:00','08:00')
        ]
        subs.append(offer(f'belib-resident-{klass}',"Belib' abonné résident Paris",klass,rules,source,True,src['subscriptions']['annualFeeEur'],'residentParis'))
    long_fee=src.get('fees',{}).get('longConnection',{})
    for row in direct+subs:
        row['pricing']['longConnectionFee']={
          'thresholdMinutes':int(float(long_fee.get('thresholdHours',14))*60),
          'eurPerHourAfterThreshold':long_fee.get('eurPerHourAfterThreshold',10),
          'basis':'connection_time'
        }
    now=datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
    payload={
      'schemaVersion':1,'country':'FR','generatedAt':now,'mode':'official_exact','policy':{
        'subscriptionsOptIn':True,'parkingExcluded':True,'reservationExcludedFromChargeCost':True,
        'networkBrandOnly':True,'physicalOperatorMayDiffer':True,'connectedTimeBlocksPreservedExactly':True
      },
      'directOffers':direct,'subscriptionOffers':subs,
      'sourceEvidence':{'effectiveFrom':src.get('sourceEvidence',{}).get('tariffEffectiveFrom'),'fingerprint':src.get('sourceEvidence',{}).get('relevantTariffFingerprintSha256')}
    }
    out=Path(args.output);out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'output':str(out),'directOfferCount':len(direct),'subscriptionOfferCount':len(subs),'classes':list(CLASSES)},ensure_ascii=False))

if __name__=='__main__':main()
