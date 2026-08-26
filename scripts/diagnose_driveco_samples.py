#!/usr/bin/env python3
# Temporary diagnostics for the 2026-08-26 first-party DRIVECO screenshots.
import json, urllib.request, unicodedata
from collections import Counter
SOURCE='https://raw.githubusercontent.com/yass3705/tesla-charge-companion-data-lab/main/data/operator_direct/driveco_evse_tariffs.json'
UA='TeslaChargeCompanion/8 DRIVECO sample diagnostics'

def norm(v):
    s=unicodedata.normalize('NFD',str(v or ''))
    s=''.join(ch for ch in s if unicodedata.category(ch)!='Mn').lower()
    return ' '.join(''.join(ch if ch.isalnum() else ' ' for ch in s).split())

def simple_sig(osf):
    if not isinstance(osf,list) or len(osf)!=1 or not isinstance(osf[0],dict): return None
    e=osf[0]
    if e.get('duration')==0 and e.get('interval')==1 and e.get('gracePeriodBeforeOSF')==900:
        return float(e.get('price')) if isinstance(e.get('price'),(int,float)) else None
    return None

def sig(osf):
    return json.dumps(osf,sort_keys=True,separators=(',',':'))

req=urllib.request.Request(SOURCE,headers={'User-Agent':UA,'Accept':'application/json'})
with urllib.request.urlopen(req,timeout=60) as r:
    src=json.loads(r.read().decode('utf-8'))

print('SOURCE_KEYS', sorted(src.keys()))
counts=Counter(); multi=Counter()
for row in src.get('resolved',[]):
    osf=(row.get('tariff') or {}).get('matrixOSF')
    rate=simple_sig(osf)
    if rate is not None: counts[rate]+=1
    if isinstance(osf,list) and len(osf)>1: multi[sig(osf)]+=1
print('SIMPLE_OSF_15MIN_COUNTS', json.dumps(dict(sorted(counts.items())),sort_keys=True))
print('MULTI_OSF_SIGNATURES', len(multi))
for signature,count in multi.most_common(20): print('MULTI_OSF_COUNT',count,signature)

needles=('velizy villacoublay','villacoublay','vernouillet','saint remy les chevreuse')
for bucket_name,bucket in src.items():
    if not isinstance(bucket,list): continue
    for row in bucket:
        if not isinstance(row,dict): continue
        hay=' | '.join(norm(row.get(k)) for k in ('stationName','address','city'))
        if any(n in hay for n in needles):
            print('MATCH',bucket_name,json.dumps({
                'evseId':row.get('evseId'),'stationId':row.get('stationId'),'stationName':row.get('stationName'),
                'address':row.get('address'),'city':row.get('city'),'powerKw':row.get('powerKw'),
                'networkClass':row.get('networkClass'),'tariff':row.get('tariff')
            },ensure_ascii=False,sort_keys=True))
