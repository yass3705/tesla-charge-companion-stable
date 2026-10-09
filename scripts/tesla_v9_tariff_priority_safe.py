#!/usr/bin/env python3
"""Tesla Mac / SuC priority selected PER COUNTRY, not per charging station.

All Mac stations from one country share its last Mac batch date; all SuC
stations share a conservative source-country observation date. Only check
individual station identities to deal with missing/ambiguous counterparts.

Mac < 10 calendar days -> Mac for whole country.
Mac >= 10 days -> SuC ONLY when its country collection is newer.
Morocco -> always Mac. Unmatched SuC-only sites are audit exceptions;
never infer public access or insert an unverified site into production.
Preserve Mac identity, stall configurations and ancillary fees.
"""
from __future__ import annotations
import copy
from collections import defaultdict
from datetime import date
import json
from pathlib import Path
from urllib.parse import unquote, urlparse

def _date(value):
    if not isinstance(value,str) or not value.strip():
        raise ValueError(f"Invalid date {value!r}")
    return date.fromisoformat(value[:10])

def _optional_date(value):
    try:return _date(value)
    except (ValueError,TypeError):return None

def _stations(rows,label):
    if not isinstance(rows,list) or not rows:raise ValueError(f"Empty {label} catalogue")
    ids=[s.get("id") for s in rows]
    if any(not x for x in ids) or len(ids)!=len(set(ids)):
        raise ValueError(f"Missing/duplicate {label} station ID")
    return {s["id"]:s for s in rows}

def _tesla_key(row):
    source_id=(row.get("sucTracker") or {}).get("sourceStationId")
    if not source_id:
        path=urlparse(row.get("teslaUrl") or "").path
        marker="/supercharger/"
        source_id=unquote(path.split(marker,1)[1]).strip("/") if marker in path else row["id"]
    return (row["countryCode"],str(source_id).casefold())

def _price_signature(pricing):
    return json.dumps(pricing,sort_keys=True,ensure_ascii=False,separators=(',',':'))

def _country_dates(mac,country_meta):
    # Country update is the authority, never station lastUpdated when a batch exists.
    publication=_optional_date((country_meta or {}).get("updatedOn"))
    if publication:return publication,"mac_country_publication"
    # Before a country is batch-updated (e.g. DE), only historical metadata
    # exists. Use the LATEST historical date, once for the country, not
    # different ages and source selection for every charger.
    fallback=[_optional_date(x.get("lastUpdated")) for x in mac]
    known=[d for d in fallback if d is not None]
    return (max(known),"legacy_country_date_unverified") if known else (None,"mac_country_date_missing")

def _suc_country_date(suc):
    # SuC has an observation timestamp on each record because the source
    # converter copies the same country-batch date to all stations. Assess it
    # once for the country. For heterogeneous source dates, take the OLDEST:
    # only mark the whole country newer if all records support that statement.
    dates=[_optional_date(x.get("sourceObservedAt") or
           (x.get("sucTracker") or {}).get("lastSuccessfulAt")) for x in suc]
    good=[d for d in dates if d is not None]
    if not dates or len(good)!=len(dates):
        return None,"suc_country_date_incomplete",sorted({str(d) for d in good})
    return min(good),"suc_country_min_verified_observation",sorted({str(d) for d in good})

def _country_choice(cc,today,mac_date,suc_date):
    if cc=="MA":return "Mac","morocco_mac_only"
    if mac_date and (today-mac_date).days<0:
        raise ValueError(f"Future Mac country publication {cc}: {mac_date}")
    if suc_date and (today-suc_date).days<0:
        raise ValueError(f"Future SuC country observation {cc}: {suc_date}")
    if mac_date and (today-mac_date).days<10:
        return "Mac","mac_country_updated_within_10_days"
    if mac_date and suc_date and suc_date>mac_date:
        return "SuC Tracker","suc_country_observation_strictly_newer_than_mac_country"
    return "Mac","suc_not_strictly_newer_or_country_dates_incomplete"

