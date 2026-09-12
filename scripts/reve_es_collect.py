#!/usr/bin/env python3
"""Incremental MapaREVE collector for Tesla Charge Companion.

Designed around the public REVE API limit of 5 requests/hour. Each invocation
uses at most REVE_PAGES_PER_RUN location requests (default 4), merges the raw
OCPI-shaped locations into a gzip snapshot and advances a small state file.

This collector deliberately DOES NOT publish to the TCC runtime. It only builds
pre-integration source data that can be audited and transformed later.
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import subprocess
import sys
import tempfile
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BASE_URL = "https://www.mapareve.es/api/external/v1"
DEFAULT_LIMIT = 100
HARD_REQUEST_LIMIT = 5


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def load_gzip_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")
    tmp.replace(path)


def save_gzip_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    # mtime=0 makes the gzip deterministic when content is unchanged.
    with tmp.open("wb") as raw:
        with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as gz:
            gz.write((json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
    tmp.replace(path)


def api_get(api_key: str, endpoint: str, params: dict[str, Any] | None = None) -> tuple[Any, dict[str, str]]:
    """GET REVE through curl.

    REVE currently returns 401 for Python urllib from GitHub-hosted runners even
    with the same valid API key, while curl from the same runner succeeds. Use
    curl here to match the validated transport path and keep the collector
    deterministic across local and GitHub execution.
    """
    url = BASE_URL + endpoint
    if params:
        url += "?" + urllib.parse.urlencode(params)

    with tempfile.TemporaryDirectory(prefix="reve-") as tmpdir:
        headers_path = Path(tmpdir) / "headers.txt"
        body_path = Path(tmpdir) / "body.json"
        proc = subprocess.run(
            [
                "curl",
                "-sS",
                "--max-time",
                "120",
                "-D",
                str(headers_path),
                "-o",
                str(body_path),
                "-H",
                f"x-api-key: {api_key}",
                "-H",
                "Accept: application/json",
                url,
            ],
            capture_output=True,
            text=True,
            check=False,
        )

        headers_text = headers_path.read_text(encoding="utf-8", errors="replace") if headers_path.exists() else ""
        body = body_path.read_text(encoding="utf-8", errors="replace") if body_path.exists() else ""

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
        for line in header_lines[last_http_index + 1 :]:
            if not line.strip():
                break
            if ":" not in line:
                continue
            key, value = line.split(":", 1)
            headers[key.strip().lower()] = value.strip()

    if proc.returncode != 0 and status_code == 0:
        stderr = (proc.stderr or "").strip()
        raise RuntimeError(f"REVE curl failed (exit {proc.returncode}): {stderr[:500]}")
    if status_code == 429:
        raise RuntimeError("REVE rate limit reached (HTTP 429)")
    if status_code != 200:
        raise RuntimeError(f"REVE HTTP {status_code or 'unknown'}: {body[:500]}")

    try:
        payload = json.loads(body)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"REVE returned invalid JSON: {body[:500]}") from e
    return payload, headers


def merge_locations(existing: dict[str, Any], rows: list[dict[str, Any]]) -> tuple[dict[str, Any], int, int]:
    inserted = 0
    updated = 0
    for row in rows:
        rid = str(row.get("id", "")).strip()
        if not rid:
            continue
        if rid in existing:
            if existing[rid] != row:
                updated += 1
        else:
            inserted += 1
        existing[rid] = row
    return existing, inserted, updated


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force-new-cycle", action="store_true", help="Reset pagination to page 1 and start a fresh full pass")
    parser.add_argument("--pages", type=int, default=int(os.getenv("REVE_PAGES_PER_RUN", "4")))
    parser.add_argument("--data-dir", default="data/spain_reve")
    args = parser.parse_args()

    api_key = os.getenv("REVE_API_KEY", "").strip()
    if not api_key:
        print("ERROR: REVE_API_KEY is not configured", file=sys.stderr)
        return 2

    pages_per_run = max(1, min(args.pages, HARD_REQUEST_LIMIT))
    data_dir = Path(args.data_dir)
    state_path = data_dir / "state.json"
    snapshot_path = data_dir / "reve_locations_raw.json.gz"
    metadata_path = data_dir / "metadata.json"

    state = load_json(state_path, {})
    if args.force_new_cycle or not state:
        state = {
            "cycleStartedAt": utc_now(),
            "cycleCompletedAt": None,
            "nextPage": 1,
            "totalPages": None,
            "totalCount": None,
            "requestsThisCycle": 0,
            "pagesFetchedThisCycle": 0,
        }

    if state.get("cycleCompletedAt") and not args.force_new_cycle:
        print("Cycle already complete. Use --force-new-cycle to start another full pass.")
        return 0

    snapshot = load_gzip_json(snapshot_path, {"schemaVersion": 1, "country": "ES", "source": "REVE", "locations": {}})
    locations = snapshot.setdefault("locations", {})

    next_page = int(state.get("nextPage") or 1)
    total_pages = state.get("totalPages")
    requests_used = 0
    fetched_pages: list[int] = []
    inserted_total = 0
    updated_total = 0

    for _ in range(pages_per_run):
        if total_pages and next_page > int(total_pages):
            break

        payload, headers = api_get(api_key, "/locations", {"page": next_page, "limit": DEFAULT_LIMIT})
        requests_used += 1
        if not isinstance(payload, list):
            raise RuntimeError(f"Unexpected /locations response type: {type(payload).__name__}")

        header_total_pages = int(headers.get("total-pages", "0") or 0)
        header_total_count = int(headers.get("total-count", "0") or 0)
        if header_total_pages:
            total_pages = header_total_pages
            state["totalPages"] = header_total_pages
        if header_total_count:
            state["totalCount"] = header_total_count

        locations, inserted, updated = merge_locations(locations, payload)
        inserted_total += inserted
        updated_total += updated
        fetched_pages.append(next_page)
        next_page += 1

        # No artificial sleep: one workflow invocation intentionally stays below
        # the published hourly limit. The next invocation is scheduled next hour.

    completed = bool(total_pages and next_page > int(total_pages))
    state["nextPage"] = next_page
    state["requestsThisCycle"] = int(state.get("requestsThisCycle") or 0) + requests_used
    state["pagesFetchedThisCycle"] = int(state.get("pagesFetchedThisCycle") or 0) + len(fetched_pages)
    state["lastRunAt"] = utc_now()
    if completed:
        state["cycleCompletedAt"] = utc_now()

    snapshot["updatedAt"] = utc_now()
    snapshot["locationCount"] = len(locations)
    snapshot["locations"] = locations

    metadata = {
        "schemaVersion": 1,
        "country": "ES",
        "source": "REVE",
        "updatedAt": utc_now(),
        "locationCountStored": len(locations),
        "registryTotalCount": state.get("totalCount"),
        "totalPages": state.get("totalPages"),
        "nextPage": state.get("nextPage"),
        "cycleStartedAt": state.get("cycleStartedAt"),
        "cycleCompletedAt": state.get("cycleCompletedAt"),
        "lastPagesFetched": fetched_pages,
        "lastRunRequests": requests_used,
        "lastRunInserted": inserted_total,
        "lastRunUpdated": updated_total,
        "complete": completed,
        "integrationStatus": "PRE_INTEGRATION_ONLY",
    }

    save_gzip_json(snapshot_path, snapshot)
    save_json(state_path, state)
    save_json(metadata_path, metadata)

    print(json.dumps(metadata, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
