#!/usr/bin/env python3
import json,re,sys,urllib.request

IDS=sys.argv[1:] or ['7062634','0122364','0365296']
UA='Mozilla/5.0 TeslaChargeCompanion/9'
for station_id in IDS:
    url=f'https://chargestation.road.io/{station_id}'
    req=urllib.request.Request(url,headers={'User-Agent':UA})
    try:
        with urllib.request.urlopen(req,timeout=20) as r:
            body=r.read().decode('utf-8','replace')
            final=r.geturl()
            prices=sorted(set(re.findall(r'(?i)(?:€|EUR)\s*([0-9]+[\.,][0-9]{1,4})|([0-9]+[\.,][0-9]{1,4})\s*(?:€|EUR)',body)))
            flat=sorted({(a or b).replace(',','.') for a,b in prices})
            evses=sorted(set(re.findall(r'(?:DE\*EFL\*EV\d{7}(?:\*C\d+)?)|(?:DEEFLEV\d{7})',body,re.I)))
            print(json.dumps({'stationId':station_id,'url':url,'finalUrl':final,'status':r.status,'bytes':len(body),'prices':flat,'evses':evses,'containsPluq':'pluq' in body.lower(),'sample':re.sub(r'\s+',' ',body)[:500]},ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'stationId':station_id,'url':url,'error':repr(e)},ensure_ascii=False))
