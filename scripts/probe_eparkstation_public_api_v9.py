#!/usr/bin/env python3
import json,re,urllib.request,urllib.parse
BASE='https://service.eparkstation.de'
UA='Mozilla/5.0 TeslaChargeCompanion/9'
def get(url):
    req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'*/*'})
    with urllib.request.urlopen(req,timeout=30) as r:
        return r.geturl(),r.status,r.headers.get('content-type') or '',r.read().decode('utf-8','replace')
def contexts(body,terms):
    out=[]
    for term in terms:
        for m in re.finditer(re.escape(term),body,re.I):
            out.append({'term':term,'ctx':body[max(0,m.start()-450):min(len(body),m.end()+700)]})
            if len([x for x in out if x['term']==term])>=8: break
    return out
final,status,ct,html=get(BASE+'/')
print(json.dumps({'url':BASE+'/','status':status,'final':final,'contentType':ct,'bytes':len(html)},ensure_ascii=False))
main_assets=sorted(set(urllib.parse.urljoin(final,x) for x in re.findall(r'(?:src|href)=["\']([^"\']+\.js(?:\?[^"\']*)?)["\']',html,re.I)))
for asset in main_assets:
    af,ast,act,body=get(asset)
    print(json.dumps({'asset':asset,'status':ast,'bytes':len(body),'contexts':contexts(body,['getLocations','getLocation','axios','baseURL','fetch(','/api/','updateLocation','addLocationRights'])},ensure_ascii=False))
    chunks=sorted(set(re.findall(r'[A-Za-z][A-Za-z0-9_-]+-[A-Za-z0-9_-]+\.js',body)))
    for name in chunks:
        if re.search(r'(?i)(Location|Station|Tarif|Charge|Map)',name):
            url=BASE+'/assets/'+name
            try:
                _,s,_,b=get(url)
                print(json.dumps({'asset':url,'status':s,'bytes':len(b),'contexts':contexts(b,['getLocations','getLocation','pricingSystems','basetarif','station_code','tarif','price','parking'])},ensure_ascii=False))
            except Exception as e: print(json.dumps({'asset':url,'error':repr(e)},ensure_ascii=False))
