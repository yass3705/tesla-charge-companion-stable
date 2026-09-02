#!/usr/bin/env python3
import html,json,re,urllib.request
URL='https://www.allego.eu/de/preisgestaltung/'
req=urllib.request.Request(URL,headers={'User-Agent':'Mozilla/5.0 TeslaChargeCompanion/9','Accept-Language':'de-DE,de;q=0.9'})
with urllib.request.urlopen(req,timeout=30) as r: body=r.read().decode('utf-8','replace')
start=body.find('id="pricing-13987"')
if start<0: raise SystemExit('Germany pricing block not found')
nexts=[x for x in [body.find('id="pricing-',start+20),body.find('class="faq',start+20)] if x>start]
end=min(nexts) if nexts else len(body)
block=html.unescape(body[start:end])
text=re.sub(r'<[^>]+>',' ',block);text=re.sub(r'\s+',' ',text).strip()
prices=re.findall(r'([0-9]+(?:,[0-9]+)?(?:\s*[–-]\s*[0-9]+(?:,[0-9]+)?)?)\s*€/kWh',text)
print(json.dumps({'blockId':'pricing-13987','chars':len(block),'text':text,'prices':prices},ensure_ascii=False,indent=2))
