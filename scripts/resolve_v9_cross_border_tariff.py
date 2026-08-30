#!/usr/bin/env python3
import argparse,json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
POLICY=ROOT/'data/v9/germany-cross-border-subscriptions.json'
FASTNED=ROOT/'data/v9/fastned-gold-country-prices.json'
IONITY=ROOT/'data/v9/ionity-monthly-country-prices.json'

def load(p): return json.loads(Path(p).read_text())

def result(subscription_id,country,status,rankable=False,price=None,currency=None,semantics=None,matrix=None,reason=None):
 out={'subscriptionId':subscription_id,'country':country,'status':status,'rankable':rankable,'usedFallback':False}
 if price is not None: out['pricePerKwh']=price
 if currency is not None: out['currency']=currency
 if semantics is not None: out['priceSemantics']=semantics
 if matrix is not None: out['matrix']=matrix
 if reason is not None: out['reason']=reason
 return out

def resolve(subscription_id,country,exact_station_price=None,exact_station_currency=None):
 country=country.upper()
 policy=load(POLICY)
 subs={s['id']:s for s in policy['subscriptions']}
 if exact_station_price is not None:
  if exact_station_currency is None: raise ValueError('exact station currency required with exact station price')
  if subscription_id not in subs: return result(subscription_id,country,'unavailable',reason='subscription not active in cross-border policy')
  return result(subscription_id,country,'exact',True,float(exact_station_price),exact_station_currency.upper(),'station-specific','exact-station-override')
 if subscription_id=='fastned-gold':
  d=load(FASTNED);p=d['prices'].get(country)
  if not p: return result(subscription_id,country,'unavailable',reason='country absent from Fastned Gold matrix')
  return result(subscription_id,country,'exact',True,p['pricePerKwh'],p['currency'],'exact-country','fastned-gold-country-prices')
 if subscription_id in {'ionity-motion','ionity-power'}:
  d=load(IONITY);p=d['subscriptions'][subscription_id].get(country)
  if not p: return result(subscription_id,country,'unavailable',reason='country absent from IONITY matrix')
  return result(subscription_id,country,'minimum',False,p['pricePerKwh'],p['currency'],'country-minimum','ionity-monthly-country-prices',reason='IONITY publishes a country minimum; station price may be higher')
 s=subs.get(subscription_id)
 if s and s.get('pricingMode')=='station-specific-roaming':
  if country not in s.get('coverageCountries',[]): return result(subscription_id,country,'unavailable',reason='country outside subscription coverage')
  return result(subscription_id,country,'station-specific-required',False,semantics='station-specific',reason='exact charging-point roaming price required before ranking')
 deferred={x['id'] for x in policy.get('deferred',[])}
 if subscription_id in deferred: return result(subscription_id,country,'unavailable',reason='subscription cross-border pricing is deferred')
 return result(subscription_id,country,'unavailable',reason='subscription not active in cross-border policy')

def main():
 a=argparse.ArgumentParser();a.add_argument('subscription_id');a.add_argument('country');a.add_argument('--station-price',type=float);a.add_argument('--station-currency');x=a.parse_args()
 print(json.dumps(resolve(x.subscription_id,x.country,x.station_price,x.station_currency),ensure_ascii=False))
if __name__=='__main__': main()
