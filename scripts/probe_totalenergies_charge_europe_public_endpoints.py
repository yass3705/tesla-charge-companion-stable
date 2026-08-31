#!/usr/bin/env python3
import argparse, json, re, sys
from html.parser import HTMLParser
from pathlib import Path
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
    with urlopen(req,timeout=25) as r:
        b=r.read(max_bytes+1)
        if len(b)>max_bytes: raise RuntimeError(f'resource too large: {url}')
        return b.decode('utf-8','replace'), dict(r.headers)

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
    html,_=fetch(a.url)
    p=Scripts(); p.feed(html)
    base=urlparse(a.url)
    scripts=[]
    for s in p.src:
        u=urljoin(a.url,s)
        # Only inspect public JS referenced directly by the public page.
        if urlparse(u).scheme in ('http','https'): scripts.append(u)
    scripts=list(dict.fromkeys(scripts))[:a.max_scripts]
    found=set()
    errors=[]
    for u in scripts:
        try:
            txt,_=fetch(u)
        except Exception as e:
            errors.append({'url':u,'error':str(e)[:200]}); continue
        for raw in URL_RE.findall(txt):
            q=clean_url(raw)
            if interesting(q): found.add(q)
        # Also retain route-like API fragments without reconstructing or calling them.
        for m in re.findall(r'[\"\']([^\"\']{1,220})[\"\']',txt):
            ml=m.lower()
            if ('/api/' in ml or 'graphql' in ml) and interesting(m):
                found.add(m)
    report={
      'schemaVersion':1,
      'sourcePage':a.url,
      'publicPageHost':base.netloc,
      'scriptCount':len(scripts),
      'candidateCount':len(found),
      'candidates':sorted(found),
      'scriptFetchErrors':errors,
      'policy':{
        'publicResourcesOnly':True,
        'candidateEndpointsNotInvoked':True,
        'noCredentialsOrSecrets':True,
        'noMobileAppReverseEngineering':True
      }
    }
    q=Path(a.out); q.parent.mkdir(parents=True,exist_ok=True); q.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps(report,indent=2,ensure_ascii=False))

if __name__=='__main__': main()
