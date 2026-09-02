#!/usr/bin/env python3
import json,re,urllib.request,urllib.parse
BASE='https://service.eparkstation.de'
UA='Mozilla/5.0 TeslaChargeCompanion/9'
paths=['/','/info/datenschutz','/robots.txt','/sitemap.xml','/api','/api/','/swagger','/swagger-ui','/swagger-ui/index.html','/v3/api-docs','/openapi.json','/api-docs']
for p in paths:
    url=BASE+p
    try:
        req=urllib.request.Request(url,headers={'User-Agent':UA})
        with urllib.request.urlopen(req,timeout=20) as r:
            body=r.read().decode('utf-8','replace')
            print(json.dumps({'url':url,'status':r.status,'final':r.geturl(),'contentType':r.headers.get('content-type'),'bytes':len(body),'sample':re.sub(r'\s+',' ',body)[:500]},ensure_ascii=False))
            if 'html' in (r.headers.get('content-type') or ''):
                for src in sorted(set(re.findall(r'(?:src|href)=["\']([^"\']+\.(?:js|json)(?:\?[^"\']*)?)["\']',body,re.I))):
                    print(json.dumps({'asset':urllib.parse.urljoin(r.geturl(),src)},ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'url':url,'error':repr(e)},ensure_ascii=False))
