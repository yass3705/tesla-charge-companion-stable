#!/usr/bin/env python3
import json,re,urllib.request,urllib.parse
BASE='https://service.eparkstation.de'
UA='Mozilla/5.0 TeslaChargeCompanion/9'
def get(url):
    req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'*/*'})
    with urllib.request.urlopen(req,timeout=30) as r:
        return r.geturl(),r.status,r.headers.get('content-type') or '',r.read().decode('utf-8','replace')
final,status,ct,html=get(BASE+'/')
print(json.dumps({'url':BASE+'/','status':status,'final':final,'contentType':ct,'bytes':len(html)},ensure_ascii=False))
assets=sorted(set(urllib.parse.urljoin(final,x) for x in re.findall(r'(?:src|href)=["\']([^"\']+\.js(?:\?[^"\']*)?)["\']',html,re.I)))
for asset in assets:
    try:
        af,ast,act,body=get(asset)
        urls=sorted(set(re.findall(r'https?://[^"\'`\\\s)]+',body)))
        paths=sorted(set(re.findall(r'["\'`]((?:/api|/v[0-9]+|/public|/station|/stations|/charge|/charging|/tariff|/tariffs|/location|/locations|/map)[^"\'`]{0,180})["\'`]',body,re.I)))
        tokens=sorted(set(re.findall(r'(?i)\b(?:station|chargepoint|chargingpoint|tariff|price|parking|connector|evse|location)[A-Za-z0-9_./?=&:-]{0,120}',body)))
        print(json.dumps({'asset':asset,'status':ast,'bytes':len(body),'urls':urls[:100],'paths':paths[:200],'tokens':tokens[:250]},ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'asset':asset,'error':repr(e)},ensure_ascii=False))
