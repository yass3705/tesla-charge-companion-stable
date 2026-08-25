import fs from 'node:fs';
import zlib from 'node:zlib';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const overlayPath=process.argv[2]||'assets/v8-labornebleue-direct-overlay.js';
const dataPath=process.argv[3]||'/tmp/labornebleue_direct_stations_idf.json.gz';
const source=fs.readFileSync(overlayPath,'utf8');
const data=JSON.parse(zlib.gunzipSync(fs.readFileSync(dataPath)).toString('utf8'));
const storage=new Map();
const localStorage={getItem:k=>storage.has(k)?storage.get(k):null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
const nullNode={querySelector:()=>null,querySelectorAll:()=>[],appendChild:()=>{},addEventListener:()=>{},style:{}};
const document={readyState:'complete',getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener:()=>{},documentElement:null,createElement:()=>({...nullNode,innerHTML:'',dataset:{},className:'',id:''})};
const sandbox={console,setInterval:()=>0,clearInterval:()=>{},setTimeout:()=>0,clearTimeout:()=>{},fetch:async()=>{throw new Error('fetch disabled in unit test')},Blob,Response,DecompressionStream,Uint8Array,Number,Math,JSON,Date,Set,Map,String,Array,Object,RegExp,Promise,localStorage,document,MutationObserver:class{observe(){} disconnect(){}}};
sandbox.window=sandbox;
sandbox.priceWithRules=()=>({total:999,connection:999,chargeCost:999,idleCost:2,durationSurcharge:3,occupiedMinutes:0,currencies:['EUR']});
sandbox.candidateStations=async()=>({origin:{lat:48.8,lon:2.2},stations:[],maxDistanceKm:5});
vm.createContext(sandbox);vm.runInContext(source,sandbox,{filename:overlayPath});
const api=sandbox.TCCV8LaBorneBleueDirect;assert.ok(api);api.validateData(data);
const nominal2208=[];for(const st of data.stations)for(const cfg of st.configurations)if(cfg.kind==='AC'&&Number(cfg.powerKw)>22&&Number(cfg.powerKw)<=22.1)nominal2208.push({st,cfg});
assert.ok(nominal2208.length>0,'real LBB data should contain nominal 22.08 kW');
for(const {cfg} of nominal2208){const ex=cfg.pricing.labornebleueExact;if(cfg.subscriptionId==='labornebleue-annual')assert.ok(Math.abs((ex.windows?.[0]?.ratePerMinute||0)*60-5.5)<1e-9);else assert.ok(Math.abs((ex.ratePerMinute||0)*60-6.5)<1e-9);}

assert.equal(data.counts.publishedStations,data.stations.length);assert.ok(data.stations.length>=350);assert.ok(data.counts.strictSourceChargePoints>=1000);
assert.equal(data.scope.partnerLocationsIncluded,false);assert.equal(data.scope.partnerTariffsIncluded,false);assert.equal(data.scope.subscriptionDiscountAtPartnerOperators,false);assert.equal(data.scope.subscriptionAnnualFeeEur,10);assert.equal(data.scope.dcTariffRule,'strictly_above_50_kw');
assert.ok(data.counts.unpricedDcAtOrBelow50Excluded>=0);
for(const st of data.stations)for(const cfg of st.configurations){assert.equal(cfg.labornebleueDirect,true);assert.equal(cfg.labornebleueOwnNetworkOnly,true);assert.ok(cfg.subscriptionId===null||cfg.subscriptionId==='labornebleue-annual');api.validateExact(cfg.pricing.labornebleueExact);}

function findConfig(pred){for(const st of data.stations)for(const cfg of st.configurations)if(pred(cfg,st))return{cfg,st};throw new Error('config not found');}
const subNight=findConfig(cfg=>cfg.subscriptionId==='labornebleue-annual'&&cfg.pricing.labornebleueExact?.model==='time_windows'&&cfg.pricing.labornebleueExact.windows?.some(w=>w.capEur===12&&Math.abs(w.ratePerMinute*60-2.5)<1e-6));
let exact=api.exactCost(subNight.cfg.pricing,20*60,60,10,'02:00','20:00');assert.ok(Math.abs(exact.total-12)<1e-9,'night cap must be 12 EUR');
exact=api.exactCost(subNight.cfg.pricing,19*60,60,10,'03:00','19:00');assert.ok(Math.abs(exact.total-15.5)<1e-9,'cross-window cap must apply only to night portion');
const publicNight=findConfig(cfg=>cfg.subscriptionId===null&&cfg.pricing.labornebleueExact?.model==='time_windows'&&cfg.pricing.labornebleueExact.windows?.some(w=>Math.abs(w.ratePerMinute*60-3.5)<1e-6));
exact=api.exactCost(publicNight.cfg.pricing,20*60,60,10,'02:00','20:00');assert.ok(Math.abs(exact.total-21)<1e-9,'public night tariff must remain uncapped');
const sub22=findConfig(cfg=>cfg.subscriptionId==='labornebleue-annual'&&cfg.kind==='AC'&&cfg.powerKw>7.4&&cfg.powerKw<=22&&cfg.pricing.labornebleueExact?.model==='time_windows');
exact=api.exactCost(sub22.cfg.pricing,20*60,30,5,'23:00','20:00');assert.ok(Math.abs(exact.total-12)<1e-9,'22 kW subscribed night cap must be 12 EUR');
const subDc=findConfig(cfg=>cfg.subscriptionId==='labornebleue-annual'&&cfg.kind==='DC'&&cfg.powerKw>50&&cfg.pricing.labornebleueExact?.model==='kwh_plus_elapsed');
exact=api.exactCost(subDc.cfg.pricing,10*60,45,40,'12:00','10:00');assert.ok(Math.abs(exact.total-21)<1e-9,'subscriber DC must be 0.45/kWh + 0.20/min after 30 charge min');assert.equal(exact.billedMinutes,45);
const publicDc=findConfig(cfg=>cfg.subscriptionId===null&&cfg.kind==='DC'&&cfg.powerKw>50&&cfg.pricing.labornebleueExact?.model==='kwh_plus_elapsed');
exact=api.exactCost(publicDc.cfg.pricing,10*60,45,40,'12:00','10:00');assert.ok(Math.abs(exact.total-23)<1e-9,'public DC must be 0.50/kWh + 0.20/min after 30 charge min');
api.installPricing();const wrapped=sandbox.priceWithRules(subDc.cfg.pricing,600,45,40,'12:00','10:00',[]);assert.notEqual(wrapped.total,999);assert.equal(wrapped.labornebleueExactPricing,true);assert.ok(Math.abs(wrapped.total-21)<1e-9);

const addressOfficial=data.stations.find(st=>/henri poincar/i.test(String(st.address||'')))||data.stations.find(st=>String(st.address||'').match(/\b\d+\b/));assert.ok(addressOfficial,'address fixture missing');
const shifted={id:'external-lbb-address',catalogStationId:'electroverse:lbb-address',operator:'La Borne Bleue',name:addressOfficial.name,address:addressOfficial.address,latitude:Number(addressOfficial.latitude)+0.0018,longitude:Number(addressOfficial.longitude),countryCode:'FR',chargingConfigurations:[],operationalStatus:'available',operationalStatusSource:'Electroverse'};
const addressPrepared={origin:{lat:Number(addressOfficial.latitude),lon:Number(addressOfficial.longitude)},maxDistanceKm:2,stations:[shifted]};api.mergePrepared(addressPrepared,data);const joined=addressPrepared.stations.find(st=>st.labornebleueStationId===addressOfficial.stationId);assert.ok(joined,'address-aware LBB join failed');assert.equal(joined.labornebleueMatchMode,'address_operator');assert.equal(joined.operationalStatus,'available');assert.ok(joined.chargingConfigurations.some(c=>c.labornebleueDirect));
const neutral={...shifted,id:'neutral-nearby',catalogStationId:'other:neutral',operator:'Other CPO',name:'Other CPO',address:'99 Rue Sans Rapport 92230 Gennevilliers'};const neutralPrepared={origin:{lat:Number(addressOfficial.latitude),lon:Number(addressOfficial.longitude)},maxDistanceKm:2,stations:[neutral]};api.mergePrepared(neutralPrepared,data);const neutralSame=neutralPrepared.stations.find(st=>st.catalogStationId==='other:neutral');assert.ok(neutralSame,'neutral source should be retained');assert.ok(!(neutralSame.chargingConfigurations||[]).some(c=>c.labornebleueDirect),'neutral unrelated source must not inherit LBB direct');
const origin={lat:Number(data.stations[0].latitude),lon:Number(data.stations[0].longitude)};
const prepared={origin,maxDistanceKm:0.3,stations:[]};api.mergePrepared(prepared,data);assert.ok(prepared.labornebleueDirectOverlayApplied);assert.ok(prepared.stations.some(st=>st.labornebleueStrictCpo&&st.chargingConfigurations?.some(c=>c.labornebleueDirect)));
const official=prepared.stations.find(st=>st.labornebleueStrictCpo);const base={...official,id:'base-lbb',catalogStationId:'electroverse:lbb',operator:'Alize',chargingConfigurations:[],operationalStatus:'available',operationalStatusSource:'Electroverse'};const preparedMatch={origin:{lat:official.latitude,lon:official.longitude},maxDistanceKm:0.2,stations:[base]};api.mergePrepared(preparedMatch,data);const merged=preparedMatch.stations.find(st=>st.labornebleueStationId===official.labornebleueStationId);assert.equal(merged.operationalStatus,'available');assert.equal(merged.labornebleueStatusJoinedExternally,true);assert.ok(merged.chargingConfigurations.some(c=>c.labornebleueDirect));
// A neutral unrelated station 80 m away must not be swallowed by the 120 m operator-aware match.
const unrelated={id:'unrelated',catalogStationId:'unrelated',operator:'Other',name:'Other charger',latitude:official.latitude+0.00072,longitude:official.longitude,chargingConfigurations:[],operationalStatus:'available'};const preparedNeutral={origin:{lat:official.latitude,lon:official.longitude},maxDistanceKm:0.2,stations:[unrelated]};api.mergePrepared(preparedNeutral,data);assert.ok(preparedNeutral.stations.some(st=>st.id==='unrelated'));assert.ok(preparedNeutral.stations.some(st=>st.labornebleueStationId===official.labornebleueStationId));

console.log(JSON.stringify({ok:true,stations:data.counts.publishedStations,chargePoints:data.counts.strictSourceChargePoints,configurations:data.counts.publishedConfigurations,excludedDcLe50:data.counts.unpricedDcAtOrBelow50Excluded,revision:api.revision},null,2));
