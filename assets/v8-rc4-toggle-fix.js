// V8 RC4 — petits correctifs d'interaction.
(function(){
  'use strict';

  function bindElectraRecalc(){
    const rank=document.getElementById('v8ElectraRanking');
    if(!rank||rank.__tccRc41Recalc)return false;
    const recalc=()=>setTimeout(()=>{
      if(typeof window.compare==='function'&&document.getElementById('results')?.children.length){
        window.compare().catch(()=>{});
      }
    },0);
    rank.addEventListener('change',recalc);
    rank.__tccRc41Recalc=true;
    return true;
  }

  function bindFilterAutoOpen(){
    const body=document.body;
    const details=document.getElementById('v8FilterBody')?.closest('details');
    if(!body||!details||details.__tccAutoOpenAfterRefresh)return false;

    let refreshSeen=body.classList.contains('v8-area-refreshing');
    const observer=new MutationObserver(()=>{
      const refreshing=body.classList.contains('v8-area-refreshing');
      if(refreshing){
        refreshSeen=true;
        return;
      }
      if(refreshSeen){
        refreshSeen=false;
        // La liste dynamique des opérateurs est maintenant prête : on ouvre
        // systématiquement le panneau pour permettre la sélection finale.
        requestAnimationFrame(()=>{
          details.open=true;
          details.removeAttribute('aria-busy');
        });
      }
    });
    observer.observe(body,{attributes:true,attributeFilter:['class']});
    details.__tccAutoOpenAfterRefresh=true;
    return true;
  }

  let n=0;
  const timer=setInterval(()=>{
    n++;
    const a=bindElectraRecalc();
    const b=bindFilterAutoOpen();
    if((a&&b)||n>180)clearInterval(timer);
  },100);
})();
