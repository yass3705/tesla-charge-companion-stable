#!/usr/bin/env python3
"""Compatibility entrypoint for the PAN audit builder.

PAN dynamic timestamps currently mix offset-aware ISO values and naive ISO
values. Treat naive values as UTC before the builder compares freshness.
"""
import datetime as dt
import build_france_irve_canonical as builder

_original_parse_timestamp = builder.parse_timestamp


def parse_timestamp_utc(value):
    parsed = _original_parse_timestamp(value)
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


builder.parse_timestamp = parse_timestamp_utc
builder.main()
