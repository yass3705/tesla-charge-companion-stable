#!/usr/bin/env python3
import gzip, json, math, os, re, urllib.request, urllib.error
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

NATIONAL_URL="https://data.geo.admin.ch/ch.bfe.ladestellen-elektromobilitaet/data/oicp/ch.bfe.ladestellen-elektromobilitaet.json"
LAB_RAW="https://raw.githubusercontent.com/yass3705/tesla-charge-companion-data-lab/main/"
OUT_DIR=Path("v9-production-runtime/data/v9/switzerland-static")
OFFERS_OUT=Path("v9-production-runtime/data/v9/switzerland-offers.json")
REPORT_OUT=Path("v9-production-runtime/data/v9/switzerland-build-report.json")
UA={"User-Agent":"Tesla-Charge-Companion-V9-Switzerland/1.0","Accept":"application/json"}
EVSE_META={}
NATIONAL_RECORDS=[]
GOFAST_AUDIT={"nationalEvse":0,"matchedByName":0,"matchedByCoordinate":0,"unmatched":0,"nearestDistances":[]}

SOURCES=[
 "data/switzerland/migrol-official-direct-tariffs.json",
 "data/switzerland/shell-evpass-official-direct-tariffs.json",
 "data/switzerland/cci-move-cpo-tariffs-national.json",
 "data/switzerland/energie360-direct-tariffs.json",
 "data/switzerland/powerup-monta-direct-tariffs.json",
 "data/switzerland/iwb-direct-tariffs-second-pass.json",
 "data/switzerland/iwb-official-basel-overlay.json",
 "data/switzerland/saascharge-official-direct-tariffs.json",
 "data/switzerland/soc-move-cpo-tariffs-national.json",
 "data/switzerland/lidl-official-direct-tariffs.json",
 "data/switzerland/ewz-direct-tariffs.json",
 "data/switzerland/plenitude-official-direct-tariffs.json",
 "data/switzerland/electra-direct-tariffs.json",
 "data/switzerland/ail-emoti-official-direct-tariffs.json",
 "data/switzerland/ionity-official-national-direct-tariffs.json",
 "data/switzerland/agr-monta-direct-tariffs.json",
 "data/switzerland/ewd-official-direct-tariffs.json",
 "data/switzerland/ewo-ecarup-direct-tariffs.json",
 "data/switzerland/mmn-move-cpo-tariffs.json",
 "data/switzerland/ebs-ecarup-direct-tariffs.json",
 "data/switzerland/edh-direct-tariffs.json",
 "data/switzerland/de-edh-direct-tariffs.json",
 "data/switzerland/autosense-amag-direct-tariffs.json",
 "data/switzerland/cpi-current-direct-tariffs.json",
 "data/switzerland/fastned-official-direct-tariffs.json",
 "data/switzerland/tae-matterhorn-terminal-direct-tariffs.json",
 "data/switzerland/chevp-evpass-official-direct-tariffs.json",
 "data/switzerland/ecarup-owner-direct-tariffs.json",
 "data/switzerland/ecarup-owner-coordinate-safe-overlay.json",
 "data/swisscharge/swisscharge-tariffs.json",
 "data/gofast/ev_charger_stations.json"
]

def fetch_bytes(url, timeout=180):
    req=urllib.request.Request(url,headers=UA)
    with urllib.request.urlopen(req,timeout=timeout) as r:
        return r.read()

def fetch_json(url, timeout=180):
    raw=fetch_bytes(url,timeout)
    if raw[:2]==b"\x1f\x8b": raw=gzip.decompress(raw)
    return json.loads(raw.decode("utf-8"))

def text(v):
    return "" if v is None else str(v).strip()

def first_num(*vals):
    for v in vals:
        if v is None or v=="": continue
        try:
            n=float(v)
            if math.isfinite(n): return n
        except: pass
    return None

def name_from(rec):
    n=rec.get("ChargingStationNames")
    if isinstance(n,list):
        for x in n:
            if isinstance(x,dict) and text(x.get("value")): return text(x["value"])
    if isinstance(n,dict) and text(n.get("value")): return text(n["value"])
    return text(rec.get("Name") or rec.get("name"))

