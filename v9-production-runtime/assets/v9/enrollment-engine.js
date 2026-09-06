(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.TCCV9EnrollmentEngine=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
  const text=v=>String(v==null?'':v).trim();
  function normalizeIdentity(v){return text(v).toLowerCase();}
  function enrollmentEntry(identity,{label='',notes=''}={}){const id=normalizeIdentity(identity);if(!id)throw new Error('identity is required');return{id,label:text(label),notes:text(notes)};}
  function whitelistPatch(identity,config={},meta={}){const entry=enrollmentEntry(identity,meta),ids=[...new Set([...(config.identities||[]).map(normalizeIdentity).filter(Boolean),entry.id])];return{schemaVersion:Number(config.schemaVersion)||1,enabled:config.enabled===true,requireReadiness:config.requireReadiness!==false,identities:ids,candidatePath:text(config.candidatePath)||'v9-app/',fallbackPath:text(config.fallbackPath)||'./'};}
  function enrollmentBundle(identity,{label='',notes='',candidatePath='v9-app/'}={}){const entry=enrollmentEntry(identity,{label,notes});return{schemaVersion:1,type:'tcc-v9-whitelist-enrollment',createdAt:new Date().toISOString(),identity:entry.id,label:entry.label,notes:entry.notes,candidatePath:text(candidatePath)||'v9-app/',whitelistSnippet:{identities:[entry.id]}};}
  function stringifyBundle(bundle){return JSON.stringify(bundle,null,2);}
  return{normalizeIdentity,enrollmentEntry,whitelistPatch,enrollmentBundle,stringifyBundle};
});