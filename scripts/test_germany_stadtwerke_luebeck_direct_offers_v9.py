#!/usr/bin/env python3
import json
from pathlib import Path
p=Path('data/v9/germany-direct-offers-stadtwerke-luebeck-extension.json')
d=json.loads(p.read_text()); offers=d['directOffers']
assert d['country']=='DE' and d['preIntegrationOnly'] is True
assert len(offers)==2
by_kind={o['connectorKinds'][0]:o for o in offers}
assert by_kind['AC']['pricing']['rules'][0]['pricePerKwh']==0.55
assert by_kind['DC']['pricing']['rules'][0]['pricePerKwh']==0.65
assert by_kind['AC']['blockingFee']['afterMinutes']==241
assert by_kind['DC']['blockingFee']['afterMinutes']==181
for k in ('AC','DC'):
 o=by_kind[k]
 assert o['blockingFee']['pricePerMinute']==0.1
 assert o['blockingFee']['activeWindow']=={'start':'08:00','end':'20:00'}
 assert o['blockingFee']['waivedOutsideActiveWindow'] is True
 assert o['directOperatorOnly'] is True
 assert 'Stadtwerke Lübeck Energie' in o['operatorAliases']
 assert o['source'].startswith('https://www.swhl.de/')
assert d['policy']['subscriptionAvailable'] is False
assert d['policy']['existingCustomerDiscount'] is False
assert d['policy']['semiPublicMayDiffer'] is True
assert d['policy']['roamingSeparatedFromDirectCpo'] is True
print(json.dumps({'operator':'Stadtwerke Lübeck Energie','offers':2,'AC':0.55,'DC':0.65,'blockingFeePerMinute':0.1,'ACAfterMinutes':241,'DCAfterMinutes':181,'activeWindow':'08:00-20:00','status':'ok'},ensure_ascii=False))
