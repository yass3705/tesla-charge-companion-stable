from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


# 1) Preserve offer/subscription metadata when configurations are expanded.
p = Path("assets/app.js")
s = p.read_text(encoding="utf-8")
old = """   powerKw:cfg.powerKw,
   stalls:cfg.stalls,
   pricing:cfg.pricing||st.pricing,
   totalSiteStalls:st.stalls,"""
new = """   powerKw:cfg.powerKw,
   stalls:cfg.stalls,
   pricing:cfg.pricing||st.pricing,
   offerProvider:cfg.offerProvider??st.offerProvider,
   offerType:cfg.offerType??st.offerType,
   subscriptionId:cfg.subscriptionId??st.subscriptionId??null,
   subscriptionSelectionId:cfg.subscriptionSelectionId??st.subscriptionSelectionId??null,
   totalSiteStalls:st.stalls,"""
s = replace_once(s, old, new, "app.js expansion marker")
p.write_text(s, encoding="utf-8")


# 2) Make LBB a native late-registerable subscription.
p = Path("assets/v8-subscription-selection.js")
s = p.read_text(encoding="utf-8")
old = """    if(provider.includes('belib direct abonne non resident'))return'belib-nonresident';
    if(provider.includes('belib direct abonne resident'))return'belib-resident';
    return'';"""
new = """    if(provider.includes('belib direct abonne non resident'))return'belib-nonresident';
    if(provider.includes('belib direct abonne resident'))return'belib-resident';
    if(provider.includes('la borne bleue direct abonne')||provider.includes('la borne bleue abonne'))return'labornebleue-annual';
    return'';"""
s = replace_once(s, old, new, "subscription provider marker")
old = """  async function loadPlans(){
    const overlay=window.TCC_TARIFF_OVERLAY_V1||await window.TCCV8OperatorOverlay?.loadOverlay?.()||{};
    plans=Array.isArray(overlay.subscriptions)?overlay.subscriptions:[];
    return plans;
  }"""
new = """  async function loadPlans(){
    const overlay=window.TCC_TARIFF_OVERLAY_V1||await window.TCCV8OperatorOverlay?.loadOverlay?.()||{};
    plans=Array.isArray(overlay.subscriptions)?overlay.subscriptions.slice():[];
    return plans;
  }
  function upsertPlan(plan){
    const id=selectionId(plan);if(!id)return false;
    const index=plans.findIndex(p=>selectionId(p)===id);
    if(index>=0)plans[index]={...plans[index],...plan};else plans.push({...plan});
    return true;
  }
  function registerPlan(plan){
    if(!upsertPlan(plan))return false;
    try{injectControls()}catch(e){}
    setTimeout(()=>{try{window.TCCV8DirectResolver?.renderSubscriptionDropdown?.(true)}catch(e){}},0);
    try{applyAll(true)}catch(e){}
    return true;
  }"""
s = replace_once(s, old, new, "loadPlans marker")
old = "window.TCCV8Subscriptions={state,applyAll,selectionChanged,selectedSet,subscriptionIdForProvider,subscriptionIdForStation,isStationEligible,planApplies,generatedPlanTotal,get plans(){return plans.slice()}};"
new = "window.TCCV8Subscriptions={state,applyAll,selectionChanged,selectedSet,subscriptionIdForProvider,subscriptionIdForStation,isStationEligible,planApplies,generatedPlanTotal,registerPlan,get plans(){return plans.slice()}};"
s = replace_once(s, old, new, "subscription export marker")
p.write_text(s, encoding="utf-8")


