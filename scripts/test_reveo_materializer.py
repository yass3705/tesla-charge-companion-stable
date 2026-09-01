#!/usr/bin/env python3
import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).with_name("materialize_france_reveo_offers.py")
spec = importlib.util.spec_from_file_location("reveo_materializer", SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

S34_PUBLIC = [
    {"key":"ac-normal","kind":"AC","maxPowerKw":22,"pricePerKwh":0.40,"durationFee":{"ratePerMinute":0.10,"thresholdMinutes":180,"activeWindow":{"start":"07:00","end":"22:00"}}},
    {"key":"dc-50","kind":"DC","minPowerKwExclusive":24,"maxPowerKw":50,"pricePerKwh":0.50,"durationFee":{"ratePerMinute":0.12,"thresholdMinutes":60,"activeWindow":{"start":"07:00","end":"22:00"}}},
    {"key":"dc-ultra","kind":"DC","minPowerKwExclusive":50,"pricePerKwh":0.59,"durationFee":{"ratePerMinute":0.12,"thresholdMinutes":30}},
]
S34_SUB = [
    {"key":"ac-normal","kind":"AC","maxPowerKw":22,"pricePerKwh":0.32,"durationFee":{"ratePerMinute":0.075,"thresholdMinutes":180,"activeWindow":{"start":"07:00","end":"22:00"}}},
    {"key":"dc-50","kind":"DC","minPowerKwExclusive":24,"maxPowerKw":50,"pricePerKwh":0.40,"durationFee":{"ratePerMinute":0.075,"thresholdMinutes":60,"activeWindow":{"start":"07:00","end":"22:00"}}},
    {"key":"dc-ultra","kind":"DC","minPowerKwExclusive":50,"pricePerKwh":0.50,"durationFee":{"ratePerMinute":0.075,"thresholdMinutes":30}},
]
GENERAL_PUBLIC = [
    {"key":"ac-slow","kind":"AC","maxPowerKw":7,"pricePerKwh":0.32,"durationFee":{"ratePerMinute":0.12,"thresholdMinutes":600}},
    {"key":"ac-normal","kind":"AC","minPowerKwExclusive":7,"maxPowerKw":22,"pricePerKwh":0.40,"durationFee":{"ratePerMinute":0.12,"thresholdMinutes":120,"activeWindow":{"start":"07:00","end":"23:00"}}},
    {"key":"dc-50","kind":"DC","minPowerKwExclusive":22,"maxPowerKw":50,"pricePerKwh":0.55,"durationFee":{"ratePerMinute":0.12,"thresholdMinutes":60}},
    {"key":"dc-ultra","kind":"DC","minPowerKwExclusive":50,"pricePerKwh":0.70,"durationFee":{"ratePerMinute":0.12,"thresholdMinutes":30}},
]
GENERAL_SUB_REF = [
    {"key":"ac-slow","kind":"AC","maxPowerKw":7,"pricePerKwh":0.23,"durationFee":{"ratePerMinute":0.075,"thresholdMinutes":600}},
    {"key":"ac-normal","kind":"AC","minPowerKwExclusive":7,"maxPowerKw":22,"pricePerKwh":0.32,"durationFee":{"ratePerMinute":0.075,"thresholdMinutes":120,"activeWindow":{"start":"07:00","end":"23:00"}}},
    {"key":"dc-50","kind":"DC","minPowerKwExclusive":22,"maxPowerKw":50,"pricePerKwh":0.40,"durationFee":{"ratePerMinute":0.075,"thresholdMinutes":60}},
    {"key":"dc-ultra","kind":"DC","minPowerKwExclusive":50,"pricePerKwh":0.55,"durationFee":{"ratePerMinute":0.075,"thresholdMinutes":30}},
]

SOURCE = {
    "dataset": "reveo-direct-tariffs-france",
    "country": "FR",
    "scope": {
        "operatorDirectOnly": True,
        "roamingIncluded": False,
        "roamingTariffsPromotedToDirect": False,
        "unverifiedTerritoriesAreRankable": False,
        "subscriberOffersRequireSelection": True,
        "rankableTerritories": ["S34","D09","D11","S12","D30","D46","S48","D65"],
        "rankableSubscriberTerritories": ["S34"],
    },
    "subscription": {
        "selectionId": "reveo-subscription",
        "monthlyFeeEur": 1.5,
        "badgePurchaseEur": 12,
        "defaultSelected": False,
        "verifiedRankableTerritories": ["S34"],
    },
    "tariffFamilies": {
        "S34_CURRENT": {"status":"rankable_public_and_subscriber","effectiveFrom":"2025-04-01","public":S34_PUBLIC,"subscriber":S34_SUB},
        "GENERAL_PUBLIC_CURRENT": {"status":"rankable_public_subscriber_reference_only","effectiveFrom":"2023-04-14","public":GENERAL_PUBLIC,"subscriberReference":GENERAL_SUB_REF},
    },
    "territories": {
        "S34":{"department":"34","tariffFamily":"S34_CURRENT","rankableProfiles":["public","subscriber"]},
        "D09":{"department":"09","tariffFamily":"GENERAL_PUBLIC_CURRENT","rankableProfiles":["public"]},
        "D11":{"department":"11","tariffFamily":"GENERAL_PUBLIC_CURRENT","rankableProfiles":["public"]},
        "S12":{"department":"12","tariffFamily":"GENERAL_PUBLIC_CURRENT","rankableProfiles":["public"]},
        "D30":{"department":"30","tariffFamily":"GENERAL_PUBLIC_CURRENT","rankableProfiles":["public"]},
        "D46":{"department":"46","tariffFamily":"GENERAL_PUBLIC_CURRENT","rankableProfiles":["public"]},
        "S48":{"department":"48","tariffFamily":"GENERAL_PUBLIC_CURRENT","rankableProfiles":["public"]},
        "D65":{"department":"65","tariffFamily":"GENERAL_PUBLIC_CURRENT","rankableProfiles":["public"]},
        "M34":{"department":"34","status":"blocked"},
        "M31":{"department":"31","status":"blocked"},
        "D66":{"department":"66","status":"blocked"},
    },
}

territories, families, subscription = mod.validate_source(SOURCE)
assert len(mod.MONTPELLIER_METRO_INSEE) == 31
assert mod.party_id_from_pdc({"idPdcItinerance": "FR*S34*E123*1"}) == "FR*S34"
assert mod.party_id_from_pdc({"idPdcItinerance": "FR*M31*E123*1"}) == "FR*M31"
assert mod.insee_code({"codeInsee":"34172"}) == "34172"
assert mod.insee_code({"codeInsee":"34-172"}) == "34172"
assert mod.territory_match({"idPdcItinerance":"FR*S34*E1*1"},{"codeInsee":"34172"}) == ("S34", "exact_ocpi_party_id_FR*S34")
assert mod.territory_match({"idPdcItinerance":"FR*RVE*E1*1"},{"codeInsee":"34172"}) == ("M34", "insee_montpellier_metro_exclusion")
assert mod.territory_match({"idPdcItinerance":"FR*RVE*E2*1"},{"codeInsee":"34300"}) == ("S34", "insee_department_34_excluding_montpellier_metro")
assert mod.territory_match({"idPdcItinerance":"FR*RVE*E3*1"},{"codeInsee":"09110"}) == ("D09", "insee_department_09")
assert mod.territory_match({"idPdcItinerance":"FR*RVE*E4*1"},{"codeInsee":"11000"}) == ("D11", "insee_department_11")
assert mod.territory_match({"idPdcItinerance":"FR*S12*E5*1"},{"codeInsee":"12000"}) == ("S12", "exact_ocpi_party_id_FR*S12")
assert mod.territory_match({"idPdcItinerance":"FR*RVE*E6*1"},{"codeInsee":"65000"}) == ("D65", "insee_department_65")
assert mod.territory_match({"idPdcItinerance":"FR*RVE*E7*1"},{"codeInsee":"66000"}) == ("D66", "insee_department_66")

assert mod.connector_kinds({"connectors":{"type2":"true"}}) == ["AC"]
assert mod.connector_kinds({"connectors":{"type2":"true","comboCcs":"true"}}) == ["AC", "DC"]
assert mod.band_for(GENERAL_PUBLIC, "AC", 3.7, False)["key"] == "ac-slow"
assert mod.band_for(GENERAL_PUBLIC, "AC", 22, False)["key"] == "ac-normal"
assert mod.band_for(GENERAL_PUBLIC, "DC", 50, False)["key"] == "dc-50"
assert mod.band_for(GENERAL_PUBLIC, "DC", 150, False)["key"] == "dc-ultra"
assert mod.band_for(GENERAL_PUBLIC, "AC", 150, False)["key"] == "ac-normal"

normal = mod.pricing_rules(mod.band_for(GENERAL_PUBLIC, "AC", 22, False))
assert [r["start"] for r in normal] == ["00:00", "07:00", "23:00"]
assert normal[1]["pricePerKwh"] == 0.40
assert normal[1]["durationPerMinute"] == 0.12
assert normal[1]["durationThresholdMinutes"] == 120
assert normal[0]["durationPerMinute"] == 0

pdc = {"pdcId":"p1","stationId":"s1","idPdcItinerance":"FR*RVE*E1*1","powerKw":22,"connectors":{"type2":"true"},"tariffNetworkId":"reveo"}
station = {"stationId":"s1","name":"Révéo","address":"","codeInsee":"09110","tariffNetworkId":"reveo"}
territory = territories["D09"]
family = families["GENERAL_PUBLIC_CURRENT"]
band = mod.band_for(family["public"], "AC", 22, False)
offer = mod.make_offer(pdc, station, "D09", territory, family, subscription, "public", "AC", band, "now", "insee_department_09")
assert offer["channel"] == "direct"
assert offer["subscriptionId"] is None
assert offer["selectors"]["territory"] == "D09"
assert offer["pricingRules"][1]["pricePerKwh"] == 0.40
assert offer["pricingRules"][1]["durationPerMinute"] == 0.12

print("Révéo canonical materializer tests OK")
