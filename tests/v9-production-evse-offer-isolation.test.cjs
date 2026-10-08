'use strict';
const assert=require('node:assert/strict');
const Offers=require('../v9-production-runtime/assets/v9/offer-engine.js');
const Session=require('../v9-production-runtime/assets/v9/session-engine.js');
const a={id:'a',provider:'Electra',evseIds:['FR*ELC*E0001'],pricing:{pricePerKwh:0.5},currency:'EUR',priority:82};
const b={id:'b',provider:'Electra',evseIds:['FR*ELC*E0002'],pricing:{pricePerKwh:0.5},currency:'EUR',priority:82};
assert.equal(Offers.dedupeOffers([a,b],{countryCode:'FR'}).length,2,'never collapse equivalent EVSE tariffs across charging points');
const mkEvse=id=>({id,connectors:[{id:'plug:'+id,kind:'DC',powerKw:150,plugName:'CCS'}]});
function station(order){return{id:'tcc-test',countryCode:'FR',evses:order.map(mkEvse),offers:[a,b]};}
const session={energyKwh:20,consumptionKwhPer100Km:20,startAt:'2026-10-09T12:00:00Z',durationMinutes:15};
let result=Session.evaluateStation(station(['FRELC E0001','FR*ELC*E0002']),session);
assert.equal(result.eligibleOfferCount,1,'only tariff of first selected EVSE is eligible');
assert.equal(result.best.offerId,'a');
result=Session.evaluateStation(station(['FR*ELC*E0002','FR*ELC*E0001']),session);
assert.equal(result.eligibleOfferCount,1);
assert.equal(result.best.offerId,'b');
const noId=Session.offerMatchesChargingKind(a,'DC',150,'CCS',null,null);
assert.equal(noId,false,'fail closed when EVSE identity missing');
console.log('PASS: EVSE-specific offer matching and safe deduplication');