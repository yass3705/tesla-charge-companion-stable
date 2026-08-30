(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.TCCV9CanaryIdentity=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
  const KEY='tcc-v9-canary-id-v1';
  function randomId(){if(typeof crypto!=='undefined'&&crypto.randomUUID)return crypto.randomUUID();const a=Math.random().toString(36).slice(2),b=Date.now().toString(36);return `tcc-${b}-${a}`;}
  function get(storage){try{const s=storage||globalThis.localStorage;let id=s?.getItem(KEY);if(!id){id=randomId();s?.setItem(KEY,id);}return id;}catch(_){return randomId();}}
  function reset(storage){try{(storage||globalThis.localStorage)?.removeItem(KEY);return true;}catch(_){return false;}}
  return{KEY,get,reset,randomId};
});