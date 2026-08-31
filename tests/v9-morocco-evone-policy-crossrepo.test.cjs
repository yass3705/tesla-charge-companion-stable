const assert=require('assert');
const https=require('https');
const adapter=require('../assets/v9/adapters/morocco-nonproduction.js');

const POLICY='https://raw.githubusercontent.com/yass3705/tesla-charge-companion-data-lab/main/reports/morocco/evone/production-status-policy.json';
const ROLE='https://raw.githubusercontent.com/yass3705/tesla-charge-companion-data-lab/main/reports/morocco/evone/public-emsp-client-role-2026-08-31.json';
function getJson(url){return new Promise((resolve,reject)=>https.get(url,{headers:{'User-Agent':'TCC-V9-public-readonly-policy-guard'}},r=>{let b='';r.setEncoding('utf8');r.on('data',c=>{b+=c;if(b.length>200000)r.destroy(new Error('response too large'));});r.on('end',()=>{if(r.statusCode!==200)return reject(new Error(`HTTP ${r.statusCode}`));try{resolve(JSON.parse(b));}catch(e){reject(e);}});}).on('error',reject));}

(async()=>{
  const [policy,role]=await Promise.all([getJson(POLICY),getJson(ROLE)]);
  const p=policy.production_status_policy||{};
  assert.deepEqual([...adapter.allowedStatuses].sort(),[...(p.allowed||[])].sort(),'V9 allowed EVOne statuses must match data-lab policy');
  assert.deepEqual([...adapter.excludedStatuses].sort(),[...(p.excluded||[])].sort(),'V9 excluded EVOne statuses must match data-lab policy');
  assert.equal(p.unknown_or_unmapped_status_default,'exclude_from_production');
  for(const s of p.allowed||[])assert.equal(adapter.evoneStatusClass(s),'production',`${s} production`);
  for(const s of p.excluded||[])assert.equal(adapter.evoneStatusClass(s),'diagnostic_only',`${s} diagnostic only`);
  assert.equal(adapter.evoneStatusClass('FutureUnexpectedStatus'),'excluded_unmapped');

  const resolution=role.modeling_resolution||{};
  const rp=role.production_status_policy||{};
  assert.deepEqual([...(rp.allowed_evone_statuses||[])].sort(),[...adapter.allowedStatuses].sort(),'public eMSP role report allowed statuses must match V9');
  assert.deepEqual([...(rp.diagnostic_only_statuses||[])].sort(),[...adapter.excludedStatuses].sort(),'public eMSP role report diagnostic statuses must match V9');
  assert.equal(rp.unexpected_or_missing_status,'exclude_from_production');
  assert(/MUST NOT default to EVPlug or EvOne/i.test(String(resolution.cpo_operator||'')),'public evidence must classify CPO as station-specific');
  assert(/EVPlug \/ EvOne/i.test(String(resolution.app_source_access_network||'')),'public evidence must classify EVPlug/EvOne as client/access network');
  assert(/eMSP|roaming/i.test(String(resolution.tariff_channel||'')),'public evidence must keep EVPlug/EvOne tariff as eMSP/roaming');
  assert(/prefer verified native CPO status/i.test(String(resolution.status_source||'')),'public evidence must prefer native CPO status');

  const base={physicalOperator:{name:'Nareva Services / EVGO'},access:{siteBrand:'Marjane'},status:{state:'available',nativeState:'available',statusSource:'EVGO native backend cp.evgo.ma'},offers:[]};
  const overlay=adapter.applyEvoneOverlay(base,{status:'Occupied',site_brand:'Different Host',offers:[{id:'emsp-test',provider:'EVPlug'}]});
  assert(overlay,'allowed EVOne status should produce overlay');
  assert.equal(overlay.physicalOperator.name,'Nareva Services / EVGO','EVOne must not overwrite CPO');
  assert.equal(overlay.access.siteBrand,'Marjane','EVOne must not overwrite established site_brand');
  assert.equal(overlay.access.appSource,'EVOne');
  assert.equal(overlay.access.accessNetwork,'EVPlug');
  assert.equal(overlay.status.statusSource,'EVGO native backend cp.evgo.ma','native CPO status source wins');
  assert.equal(overlay.offers[0].metadata.tariffChannel,'EVOne / EVPlug eMSP','eMSP tariff channel stays separate');
  for(const s of p.excluded||[])assert.equal(adapter.applyEvoneOverlay(base,{status:s}),null,`${s} excluded from production overlay`);
  assert.equal(adapter.applyEvoneOverlay(base,{status:'FutureUnexpectedStatus'}),null,'unmapped status excluded from production overlay');
  console.log(JSON.stringify({ok:true,allowed:p.allowed,excluded:p.excluded,unknownDefault:p.unknown_or_unmapped_status_default,cpoPreserved:true,siteBrandPreserved:true,nativeStatusSourcePreserved:true,emspTariffChannelSeparated:true,publicEmspRoleValidated:true},null,2));
})().catch(e=>{console.error(e);process.exit(1);});
