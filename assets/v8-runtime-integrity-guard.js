// Tesla Charge Companion V8 — runtime integrity guard.
// Keeps preview-local data isolated from the repository root even when a legacy
// module still emits a ../data/... URL. Cross-origin operator APIs are untouched.
(function(){
  'use strict';
  const REVISION='v8-runtime-integrity-2-powerdot-fr';
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

  function isPowerdotDataUrl(value){
    try{
      const url=new URL(String(value),String(window.location?.href||'http://localhost/'));
      return /\/data\/powerdot_direct_france\.json\.gz$/i.test(url.pathname);
    }catch(e){return false;}
  }

  function responseFromBytes(bytes,response,contentType='application/gzip'){
    const headers=new Headers(response?.headers||{});
    headers.delete('content-length');
    headers.delete('content-encoding');
    if(contentType)headers.set('content-type',contentType);
    return new Response(bytes,{
      status:response?.status||200,
      statusText:response?.statusText||'OK',
      headers
    });
  }

  async function sanitizePowerdotResponse(response,url){
    if(!response?.ok||!isPowerdotDataUrl(url))return response;
    let bytes=null;
    try{
      bytes=new Uint8Array(await response.arrayBuffer());
      if(bytes[0]!==0x1f||bytes[1]!==0x8b)return responseFromBytes(bytes,response,response.headers?.get?.('content-type')||'application/octet-stream');
      if(typeof DecompressionStream!=='function'||typeof CompressionStream!=='function')return responseFromBytes(bytes,response);
      const body=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
      const data=JSON.parse(body);
      const source=Array.isArray(data?.chargers)?data.chargers:[];
      if(!source.length)return responseFromBytes(bytes,response);
      const french=source.filter(entry=>String(entry?.location?.countryCode||'').toUpperCase()==='FR');
      if(french.length===source.length)return responseFromBytes(bytes,response);
      const filtered={
        ...data,
        chargers:french,
        counts:{
          ...(data.counts||{}),
          sourceApiSuccessChargers:Number(data?.counts?.sourceApiSuccessChargers||source.length),
          apiSuccessChargers:french.length,
          excludedForeignChargers:source.length-french.length
        }
      };
      const encoded=new TextEncoder().encode(JSON.stringify(filtered));
      const compressed=new Blob([encoded]).stream().pipeThrough(new CompressionStream('gzip'));
      record(url,`${url}#powerdot-fr-only:${french.length}/${source.length}`);
      return responseFromBytes(compressed,response);
    }catch(error){
      console.warn('[TCC V8] Filtrage Powerdot France ignoré :',error?.message||error);
      return bytes?responseFromBytes(bytes,response):response;
    }
  }

  if(nativeFetch){
    const wrapped=function(input,init){
      let finalUrl=inputUrl(input);
      const method=requestMethod(input,init);
      try{
        if(method==='GET'){
          const next=rewriteUrl(finalUrl);
          finalUrl=next.href;
          const isRequest=typeof Request!=='undefined'&&input instanceof Request;
          input=isRequest?new Request(next.href,input):next.href;
        }
      }catch(error){
        console.warn('[TCC V8] Garde d’isolation des données ignoré :',error?.message||error);
      }
      const result=nativeFetch(input,init);
      return method==='GET'&&isPowerdotDataUrl(finalUrl)
        ?Promise.resolve(result).then(response=>sanitizePowerdotResponse(response,finalUrl))
        :result;
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
    sanitizePowerdotResponse,
    get diagnostics(){return diagnostics.slice();}
  };
  try{document.dispatchEvent(new CustomEvent('tcc:runtime-integrity-ready',{detail:{revision:REVISION,previewActive:!!previewRoot}}));}catch(e){}
  console.info('[TCC V8] Garde d’intégrité runtime actif : données preview isolées du root + Powerdot France assaini.',REVISION);
})();
