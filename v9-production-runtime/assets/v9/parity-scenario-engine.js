(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.TCCV9ParityScenarioEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const text=v=>String(v==null?'':v).trim();
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
  const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const addMinutes=(value,minutes)=>{if(!value)return null;const d=new Date(value);if(Number.isNaN(d.getTime()))return null;return new Date(d.getTime()+Number(minutes||0)*60000).toISOString();};
  const setClock=(value,hour,minute=0)=>{if(!value)return null;const d=new Date(value);if(Number.isNaN(d.getTime()))return null;d.setHours(hour,minute,0,0);return d.toISOString();};

  function merge(base,patch){
    if(patch==null)return clone(base);
    if(Array.isArray(patch)||typeof patch!=='object')return clone(patch);
    const out={...(base&&typeof base==='object'&&!Array.isArray(base)?clone(base):{})};
    for(const [key,value] of Object.entries(patch)){
      if(value&&typeof value==='object'&&!Array.isArray(value))out[key]=merge(out[key],value);
      else out[key]=clone(value);
    }
    return out;
  }

  function scenario(id,label,patch={},options={}){
    return{
      id:text(id),label:text(label)||text(id),description:text(options.description),
      gateMode:options.gateMode==='observe'?'observe':'strict',
      tags:Array.isArray(options.tags)?options.tags.map(text).filter(Boolean):[],
      queryPatch:patch||{},parityOptions:options.parityOptions||{}
    };
  }

  function defaultScenarios(baseQuery={}){
    const s=baseQuery.session||{},start=s.startAt||new Date().toISOString(),target=num(s.targetSoc)??80,disconnect=s.disconnectAt||addMinutes(start,180);
    const rows=[
      scenario('baseline','Référence 20→80',{session:{startSoc:20,targetSoc:80,startAt:start,disconnectAt:disconnect}},{tags:['core','soc','strict'],description:'Cas de référence pour coût, SOC et temps.'}),
      scenario('upper-soc','Recharge 80→100',{session:{startSoc:80,targetSoc:100,startAt:start,disconnectAt:addMinutes(start,180)}},{tags:['dc-taper','soc','strict'],description:'Détecte les divergences de ralentissement en haut de batterie.'}),
      scenario('short-deadline','Débranchement anticipé',{session:{startSoc:20,targetSoc:target,startAt:start,disconnectAt:addMinutes(start,35)}},{tags:['deadline','soc','strict'],description:'Le SOC cible peut ne pas être atteint avant le débranchement.'}),
      scenario('post-charge','Occupation après charge',{session:{startSoc:20,targetSoc:50,startAt:start,disconnectAt:addMinutes(start,240)}},{tags:['occupancy','pricing','strict'],description:'Expose les frais de stationnement ou congestion après la fin de charge.'}),
      scenario('evening-window','Créneau tarifaire du soir',{session:{startSoc:20,targetSoc:60,startAt:setClock(start,18,30),disconnectAt:setClock(start,22,0)}},{tags:['pricing-window','strict'],description:'Teste les changements de tarif selon l’heure de branchement.'})
    ];
    if((baseQuery.selectedSubscriptions||s.selectedSubscriptions||[]).length){
      rows.push(scenario('selected-subscriptions','Abonnement(s) sélectionné(s)',{selectedSubscriptions:baseQuery.selectedSubscriptions||s.selectedSubscriptions,session:{selectedSubscriptions:baseQuery.selectedSubscriptions||s.selectedSubscriptions}},{gateMode:'observe',tags:['subscription','observation'],description:'Écart attendu possible si V9 applique une offre absente du modèle V8.'}));
    }
    return rows;
  }

  function criticalDifferences(parity){
    const rows=[];
    for(const change of parity?.changed||[]){
      for(const diff of [...(change.differences||[]),...(change.sessionDifferences||[])]){
        if(diff.severity==='error')rows.push({stationId:change.rightId||change.leftId||'',field:diff.field,left:diff.left,right:diff.right,delta:diff.delta??null});
      }
    }
    for(const row of parity?.v8Only||[])rows.push({stationId:row.id||row.name||'',field:'stationMissingInV9',left:true,right:false,delta:null});
    return rows;
  }

  function warningDifferences(parity){
    const rows=[];
    for(const change of parity?.changed||[]){
      for(const diff of [...(change.differences||[]),...(change.sessionDifferences||[])]){
        if(diff.severity==='warning')rows.push({stationId:change.rightId||change.leftId||'',field:diff.field,left:diff.left,right:diff.right,delta:diff.delta??null});
      }
    }
    return rows;
  }

  function summarize(results=[]){
    const strict=results.filter(r=>r.gateMode==='strict'),observe=results.filter(r=>r.gateMode==='observe'),strictFailed=strict.filter(r=>!r.pass);
    return{
      scenarioCount:results.length,strictScenarioCount:strict.length,observationScenarioCount:observe.length,
      strictPassedCount:strict.length-strictFailed.length,strictFailedCount:strictFailed.length,
      observationWithDifferencesCount:observe.filter(r=>r.criticalDifferences.length||r.warningDifferences.length||!r.parity?.gates?.pass).length,
      criticalDifferenceCount:results.reduce((n,r)=>n+r.criticalDifferences.length,0),
      warningDifferenceCount:results.reduce((n,r)=>n+r.warningDifferences.length,0),
      matrixPass:strictFailed.length===0
    };
  }

  async function runMatrix({baseQuery={},scenarios=null,v8Query,v9Engine,parityEngine,parityOptions={}}={}){
    if(typeof v8Query!=='function')throw new Error('v8Query function is required');
    if(!v9Engine||typeof v9Engine.queryArea!=='function')throw new Error('v9Engine.queryArea is required');
    if(!parityEngine||typeof parityEngine.shadowQuery!=='function')throw new Error('parityEngine.shadowQuery is required');
    const cases=(scenarios||defaultScenarios(baseQuery)).map(x=>({...x})),results=[];
    for(const item of cases){
      const query=merge(baseQuery,item.queryPatch||{}),options=merge(parityOptions,item.parityOptions||{});
      const shadow=await parityEngine.shadowQuery({v8Query,v9Engine,query,options}),parity=shadow.parity;
      const critical=criticalDifferences(parity),warnings=warningDifferences(parity),strict=item.gateMode!=='observe',pass=strict?!!parity?.gates?.pass:true;
      results.push({id:item.id,label:item.label,description:item.description,gateMode:strict?'strict':'observe',tags:item.tags||[],query,parity,pass,classification:strict?(pass?'parity':'regression'):(critical.length||warnings.length||!parity?.gates?.pass?'review':'parity'),criticalDifferences:critical,warningDifferences:warnings,shadow});
    }
    return{generatedAt:new Date().toISOString(),baseQuery:clone(baseQuery),results,summary:summarize(results)};
  }

  return{scenario,defaultScenarios,runMatrix,summarize,criticalDifferences,warningDifferences,merge,addMinutes,setClock};
});
