import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';

function readGzipJson(path){return JSON.parse(zlib.gunzipSync(fs.readFileSync(path)).toString('utf8'));}
const bump=readGzipJson('data/bump_direct_tariffs_tcc_france.json.gz');
const france=readGzipJson('data/non_tesla_france/all.json.gz');

globalThis.window=globalThis;
globalThis.document={readyState:'loading',addEventListener(){},dispatchEvent(){}};
globalThis.CustomEvent=class CustomEvent{constructor(type,init={}){this.type=type;this.detail=init.detail}};
vm.runInThisContext(fs.readFileSync('assets/v8-bump-direct.js','utf8'),{filename:'v8-bump-direct.js'});
const B=globalThis.TCCBumpDirectV8;
assert.ok(B,'Bump runtime export missing');
B.validateCatalog(bump);

function stationFromRow(row){
  return {
    id:`fixture:${row[0]}`,catalogStationId:row[0],countryCode:'FR',name:row[1],address:row[2],latitude:Number(row[3]),longitude:Number(row[4]),operator:row[5],
    chargingConfigurations:(row[8]||[]).map(c=>({id:c[0],label:c[1],kind:c[2],powerKw:Number(c[3]),stalls:Number(c[4]),pricing:{type:'rules',rules:[]}}))
  };
}
function exactCatalogStation(name){
  const hits=france.filter(row=>String(row?.[1]||'')===name);
  assert.equal(hits.length,1,`expected one national catalog row for ${name}`);
  return stationFromRow(hits[0]);
}
function directOffers(st){return (st.chargingConfigurations||[]).filter(c=>c.bumpDirectOffer);}

const meyer=exactCatalogStation('Bump - SAGS - Paris - Meyerbeer');
assert.equal(meyer.operator,'Bump');
assert.ok(meyer.chargingConfigurations.some(c=>c.kind==='AC'&&Math.abs(c.powerKw-7.4)<1e-9),'Meyerbeer 7.4 kW runtime configuration missing');
const enrichedMeyer=B.addOffers(meyer,bump),meyerDirect=directOffers(enrichedMeyer);
assert.ok(meyerDirect.length>=1,'Meyerbeer must receive Bump Direct after nominal 7.4/7 kW reconciliation');
assert.ok(meyerDirect.some(c=>Math.abs(c.powerKw-7.4)<1e-9&&Math.abs(c.bumpTariffPowerKw-7)<1e-9),'Meyerbeer must keep 7.4 kW physical power with 7 kW Bump tariff provenance');
assert.ok(meyerDirect.every(c=>String(c.bumpMatchMode).startsWith('exact_name')),'Meyerbeer must be matched by exact Bump identity, not a broad fallback');

const malesherbes=exactCatalogStation('Bump - SAGS - Paris - Malesherbes');
assert.equal(malesherbes.operator,'Bump');
const enrichedMalesherbes=B.addOffers(malesherbes,bump),malesherbesDirect=directOffers(enrichedMalesherbes);
assert.ok(malesherbesDirect.some(c=>Math.abs(c.powerKw-22)<1e-9&&Math.abs(c.bumpTariffPowerKw-22)<1e-9),'Malesherbes known 22 kW direct offer must remain available');

const nearbyNonBump=stationFromRow(france.find(row=>String(row?.[0])==='electroverse:438057'));
assert.ok(nearbyNonBump,'nearby Belib fixture missing');
assert.notEqual(nearbyNonBump.operator,'Bump');
assert.equal(directOffers(B.addOffers(nearbyNonBump,bump)).length,0,'nearby non-Bump station must never inherit a Bump tariff');

console.log(JSON.stringify({ok:true,meyerbeer:{physicalKw:7.4,tariffKw:7,offers:meyerDirect.length},malesherbes:{physicalKw:22,offers:malesherbesDirect.length},nearbyNonBumpExcluded:true},null,2));
