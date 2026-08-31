#!/usr/bin/env python3
import json
from pathlib import Path
p=Path('data/v9/germany-direct-offers-stadtwerke-bochum-extension.json')
d=json.loads(p.read_text()); offers=d['directOffers']
by={o['id']:o for o in offers}
assert set(by)=={'stadtwerke-bochum-card-standard-ac','stadtwerke-bochum-card-standard-dc','stadtwerke-bochum-card-night-ac'}
def price(i): return by[i]['pricing']['rules'][0]['pricePerKwh']
assert price('stadtwerke-bochum-card-standard-ac')==0.5
assert price('stadtwerke-bochum-card-standard-dc')==0.5
assert price('stadtwerke-bochum-card-night-ac')==0.4
night=by['stadtwerke-bochum-card-night-ac']
assert night['applicability']['sessionMustStartBetween']=='20:00-24:00'
assert night['applicability']['blockingFeeWaivedFirstMinutes']==720
assert night['applicability']['city']=='Bochum'
assert all(o.get('directOperatorOnly') is True for o in offers)
assert all(o.get('selectionId')=='stadtwerke-bochum-card' for o in offers)
assert all(o.get('subscription',{}).get('monthlyFee')==0 for o in offers)
assert d.get('deferred',{}).get('blockingFeeStandard')
print(json.dumps({'operator':'Stadtwerke Bochum','offers':len(offers),'standardAc':0.5,'standardDc':0.5,'nightAc':0.4,'nightStartWindow':'20:00-24:00','blockingFeeWaivedFirstMinutes':720},indent=2,ensure_ascii=False))
