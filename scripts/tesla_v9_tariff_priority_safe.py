#!/usr/bin/env python3
"""Conservative per-station Tesla Mac/SuC charge tariff precedence.

Mac under 10 calendar days -> Mac.
Mac older >= 10 days -> SuC ONLY if verified SuC tariff observation date
is strictly newer than the best recorded Mac observation/publication date.
If dates are absent, incomparable or tariff scope diverges, retain Mac.
Morocco -> ALWAYS Mac.

Run as drop-in replacement of the pinned V9 preview's tesla_tariff_priority.
DO NOT mutate Mac inventory or fees; replace tariffs only on exact matches.
"""
from __future__ import annotations
import copy
from collections import Counter
from datetime import date, datetime
import json
from pathlib import Path
from urllib.parse import unquote, urlparse

def _date(value):
    if not isinstance(value,str) or not value.strip():
        raise ValueError(f"Invalid required date: {value!r}")
    return date.fromisoformat(value[:10])

def _optional_date(value):
    try:return _date(value)
    except (ValueError,TypeError):return None

def _stations(rows,label):
    if not isinstance(rows,list) or not rows:raise ValueError(f"Empty {label} catalogue")
    ids=[s.get("id") for s in rows]
    if any(not i for i in ids) or len(ids)!=len(set(ids)):
        raise ValueError(f"Duplicate/missing {label} station ID")
    return {s["id"]:s for s in rows}

def _tesla_key(row):
    source_id=(row.get("sucTracker") or {}).get("sourceStationId")
    if not source_id:
        path=urlparse(row.get("teslaUrl") or "").path
        marker="/supercharger/"
        source_id=unquote(path.split(marker,1)[1]).strip("/") if marker in path else row["id"]
    return (row["countryCode"],str(source_id).casefold())

def _pricing_signature(pricing):
    return json.dumps(pricing,sort_keys=True,ensure_ascii=False,separators=(',',':'))

def _source_date(row):
    return (_optional_date(row.get("sourceObservedAt"))
        or _optional_date((row.get("sucTracker") or {}).get("lastSuccessfulAt")))

def select_tariffs(mac_rows,suc_rows,country_updates,as_of_date):
    today=_date(as_of_date)
    if country_updates.get("schemaVersion")!=1 or country_updates.get("timeZone")!="Europe/Paris":
        raise ValueError("Unsupported country-update provenance contract")
    updates=country_updates.get("countries")
    if not isinstance(updates,dict):raise ValueError("Missing Mac country publication metadata")
    _stations(mac_rows,"Mac")
    _stations(suc_rows,"SuC")
    by_key={}
    ambiguous_keys=set()
    for s in suc_rows:
        k=_tesla_key(s)
        if k in by_key:ambiguous_keys.add(k)
        by_key[k]=s
    selected=copy.deepcopy(mac_rows)
    decisions={}
    for st in selected:
        cc=st.get("countryCode")
        if not isinstance(cc,str) or len(cc)!=2:raise ValueError("Invalid Mac country")
        update=updates.get(cc) or {}
        published=_optional_date(update.get("updatedOn"))
        observed=_optional_date(st.get("sourceObservedAt"))
        # lastUpdated was proven stale for October-updated countries. It is
        # acceptable only as a LOWER-TRUST historical fallback where no
        # country batch or verified collection timestamp exists (e.g. DE).
        legacy=_optional_date(st.get("lastUpdated")) if not (observed or published) else None
        mac_date=observed or published or legacy
        evidence="station_observed" if observed else "mac_country_published" if published else "legacy_unverified" if legacy else "unavailable"
        age=(today-mac_date).days if mac_date else None
        if age is not None and age<0:raise ValueError("Future Tesla observation/publication date")
        if cc not in decisions:
            decisions[cc]={
                "macUpdatedOn":published.isoformat() if published else None,
                "ageCalendarDays":(today-published).days if published else None,
                "preferredTariffSource":"Mac" if cc=="MA" or (published and 0<=(today-published).days<10) else "source-comparison",
                "stations":0,"macTariffs":0,"sucTariffs":0,
                "missingSucFallbacks":0,"sucNotNewerFallbacks":0,
                "unverifiedMacDateFallbacks":0,"ambiguousMatchFallbacks":0,
                "multiConfigurationFallbacks":0,
            }
        info=decisions[cc]
        info["stations"]+=1
        if cc=="MA" or (age is not None and age<10):
            info["macTariffs"]+=1
            continue
        key=_tesla_key(st)
        if key in ambiguous_keys:
            info["macTariffs"]+=1
            info["ambiguousMatchFallbacks"]+=1
            continue
        ref=by_key.get(key)
        if not ref or ref.get("countryCode")!=cc:
            info["macTariffs"]+=1
            info["missingSucFallbacks"]+=1
            continue
        price=ref.get("pricing")
        if not isinstance(price,dict) or not price.get("rules"):
            info["macTariffs"]+=1
            info["missingSucFallbacks"]+=1
            continue
        suc_date=_source_date(ref)
        if not mac_date or not suc_date:
            info["macTariffs"]+=1
            info["unverifiedMacDateFallbacks"]+=1
            continue
        if suc_date<=mac_date:
            info["macTariffs"]+=1
            info["sucNotNewerFallbacks"]+=1
            continue
        # Avoid converting a heterogeneous per-configuration Mac price into
        # a homogeneous site-wide SuC price (SuC lacks per-stall breakdowns).
        all_cfg=[c.get("pricing") or st.get("pricing") for c in st.get("chargingConfigurations") or []]
        if len({_pricing_signature(v) for v in all_cfg})>1:
            info["macTariffs"]+=1
            info["multiConfigurationFallbacks"]+=1
            continue
        st["pricing"]=copy.deepcopy(price)
        for cfg in st.get("chargingConfigurations") or []:
            cfg["pricing"]=copy.deepcopy(price)
        info["sucTariffs"]+=1
    for cc,d in decisions.items():
        if cc=="MA" or d["sucTariffs"]==0:
            d["preferredTariffSource"]="Mac"
        elif d["sucTariffs"]==d["stations"]:
            d["preferredTariffSource"]="SuC Tracker"
        else:
            d["preferredTariffSource"]="Mixed by verified age"
    report={
        "schemaVersion":2,
        "asOfDate":as_of_date,
        "policy":"MA Mac; Mac <10 days; SuC only if STRICTLY newer than Mac observation/publication",
        "dateProvenancePriority":["Mac sourceObservedAt","Mac country publication date","legacy lastUpdated ONLY when no other evidence"],
        "sucDateSource":"sourceObservedAt or sucTracker.lastSuccessfulAt; snapshot generation is not observation",
        "noSourceObservationBehavior":"retain Mac; never presume SuC freshness from snapshot-generation timestamp",
        "countries":decisions,
    }
    return selected,report

def build_selected_catalogue(mac_path,suc_path,updates_path,as_of_date,output_path,report_path):
    def read(p):return json.loads(Path(p).read_text(encoding="utf8"))
    selected,report=select_tariffs(read(mac_path),read(suc_path),read(updates_path),as_of_date)
    for path,data in ((output_path,selected),(report_path,report)):
        dest=Path(path)
        dest.parent.mkdir(parents=True,exist_ok=True)
        dest.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    return report
