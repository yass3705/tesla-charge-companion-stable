#!/usr/bin/env python3
from finalize_france_powerdot_offers import pricing_rule
r=pricing_rule({'currency':'EUR','pricingComponents':{'pricePerKwh':.58,'chargePerMinute':0,'connectionFee':0,'durationPerMinute':.05,'durationThresholdMinutes':60,'durationCap':0,'occupancyPerMinute':0,'occupancyGraceMinutes':0,'occupancyCap':0,'parkingPerMinute':0}})
assert r['scope']=='allDay' and r['currency']=='EUR'
assert r['pricePerKwh']==.58
assert r['durationPerMinute']==.05 and r['durationThresholdMinutes']==60
assert r['chargePerMinute']==0 and r['parkingPerMinute']==0
print('Powerdot canonical contract mapping: OK')
