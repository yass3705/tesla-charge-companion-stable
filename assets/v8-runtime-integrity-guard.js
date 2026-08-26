// Tesla Charge Companion V8 — runtime integrity guard.
// Keeps preview-local data isolated from the repository root even when a legacy
// module still emits a ../data/... URL. Cross-origin operator APIs are untouched.
(function(){
  'use strict';
  const REVISION='v8-runtime-integrity-1';
  if(window.TCCV8RuntimeIntegrity?.revision===REVISION)return;

  const marker='/v8-preview/';
  const pathname=String(window.location?.pathname||'');
  const markerIndex=pathname.indexOf(marker);
  const repoRoot=markerIndex>=0?pathname.slice(0,markerIndex+1):'';
  const previewRoot=markerIndex>=0?pathname.slice(0,markerIndex+marker.length):'';
  const nativeFetch=typeof window.fetch==='function'?window.fetch.bind(window):null;
  const diagnostics=[];

  function record(from,to){
    diagnostics.push({at:new Date().toISOString(),from,to});
    if(diagnostics.length>40)diagnostics.shift();
  }

  function rewriteUrl(value){
    const href=String(window.location?.href||'http://localhost/');
    const url=new URL(value,href);
    if(!previewRoot||url.origin!==window.location?.origin)return url;
    const rootData=`${repoRoot}data/`;
    const previewData=`${previewRoot}data/`;
    if(url.pathname.startsWith(rootData)&&!url.pathname.startsWith(previewData)){
      const before=url.href;
      url.pathname=previewData+url.pathname.slice(rootData.length);
      record(before,url.href);
    }
    return url;
  }

  function inputUrl(input){
    if(typeof Request!=='undefined'&&input instanceof Request)return input.url;
    return String(input);
  }

  function requestMethod(input,init){
    if(init?.method)return String(init.method).toUpperCase();
    if(typeof Request!=='undefined'&&input instanceof Request)return String(input.method||'GET').toUpperCase();
    return 'GET';
  }

  if(nativeFetch){
    const wrapped=function(input,init){
      try{
        if(requestMethod(input,init)==='GET'){
          const next=rewriteUrl(inputUrl(input));
          const isRequest=typeof Request!=='undefined'&&input instanceof Request;
          input=isRequest?new Request(next.href,input):next.href;
        }
      }catch(error){
        console.warn('[TCC V8] Garde d’isolation des données ignoré :',error?.message||error);
      }
      return nativeFetch(input,init);
    };
    wrapped.__tccRuntimeIntegrityGuard=true;
    wrapped.__tccOriginal=nativeFetch;
    window.fetch=wrapped;
  }

  window.TCCV8RuntimeIntegrity={
    revision:REVISION,
    previewActive:!!previewRoot,
    repoRoot,
    previewRoot,
    rewriteUrl,
    get diagnostics(){return diagnostics.slice();}
  };
  try{document.dispatchEvent(new CustomEvent('tcc:runtime-integrity-ready',{detail:{revision:REVISION,previewActive:!!previewRoot}}));}catch(e){}
  console.info('[TCC V8] Garde d’intégrité runtime actif : données preview isolées du root.',REVISION);
})();
