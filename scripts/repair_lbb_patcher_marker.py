from pathlib import Path

p=Path('scripts/patch_lbb_v8_runtime_bugfix.py')
s=p.read_text(encoding='utf-8')
old='marker2 = "const prepared={origin:{lat:48.01419,lon:0.18728},maxDistanceKm:1,stations:[]};api.mergePrepared(prepared,data);"'
new='marker2 = "const origin={lat:Number(data.stations[0].latitude),lon:Number(data.stations[0].longitude)};"'
if s.count(old)!=1:
    raise SystemExit(f'old runtime marker definition count={s.count(old)}')
s=s.replace(old,new,1)
old_fn='''def replace_once(text: str, old: str, new: str, label: str) -> str:\n    count = text.count(old)\n    if count != 1:\n        raise SystemExit(f"{label}: expected 1 match, found {count}")\n    return text.replace(old, new, 1)\n'''
new_fn='''def replace_once(text: str, old: str, new: str, label: str) -> str:\n    count = text.count(old)\n    expected = 2 if label in {"workflow path marker", "workflow test path marker"} else 1\n    if count != expected:\n        raise SystemExit(f"{label}: expected {expected} match(es), found {count}")\n    return text.replace(old, new, expected)\n'''
if s.count(old_fn)!=1:
    raise SystemExit(f'replace_once definition count={s.count(old_fn)}')
s=s.replace(old_fn,new_fn,1)
p.write_text(s,encoding='utf-8')
