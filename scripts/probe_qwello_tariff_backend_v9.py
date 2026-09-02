#!/usr/bin/env python3
import json,re,urllib.request
BASE='https://tariff.qwello.eu/'
UA='Mozilla/5.0 TeslaChargeCompanion/9'
def get(url):
 req=urllib.request.Request(url,headers={'User-Agent':UA})
 with urllib.request.urlopen(req,timeout=30) as r:return r.geturl(),r.read().decode('utf-8','replace')
for url in [BASE,BASE+'api.js',BASE+'search.js']:
 try:
  final,body=get(url)
  urls=sorted(set(re.findall(r'https?://[^"\'`<>\\\s]+',body)))
  hints=[x.strip() for x in body.splitlines() if re.search(r'fetch|axios|api|station|tariff|evse|http|json',x,re.I)]
  print(json.dumps({'url':final,'bytes':len(body),'urls':urls,'hints':hints[:500]},ensure_ascii=False))
 except Exception as e:print(json.dumps({'url':url,'error':repr(e)}))
