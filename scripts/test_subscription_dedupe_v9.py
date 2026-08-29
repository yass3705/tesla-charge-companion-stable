#!/usr/bin/env python3
import json,subprocess,tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as td:
    out=Path(td)/'report.json'
    subprocess.run([
      'python',str(ROOT/'scripts/dedupe_global_subscriptions_v9.py'),
      '--global-registry',str(ROOT/'data/v9/subscription-entitlements-global.json'),
      '--legacy',str(ROOT/'data/v9/france-emsp-offers.json'),
      '--legacy',str(ROOT/'data/netherlands_direct_tariffs_v1.json'),
      '--out',str(out)
    ],check=True)
    r=json.loads(out.read_text(encoding='utf-8'))
    assert r['pricingConflictCount']==0
    by_id={}
    for x in r['collisions']:by_id.setdefault(x['selectionId'],[]).append(x)
    for sid in ('atlante-go','fastned-gold','ionity-motion','ionity-power'):
        assert sid in by_id, sid
        assert all(x['resolution']=='superseded_by_global_registry' for x in by_id[sid])
        assert all(x['pricingConsistent'] for x in by_id[sid])
    unmanaged={x['selectionId'] for x in r['unmanagedLegacy']}
    assert {'pluginn-chargepass-basic','pluginn-chargepass-intense'} <= unmanaged
print('Global subscription dedupe V9 OK')
