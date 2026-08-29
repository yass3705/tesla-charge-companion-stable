#!/usr/bin/env python3
import gzip,json,subprocess,sys,tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
fixture=ROOT/'tests/fixtures/germany_bnetza_v9_sample.csv'
aliases=ROOT/'data/v9/germany-operator-aliases.json'
with tempfile.TemporaryDirectory() as td:
    td=Path(td);out=td/'static';cross=td/'crosswalk.json'
    subprocess.run([sys.executable,str(ROOT/'scripts/build_germany_bnetza_v9.py'),'--input',str(fixture),'--out',str(out),'--crosswalk',str(cross),'--aliases',str(aliases)],check=True)
    manifest=json.loads((out/'manifest.json').read_text(encoding='utf-8'))
    assert manifest['country']=='DE'
    assert manifest['dataset']=='germany-bnetza-static-v9'
    assert manifest['sourceRows']==2
    assert manifest['stationCount']==2
    assert manifest['evseCount']==3
    assert manifest['skippedRows']==0
    assert manifest['preIntegrationOnly'] is True
    rows=json.loads(gzip.decompress((out/'all.json.gz').read_bytes()).decode())
    assert len(rows)==2
    berlin=next(r for r in rows if r[0]=='DE-TEST-1')
    stuttgart=next(r for r in rows if r[0]=='DE-TEST-2')
    assert berlin[5]=='IONITY' and berlin[6]==2 and berlin[8][0][2]=='DC' and berlin[8][0][3]==350.0
    assert stuttgart[5]=='EnBW mobility+' and stuttgart[6]==1 and stuttgart[8][0][2]=='AC' and stuttgart[8][0][3]==22.0
    cw=json.loads(cross.read_text(encoding='utf-8'))
    assert cw['country']=='DE' and len(cw['entries'])==2
    assert cw['entries'][0]['canonicalId'].startswith('DE:national:')
print('Germany BNetzA V9 contract OK')
