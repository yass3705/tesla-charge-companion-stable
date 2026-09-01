#!/usr/bin/env python3
import json,sys
from pathlib import Path
p=Path(sys.argv[1] if len(sys.argv)>1 else 'build/germany-direct-offers.json')
d=json.loads(p.read_text());offers=d['directOffers']

def matches(operator):
 o=operator.casefold()
 return [x for x in offers if any(a.casefold()==o for a in x.get('operatorAliases',[])) or any(a.casefold()==o for a in x.get('networkAliases',[]))]

def providers(operator): return {x['provider'] for x in matches(operator)}
fast=providers('Fastned');ion=providers('IONITY');aral=providers('Aral pulse');enbw=providers('EnBW mobility+');swu=providers('SWU Energie');west=providers('Westfalen');eam=providers('EAM Natur Energie');bochum=providers('Stadtwerke Bochum');marke=providers('Mark-E');konstanz=providers('Stadtwerke Konstanz');bruchsal=providers('Stadtwerke Bruchsal');jolt=providers('JOLT Energy');heidelberg=providers('Stadtwerke Heidelberg');ruesselsheim=providers('Stadtwerke Rüsselsheim')
assert fast and all('Fastned' in x for x in fast),fast
assert ion and all('IONITY' in x for x in ion),ion
assert aral and all('Aral pulse' in x for x in aral),aral
assert enbw and all('EnBW mobility+' in x for x in enbw),enbw
assert swu and all('SWU' in x for x in swu),swu
assert west and all('Westfalen' in x for x in west),west
assert eam and all('EAM' in x for x in eam),eam
assert bochum and all('Stadtwerkedrive' in x for x in bochum),bochum
assert marke and all('Mark-E' in x for x in marke),marke
assert konstanz == {'Stadtwerke Konstanz Mobil'},konstanz
assert bruchsal == {'Stadtwerke Bruchsal / e-laden','Stadtwerke Bruchsal ad hoc'},bruchsal
assert jolt == {'JOLT Community','JOLT Pro','JOLT Express'},jolt
assert heidelberg == {'Stadtwerke Heidelberg Standard','Stadtwerke Heidelberg EMOBIL+'},heidelberg
assert ruesselsheim == {'Stadtwerke Rüsselsheim ÖkoStrom Mobil Basic','Stadtwerke Rüsselsheim ÖkoStrom Mobil Smart','Stadtwerke Rüsselsheim ÖkoStrom Mobil Plus','Stadtwerke Rüsselsheim ad hoc'},ruesselsheim
assert not providers('Tesla'), 'Tesla must never attach Germany non-Tesla direct offers'
fast_selection_ids={x['selectionId'] for x in matches('Fastned')}
assert {'fastned-de-standard','fastned-gold'} <= fast_selection_ids
assert 'fastned-de-app-promo' not in fast_selection_ids, 'expired Fastned app promo must not remain attachable after 2026-08-31'
assert {'ionity-de-direct','ionity-de-go','ionity-motion','ionity-power'} <= {x['selectionId'] for x in matches('IONITY')}
assert {'aral-pulse-de-ad-hoc','aral-pulse-klassik','aral-pulse-extra','aral-pulse-adac-e-charge'} <= {x['selectionId'] for x in matches('Aral pulse')}
assert {'enbw-mobility-plus-s','enbw-mobility-plus-m','enbw-mobility-plus-l'} == {x['selectionId'] for x in matches('EnBW mobility+')}
assert {'swu-de-ad-hoc','swu-ladestrom-classic'} == {x['selectionId'] for x in matches('SWU Energie')}
assert {'westfalen-service-card-echarge'} == {x['selectionId'] for x in matches('Westfalen')}
assert {'eam-de-ad-hoc'} == {x['selectionId'] for x in matches('EAM Natur Energie')}
assert {'stadtwerke-bochum-card'} == {x['selectionId'] for x in matches('Stadtwerke Bochum')}
assert {'mark-e-drivecard'} == {x['selectionId'] for x in matches('Mark-E')}
assert {'stadtwerke-konstanz-card-standard','stadtwerke-konstanz-card-green-customer','stadtwerke-konstanz-card-fairplus','stadtwerke-konstanz-ladeapp'} == {x['selectionId'] for x in matches('Stadtwerke Konstanz')}
assert {'stadtwerke-bruchsal-eladen','stadtwerke-bruchsal-adhoc'} == {x['selectionId'] for x in matches('Stadtwerke Bruchsal')}
assert {'jolt-community','jolt-pro','jolt-express'} == {x['selectionId'] for x in matches('JOLT Energy')}
assert {'stadtwerke-heidelberg-standard','stadtwerke-heidelberg-emobil-plus'} == {x['selectionId'] for x in matches('Stadtwerke Heidelberg')}
assert {'stadtwerke-ruesselsheim-basic','stadtwerke-ruesselsheim-smart','stadtwerke-ruesselsheim-plus','stadtwerke-ruesselsheim-adhoc'} == {x['selectionId'] for x in matches('Stadtwerke Rüsselsheim')}
for op in ('EnBW mobility+','SWU Energie','Westfalen','EAM Natur Energie','Stadtwerke Bochum','Mark-E','Stadtwerke Konstanz','Stadtwerke Bruchsal','JOLT Energy','Stadtwerke Heidelberg','Stadtwerke Rüsselsheim'):
 assert all(x.get('directOperatorOnly') is True for x in matches(op)),op
assert all(x.get('eligibility',{}).get('businessOnly') is True for x in matches('Westfalen'))
assert not matches('MER Germany GmbH'), 'Westfalen roaming tariffs must not attach as direct MER offers'
print(json.dumps({'Fastned':len(matches('Fastned')),'IONITY':len(matches('IONITY')),'Aral pulse':len(matches('Aral pulse')),'EnBW':len(matches('EnBW mobility+')),'SWU':len(matches('SWU Energie')),'Westfalen':len(matches('Westfalen')),'EAM':len(matches('EAM Natur Energie')),'Bochum':len(matches('Stadtwerke Bochum')),'Mark-E':len(matches('Mark-E')),'Konstanz':len(matches('Stadtwerke Konstanz')),'Bruchsal':len(matches('Stadtwerke Bruchsal')),'JOLT':len(matches('JOLT Energy')),'Heidelberg':len(matches('Stadtwerke Heidelberg')),'Rüsselsheim':len(matches('Stadtwerke Rüsselsheim'))},indent=2,ensure_ascii=False))
