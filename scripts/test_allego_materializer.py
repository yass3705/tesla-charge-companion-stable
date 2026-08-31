#!/usr/bin/env python3
from __future__ import annotations
import gzip, json, subprocess, sys, tempfile
from pathlib import Path

def dump_gz(path,obj):
    with gzip.open(path,"wt",encoding="utf-8") as f: json.dump(obj,f)

def main():
    root=Path(__file__).resolve().parents[1]; script=root/"scripts/materialize_france_allego_offers.py"; source=root/"data/allego_direct_tariffs_france_v1.json"
    stations=[{"stationId":"A1","tariffNetworkId":"allego","physicalOperatorId":"allego"},{"stationId":"O1","tariffNetworkId":"other","physicalOperatorId":"other"}]
    pdcs=[
      {"pdcId":"A1-R","stationId":"A1","tariffNetworkId":"allego","physicalOperatorId":"allego","powerKw":22,"connectors":{"type2":True}},
      {"pdcId":"A1-F","stationId":"A1","tariffNetworkId":"allego","physicalOperatorId":"allego","powerKw":50,"connectors":{"comboCcs":True}},
      {"pdcId":"A1-U","stationId":"A1","tariffNetworkId":"allego","physicalOperatorId":"allego","powerKw":150,"connectors":{"comboCcs":True}},
      {"pdcId":"A1-X","stationId":"A1","tariffNetworkId":"allego","physicalOperatorId":"allego","powerKw":150,"connectors":{"type2":True}},
      {"pdcId":"O1-F","stationId":"O1","tariffNetworkId":"other","physicalOperatorId":"other","powerKw":50,"connectors":{"comboCcs":True}}
    ]
    with tempfile.TemporaryDirectory() as t:
        t=Path(t); c=t/"canonical"; o=t/"out"; c.mkdir(); dump_gz(c/"stations.json.gz",stations); dump_gz(c/"charge_points.json.gz",pdcs)
        subprocess.run([sys.executable,str(script),"--source",str(source),"--canonical-dir",str(c),"--out-dir",str(o)],check=True,capture_output=True,text=True)
        offers=json.load(gzip.open(o/"allego_pdc_offers_contract_v1_1.json.gz","rt",encoding="utf-8")); report=json.load(open(o/"allego_materialization_report.json",encoding="utf-8")); subs=json.load(open(o/"allego_subscriptions_contract_v1_1.json",encoding="utf-8"))
        by={r["canonicalPdcId"]:r for r in offers}; assert set(by)=={"A1-R","A1-F","A1-U"}
        assert by["A1-R"]["rankable"] is False and by["A1-R"]["pricingRules"][0]["pricePerKwh"]==0.39
        assert by["A1-F"]["rankable"] is True and by["A1-F"]["pricingRules"][0]["pricePerKwh"]==0.49
        assert by["A1-U"]["rankable"] is True and by["A1-U"]["pricingRules"][0]["pricePerKwh"]==0.59
        ur=by["A1-U"]["pricingRules"][0]; assert ur["occupancyPerMinute"]==0.248 and ur["occupancyThresholdMinutes"]==45 and ur["occupancyTrigger"]=="after_charging_stops"
        s=report["summary"]; assert s["canonicalAllegoPdcCount"]==4 and s["coveredPdcCount"]==3 and s["rankableCoveredPdcCount"]==2 and s["unresolvedPdcCount"]==1 and s["physicalInventoryMutationCount"]==0
        sub=subs["subscriptions"][0]; assert sub["id"]=="allego-plus" and sub["monthlyFeeEur"]==9.99 and sub["rankableWhenSelected"] is False
        benefits={(x["country"],x["discountPercent"]) for x in sub["partnerBenefits"]}; assert benefits=={("FR",30),("ES",38),("IT",28)}
    print("Allego canonical materializer tests OK")
if __name__=="__main__": main()
