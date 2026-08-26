#!/usr/bin/env python3
# Temporary diagnostics for the 2026-08-26 first-party DRIVECO screenshots.
import json, urllib.request, unicodedata
SOURCE='https://raw.githubusercontent.com/yass3705/tesla-charge-companion-data-lab/main/data/operator_direct/driveco_evse_tariffs.json'
UA='TeslaChargeCompanion/8 DRIVECO sample diagnostics'

def norm(v):
    s=unicodedata.normalize('NFD',str(v or ''))
    s=''.join(ch for ch in s if unicodedata.category(ch)!='Mn').lower()
    return ' '.join(''.join(ch if ch.isalnum() else ' ' for ch in s).split())

req=urllib.request.Request(SOURCE,headers={'User-Agent':UA,'Accept':'application/json'})
with urllib.request.urlopen(req,timeout=60) as r:
    src=json.loads(r.read().decode('utf-8'))

needles=('velizy villacoublay','villacoublay','vernouillet')
for row in src.get('resolved',[]):
    hay=' | '.join(norm(row.get(k)) for k in ('stationName','address','city'))
    if any(n in hay for n in needles):
        print(json.dumps({
            'evseId':row.get('evseId'),'stationId':row.get('stationId'),'stationName':row.get('stationName'),
            'address':row.get('address'),'city':row.get('city'),'powerKw':row.get('powerKw'),
            'networkClass':row.get('networkClass'),'tariff':row.get('tariff')
        },ensure_ascii=False,sort_keys=True))
