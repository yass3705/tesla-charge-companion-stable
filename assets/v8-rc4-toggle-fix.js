// V8 RC4 — garantir un recalcul propre lors d'un changement Electra+.
(function(){
  'use strict';
  function bind(){
    const plan=document.getElementById('v8ElectraPlan'),rank=document.getElementById('v8ElectraRanking');
    if(!plan||!rank||plan.__tccRc4Recalc)return false;
    const recalc=()=>setTimeout(()=>{if(typeof window.compare==='function'&&document.getElementById('results')?.children.length)window.compare().catch(()=>{});},0);
    plan.addEventListener('change',recalc);rank.addEventListener('change',recalc);plan.__tccRc4Recalc=true;return true;
  }
  let n=0;const timer=setInterval(()=>{n++;if(bind()||n>120)clearInterval(timer)},100);
})();
