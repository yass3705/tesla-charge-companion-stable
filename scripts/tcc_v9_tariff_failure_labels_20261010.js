  // Status is about tariff evidence, not charging-point availability.
  // Unknown/ambiguous calculation != absent pricing source.
  function tariffFailureLabel(offers,station,status){
    if(status==='ambiguous')return'Tarif incalculable';
    const rows=Array.isArray(offers)?offers.filter(Boolean):[];
    if(!rows.length)return'Tarif indisponible';
    const sourceOffers=Array.isArray(station?.offers)?station.offers:[];
    for(const item of rows){
      const id=String(item?.offerId??'');
      const matched=sourceOffers.find(x=>String(x?.id??x?.offerId??'')===id);
      const pricing=matched?.pricing??item?.pricing??null;
      const rules=Array.isArray(pricing?.rules)?pricing.rules:[];
      const substantial=rules.some(rule=>rule&&typeof rule==='object'&&(
        rule.pricePerKwh!=null||rule.pricePerMinute!=null||rule.chargePerMinute!=null||
        rule.chargingTimePerMinuteEur!=null||rule.connectedTimePerMinuteEur!=null||
        rule.afterMinutesRate!=null||Array.isArray(rule.powerBands)&&rule.powerBands.length>0||
        rule.congestionTimePerMinute!=null||rule.connectionFee!=null||
        rule.sessionFeeEur!=null))||
        ['pricePerKwh','pricePerMinute','chargePerMinute','connectionFee',
         'sessionFeeEur','connectedTimePerMinuteEur'].some(k=>pricing?.[k]!=null);
      const reason=String(item?.result?.reason??item?.incompletePricingReason??'').toLowerCase();
      const explicitAmbiguity=matched?.metadata?.tariffAmbiguous===true||
        /ambig|conflict|attribution_missing|unresolved/.test(reason);
      if(explicitAmbiguity)return'Tarif incalculable';
      // A clearly expired/not-yet-valid tariff is unavailable for this session,
      // not a broken price formula.
      if(/^(offer_outside_validity_window|no_tariff|tariff_unavailable|tariff_not_provided)$/.test(reason))
        continue;
      // A tariff is present, but evaluating it needs a missing rule, SOC,
      // charge trace, rate conversion, timezone or a verified component.
      if(substantial&&(item?.comparable===false||
          item?.result?.complete===false||item?.total==null))
        return'Tarif incalculable';
    }
    return'Tarif indisponible';
  }
