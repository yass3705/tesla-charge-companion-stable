#!/usr/bin/env python3
from pathlib import Path
import argparse
import subprocess
import sys


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--main-root',required=True)
    ap.add_argument('--rc-root',required=True)
    args=ap.parse_args()
    main_root=Path(args.main_root)
    rc_root=Path(args.rc_root)
    catalog=(main_root/'assets/france-catalog-v8.js').read_text(encoding='utf-8')
    app=(rc_root/'assets/app.js').read_text(encoding='utf-8')
    catalog_ready=all(marker in catalog for marker in (
        "const ETOTEM_URL='../data/etotem_direct_tariffs_france.json.gz';",
        'async function loadEtotemCatalog()',
        'function mergeEtotemCatalog(',
        'result.etotemDirectCatalogLoaded=true',
        'etotemDirectConfigurations',
    ))
    app_ready='const idleByRule=new Map();' in app and 'idleGraceMinutes' in app and 'idleCapStart' in app
    if catalog_ready and app_ready:
        print('e-Totem runtime already integrated; no patch required')
        return 0
    patcher=main_root/'scripts/patch_etotem_v8_runtime.py'
    result=subprocess.run([sys.executable,str(patcher),'--main-root',str(main_root),'--rc-root',str(rc_root)])
    return result.returncode

if __name__=='__main__':
    raise SystemExit(main())
