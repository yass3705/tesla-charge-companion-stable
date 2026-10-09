#!/usr/bin/env python3
"""Ensure the PAGES V9 preview uses the latest Mac Tesla catalogue.

The main Pages workflow intentionally pins all other V9 data sources. Tesla is
the only live exception: fresh Mac country-batch metadata is overlaid into the
pinned production build input. Do not call this from an unrelated release.
"""
from __future__ import annotations
import argparse
from collections import Counter
from datetime import datetime, date
from hashlib import sha256
import json
from pathlib import Path
import shutil
from zoneinfo import ZoneInfo

def load(path):
    return json.loads(path.read_text(encoding='utf8'))

def digest(path):
    return sha256(path.read_bytes()).hexdigest()

def prepare(site,pinned_stable,prod):
    canonical=site/'data/tesla_stations.json'
    metadata=site/'data/tesla-mac-catalogue-publication.json'
    if not canonical.is_file() or not metadata.is_file():
        raise SystemExit('Canonical Mac Tesla source or synchronizer provenance missing')
    meta=load(metadata)
    rows=load(canonical)
    if not isinstance(rows,list) or len(rows)<1100 or len(set(s['id'] for s in rows))!=len(rows):
        raise SystemExit('Invalid Mac canonical source')
    if meta.get('canonicalSha256')!=digest(canonical) or meta.get('stationCount')!=len(rows):
        raise SystemExit('Mac synchronization metadata checksum mismatch')
    if digest(site/'v9-production-runtime/data/tesla_stations.json')!=digest(canonical):
        raise SystemExit('Mac V9 mirror must be synchronized before Pages deploy')
    mirror=pinned_stable/'data/tesla_stations.json'
    mirror.parent.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(canonical,mirror)
    # Keep the pinned baseline runtime consistent within the ephemeral build.
    shutil.copyfile(canonical,pinned_stable/'v9-production-runtime/data/tesla_stations.json')
    safe_priority=site/'scripts/tesla_v9_tariff_priority_safe.py'
    if not safe_priority.is_file():
        raise SystemExit('Required safe Tesla precedence module missing')
    shutil.copyfile(safe_priority,prod/'scripts/tesla_tariff_priority.py')
    engine_path=prod/'runtime-overrides/assets/v9/pricing-engine.js'
    engine_text=engine_path.read_text(encoding='utf8')
    engine_extension=(site/'scripts/tcc_v9_pricing_runtime_extension_20261010.js').read_text(encoding='utf8')
    if engine_text.count('  function evaluateOffer(offer,session={})')!=1:
        raise SystemExit('V9 production pricing engine signature changed: refuse unsafe patch')
    anchor='  return{congestionBillableMinutes,congestionFee,evaluateOffer,'
    if engine_text.count(anchor)!=1:
        raise SystemExit('V9 production pricing exports changed: refuse unsafe patch')
    engine_text=engine_text.replace('  function evaluateOffer(offer,session={})',
                                    '  function evaluateOfferBase(offer,session={})',1)
    engine_text=engine_text.replace(anchor,engine_extension+'\n'+anchor,1)
    engine_path.write_text(engine_text,encoding='utf8')
    adapter_src=pinned_stable/'v9-production-runtime/assets/v9/adapters/tesla-json.js'
    adapter=adapter_src.read_text(encoding='utf8')
    first=adapter.index('  function normalizedPricing(')
    last=adapter.index('  function configRows(',first)
    adapter=adapter[:first]+'''  function normalizedPricing(pricing,powerKw){
    // Keep all real source power-minute bands. Never flatten against stall power.
    return clone(pricing);
  }
  function sourceCurrency(pricing,countryCode){
    const rules=Array.isArray(pricing?.rules)?pricing.rules:[];
    const native=[...new Set(rules.map(r=>String(r.currency||'').trim().toUpperCase()).filter(Boolean))];
    const country={'CH':'CHF','GB':'GBP','UK':'GBP','MA':'MAD'};
    if(native.length>1)return null;
    return native[0]||String(pricing?.currency||country[countryCode]||'EUR').toUpperCase();
  }
'''+adapter[last:]
    original="""      if(cfg?.pricing||raw?.pricing)offers.push({
        id:`tesla-direct:${evseId}`,
        provider:'Tesla',kind:'direct',subscriptionId:null,countries:[text(raw?.countryCode).toUpperCase()||'*'],currency:'EUR',
        evseIds:[evseId],pricing:normalizedPricing(cfg?.pricing||raw?.pricing,cfg?.powerKw||raw?.powerKw),priority:100
      });"""
    updated="""      if(cfg?.pricing||raw?.pricing){
        const sourcePricing=cfg?.pricing||raw?.pricing;
        const currency=sourceCurrency(sourcePricing,text(raw?.countryCode).toUpperCase());
        offers.push({
          id:`tesla-direct:${evseId}`,
          provider:'Tesla',kind:'direct',subscriptionId:null,
          countries:[text(raw?.countryCode).toUpperCase()||'*'],currency:currency||'UNKNOWN',
          evseIds:[evseId],pricing:normalizedPricing(sourcePricing,cfg?.powerKw||raw?.powerKw),
          metadata:currency?{}:{incompletePricingReason:'tesla_mixed_native_currencies'},
          priority:100
        });
      }"""
    if adapter.count(original)!=1:
        raise SystemExit('Pinned Tesla adapter shape changed: abort')
    adapter=adapter.replace(original,updated,1)
    adapter_dest=prod/'runtime-overrides/assets/v9/adapters/tesla-json.js'
    adapter_dest.parent.mkdir(parents=True,exist_ok=True)
    adapter_dest.write_text(adapter,encoding='utf8')
    session_path=prod/'runtime-overrides/assets/v9/session-engine.js'
    session_src=session_path.read_text(encoding='utf8')
    original_lock="""    const locked=validity.complete?evaluateSessionStartLockedOffer(offer,effectiveSession):null;
      const timeline=validity.complete&&!locked?evaluateTimelineOffer(offer,effectiveSession):null;"""
    adjusted_lock="""    // Surcharges and Tesla dynamic-power rules require the complete pricing engine.
      const fullPricing=Boolean((offer?.pricing?.rules||[]).some(rule=>
        Number(rule?.afterMinutesRate)>0||rule?.billing==='powerMinute'));
      const locked=validity.complete&&!fullPricing?evaluateSessionStartLockedOffer(offer,effectiveSession):null;
      const timeline=validity.complete&&!locked&&!fullPricing?evaluateTimelineOffer(offer,effectiveSession):null;"""
    if session_src.count(original_lock)!=1:
        raise SystemExit('V9 session engine path changed: cannot protect afterMinutes')
    session_src=session_src.replace(original_lock,adjusted_lock,1)
    raw_return="""    return{...session,requestedEnergyKwh:requested,approachEnergyKwh:approach,energyKwh:money(Math.max(0,requested+(include?approach:0)))};"""
    tz_return="""    const zones={FR:'Europe/Paris',IT:'Europe/Rome',CH:'Europe/Zurich',DE:'Europe/Berlin',
      ES:'Europe/Madrid',NL:'Europe/Amsterdam',BE:'Europe/Brussels',GB:'Europe/London',
      UK:'Europe/London',MA:'Africa/Casablanca',PT:'Europe/Lisbon',LU:'Europe/Luxembourg'};
    const cc=String(station?.countryCode||'').toUpperCase();
    const timeZone=session.timeZone||station?.timeZone||zones[cc]||null;
    return{...session,timeZone,requestedEnergyKwh:requested,approachEnergyKwh:approach,energyKwh:money(Math.max(0,requested+(include?approach:0)))};"""
    if session_src.count(raw_return)!=1:
        raise SystemExit('V9 station session timezone dispatch changed')
    session_src=session_src.replace(raw_return,tz_return,1)
    session_path.write_text(session_src,encoding='utf8')
    # Snapshot-only exclusion: Tesla ID 30168 duplicates the same twelve public
    # Dartford Centre stalls as dartfordservicecentresuperchargerq122.
    # Canonical Mac extraction and sync mirrors retain the unmodified source.
    filter_path=prod/'scripts/tesla_v9_public_site_dedup_20261010.py'
    shutil.copyfile(site/'scripts/tesla_v9_public_site_dedup_20261010.py',filter_path)
    builder_path=prod/'scripts/build_snapshot.py'
    builder=builder_path.read_text(encoding='utf8')
    builder_anchor='    # Netherlands: optionally replace the legacy Stable baseline'
    if builder.count(builder_anchor)!=1:
        raise SystemExit('V9 build pipeline hook changed: cannot safely filter duplicate')
    builder_hook="""    # Prevent known duplicate public Tesla listings from appearing as extra sites.
    subprocess.run([sys.executable,str(production_root/'scripts/tesla_v9_public_site_dedup_20261010.py'),
                    '--preview',str(out)],check=True)
"""
    builder=builder.replace(builder_anchor,builder_hook+builder_anchor,1)
    builder_path.write_text(builder,encoding='utf8')
    print('TESLA_DARTFORD_30168_KNOWN_DUPLICATE_FILTER_INSTALLED')
    print('TCC_V9_SESSION_ENGINE_COMPLEX_TARIFF_DISPATCH_APPLIED')
    print('TESLA_ADAPTER_NATIVE_CURRENCIES_AND_REAL_POWER_BANDS_APPLIED')
    print('TCC_V9_ENGINE_EXACT_AFTER_MINUTES_AND_POWER_MINUTE_APPLIED')
    # The Pages shell is production-owned and pinned. Patch the ephemeral build
    # copy, never rewrite the committed/immutable candidate baseline.
    bridge_path=prod/'v9-production-shell/bridge.js'
    bridge=bridge_path.read_text(encoding='utf8')
    label_fn=(site/'scripts/tcc_v9_tariff_failure_labels_20261010.js').read_text(encoding='utf8')
    label_anchor='  function displayAmount(item,fxRates={}){'
    if bridge.count(label_anchor)!=1 or bridge.count('  function tariffLaneState(')!=1:
        raise SystemExit('V9 public tariff UI contracts changed; manual review required')
    bridge=bridge.replace(label_anchor,label_fn+'\n'+label_anchor,1)
    lane_before="""      const amount=state.status==='ambiguous'?'Tarif ambigu à vérifier auprès de l’opérateur'
        :state.status==='unresolved'?'Tarif à vérifier auprès de l’opérateur'
        :state.status==='priced'?displayAmount(displayItem,fxRates):'Tarif non disponible';"""
    lane_after="""      const amount=state.status==='priced'?displayAmount(displayItem,fxRates)
        :tariffFailureLabel(state.offers,station,state.status);"""
    if bridge.count(lane_before)!=1:
        raise SystemExit('V9 tariff lane failure rendering changed; refuse unsafe patch')
    bridge=bridge.replace(lane_before,lane_after,1)
    tesla_before="""      return item?'<div class="v9-tesla-price"><strong>Tesla</strong> · '+esc(displayAmount(item,fxRates))+'</div>':'<div class="v9-tesla-price">Tarif non disponible</div>';"""
    tesla_after="""      const failed=[evaluation?.best,...(evaluation?.alternatives||[]),...(evaluation?.incomplete||[])].filter(Boolean);
      return item?'<div class="v9-tesla-price"><strong>Tesla</strong> · '+esc(displayAmount(item,fxRates))+'</div>':'<div class="v9-tesla-price">'+esc(tariffFailureLabel(failed,station,'unresolved'))+'</div>';"""
    if bridge.count(tesla_before)!=1:
        raise SystemExit('V9 Tesla tariff failure rendering changed; refuse unsafe patch')
    bridge=bridge.replace(tesla_before,tesla_after,1)
    # For both map labels and hover text, make the reason visible, not only
    # an unexplained dash. 'Incalculable' is reserved for known tariffs.
    map_before="""best?formatCurrencyAmount(best.total,best.targetCurrency||currencyForCountry(nearby[0]?.station?.countryCode)):'—'"""
    map_after="""best?formatCurrencyAmount(best.total,best.targetCurrency||currencyForCountry(nearby[0]?.station?.countryCode)):nearby.some(row=>tariffFailureLabel([row.evaluation?.best,...(row.evaluation?.alternatives||[]),...(row.evaluation?.incomplete||[])],row.station,'unresolved')==='Tarif incalculable')?'Incalculable':'Indisponible'"""
    if bridge.count(map_before)!=1:
        raise SystemExit('V9 map marker pricing label changed; cannot safely classify')
    bridge=bridge.replace(map_before,map_after,1)
    # Existing marker title/aria uses the fallback text and must no longer
    # claim 'Tarif indisponible' when the label indicates ambiguity.
    map_title_before="""best?'Session dès '+amount:'Tarif indisponible'"""
    map_title_after="""best?'Session dès '+amount:'Tarif '+amount.toLowerCase()"""
    map_aria_before="""best?'session dès '+amount:'tarif indisponible'"""
    map_aria_after="""best?'session dès '+amount:'tarif '+amount.toLowerCase()"""
    if bridge.count(map_title_before)!=1 or bridge.count(map_aria_before)!=1:
        raise SystemExit('V9 map tooltip contract changed; cannot safely classify')
    bridge=bridge.replace(map_title_before,map_title_after,1)
    bridge=bridge.replace(map_aria_before,map_aria_after,1)
    guide_before="""Les tarifs non validés ou non comparables restent signalés comme indisponibles."""
    guide_after="""Tarif incalculable : calcul ambigu malgré des données tarifaires. Tarif indisponible : aucune offre exploitable."""
    if guide_before in bridge:
        bridge=bridge.replace(guide_before,guide_after)
    bridge_path.write_text(bridge,encoding='utf8')
    print('TCC_V9_TARIFF_FAILURE_LABELS_INSTALLED')
    updates_path=prod/'data/tesla_mac_country_updates.json'
    updates=load(updates_path)
    if updates.get('schemaVersion')!=1 or updates.get('timeZone')!='Europe/Paris':
        raise SystemExit('Unexpected pinned Tesla country priority metadata')
    countries=updates.setdefault('countries',{})
    changed=[]
    for cc,stats in (meta.get('countries') or {}).items():
        batch=stats.get('lastMacCountryBatch') or {}
        published=batch.get('publishedAt')
        if not published:
            continue
        stamp=datetime.fromisoformat(published.replace('Z','+00:00'))
        if stamp.tzinfo is None:raise SystemExit(f'Mac batch lacks timezone: {cc}')
        day=stamp.astimezone(ZoneInfo('Europe/Paris')).date()
        if day>datetime.now(ZoneInfo('Europe/Paris')).date():
            raise SystemExit(f'Future Mac batch timestamp for {cc}')
        former=countries.get(cc,{}).get('updatedOn')
        if former is not None and date.fromisoformat(former)>day:
            raise SystemExit(f'Refusing to regress Mac update evidence {cc}')
        countries[cc]={
            **(countries.get(cc) or {}),
            'updatedOn':day.isoformat(),
            'publicationCommitSha':batch.get('commitSha'),
            'dateMeaning':'country Mac publication; not the station sourceObservedAt',
            'macSourceSha256':meta['canonicalSha256'],
        }
        changed.append(cc)
    updates_path.write_text(json.dumps(updates,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    ctx={
        'schemaVersion':1,'source':str(canonical),
        'canonicalSha256':digest(canonical),'stations':len(rows),
        'lastMacPublications':{cc:stats.get('lastMacCountryBatch') for cc,stats in meta['countries'].items()},
        'timeAuthority':'Mac country publication, NOT invented station observation',
        'productionInputsPinnedExceptTesla':True,
        'priorityMetadata':str(updates_path),
        'priorityModule':'Mac <10d; newer SuC observation ONLY if strictly newer after 10d',
        'dateRule':'Mac country age 0-9 days; after 10d SuC only if observed price newer; Morocco always Mac'
    }
    (site/'tesla-pages-live-source.json').write_text(json.dumps(ctx,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
    print('TESLA_PAGES_LIVE_PREPARED='+json.dumps({
        'stationCount':len(rows),'sha256':ctx['canonicalSha256'],
        'updatedCountryEntries':sorted(changed)},ensure_ascii=False))

def verify(site,preview):
    ctx=load(site/'tesla-pages-live-source.json')
    source=site/'data/tesla_stations.json'
    selected=preview/'runtime/data/tesla_stations.json'
    ctrl=preview/'data/tesla_stations.json'
    report=preview/'snapshot-inputs/TESLA/tariff-selection.json'
    for p in (selected,ctrl,report):
        if not p.is_file():raise SystemExit('V9 built snapshot missing Tesla file: '+str(p))
    stations=load(selected);mac=load(source)
    from tesla_v9_public_site_dedup_20261010 import ALIAS,CANONICAL,SECOND,remove_dartford_duplicate
    expected,alias=remove_dartford_duplicate(mac)
    if len(stations)!=len(mac)-1 or [s['id'] for s in stations]!=[s['id'] for s in expected]:
        raise SystemExit('V9 preview station IDs differ from the canonical Mac catalogue minus 30168')
    # Germany may legitimately use the newer SuC country rates. UK has a
    # fresh Mac country publication, and must match Mac exactly, except alias.
    mac_gb={s['id']:s for s in expected if s.get('countryCode')=='GB'}
    snapshot_gb={s['id']:s for s in stations if s.get('countryCode')=='GB'}
    if mac_gb!=snapshot_gb:
        raise SystemExit('UK V9 Tesla pricing diverges from current Mac priority')
    alias_report=preview/'snapshot-inputs/TESLA/public-site-aliases.json'
    aliases=load(alias_report)
    if aliases.get('sourceCount')!=len(mac) or aliases.get('publishedCount')!=len(stations):
        raise SystemExit('V9 preview alias audit provenance mismatch')
    if len(aliases.get('aliases',[]))!=1 or aliases['aliases'][0]['aliasId']!=ALIAS:
        raise SystemExit('V9 preview alias resolution is not the approved 30168 case')
    if not {CANONICAL,SECOND}.issubset({s['id'] for s in stations}):
        raise SystemExit('V9 public Dartford locations missing')
    if digest(ctrl)!=digest(selected):
        raise SystemExit('V9 preview root and runtime Tesla sources differ')
    decision=load(report)
    today=datetime.now(ZoneInfo('Europe/Paris')).date()
    for cc,st in ctx['lastMacPublications'].items():
        if not st:continue
        timestamp=datetime.fromisoformat(st['publishedAt'].replace('Z','+00:00'))
        age=(today-timestamp.astimezone(ZoneInfo('Europe/Paris')).date()).days
        normalized=cc if cc!='UK' else 'GB'
        row=decision['countries'].get(normalized)
        if 0<=age<10 and row:
            if row.get('preferredTariffSource')!='Mac' or row.get('sucTariffs')!=0:
                raise SystemExit(f'V9 preview ignored recent Mac tariff publication for country {cc}: {row}')
    ma=decision['countries'].get('MA')
    if not ma or ma.get('preferredTariffSource')!='Mac' or ma.get('sucTariffs')!=0:
        raise SystemExit('Morocco must always choose the Mac tariff')
    ctx['builtTeslaTariffDecisions']=decision['countries']
    # Keep provenance in the Pages ROOT, not inside the finalized V9 snapshot:
    # verify_candidate_manifest rejects any file added after snapshot manifesting.
    p=site/'tesla-pages-live-source.json'
    p.write_text(json.dumps(ctx,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
    print('TESLA_DARTFORD_PUBLIC_SITES_VERIFIED='+json.dumps({
        'rawMacStations':len(mac),'publicV9Stations':len(stations),
        'excludedDuplicateAlias':ALIAS,'kept':sorted([CANONICAL,SECOND])}))
    print('TESLA_PAGES_LIVE_VERIFIED='+json.dumps({
        'stations':len(stations),'sha256Mac':digest(source),
        'countryTariffDecisions':{k:{'preferred':v.get('preferredTariffSource'),
          'mac':v.get('macTariffs'),'suc':v.get('sucTariffs')} for k,v in decision['countries'].items()}
    },ensure_ascii=False))

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--site',type=Path,required=True)
    ap.add_argument('--pinned-stable',type=Path)
    ap.add_argument('--production',type=Path)
    ap.add_argument('--preview',type=Path)
    ap.add_argument('--mode',required=True,choices=('prepare','verify'))
    a=ap.parse_args()
    if a.mode=='prepare':
        if a.pinned_stable is None or a.production is None:
            ap.error('--prepare requires --pinned-stable and --production')
        prepare(a.site,a.pinned_stable,a.production)
    else:
        if a.preview is None:ap.error('--verify requires --preview')
        verify(a.site,a.preview)
if __name__=='__main__':main()
