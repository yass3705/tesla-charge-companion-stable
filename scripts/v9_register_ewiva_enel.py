#!/usr/bin/env python3
from __future__ import annotations
import json
from pathlib import Path

p=Path('data/v9/source-registry.json')
d=json.loads(p.read_text(encoding='utf-8'))
found=False
for row in d.get('subscriptionCoverage') or []:
    if row.get('subscriptionId')=='enel_plug_and_go_super':
        ops=list(row.get('operatorIds') or [])
        if 'ewiva' not in ops: ops.append('ewiva')
        row['operatorIds']=ops
        sources=list(row.get('evidenceSources') or [])
        if 'italy-verified-offers' not in sources: sources.append('italy-verified-offers')
        row['evidenceSources']=sources
        found=True
if not found:
    raise SystemExit('enel_plug_and_go_super subscription coverage missing')
p.write_text(json.dumps(d,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
print('registered Ewiva for enel_plug_and_go_super')