def coords(rec):
    g=(rec.get("GeoCoordinates") or {}).get("Google")
    if isinstance(g,str):
        try:
            a,b=re.split(r"[,\s]+",g.strip())[:2]
            return float(a),float(b)
        except: pass
    lat=first_num(rec.get("Latitude"),rec.get("latitude"))
    lon=first_num(rec.get("Longitude"),rec.get("longitude"))
    return (lat,lon) if lat is not None and lon is not None else (None,None)

def addr(rec):
    a=rec.get("Address") or {}
    if isinstance(a,str): return a
    parts=[a.get("Street"),a.get("HouseNum"),a.get("PostalCode"),a.get("City")]
    return " ".join(text(x) for x in parts if text(x))

def evse_kind_power(rec):
    kinds=[]; powers=[]
    for f in rec.get("ChargingFacilities") or []:
        if not isinstance(f,dict): continue
        p=first_num(f.get("power"),f.get("Power"),f.get("maxPower"))
        if p is not None: powers.append(p)
        pt=text(f.get("powertype") or f.get("powerType")).lower()
        if "dc" in pt: kinds.append("DC")
        elif "ac" in pt: kinds.append("AC")
    plugs=" ".join(text(x).lower() for x in (rec.get("Plugs") or []))
    if not kinds:
        if any(x in plugs for x in ("ccs","chademo","combo","dc tesla")): kinds.append("DC")
        elif "type 2" in plugs: kinds.append("AC")
    kind="DC" if "DC" in kinds else ("AC" if "AC" in kinds else ("DC" if (max(powers) if powers else 0)>22 else "AC"))
    power=max(powers) if powers else None
    if power is None:
        power=50 if kind=="DC" else 11
    return kind,float(power)

def collect_national(feed):
    records=[]
    def walk(x,owner_id=None,owner_name=None):
        if isinstance(x,dict):
            oid=owner_id; on=owner_name
            if text(x.get("OperatorID")): oid=text(x.get("OperatorID"))
            if text(x.get("OperatorName")): on=text(x.get("OperatorName"))
            eid=x.get("EvseID")
            if oid and isinstance(eid,str) and eid.strip():
                records.append((oid,on or oid,eid.strip(),x))
            for v in x.values(): walk(v,oid,on)
        elif isinstance(x,list):
            for v in x: walk(v,owner_id,owner_name)
    walk(feed)
    uniq={}
    for oid,on,eid,rec in records: uniq[(oid,eid)]=(oid,on,eid,rec)
    return list(uniq.values())

