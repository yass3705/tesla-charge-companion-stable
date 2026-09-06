const assert=require('node:assert/strict');
const OfferEngine=require('../assets/v9/offer-engine.js');

function dedupeAndProvenanceTest(){
  const offers=[
    {id:'ev-snap-a',provider:'Electroverse',kind:'roaming',countries:['FR'],pricing:{pricePerKwh:0.49},sourceId:'electroverse-snapshot',priority:70},
    {id:'ev-snap-b',provider:'Electroverse',kind:'roaming',countries:['FR'],pricing:{pricePerKwh:0.49},sourceId:'electroverse-live',priority:80},
    {id:'operator-direct',provider:'Powerdot',kind:'direct',countries:['FR'],pricing:{pricePerKwh:0.49},sourceId:'powerdot-direct-france',priority:95}
  ];
  const out=OfferEngine.dedupeOffers(offers,{countryCode:'FR'});
  assert.equal(out.length,2,'equivalent roaming duplicates should collapse, while direct and roaming remain distinct');
  const roaming=out.find(o=>o.kind==='roaming');
  assert.equal(roaming.sourceId,'electroverse-live','highest-priority equivalent source should win');
  assert.equal(roaming.provenance.length,2,'all equivalent source provenance must be retained');
  assert.deepEqual(roaming.aliases,['ev-snap-a','ev-snap-b']);
}

function explicitEquivalenceTest(){
  const offers=[
    {id:'old-id',equivalenceKey:'fastned-public-nl',provider:'Fastned',kind:'direct',countries:['NL'],pricing:{pricePerKwh:0.69},sourceId:'snapshot',priority:50},
    {id:'new-id',equivalenceKey:'fastned-public-nl',provider:'Fastned',kind:'direct',countries:['NL'],pricing:{pricePerKwh:0.67},sourceId:'fastned-direct',priority:95}
  ];
  const out=OfferEngine.dedupeOffers(offers,{countryCode:'NL'});
  assert.equal(out.length,1,'explicit equivalenceKey should allow safe replacement when price changed');
  assert.equal(out[0].pricing.pricePerKwh,0.67);
  assert.equal(out[0].provenance.length,2);
}

function subscriptionCoverageTest(){
  const stations=[
    {id:'fr-1',countryCode:'FR',physicalOperator:{id:'powerdot'},offers:[
      {id:'atlante-plus-fr',provider:'Atlante',kind:'subscription',subscriptionId:'atlante-plus',countries:['FR','IT','ES','PT'],ratesByCountry:{FR:{pricePerKwh:0.39},IT:{pricePerKwh:0.42},ES:{pricePerKwh:0.40},PT:{pricePerKwh:0.41}},operatorIds:['atlante','powerdot'],sourceId:'atlante-direct',priority:95},
      {id:'local-fr',provider:'Belib',kind:'subscription',subscriptionId:'belib-resident',countries:['FR'],pricing:{pricePerKwh:0.25},operatorIds:['belib'],sourceId:'belib-direct',priority:95}
    ]},
    {id:'nl-1',countryCode:'NL',physicalOperator:{id:'fastned'},offers:[
      {id:'fastned-gold',provider:'Fastned',kind:'subscription',subscriptionId:'fastned-gold',countries:['NL','BE','DE','FR'],ratesByCountry:{NL:{pricePerKwh:0.45},BE:{pricePerKwh:0.46},DE:{pricePerKwh:0.47},FR:{pricePerKwh:0.44}},operatorIds:['fastned'],sourceId:'netherlands-direct-offers',priority:95}
    ]}
  ];
  const all=OfferEngine.deriveSubscriptionOptions(stations);
  assert.equal(all.length,3);
  const multi=OfferEngine.deriveSubscriptionOptions(stations,{minCountries:3});
  assert.deepEqual(multi.map(x=>x.id).sort(),['atlante-plus','fastned-gold']);
  const frAndNl=OfferEngine.deriveSubscriptionOptions(stations,{countryCodes:['FR','NL'],coverageMode:'all'});
  assert.deepEqual(frAndNl.map(x=>x.id),['fastned-gold'],'all-country filter should only keep plans covering every selected country');
  const powerdot=OfferEngine.deriveSubscriptionOptions(stations,{operatorIds:['powerdot']});
  assert.deepEqual(powerdot.map(x=>x.id),['atlante-plus'],'operator filter must include partner-network subscriptions');
}

function selectedOfferTest(){
  const station={countryCode:'FR',offers:[
    {id:'public',provider:'IONITY',kind:'direct',countries:['FR'],pricing:{pricePerKwh:0.59},sourceId:'ionity-direct',priority:95},
    {id:'passport',provider:'IONITY',kind:'subscription',subscriptionId:'ionity-passport',countries:['FR','DE'],ratesByCountry:{FR:{pricePerKwh:0.39},DE:{pricePerKwh:0.42}},sourceId:'ionity-direct',priority:95}
  ]};
  assert.equal(OfferEngine.eligibleOffers(station,[]).length,1);
  const selected=OfferEngine.eligibleOffers(station,['ionity-passport']);
  assert.equal(selected.length,2);
  assert.equal(selected.find(o=>o.subscriptionId).pricing.pricePerKwh,0.39);
}

function nationalFallbackPolicyTest(){
  const fallback={id:'irve',provider:'IRVE',kind:'national_fallback',countries:['FR'],pricing:{pricePerKwh:.60},sourceId:'france-national',priority:30};
  const direct={id:'direct',provider:'Powerdot',kind:'direct',countries:['FR'],pricing:{pricePerKwh:.49},sourceId:'powerdot-direct',priority:130};
  const roaming={id:'roaming',provider:'Electroverse',kind:'roaming',countries:['FR'],pricing:{pricePerKwh:.52},sourceId:'france-emsp-offers',priority:80};
  const subscription={id:'sub',provider:'Atlante',kind:'subscription',subscriptionId:'atlante-plus',countries:['FR'],pricing:{pricePerKwh:.39},sourceId:'atlante-direct',priority:95};
  let station={countryCode:'FR',offers:[fallback]};
  assert.deepEqual(OfferEngine.eligibleOffers(station,[]).map(o=>o.id),['irve'],'IRVE must remain when it is the only usable tariff');
  station={countryCode:'FR',offers:[fallback,direct,roaming]};
  assert.deepEqual(OfferEngine.eligibleOffers(station,[]).map(o=>o.id).sort(),['direct','roaming'],'IRVE fallback must disappear when public direct/roaming tariffs exist');
  station={countryCode:'FR',offers:[fallback,subscription]};
  assert.deepEqual(OfferEngine.eligibleOffers(station,[]).map(o=>o.id),['irve'],'unselected subscription must not hide the public IRVE fallback');
  assert.deepEqual(OfferEngine.eligibleOffers(station,['atlante-plus']).map(o=>o.id),['sub'],'selected subscription becomes usable and then replaces IRVE fallback');
}

dedupeAndProvenanceTest();
explicitEquivalenceTest();
subscriptionCoverageTest();
selectedOfferTest();
nationalFallbackPolicyTest();
console.log(JSON.stringify({ok:true,module:'tcc-v9-offer-engine',invariants:['dedupe-equivalent-offers','preserve-direct-vs-roaming','offer-provenance','subscription-country-count-filter','multi-country-coverage-filter','partner-operator-filter','national-tariff-fallback-only']},null,2));
