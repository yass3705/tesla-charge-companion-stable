#!/usr/bin/env python3
"""Compatibility entrypoint with strict JSON gzip serialization.

The identity enricher is intentionally kept non-production. This wrapper fixes
serialization while the refactor remains isolated in PR #51.
"""
from __future__ import annotations

import gzip
import json
from pathlib import Path

import enrich_france_irve_network_identity as enricher


def dump_json(path, value, pretty=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix == ".gz":
        with gzip.open(path, "wt", encoding="utf-8", compresslevel=9) as handle:
            json.dump(value, handle, ensure_ascii=False, separators=(",", ":"))
    else:
        path.write_text(
            json.dumps(value, ensure_ascii=False, indent=2 if pretty else None) + "\n",
            encoding="utf-8",
        )


enricher.dump_json = dump_json
enricher.main()
