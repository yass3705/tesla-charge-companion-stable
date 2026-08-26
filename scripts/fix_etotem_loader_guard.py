#!/usr/bin/env python3
from pathlib import Path
import sys

path = Path(sys.argv[1] if len(sys.argv) > 1 else 'assets/france-catalog-v8.js')
text = path.read_text(encoding='utf-8')
old = "      if(Number(data?.counts?.resolvedStations)<500||Number(data?.counts?.resolvedWithTariffText)<450)throw new Error('Couverture tarifaire e-Totem insuffisante');"
new = "      const etCov=data?.coverageByFamily||{},etEti=etCov.FRETI||{},etEse=etCov.FRESE||{};\n      if(Number(data?.counts?.resolvedStations)<465||Number(data?.counts?.resolvedWithTariffText)<465||Number(data?.counts?.coordinateFallbackMatches)>10||Number(etEti.resolved)/Math.max(1,Number(etEti.inventory))<.99||Number(etEse.resolved)/Math.max(1,Number(etEse.inventory))<.98)throw new Error('Couverture tarifaire e-Totem publique insuffisante');"
if old in text:
    path.write_text(text.replace(old, new, 1), encoding='utf-8')
    print('e-Totem loader guard updated')
elif new in text:
    print('e-Totem loader guard already current')
else:
    raise SystemExit('e-Totem loader guard anchor not found')
