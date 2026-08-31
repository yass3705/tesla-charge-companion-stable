#!/usr/bin/env python3
from __future__ import annotations
import argparse, datetime as dt, gzip, json
from collections import Counter
from pathlib import Path


def clean(v): return str(v or "").strip()
def num(v):
    try: return float(v)
    except (TypeError, ValueError): return None

def truthy(v):
    return v is True or clean(v).lower() in {"1","true","yes","oui","vrai","x"}

def load(path):
    p=Path(path)
    if p.suffix==".gz":
        with gzip.open(p,"rt",encoding="utf-8") as f: return json.load(f)
    return json.loads(p.read_text(encoding="utf-8"))

def dump(path,obj):
    p=Path(path); p.parent.mkdir(parents=True,exist_ok=True)
    if p.suffix==".gz":
        with gzip.open(p,"wt",encoding="utf-8",compresslevel=9) as f: json.dump(obj,f,ensure_ascii=False,separators=(",",":"))
    else: p.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")

def validate_source(d):
    if d.get("dataset")!="allego-direct-tariffs-france" or d.get("networkId")!="allego" or d.get("country")!="FR": raise ValueError("unexpected Allego source")
    s=d.get("scope") or {}
    for k in ("directNetworkOnly","physicalInventoryFromIrveOnly","roamingMspTariffsRemainSeparate"):
        if s.get(k) is not True: raise ValueError(f"invalid Allego scope {k}")
    offers={o.get("selectors",{}).get("siteClass"):o for o in d.get("offers") or []}
    if set(offers)!={"regular","fast","ultra"}: raise ValueError("missing Allego tariff class")
    return offers

def dc_connector(pdc):
    c=pdc.get("connectors") or {}
    return truthy(c.get("comboCcs")) or truthy(c.get("chademo"))

def classify(pdc):
    p=num(pdc.get("powerKw"))
    if p is None or p<=0: return None,"missing_power"
    if p<=22.5: return "regular",None
    if not dc_connector(pdc): return None,"fast_or_ultra_without_dc_connector_evidence"
    if p<=50: return "fast",None
    return "ultra",None

def norm_rule(r):
    out=dict(r or {})
    defaults={"scope":"allDay","start":"00:00","end":"24:00","days":None,"currency":"EUR","pricePerKwh":0,"chargePerMinute":0,"connectionFee":0,"durationPerMinute":0,"durationThresholdMinutes":0,"occupancyPerMinute":0,"occupancyThresholdMinutes":0,"occupancyCap":0,"parkingPerMinute":0}
    for k,v in defaults.items(): out.setdefault(k,v)
    return out

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--source",default="data/allego_direct_tariffs_france_v1.json"); ap.add_argument("--canonical-dir",default="build/france_irve_identity"); ap.add_argument("--out-dir",default="build/france_irve_offers"); a=ap.parse_args()
    src=load(a.source); by_class=validate_source(src); cdir=Path(a.canonical_dir)
    stations=load(cdir/"stations.json.gz"); pdcs=load(cdir/"charge_points.json.gz")
    st={clean(x.get("stationId")):x for x in stations if x.get("stationId")}; allego=[p for p in pdcs if p.get("tariffNetworkId")=="allego"]
    station_ids={clean(p.get("stationId")) for p in allego}; now=dt.datetime.now(dt.timezone.utc).isoformat(); out=[]; unresolved=[]; counters=Counter(); covered=set(); rankable=set()
    for p in allego:
        pid=clean(p.get("pdcId")); sid=clean(p.get("stationId")); s=st.get(sid)
        if not s or s.get("tariffNetworkId")!="allego": raise AssertionError(f"Allego scope leak {pid}")
        cls,reason=classify(p)
        if not cls:
            counters[reason]+=1
            if len(unresolved)<100: unresolved.append({"pdcId":pid,"stationId":sid,"powerKw":p.get("powerKw"),"reason":reason})
            continue
        so=by_class[cls]; is_rankable=bool(so.get("rankable")); blocked=list(so.get("blockedReasons") or [])
        item={"offerId":f"{so.get('id')}:{pid}","physicalOperatorId":p.get("physicalOperatorId") or s.get("physicalOperatorId"),"tariffNetworkId":"allego","provider":so.get("provider") or "Allego Direct","channel":"direct","sourceMode":"network_rule","sourceStationId":None,"sourceEvseId":None,"canonicalStationId":sid,"canonicalPdcId":pid,"matchMethod":"network_scope_power_class","matchDistanceMeters":None,"selectors":{"siteClass":cls,"powerKw":p.get("powerKw")},"kind":"DC" if cls in {"fast","ultra"} else None,"minPowerKw":None,"maxPowerKw":None,"pricingRules":[norm_rule(r) for r in so.get("pricingRules") or []],"subscriptionId":None,"validFrom":None,"validTo":None,"rankable":is_rankable,"blockedReasons":blocked,"sourceUrl":src.get("source"),"sourceUpdatedAt":src.get("verifiedAt"),"normalizedAt":now}
        out.append(item); covered.add(pid); counters[f"class_{cls}"]+=1; counters["rankable" if is_rankable else "reference"]+=1
        if is_rankable: rankable.add(pid)
    out.sort(key=lambda r:(r["canonicalStationId"],r["canonicalPdcId"],r["offerId"]))
    if any(r["canonicalStationId"] not in station_ids or r["tariffNetworkId"]!="allego" for r in out): raise AssertionError("Allego output escaped network")
    report={"schemaVersion":"1.1.0","dataset":"france-allego-canonical-direct-audit","productionReady":False,"summary":{"canonicalAllegoStationCount":len(station_ids),"canonicalAllegoPdcCount":len(allego),"materializedOfferCount":len(out),"rankableOfferCount":sum(1 for r in out if r.get("rankable")),"referenceOfferCount":sum(1 for r in out if not r.get("rankable")),"coveredPdcCount":len(covered),"rankableCoveredPdcCount":len(rankable),"unresolvedPdcCount":len(allego)-len(covered),"physicalInventoryMutationCount":0,"counters":dict(counters)},"unresolvedExamples":unresolved}
    od=Path(a.out_dir); dump(od/"allego_pdc_offers_contract_v1_1.json.gz",out); dump(od/"allego_subscriptions_contract_v1_1.json",{"schemaVersion":"1.1.0","networkId":"allego","subscriptions":src.get("subscriptions") or []}); dump(od/"allego_materialization_report.json",report); print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=="__main__": main()
