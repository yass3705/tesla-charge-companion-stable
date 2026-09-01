#!/usr/bin/env python3
import json,sys,re
from pathlib import Path
p=Path(sys.argv[1] if len(sys.argv)>1 else 'build/germany-station-pricing.json');d=json.loads(p.read_text())
assert d.get('country')=='DE';assert d.get('scope')=='evse';rows=d.get('entries',[]);assert rows and len(rows)==d.get('entryCount')
ids=[x['evseId'] for x in rows];assert len(ids)==len(set(ids));assert all(re.match(r'^DE\*[A-Z0-9]{3}\*E',x) for x in ids)
assert all(x.get('currency')=='EUR' and 0<x.get('pricePerKwh',0)<5 for x in rows)
assert any(x['operator']=='SWP Stadtwerke Pforzheim' and x['pricePerKwh']==0.39 for x in rows)
assert any(x['operator']=='SWP Stadtwerke Pforzheim' and x['connectorKind']=='DC' and x['pricePerKwh']==0.60 for x in rows)
assert any(x['operator']=='Stadtwerke Iserlohn' and x['pricePerKwh']==0.59 for x in rows)
assert 'overrides operator-wide' in d.get('precedence','')
print(json.dumps({'ok':True,'entryCount':len(rows)}))
