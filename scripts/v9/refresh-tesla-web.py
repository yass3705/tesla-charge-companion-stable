#!/usr/bin/env python3
"""Refresh the V9 test snapshot with the existing SuC Tracker converter."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent / 'suc_tracker'))
from update import refresh

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source-json', help='Use a downloaded source for reproducible validation')
args = parser.parse_args()
out = root / 'data/v9/tesla-web'
metadata = json.loads((out / 'metadata.json').read_text())
result = refresh(out, set(metadata['countries']), args.source_json)
print(json.dumps(result, indent=2))
