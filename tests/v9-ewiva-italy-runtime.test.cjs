const assert=require('node:assert/strict');
const fs=require('node:fs');

const offers=JSON.parse(fs.readFileSync('data/v9/italy-offers.json','utf8'));
const ewivaDirect=offers.directOffers.filter(o=>o.sourceId==='ewiva-italy-pos-direct');
const ewivaEmsp=offers.emspOffers.filter(o=>String(o.id||'').startsWith('it:emsp:enel-on-your-way-ewiva:'));
const ewivaSuper=offers.subscriptionOffers.filter(o=>o.selectionId==='enel_plug_and_go_super'&&o.metadata?.network==='Ewiva');
const ewivaExplorer=offers.subscriptionOffers.filter(o=>o.selectionId==='enel_plug_and_go_explorer'&&o.metadata?.network==='Ewiva');

assert.equal(ewivaDirect.length,1271);
assert.equal(ewivaEmsp.length,1678);
assert.equal(ewivaSuper.length,1678);
assert.equal(ewivaExplorer.length,0);
assert.equal(offers.policy.ewivaEnelEmspCommercialSeparation,true);
assert.equal(offers.policy.ewivaExplorerFailClosed,true);
assert.ok(ewivaEmsp.every(o=>o.provider==='Enel On Your Way'));
assert.ok(ewivaEmsp.every(o=>o.metadata?.network==='Ewiva'));
assert.ok(ewivaEmsp.every(o=>o.metadata?.rankableAsCpoDirect===false));
assert.ok(ewivaEmsp.every(o=>o.pricing?.priceSelectionBasis==='session_start_local_time'));
assert.ok(ewivaEmsp.every(o=>o.pricing?.postChargeFeeUnknown===true));
assert.ok(ewivaSuper.every(o=>o.pricing?.priceSelectionBasis==='session_start_local_time'));
assert.ok(ewivaSuper.every(o=>o.monthlyFeeEur===4));
assert.ok(ewivaSuper.every(o=>o.validThrough==='2027-01-14'));
assert.ok(ewivaDirect.every(o=>o.provider==='Ewiva'));
assert.ok(ewivaDirect.every(o=>o.directOperatorOnly===true&&o.verifiedScope==='exact_evse'));
assert.ok(ewivaDirect.every(o=>o.pricing?.pricePerKwh===0.8&&o.pricing?.postChargeFeeUnknown===true));
assert.equal(offers.policy.ewivaDirectAndEnelEmspCommercialSeparation,true);

const byClass=ewivaEmsp.reduce((m,o)=>{const k=o.metadata?.tariffClass||'UNKNOWN';m[k]=(m[k]||0)+1;return m;},{});
assert.deepEqual(byClass,{AC:7,DC:31,HPC:1640});

const hpc=ewivaEmsp.find(o=>o.metadata?.tariffClass==='HPC');
assert.ok(hpc);
assert.equal(hpc.pricing.rules.length,1);
assert.equal(hpc.pricing.rules[0].scope,'allDay');
assert.equal(hpc.pricing.rules[0].pricePerKwh,0.86);
const hpcSuper=ewivaSuper.find(o=>o.metadata?.tariffClass==='HPC');
assert.ok(hpcSuper);
assert.equal(hpcSuper.pricing.rules[0].pricePerKwh,0.81);

// Keep the dedicated Ewiva workflow as the publication gate for these totals.
console.log('V9 Ewiva Italy runtime publication: OK');
