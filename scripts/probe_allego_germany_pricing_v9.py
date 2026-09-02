#!/usr/bin/env python3
import json,re,urllib.request
URL='https://www.allego.eu/de/preisgestaltung/'
req=urllib.request.Request(URL,headers={'User-Agent':'Mozilla/5.0 TeslaChargeCompanion/9','Accept-Language':'de-DE,de;q=0.9'})
with urllib.request.urlopen(req,timeout=30) as r: body=r.read().decode('utf-8','replace')
patterns=['Deutschland','Germany','country','data-country','0,590','0.590','0,59','0.59','0,390','0.390']
for p in patterns:
 hits=[]
 for m in re.finditer(re.escape(p),body,re.I):hits.append(re.sub(r'\s+',' ',body[max(0,m.start()-1000):m.end()+1800]))
 print(json.dumps({'pattern':p,'count':len(hits),'samples':hits[:8]},ensure_ascii=False))
