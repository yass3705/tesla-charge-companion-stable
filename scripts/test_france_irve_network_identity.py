#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

from enrich_france_irve_network_identity import resolve_physical_operator, resolve_tariff_network

ROOT = Path(__file__).resolve().parents[1]
operator_specs = json.loads((ROOT / "data/france_irve_operator_registry_v1.json").read_text(encoding="utf-8"))["operators"]
network_specs = json.loads((ROOT / "data/france_irve_tariff_network_registry_v1.json").read_text(encoding="utf-8"))["networks"]
network_specs += json.loads((ROOT / "data/france_irve_tariff_network_additions_v1.json").read_text(encoding="utf-8"))["networks"]

for raw in ("Bouygues Energies & Services", "BOUYGUES ENERGIES SERVICES"):
    physical_id, mode = resolve_physical_operator(raw, operator_specs, network_specs)
    assert physical_id == "bouygues-energies-services", (raw, physical_id, mode)
    assert mode == "alias", (raw, mode)

    alize, alize_mode = resolve_tariff_network("Alizé Liberté 2", raw, network_specs)
    assert alize and alize["id"] == "alize-liberte", (raw, alize, alize_mode)
    assert alize_mode == "brand_alias"

    tarnais, tarnais_mode = resolve_tariff_network("Le Plein Tarnais", raw, network_specs)
    assert tarnais and tarnais["id"] == "le-plein-tarnais", (raw, tarnais, tarnais_mode)
    assert tarnais_mode == "brand_alias"

    blank, blank_mode = resolve_tariff_network("", raw, network_specs)
    assert blank is None, (raw, blank, blank_mode)

for station_id, expected in (
    ("FRIMXPIMAX1", "izivia-max"),
    ("FRIGFPGF61", "izivia-grand-frais"),
    ("FRILFPLFREM1", "izivia-impact-lf"),
):
    network, mode = resolve_tariff_network(
        "IZIVIA MAX - GENERIC LABEL",
        "IZIVIA",
        network_specs,
        station_id=station_id,
        physical_operator_id="izivia",
    )
    assert network and network["id"] == expected, (station_id, network, mode)
    assert mode == "station_id_prefix", (station_id, mode)

blocked, blocked_mode = resolve_tariff_network(
    "IZIVIA MAX",
    "OTHER CPO",
    network_specs,
    station_id="FRIMXPIMAX1",
    physical_operator_id="other",
)
assert blocked is None and blocked_mode == "station_id_physical_operator_mismatch", (blocked, blocked_mode)

print("France IRVE network identity regression tests OK")
