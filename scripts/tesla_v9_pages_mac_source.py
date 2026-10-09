#!/usr/bin/env python3
"""Ensure the PAGES V9 preview uses the latest Mac Tesla catalogue.

The main Pages workflow intentionally pins all other V9 data sources. Tesla is
the only live exception: fresh Mac country-batch metadata is overlaid into the
pinned production build input. Do not call this from an unrelated release.
"""
from __future__ import annotations
import argparse
from collections import Counter
from datetime import datetime, date
from hashlib import sha256
import json
from pathlib import Path
import shutil
from zoneinfo import ZoneInfo

def load(path):
    return json.loads(path.read_text(encoding='utf8'))

def digest(path):
    return sha256(path.read_bytes()).hexdigest()

def prepare(site,pinned_stable,prod):
    canonical=site/'data/tesla_stations.json'
    metadata=site/'data/tesla-mac-catalogue-publication.json'
    if not canonical.is_file() or not metadata.is_file():
        raise SystemExit('Canonical Mac Tesla source or synchronizer provenance missing')
    meta=load(metadata)
    rows=load(canonical)
    if not isinstance(rows,list) or len(rows)<1100 or len(set(s['id'] for s in rows))!=len(rows):
        raise SystemExit('Invalid Mac canonical source')
    if meta.get('canonicalSha256')!=digest(canonical) or meta.get('stationCount')!=len(rows):
        raise SystemExit('Mac synchronization metadata checksum mismatch')
    if digest(site/'v9-production-runtime/data/tesla_stations.json')!=digest(canonical):
        raise SystemExit('Mac V9 mirror must be synchronized before Pages deploy')
    mirror=pinned_stable/'data/tesla_stations.json'
    mirror.parent.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(canonical,mirror)
    # Keep the pinned baseline runtime consistent within the ephemeral build.
    shutil.copyfile(canonical,pinned_stable/'v9-production-runtime/data/tesla_stations.json')
    updates_path=prod/'data/tesla_mac_country_updates.json'
    updates=load(updates_path)
    if updates.get('schemaVersion')!=1 or updates.get('timeZone')!='Europe/Paris':
        raise SystemExit('Unexpected pinned Tesla country priority metadata')
    countries=updates.setdefault('countries',{})
    changed=[]
    for cc,stats in (meta.get('countries') or {}).items():
        batch=stats.get('lastMacCountryBatch') or {}
        published=batch.get('publishedAt')
        if not published:
            continue
        stamp=datetime.fromisoformat(published.replace('Z','+00:00'))
        if stamp.tzinfo is None:raise SystemExit(f'Mac batch lacks timezone: {cc}')
        day=stamp.astimezone(ZoneInfo('Europe/Paris')).date()
        if day>datetime.now(ZoneInfo('Europe/Paris')).date():
            raise SystemExit(f'Future Mac batch timestamp for {cc}')
        former=countries.get(cc,{}).get('updatedOn')
        if former is not None and date.fromisoformat(former)>day:
            raise SystemExit(f'Refusing to regress Mac update evidence {cc}')
        countries[cc]={
            **(countries.get(cc) or {}),
            'updatedOn':day.isoformat(),
            'publicationCommitSha':batch.get('commitSha'),
            'dateMeaning':'country Mac publication; not the station sourceObservedAt',
            'macSourceSha256':meta['canonicalSha256'],
        }
        changed.append(cc)
    updates_path.write_text(json.dumps(updates,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    ctx={
        'schemaVersion':1,'source':str(canonical),
        'canonicalSha256':digest(canonical),'stations':len(rows),
        'lastMacPublications':{cc:stats.get('lastMacCountryBatch') for cc,stats in meta['countries'].items()},
        'timeAuthority':'Mac country publication, NOT invented station observation',
        'productionInputsPinnedExceptTesla':True,
        'priorityMetadata':str(updates_path),
        'dateRule':'Mac country age 0-9 days; Morocco always Mac; other sources compared under existing V9 policy'
    }
    (site/'tesla-pages-live-source.json').write_text(json.dumps(ctx,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
    print('TESLA_PAGES_LIVE_PREPARED='+json.dumps({
        'stationCount':len(rows),'sha256':ctx['canonicalSha256'],
        'updatedCountryEntries':sorted(changed)},ensure_ascii=False))

def verify(site,preview):
    ctx=load(site/'tesla-pages-live-source.json')
    source=site/'data/tesla_stations.json'
    selected=preview/'runtime/data/tesla_stations.json'
    ctrl=preview/'data/tesla_stations.json'
    report=preview/'snapshot-inputs/TESLA/tariff-selection.json'
    for p in (selected,ctrl,report):
        if not p.is_file():raise SystemExit('V9 built snapshot missing Tesla file: '+str(p))
    stations=load(selected);mac=load(source)
    if len(stations)!=len(mac) or set(s['id'] for s in stations)!=set(s['id'] for s in mac):
        raise SystemExit('V9 preview station inventory was not built from latest Mac')
    if digest(ctrl)!=digest(selected):
        raise SystemExit('V9 preview root and runtime Tesla sources differ')
    decision=load(report)
    today=datetime.now(ZoneInfo('Europe/Paris')).date()
    for cc,st in ctx['lastMacPublications'].items():
        if not st:continue
        timestamp=datetime.fromisoformat(st['publishedAt'].replace('Z','+00:00'))
        age=(today-timestamp.astimezone(ZoneInfo('Europe/Paris')).date()).days
        normalized=cc if cc!='UK' else 'GB'
        row=decision['countries'].get(normalized)
        if 0<=age<10 and row:
            if row.get('preferredTariffSource')!='Mac' or row.get('sucTariffs')!=0:
                raise SystemExit(f'V9 preview ignored recent Mac tariff publication for country {cc}: {row}')
    ma=decision['countries'].get('MA')
    if not ma or ma.get('preferredTariffSource')!='Mac' or ma.get('sucTariffs')!=0:
        raise SystemExit('Morocco must always choose the Mac tariff')
    ctx['builtTeslaTariffDecisions']=decision['countries']
    p=preview/'snapshot-inputs/TESLA/current-mac-publication.json'
    p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(ctx,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
    print('TESLA_PAGES_LIVE_VERIFIED='+json.dumps({
        'stations':len(stations),'sha256Mac':digest(source),
        'countryTariffDecisions':{k:{'preferred':v.get('preferredTariffSource'),
          'mac':v.get('macTariffs'),'suc':v.get('sucTariffs')} for k,v in decision['countries'].items()}
    },ensure_ascii=False))

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--site',type=Path,required=True)
    ap.add_argument('--pinned-stable',type=Path)
    ap.add_argument('--production',type=Path)
    ap.add_argument('--preview',type=Path)
    ap.add_argument('--mode',required=True,choices=('prepare','verify'))
    a=ap.parse_args()
    if a.mode=='prepare':
        if a.pinned_stable is None or a.production is None:
            ap.error('--prepare requires --pinned-stable and --production')
        prepare(a.site,a.pinned_stable,a.production)
    else:
        if a.preview is None:ap.error('--verify requires --preview')
        verify(a.site,a.preview)
if __name__=='__main__':main()