# 3) Address-aware LBB matching and native subscription registration.
p = Path("assets/v8-labornebleue-direct-overlay.js")
s = p.read_text(encoding="utf-8")
s = replace_once(s, "const REVISION='rc48-labornebleue-direct-20260825a';", "const REVISION='rc48-labornebleue-direct-20260825b';", "LBB revision")
s = replace_once(s, "const DATA_VERSION='20260825a';", "const DATA_VERSION='20260825b';", "LBB data version")
s = replace_once(
    s,
    "let dataPromise=null,candidateInstalled=false,pricingInstalled=false,lastPrepared=null,subscriptionShimmed=false,uiObserver=null,uiBusy=false;",
    "let dataPromise=null,candidateInstalled=false,pricingInstalled=false,lastPrepared=null,uiObserver=null,uiBusy=false;",
    "LBB state marker",
)
marker = """  function isLikelyLabornebleueStation(st){
    const values=[st?.operator,st?._sourceOperator,st?.cpo,st?.network,st?.name].map(norm).filter(Boolean);
    return values.some(v=>v.includes('la borne bleue')||v==='labornebleue'||v.includes('alize')||v.includes('bouygues energies')||v==='sipperec'||v.includes('sipperec'));
  }
"""
addition = marker + """  function addressFingerprint(value){
    const raw=norm(value),parts=raw.split(' ').filter(Boolean);
    const number=(raw.match(/\\b\\d{1,4}\\b/)||[])[0]||'';
    const postcode=(raw.match(/\\b(?:75|77|78|91|92|93|94|95)\\d{3}\\b/)||[])[0]||'';
    const stop=new Set(['rue','avenue','av','boulevard','bd','place','allee','route','chemin','impasse','quai','square','france','ile','de','la','le','du','des','sur','seine','cedex']);
    const tokens=parts.filter(x=>x!==number&&x!==postcode&&!/^\\d+$/.test(x)&&x.length>=3&&!stop.has(x));
    return{number,postcode,tokens:new Set(tokens)};
  }
  function sameStreetAddress(a,b){
    const x=addressFingerprint(a),y=addressFingerprint(b);
    if(!x.number||!y.number||x.number!==y.number)return false;
    if(x.postcode&&y.postcode&&x.postcode!==y.postcode)return false;
    const shared=[...x.tokens].filter(t=>y.tokens.has(t));
    return shared.length>=2;
  }
"""
s = replace_once(s, marker, addition, "LBB identity marker")
old = """  function buildAssignments(base,official){
    const pairs=[];
    base.forEach((st,index)=>{
      if(st?.source==='teslaSupercharger')return;
      const lat=Number(st?.latitude),lon=Number(st?.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))return;
      official.forEach((loc,locIndex)=>{
        const meters=haversineKm(lat,lon,loc.latitude,loc.longitude)*1000;
        const allowed=meters<=MAX_NEUTRAL_MATCH_METERS+1e-6||(isLikelyLabornebleueStation(st)&&meters<=MAX_MATCH_METERS+1e-6);
        if(allowed)pairs.push({index,locIndex,meters});
      });
    });
    pairs.sort((a,b)=>a.meters-b.meters||a.index-b.index||a.locIndex-b.locIndex);
    const assignedBase=new Set(),byLocation=new Map();
    for(const pair of pairs){
      if(assignedBase.has(pair.index))continue;
      assignedBase.add(pair.index);
      if(!byLocation.has(pair.locIndex))byLocation.set(pair.locIndex,[]);
      byLocation.get(pair.locIndex).push(pair);
    }
    return{assignedBase,byLocation};
  }"""
new = """  function buildAssignments(base,official){
    const pairs=[];
    base.forEach((st,index)=>{
      if(st?.source==='teslaSupercharger')return;
      const lat=Number(st?.latitude),lon=Number(st?.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))return;
      official.forEach((loc,locIndex)=>{
        const meters=haversineKm(lat,lon,loc.latitude,loc.longitude)*1000;
        const likely=isLikelyLabornebleueStation(st),addressMatch=likely&&sameStreetAddress(st?.address||st?._sourceAddress||'',loc?.address||'');
        let matchMode='',rank=9;
        if(addressMatch&&meters<=1000){matchMode='address_operator';rank=0;}
        else if(likely&&meters<=250+1e-6){matchMode='geo_operator';rank=1;}
        else if(meters<=MAX_NEUTRAL_MATCH_METERS+1e-6){matchMode='geo_neutral';rank=2;}
        if(matchMode)pairs.push({index,locIndex,meters,matchMode,rank});
      });
    });
    pairs.sort((a,b)=>a.rank-b.rank||a.meters-b.meters||a.index-b.index||a.locIndex-b.locIndex);
    const assignedBase=new Set(),assignedOfficial=new Set(),byLocation=new Map();
    for(const pair of pairs){
      if(assignedBase.has(pair.index)||assignedOfficial.has(pair.locIndex))continue;
      assignedBase.add(pair.index);assignedOfficial.add(pair.locIndex);
      byLocation.set(pair.locIndex,[pair]);
    }
    return{assignedBase,byLocation};
  }"""
