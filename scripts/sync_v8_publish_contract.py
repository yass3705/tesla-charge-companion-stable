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
import hashlib
import json
import os
import re
import shutil
from datetime import datetime, timezone
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


def preview_deploy_id(registry_path: Path, target_root: Path) -> str:
    run_id = str(os.environ.get("GITHUB_RUN_ID") or "").strip()
    attempt = str(os.environ.get("GITHUB_RUN_ATTEMPT") or "1").strip()
    sha = str(os.environ.get("GITHUB_SHA") or "").strip()
    if run_id:
        return f"gh-{run_id}-{attempt}-{sha[:12] or 'nosha'}"
    digest = hashlib.sha256()
    digest.update(registry_path.read_bytes())
    index = target_root / "index.html"
    if index.is_file():
        digest.update(index.read_bytes())
    return f"local-{digest.hexdigest()[:16]}"


def install_preview_cache_guard(registry_path: Path, target_root: Path) -> str:
    """Install a deployment-aware guard against Safari/iOS bfcache staleness.

    The preview keeps its service worker disabled, but a document restored from
    Safari's back/forward cache can still be an old full-page snapshot. The guard
    compares its embedded deployment id with a no-store manifest and navigates to
    a cache-busted URL when a newer Pages artifact is available.
    """
    index = target_root / "index.html"
    if not index.is_file():
        fail("preview index.html missing before cache guard installation")

    deploy_id = preview_deploy_id(registry_path, target_root)
    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    manifest = {
        "schemaVersion": 1,
        "deployId": deploy_id,
        "mainSha": str(os.environ.get("GITHUB_SHA") or ""),
        "runId": str(os.environ.get("GITHUB_RUN_ID") or ""),
        "runAttempt": str(os.environ.get("GITHUB_RUN_ATTEMPT") or ""),
        "generatedAt": generated_at,
    }
    (target_root / "preview-version.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    guard_source = r'''(function(){
  'use strict';
  if(!location.pathname.includes('/v8-preview/'))return;
  const DEPLOY_ID=__DEPLOY_ID__;
  const RELOAD_KEY='tcc:v8-preview:reload-target';
  let checking=false;
  async function check(reason){
    if(checking)return false;
    checking=true;
    try{
      const manifestUrl=new URL('preview-version.json',location.href);
      manifestUrl.searchParams.set('_',String(Date.now()));
      const response=await fetch(manifestUrl.href,{cache:'no-store',headers:{'Cache-Control':'no-cache'}});
      if(!response.ok)return false;
      const payload=await response.json();
      const remote=String(payload&&payload.deployId||'').trim();
      if(!remote)return false;
      if(remote===DEPLOY_ID){
        try{sessionStorage.removeItem(RELOAD_KEY);}catch(e){}
        return false;
      }
      try{
        const previous=sessionStorage.getItem(RELOAD_KEY);
        if(previous===remote)return false;
        sessionStorage.setItem(RELOAD_KEY,remote);
      }catch(e){}
      const next=new URL(location.href);
      next.searchParams.set('_v8deploy',remote);
      next.searchParams.set('_refresh',String(Date.now()));
      location.replace(next.href);
      return true;
    }catch(error){
      console.info('[TCC V8] Preview version check unavailable:',error&&error.message||error,reason||'');
      return false;
    }finally{
      checking=false;
    }
  }
  window.TCCV8PreviewVersion={deployId:DEPLOY_ID,check};
  window.addEventListener('pageshow',()=>setTimeout(()=>check('pageshow'),0));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')setTimeout(()=>check('visible'),0);});
  window.addEventListener('online',()=>check('online'));
  setTimeout(()=>check('boot'),750);
})();
'''.replace("__DEPLOY_ID__", json.dumps(deploy_id))

    assets = target_root / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    guard_path = assets / "v8-preview-cache-guard.js"
    guard_path.write_text(guard_source, encoding="utf-8")

    html = index.read_text(encoding="utf-8")
    html = re.sub(
        r'<script src="assets/v8-preview-cache-guard\.js\?v=[^"]+"></script>\s*',
        "",
        html,
    )
    tag = f'<script src="assets/v8-preview-cache-guard.js?v={deploy_id}"></script>'
    if "</head>" not in html:
        fail("preview index.html has no </head> for cache guard injection")
    html = html.replace("</head>", tag + "\n</head>", 1)
    index.write_text(html, encoding="utf-8")

    if deploy_id not in guard_source or tag not in html:
        fail("preview cache guard integrity check failed")
    print(f"V8 publish contract: preview cache guard installed ({deploy_id})")
    return deploy_id


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
    deploy_id = install_preview_cache_guard(registry_path, target_root)
    print(
        f"V8 publish contract OK: {len(entries)} main resources, "
        f"{sum(1 for s in registry.get('sources', []) if s.get('status') == 'active')} active sources, "
        f"preview deploy {deploy_id}"
    )


if __name__ == "__main__":
    main()
