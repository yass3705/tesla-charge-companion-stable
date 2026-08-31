#!/usr/bin/env python3
"""Promote the verified Révéo Pyrénées-Orientales (D66) public grid.

This wrapper extends the audited V2 materializer without weakening its guards:
- PAN IRVE remains the sole physical inventory.
- D66 is resolved only by the existing exact INSEE/postal territory logic.
- The D66 public grid comes from a dedicated, independently validated source.
- D66 subscriber pricing remains non-rankable.
- Toulouse Métropole and Montpellier Métropole remain blocked.
- Roaming/eMSP tariffs never become direct Révéo tariffs.
"""
from __future__ import annotations

import copy
import importlib.util
from pathlib import Path

V2_SCRIPT = Path(__file__).with_name("materialize_france_reveo_offers_v2.py")
D66_SOURCE = Path(__file__).parents[1] / "data" / "reveo_d66_direct_tariffs_v1.json"

spec = importlib.util.spec_from_file_location("reveo_materializer_v2", V2_SCRIPT)
v2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v2)
engine = v2.base

_original_load_json = engine.load_json
_original_validate_source = engine.validate_source
engine.EXPECTED_RANKABLE.add("D66")


def _merge_d66(main_source):
    data = copy.deepcopy(main_source)
    d66 = _original_load_json(D66_SOURCE)
    if d66.get("dataset") != "reveo-d66-direct-tariffs-france" or d66.get("country") != "FR":
        raise ValueError("unexpected Révéo D66 source")
    policy = d66.get("policy") or {}
    if policy.get("operatorDirectOnly") is not True or policy.get("publicOnlyRankable") is not True:
        raise ValueError("Révéo D66 direct/public policy invalid")
    if policy.get("subscriberRankable") is not False or policy.get("roamingIncluded") is not False:
        raise ValueError("Révéo D66 subscriber/roaming policy invalid")
    if policy.get("physicalInventoryMutationAllowed") is not False:
        raise ValueError("Révéo D66 must not mutate physical inventory")

    family = d66.get("tariffFamily") or {}
    if family.get("id") != "D66_SPECIAL_PUBLIC_CURRENT" or family.get("status") != "rankable_public_only":
        raise ValueError("Révéo D66 tariff family invalid")
    public = family.get("public")
    if not isinstance(public, list) or len(public) != 4:
        raise ValueError("Révéo D66 public grid incomplete")

    territory = d66.get("territoryOverride") or {}
    if territory.get("department") != "66" or territory.get("rankableProfiles") != ["public"]:
        raise ValueError("Révéo D66 territory override invalid")
    if territory.get("tariffFamily") != family.get("id"):
        raise ValueError("Révéo D66 territory/family mismatch")

    scope = data.setdefault("scope", {})
    for key in ("rankableTerritories", "rankablePublicTerritories"):
        values = list(scope.get(key) or [])
        if "D66" not in values:
            values.append("D66")
        scope[key] = values
    # Subscriber scope intentionally remains unchanged (S34 only).

    data.setdefault("tariffFamilies", {})[family["id"]] = {
        key: value for key, value in family.items() if key != "id"
    }
    data.setdefault("territories", {})["D66"] = territory

    exclusions = [
        value for value in (data.get("exclusions") or [])
        if "Pyrénées-Orientales and Toulouse Métropole" not in str(value)
    ]
    exclusions.extend([
        "Toulouse Métropole remains non-rankable until its current special direct grid is verified",
        "Révéo D66 subscriber prices remain non-rankable until current subscriber pricing is reverified",
    ])
    data["exclusions"] = exclusions
    return data


def load_json(path):
    data = _original_load_json(path)
    if isinstance(data, dict) and data.get("dataset") == "reveo-direct-tariffs-france":
        return _merge_d66(data)
    return data


def validate_source(data):
    # First re-run all pre-D66 invariants against an equivalent source with D66
    # removed from the rankable set. This preserves every existing guard.
    baseline = copy.deepcopy(data)
    for key in ("rankableTerritories", "rankablePublicTerritories"):
        baseline["scope"][key] = [v for v in (baseline["scope"].get(key) or []) if v != "D66"]
    baseline["tariffFamilies"].pop("D66_SPECIAL_PUBLIC_CURRENT", None)
    baseline["territories"]["D66"] = {
        "department": "66",
        "label": "Pyrénées-Orientales — Révéo 2025",
        "status": "unresolved_special_grid_not_verified",
        "public": None,
        "subscriber": None,
    }

    saved = set(engine.EXPECTED_RANKABLE)
    engine.EXPECTED_RANKABLE.discard("D66")
    try:
        _original_validate_source(baseline)
    finally:
        engine.EXPECTED_RANKABLE.clear()
        engine.EXPECTED_RANKABLE.update(saved)

    scope = data.get("scope") or {}
    if "D66" not in (scope.get("rankableTerritories") or []):
        raise ValueError("Révéo D66 not promoted to rankable territory")
    if "D66" not in (scope.get("rankablePublicTerritories") or []):
        raise ValueError("Révéo D66 public profile not promoted")
    if "D66" in (scope.get("rankableSubscriberTerritories") or []):
        raise ValueError("Révéo D66 subscriber pricing must remain blocked")

    territory = (data.get("territories") or {}).get("D66") or {}
    if territory.get("status") != "rankable_public_only":
        raise ValueError("Révéo D66 territory status invalid")
    if territory.get("rankableProfiles") != ["public"]:
        raise ValueError("Révéo D66 must be public-only")
    if territory.get("tariffFamily") != "D66_SPECIAL_PUBLIC_CURRENT":
        raise ValueError("Révéo D66 special family missing")

    family = (data.get("tariffFamilies") or {}).get("D66_SPECIAL_PUBLIC_CURRENT") or {}
    if family.get("status") != "rankable_public_only":
        raise ValueError("Révéo D66 special family status invalid")
    public = family.get("public") or []
    expected = {
        "ac-slow": ("AC", 0.30, 600),
        "ac-normal": ("AC", 0.40, 120),
        "dc-50": ("DC", 0.55, 60),
        "dc-ultra": ("DC", 0.67, 30),
    }
    if {row.get("key") for row in public} != set(expected):
        raise ValueError("Révéo D66 tariff bands incomplete")
    for row in public:
        kind, price, threshold = expected[row["key"]]
        if row.get("kind") != kind or engine.number(row.get("pricePerKwh")) != price:
            raise ValueError(f"Révéo D66 price mismatch: {row.get('key')}")
        fee = row.get("durationFee") or {}
        if engine.number(fee.get("ratePerMinute")) != 0.12 or engine.number(fee.get("thresholdMinutes")) != threshold:
            raise ValueError(f"Révéo D66 duration mismatch: {row.get('key')}")
    normal = next(row for row in public if row.get("key") == "ac-normal")
    if (normal.get("durationFee") or {}).get("activeWindow") != {"start": "07:00", "end": "23:00"}:
        raise ValueError("Révéo D66 normal active window mismatch")

    return data.get("territories") or {}, data.get("tariffFamilies") or {}, data.get("subscription") or {}


engine.load_json = load_json
engine.validate_source = validate_source


def main():
    engine.main()


if __name__ == "__main__":
    main()
