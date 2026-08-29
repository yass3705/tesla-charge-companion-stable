#!/usr/bin/env python3
import argparse,csv,gzip,json,shutil,tempfile,urllib.request
from datetime import datetime,timezone
from pathlib import Path

DEFAULT_URL='https://www.data.gouv.fr/api/1/datasets/r/89185b1f-f958-4c5b-9282-399a66ecee97'

def txt(v):return str(v or '').strip()
def download(url):
    fd=tempfile.NamedTemporaryFile(delete=False,suffix='.csv');fd.close()
    req=urllib.request.Request(url,headers={'User-Agent':'Tesla-Charge-Companion-V9/1.0'})
    with urllib.request.urlopen(req,timeout=180) as r,open(fd.name,'wb') as w:shutil.copyfileobj(r,w)
    return Path(fd.name)
def reader(path):
    f=open(path,'r',encoding='utf-8-sig',newline='');sample=f.read(65536);f.seek(0)
    try:dialect=csv.Sniffer().sniff(sample,delimiters=',;\t')
    except csv.Error:dialect=csv.excel
    return f,csv.DictReader(f,dialect=dialect)

def build(source,crosswalk,out):
    cw=json.loads(Path(crosswalk).read_text(encoding='utf-8'))
    pdc_to_station={}
    for e in cw.get('entries',[]):
        sid=txt(e.get('idStationItinerance') or e.get('id_station_itinerance'))
        for pid in e.get('pdcIds',[]) or []:
            if sid and pid:pdc_to_station[txt(pid)]=sid
    f,rows=reader(source);records=[];unmatched=0;source_rows=0
    try:
        for r in rows:
            source_rows+=1
            pid=txt(r.get('id_pdc_itinerance') or r.get('idPdcItinerance'))
            if not pid:continue
            sid=txt(r.get('id_station_itinerance') or r.get('idStationItinerance')) or pdc_to_station.get(pid,'')
            if not sid:unmatched+=1;continue
            state=txt(r.get('etat_pdc') or r.get('etatPdc') or r.get('status'))
            ts=txt(r.get('horodatage') or r.get('date_maj') or r.get('updatedAt') or r.get('last_updated'))
            records.append({'id_station_itinerance':sid,'id_pdc_itinerance':pid,'etat_pdc':state,'date_maj':ts or None})
    finally:f.close()
    generated=datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
    payload={'schemaVersion':1,'country':'FR','generatedAt':generated,'sourceUrl':DEFAULT_URL,'sourceRows':source_rows,'unmatchedPdc':unmatched,'records':records}
    raw=json.dumps(payload,ensure_ascii=False,separators=(',',':')).encode();gz=gzip.compress(raw,compresslevel=9)
    p=Path(out);p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(gz)
    print(json.dumps({'sourceRows':source_rows,'matchedRecords':len(records),'unmatchedPdc':unmatched,'gzipBytes':len(gz)},indent=2))

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--input');ap.add_argument('--url',default=DEFAULT_URL);ap.add_argument('--crosswalk',default='data/v9/france-crosswalk.json');ap.add_argument('--out',default='data/v9/france-irve-dynamic-status.json.gz');a=ap.parse_args();tmp=None
    try:
        src=Path(a.input) if a.input else download(a.url);tmp=None if a.input else src;build(src,a.crosswalk,a.out)
    finally:
        if tmp:tmp.unlink(missing_ok=True)
if __name__=='__main__':main()
