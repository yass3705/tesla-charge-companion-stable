#!/usr/bin/env python3
import csv,io
from pathlib import Path
import build_germany_bnetza_v9 as base


def open_reader_compat(path):
    raw=Path(path).read_bytes();text=None
    for enc in ('utf-8-sig','utf-8','cp1252','latin-1'):
        try:
            text=raw.decode(enc);break
        except UnicodeDecodeError:
            pass
    if text is None:
        raise RuntimeError('BNetzA export cannot be decoded')
    lines=text.splitlines(True)
    header_index=None
    for i,line in enumerate(lines[:100]):
        normalized=line.lstrip('\ufeff').strip()
        if normalized.startswith('Ladeeinrichtungs-ID;Betreiber;'):
            header_index=i;break
    if header_index is None:
        raise RuntimeError('BNetzA CSV header not found in first 100 lines')
    body=''.join(lines[header_index:])
    return csv.DictReader(io.StringIO(body),delimiter=';',quotechar='"')

base.open_reader=open_reader_compat
base.main()
