#!/usr/bin/env python3
"""Copy main-maintained V8 resources according to the RC tariff source registry.

Usage from pages.yml:
  python site/scripts/sync_v8_publish_contract.py \
    --registry rc/data/v8_tariff_sources.json \
    --source-root site \
    --target-root site/v8-preview
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


def fail(message: str) -> None:
    raise SystemExit(f"V8 publish contract: {message}")


def load_registry(path: Path) -> dict:
    if not path.is_file():
        fail(f"registry missing: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"invalid registry JSON: {exc}")
    if data.get("schemaVersion") != 1:
        fail(f"unsupported schemaVersion: {data.get('schemaVersion')!r}")
    if data.get("contractVersion") != "v8-tariff-engine-1":
        fail(f"unsupported contractVersion: {data.get('contractVersion')!r}")
    return data


def safe_path(root: Path, relative: str) -> Path:
    rel = Path(relative)
    if rel.is_absolute() or ".." in rel.parts:
        fail(f"unsafe path in registry: {relative}")
    return root / rel


def copy_entry(entry: dict, source_root: Path, target_root: Path) -> None:
    source_rel = str(entry.get("path") or "").strip()
    target_rel = str(entry.get("target") or "").strip()
    kind = str(entry.get("kind") or "file").strip()
    required = entry.get("required", True) is not False
    if not source_rel or not target_rel:
        fail("copyFromMain entry requires path and target")
    if kind not in {"file", "directory"}:
        fail(f"unsupported copy kind {kind!r} for {source_rel}")

    source = safe_path(source_root, source_rel)
    target = safe_path(target_root, target_rel)
    exists = source.is_dir() if kind == "directory" else source.is_file()
    if not exists:
        if required:
            fail(f"required main resource missing: {source_rel}")
        print(f"V8 publish contract: optional resource skipped: {source_rel}")
        return

    target.parent.mkdir(parents=True, exist_ok=True)
    if kind == "directory":
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(source, target)
    else:
        shutil.copy2(source, target)
    print(f"V8 publish contract: {source_rel} -> {target_rel}")


def validate_active_sources(registry: dict, target_root: Path) -> None:
    errors: list[str] = []
    seen: set[str] = set()
    for source in registry.get("sources") or []:
        source_id = str(source.get("id") or "").strip()
        if not source_id:
            errors.append("source without id")
            continue
        if source_id in seen:
            errors.append(f"duplicate source id: {source_id}")
        seen.add(source_id)
        if source.get("status") != "active":
            continue
        for key in ("artifactPaths", "runtimeModules"):
            paths = source.get(key)
            if not isinstance(paths, list):
                errors.append(f"active source {source_id} missing {key}")
                continue
            for relative in paths:
                path = safe_path(target_root, str(relative))
                if not path.exists():
                    errors.append(f"active source {source_id} missing {relative}")
    if errors:
        fail("; ".join(errors))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--registry", required=True)
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--target-root", required=True)
    args = parser.parse_args()

    registry_path = Path(args.registry)
    source_root = Path(args.source_root)
    target_root = Path(args.target_root)
    registry = load_registry(registry_path)

    entries = registry.get("publish", {}).get("copyFromMain") or []
    if not isinstance(entries, list) or not entries:
        fail("publish.copyFromMain is empty")

    targets: set[str] = set()
    for entry in entries:
        target = str(entry.get("target") or "")
        if target in targets:
            fail(f"duplicate publish target: {target}")
        targets.add(target)
        copy_entry(entry, source_root, target_root)

    validate_active_sources(registry, target_root)
    print(
        f"V8 publish contract OK: {len(entries)} main resources, "
        f"{sum(1 for s in registry.get('sources', []) if s.get('status') == 'active')} active sources"
    )


if __name__ == "__main__":
    main()
