// Tesla Charge Companion V8 RC4.8 — corrections après smoke test multi-opérateurs.
(function(){
  'use strict';
  const REVISION='rc48av-fee-breakdown-fix';
  const text=v=>String(v==null?'':v).trim();
  const norm=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const deepClone=v=>JSON.parse(JSON.stringify(v));

  const PASSPASS_ALIASES=[
    'Pass Pass Electrique','Pass Pass Électrique','PassPass','Pass Pass',
    'Pass Pass Mobilites','Pass Pass Mobilités'
  ].map(norm);

  function stationValues(st){return [st?.operator,st?._sourceOperator,st?.cpo,st?.network,st?.name,st?.address].map(norm).filter(Boolean)}
  function isPassPass(st){const vals=stationValues(st);return vals.some(v=>PASSPASS_ALIASES.some(a=>v===a||v.includes(a)||a.includes(v)))}
  function physicalConfigs(st){
    const cfgs=Array.isArray(st?.chargingConfigurations)&&st.chargingConfigurations.length
      ?st.chargingConfigurations
      :[{id:'main',kind:st?.kind||'AC',powerKw:Number(st?.powerKw||0),stalls:Number(st?.stalls||0),pricing:st?.pricing}];
    const out=[],seen=new Set();
    for(const c of cfgs){
      const kind=text(c?.kind||st?.kind||'AC').toUpperCase(),power=Number(c?.powerKw??st?.powerKw??0);
      if(!(power>0))continue;
      const key=`${kind}|${power.toFixed(2)}`;if(seen.has(key))continue;seen.add(key);
      out.push({kind,powerKw:power,stalls:Number(c?.stalls||st?.stalls||0)});
    }
    return out;
  }
  function configProvider(c){const raw=text(c?.offerProvider||c?.label||c?.configurationLabel),i=raw.indexOf('·');return norm(i>=0?raw.slice(0,i):raw)}
  function hasPassPassDirect(configs,kind,power){return (configs||[]).some(c=>configProvider(c).startsWith(norm('Pass Pass direct'))&&text(c?.kind).toUpperCase()===kind&&Math.abs(Number(c?.powerKw||0)-power)<.25)}

  function passPassNormalRules(){
    // Profil Pass Pass enregistré gratuit vérifié : borne normale.
    // Nuit : 0,01 €/min après 3 h, limité aux deux heures suivantes => plafond 1,20 €.
    return [
      {scope:'timeWindow',start:'07:00',end:'21:00',billing:'kwh',currency:'EUR',pricePerKwh:0.32,chargePerMinute:0,connectionFee:0,idlePerMinute:0,afterMinutesRate:0.04,afterMinutesThreshold:180,afterMinutesCap:0,afterMinutesCapStart:'00:00',afterMinutesCapEnd:'24:00'},
      {scope:'timeWindow',start:'21:00',end:'07:00',billing:'kwh',currency:'EUR',pricePerKwh:0.32,chargePerMinute:0,connectionFee:0,idlePerMinute:0,afterMinutesRate:0.01,afterMinutesThreshold:180,afterMinutesCap:1.20,afterMinutesCapStart:'21:00',afterMinutesCapEnd:'07:00'}
    ];
  }

  function addPassPassDirect(st){
    if(!st||st.source==='teslaSupercharger'||String(st.countryCode||'FR').toUpperCase()!=='FR'||!isPassPass(st))return st;
    const base=Array.isArray(st.chargingConfigurations)?st.chargingConfigurations.map(c=>({...c})):[],added=[];
    for(const cfg of physicalConfigs(st)){
      // Seule la classe « normale » est inférable sans ambiguïté depuis la puissance : AC <= 22 kW.
      // Les catégories rapide / ultra-rapide Pass Pass ne sont pas déduites de la seule puissance.
      if(cfg.kind!=='AC'||cfg.powerKw>22.01)continue;
      if(hasPassPassDirect([...base,...added],cfg.kind,cfg.powerKw))continue;
      const provider='Pass Pass direct (compte gratuit)';
      added.push({
        id:`direct-resolver:passpass-normal:${cfg.kind}:${String(cfg.powerKw).replace('.','_')}`,
        label:`${provider} · ${cfg.kind} ${cfg.powerKw} kW`,kind:cfg.kind,powerKw:cfg.powerKw,stalls:cfg.stalls,
        pricing:{type:'rules',rules:deepClone(passPassNormalRules())},offerProvider:provider,offerType:'operator_direct_app',
        directResolverOfferId:`passpass-normal-registered-${cfg.kind.toLowerCase()}-${cfg.powerKw}`,
        directResolverSource:'data-lab/passpass_current_tariff_2025_04_01.json',
        directResolverScope:'regional_normal_registered_free_profile',directResolverVerified:true
      });
    }
    if(!added.length)return st;
    return {...st,chargingConfigurations:[...base,...added],_directResolverOffers:[...(st._directResolverOffers||[]),...added.map(x=>x.directResolverOfferId)]};
  }

  function installExpansionPatch(){
    const current=window.expandConfigurations;
    if(typeof current!=='function')return false;
    if(current.__tccDirectSmokeFix)return true;
    const wrapped=function(baseStations){
      const source=Array.isArray(baseStations)?baseStations.map(addPassPassDirect):baseStations;
      return current.call(this,source);
    };
    wrapped.__tccDirectSmokeFix=true;wrapped.__tccOriginal=current;
    if(current.__tccOverlayExpansionGuard)wrapped.__tccOverlayExpansionGuard=true;
    if(current.__tccDirectResolverPowerV1)wrapped.__tccDirectResolverPowerV1=true;
    window.expandConfigurations=wrapped;try{expandConfigurations=wrapped}catch(e){}
    return true;
  }

  function cardInfo(card){
    const h=text(card.querySelector('h3')?.textContent).replace(/^\d+\.\s*/,'');
    const m=h.match(/—\s*(AC|DC)\s+([0-9]+(?:[.,][0-9]+)?)\s*kW/i);
    return {kind:m?.[1]?.toUpperCase()||'',power:m?Number(m[2].replace(',','.')):0};
  }
  function activeTime(){return document.getElementById('simTime')?.value||'00:00'}
  function minuteOfDay(v){const m=String(v).match(/^(\d{1,2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):0}
  function setPriceText(price,label){if(price&&label&&text(price.textContent)!==label)price.textContent=label}
  function decorateDirectRows(){
    const t=minuteOfDay(activeTime());
    document.querySelectorAll('#results .result-card[data-result-id]').forEach(card=>{
      const info=cardInfo(card);
      for(const row of card.querySelectorAll('.v8-offer-row')){
        const provider=text(row.querySelector('.v8-offer-provider')?.textContent).replace(/✓.*$/,'').trim();
        const price=row.querySelector('.v8-offer-price');if(!price)continue;
        if(/^Chargezy direct/i.test(provider)){
          if(info.kind==='AC'&&info.power<=22.01)setPriceText(price,t>=420&&t<1380?'0,59 €/kWh + 2 € fixe + 0,10 €/min après 180 min':'0,59 €/kWh + 2 € fixe');
          else if(info.kind==='DC'&&info.power<=25.01)setPriceText(price,'0,59 €/kWh + 2 € fixe + 0,10 €/min après 90 min');
          else if(info.kind==='DC'&&info.power>25&&info.power<=50.01)setPriceText(price,'0,69 €/kWh + 2 € fixe + 0,20 €/min après 45 min');
        }
        if(/^Pass Pass direct/i.test(provider)){
          setPriceText(price,t>=420&&t<1260?'0,32 €/kWh + 0,04 €/min après 180 min':'0,32 €/kWh + 0,01 €/min après 180 min · plafond nuit 1,20 €');
        }
      }
    });
  }

  function feeValue(source,patterns){
    for(const pattern of patterns){
      const m=source.match(pattern);
      if(m?.[1])return text(m[1]);
    }
    return '';
  }

  function relabelBreakdowns(){
    document.querySelectorAll('#results .cost-breakdown').forEach(el=>{
      const before=text(el.textContent);
      if(!before)return;

      // Déjà normalisé : ne jamais repasser les remplacements sur nos propres libellés.
      if(el.dataset.tccFeeLabels==='1'&&/Connexion \/ frais fixe\s*:/i.test(before)&&/Occupation après charge\s*:/i.test(before)&&/Frais après durée\s*:/i.test(before))return;

      // Reconstruit toute la ligne depuis les valeurs afin que l'opération soit idempotente,
      // même si une ancienne version a déjà répété « Occupation » ou « Frais ».
      const fixed=feeValue(before,[/(?:Fixe\/parking|Connexion \/ frais fixe)\s*:\s*([^·]+)/i]);
      const afterCharge=feeValue(before,[/(?:Occupation\s+)*Occupation après charge\s*:\s*([^·]+)/i,/(?:Occupation\s+)*Après charge\s*:\s*([^·]+)/i]);
      const afterDuration=feeValue(before,[/(?:Frais\s+)*Frais après durée\s*:\s*([^·]+)/i,/(?:Frais\s+)*Après durée\s*:\s*([^·]+)/i]);
      const congestion=feeValue(before,[/Congestion\s*≥?\s*80\s*%\s*:\s*([^·]+)/i]);
      if(!fixed||!afterCharge||!afterDuration||!congestion)return;

      const rebuilt=`Connexion / frais fixe : ${fixed} · Occupation après charge : ${afterCharge} · Frais après durée : ${afterDuration} · Congestion ≥80% : ${congestion}`;
      el.dataset.tccFeeLabels='1';
      if(text(el.textContent)!==rebuilt)el.textContent=rebuilt;
    });
  }

  function relabelEditorFees(){
    document.querySelectorAll('.pr-connection').forEach(input=>{
      const host=input.closest('div');
      const label=host?.querySelector('label');
      if(label&&text(label.textContent)!=='Frais de connexion / frais fixe')label.textContent='Frais de connexion / frais fixe';
      if(host&&!host.querySelector('.tcc-fee-separation-note')){
        const note=document.createElement('div');
        note.className='small tcc-fee-separation-note';
        note.textContent='Champ réservé au coût fixe de session/connexion ; ne pas y mélanger un éventuel parking externe.';
        host.appendChild(note);
      }
    });
  }

  function decorateUiClarity(){decorateDirectRows();relabelBreakdowns();relabelEditorFees()}

  function installObserver(){
    const root=document.getElementById('results');if(!root)return false;if(root.__tccDirectSmokeFixObs)return true;
    let timer=null;const obs=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(decorateUiClarity,180)});
    obs.observe(root,{childList:true,subtree:true,characterData:true});root.__tccDirectSmokeFixObs=obs;setTimeout(decorateUiClarity,350);return true;
  }

  function installEditorObserver(){
    const root=document.getElementById('chargingConfigurations');if(!root)return false;if(root.__tccFeeClarityObs)return true;
    let timer=null;const obs=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(relabelEditorFees,60)});
    obs.observe(root,{childList:true,subtree:true});root.__tccFeeClarityObs=obs;relabelEditorFees();return true;
  }

  function markRevision(){
    const banner=document.getElementById('tccPreviewBanner');
    if(banner&&/RC4\.8/.test(text(banner.textContent)))banner.textContent=`V8 Preview · RC4.8 · ${REVISION} · tarif direct prioritaire · détail frais stabilisé · données canoniques France · auto-mise à jour désactivée`;
  }

  let tries=0;const timer=setInterval(()=>{tries++;const a=installExpansionPatch(),b=installObserver(),c=installEditorObserver();decorateUiClarity();markRevision();if((a&&b&&c)||tries>220)clearInterval(timer)},120);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{installExpansionPatch();installObserver();installEditorObserver();decorateUiClarity();markRevision()},0),{once:true});
  else setTimeout(()=>{installExpansionPatch();installObserver();installEditorObserver();decorateUiClarity();markRevision()},0);
  window.TCCV8DirectSmokeFix={revision:REVISION,addPassPassDirect,decorateDirectRows,relabelBreakdowns,relabelEditorFees};
  console.info(`[TCC V8] ${REVISION} actif : détail des frais idempotent + libellés directs complets.`);
})();
