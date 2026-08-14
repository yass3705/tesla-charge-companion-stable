#!/usr/bin/env python3
import copy
import json
import sys
from pathlib import Path


def get_path(obj, path):
    cur = obj
    for part in path.split("."):
        if isinstance(cur, list):
            cur = cur[int(part)]
        else:
            cur = cur[part]
    return cur


def set_path(obj, path, value):
    parts = path.split(".")
    cur = obj
    for part in parts[:-1]:
        if isinstance(cur, list):
            cur = cur[int(part)]
        else:
            cur = cur[part]
    last = parts[-1]
    if isinstance(cur, list):
        cur[int(last)] = copy.deepcopy(value)
    else:
        cur[last] = copy.deepcopy(value)


def fail(message):
    raise SystemExit(f"SAFETY CHECK FAILED: {message}")


def always_open_access():
    return {
        "limited": False,
        "days": {
            str(day): {"open": True, "start": "00:00", "end": "24:00"}
            for day in range(7)
        },
        "afterCloseMode": "exit_allowed",
        "afterCloseNote": "Accès 24 h/24, 7 j/7 indiqué par Tesla.",
    }


def expand_compact_station(item):
    required = (
        "id", "name", "countryCode", "powerKw", "stalls", "address",
        "latitude", "longitude", "teslaUrl", "pricing", "lastUpdated",
    )
    missing = [key for key in required if key not in item]
    if missing:
        fail(f"compact station {item.get('id', '?')} missing fields: {missing}")
    power = int(item["powerKw"])
    stalls = int(item["stalls"])
    lat = float(item["latitude"])
    lon = float(item["longitude"])
    pricing = copy.deepcopy(item["pricing"])
    return {
        "id": item["id"],
        "name": item["name"],
        "kind": "DC",
        "source": "teslaSupercharger",
        "countryCode": item["countryCode"],
        "department": "",
        "powerKw": power,
        "stalls": stalls,
        "address": item["address"],
        "latitude": lat,
        "longitude": lon,
        "mapsUrl": f"https://maps.google.com/maps?daddr={lat},{lon}",
        "teslaUrl": item["teslaUrl"],
        "pricing": pricing,
        "access": always_open_access(),
        "lastUpdated": item["lastUpdated"],
        "temporarilyUnavailable": bool(item.get("temporarilyUnavailable", False)),
        "operator": "Tesla",
        "chargingConfigurations": [
            {
                "id": "main",
                "label": f"DC {power} kW",
                "kind": "DC",
                "powerKw": power,
                "stalls": stalls,
                "pricing": copy.deepcopy(pricing),
            }
        ],
    }


def main_configuration(station):
    configs = station.get("chargingConfigurations") or []
    if not configs:
        return None
    for config in configs:
        if config.get("id") == "main":
            return config
    if len(configs) == 1:
        return configs[0]
    return None


def sync_derived_field(station, field):
    config = main_configuration(station)
    if config is None:
        return
    if field == "stalls":
        config["stalls"] = station.get("stalls")
    elif field == "powerKw":
        config["powerKw"] = station.get("powerKw")
        if config.get("kind", station.get("kind", "DC")) == "DC":
            config["label"] = f"DC {station.get('powerKw')} kW"
    elif field == "pricing.rules":
        config["pricing"] = copy.deepcopy(station.get("pricing") or {})


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
    additions.extend(expand_compact_station(item) for item in delta.get("compactNewStations", []))

    for payload_name in delta.get("payloadFiles", []):
        payload_path = Path(payload_name)
        if not payload_path.is_file():
            fail(f"payload file does not exist: {payload_name}")
        payload = json.loads(payload_path.read_text(encoding="utf-8"))
        additions.extend(payload.get("newStations", []))
        additions.extend(expand_compact_station(item) for item in payload.get("compactNewStations", []))

    manual_reviews = delta.get("manualReviewKeep", [])
    suspected_keeps = delta.get("suspectedRemovalKeep", [])
    expected_changes = delta.get("expectedChanges", [])

    add_ids = [station["id"] for station in additions]
    manual_ids = [item["id"] for item in manual_reviews]
    change_ids = [item["id"] for item in expected_changes]

    for label, ids in (
        ("addition", add_ids),
        ("manual review", manual_ids),
        ("automatic change", change_ids),
    ):
        if len(ids) != len(set(ids)):
            fail(f"duplicate ID in {label} set")

    overlap = set(manual_ids) & (set(add_ids) | set(change_ids))
    if overlap:
        fail(f"manual-review stations would be modified: {sorted(overlap)}")

    existing_adds = set(add_ids) & set(by_id)
    if existing_adds:
        fail(f"new station IDs already exist: {sorted(existing_adds)}")

    missing_changes = set(change_ids) - set(by_id)
    if missing_changes:
        fail(f"automatic-change station IDs missing from baseline: {sorted(missing_changes)}")

    missing_manual = set(manual_ids) - set(by_id)
    if missing_manual:
        fail(f"manual-review station IDs missing from baseline: {sorted(missing_manual)}")

    for item in suspected_keeps:
        if item["id"] not in by_id:
            fail(f"protected suspected-removal station missing from baseline: {item['id']}")

    manual_before = {station_id: copy.deepcopy(by_id[station_id]) for station_id in manual_ids}

    for item in expected_changes:
        station_id = item["id"]
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

    updated = copy.deepcopy(stations)
    updated_by_id = {station["id"]: station for station in updated}
    for item in expected_changes:
        station = updated_by_id[item["id"]]
        for change in item.get("changes", []):
            field = change["field"]
            set_path(station, field, change["after"])
            sync_derived_field(station, field)

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

    for item in expected_changes:
        station = after_by_id[item["id"]]
        fields = {change["field"] for change in item.get("changes", [])}
        config = main_configuration(station)
        if "pricing.rules" in fields and config is not None and config.get("pricing") != station.get("pricing"):
            fail(f"pricing/configuration mismatch after publication: {item['id']}")
        if "stalls" in fields and config is not None and config.get("stalls") != station.get("stalls"):
            fail(f"stall/configuration mismatch after publication: {item['id']}")
        if "powerKw" in fields and config is not None and config.get("powerKw") != station.get("powerKw"):
            fail(f"power/configuration mismatch after publication: {item['id']}")

    stations_path.write_text(json.dumps(updated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    source = delta.get("source", {})
    print(
        "PUBLICATION READY — "
        f"{expected_before} -> {expected_after} stations; "
        f"added={len(additions)}; automatic stations={len(expected_changes)}; "
        f"automatic fields={sum(len(item.get('changes', [])) for item in expected_changes)}; "
        f"manual reviews preserved={len(manual_reviews)}; "
        f"suspected removals preserved={len(suspected_keeps)}; "
        f"source global run=#{source.get('runNumber', '?')}."
    )


if __name__ == "__main__":
    main()
