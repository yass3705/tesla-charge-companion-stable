const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Cross=require('../assets/v9/cross-border-subscriptions.js');
const Runtime=require('../assets/v9/runtime-engine.js');

const root=path.resolve(__dirname,'..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const config={
  policy:read('data/v9/germany-cross-border-subscriptions.json'),
  fastned:read('data/v9/fastned-gold-country-prices.json'),
  ionity:read('data/v9/ionity-monthly-country-prices.json')
};

let r=Cross.resolve({subscriptionId:'fastned-gold',countryCode:'FR',physicalOperator:{name:'Fastned'}},config);
assert.equal(r.rankable,true);assert.equal(r.pricePerKwh,0.43);assert.equal(r.currency,'EUR');assert.equal(r.usedFallback,false);
r=Cross.resolve({subscriptionId:'fastned-gold',countryCode:'FR',physicalOperator:{name:'IONITY'}},config);
assert.equal(r.status,'unavailable');assert.equal(r.rankable,false);
r=Cross.resolve({subscriptionId:'fastned-gold',countryCode:'PT',physicalOperator:{name:'Fastned'}},config);
assert.equal(r.status,'unavailable');assert.equal(r.usedFallback,false,'German/home tariff must never be propagated to unsupported countries');

r=Cross.resolve({subscriptionId:'ionity-power',countryCode:'FR',physicalOperator:{name:'IONITY'}},config);
assert.equal(r.status,'minimum');assert.equal(r.pricePerKwh,0.33);assert.equal(r.rankable,false,'IONITY country minimum must not rank as exact');
r=Cross.resolve({subscriptionId:'ionity-power',countryCode:'FR',physicalOperator:{name:'IONITY'},exactStationPrice:0.35,exactStationCurrency:'EUR'},config);
assert.equal(r.status,'exact');assert.equal(r.pricePerKwh,0.35);assert.equal(r.rankable,true);

r=Cross.resolve({subscriptionId:'enbw-mobility-plus-m',countryCode:'FR',physicalOperator:{name:'Powerdot'}},config);
assert.equal(r.status,'station-specific-required');assert.equal(r.rankable,false);assert.equal(r.pricePerKwh,undefined);
r=Cross.resolve({subscriptionId:'enbw-mobility-plus-m',countryCode:'FR',physicalOperator:{name:'Powerdot'},exactStationPrice:0.63,exactStationCurrency:'EUR'},config);
assert.equal(r.rankable,true);assert.equal(r.pricePerKwh,0.63);

const fastnedStation={id:'fr-fastned',countryCode:'FR',name:'Fastned test',physicalOperator:{id:'fastned',name:'Fastned'},offers:[{id:'public',provider:'Fastned',kind:'direct',countries:['FR'],pricing:{pricePerKwh:0.61},sourceId:'direct',priority:95}]};
let st=Runtime.applySelectedSubscriptions(fastnedStation,['fastned-gold'],config,{});
assert.equal(st.physicalOperator.name,'Fastned','cross-border subscription must not overwrite physical CPO identity');
assert.equal(st.eligibleOffers.some(o=>o.subscriptionId==='fastned-gold'),true);
assert.equal(st.rankableOffers.find(o=>o.subscriptionId==='fastned-gold').pricing.pricePerKwh,0.43);

const ionityStation={id:'fr-ionity',countryCode:'FR',name:'IONITY test',physicalOperator:{id:'ionity',name:'IONITY'},offers:[{id:'public-ionity',provider:'IONITY',kind:'direct',countries:['FR'],pricing:{pricePerKwh:0.59},sourceId:'direct',priority:95}]};
st=Runtime.applySelectedSubscriptions(ionityStation,['ionity-power'],config,{});
assert.equal(st.eligibleOffers.some(o=>o.subscriptionId==='ionity-power'),true,'minimum may be displayed');
assert.equal(st.rankableOffers.some(o=>o.subscriptionId==='ionity-power'),false,'minimum must be excluded from ranking');
st=Runtime.applySelectedSubscriptions(ionityStation,['ionity-power'],config,{subscriptionStationPrices:{'fr-ionity':{'ionity-power':{pricePerKwh:0.35,currency:'EUR'}}}});
assert.equal(st.rankableOffers.some(o=>o.subscriptionId==='ionity-power'&&o.pricing.pricePerKwh===0.35),true,'confirmed station price becomes rankable');

const options=Cross.subscriptionOptions(config);
assert.deepEqual(options.find(x=>x.id==='fastned-gold').countries.sort(),['BE','CH','DE','DK','ES','FR','GB','IT','NL']);
assert.equal(options.find(x=>x.id==='ionity-power').countryCount,23);
assert.equal(options.find(x=>x.id==='enbw-mobility-plus-m').countryCount,17);

console.log(JSON.stringify({ok:true,module:'tcc-v9-cross-border-runtime',invariants:['single-global-selection','country-local-price','no-home-price-fallback','preserve-physical-cpo','ionity-minimum-not-rankable','exact-station-override-rankable','enbw-station-specific-only']},null,2));
