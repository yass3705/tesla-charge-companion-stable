#!/usr/bin/env python3
"""Révéo territory-resolution extension for the canonical V9 materializer.

This wrapper deliberately leaves the audited pricing/materialization engine in
``materialize_france_reveo_offers.py`` untouched.  It only strengthens territory
resolution for current PAN rows:
- Tarn (81) belongs to the general Révéo public tariff scope.
- If PAN omits ``code_insee_commune``, an explicit five-digit postal code in the
  canonical station address may resolve a department.
- Postal fallback is never used for Hérault because department 34 contains the
  separate Montpellier Métropole tariff area; Hérault therefore still requires
  an INSEE commune code or the historical FR*S34 party id.
- Postal fallback for 31 and 66 resolves only to blocked special territories,
  never to a rankable general tariff.
"""
from __future__ import annotations

import importlib.util
import re
from pathlib import Path

BASE_SCRIPT = Path(__file__).with_name("materialize_france_reveo_offers.py")
spec = importlib.util.spec_from_file_location("reveo_materializer_base", BASE_SCRIPT)
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

base.DEPARTMENT_TO_TERRITORY["81"] = "D81"
base.EXPECTED_RANKABLE.add("D81")

_GENERAL_POSTAL = {
    "09": "D09",
    "11": "D11",
    "12": "S12",
    "30": "D30",
    "46": "D46",
    "48": "S48",
    "65": "D65",
    "81": "D81",
}
_BLOCKED_POSTAL = {"31": "M31", "66": "D66"}
_original_territory_match = base.territory_match


def postal_code(station):
    address = base.clean(station.get("address"))
    matches = set(re.findall(r"(?<!\d)(\d{5})(?!\d)", address))
    return next(iter(matches)) if len(matches) == 1 else ""


def territory_match(pdc, station):
    territory_id, method = _original_territory_match(pdc, station)
    if territory_id:
        return territory_id, method

    # D81 was not part of the first materializer revision, but an exact INSEE
    # commune code remains the preferred evidence when available.
    code = base.insee_code(station)
    if code.startswith("81"):
        return "D81", "insee_department_81"

    postal = postal_code(station)
    if not postal:
        return "", ""
    department = postal[:2]
    if department in _GENERAL_POSTAL:
        return _GENERAL_POSTAL[department], f"postal_department_{department}"
    if department in _BLOCKED_POSTAL:
        return _BLOCKED_POSTAL[department], f"postal_department_{department}_blocked_special_grid"
    # No 34 fallback: a postal department alone cannot safely distinguish
    # Montpellier Métropole from the rest of Hérault.
    return "", ""


base.territory_match = territory_match


def main():
    base.main()


if __name__ == "__main__":
    main()
