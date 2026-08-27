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
assert.ok(api?.mergeEtotemCatalog,'e-Totem catalogue merger not exported');

function pdc(id,power,connectors){return {id,powerKw:power,connectors};}
function ruleByKind(configs,kind){const c=configs.find(x=>x.kind===kind&&x.etotemVerified);assert.ok(c,`missing verified ${kind}`);return c.pricing.rules[0];}
function catalogStation(id,name,kind,power){return {id,catalogStationId:`electroverse:${id}`,name,operator:'e-Totem',latitude:43.49,longitude:-1.47,kind,powerKw:power,stalls:2,pricing:{type:'rules',rules:[]},chargingConfigurations:[{id:`${id}-cfg`,label:`${kind} ${power} kW`,kind,powerKw:power,stalls:2,pricing:{type:'rules',rules:[]}}]};}

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

// Non-régression : deux stations e-Totem co-localisées (e-Smart AC / e-Fast DC)
// avec le même nom de site doivent être rapprochées par profil technique, pas par ordre du catalogue.
const coteBasqueCatalog=[
  catalogStation('pcb-smart','e-Totem - Polyclinique Cote Basque e-Smart','AC',22),
  catalogStation('pcb-fast','e-Totem - Polyclinique Cote Basque e-Fast','DC',100),
];
const coteBasqueData={generatedAt:'2026-08-27T00:00:00Z',stations:[
  {stationId:'PCB-FAST',name:'Polyclinique Cote Basque',resolved:true,tariffText:'Tarif de recharge : 0,49 €/kWh.',latitude:43.49,longitude:-1.47,pdcCount:2,pdcs:[pdc('fast-1',100,['CCS']),pdc('fast-2',100,['CCS'])],api:{sIdPool:'FR*ETI*P*PCBFAST'}},
  {stationId:'PCB-SMART',name:'Polyclinique Cote Basque',resolved:true,tariffText:'Tarif de recharge : 0,39 €/kWh.',latitude:43.49,longitude:-1.47,pdcCount:2,pdcs:[pdc('smart-1',22,['T2']),pdc('smart-2',22,['T2'])],api:{sIdPool:'FR*ETI*P*PCBSMART'}},
]};
const coteBasqueMerged=api.mergeEtotemCatalog(coteBasqueCatalog,coteBasqueData,{lat:43.49,lon:-1.47},2);
const coteFast=coteBasqueMerged.find(station=>station.etotemStationId==='PCB-FAST');
const coteSmart=coteBasqueMerged.find(station=>station.etotemStationId==='PCB-SMART');
assert.ok(coteFast&&coteSmart,'Polyclinique Cote Basque records must both be merged');
assert.deepEqual(coteFast.etotemSourceCatalogStationIds,['electroverse:pcb-fast'],'e-Fast must keep the DC 100 kW source station');
assert.deepEqual(coteSmart.etotemSourceCatalogStationIds,['electroverse:pcb-smart'],'e-Smart must keep the AC 22 kW source station');
assert.equal(ruleByKind(coteFast.chargingConfigurations,'DC').pricePerKwh,.49);
assert.equal(ruleByKind(coteSmart.chargingConfigurations,'AC').pricePerKwh,.39);

console.log(JSON.stringify({ok:true,mane:{dc,ac},semob:sr,eco:er.pricePerKwh,ambiguousVerified:amb.etotemVerified,coteBasque:{fastSource:coteFast.etotemSourceCatalogStationIds,smartSource:coteSmart.etotemSourceCatalogStationIds}},null,2));