def select_tariffs(mac_rows,suc_rows,country_updates,as_of_date):
    today=_date(as_of_date)
    if country_updates.get("schemaVersion")!=1 or country_updates.get("timeZone")!="Europe/Paris":
        raise ValueError("Invalid Mac country update metadata")
    updates=country_updates.get("countries")
    if not isinstance(updates,dict):raise ValueError("Missing country update metadata")
    _stations(mac_rows,"Mac")
    _stations(suc_rows,"SuC")
    by_country_mac=defaultdict(list)
    by_country_suc=defaultdict(list)
    for m in mac_rows:by_country_mac[m["countryCode"]].append(m)
    for s in suc_rows:by_country_suc[s["countryCode"]].append(s)

    selected=copy.deepcopy(mac_rows)
    selected_by_id={s["id"]:s for s in selected}
    decisions={}
    for cc in sorted(set(by_country_mac)|set(by_country_suc)):
        mac=by_country_mac.get(cc,[])
        suc=by_country_suc.get(cc,[])
        mac_date,mac_date_source=_country_dates(mac,updates.get(cc))
        suc_date,suc_date_source,suc_dates=_suc_country_date(suc)
        preferred,why=_country_choice(cc,today,mac_date,suc_date)
        lookups=defaultdict(list)
        mac_keys=defaultdict(list)
        for s in suc:lookups[_tesla_key(s)].append(s)
        for m in mac:mac_keys[_tesla_key(m)].append(m)
        exceptions=[]
        info={
            "macUpdatedOn":mac_date.isoformat() if mac_date else None,
            "macCountryDateEvidence":mac_date_source,
            "sucCountryObservedOn":suc_date.isoformat() if suc_date else None,
            "sucCountryDateEvidence":suc_date_source,
            "sucCountryDistinctObservedDates":suc_dates,
            "ageCalendarDays":(today-mac_date).days if mac_date else None,
            "preferredTariffSource":preferred,
            "countryDecisionReason":why,
            "stations":len(mac),"sucStations":len(suc),
            "macTariffs":0,"sucTariffs":0,
            "missingSucFallbacks":0,"sucOnlyStations":0,"onlyMacStations":0,
            "ambiguousMatchFallbacks":0,"unpricedSucFallbacks":0,
            "multiConfigurationFallbacks":0,
            "sourceExceptionRows":exceptions,
            "selectionGranularity":"country_for_freshness; station_only_for_presence_and_exact_tariff_mapping",
        }
        # Per-station lookup is strictly an existence/identity check, never
        # a freshness comparison or a second source-priority decision.
        for original in mac:
            row=selected_by_id[original["id"]]
            key=_tesla_key(original)
            matches=lookups.get(key,[])
            if not matches:
                info["missingSucFallbacks"]+=1
                info["onlyMacStations"]+=1
                exceptions.append({"type":"only_mac","macStationId":row["id"],"sucStationId":None})
            if preferred=="Mac":
                info["macTariffs"]+=1
                continue
            if len(matches)!=1 or len(mac_keys[key])!=1:
                info["macTariffs"]+=1
                if matches:info["ambiguousMatchFallbacks"]+=1
                if matches:exceptions.append({"type":"ambiguous_match","macStationId":row["id"],
                                              "sucStationIds":[s.get("id") for s in matches]})
                continue
            source=matches[0]
            price=source.get("pricing")
            if not isinstance(price,dict) or not price.get("rules"):
                info["macTariffs"]+=1
                info["unpricedSucFallbacks"]+=1
                exceptions.append({"type":"suc_unpriced","macStationId":row["id"],"sucStationId":source.get("id")})
                continue
            # Do not collapse genuinely different configurations into
            # a site-wide tariff. This is an explicit exception, not a
            # per-station source-age decision.
            configurations=[c.get("pricing") or row.get("pricing")
                            for c in row.get("chargingConfigurations") or []]
            if len({_price_signature(p) for p in configurations})>1:
                info["macTariffs"]+=1
                info["multiConfigurationFallbacks"]+=1
                exceptions.append({"type":"mac_different_configuration_tariffs",
                                   "macStationId":row["id"],"sucStationId":source.get("id")})
                continue
            row["pricing"]=copy.deepcopy(price)
            for cfg in row.get("chargingConfigurations") or []:
                cfg["pricing"]=copy.deepcopy(price)
            info["sucTariffs"]+=1
        # SuC-only sites have no verified public-access Mac reference, and
        # SuC can explicitly mark access unknown. Record and investigate them
        # without automatically inventing public access or rate eligibility.
        for key,sites in sorted(lookups.items()):
            if key not in mac_keys:
                info["sucOnlyStations"]+=len(sites)
                for source in sites:
                    exceptions.append({"type":"only_suc_unverified_access",
                        "macStationId":None,"sucStationId":source.get("id"),
                        "sucPricingAvailable":bool((source.get("pricing") or {}).get("rules")),
                        "sucAccessSource":(source.get("sucTracker") or {}).get("accessSource") or "unknown",
                        "requiresAccessVerificationBeforePublication":True})
        decisions[cc]=info
    report={
        "schemaVersion":3,
        "asOfDate":as_of_date,
        "policy":"Source freshness compared ONCE PER COUNTRY. Mac <10d; then SuC only if entire SuC country observation newer. MA always Mac.",
        "countryDateSourcePriority":"Mac country batch publication; fallback historic country date only if no batch",
        "sucCountryDateSource":"conservative minimum country observation; fail closed on missing observation timestamps",
        "exceptionPolicy":"Check station IDs ONLY for one-source-only, unmatched, unpriced, or ambiguous power tiers; SuC-only access must be verified before publication",
        "countries":decisions,
        "summary":{
          "macStations":len(mac_rows),"sucStations":len(suc_rows),
          "countries":len(decisions),
          "onlyMacStations":sum(v["onlyMacStations"] for v in decisions.values()),
          "onlySuCStations":sum(v["sucOnlyStations"] for v in decisions.values()),
          "unpricedSuC":sum(v["unpricedSucFallbacks"] for v in decisions.values()),
          "actualSuCTariffsApplied":sum(v["sucTariffs"] for v in decisions.values()),
        }
    }
    return selected,report

def build_selected_catalogue(mac_path,suc_path,updates_path,as_of_date,output_path,report_path):
    def read(p):return json.loads(Path(p).read_text(encoding="utf8"))
    selected,report=select_tariffs(read(mac_path),read(suc_path),read(updates_path),as_of_date)
    for path,value in ((output_path,selected),(report_path,report)):
        dest=Path(path)
        dest.parent.mkdir(parents=True,exist_ok=True)
        dest.write_text(json.dumps(value,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
    return report
