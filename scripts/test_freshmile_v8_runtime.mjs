import fs from 'node:fs';
import zlib from 'node:zlib';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const overlayPath=process.argv[2]||'assets/v8-freshmile-direct-overlay.js';
const dataPath=process.argv[3]||'data/freshmile_direct_tcc_v8.json.gz';
const source=fs.readFileSync(overlayPath,'utf8');
const data=JSON.parse(zlib.gunzipSync(fs.readFileSync(dataPath)).toString('utf8'));
const sandbox={console,setInterval:()=>0,clearInterval:()=>{},setTimeout:()=>0,clearTimeout:()=>{},fetch:async()=>{throw new Error('fetch disabled in unit test')},Blob,Response,DecompressionStream,Uint8Array,Number,Math,JSON,Date,Set,Map,String,Array,Object,RegExp,document:{readyState:'complete',getElementById:()=>null,addEventListener:()=>{}}};
sandbox.window=sandbox;
sandbox.priceWithRules=()=>({total:999,connection:999,chargeCost:999,idleCost:2,durationSurcharge:3,occupiedMinutes:0,currencies:['EUR']});
sandbox.candidateStations=async()=>({origin:{lat:48.01419,lon:0.18728},stations:[],maxDistanceKm:5});
vm.createContext(sandbox);vm.runInContext(source,sandbox,{filename:overlayPath});
const api=sandbox.TCCV8FreshmileDirect;assert.ok(api);api.validateData(data);
assert.equal(data.counts.strictPublishedStations,data.stations.length);assert.ok(data.stations.length>900);
assert.equal(data.scope.roamingIncluded,false);assert.equal(data.scope.configuredRegionalNetworksIncluded,false);assert.equal(data.scope.regionalNetworkCandidatesMayRemain,true);assert.equal(data.scope.preferentialTariffsIncluded,false);
let evseCount=0,configurationCount=0;for(const st of data.stations){configurationCount+=st.configurations.length;evseCount+=new Set(st.configurations.flatMap(c=>c.freshmileEvseIds||[])).size;}
assert.equal(data.counts.strictPublishedEvse,evseCount);assert.equal(data.counts.strictPublishedConfigurations,configurationCount);
function findConfig(pred){for(const st of data.stations)for(const cfg of st.configurations)if(pred(cfg,st))return{cfg,st};throw new Error('config not found');}
const started=findConfig(cfg=>cfg.pricing.freshmileExact?.energy?.billing==='started_kwh'&&!cfg.pricing.freshmileExact?.time&&!cfg.pricing.freshmileExact?.sessionFeeEur);
let exact=api.exactCost(started.cfg.pricing,20,10.1,'','10:00');assert.equal(exact.energyCost,Math.ceil(10.1-1e-9)*started.cfg.pricing.freshmileExact.energy.amount);
const occupied=findConfig(cfg=>cfg.pricing.freshmileExact?.time?.appliesTo==='occupied'&&cfg.pricing.freshmileExact?.energy);
exact=api.exactCost(occupied.cfg.pricing,20.2,10.1,'11:00','10:00');const e=occupied.cfg.pricing.freshmileExact;const expectedEnergy=(e.energy.billing==='started_kwh'?11:10.1)*e.energy.amount;assert.ok(Math.abs(exact.energyCost-expectedEnergy)<1e-9);assert.ok(Math.abs(exact.timeCost-60*e.time.amount)<1e-9);assert.equal(exact.occupiedMinutes,60);
const linearCharge=findConfig(cfg=>cfg.pricing.freshmileExact?.energy?.billing==='linear_kwh'&&cfg.pricing.freshmileExact?.time?.appliesTo==='charge');exact=api.exactCost(linearCharge.cfg.pricing,20.2,10.1,'11:00','10:00');assert.ok(Math.abs(exact.energyCost-10.1*linearCharge.cfg.pricing.freshmileExact.energy.amount)<1e-9);assert.ok(Math.abs(exact.timeCost-21*linearCharge.cfg.pricing.freshmileExact.time.amount)<1e-9);
api.installPricing();const wrapped=sandbox.priceWithRules(occupied.cfg.pricing,600,20.2,10.1,'11:00','10:00',[]);assert.notEqual(wrapped.total,999);assert.equal(wrapped.freshmileExactPricing,true);assert.equal(wrapped.idleCost,0);assert.equal(wrapped.durationSurcharge,0);
const prepared={origin:{lat:48.01419,lon:0.18728},maxDistanceKm:1,stations:[]};api.mergePrepared(prepared,data);assert.ok(prepared.freshmileDirectOverlayApplied);assert.ok(prepared.stations.some(st=>st.freshmileStrictCpo&&st.chargingConfigurations?.some(c=>c.freshmileStrictExact)));
const official=prepared.stations.find(st=>st.freshmileStrictCpo);const base={...official,id:'base-fm',catalogStationId:'electroverse:fm',operator:'Freshmile',chargingConfigurations:[],operationalStatus:'available',operationalStatusSource:'Electroverse'};const preparedMatch={origin:{lat:official.latitude,lon:official.longitude},maxDistanceKm:1,stations:[base]};api.mergePrepared(preparedMatch,data);const merged=preparedMatch.stations.find(st=>st.freshmileStrictCpo);assert.equal(merged.operationalStatus,'available');assert.equal(merged.freshmileStatusJoinedExternally,true);assert.ok(merged.chargingConfigurations.some(c=>c.freshmileStrictExact));
for(const st of data.stations)for(const cfg of st.configurations){const raw=String(cfg.pricing.freshmileExact?.sourceDescription||'');assert.ok(!/(termin|finished|complete|from the end|end of charging|recharg|fini de charger)/i.test(raw),'post-charge wording leaked');assert.ok(['AC','DC'].includes(cfg.kind));}
console.log(JSON.stringify({ok:true,stations:data.counts.strictPublishedStations,evse:data.counts.strictPublishedEvse,configurations:data.counts.strictPublishedConfigurations,revision:api.revision},null,2));
