const assert=require('node:assert/strict');
const Adapter=require('../assets/v9/adapters/morocco-kilowatt-tariff.js');
const Data=require('../assets/v9/data-engine.js');

const freeIds=Array.from({length:26},(_,i)=>`free-${String(i).padStart(2,'0')}`);
const unresolvedIds=Array.from({length:17},(_,i)=>`unresolved-${String(i).padStart(2,'0')}`);
const manifest={
  schemaVersion:1,
  countryCode:'MA',
  network:'Kilowatt',
  validatedArtifact:{digest:'sha256:test'},
  policy:{
    stationSpecificFreeOnly:true,
    missingTariffDoesNotMeanFree:true,
    cityOnlyPaidRuleRejected:true,
    cpoOperator:'Kilowatt',
    tariffChannel:'Kilowatt direct/public access',
    currency:'MAD'
  },
  summary:{productionStations:43,free:26,unresolved:17},
  freeStationIds:freeIds,
  unresolvedStationIds:unresolvedIds
};

const checked=Adapter.validateManifest(manifest);
assert.equal(checked.freeStationIds.length,26);
assert.equal(checked.unresolvedStationIds.length,17);
const rules=Adapter.offerRulesFromManifest(manifest);
assert.equal(rules.length,26);
assert.equal(rules[0].pricing.rules[0].pricePerKwh,0);
assert.equal(rules[0].currency,'MAD');
assert.equal(rules[0].metadata.tariffChannel,'Kilowatt direct/public access');

const stationId=freeIds[0];
const physicalSource={
  id:'morocco-kilowatt-public',countries:['MA'],priority:{identity:85,connectors:85,access:85,status:70,tariff:0},active:true
};
const tariffSource={
  id:'morocco-kilowatt-direct-offers',countries:['MA'],priority:{tariff:115},active:true,optional:true
};
const station={
  canonicalId:`MA:kilowatt:${stationId}`,
  aliases:[`kilowatt-station:${stationId}`],
  sourceStationId:stationId,
  countryCode:'MA',
  name:'Kilowatt test',
  address:'Casablanca',
  latitude:33.5731,
  longitude:-7.5898,
  physicalOperator:{name:'Kilowatt'},
  networkBrand:'Kilowatt',
  access:{kind:'public',appSource:'Kilowatt public web map',accessNetwork:'Kilowatt'},
  evses:[{id:`kilowatt:${stationId}`,connectors:[{id:'c1',kind:'AC',powerKw:22,plugName:'Type 2'}]}],
  status:{state:'available',statusSource:'Kilowatt public web map'},
  offers:[]
};

(async()=>{
  const engine=Data.createEngine({
    registry:{sources:[physicalSource,tariffSource]},
    loaders:{
      [physicalSource.id]:async()=>[station],
      [tariffSource.id]:async()=>({offerRules:rules})
    }
  });
  const area=await engine.queryArea({countryCode:'MA',origin:{lat:33.5731,lon:-7.5898},radiusKm:5});
  assert.equal(area.stations.length,1);
  assert.equal(area.stations[0].offers.length,1);
  assert.equal(area.stations[0].offers[0].pricing.rules[0].pricePerKwh,0);
  assert.equal(area.stations[0].offers[0].provider,'Kilowatt direct');

  const failClosed=Data.createEngine({
    registry:{sources:[physicalSource,tariffSource]},
    loaders:{
      [physicalSource.id]:async()=>[station],
      [tariffSource.id]:async()=>{throw new Error('resource unavailable (404)');}
    }
  });
  const fallback=await failClosed.queryArea({countryCode:'MA',origin:{lat:33.5731,lon:-7.5898},radiusKm:5});
  assert.equal(fallback.stations.length,1);
  assert.equal(fallback.stations[0].offers.length,0,'optional overlay failure must not invent a tariff');
  assert.equal(fallback.diagnostics.errors.some(e=>e.sourceId===tariffSource.id),true);

  const bad=JSON.parse(JSON.stringify(manifest));
  bad.unresolvedStationIds[0]=bad.freeStationIds[0];
  assert.throws(()=>Adapter.validateManifest(bad),/overlap|cover exactly/);

  console.log(JSON.stringify({ok:true,freeRules:rules.length,failClosedOnMissingOverlay:true},null,2));
})().catch(err=>{console.error(err);process.exit(1);});
