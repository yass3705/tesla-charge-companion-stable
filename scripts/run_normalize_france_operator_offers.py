#!/usr/bin/env python3
"""Compatibility entrypoint: resolve operator-rule offers on tariff networks.

Station-specific matching remains based on the canonical station's technical
operator. Only rule-template alias resolution is switched from the technical
operator registry to france_irve_tariff_network_registry_v1.json.
"""
import normalize_france_operator_offers as normalizer


def tariff_network_lookup(registry):
    specs = registry.get("networks", registry.get("operators", []))
    by_id = {row["id"]: row for row in specs}
    alias_rows = []
    for row in specs:
        aliases = list(row.get("aliases", []))
        # provider/rule labels sometimes use the customer-facing canonical label.
        if row.get("label"):
            aliases.append(row["label"])
        for alias in aliases:
            token = normalizer.norm(alias)
            if token:
                alias_rows.append((token, row["id"]))
    return by_id, alias_rows


normalizer.operator_lookup = tariff_network_lookup
normalizer.main()