s = replace_once(s, old, new, "LBB assignment marker")
s = replace_once(
    s,
    "labornebleueMatchDistanceMeters:Math.round(ordered[0].meters),_labornebleueOverlayRevision:REVISION};",
    "labornebleueMatchDistanceMeters:Math.round(ordered[0].meters),labornebleueMatchMode:ordered[0].matchMode||'geo',_labornebleueOverlayRevision:REVISION};",
    "LBB match diagnostics marker",
)
start = s.index("  function readSubscriptionState()")
end = s.index("  function markRevision()", start)
native = """  const SUBSCRIPTION_PLAN={id:SUBSCRIPTION_ID,selectionId:SUBSCRIPTION_ID,provider:'La Borne Bleue — Abonnement',offerType:'subscription',runtime:'existing_labornebleue_direct',monthlyFeeLabel:'10 €/an',defaultSelected:false,operatorAliases:['La Borne Bleue'],directOperatorOnly:true,source:'data-lab/labornebleue_official_idf.json'};
  function registerPlan(){
    const overlay=window.TCC_TARIFF_OVERLAY_V1;
    if(overlay&&Array.isArray(overlay.subscriptions)){
      const index=overlay.subscriptions.findIndex(p=>text(p?.selectionId||p?.id)===SUBSCRIPTION_ID);
      if(index>=0)overlay.subscriptions[index]={...overlay.subscriptions[index],...SUBSCRIPTION_PLAN};else overlay.subscriptions.push(clone(SUBSCRIPTION_PLAN));
    }
    const api=window.TCCV8Subscriptions;
    if(typeof api?.registerPlan==='function')api.registerPlan(SUBSCRIPTION_PLAN);
    document.getElementById('tccLabornebleueSubscriptionControl')?.remove();
    try{window.TCCV8DirectResolver?.renderSubscriptionDropdown?.(true)}catch(e){}
    return typeof api?.registerPlan==='function';
  }
  function providerText(row){const el=row.querySelector('.v8-offer-provider');return norm(el?.textContent||row.dataset?.tccProvider||'');}
  function tagSubscriptionRows(){
    document.querySelectorAll('#results .v8-offer-row').forEach(row=>{
      const provider=providerText(row);
      if(provider.includes('la borne bleue direct abonne')||provider==='abonne'){
        const card=row.closest?.('.result-card');const op=norm(card?.querySelector?.('.operator-badge')?.textContent||'');
        if(provider.includes('la borne bleue')||op.includes('la borne bleue')){row.dataset.subscriptionId=SUBSCRIPTION_ID;row.dataset.tccProvider='La Borne Bleue direct — Abonné';}
      }
    });
  }
  function installUiObserver(){
    const root=document.documentElement;if(!root||uiObserver)return false;
    let timer=null;uiObserver=new MutationObserver(()=>{if(uiBusy)return;clearTimeout(timer);timer=setTimeout(()=>{uiBusy=true;try{registerPlan();tagSubscriptionRows();window.TCCV8Subscriptions?.applyAll?.(true);}finally{uiBusy=false;}},120)});uiObserver.observe(root,{childList:true,subtree:true});return true;
  }

"""
s = s[:start] + native + s[end:]
s = replace_once(
    s,
    "attempts++;installPricing();installCandidateWrapper();registerPlan();installSubscriptionApiShim();installUiObserver();injectSubscriptionControl();tagSubscriptionRows();",
    "attempts++;installPricing();installCandidateWrapper();registerPlan();installUiObserver();tagSubscriptionRows();",
    "LBB timer subscription marker",
)
s = s.replace(
    "setTimeout(()=>{markRevision();installUiObserver();injectSubscriptionControl();tagSubscriptionRows();},0)",
    "setTimeout(()=>{markRevision();registerPlan();installUiObserver();tagSubscriptionRows();},0)",
)
s = replace_once(
    s,
    "registerPlan,installSubscriptionApiShim,tagSubscriptionRows,subscriptionId:SUBSCRIPTION_ID",
    "registerPlan,tagSubscriptionRows,sameStreetAddress,subscriptionId:SUBSCRIPTION_ID",
    "LBB export marker",
)
for obsolete in ("injectSubscriptionControl", "installSubscriptionApiShim", "setSubscriptionSelected", "subscriptionShimmed"):
    if obsolete in s:
        raise SystemExit(f"legacy LBB subscription workaround still present: {obsolete}")
