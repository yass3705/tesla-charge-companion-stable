#!/usr/bin/env python3
import gzip,json,subprocess,tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
FIXTURE=ROOT/'tests/fixtures/spain_miteco_v9_sample.csv'
REVE=ROOT/'tests/fixtures/spain_reve_v9_sample.json'
ALIASES=ROOT/'data/v9/spain-operator-aliases.json'

with tempfile.TemporaryDirectory() as td:
    td=Path(td);out=td/'spain-static';cross=td/'spain-crosswalk.json';enriched=td/'spain-crosswalk-reve.json'
    subprocess.run(['python',str(ROOT/'scripts/build_spain_miteco_v9.py'),'--input',str(FIXTURE),'--out',str(out),'--crosswalk',str(cross),'--aliases',str(ALIASES)],check=True)
    manifest=json.loads((out/'manifest.json').read_text(encoding='utf-8'))
    assert manifest['schemaVersion']==2
    assert manifest['dataset']=='spain-miteco-static-v9'
    assert manifest['country']=='ES'
    assert manifest['stationCount']==2
    assert manifest['evseCount']==3
    assert manifest['tileCount']>=2
    rows=json.loads(gzip.decompress((out/'all.json.gz').read_bytes()).decode('utf-8'))
    assert len(rows)==2
    madrid=next(r for r in rows if r[0]=='ES-MAD-001')
    assert madrid[5]=='Iberdrola | bp pulse'
    assert {c[2] for c in madrid[8]}=={'AC','DC'}
    cw=json.loads(cross.read_text(encoding='utf-8'))
    assert cw['country']=='ES' and len(cw['entries'])==2
    entry=next(e for e in cw['entries'] if e['mitecoId']=='ES-MAD-001')
    assert entry['canonicalId']=='ES:national:ES-MAD-001'
    assert entry['reveLocationIds']==[] and entry['reveEvseIds']==[]
    assert sorted(entry['mitecoEvseIds'])==['ES*IBC*E001','ES*IBC*E002']
    subprocess.run(['python',str(ROOT/'scripts/enrich_spain_reve_crosswalk_v9.py'),'--crosswalk',str(cross),'--catalog',str(out/'all.json.gz'),'--reve',str(REVE),'--out',str(enriched)],check=True)
    ecw=json.loads(enriched.read_text(encoding='utf-8'))
    assert ecw['stats']['exactEvse']==2
    assert ecw['stats']['ambiguous']==0
    assert ecw['stats']['unresolved']==0
    madrid=next(e for e in ecw['entries'] if e['mitecoId']=='ES-MAD-001')
    assert madrid['reveMatchMethod']=='exact_evse'
    assert madrid['reveLocationIds']==['REVE-MAD-001']
    assert sorted(madrid['reveEvseIds'])==['ES*IBC*E001','ES*IBC*E002']
print('Spain MITECO + REVE V9 contract OK')
