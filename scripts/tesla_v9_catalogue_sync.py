#!/usr/bin/env python3
"""Copy the canonical Mac-published Tesla catalogue to both V9 runtimes.

This is a byte-for-byte mirror: no tariff rewrite, timestamp invention or SuC
substitution. GitHub country-batch PUBLICATION dates are stored separately from
actual station price observation dates (sourceObservedAt, if Mac provides them).

Use --apply after Mac publication, --check to assert V9 equality.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path("data/tesla_stations.json")
MIRRORS = (
    Path("v9-production-runtime/data/tesla_stations.json"),
    Path("v9-test/data/tesla_stations.json"),
)
EVIDENCE = Path("data/tesla-mac-catalogue-publication.json")
COUNTRY_NAMES = {
    "FR": "france", "IT": "italy", "CH": "switzerland", "DE": "germany",
    "ES": "spain", "NL": "netherlands", "GB": "united_kingdom",
    "BE": "belgium", "MA": "morocco", "PT": "portugal", "LU": "luxembourg"
}

def git(*args):
    p = subprocess.run(("git", *args), cwd=ROOT, capture_output=True,
                       text=True, check=True)
    return p.stdout.strip()

def file_sha(payload):
    return sha256(payload).hexdigest()

def read_stations(p):
    raw=(ROOT / p).read_bytes()
    value=json.loads(raw)
    if not isinstance(value,list) or len(value)<1100:
        raise ValueError(f"{p}: invalid Tesla station list or major count drop")
    ids=[s.get("id") for s in value if isinstance(s,dict)]
    if len(ids)!=len(value) or len(set(ids))!=len(ids) or any(not x for x in ids):
        raise ValueError(f"{p}: missing/duplicate Tesla station id")
    if any(not isinstance(s.get("pricing"),dict) or not s.get("countryCode")
           or not s.get("chargingConfigurations") for s in value):
        raise ValueError(f"{p}: missing Tesla station country/pricing/configurations")
    counts=Counter(s["countryCode"] for s in value)
    for cc in ("FR","IT","CH","DE","ES","NL","GB","MA","BE"):
        if not counts[cc]:
            raise ValueError(f"Missing expected Tesla country {cc}")
    return raw,value,counts

def batch_evidence(country):
    name=COUNTRY_NAMES[country]
    pattern=f"chore(stations): publish {name} automated lot update"
    lines=git("log","-n","1","--format=%H%x09%cI%x09%s",f"--grep={pattern}","--fixed-strings")
    if not lines:return None
    try:
        sha,stamp,description=lines.split("\t",2)
        dt=datetime.fromisoformat(stamp.replace("Z","+00:00"))
    except (ValueError,TypeError):
        return None
    if not re.fullmatch(r"chore\(stations\): publish "+re.escape(name)+r" automated lot update #\d+",description):
        return None
    return {"commitSha":sha,"publishedAt":dt.isoformat(),"message":description,
            "timestampMeaning":"publication of country batch; NOT verification of each station's price observation"}

def build_evidence(raw,stations,counts):
    actual_observation=Counter()
    sample_observed={}
    for s in stations:
        c=s["countryCode"]
        v=s.get("sourceObservedAt")
        if isinstance(v,str) and v.strip():
            try:
                datetime.fromisoformat(v.replace("Z","+00:00"))
                actual_observation[c]+=1
                if c not in sample_observed or v>sample_observed[c]:
                    sample_observed[c]=v
            except ValueError:raise ValueError(f"Invalid sourceObservedAt on Tesla station {s['id']}")
    country_info={}
    for cc in sorted(counts):
        country_info[cc]={
            "stationCount":counts[cc],
            "verifiedPriceObservationCount":actual_observation[cc],
            "latestVerifiedPriceObservation":sample_observed.get(cc),
            "lastMacCountryBatch":batch_evidence(cc) if cc in COUNTRY_NAMES else None
        }
    return {
        "schemaVersion":1,
        "canonicalFile":str(SOURCE),
        "canonicalSha256":file_sha(raw),
        "stationCount":len(stations),
        "countries":country_info,
        "V9Mirrors":[str(p) for p in MIRRORS],
        "dateRules":{
            "sourceObservedAt":"only a collection timestamp supplied by the Mac extraction itself",
            "lastUpdated":"legacy station metadata, NOT reliable for price freshness",
            "countryBatchPublishedAt":"publication evidence; use conservatively when sourceObservedAt missing",
            "suC":"comparison only; Morocco always Mac; no auto override of an October Mac publication"
        },
        "source":"Mac published catalogue, no SuC substitution",
    }

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--apply",action="store_true",
                   help="Sync mirror bytes and write provenance evidence")
    p.add_argument("--check",action="store_true",
                   help="Assert both mirrors and metadata equal current canonical source")
    a=p.parse_args()
    if a.apply==a.check:p.error("select exactly one of --apply or --check")
    raw,stations,counts=read_stations(SOURCE)
    for mirror in MIRRORS:
        existing=(ROOT/mirror).read_bytes() if (ROOT/mirror).exists() else None
        if a.check and existing!=raw:
            raise SystemExit(f"FAIL stale Tesla mirror: {mirror}")
        if a.apply and existing!=raw:
            (ROOT/mirror).parent.mkdir(parents=True,exist_ok=True)
            (ROOT/mirror).write_bytes(raw)
            print(f"SYNCED {mirror} stations={len(stations)} sha256={file_sha(raw)}")
    evidence=build_evidence(raw,stations,counts)
    current=json.loads((ROOT/EVIDENCE).read_text()) if (ROOT/EVIDENCE).exists() else None
    if a.check:
        if current!=evidence:
            raise SystemExit("FAIL Tesla Mac publication evidence not synchronized")
    elif current!=evidence:
        (ROOT/EVIDENCE).parent.mkdir(parents=True,exist_ok=True)
        (ROOT/EVIDENCE).write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
        print("UPDATED country-batch publication provenance")
    print("TESLA_V9_MIRROR_OK "+json.dumps({
        "canonicalSha256":file_sha(raw),"stationCount":len(stations),
        "countries":dict(sorted(counts.items())),
        "mirrors":list(map(str,MIRRORS)),
        "verifiedStationObservations":sum(
            v["verifiedPriceObservationCount"] for v in evidence["countries"].values()),
        "mode":"apply" if a.apply else "check"
    },ensure_ascii=False))

if __name__=="__main__":
    main()
