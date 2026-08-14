#!/usr/bin/env python3
import copy
import json
import sys
from pathlib import Path


def get_path(obj, path):
    cur = obj
    for part in path.split('.'):
        if isinstance(cur, list):
            cur = cur[int(part)]
        else:
            cur = cur[part]
    return cur


def fail(message):
    raise SystemExit(f"SAFETY CHECK FAILED: {message}")


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Usage: apply_station_delta.py <delta.json> <stations.json>")

    delta_path = Path(sys.argv[1])
    stations_path = Path(sys.argv[2])
    delta = json.loads(delta_path.read_text(encoding="utf-8"))
    stations = json.loads(stations_path.read_text(encoding="utf-8"))

    if not isinstance(stations, list):
        fail("station database is not a JSON array")

    expected_before = int(delta["expectedBeforeCount"])
    expected_after = int(delta["expectedAfterCount"])
    if len(stations) != expected_before:
        fail(f"expected {expected_before} stations before publication, found {len(stations)}")

    original_ids = [station.get("id") for station in stations]
    if None in original_ids or len(original_ids) != len(set(original_ids)):
        fail("baseline contains missing or duplicate station IDs")

    by_id = {station["id"]: station for station in stations}
    additions = list(delta.get("newStations", []))
    replacements = list(delta.get("replacements", []))

    for payload_name in delta.get("payloadFiles", []):
        payload_path = Path(payload_name)
        if not payload_path.is_file():
            fail(f"payload file does not exist: {payload_name}")
        payload = json.loads(payload_path.read_text(encoding="utf-8"))
        additions.extend(payload.get("newStations", []))
        replacements.extend(payload.get("replacements", []))

    manual_reviews = delta.get("manualReviewKeep", [])
    suspected_keeps = delta.get("suspectedRemovalKeep", [])
    expected_changes = delta.get("expectedChanges", [])

    add_ids = [station["id"] for station in additions]
    replacement_ids = [station["id"] for station in replacements]
    manual_ids = [item["id"] for item in manual_reviews]

    for label, ids in (("addition", add_ids), ("replacement", replacement_ids), ("manual review", manual_ids)):
        if len(ids) != len(set(ids)):
            fail(f"duplicate ID in {label} set")

    overlap = set(manual_ids) & (set(add_ids) | set(replacement_ids))
    if overlap:
        fail(f"manual-review stations would be modified: {sorted(overlap)}")

    existing_adds = set(add_ids) & set(by_id)
    if existing_adds:
        fail(f"new station IDs already exist: {sorted(existing_adds)}")

    missing_replacements = set(replacement_ids) - set(by_id)
    if missing_replacements:
        fail(f"replacement station IDs missing from baseline: {sorted(missing_replacements)}")

    missing_manual = set(manual_ids) - set(by_id)
    if missing_manual:
        fail(f"manual-review station IDs missing from baseline: {sorted(missing_manual)}")

    for item in suspected_keeps:
        if item["id"] not in by_id:
            fail(f"protected suspected-removal station missing from baseline: {item['id']}")

    manual_before = {station_id: copy.deepcopy(by_id[station_id]) for station_id in manual_ids}

    change_ids = set()
    replacement_id_set = set(replacement_ids)
    for item in expected_changes:
        station_id = item["id"]
        change_ids.add(station_id)
        if station_id not in by_id:
            fail(f"expected-change station missing: {station_id}")
        if station_id not in replacement_id_set:
            fail(f"expected-change station is not in replacement set: {station_id}")
        for change in item.get("changes", []):
            path = change["field"]
            try:
                current = get_path(by_id[station_id], path)
            except (KeyError, IndexError, TypeError, ValueError):
                fail(f"cannot read baseline field {station_id}:{path}")
            if current != change["before"]:
                fail(
                    f"stale baseline for {station_id}:{path}; "
                    f"expected {change['before']!r}, found {current!r}"
                )

    if change_ids != replacement_id_set:
        fail("replacement set does not exactly match validated automatic-change stations")

    replacement_map = {station["id"]: station for station in replacements}
    updated = [copy.deepcopy(replacement_map.get(station["id"], station)) for station in stations]
    updated.extend(copy.deepcopy(additions))

    after_ids = [station.get("id") for station in updated]
    if None in after_ids or len(after_ids) != len(set(after_ids)):
        fail("result contains missing or duplicate station IDs")
    if not set(original_ids).issubset(set(after_ids)):
        fail("publication would delete one or more baseline stations")
    if len(updated) != expected_after:
        fail(f"expected {expected_after} stations after publication, produced {len(updated)}")

    after_by_id = {station["id"]: station for station in updated}
    for station_id, before_obj in manual_before.items():
        if after_by_id[station_id] != before_obj:
            fail(f"manual-review station changed unexpectedly: {station_id}")

    for item in suspected_keeps:
        if item["id"] not in after_by_id:
            fail(f"protected station was not preserved: {item['id']}")

    for item in expected_changes:
        station_id = item["id"]
        for change in item.get("changes", []):
            path = change["field"]
            try:
                current = get_path(after_by_id[station_id], path)
            except (KeyError, IndexError, TypeError, ValueError):
                fail(f"cannot read published field {station_id}:{path}")
            if current != change["after"]:
                fail(
                    f"published value mismatch for {station_id}:{path}; "
                    f"expected {change['after']!r}, found {current!r}"
                )

    stations_path.write_text(
        json.dumps(updated, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    source = delta.get("source", {})
    print(
        "PUBLICATION READY — "
        f"{expected_before} -> {expected_after} stations; "
        f"added={len(additions)}; automatic stations={len(replacements)}; "
        f"manual reviews preserved={len(manual_reviews)}; "
        f"suspected removals preserved={len(suspected_keeps)}; "
        f"source global run=#{source.get('runNumber', '?')}."
    )


if __name__ == "__main__":
    main()
