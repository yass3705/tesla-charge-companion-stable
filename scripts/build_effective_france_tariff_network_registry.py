#!/usr/bin/env python3
"""Build an effective tariff-network registry without mixing identity and coverage.

The base registry owns aliases/identity. Small additive identity rows may live in
`france_irve_tariff_network_additions_v1.json` so newly discovered PAN brands can
be registered without rewriting the historical registry. The coverage overlay
owns migration status and artifact provenance.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--registry", default="data/france_irve_tariff_network_registry_v1.json")
    parser.add_argument("--additions", default="data/france_irve_tariff_network_additions_v1.json")
    parser.add_argument("--coverage", default="data/france_tariff_base_coverage_v1.json")
    parser.add_argument("--out", default="build/france_irve/effective_tariff_network_registry.json")
    args = parser.parse_args()

    registry = load(args.registry)
    base_rows = list(registry.get("networks", []))
    networks = {row["id"]: row for row in base_rows}
    additions_applied = []

    additions_path = Path(args.additions)
    if additions_path.exists():
        additions = load(additions_path)
        if additions.get("country") != registry.get("country"):
            raise SystemExit("tariff-network additions country mismatch")
        for row in additions.get("networks", []):
            network_id = row.get("id")
            if not network_id:
                raise SystemExit("tariff-network addition missing id")
            if network_id in networks:
                raise SystemExit(f"tariff-network addition duplicates existing id: {network_id}")
            aliases = row.get("aliases") or []
            if not aliases:
                raise SystemExit(f"tariff-network addition has no aliases: {network_id}")
            base_rows.append(row)
            networks[network_id] = row
            additions_applied.append(network_id)
        registry["networks"] = base_rows

    coverage = load(args.coverage)
    applied = []
    for override in coverage.get("overrides", []):
        network_id = override.get("networkId")
        if network_id not in networks:
            raise SystemExit(f"coverage override references unknown network: {network_id}")
        for artifact in override.get("artifacts", []):
            if not Path(artifact).exists():
                raise SystemExit(f"coverage override artifact missing for {network_id}: {artifact}")
        row = networks[network_id]
        row["coverageStatus"] = override["coverageStatus"]
        row["artifacts"] = list(override.get("artifacts") or row.get("artifacts") or [])
        if override.get("notes"):
            row["notes"] = override["notes"]
        applied.append({"networkId": network_id, "coverageStatus": row["coverageStatus"]})

    registry["schemaVersion"] = "1.0.2"
    registry["identityAdditions"] = args.additions if additions_path.exists() else None
    registry["identityAdditionCount"] = len(additions_applied)
    registry["coverageOverlay"] = args.coverage
    registry["coverageOverrideCount"] = len(applied)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(out), "identityAdditions": additions_applied, "applied": applied}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
