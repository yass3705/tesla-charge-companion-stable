#!/usr/bin/env python3
import json,re,urllib.request,urllib.parse
BASE='https://service.eparkstation.de'
UA='Mozilla/5.0 TeslaChargeCompanion/9'
def get(url):
    req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'*/*'})
    with urllib.request.urlopen(req,timeout=30) as r:
        return r.geturl(),r.status,r.headers.get('content-type') or '',r.read().decode('utf-8','replace')
def ctx(body,term,n=1600):
    out=[]
    for m in re.finditer(re.escape(term),body,re.I):
        out.append(body[max(0,m.start()-n):min(len(body),m.end()+n)])
        if len(out)>=12:break
    return out
_,_,_,html=get(BASE+'/')
assets=sorted(set(urllib.parse.urljoin(BASE+'/',x) for x in re.findall(r'(?:src|href)=["\']([^"\']+\.js(?:\?[^"\']*)?)["\']',html,re.I)))
for asset in assets:
    _,s,_,body=get(asset)
    terms=['getLocationsComplete','getAllPricingSys','getLocationsControl','pricing_systems','pricing.e','/location','/locations','axios.create','Authorization','Bearer','service.eparkstation','portal.eparkstation']
    print(json.dumps({'asset':asset,'status':s,'hits':{t:ctx(body,t) for t in terms if t.lower() in body.lower()}},ensure_ascii=False))
    for name in sorted(set(re.findall(r'[A-Za-z][A-Za-z0-9_-]+-[A-Za-z0-9_-]+\.js',body))):
        if re.search(r'(?i)(Map|Location|Station|Tarif)',name):
            url=BASE+'/assets/'+name
            try:
                _,ss,_,b=get(url)
                imports=b[:2500]
                print(json.dumps({'asset':url,'status':ss,'imports':imports,'hits':{t:ctx(b,t,1000) for t in terms if t.lower() in b.lower()}},ensure_ascii=False))
            except Exception as e: print(json.dumps({'asset':url,'error':repr(e)},ensure_ascii=False))
