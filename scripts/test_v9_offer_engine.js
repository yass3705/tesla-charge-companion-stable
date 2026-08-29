const fs=require('fs');
const vm=require('vm');
const assert=require('assert');

const code=fs.readFileSync('assets/v9-offer-engine.js','utf8');
const events=[];
const sandbox={console,globalThis:{}};
sandbox.globalThis=sandbox;
sandbox.dispatchEvent=e=>events.push(e);
sandbox.CustomEvent=function(name,init){this.type=name;this.detail=init?.detail;};
vm.runInNewContext(code,sandbox,{filename:'v9-offer-engine.js'});
const engine=sandbox.TCCV9OfferEngine;
assert(engine,'engine missing');

const station={id:'ES-FASTNED-DEMO',country:'ES',operator:'Fastned',network:'Fastned',kind:'DC',powerKw:300};
const payload={
  directOffers:[{id:'fastned-standard-es',operatorAliases:['Fastned'],networkAliases:['Fastned'],countries:['ES'],connectorKinds:['DC'],pricePerKwh:0.59,currency:'EUR',priority:95}],
  subscriptionOffers:[{id:'fastned-gold-es',selectionId:'fastned-gold',subscriptionId:'fastned-gold',operatorAliases:['Fastned'],networkAliases:['Fastned'],countries:['ES'],connectorKinds:['DC'],pricePerKwh:0.41,currency:'EUR',priority:100}]
};
engine.setOfferPayloads([payload]);
engine.setSelectedSubscriptions([]);
let result=engine.chooseBestOffer(station);
assert.strictEqual(result.bestOffer.id,'fastned-standard-es');
assert.strictEqual(result.price.pricePerKwh,0.59);
assert.deepStrictEqual(result.candidates.map(x=>x.id),['fastned-standard-es']);

engine.setSelectedSubscriptions(['fastned-gold']);
result=engine.chooseBestOffer(station);
assert.strictEqual(result.bestOffer.id,'fastned-gold-es');
assert.strictEqual(result.price.pricePerKwh,0.41);
assert.deepStrictEqual(result.candidates.map(x=>x.id),['fastned-gold-es','fastned-standard-es']);

const frenchStation={...station,id:'FR-FASTNED-DEMO',country:'FR'};
result=engine.chooseBestOffer(frenchStation);
assert.strictEqual(result.bestOffer,null,'Spain offers must not leak into France');

const acStation={...station,id:'ES-FASTNED-AC',kind:'AC'};
result=engine.chooseBestOffer(acStation);
assert.strictEqual(result.bestOffer,null,'DC offers must not leak into AC');

console.log('V9 offer engine Fastned Spain runtime OK');
