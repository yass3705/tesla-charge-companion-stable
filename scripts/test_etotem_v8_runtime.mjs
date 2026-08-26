import fs from 'fs';
import vm from 'vm';
import assert from 'assert/strict';

const file=process.argv[2]||'assets/france-catalog-v8.js';
const code=fs.readFileSync(file,'utf8');

globalThis.window=globalThis;
globalThis.document={getElementById(){return null;}};
globalThis.stations=[];
globalThis.candidateStations=async()=>({origin:{lat:0,lon:0},stations:[]});
globalThis.resolveOrigin=async()=>({lat:0,lon:0});
globalThis.fetch=async()=>{throw new Error('fetch not expected in parser unit test');};
vm.runInThisContext(code,{filename:file});

const api=globalThis.TCCFranceCatalogV8;
assert.ok(api?.etotemDirectConfigurations,'e-Totem runtime parser not exported');

function pdc(id,power,connectors){return {id,powerKw:power,connectors};}
function ruleByKind(configs,kind){const c=configs.find(x=>x.kind===kind&&x.etotemVerified);assert.ok(c,`missing verified ${kind}`);return c.pricing.rules[0];}

const mane={
  stationId:'FRETIP31315A',
  tariffText:'DC : 0,49 €/kWh. Une fois le véhicule rechargé : 10 minutes gratuites puis 3,00 €/15 min. AC : 0,39 €/kWh. Une fois le véhicule rechargé : 10 minutes gratuites puis 1,50 €/15 min.',
  pdcs:[pdc('dc1',180,['CCS']),pdc('dc2',180,['CCS']),pdc('ac1',22,['T2'])],api:{sIdPool:'FR*ETI*P31315*A'}
};
let configs=api.etotemDirectConfigurations(mane);
let dc=ruleByKind(configs,'DC'),ac=ruleByKind(configs,'AC');
assert.equal(dc.pricePerKwh,.49);assert.equal(dc.idleGraceMinutes,10);assert.equal(dc.idlePerMinute,.2);
assert.equal(ac.pricePerKwh,.39);assert.equal(ac.idleGraceMinutes,10);assert.equal(ac.idlePerMinute,.1);

const semob={
  stationId:'FRESEPS42218AQ',
  tariffText:'Tarif de recharge : 0,45 €/kWh. Une fois votre véhicule rechargé : 15 minutes gratuites puis 0,50 €/15 min, plafonné à 2 € entre 20h et 8h.',
  pdcs:[pdc('ac',22,['T2'])],api:{sIdPool:'FR*ESE*P*S42218*AQ'}
};
let sr=ruleByKind(api.etotemDirectConfigurations(semob),'AC');
assert.equal(sr.pricePerKwh,.45);assert.equal(sr.idleGraceMinutes,15);assert.ok(Math.abs(sr.idlePerMinute-(.5/15))<1e-12);assert.equal(sr.idleCap,2);assert.equal(sr.idleCapStart,'20:00');assert.equal(sr.idleCapEnd,'08:00');

const eco={stationId:'FRETIPECO',tariffText:'Tarif 0,45 €/kWh. Mode ECO : 0,35 €/kWh. Une fois le véhicule rechargé : 10 minutes gratuites puis 1 €/15 min.',pdcs:[pdc('ac',22,['T2'])],api:{sIdPool:'FR*ETI*P*ECO'}};
let er=ruleByKind(api.etotemDirectConfigurations(eco),'AC');
assert.equal(er.pricePerKwh,.45,'ECO tariff must not be auto-selected');

const ambiguous={stationId:'FRETIPAMB',tariffText:'Tarifs : 0,39 €/kWh ou 0,49 €/kWh selon la borne.',pdcs:[pdc('ac',22,['T2'])],api:{sIdPool:'FR*ETI*P*AMB'}};
const amb=api.etotemDirectConfigurations(ambiguous)[0];
assert.equal(amb.etotemVerified,false);assert.equal(amb.pricing.rules.length,0);

console.log(JSON.stringify({ok:true,mane:{dc,ac},semob:sr,eco:er.pricePerKwh,ambiguousVerified:amb.etotemVerified},null,2));
