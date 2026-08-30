#!/usr/bin/env python3
import gzip,json,pathlib

root=pathlib.Path('build/germany-sites')
rows=json.loads(gzip.decompress((root/'all.json.gz').read_bytes()))
by_id={str(r[0]):r for r in rows}
policy=json.loads(pathlib.Path('data/v9/germany-totalenergies-station-pricing.json').read_text())

assert policy['country']=='DE'
assert policy['operator']=='TotalEnergies'
assert policy['pricingMode']=='station-specific'
assert policy['rankableWithoutStationPrice'] is False
p=policy['policy']
assert p['nationalFallbackForbidden'] is True
assert p['foreignCountryFallbackForbidden'] is True
assert p['roamingSeparatedFromDirectCpo'] is True
assert p['blockingFeeStationSpecific'] is True

overrides=policy.get('temporaryOverrides',[])
assert len(overrides)==1
o=overrides[0]
assert o['paymentMode']=='adhoc-card'
assert o['connectorKinds']==['DC']
assert o['currency']=='EUR'
assert abs(float(o['pricePerKwh'])-0.59)<1e-9
assert o['validUntil']=='2026-08-31T23:59:59+02:00'
site_ids=o['siteIds']
assert len(site_ids)==13 and len(site_ids)==len(set(site_ids))

for sid in site_ids:
    assert sid in by_id, f'missing promo site {sid}'
    r=by_id[sid]
    assert r[5]=='TotalEnergies', (sid,r[5])
    kinds={c[2] for c in r[8]}
    assert 'DC' in kinds, (sid,kinds)

# The AC-only TotalEnergies group at the Brandenburg promotion address must not inherit the DC promo.
brandenburg_ac=[r for r in rows if r[5]=='TotalEnergies' and 'An der Bundesstraße 1, 14776, Brandenburg an der Havel' in r[2] and {c[2] for c in r[8]}=={'AC'}]
assert len(brandenburg_ac)==1, [(r[0],r[2]) for r in brandenburg_ac]
assert brandenburg_ac[0][0] not in site_ids

# TotalEnergies Germany remains station-specific outside the exact temporary overrides.
total_sites=[r for r in rows if r[5]=='TotalEnergies']
assert len(total_sites)>=300
assert len(site_ids)<len(total_sites)

print(json.dumps({'totalEnergiesSiteCount':len(total_sites),'temporaryPromoSiteGroupCount':len(site_ids),'pricePerKwh':o['pricePerKwh'],'validUntil':o['validUntil'],'nationalFallbackForbidden':p['nationalFallbackForbidden']},indent=2,ensure_ascii=False))
