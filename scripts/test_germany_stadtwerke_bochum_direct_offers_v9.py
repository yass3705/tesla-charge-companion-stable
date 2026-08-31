#!/usr/bin/env python3
import json
from pathlib import Path
p=Path('data/v9/germany-direct-offers-stadtwerke-bochum-extension.json')
d=json.loads(p.read_text()); offers=d['directOffers']
by={o['id']:o for o in offers}
assert set(by)=={'stadtwerke-bochum-card-ac','stadtwerke-bochum-card-dc'}
ac=by['stadtwerke-bochum-card-ac']; dc=by['stadtwerke-bochum-card-dc']
rules=ac['pricing']['rules']
assert [(r['start'],r['end'],r['pricePerKwh']) for r in rules]==[('00:00','20:00',0.5),('20:00','24:00',0.4)]
assert dc['pricing']['rules'][0]['pricePerKwh']==0.5
assert ac['applicability']['nightTariffSessionMustStartBetween']=='20:00-24:00'
assert ac['applicability']['nightBlockingFeeWaivedFirstMinutes']==720
assert ac['applicability']['city']=='Bochum'
assert all(o.get('directOperatorOnly') is True for o in offers)
assert all(o.get('selectionId')=='stadtwerke-bochum-card' for o in offers)
assert all(o.get('subscription',{}).get('monthlyFee')==0 for o in offers)
assert d.get('deferred',{}).get('blockingFeeStandard')
print(json.dumps({'operator':'Stadtwerke Bochum','offers':len(offers),'standardAc':0.5,'standardDc':0.5,'nightAc':0.4,'nightStartWindow':'20:00-24:00','blockingFeeWaivedFirstMinutes':720},indent=2,ensure_ascii=False))
