#!/usr/bin/env python3
import json,re,urllib.request,urllib.parse
BASE='https://service.eparkstation.de'
UA='Mozilla/5.0 TeslaChargeCompanion/9'
def get(url):
    req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'*/*'})
    with urllib.request.urlopen(req,timeout=30) as r:
        return r.geturl(),r.status,r.headers.get('content-type') or '',r.read().decode('utf-8','replace')
def inspect(url):
    try:
        af,ast,act,body=get(url)
        urls=sorted(set(re.findall(r'https?://[^"\'`\\\s)]+',body)))
        strings=sorted(set(re.findall(r'["\'`]([^"\'`]{1,240})["\'`]',body)))
        interesting=[s for s in strings if re.search(r'(?i)(api|station|location|tariff|price|parking|charge|evse|connector|axios|baseurl|graphql|fetch\()',s)]
        print(json.dumps({'asset':url,'status':ast,'bytes':len(body),'urls':urls[:200],'interesting':interesting[:700]},ensure_ascii=False))
        return body
    except Exception as e:
        print(json.dumps({'asset':url,'error':repr(e)},ensure_ascii=False));return ''
final,status,ct,html=get(BASE+'/')
print(json.dumps({'url':BASE+'/','status':status,'final':final,'contentType':ct,'bytes':len(html)},ensure_ascii=False))
main_assets=sorted(set(urllib.parse.urljoin(final,x) for x in re.findall(r'(?:src|href)=["\']([^"\']+\.js(?:\?[^"\']*)?)["\']',html,re.I)))
for asset in main_assets:
    body=inspect(asset)
    chunks=sorted(set(re.findall(r'[A-Za-z][A-Za-z0-9_-]+-[A-Za-z0-9_-]+\.js',body)))
    for name in chunks:
        if re.search(r'(?i)(Location|Station|Tarif|Charge|Map)',name): inspect(BASE+'/assets/'+name)
