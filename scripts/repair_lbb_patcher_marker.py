from pathlib import Path

p=Path('scripts/patch_lbb_v8_runtime_bugfix.py')
s=p.read_text(encoding='utf-8')
old='marker2 = "const prepared={origin:{lat:48.01419,lon:0.18728},maxDistanceKm:1,stations:[]};api.mergePrepared(prepared,data);"'
new='marker2 = "const origin={lat:Number(data.stations[0].latitude),lon:Number(data.stations[0].longitude)};"'
if s.count(old)!=1:
    raise SystemExit(f'old runtime marker definition count={s.count(old)}')
p.write_text(s.replace(old,new,1),encoding='utf-8')
