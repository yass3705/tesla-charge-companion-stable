// Tesla Charge Companion V8 RC4.8 — dimensions tarifaires E55C Scan & Pay.
// E55C facture le temps de charge et le temps de stationnement en parallèle.
// Le moteur historique traite déjà le temps de charge ; cette extension ajoute
// uniquement la dimension stationnement sur toute la durée de connexion.
(function(){
  'use strict';
  const REVISION='rc48-e55c-1';
  const text=value=>String(value==null?'':value).trim();

  function mins(value){
    const match=text(value||'00:00').match(/^(\d{1,2}):(\d{2})/);
    return match?((Number(match[1])*60+Number(match[2]))%1440):0;
  }
  function inWindow(minute,start,end){
    const from=mins(start||'00:00'),to=end==='24:00'?1440:mins(end||'24:00');
    if(from===to)return true;
    return from<to?(minute>=from&&minute<to):(minute>=from||minute<to);
  }
  function ruleFor(rules,minute){
    return (rules||[]).find(rule=>rule?.scope==='timeWindow'&&inWindow(minute,rule.start,rule.end))
      ||(rules||[]).find(rule=>rule?.scope==='allDay')
      ||null;
  }
  function convert(amount,currency){
    if(typeof window.fxToEur==='function')return Number(window.fxToEur(amount,currency||'EUR')||0);
    if(typeof fxToEur==='function')return Number(fxToEur(amount,currency||'EUR')||0);
    return Number(amount||0);
  }
  function parkingCost(pricing,startMinute,occupiedMinutes){
    const rules=Array.isArray(pricing?.rules)?pricing.rules:[];
    const occupied=Math.max(0,Number(occupiedMinutes||0));
    if(!rules.some(rule=>rule?.e55cDirect===true&&Number(rule?.parkingPerMinute||0)>0)||!(occupied>0))return 0;
    let total=0;
    for(let offset=0;offset<Math.ceil(occupied);offset++){
      const fraction=Math.min(1,occupied-offset);
      if(!(fraction>0))continue;
      const minute=((Number(startMinute||0)+offset)%1440+1440)%1440;
      const rule=ruleFor(rules,minute);
      if(!rule||rule.e55cDirect!==true)continue;
      const rate=Math.max(0,Number(rule.parkingPerMinute||0));
      if(!(rate>0))continue;
      total+=convert(rate*fraction,rule.currency||'EUR');
    }
    return total;
  }
  function installPricing(){
    if(window.__TCC_E55C_PRICING_INSTALLED__)return true;
    const current=window.priceWithRules;
    if(typeof current!=='function')return false;
    const wrapped=function(pp,startMinute,chargeMinutes,billedEnergy,unplugTime,startTime,powerSegments=[]){
      const result=current.apply(this,arguments);
      if(!result||result.error||!Number.isFinite(Number(result.total)))return result;
      const extra=parkingCost(pp,startMinute,Number(result.occupiedMinutes||chargeMinutes||0));
      if(!(extra>0))return result;
      result.total=Number(result.total||0)+extra;
      result.parkingCost=Number(result.parkingCost||0)+extra;
      result.e55cDirectPricing=true;
      return result;
    };
    wrapped.__tccE55cParkingV1=true;
    wrapped.__tccOriginal=current;
    window.priceWithRules=wrapped;
    try{priceWithRules=wrapped}catch(error){}
    window.__TCC_E55C_PRICING_INSTALLED__=true;
    console.info('[TCC V8] Tarifs E55C directs actifs : charge et stationnement séparés.');
    return true;
  }

  let attempts=0;
  const timer=setInterval(()=>{
    attempts++;
    if(installPricing()||attempts>180)clearInterval(timer);
  },50);

  window.TCCV8E55CPricing={parkingCost,ruleFor,installPricing,revision:REVISION};
})();
