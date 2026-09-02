#!/usr/bin/env python3
import json,re,urllib.request
BASE='https://service.eparkstation.de'
UA='Mozilla/5.0 TeslaChargeCompanion/9'
def get(url):
    req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'application/json,text/plain,*/*'})
    with urllib.request.urlopen(req,timeout=30) as r:
        return r.geturl(),r.status,r.headers.get('content-type') or '',r.read().decode('utf-8','replace')
def contexts(body,terms,n=2000):
    out={}
    for term in terms:
        vals=[]
        for m in re.finditer(re.escape(term),body,re.I):
            vals.append(body[max(0,m.start()-n):min(len(body),m.end()+n)])
            if len(vals)>=10:break
        if vals:out[term]=vals
    return out
url=BASE+'/assets/basicCom-BDTCgPWh.js'
final,status,ct,body=get(url)
terms=['getLocationsComplete','getLocationsControl','getAllPricingSys','getLocationDetails','fetch(','axios','baseURL','Authorization','Bearer','pricing','locations','location','api','http']
print(json.dumps({'asset':url,'status':status,'contentType':ct,'bytes':len(body),'contexts':contexts(body,terms)},ensure_ascii=False))
# Extract obvious endpoint strings and absolute URLs.
strings=sorted(set(re.findall(r'["\'`]([^"\'`]{1,300})["\'`]',body)))
interesting=[s for s in strings if re.search(r'(?i)(https?://|/api|location|pricing|station|controller|tarif)',s)]
print(json.dumps({'interestingStrings':interesting[:1000]},ensure_ascii=False))
