#!/usr/bin/env python3
from audit_powerdot_connector_identity_v3 import recover_entry,tariff_signature

def tariff(price):
    return {'currencyCode':'EUR','subscriptionActive':False,'elements':[{'restrictions':{},'priceComponents':[{'type':'ENERGY','pricePerUnit':price}]}]}
def pdc(power,kind):
    return {'powerKw':power,'connectors':{'comboCcs':'true' if kind=='DC' else 'false','chademo':'false','type2':'true' if kind=='AC' else 'false'}}
def connector(power,kind,price):
    return {'type':1 if kind=='AC' else 2,'maxPowerKw':power,'tariff':tariff(price)}
def entry(ids,connectors):
    return {'irvePdcIds':ids,'charger':{'connectors':connectors}}

# Solaize-like case: heterogeneous entry, but each power/kind bucket is bijective
# and tariff-uniform. No connector ordering is needed.
pan={'P100A':pdc(100,'DC'),'P22':pdc(22,'AC'),'P50':pdc(50,'DC'),'P100B':pdc(100,'DC')}
e=entry(list(pan),[connector(100,'DC',.52),connector(22.08,'AC',.47),connector(50,'DC',.52),connector(100,'DC',.52)])
rows,reason=recover_entry(e,pan)
assert reason=='resolved' and len(rows)==4
by={r['pdcId']:r for r in rows}
assert tariff_signature(by['P22']['tariff'])==tariff_signature(tariff(.47))
assert all(tariff_signature(by[x]['tariff'])==tariff_signature(tariff(.52)) for x in ['P100A','P50','P100B'])
assert all(r['strategy']=='entry_power_kind_uniform' for r in rows)

# Same power/kind with heterogeneous tariffs is never split by array order.
pan2={'A':pdc(100,'DC'),'B':pdc(100,'DC')}
rows,reason=recover_entry(entry(['A','B'],[connector(100,'DC',.50),connector(100,'DC',.60)]),pan2)
assert rows==[] and reason=='no_bijective_uniform_bucket'

# One source bucket compatible with two PAN power buckets is ambiguous.
pan3={'A':pdc(49.5,'DC'),'B':pdc(50.0,'DC')}
rows,reason=recover_entry(entry(['A','B'],[connector(50,'DC',.52)]),pan3)
assert rows==[]

# Cardinality mismatch blocks the bucket.
pan4={'A':pdc(100,'DC')}
rows,reason=recover_entry(entry(['A'],[connector(100,'DC',.52),connector(100,'DC',.52)]),pan4)
assert rows==[]

# Missing nominal power is not guessed.
pan5={'A':{'powerKw':None,'connectors':{'comboCcs':'true'}}}
rows,reason=recover_entry(entry(['A'],[connector(100,'DC',.52)]),pan5)
assert rows==[] and reason=='pan_identity_missing'
print('Powerdot connector identity v3 semantics: OK')
