#!/usr/bin/env python3
import json,re,urllib.parse,urllib.request
BASE='https://tariff.qwello.eu/'
UA='Mozilla/5.0 TeslaChargeCompanion/9'
def get(url):
 req=urllib.request.Request(url,headers={'User-Agent':UA})
 with urllib.request.urlopen(req,timeout=30) as r:return r.geturl(),r.read().decode('utf-8','replace')
seen=set();queue=[BASE+'api.js']
while queue:
 url=queue.pop(0)
 if url in seen:continue
 seen.add(url)
 try:
  final,body=get(url)
  print(json.dumps({'url':final,'body':body},ensure_ascii=False))
  for rel in re.findall(r'(?:from|import)\s*["\']([^"\']+\.js)["\']|from\s+["\']([^"\']+\.js)["\']',body):
   p=rel[0] or rel[1];u=urllib.parse.urljoin(url,p)
   if u.startswith(BASE) and u not in seen:queue.append(u)
  for p in re.findall(r'["\']([^"\']+\.js)["\']',body):
   u=urllib.parse.urljoin(url,p)
   if u.startswith(BASE) and u not in seen:queue.append(u)
 except Exception as e:print(json.dumps({'url':url,'error':repr(e)}))
