import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const releaseRoot=path.resolve(process.argv[2]||'.');
const hotfix=fs.readFileSync(path.join(releaseRoot,'assets/v8-rc48bn-runtime-hotfix.js'),'utf8');
assert.ok(hotfix.includes("REVISION='rc48cg-nl-final-operator-sync'"),'rc48cg Netherlands operator sync must be published');
assert.ok(hotfix.includes('ensureTeslaOperatorChoice'),'final Tesla operator DOM repair must exist');

const tesla={id:'tesla-eindhoven-netherlands',name:'Tesla Eindhoven, Netherlands',operator:'Tesla',source:'teslaSupercharger',latitude:51.407102,longitude:5.479618};
const locals=Array.from({length:80},(_,i)=>({id:`nl-${i}`,catalogStationId:`NL:${i}`,operator:`NL operator ${i%11}`,source:'netherlandsNationalCatalog',latitude:51.4416+i/100000,longitude:5.4697+i/100000}));
const status={textContent:'✓ 80 borne(s) mise(s) à jour dans un rayon routier maximal de 25 km. Tu peux lancer la simulation.'};
const hint={textContent:'11 opérateur(s) disponibles dans la zone chargée.'};
const operatorHost={dataset:{},children:Array.from({length:11},(_,i)=>({type:'checkbox',value:`NL operator ${i}`,checked:false})),querySelectorAll(sel){return sel==='input[type=checkbox]'?this.children.filter(x=>x?.type==='checkbox'):[];},appendChild(node){this.children.push(node);if(node?.children)for(const child of node.children)if(child?.type==='checkbox')this.children.push(child);return node;}};
const refreshSnapshots=[];
const context={
  console,WeakMap,Map,Set,Array,Number,String,Date,JSON,Math,Promise,
  setTimeout:(fn)=>{fn();return 1;},clearTimeout:()=>{},queueMicrotask,requestAnimationFrame:(fn)=>{fn();return 1;},
  routeResults:{},
  candidateStations:async(mode,radius)=>{assert.equal(mode,'tesla');assert.equal(Number(radius),25);context.routeResults={[tesla.id]:{distanceKm:4.2,durationMin:8}};return{origin:{lat:51.4416,lon:5.4697},stations:[tesla],maxDistanceKm:25};},
  document:{
    readyState:'loading',addEventListener:()=>{},querySelector:()=>null,querySelectorAll:()=>[],documentElement:{},head:{appendChild:()=>{}},
    getElementById(id){if(id==='simMaxDistance')return{value:'25'};if(id==='routeStatus')return status;if(id==='augOperatorChoices')return operatorHost;if(id==='tccDynamicOperatorHint')return hint;return null;},
    createElement(tag){if(tag==='label')return{className:'',children:[],appendChild(node){this.children.push(node);return node;}};if(tag==='input')return{type:'',value:'',checked:false};return{dataset:{},style:{},appendChild:()=>{}};},
    createTextNode:text=>({textContent:String(text)})
  },
  MutationObserver:function(){this.observe=()=>{};},
  TCCV8DynamicOperators:{refresh(list){refreshSnapshots.push((list||[]).map(st=>st.id));}}
};
context.window=context;
vm.createContext(context);
vm.runInContext(hotfix,context,{filename:'assets/v8-rc48bn-runtime-hotfix.js'});
context.TCC_V8_AREA_CACHE={prepared:{stations:locals.slice(),netherlandsCatalogLoaded:80,maxDistanceKm:25}};
await new Promise(resolve=>setImmediate(resolve));
const prepared=context.TCC_V8_AREA_CACHE.prepared;
assert.equal(prepared.stations.length,81,'Tesla must be restored after a dense 80-station DOT-NL shortlist');
assert.ok(prepared.stations.some(st=>st.id===tesla.id),'Tesla Eindhoven must be in the final cache');
assert.ok(refreshSnapshots.some(ids=>ids.includes(tesla.id)),'dynamic operator refresh must receive Tesla');
assert.ok(operatorHost.querySelectorAll('input[type=checkbox]').some(input=>input.value==='Tesla'),'Tesla checkbox must exist in the final operator DOM');
assert.match(hint.textContent,/12 opérateur\(s\)/,'operator hint must include Tesla');
prepared.stations=locals.slice();
await new Promise(resolve=>setImmediate(resolve));
assert.ok(prepared.stations.some(st=>st.id===tesla.id),'late overlay truncation must not evict Tesla');
console.log(JSON.stringify({ok:true,preparedStations:prepared.stations.length,teslaOperatorVisible:true,operatorHint:hint.textContent,status:status.textContent},null,2));
