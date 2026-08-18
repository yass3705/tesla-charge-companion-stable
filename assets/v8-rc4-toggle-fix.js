// V8 RC4.1 — recalcul propre lors du changement de prise en compte Electra+.
(function(){
  'use strict';
  function bind(){
    const rank=document.getElementById('v8ElectraRanking');
    if(!rank||rank.__tccRc41Recalc)return false;
    const recalc=()=>setTimeout(()=>{if(typeof window.compare==='function'&&document.getElementById('results')?.children.length)window.compare().catch(()=>{});},0);
    rank.addEventListener('change',recalc);rank.__tccRc41Recalc=true;return true;
  }
  let n=0;const timer=setInterval(()=>{n++;if(bind()||n>120)clearInterval(timer)},100);
})();
