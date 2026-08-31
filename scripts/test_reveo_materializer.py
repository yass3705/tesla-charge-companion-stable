#!/usr/bin/env python3
import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).with_name("materialize_france_reveo_offers.py")
spec = importlib.util.spec_from_file_location("reveo_materializer", SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

SOURCE = {
    "dataset": "reveo-direct-tariffs-france",
    "country": "FR",
    "scope": {
        "operatorDirectOnly": True,
        "roamingIncluded": False,
        "roamingTariffsPromotedToDirect": False,
        "unverifiedTerritoriesAreRankable": False,
        "subscriberOffersRequireSelection": True,
        "rankableTerritories": ["S34"],
    },
    "subscription": {
        "selectionId": "reveo-subscription",
        "monthlyFeeEur": 1.5,
        "badgePurchaseEur": 12,
        "defaultSelected": False,
    },
    "territories": {
        "S34": {
            "partyId": "FR*S34",
            "status": "rankable_public_and_subscriber",
            "effectiveFrom": "2025-04-01",
            "public": [
                {"key":"ac-long","kind":"AC","maxPowerKw":22,"longDurationOnly":True,"pricePerKwh":0.40,"durationFee":{"ratePerMinute":0.10,"thresholdMinutes":600}},
                {"key":"ac-normal","kind":"AC","excludeLongDuration":True,"pricePerKwh":0.40,"durationFee":{"ratePerMinute":0.10,"thresholdMinutes":180,"activeWindow":{"start":"07:00","end":"22:00"}}},
                {"key":"dc-24","kind":"DC","maxPowerKw":24,"pricePerKwh":0.46,"durationFee":{"ratePerMinute":0.10,"thresholdMinutes":90,"activeWindow":{"start":"07:00","end":"22:00"}}},
                {"key":"dc-50","kind":"DC","minPowerKwExclusive":24,"maxPowerKw":50,"pricePerKwh":0.50,"durationFee":{"ratePerMinute":0.12,"thresholdMinutes":60,"activeWindow":{"start":"07:00","end":"22:00"}}},
                {"key":"dc-ultra","kind":"DC","minPowerKwExclusive":50,"pricePerKwh":0.59,"durationFee":{"ratePerMinute":0.12,"thresholdMinutes":30}},
            ],
            "subscriber": [
                {"key":"ac-long","kind":"AC","maxPowerKw":22,"longDurationOnly":True,"pricePerKwh":0.32,"durationFee":{"ratePerMinute":0.075,"thresholdMinutes":600}},
                {"key":"ac-normal","kind":"AC","excludeLongDuration":True,"pricePerKwh":0.32,"durationFee":{"ratePerMinute":0.075,"thresholdMinutes":180,"activeWindow":{"start":"07:00","end":"22:00"}}},
                {"key":"dc-24","kind":"DC","maxPowerKw":24,"pricePerKwh":0.36,"durationFee":{"ratePerMinute":0.075,"thresholdMinutes":90,"activeWindow":{"start":"07:00","end":"22:00"}}},
                {"key":"dc-50","kind":"DC","minPowerKwExclusive":24,"maxPowerKw":50,"pricePerKwh":0.40,"durationFee":{"ratePerMinute":0.075,"thresholdMinutes":60,"activeWindow":{"start":"07:00","end":"22:00"}}},
                {"key":"dc-ultra","kind":"DC","minPowerKwExclusive":50,"pricePerKwh":0.50,"durationFee":{"ratePerMinute":0.075,"thresholdMinutes":30}},
            ],
        }
    },
}

territory, subscription = mod.validate_source(SOURCE)
assert len(mod.MONTPELLIER_METRO_INSEE) == 31
assert mod.party_id_from_pdc({"idPdcItinerance": "FR*S34*E123*1"}) == "FR*S34"
assert mod.party_id_from_pdc({"idPdcItinerance": "FR*M31*E123*1"}) == "FR*M31"
assert mod.insee_code({"codeInsee":"34172"}) == "34172"
assert mod.insee_code({"codeInsee":"34-172"}) == "34172"
assert mod.insee_code({"codeInsee":""}) == ""
assert mod.territory_match({"idPdcItinerance":"FR*S34*E1*1"},{"codeInsee":"34172"}) == ("S34", "exact_ocpi_party_id_FR*S34")
assert mod.territory_match({"idPdcItinerance":"FR*RVE*E1*1"},{"codeInsee":"34172"}) == ("M34", "insee_montpellier_metro_exclusion")
assert mod.territory_match({"idPdcItinerance":"FR*RVE*E2*1"},{"codeInsee":"34300"}) == ("S34", "insee_department_34_excluding_montpellier_metro")
assert mod.territory_match({"idPdcItinerance":"FR*RVE*E3*1"},{"codeInsee":"31000"}) == ("", "")
assert mod.explicit_long_duration({"name": "Révéo - Longue utilisation", "address": ""}) is True
assert mod.explicit_long_duration({"name": "Révéo centre-ville", "address": ""}) is False

pdc_ac = {"pdcId":"p1","stationId":"s1","idPdcItinerance":"FR*S34*E1*1","powerKw":22,"connectors":{"type2":"true"},"tariffNetworkId":"reveo"}
pdc_dc50 = {"pdcId":"p2","stationId":"s2","idPdcItinerance":"FR*RVE*E2*1","powerKw":50,"connectors":{"comboCcs":"true"},"tariffNetworkId":"reveo"}
pdc_ultra_both = {"pdcId":"p3","stationId":"s3","idPdcItinerance":"FR*S34*E3*1","powerKw":150,"connectors":{"type2":"true","comboCcs":"true"},"tariffNetworkId":"reveo"}

assert mod.connector_kinds(pdc_ac) == ["AC"]
assert mod.connector_kinds(pdc_ultra_both) == ["AC", "DC"]
assert mod.band_for(territory["public"], "AC", 22, False)["key"] == "ac-normal"
assert mod.band_for(territory["public"], "AC", 22, True)["key"] == "ac-long"
assert mod.band_for(territory["public"], "DC", 50, False)["key"] == "dc-50"
assert mod.band_for(territory["public"], "DC", 150, False)["key"] == "dc-ultra"
# PAN nominal power may reflect the DC side; AC stays priced with the AC grid.
assert mod.band_for(territory["public"], "AC", 150, False)["key"] == "ac-normal"

normal = mod.pricing_rules(mod.band_for(territory["public"], "AC", 22, False))
assert [r["start"] for r in normal] == ["00:00", "07:00", "22:00"]
assert normal[1]["pricePerKwh"] == 0.40
assert normal[1]["durationPerMinute"] == 0.10
assert normal[1]["durationThresholdMinutes"] == 180
assert normal[0]["durationPerMinute"] == 0

station = {"stationId":"s2","name":"Révéo","address":"","codeInsee":"34300","tariffNetworkId":"reveo"}
band = mod.band_for(territory["subscriber"], "DC", 50, False)
offer = mod.make_offer(
    pdc_dc50, station, territory, subscription, "subscriber", "DC", band, "now",
    "insee_department_34_excluding_montpellier_metro"
)
assert offer["channel"] == "subscription"
assert offer["subscriptionId"] == "reveo-subscription"
assert offer["pricingRules"][1]["pricePerKwh"] == 0.40
assert offer["pricingRules"][1]["durationPerMinute"] == 0.075
assert offer["matchMethod"] == "insee_department_34_excluding_montpellier_metro"
assert offer["selectors"]["codeInsee"] == "34300"

print("Révéo canonical materializer tests OK")
