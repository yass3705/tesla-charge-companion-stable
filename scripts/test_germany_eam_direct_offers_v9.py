#!/usr/bin/env python3
import json
from pathlib import Path
p=Path('data/v9/germany-direct-offers-eam-extension.json')
d=json.loads(p.read_text());offers=d['directOffers']
assert d['country']=='DE' and d['preIntegrationOnly'] is True
assert len(offers)==2
by={o['connectorKinds'][0]:o for o in offers}
assert set(by)=={'AC','DC'}
assert by['AC']['pricing']['rules'][0]['pricePerKwh']==0.49
assert by['DC']['pricing']['rules'][0]['pricePerKwh']==0.59
assert all(o['selectionId']=='eam-de-ad-hoc' for o in offers)
assert all(o['directOperatorOnly'] is True for o in offers)
assert all('EAM Natur Energie' in o['operatorAliases'] for o in offers)
assert all(o['defaultSelected'] is False for o in offers)
print(json.dumps({'operator':'EAM Natur Energie','offers':2,'AC':0.49,'DC':0.59,'status':'ok'}))
