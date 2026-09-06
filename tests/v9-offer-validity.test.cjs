'use strict';

const assert=require('node:assert/strict');
const Direct=require('../assets/v9/adapters/direct-offers.js');
const Session=require('../assets/v9/session-engine.js');

const raw={
  id:'date-bounded-direct',provider:'Date-bounded direct',countries:['IT'],currency:'EUR',
  evseIds:['IT*TEST*E1'],verifiedScope:'exact_evse',directOperatorOnly:true,
  validFrom:'2026-07-15',validThrough:'2026-09-30',validityBasis:'whole_session_local_date',
  pricing:{type:'kwh',pricePerKwh:0.5},metadata:{timeZone:'Europe/Rome'}
};
const offer=Direct.normalizePayload({country:'IT',directOffers:[raw]}).offerRules[0];
assert.equal(offer.validFrom,'2026-07-15');
assert.equal(offer.validThrough,'2026-09-30');
assert.equal(offer.validityBasis,'whole_session_local_date');

const station={id:'IT:date-bounded',countryCode:'IT',offers:[offer]};
const session=startAt=>({energyKwh:20,durationMinutes:30,consumptionKwhPer100Km:15,targetCurrency:'EUR',startAt});

let result=Session.evaluateStation(station,session('2026-07-14T22:00:00Z'));
assert.equal(result.comparableOfferCount,1,'validFrom is inclusive in the offer local time zone');
assert.equal(result.best.total,10);

result=Session.evaluateStation(station,session('2026-07-14T21:59:00Z'));
assert.equal(result.comparableOfferCount,0);
assert.equal(result.incomplete[0].result.reason,'offer_outside_validity_window');

result=Session.evaluateStation(station,session('2026-09-30T21:20:00Z'));
assert.equal(result.comparableOfferCount,1,'a session wholly inside validThrough remains comparable');

result=Session.evaluateStation(station,session('2026-09-30T21:45:00Z'));
assert.equal(result.comparableOfferCount,0,'a session crossing the local expiry date must fail closed');
assert.equal(result.incomplete[0].result.reason,'offer_session_crosses_validity_window');

result=Session.evaluateStation(station,session('2026-09-30T22:00:00Z'));
assert.equal(result.comparableOfferCount,0,'the offer is expired from local midnight');
assert.equal(result.incomplete[0].result.reason,'offer_outside_validity_window');

result=Session.evaluateStation(station,{energyKwh:20,durationMinutes:30,targetCurrency:'EUR'});
assert.equal(result.comparableOfferCount,0,'dated offers require an explicit session start');
assert.equal(result.incomplete[0].result.reason,'offer_validity_requires_start_time');

const startOnly={...offer,id:'start-date-basis',validityBasis:'session_start_local_date'};
result=Session.evaluateStation({id:'IT:start-date-basis',countryCode:'IT',offers:[startOnly]},session('2026-09-30T21:45:00Z'));
assert.equal(result.comparableOfferCount,1,'session-start validity remains available for contracts that explicitly use it');

const invalid={...offer,id:'invalid-date',validThrough:'2026-09-31'};
result=Session.evaluateStation({id:'IT:invalid-date',countryCode:'IT',offers:[invalid]},session('2026-09-01T10:00:00Z'));
assert.equal(result.comparableOfferCount,0);
assert.equal(result.incomplete[0].result.reason,'invalid_offer_validity_window');

console.log(JSON.stringify({ok:true,localTimeZone:'Europe/Rome',inclusiveBounds:true,wholeSessionExpiryFailClosed:true,missingStartFailsClosed:true},null,2));
