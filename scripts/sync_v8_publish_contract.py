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
from urllib.parse import quote


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


_LOCAL_ASSET_RE = re.compile(
    r"(?<![A-Za-z0-9:/])(?P<path>(?:\.\.?/)?assets/[A-Za-z0-9._/-]+\.(?:js|css))"
    r"(?P<query>\?[^'\"`\s<>)]*)?"
)


def stamp_preview_asset_urls(target_root: Path, deploy_id: str) -> int:
    """Give every local JS/CSS URL a deployment-unique cache key.

    Safari can keep an old HTTP-cache entry even after the document itself was
    refreshed. V8 historically used hand-maintained ?v= labels, which allowed a
    new Pages artifact to reuse an old module when a label was not bumped. The
    deploy id is appended to every literal local asset URL in the document and
    runtime loaders, so two Pages artifacts can never share a JS/CSS URL.
    """
    stamp = quote(deploy_id, safe="")
    assets_dir = target_root / "assets"
    candidates = [target_root / "index.html"]
    if assets_dir.is_dir():
        candidates.extend(sorted(p for p in assets_dir.iterdir() if p.suffix in {".js", ".css"}))

    total_refs = 0
    changed_files = 0
    for path in candidates:
        if not path.is_file():
            continue
        original = path.read_text(encoding="utf-8")
        file_refs = 0

        def repl(match: re.Match[str]) -> str:
            nonlocal file_refs
            resource = match.group("path")
            query_string = match.group("query") or ""
            if "_v8deploy=" in query_string:
                return match.group(0)
            separator = "&" if query_string else "?"
            file_refs += 1
            return f"{resource}{query_string}{separator}_v8deploy={stamp}"

        updated = _LOCAL_ASSET_RE.sub(repl, original)
        if updated != original:
            path.write_text(updated, encoding="utf-8")
            changed_files += 1
            total_refs += file_refs

    unstamped: list[str] = []
    for path in candidates:
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        for match in _LOCAL_ASSET_RE.finditer(text):
            if "_v8deploy=" not in (match.group("query") or ""):
                unstamped.append(f"{path.relative_to(target_root)}:{match.group(0)}")
                if len(unstamped) >= 8:
                    break
        if len(unstamped) >= 8:
            break
    if unstamped:
        fail("unstamped local asset URLs: " + "; ".join(unstamped))
    if total_refs < 20:
        fail(f"asset cache stamp coverage unexpectedly low: {total_refs}")
    print(
        f"V8 publish contract: deploy cache stamp applied to {total_refs} asset refs "
        f"across {changed_files} files ({deploy_id})"
    )
    return total_refs


def install_preview_cache_guard(registry_path: Path, target_root: Path) -> str:
    """Install deployment-aware protection against Safari/iOS cache staleness.

    The preview service worker is disabled, but Safari can restore a stale full
    document from bfcache and can retain old HTTP-cache entries for subresources.
    The guard detects a newer Pages artifact, retries cache-busted navigation when
    needed, and stamps same-origin fetches with the current deployment id.
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
  const RELOAD_KEY='tcc:v8-preview:reload-state';
  const marker='/v8-preview/';
  const markerIndex=location.pathname.indexOf(marker);
  const REPO_ROOT=markerIndex>=0?location.pathname.slice(0,markerIndex+1):'/';
  const nativeFetch=window.fetch.bind(window);
  let checking=false;

  window.TCC_V8_DEPLOY_ID=DEPLOY_ID;
  window.fetch=function(input,init){
    try{
      const isRequest=typeof Request!=='undefined'&&input instanceof Request;
      const method=String((init&&init.method)||(isRequest&&input.method)||'GET').toUpperCase();
      if(method==='GET'){
        const url=new URL(isRequest?input.url:input,location.href);
        if(url.origin===location.origin&&url.pathname.startsWith(REPO_ROOT)){
          url.searchParams.set('_v8deploy',DEPLOY_ID);
          input=isRequest?new Request(url.href,input):url.href;
        }
      }
    }catch(e){}
    return nativeFetch(input,init);
  };

  function readReloadState(){
    try{return JSON.parse(sessionStorage.getItem(RELOAD_KEY)||'{}')||{}}catch(e){return{}}
  }
  function writeReloadState(target,attempts){
    try{sessionStorage.setItem(RELOAD_KEY,JSON.stringify({target,attempts,at:Date.now()}))}catch(e){}
  }
  function clearReloadState(){try{sessionStorage.removeItem(RELOAD_KEY)}catch(e){}}
  function navigateToDeploy(remote,attempt){
    const next=attempt>=3?new URL('refresh.html',location.href):new URL(location.href);
    next.searchParams.set('_v8deploy',remote);
    next.searchParams.set('_refresh',String(Date.now()));
    next.searchParams.set('_cacheAttempt',String(attempt));
    location.replace(next.href);
  }
  async function check(reason){
    if(checking)return false;
    checking=true;
    try{
      const manifestUrl=new URL('preview-version.json',location.href);
      manifestUrl.searchParams.set('_',String(Date.now()));
      const response=await nativeFetch(manifestUrl.href,{cache:'no-store',headers:{'Cache-Control':'no-cache'}});
      if(!response.ok)return false;
      const payload=await response.json();
      const remote=String(payload&&payload.deployId||'').trim();
      if(!remote)return false;
      if(remote===DEPLOY_ID){clearReloadState();return false;}
      const state=readReloadState();
      const attempts=state.target===remote?Math.max(0,Number(state.attempts)||0):0;
      const nextAttempt=Math.min(attempts+1,3);
      writeReloadState(remote,nextAttempt);
      navigateToDeploy(remote,nextAttempt);
      return true;
    }catch(error){
      console.info('[TCC V8] Preview version check unavailable:',error&&error.message||error,reason||'');
      return false;
    }finally{
      checking=false;
    }
  }
  window.TCCV8PreviewVersion={deployId:DEPLOY_ID,check,repoRoot:REPO_ROOT};
  window.addEventListener('pageshow',()=>setTimeout(()=>check('pageshow'),0));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')setTimeout(()=>check('visible'),0);});
  window.addEventListener('online',()=>check('online'));
  setTimeout(()=>check('boot'),500);
})();
'''.replace("__DEPLOY_ID__", json.dumps(deploy_id))

    required_guard_tokens = (
        "window.TCC_V8_DEPLOY_ID=DEPLOY_ID",
        "window.fetch=function(input,init)",
        "url.searchParams.set('_v8deploy',DEPLOY_ID)",
        "nativeFetch(manifestUrl.href",
        "attempt>=3?new URL('refresh.html'",
    )
    missing_guard = [token for token in required_guard_tokens if token not in guard_source]
    if missing_guard:
        fail("preview cache guard contract incomplete: " + ", ".join(missing_guard))

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
    stamped_refs = stamp_preview_asset_urls(target_root, deploy_id)
    print(
        f"V8 publish contract OK: {len(entries)} main resources, "
        f"{sum(1 for s in registry.get('sources', []) if s.get('status') == 'active')} active sources, "
        f"{stamped_refs} deploy-stamped asset refs, preview deploy {deploy_id}"
    )


if __name__ == "__main__":
    main()
