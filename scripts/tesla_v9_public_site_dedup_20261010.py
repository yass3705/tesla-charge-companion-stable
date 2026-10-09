#!/usr/bin/env python3
"""Exclude CONFIRMED duplicate Tesla site listings from the PUBLIC V9 snapshot.

Raw Mac/SuC sources remain unchanged and auditable. No prices are copied to
unpriced aliases. Fail closed if an excluded listing becomes priced or gains
power; that requires a fresh review.
"""
from __future__ import annotations
import argparse
import datetime as dt
import json
from pathlib import Path

ALIAS="tesla-dartford-uk-tesla-service-centre"
CANONICAL="tesla-dartfordservicecentresuperchargerq122-united_kingdom"
SECOND="tesla-dartford-uk"
EVIDENCE=[
    "https://www.tesla.com/findus/location/supercharger/30168",
    "https://www.tesla.com/findus/location/supercharger/dartfordservicecentresuperchargerq122",
]
def rules(row):
    candidates=[row.get("pricing") or {}]+[(x.get("pricing") or {}) for x in row.get("chargingConfigurations") or []]
    return [rule for p in candidates for rule in (p.get("rules") or [])]

def power(row):
    return max([float(x.get("powerKw") or 0) for x in row.get("chargingConfigurations") or []]+[0])

def remove_dartford_duplicate(rows):
    by_id={x.get("id"):x for x in rows}
    if len(by_id)!=len(rows):
        raise ValueError("Tesla duplicate station IDs in source")
    alias=by_id.get(ALIAS)
    primary=by_id.get(CANONICAL)
    bluewater=by_id.get(SECOND)
    if not alias or not primary or not bluewater:
        raise ValueError("Dartford three-source identity has changed; review required")
    if any(x.get("countryCode")!="GB" for x in (alias,primary,bluewater)):
        raise ValueError("Unexpected Dartford country")
    if rules(alias) or power(alias)>0:
        raise ValueError("Dartford 30168 now has an actual price/power: manual re-verification required")
    if not rules(primary) or power(primary)!=250:
        raise ValueError("Public Dartford 250kW site changed: review required")
    if not rules(bluewater) or power(bluewater)!=130:
        raise ValueError("Public Dartford Bluewater 130kW site changed: review required")
    if not str(alias.get("teslaUrl") or "").rstrip("/").endswith("/30168"):
        raise ValueError("Unpriced Dartford alias no longer uses Tesla ID 30168")
    if not str(primary.get("teslaUrl") or "").rstrip("/").endswith("/dartfordservicecentresuperchargerq122"):
        raise ValueError("Public Dartford Centre canonical Tesla slug changed")
    new=[row for row in rows if row["id"]!=ALIAS]
    if len(new)!=len(rows)-1:
        raise ValueError("Unexpected Dartford duplicate removal count")
    return new,{
      "aliasId":ALIAS,"canonicalId":CANONICAL,
      "scope":"V9 public station display only",
      "action":"exclude duplicate unpriced Tesla Service Centre ID 30168; retain canonical 250kW",
      "publicStationIds":[SECOND,CANONICAL],
      "explanation":"Tesla officially lists same Unit 2 Capstan Court address and same 12 public 24/7 stalls under two slugs; Tesla app shows only 250kW Centre and 130kW Bluewater.",
      "doNotInferPrivateGarage":True,
      "doNotCopyPricingBetweenSites":True,
      "teslaOfficialEvidence":EVIDENCE
    }

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--preview",type=Path,required=True)
    opts=p.parse_args()
    runtime=opts.preview/"runtime/data/tesla_stations.json"
    top=opts.preview/"data/tesla_stations.json"
    if not runtime.exists() or not top.exists():
        raise SystemExit("V9 runtime Tesla files missing")
    rows=json.loads(runtime.read_text())
    mirror=json.loads(top.read_text())
    if rows!=mirror:
        raise SystemExit("V9 root and runtime Tesla files already diverge")
    result,evidence=remove_dartford_duplicate(rows)
    for filepath in (runtime,top):
        filepath.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    meta=opts.preview/"snapshot-inputs/TESLA/public-site-aliases.json"
    meta.parent.mkdir(parents=True,exist_ok=True)
    meta.write_text(json.dumps({
       "schemaVersion":1,"generatedAt":dt.datetime.now(dt.timezone.utc).isoformat(),
       "sourceCount":len(rows),"publishedCount":len(result),
       "aliases":[evidence]
    },ensure_ascii=False,indent=2)+"\n",encoding="utf8")
    print("TESLA_DARTFORD_DEDUP_VALIDATED="+json.dumps({
      "source":len(rows),"published":len(result),
      "removedAlias":ALIAS,"kept":[SECOND,CANONICAL]
    }))
if __name__=="__main__":
    main()
