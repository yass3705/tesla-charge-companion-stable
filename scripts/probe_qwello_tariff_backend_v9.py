#!/usr/bin/env python3
import json,re,urllib.parse,urllib.request
BASE='https://tariff.qwello.eu/'
UA='Mozilla/5.0 TeslaChargeCompanion/9'
def get(url):
 req=urllib.request.Request(url,headers={'User-Agent':UA})
 with urllib.request.urlopen(req,timeout=30) as r:return r.geturl(),r.read().decode('utf-8','replace')
final,html=get(BASE)
scripts=re.findall(r'<script[^>]+src=["\']([^"\']+)',html,re.I)
inline=re.findall(r'<script(?![^>]+src=)[^>]*>(.*?)</script>',html,re.I|re.S)
urls=sorted(set(re.findall(r'https?://[^"\'`<>\\\s]+',html)))
calls=sorted(set(re.findall(r'[^\n;]{0,160}(?:fetch\s*\(|axios|XMLHttpRequest|/api/|stations?|tariffs?|evse)[^\n;]{0,240}',html,re.I)))
print(json.dumps({'page':final,'bytes':len(html),'scripts':scripts,'inlineScriptCount':len(inline),'urls':urls,'calls':calls[:200]},ensure_ascii=False))
for i,body in enumerate(inline):
 hints=[x.strip() for x in body.splitlines() if re.search(r'fetch|axios|api|station|tariff|evse|http',x,re.I)]
 if hints: print(json.dumps({'inline':i,'hints':hints[:300]},ensure_ascii=False))
for src in scripts:
 url=urllib.parse.urljoin(BASE,src)
 try:
  _,body=get(url)
  urls=sorted(set(re.findall(r'https?://[^"\'`\\\s]+',body)))
  hints=sorted(set(re.findall(r'[^"\'`\s]{0,80}(?:api|station|tariff|evse)[^"\'`\s]{0,120}',body,re.I)))
  print(json.dumps({'script':url,'bytes':len(body),'urls':urls[:50],'hints':hints[:100]},ensure_ascii=False))
 except Exception as e:print(json.dumps({'script':url,'error':repr(e)}))