p.write_text(s, encoding="utf-8")


# 4) Extend runtime regression tests.
p = Path("scripts/test_labornebleue_v8_runtime.mjs")
t = p.read_text(encoding="utf-8")
marker = "const api=sandbox.TCCV8LaBorneBleueDirect;assert.ok(api);api.validateData(data);"
extra = marker + """
const nominal2208=[];for(const st of data.stations)for(const cfg of st.configurations)if(cfg.kind==='AC'&&Number(cfg.powerKw)>22&&Number(cfg.powerKw)<=22.1)nominal2208.push({st,cfg});
assert.ok(nominal2208.length>0,'real LBB data should contain nominal 22.08 kW');
for(const {cfg} of nominal2208){const ex=cfg.pricing.labornebleueExact;if(cfg.subscriptionId==='labornebleue-annual')assert.ok(Math.abs((ex.windows?.[0]?.ratePerMinute||0)*60-5.5)<1e-9);else assert.ok(Math.abs((ex.ratePerMinute||0)*60-6.5)<1e-9);}
"""
t = replace_once(t, marker, extra, "runtime test API marker")
marker2 = "const prepared={origin:{lat:48.01419,lon:0.18728},maxDistanceKm:1,stations:[]};api.mergePrepared(prepared,data);"
addrtest = """const addressOfficial=data.stations.find(st=>/henri poincar/i.test(String(st.address||'')))||data.stations.find(st=>String(st.address||'').match(/\\b\\d+\\b/));assert.ok(addressOfficial,'address fixture missing');
const shifted={id:'external-lbb-address',catalogStationId:'electroverse:lbb-address',operator:'La Borne Bleue',name:addressOfficial.name,address:addressOfficial.address,latitude:Number(addressOfficial.latitude)+0.0018,longitude:Number(addressOfficial.longitude),countryCode:'FR',chargingConfigurations:[],operationalStatus:'available',operationalStatusSource:'Electroverse'};
const addressPrepared={origin:{lat:Number(addressOfficial.latitude),lon:Number(addressOfficial.longitude)},maxDistanceKm:2,stations:[shifted]};api.mergePrepared(addressPrepared,data);const joined=addressPrepared.stations.find(st=>st.labornebleueStationId===addressOfficial.stationId);assert.ok(joined,'address-aware LBB join failed');assert.equal(joined.labornebleueMatchMode,'address_operator');assert.equal(joined.operationalStatus,'available');assert.ok(joined.chargingConfigurations.some(c=>c.labornebleueDirect));
const neutral={...shifted,id:'neutral-nearby',catalogStationId:'other:neutral',operator:'Other CPO',name:'Other CPO',address:'99 Rue Sans Rapport 92230 Gennevilliers'};const neutralPrepared={origin:{lat:Number(addressOfficial.latitude),lon:Number(addressOfficial.longitude)},maxDistanceKm:2,stations:[neutral]};api.mergePrepared(neutralPrepared,data);const neutralSame=neutralPrepared.stations.find(st=>st.catalogStationId==='other:neutral');assert.ok(neutralSame,'neutral source should be retained');assert.ok(!(neutralSame.chargingConfigurations||[]).some(c=>c.labornebleueDirect),'neutral unrelated source must not inherit LBB direct');
""" + marker2
t = replace_once(t, marker2, addrtest, "runtime prepared marker")
p.write_text(t, encoding="utf-8")


