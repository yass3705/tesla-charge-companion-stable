#!/usr/bin/env python3
from __future__ import annotations

import copy
from typing import Any

import v9_build_italy_catalog as base


def _component_map(tariff: dict[str, Any]) -> dict[str, dict[str, Any]] | None:
    comps = tariff.get("priceComponents")
    if not isinstance(comps, list) or not comps:
        return None
    out: dict[str, dict[str, Any]] = {}
    for comp in comps:
        if not isinstance(comp, dict):
            return None
        typ = str(comp.get("type") or "")
        if typ in out:
            return None
        out[typ] = comp
    return out


def _validated_runtime_pricing(tariff: dict[str, Any]) -> dict[str, Any] | None:
    pricing = tariff.get("runtimePricing")
    evidence = tariff.get("runtimeTranslation")
    if not isinstance(pricing, dict) or not isinstance(evidence, dict):
        return None
    if tariff.get("runtimeRankable") is not True or tariff.get("fullCostRankable") is not True:
        return None
    if tariff.get("requiresRuntimeComponentSupport") is not False:
        return None
    if evidence.get("exactEngineTestPassed") is not True:
        return None
    if pricing.get("type") != "rules":
        return None
    rules = pricing.get("rules")
    if not isinstance(rules, list) or not rules:
        return None
    for rule in rules:
        if not isinstance(rule, dict):
            return None
        if base.finite(rule.get("pricePerKwh")) is None:
            return None
        if "sessionFeeEur" in rule and base.finite(rule.get("sessionFeeEur")) is None:
            return None
    return copy.deepcopy(pricing)


def direct_pricing_fail_closed(tariff: dict[str, Any]) -> dict[str, Any] | None:
    # Component tariffs must never fall through to eurPerKwh and silently
    # discard time/session/parking components.
    if tariff.get("pricingType") == "components":
        comps = _component_map(tariff)
        if not comps or "energy" not in comps:
            return None

        if set(comps) == {"energy"}:
            energy = comps["energy"]
            rate = base.finite(energy.get("amount"))
            if energy.get("unit") != "per_kWh" or rate is None:
                return None
            legacy = base.finite(tariff.get("eurPerKwh"))
            if legacy is not None and abs(float(legacy) - float(rate)) > 1e-9:
                return None
            return base.pricing_kwh(float(rate), base.post_charge_fee(tariff))

        runtime = _validated_runtime_pricing(tariff)
        if runtime is None:
            return None

        # Current proven component translation is exactly energy + session.
        if set(comps) != {"energy", "session"}:
            return None
        if comps["energy"].get("unit") != "per_kWh" or comps["session"].get("unit") != "per_session":
            return None
        rule = runtime["rules"][0]
        energy = base.finite(comps["energy"].get("amount"))
        session = base.finite(comps["session"].get("amount"))
        if energy is None or session is None:
            return None
        if abs(float(rule.get("pricePerKwh")) - float(energy)) > 1e-9:
            return None
        if abs(float(rule.get("sessionFeeEur")) - float(session)) > 1e-9:
            return None
        return runtime

    return base.direct_pricing(tariff)


base.direct_pricing = direct_pricing_fail_closed

if __name__ == "__main__":
    base.main()
