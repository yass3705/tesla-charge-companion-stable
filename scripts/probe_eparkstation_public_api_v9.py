#!/usr/bin/env python3
import json,re,urllib.request,urllib.error,urllib.parse
UA='Mozilla/5.0 TeslaChargeCompanion/9'
API='https://api.eparkstation.de'
SPA='https://service.eparkstation.de'

def request(url,method='GET',data=None):
    raw=None if data is None else json.dumps(data).encode()
    req=urllib.request.Request(url,data=raw,method=method,headers={'User-Agent':UA,'Accept':'application/json,text/plain,*/*','Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req,timeout=30) as r:
            b=r.read().decode('utf-8','replace')
            return {'url':url,'method':method,'status':r.status,'contentType':r.headers.get('content-type'),'bytes':len(b),'sample':b[:1200]}
    except urllib.error.HTTPError as e:
        b=e.read().decode('utf-8','replace')
        return {'url':url,'method':method,'status':e.code,'contentType':e.headers.get('content-type'),'bytes':len(b),'sample':b[:1200]}
    except Exception as e:return {'url':url,'method':method,'error':repr(e)}

# Direct read-only probes without credentials.
for path in ['/cs/locations/complete','/cs/locations','/locations/control']:
    print(json.dumps(request(API+path),ensure_ascii=False))
# Likely guest/QR endpoints with empty harmless payloads, to distinguish auth vs validation.
for path in ['/qr/controller','/users/voucher/qr']:
    print(json.dumps(request(API+path,'POST',{}),ensure_ascii=False))

# Search every public SPA JS asset for guest/ad-hoc/payment API calls, including dynamic chunks.
html=urllib.request.urlopen(urllib.request.Request(SPA+'/',headers={'User-Agent':UA}),timeout=30).read().decode('utf-8','replace')
assets=set(urllib.parse.urljoin(SPA+'/',x) for x in re.findall(r'(?:src|href)=["\']([^"\']+\.js(?:\?[^"\']*)?)["\']',html,re.I))
seen=set()
while assets-seen:
    url=(assets-seen).pop();seen.add(url)
    try: body=urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':UA}),timeout=30).read().decode('utf-8','replace')
    except Exception: continue
    for name in re.findall(r'[A-Za-z][A-Za-z0-9_-]+-[A-Za-z0-9_-]+\.js',body): assets.add(SPA+'/assets/'+name)
    calls=[]
    for m in re.finditer(r'm\.(get|post)\(([^)]{0,500})\)',body):
        s=m.group(0)
        if re.search(r'(?i)(qr|guest|paypal|payment|adhoc|ad_hoc|voucher|controller|charge|pricing|location)',s): calls.append(s)
    strings=[s for s in re.findall(r'["\'`]([^"\'`]{1,260})["\'`]',body) if re.search(r'(?i)(qr|guest|paypal|payment|adhoc|ad_hoc|direct.?pay|voucher|controller.?code)',s)]
    if calls or strings: print(json.dumps({'asset':url,'calls':calls[:100],'strings':strings[:200]},ensure_ascii=False))