# 5) Dedicated native subscription regression test.
Path("scripts/test_labornebleue_subscription_runtime.mjs").write_text(
    """import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(process.argv[2]||'assets/v8-subscription-selection.js','utf8');
const store=new Map();
const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
const sandbox={console,localStorage,setInterval:()=>0,clearInterval:()=>{},setTimeout:fn=>{fn();return 0},clearTimeout:()=>{},document:{readyState:'loading',addEventListener:()=>{},getElementById:()=>null,head:{appendChild:()=>{}}}};sandbox.window=sandbox;
vm.createContext(sandbox);vm.runInContext(source,sandbox,{filename:'v8-subscription-selection.js'});
const api=sandbox.TCCV8Subscriptions;assert.ok(api);
assert.equal(api.subscriptionIdForProvider('La Borne Bleue direct — Abonné'),'labornebleue-annual');
const st={configurationLabel:'La Borne Bleue direct — Abonné · AC 7.36 kW',subscriptionId:'labornebleue-annual'};
assert.equal(api.isStationEligible(st),false,'LBB subscriber must be excluded while unselected');
localStorage.setItem('tccSubscriptionsV1',JSON.stringify({selected:['labornebleue-annual']}));
assert.equal(api.isStationEligible(st),true,'LBB subscriber must be eligible when selected');
api.registerPlan({id:'labornebleue-annual',selectionId:'labornebleue-annual',provider:'La Borne Bleue — Abonnement',monthlyFeeLabel:'10 €/an'});
assert.ok(api.plans.some(p=>(p.selectionId||p.id)==='labornebleue-annual'),'late LBB plan should enter native dropdown list');
console.log(JSON.stringify({ok:true,subscription:'labornebleue-annual',nativePlan:true},null,2));
""",
    encoding="utf-8",
)


# 6) Expand long-term LBB CI coverage.
p = Path(".github/workflows/v8-labornebleue-direct.yml")
w = p.read_text(encoding="utf-8")
w = replace_once(
    w,
    "      - feat/labornebleue-direct-v8-20260825\n      - release/2026-08",
    "      - feat/labornebleue-direct-v8-20260825\n      - fix/labornebleue-v8-runtime-20260825\n      - release/2026-08",
    "workflow branch marker",
)
w = replace_once(
    w,
    "      - assets/v8-labornebleue-direct-overlay.js\n      - assets/update.js",
    "      - assets/v8-labornebleue-direct-overlay.js\n      - assets/v8-subscription-selection.js\n      - assets/app.js\n      - assets/update.js",
    "workflow path marker",
)
w = replace_once(
    w,
    "      - scripts/test_labornebleue_v8_runtime.mjs\n      - .github/workflows/v8-labornebleue-direct.yml",
    "      - scripts/test_labornebleue_v8_runtime.mjs\n      - scripts/test_labornebleue_subscription_runtime.mjs\n      - .github/workflows/v8-labornebleue-direct.yml",
    "workflow test path marker",
)
cmd = "node scripts/test_labornebleue_v8_runtime.mjs assets/v8-labornebleue-direct-overlay.js /tmp/labornebleue_direct_stations_idf.json.gz"
w = replace_once(
    w,
    cmd,
    cmd + "\n          node scripts/test_labornebleue_subscription_runtime.mjs assets/v8-subscription-selection.js",
    "workflow runtime command",
)
p.write_text(w, encoding="utf-8")

print("LBB V8 runtime patch applied")
