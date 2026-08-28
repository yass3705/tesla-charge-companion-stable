#!/usr/bin/env python3
"""Build an effective tariff-network registry without mixing identity and coverage.

The base registry owns aliases/identity. The coverage overlay owns migration
status and artifact provenance. This keeps network identity stable while tariff
coverage evolves.
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
    parser.add_argument("--coverage", default="data/france_tariff_base_coverage_v1.json")
    parser.add_argument("--out", default="build/france_irve/effective_tariff_network_registry.json")
    args = parser.parse_args()

    registry = load(args.registry)
    coverage = load(args.coverage)
    networks = {row["id"]: row for row in registry.get("networks", [])}
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

    registry["schemaVersion"] = "1.0.1"
    registry["coverageOverlay"] = args.coverage
    registry["coverageOverrideCount"] = len(applied)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(out), "applied": applied}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
