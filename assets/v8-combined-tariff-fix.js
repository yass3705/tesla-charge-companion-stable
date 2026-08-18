// Tesla Charge Companion V8 — correction calcul kWh + durée, sans rematching DOM.
(function(){
  'use strict';
  function install(){
    const original=window.priceWithRules;
    if(typeof original!=='function'||original.__tccCombinedTariffFix)return false;
    const wrapped=function(pp,startMin,chargeMinutes,billedEnergy,unplugTime,startTime,powerSegments=[]){
      const out=original.call(this,pp,startMin,chargeMinutes,billedEnergy,unplugTime,startTime,powerSegments);
      if(!out||out.error||!Number.isFinite(out.total))return out;
      let extra=0;
      try{
        const rules=pp?.rules||[];
        for(let i=0;i<Math.ceil(chargeMinutes);i++){
          const fraction=Math.min(1,chargeMinutes-i);
          const minute=typeof window.minuteOfSession==='function'?window.minuteOfSession(startMin,i):(startMin+i)%1440;
          const rule=typeof window.ruleForMinute==='function'?window.ruleForMinute(rules,minute):null;
          if(!rule||rule.billing!=='kwh')continue;
          const rate=Number(rule.chargePerMinute||0);
          if(!(rate>0))continue;
          const raw=fraction*rate;
          extra+=typeof window.fxToEur==='function'?window.fxToEur(raw,rule.currency||'EUR'):raw;
        }
      }catch(err){console.warn('[TCC V8] minute fee:',err);return out;}
      if(extra>0){
        out.total+=extra;
        out.chargeCost=Number(out.chargeCost||0)+extra;
        out.timeChargeCost=Number(out.timeChargeCost||0)+extra;
      }
      return out;
    };
    wrapped.__tccCombinedTariffFix=true;
    wrapped.__tccOriginal=original;
    window.priceWithRules=wrapped;
    try{priceWithRules=wrapped}catch(e){}
    return true;
  }
  let n=0;const timer=setInterval(()=>{n++;if(install()||n>180)clearInterval(timer);},100);
  console.info('[TCC V8] Calcul kWh + durée activé sans rematching DOM.');
})();
