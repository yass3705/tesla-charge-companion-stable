
  // Distinguish absent CPO price evidence from an existing price that the
  // calculator cannot resolve. Neither state can be ranked or priced.
  function hasTariffSourceEvidence(item,station){
    const source=(station?.offers||[]).find(offer=>
      text(offer?.id||offer?.offerId)===text(item?.offerId));
    const reason=text(item?.result?.reason||item?.incompletePricingReason);
    if(source?.metadata?.tariffAmbiguous===true)return true;
    if(/ambig|conflict|unresolved|unsupported|requires|missing.*(session|time|curve|power|rule)|no_matching_time_rule|cap_window|unknown.*fee|mixed.*currenc|currency.*validation|conversion|fx_rate/i.test(reason))
      return true;
    const pricing=source?.pricing;
    if(!pricing)return false;
    if(pricing.type==='rules')return Array.isArray(pricing.rules)&&pricing.rules.length>0;
    if(pricing.type==='electroverse_restrictions')
      return Boolean((pricing.rules||[]).length||Object.keys(pricing.fallbackRates||{}).length);
    return Object.keys(pricing).some(key=>key!=='type');
  }
  function tariffFailureStatus(evaluation,station){
    const items=[evaluation?.best,...(evaluation?.alternatives||[]),...(evaluation?.incomplete||[])].filter(Boolean);
    if(items.some(item=>item.comparable!==false&&num(item.total)!=null))return'priced';
    if(items.some(item=>hasTariffSourceEvidence(item,station)))return'incalculable';
    return'missing';
  }
  function tariffFailureLabel(evaluation,station){
    return tariffFailureStatus(evaluation,station)==='incalculable'
      ?'Tarif incalculable':'Tarif indisponible';
  }
