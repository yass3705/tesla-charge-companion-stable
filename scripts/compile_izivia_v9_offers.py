#!/usr/bin/env python3
import gzip,json
from datetime import datetime,timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
MANIFEST=ROOT/'data/v9/france-static/manifest.json'
OUTPUT=ROOT/'data/v9/france-izivia-offers.json'

def txt(v): return str(v or '').strip()
def norm(v):
    import unicodedata,re
    s=''.join(c for c in unicodedata.normalize('NFD',txt(v)) if unicodedata.category(c)!='Mn').lower()
    return re.sub(r'(^-+|-+$)','',re.sub(r'[^a-z0-9]+','-',s))

def main():
    manifest=json.loads(MANIFEST.read_text(encoding='utf-8'))
    rows=json.loads(gzip.decompress((MANIFEST.parent/manifest['allFile']).read_bytes()).decode('utf-8'))
    offers=[];stats={'mampStations':0,'mampPdcs':0,'eligible22Pdcs':0,'eligible24Pdcs':0,'otherPowerPdcs':0}
    for row in rows:
        if norm(row[10] if len(row)>10 and row[10] else row[5])!='mamp': continue
        stats['mampStations']+=1
        for idx,cfg in enumerate(row[8] or []):
            pdc_ids=sorted({txt(x) for x in (cfg[6] or []) if txt(x)})
            stats['mampPdcs']+=len(pdc_ids)
            power=float(cfg[3] or 0)
            if power not in (22.0,24.0):
                stats['otherPowerPdcs']+=len(pdc_ids); continue
            if not pdc_ids: continue
            price=0.38 if power==22.0 else 0.44
            label='22kW AC' if power==22.0 else '24kW DC'
            stats['eligible22Pdcs' if power==22.0 else 'eligible24Pdcs']+=len(pdc_ids)
            offers.append({
                'id':f'izivia-mamp-{int(power)}-{txt(row[0]).lower()}-{idx}',
                'selectionId':f'izivia-mamp-{int(power)}-{txt(row[0]).lower()}-{idx}',
                'provider':'IZIVIA MAMP direct',
                'operatorAliases':['IZIVIA'],
                'networkAliases':['MAMP'],
                'countries':['FR'],
                'evseIds':pdc_ids,
                'currency':'EUR','priority':125,
                'pricing':{'type':'kwh','pricePerKwh':price},
                'source':'https://izivia.com/installation-bornes-de-recharge/metropole-aix-marseille-provence',
                'verifiedScope':'exact_evse','defaultSelected':False,
                'metadata':{
                    'network':'MAMP','officialTariffClass':label,'officialPricePerKwhEur':price,
                    'officialScopeOnly':True,'networkWideGeneralization':False,
                    'unsupportedMampPowersDeferred':True,'physicalInventorySource':'france-national'
                }
            })
    assert stats['mampStations']>=50,'MAMP exact network identity unexpectedly small'
    assert stats['eligible22Pdcs']>0 and stats['eligible24Pdcs']>0,'Expected both official MAMP tariff classes'
    assert all(o['evseIds'] for o in offers),'Every IZIVIA rule must be exact-EVSE scoped'
    payload={
        'schemaVersion':1,'country':'FR','generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),
        'mode':'official_exact_mamp_evse','policy':{
            'physicalInventoryCreated':False,'exactNetworkRequired':'MAMP','exactEvseRequired':True,
            'geographicFallback':False,'subscriptionsOptIn':True,'unsupportedPowersFailClosed':True
        },
        'directOffers':offers,'subscriptionOffers':[],
        'sourceEvidence':{
            'officialUrl':'https://izivia.com/installation-bornes-de-recharge/metropole-aix-marseille-provence',
            'officialTariffs':{'22kWAcEurPerKwh':0.38,'24kWDcEurPerKwh':0.44},
            'nationalGeneratedAt':manifest.get('generatedAt'),'stats':stats
        }
    }
    OUTPUT.parent.mkdir(parents=True,exist_ok=True)
    OUTPUT.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'output':str(OUTPUT.relative_to(ROOT)),'offerRules':len(offers),**stats},ensure_ascii=False))

if __name__=='__main__': main()
