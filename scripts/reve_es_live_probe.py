#!/usr/bin/env python3
"""Controlled live MapaREVE tariff/status probe for Spain pre-integration.

Hard safety properties:
- never performs more than 5 REVE requests in one invocation;
- never calls /locations;
- records every attempted request without logging the API key;
- stops on the first non-200 response to avoid wasting the hourly budget;
- keeps runtime publication disabled.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BASE_URL = "https://www.mapareve.es/api/external/v1"
HARD_REQUEST_LIMIT = 5
OUT_PATH = Path("data/spain_reve/live_tariff_status_probe.json")

TARGET_EVSES = [
    {"operator": "Iberdrola | bp pulse", "evseId": "ES*IBD*E135326*1"},
    {"operator": "Endesa X Way", "evseId": "ES*ESX*E61948051050013*1"},
    {"operator": "Repsol", "evseId": "ES*REP*E15141*1"},
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def api_get(api_key: str, endpoint: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    url = BASE_URL + endpoint
    if params:
        url += "?" + urllib.parse.urlencode(params)

    with tempfile.TemporaryDirectory(prefix="reve-live-probe-") as tmpdir:
        headers_path = Path(tmpdir) / "headers.txt"
        body_path = Path(tmpdir) / "body.json"
        proc = subprocess.run(
            [
                "curl", "-sS", "--max-time", "120",
                "-D", str(headers_path),
                "-o", str(body_path),
                "-H", f"x-api-key: {api_key}",
                "-H", "Accept: application/json",
                url,
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        headers_text = headers_path.read_text(encoding="utf-8", errors="replace") if headers_path.exists() else ""
        body_text = body_path.read_text(encoding="utf-8", errors="replace") if body_path.exists() else ""

    status_code = 0
    header_lines = headers_text.splitlines()
    last_http_index = -1
    for i, line in enumerate(header_lines):
        if line.startswith("HTTP/"):
            last_http_index = i
            parts = line.split()
            if len(parts) >= 2 and parts[1].isdigit():
                status_code = int(parts[1])

    headers: dict[str, str] = {}
    if last_http_index >= 0:
        for line in header_lines[last_http_index + 1:]:
            if not line.strip():
                break
            if ":" not in line:
                continue
            key, value = line.split(":", 1)
            headers[key.strip().lower()] = value.strip()

    payload: Any = None
    json_error = None
    if body_text:
        try:
            payload = json.loads(body_text)
        except json.JSONDecodeError as exc:
            json_error = str(exc)

    return {
        "status": status_code,
        "transportExitCode": proc.returncode,
        "headers": {
            k: headers[k]
            for k in ("total-count", "total-pages", "link", "content-type", "retry-after")
            if k in headers
        },
        "payload": payload,
        "bodyPreview": None if payload is not None else body_text[:500],
        "jsonError": json_error,
        "stderrPreview": (proc.stderr or "")[:500] or None,
    }


def describe_payload(payload: Any) -> dict[str, Any]:
    if isinstance(payload, list):
        keys = sorted({k for item in payload[:20] if isinstance(item, dict) for k in item.keys()})
        return {"type": "list", "count": len(payload), "sampleKeys": keys}
    if isinstance(payload, dict):
        return {"type": "object", "keys": sorted(payload.keys())}
    return {"type": type(payload).__name__}


def main() -> int:
    api_key = os.getenv("REVE_API_KEY", "").strip()
    report: dict[str, Any] = {
        "schemaVersion": 1,
        "country": "ES",
        "source": "REVE",
        "generatedAt": utc_now(),
        "integrationStatus": "PRE_INTEGRATION_ONLY",
        "publishReady": False,
        "hardRequestLimit": HARD_REQUEST_LIMIT,
        "requestsAttempted": 0,
        "requestsSucceeded": 0,
        "probeComplete": False,
        "requests": [],
        "targets": TARGET_EVSES,
        "note": "Controlled tariff/status probe only; no /locations calls and no runtime publication.",
    }

    if not api_key:
        report["error"] = "REVE_API_KEY is not configured"
        OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        return 0

    plan: list[dict[str, Any]] = [
        {"kind": "tariffs_page", "endpoint": "/connectors/tariffs", "params": {"page": 1, "limit": 100}},
        {"kind": "operational_status_page", "endpoint": "/evses/operational_status", "params": {"page": 1, "limit": 100}},
    ]
    for target in TARGET_EVSES:
        encoded_evse = urllib.parse.quote(target["evseId"], safe="")
        plan.append({
            "kind": "evse_status",
            "endpoint": f"/evses/{encoded_evse}/status",
            "params": None,
            "operator": target["operator"],
            "evseId": target["evseId"],
        })

    assert len(plan) == HARD_REQUEST_LIMIT

    for req in plan:
        if report["requestsAttempted"] >= HARD_REQUEST_LIMIT:
            break
        result = api_get(api_key, req["endpoint"], req.get("params"))
        report["requestsAttempted"] += 1
        entry = {
            "kind": req["kind"],
            "endpoint": req["endpoint"],
            "params": req.get("params"),
            "operator": req.get("operator"),
            "evseId": req.get("evseId"),
            "status": result["status"],
            "headers": result["headers"],
            "payloadSummary": describe_payload(result["payload"]),
            "payload": result["payload"],
            "bodyPreview": result["bodyPreview"],
            "jsonError": result["jsonError"],
            "stderrPreview": result["stderrPreview"],
        }
        report["requests"].append(entry)
        if result["status"] == 200 and result["payload"] is not None:
            report["requestsSucceeded"] += 1
        else:
            report["stoppedAfterError"] = True
            break

    report["probeComplete"] = (
        report["requestsAttempted"] == HARD_REQUEST_LIMIT
        and report["requestsSucceeded"] == HARD_REQUEST_LIMIT
    )
    report["generatedAt"] = utc_now()

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "requestsAttempted": report["requestsAttempted"],
        "requestsSucceeded": report["requestsSucceeded"],
        "probeComplete": report["probeComplete"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
