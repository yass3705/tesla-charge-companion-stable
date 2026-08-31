#!/usr/bin/env python3
import argparse, json, re
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

UA='TCC-V9-Public-Endpoint-Probe/1.0'
URL_RE=re.compile(r'https?://[^\"\'<>\\s]+')
KEYWORDS=('api','graphql','charge','charger','station','evse','location','tariff','price','pricing','spot2charge','evplatform','totalenergies')

class Scripts(HTMLParser):
    def __init__(self): super().__init__(); self.src=[]
    def handle_starttag(self, tag, attrs):
        if tag.lower()!='script': return
        d=dict(attrs)
        if d.get('src'): self.src.append(d['src'])

def fetch(url, max_bytes=5_000_000):
    req=Request(url,headers={'User-Agent':UA,'Accept':'text/html,application/javascript,*/*'})
    try:
        with urlopen(req,timeout=25) as r:
            b=r.read(max_bytes+1)
            if len(b)>max_bytes: raise RuntimeError(f'resource too large: {url}')
            return {'ok':True,'status':getattr(r,'status',200),'text':b.decode('utf-8','replace'),'headers':dict(r.headers)}
    except HTTPError as e:
        return {'ok':False,'status':e.code,'error':f'HTTP {e.code}: {e.reason}','text':'','headers':dict(e.headers or {})}
    except URLError as e:
        return {'ok':False,'status':None,'error':f'URL error: {e.reason}','text':'','headers':{}}

def clean_url(u):
    return u.rstrip(');,]}')

def interesting(u):
    x=u.lower()
    return any(k in x for k in KEYWORDS)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--url',default='https://chargingservices.totalenergies.com/en/find-a-charger')
    ap.add_argument('--out',default='build/totalenergies-public-endpoint-probe.json')
    ap.add_argument('--max-scripts',type=int,default=80)
    a=ap.parse_args()
    page=fetch(a.url)
    base=urlparse(a.url)
    scripts=[]
    found=set()
    errors=[]
    blocked_by_origin=None

    if page['ok']:
        p=Scripts(); p.feed(page['text'])
        for s in p.src:
            u=urljoin(a.url,s)
            if urlparse(u).scheme in ('http','https'): scripts.append(u)
        scripts=list(dict.fromkeys(scripts))[:a.max_scripts]
        for u in scripts:
            r=fetch(u)
            if not r['ok']:
                errors.append({'url':u,'status':r.get('status'),'error':r.get('error','')[:200]}); continue
            txt=r['text']
            for raw in URL_RE.findall(txt):
                q=clean_url(raw)
                if interesting(q): found.add(q)
            for m in re.findall(r'[\"\']([^\"\']{1,220})[\"\']',txt):
                ml=m.lower()
                if ('/api/' in ml or 'graphql' in ml) and interesting(m): found.add(m)
    else:
        blocked_by_origin=page.get('status')
        errors.append({'url':a.url,'status':page.get('status'),'error':page.get('error','')[:200]})

    report={
      'schemaVersion':2,
      'sourcePage':a.url,
      'publicPageHost':base.netloc,
      'publicPageHttpStatus':page.get('status'),
      'blockedByOrigin':blocked_by_origin,
      'scriptCount':len(scripts),
      'candidateCount':len(found),
      'candidates':sorted(found),
      'scriptFetchErrors':errors,
      'automationAssessment':('server_probe_blocked' if blocked_by_origin else ('public_candidates_found' if found else 'no_public_candidates_found')),
      'policy':{
        'publicResourcesOnly':True,
        'candidateEndpointsNotInvoked':True,
        'noCredentialsOrSecrets':True,
        'noMobileAppReverseEngineering':True,
        'noOriginBlockBypassAttempted':True
      }
    }
    q=Path(a.out); q.parent.mkdir(parents=True,exist_ok=True); q.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps(report,indent=2,ensure_ascii=False))

if __name__=='__main__': main()