def build_static(records):
    groups=defaultdict(list)
    for oid,on,eid,rec in records:
        if oid in ("CH*TES","CH*TSL"):
            continue
        sid=text(rec.get("ChargingStationId")) or eid
        groups[(oid,sid)].append((on,eid,rec))
    rows=[]
    for (oid,sid),items in sorted(groups.items()):
        sample=items[0][2]; lat,lon=coords(sample)
        if lat is None or lon is None:
            for _,_,rr in items:
                lat,lon=coords(rr)
                if lat is not None and lon is not None: sample=rr; break
        if lat is None or lon is None: continue
        configs=[]
        for on,eid,rec in sorted(items,key=lambda z:z[1]):
            kind,power=evse_kind_power(rec)
            configs.append([eid,f"{on} · {eid}",kind,power,1,[],[eid]])
        a=sample.get("Address") or {}
        city=text(a.get("City")) if isinstance(a,dict) else ""
        station_name=name_from(sample) or f"{items[0][0]} {city}".strip() or sid
        open24=sample.get("IsOpen24Hours") is True
        access=[[d,"00:00","24:00"] for d in range(7)] if open24 else []
        status=text(sample.get("EvseStatus") or sample.get("Status") or "UNKNOWN").upper()
        network=text(sample.get("SubOperatorName") or sample.get("SuboperatorName") or items[0][0])
        station_id=f"{oid}:{sid}"
        rows.append([station_id,station_name,addr(sample),lat,lon,items[0][0],len(configs),access,configs,datetime.now(timezone.utc).isoformat(),status,network])
    tiles=defaultdict(list)
    for row in rows:
        key=(math.floor(row[3]),math.floor(row[4]))
        tiles[key].append(row)
    OUT_DIR.mkdir(parents=True,exist_ok=True)
    tile_meta=[]
    for (la,lo),rs in sorted(tiles.items()):
        fn=f"tile_{la}_{lo}.json.gz"
        raw=json.dumps(rs,ensure_ascii=False,separators=(",",":")).encode("utf-8")
        with gzip.open(OUT_DIR/fn,"wb",compresslevel=9) as f:f.write(raw)
        tile_meta.append({"file":fn,"minLat":la,"maxLat":la+1,"minLon":lo,"maxLon":lo+1,"stationCount":len(rs)})
    manifest={"schemaVersion":4,"country":"CH","generatedAt":datetime.now(timezone.utc).isoformat(),"source":NATIONAL_URL,
              "stationCount":len(rows),"evseCount":sum(len(r[8]) for r in rows),"tiles":tile_meta}
    (OUT_DIR/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    return manifest

def exchange():
    p=Path("data/exchange_rates.json")
    j=json.loads(p.read_text(encoding="utf-8"))
    rate=float((j.get("rates") or {}).get("CHF") or 1)
    return rate,j.get("date")

CHF_PER_EUR,FX_DATE=exchange()
def to_eur(v,currency):
    n=first_num(v)
    if n is None:return None
    cur=text(currency or "CHF").upper()
    return n/CHF_PER_EUR if cur=="CHF" else n

def rule_pricing(kwh=None, per_min=None, session=None, free_min=None, after_free=None, currency="CHF"):
    r={"scope":"allDay"}
    if kwh is not None:r["pricePerKwh"]=round(to_eur(kwh,currency),8)
    if per_min is not None:r["pricePerMinute"]=round(to_eur(per_min,currency),8)
    if session is not None:r["sessionFeeEur"]=round(to_eur(session,currency),8)
    if free_min is not None and after_free is not None:
        r["connectedTimeFreeMinutes"]=float(free_min);r["connectedTimePerMinuteAfterFreeEur"]=round(to_eur(after_free,currency),8)
    return {"type":"rules","rules":[r]}

def offer(eid,provider,source,currency="CHF",pricing=None,kind="direct",subscription_id=None,metadata=None):
    if not eid or not pricing:return None
    oid=re.sub(r"[^a-z0-9]+","-",text(provider).lower()).strip("-") or "switzerland-cpo"
    x={"id":f"ch:{oid}:{re.sub(r'[^A-Za-z0-9]+','-',eid).strip('-')}:{kind}",
       "provider":provider,"countries":["CH"],"currency":"EUR","evseIds":[eid],"verifiedScope":"exact_evse",
       "pricing":pricing,"priority":130,"source":source,
       "metadata":{"originalCurrency":text(currency or "CHF").upper(),"fxChfPerEur":CHF_PER_EUR,"fxDate":FX_DATE,**(metadata or {})}}
    meta=EVSE_META.get(eid)
    if meta:
        x["connectorKinds"]=[meta["kind"]]
        p=float(meta["powerKw"])
        x["minPowerKw"]=max(0,p-0.01);x["maxPowerKw"]=p+0.01
        x["verifiedScope"]="exact_evse_power"
    if kind=="subscription":
        x["selectionId"]=subscription_id or x["id"];x["monthlyFeeEur"]=metadata.get("monthlyFeeEur") if metadata else None
    return x

def simple_evse_offer(e,provider,source):
    eid=text(e.get("evseId") or e.get("EvseID") or e.get("emi3Id") or e.get("physicalReference"))
    cur=text(e.get("currency") or e.get("Currency") or (e.get("tariff") or {}).get("currency") or "CHF").upper()
    # explicit common fields
    kwh=first_num(e.get("pricePerKwh"),e.get("directWebPricePerKwh"),e.get("standardPricePerKwh"),e.get("pricePerKwhCHF"),e.get("energyPrice"))
    per_min=first_num(e.get("pricePerMinute"))
    sess=first_num(e.get("sessionFee"),e.get("sessionFeeCHF"),e.get("startFee"))
    t=e.get("tariff") or {}
    if kwh is None:kwh=first_num(t.get("energyPrice"),t.get("pricePerKwh"))
    if per_min is None:per_min=first_num(t.get("pricePerMinute"))
    if sess is None:sess=first_num(t.get("sessionFee"),t.get("connectionFee"))
    if kwh is not None:
        return [offer(eid,provider,source,cur,rule_pricing(kwh,per_min,sess,currency=cur),metadata={"originalPricePerKwh":kwh})]
    # eCarUp exact form
    ec=e.get("ecarup") or {}
    p=ec.get("price") or {}
    if e.get("classification")=="priced_public_direct" and isinstance(p,dict):
        k=first_num(p.get("EnergyPrice")); pm=first_num(p.get("ParkingPrice"))
        if k is not None:return [offer(eid,provider,source,p.get("Currency") or "CHF",rule_pricing(k,currency=p.get("Currency") or "CHF"),metadata={"parkingPriceOriginal":pm})]
    # eCarUp coordinate overlay
    pt=e.get("priceTuple")
    if isinstance(pt,list) and pt:
        k=first_num(pt[0]); cur=(pt[5] if len(pt)>5 else "CHF")
        if k is not None:return [offer(eid,provider,source,cur,rule_pricing(k,currency=cur),metadata={"coordinateSafeOverlay":True})]
    # eCarUp public connectors (EWO etc)
    pcs=[c for c in (e.get("publicConnectors") or []) if first_num(c.get("energyPrice")) is not None]
    tuples={(first_num(c.get("energyPrice")),text(c.get("currency") or "CHF").upper()) for c in pcs}
    if len(tuples)==1:
        k,cur=next(iter(tuples));return [offer(eid,provider,source,cur,rule_pricing(k,currency=cur),metadata={"connectorEvidenceCount":len(pcs)})]
    # non-member / membership
    non=first_num(e.get("nonMemberPricePerKwh")); mem=first_num(e.get("memberPricePerKwh"))
    outs=[]
    if non is not None: outs.append(offer(eid,provider,source,cur,rule_pricing(non,currency=cur),metadata={"originalPricePerKwh":non}))
    if mem is not None:
        fee=first_num(e.get("memberAnnualFeeChf"))
        outs.append(offer(eid,provider,source,cur,rule_pricing(mem,currency=cur),kind="subscription",subscription_id=f"ch-{provider.lower().replace(' ','-')}-member",metadata={"annualFeeEur":round(to_eur(fee,cur),8) if fee is not None else None,"originalPricePerKwh":mem}))
    if outs:return [x for x in outs if x]
    # Lidl plus
    plus=first_num(e.get("lidlPlusPricePerKwh"))
    if plus is not None:
        return [offer(eid,provider,source,cur,rule_pricing(plus,currency=cur),kind="subscription",subscription_id="lidl-plus-ch",metadata={"originalPricePerKwh":plus})]
    return []

def tariffs_list_offers(e,provider,source):
    eid=text(e.get("evseId")); outs=[]
    for t in e.get("tariffs") or []:
        seg=t.get("matchedKwhSegments") or []
        if not seg:continue
        k=first_num(seg[0].get("price"));cur=text(seg[0].get("currency") or t.get("currency") or "CHF").upper()
        if k is None:continue
        per=None;free=None;after=None
        for s in t.get("segments") or []:
            if s.get("dimension")=="minute" and first_num(s.get("price")) is not None:
                if first_num(s.get("range_gte")) is not None:free=first_num(s.get("range_gte"));after=first_num(s.get("price"))
                else:per=first_num(s.get("price"))
        monthly=first_num(t.get("monthlyFee"))
        if monthly and monthly>0:
            outs.append(offer(eid,provider,source,cur,rule_pricing(k,per,currency=cur,free_min=free,after_free=after),kind="subscription",subscription_id=f"{provider.lower().replace(' ','-')}:{text(t.get('tariffName'))}",metadata={"monthlyFeeEur":round(to_eur(monthly,cur),8),"tariffName":t.get("tariffName")}))
        else:
            outs.append(offer(eid,provider,source,cur,rule_pricing(k,per,currency=cur,free_min=free,after_free=after),metadata={"tariffName":t.get("tariffName")}))
    return [x for x in outs if x]

def atlas_direct_offers(payload,provider,source):
    outs=[]
    for st in payload.get("stations") or []:
        for cp in st.get("chargePoints") or []:
            cpt=cp.get("chargePoint") or {}
            eids=[text(x) for x in cpt.get("evse_ids") or [] if text(x)]
            et=text(cpt.get("energy_type")).lower()
            for t in cp.get("directTariffs") or []:
                a=t.get("attributes") or {}; ta=(t.get("tariff") or {}).get("attributes") or {}
                if a.get("is_roaming") is not False:continue
                monthly=first_num(ta.get("total_monthly_fee")) or 0
                is_direct=ta.get("is_direct_payment") is True or monthly==0
                seg=a.get("restricted_segments") or []
                kwh=[s for s in seg if s.get("dimension")=="kwh" and first_num(s.get("price")) is not None and (not text(s.get("charge_point_energy_type")) or text(s.get("charge_point_energy_type")).lower()==et)]
                if not kwh:continue
                k=first_num(kwh[0].get("price"));cur=text(kwh[0].get("currency") or ta.get("currency") or "CHF").upper()
                per=None;free=None;after=None
                for s in seg:
                    if s.get("dimension")=="minute" and first_num(s.get("price")) is not None:
                        if first_num(s.get("range_gte")) is not None:free=first_num(s.get("range_gte"));after=first_num(s.get("price"))
                        else:per=first_num(s.get("price"))
                for eid in eids:
                    if is_direct:
                        outs.append(offer(eid,provider,source,cur,rule_pricing(k,per,currency=cur,free_min=free,after_free=after),metadata={"tariffName":ta.get("name")}))
                    else:
                        outs.append(offer(eid,provider,source,cur,rule_pricing(k,per,currency=cur,free_min=free,after_free=after),kind="subscription",subscription_id=f"{provider.lower().replace(' ','-')}:{text(ta.get('name'))}",metadata={"monthlyFeeEur":round(to_eur(monthly,cur),8),"tariffName":ta.get("name")}))
    return [x for x in outs if x]

def cpi_offers(payload,provider,source):
    outs=[]
    for e in payload.get("evses") or []:
        eid=text(e.get("evseId"))
        ev=(e.get("evidence") or {})
        fake={"stations":[{"chargePoints":[{"chargePoint":ev.get("chargePoint") or {"evse_ids":[eid]},"directTariffs":ev.get("directTariffs") or []}]}]}
        for x in atlas_direct_offers(fake,provider,source):
            x["evseIds"]=[eid];outs.append(x)
    return outs

def swisscharge_offers(payload,provider,source):
    outs=[]
    for e in payload.get("evses") or []:
        eid=text(e.get("emi3Id") or (("CH*SUI*E"+text(e.get("physicalReference"))) if text(e.get("physicalReference")) else ""))
        t=e.get("tariff") or {}; cur=text(t.get("currency") or "CHF").upper()
        k=first_num(t.get("pricePerKwh")); conn=first_num(t.get("connectionFee"))
        per_period=first_num(t.get("pricePerPeriod")); period=first_num(t.get("pricePeriodInMinutes"))
        idle=first_num(t.get("idleFeePerMinute")); grace=first_num(t.get("idleFeeGracePeriodMinutes"))
        if k is None and conn is None and per_period is None:continue
        per=(per_period/period if per_period is not None and period and period>0 else None)
        pricing=rule_pricing(k,per,conn,currency=cur,free_min=grace,after_free=idle)
        outs.append(offer(eid,provider,source,cur,pricing,metadata={"tariffName":t.get("name"),"originalPhysicalReference":e.get("physicalReference")}))
    return [x for x in outs if x]

def haversine_m(a,b):
    lat1,lon1=a;lat2,lon2=b
    r=6371000.0
    p1=math.radians(lat1);p2=math.radians(lat2)
    dp=math.radians(lat2-lat1);dl=math.radians(lon2-lon1)
    h=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*r*math.atan2(math.sqrt(h),math.sqrt(max(0,1-h)))

def norm_name(v):
    return re.sub(r"[^a-z0-9]+","",text(v).lower().replace("ü","u").replace("ö","o").replace("ä","a").replace("é","e").replace("è","e").replace("à","a"))

def gofast_offers(payload,path):
    global GOFAST_AUDIT
    if not isinstance(payload,list):return []
    official=[]
    for st in payload:
        loc=st.get("location") or {}
        lat=first_num(loc.get("lat"));lon=first_num(loc.get("lng"))
        m=re.search(r"([0-9]+(?:[.,][0-9]+)?)\\s*CHF\\s*/\\s*kWh",text(st.get("pricing_de")),re.I)
        if lat is None or lon is None or not m:continue
        k=float(m.group(1).replace(",","."))
        detail=text(st.get("pricing_detail_de") or st.get("pricing_detail_en"))
        fm=re.search(r"(?:ab|after|from)\\s*(\\d+)\\.?\\s*(?:Minute|min)",detail,re.I)
        pm=re.search(r"CHF\\s*([0-9]+(?:[.,][0-9]+)?)\\s*/\\s*Min",detail,re.I)
        official.append({"lat":lat,"lon":lon,"price":k,"free":float(fm.group(1)) if fm else None,"after":float(pm.group(1).replace(",",".")) if pm else None,"name":st.get("title_de"),"slug":st.get("slug")})
    outs=[]
    for oid,on,eid,rec in NATIONAL_RECORDS:
        if oid!="CH*GFT":continue
        GOFAST_AUDIT["nationalEvse"]+=1
        co=coords(rec)
        if co[0] is None:continue
        national_name=norm_name(name_from(rec))
        name_matches=[s for s in official if norm_name(s["name"])==national_name and national_name]
        if len(name_matches)==1:
            s=name_matches[0];d=haversine_m(co,(s["lat"],s["lon"]));policy="exact normalized station-name match"
            GOFAST_AUDIT["matchedByName"]+=1
        else:
            cand=sorted((haversine_m(co,(s["lat"],s["lon"])),s) for s in official)
            if not cand:
                GOFAST_AUDIT["unmatched"]+=1
                continue
            GOFAST_AUDIT["nearestDistances"].append(round(cand[0][0],2))
            if cand[0][0]>50:
                GOFAST_AUDIT["unmatched"]+=1
                continue
            d,s=cand[0]
            if len(cand)>1 and cand[1][0]<=50 and abs(cand[1][0]-d)<10:
                GOFAST_AUDIT["unmatched"]+=1
                continue
            policy="unique nearest official GOFAST coordinate within 50m"
            GOFAST_AUDIT["matchedByCoordinate"]+=1
        outs.append(offer(eid,"GOFAST",path,"CHF",rule_pricing(s["price"],currency="CHF",free_min=s["free"],after_free=s["after"]),metadata={"officialStation":s["name"],"officialSlug":s["slug"],"distanceMeters":round(d,2),"mappingPolicy":policy}))
    return [x for x in outs if x]

def compile_payload(payload,path):
    if "data/gofast/ev_charger_stations.json" in path:
        return gofast_offers(payload,path)
    if not isinstance(payload,dict):
        return []
    provider=text(payload.get("cpo") or payload.get("operator") or payload.get("operatorId") or Path(path).stem)
    if "swisscharge-tariffs" in path:return swisscharge_offers(payload,"Swisscharge",path)
    if "cpi-current" in path:return cpi_offers(payload,"ChargePoint",path)
    outs=[]
    if isinstance(payload.get("evses"),list):
        for e in payload["evses"]:
            eo=tariffs_list_offers(e,provider,path)
            if eo:outs.extend(eo)
            else:outs.extend(simple_evse_offer(e,provider,path))
    if isinstance(payload.get("stations"),list):
        outs.extend(atlas_direct_offers(payload,provider,path))
    return outs

def derive_move_ccc(direct,subs):
    templates={}
    for o in direct+subs:
        eids=o.get("evseIds") or []
        if not eids or not eids[0].startswith("CH*CCI*"):continue
        if "move" not in text(o.get("provider")).lower():continue
        kinds=tuple(o.get("connectorKinds") or [])
        if len(kinds)!=1:continue
        key=(kinds[0],text(o.get("selectionId")),json.dumps(o.get("pricing"),sort_keys=True))
        templates[key]=o
    by_kind=defaultdict(list)
    for (_,_,_),o in templates.items():
        by_kind[(o.get("connectorKinds") or [""])[0]].append(o)
    out_d=[];out_s=[]
    for oid,on,eid,rec in NATIONAL_RECORDS:
        if oid!="CH*CCC" or not eid.startswith("CH*CCC*"):continue
        meta=EVSE_META.get(eid)
        if not meta:continue
        for t in by_kind.get(meta["kind"],[]):
            md=dict(t.get("metadata") or {})
            md.update({"derivedFrom":"explicit Move CPO-level tariff schedule already validated on CH*CCI","ownerScope":"CH*CCC"})
            if t.get("selectionId"):
                x=offer(eid,"MOVE", "data/switzerland/cci-move-cpo-tariffs-national.json","CHF",t.get("pricing"),kind="subscription",subscription_id=t.get("selectionId"),metadata=md)
                if x:out_s.append(x)
            else:
                x=offer(eid,"MOVE","data/switzerland/cci-move-cpo-tariffs-national.json","CHF",t.get("pricing"),metadata=md)
                if x:out_d.append(x)
    return out_d,out_s

def compile_offers():
    direct=[]; subs=[]; errors=[]; source_counts={}
    for path in SOURCES:
        try:
            payload=fetch_json(LAB_RAW+path,240)
            offers=compile_payload(payload,path)
            source_counts[path]=len(offers)
            for o in offers:
                (subs if o.get("selectionId") else direct).append(o)
        except Exception as e:
            errors.append({"path":path,"error":type(e).__name__+": "+str(e)})
    ccc_direct,ccc_subs=derive_move_ccc(direct,subs)
    direct.extend(ccc_direct);subs.extend(ccc_subs)
    source_counts["derived:CH*CCC-from-explicit-Move-CPO-level-schedules"]=len(ccc_direct)+len(ccc_subs)
    # exact semantic dedupe
    def key(o):
        return (tuple(o.get("evseIds") or []),text(o.get("provider")),text(o.get("selectionId")),json.dumps(o.get("pricing"),sort_keys=True))
    d={};s={}
    for o in direct:d[key(o)]=o
    for o in subs:s[key(o)]=o
    out={"schemaVersion":1,"country":"CH","generatedAt":datetime.now(timezone.utc).isoformat(),
         "policy":{"exactEvseOnly":True,"unresolvedNeverRankable":True,"originalTariffsPreservedInMetadata":True,
                   "fxPolicy":"CHF amounts converted to EUR at build time using repository daily exchange_rates.json; original CHF metadata retained"},
         "directOffers":list(d.values()),"subscriptionOffers":list(s.values()),"emspOffers":[],
         "build":{"sources":source_counts,"errors":errors,"fxChfPerEur":CHF_PER_EUR,"fxDate":FX_DATE}}
    OFFERS_OUT.parent.mkdir(parents=True,exist_ok=True)
    OFFERS_OUT.write_text(json.dumps(out,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
    return out

def main():
    global NATIONAL_RECORDS,EVSE_META
    feed=fetch_json(NATIONAL_URL,240)
    records=collect_national(feed)
    NATIONAL_RECORDS=records
    EVSE_META={eid:{"kind":evse_kind_power(rec)[0],"powerKw":evse_kind_power(rec)[1]} for _,_,eid,rec in records}
    manifest=build_static(records)
    offers=compile_offers()
    report={"generatedAt":datetime.now(timezone.utc).isoformat(),"country":"CH",
            "national":{"owners":len({x[0] for x in records}),"evses":len(records),"publishedNonTeslaEvses":manifest["evseCount"],"excludedTeslaEvseCount":sum(1 for x in records if x[0] in ("CH*TES","CH*TSL")),"stations":manifest["stationCount"],"tiles":len(manifest["tiles"])},
            "offers":{"direct":len(offers["directOffers"]),"subscriptions":len(offers["subscriptionOffers"]),"uniqueDirectEvse":len({e for o in offers["directOffers"] for e in o.get("evseIds",[])}),"uniqueSubscriptionEvse":len({e for o in offers["subscriptionOffers"] for e in o.get("evseIds",[])}),"sourceCounts":offers["build"]["sources"],"sourceErrors":offers["build"]["errors"]},
            "fx":{"CHFperEUR":CHF_PER_EUR,"date":FX_DATE},"gofastAudit":{**GOFAST_AUDIT,"nearestDistanceMin":min(GOFAST_AUDIT["nearestDistances"]) if GOFAST_AUDIT["nearestDistances"] else None,"nearestDistanceMedian":sorted(GOFAST_AUDIT["nearestDistances"])[len(GOFAST_AUDIT["nearestDistances"])//2] if GOFAST_AUDIT["nearestDistances"] else None,"nearestDistanceMax":max(GOFAST_AUDIT["nearestDistances"]) if GOFAST_AUDIT["nearestDistances"] else None}}
    REPORT_OUT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=="__main__":main()

# trigger initial Switzerland V9 build
