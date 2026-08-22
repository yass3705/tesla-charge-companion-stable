// Tesla Charge Companion — overlay tarifaire canonique France (pilote opt-in).
// Important : cet overlay n'écrase jamais une offre/runtime existante. Il ajoute
// uniquement des configurations CANONIQUE pour des stations auditées et appariées.
(function(){
  const DATA_URL='data/non_tesla_france/canonical_tariff_overlay.json';
  const STORAGE_KEY='tccFranceCanonicalOverlayV1';
  let payloadPromise=null;
  let indexedPromise=null;

  function queryEnabled(){
    try{return new URLSearchParams(location.search).get('canonicalOverlay')==='1'}catch(_){return false}
  }
  function storageEnabled(){
    try{return localStorage.getItem(STORAGE_KEY)==='enabled'}catch(_){return false}
  }
  function enabled(){return queryEnabled()||storageEnabled()}

  async function load(){
    if(!enabled())return null;
    if(!payloadPromise){
      payloadPromise=fetch(`${DATA_URL}?v=1`,{cache:'no-cache'}).then(r=>{
        if(!r.ok)throw new Error(`Overlay canonique France indisponible (${r.status})`);
        return r.json();
      }).then(data=>{
        if(data?.dataset!=='france-canonical-tariff-overlay-pilot')throw new Error('Overlay canonique France inattendu.');
        if(data?.enabledByDefault!==false)throw new Error('Garde-fou overlay canonique invalide.');
        if(data?.mode!=='append_only')throw new Error('Mode overlay canonique non autorisé.');
        return data;
      });
    }
    return payloadPromise;
  }

  async function prepare(){
    if(!enabled())return null;
    if(!indexedPromise){
      indexedPromise=load().then(data=>{
        const byStation=new Map();
        for(const entry of (data?.entries||[])){
          const id=String(entry?.runtimeStationId||'').trim();
          if(!id||byStation.has(id))throw new Error(`Station overlay dupliquée ou invalide : ${id||'sans id'}`);
          byStation.set(id,entry);
        }
        return {data,byStation};
      });
    }
    return indexedPromise;
  }

  function clone(value){return JSON.parse(JSON.stringify(value))}
  function samePower(a,b){return String(a?.kind||'').toUpperCase()===String(b?.kind||'').toUpperCase()&&Math.abs(Number(a?.powerKw||0)-Number(b?.powerKw||0))<0.25}
  function normalizeConfig(cfg,existing){
    const match=(existing||[]).find(c=>samePower(c,cfg));
    return {
      id:String(cfg.id),
      label:String(cfg.label||`CANONIQUE · ${cfg.kind||'AC'} ${cfg.powerKw||11} kW`),
      kind:String(cfg.kind||'AC').toUpperCase(),
      powerKw:Number(cfg.powerKw||11),
      stalls:Math.max(0,Math.round(Number(cfg.stalls||match?.stalls||0))),
      pricing:clone(cfg.pricing||{type:'rules',rules:[]}),
      canonicalTariff:true,
      canonicalSourcePath:String(cfg.canonicalSourcePath||'')
    };
  }

  function apply(station){
    if(!enabled()||!station||!indexedPromise)return station;
    // prepare() est attendu avant la construction des stations ; la résolution ci-dessous
    // est donc déjà disponible sans rendre stationFromRow asynchrone.
    let index=null;
    indexedPromise.then(v=>{index=v}).catch(()=>{});
    // La promesse étant résolue avant apply(), la valeur est exposée aussi via cache synchrone.
    index=window.TCCFranceCanonicalOverlay?._index||index;
    if(!index)return station;
    const runtimeId=String(station.catalogStationId||'');
    const entry=index.byStation.get(runtimeId);
    if(!entry)return station;

    const current=Array.isArray(station.chargingConfigurations)?station.chargingConfigurations:[];
    const ids=new Set(current.map(c=>String(c?.id||'')));
    const additions=[];
    for(const raw of (entry.configurations||[])){
      if(!raw?.id||ids.has(String(raw.id)))continue;
      const cfg=normalizeConfig(raw,current);
      cfg.canonicalSourcePath=entry.sourcePath||'';
      cfg.canonicalProfileScope=entry.profileScope||'';
      additions.push(cfg);ids.add(cfg.id);
    }
    if(!additions.length)return station;
    return {
      ...station,
      chargingConfigurations:[...current,...additions],
      canonicalOverlayApplied:true,
      canonicalOverlayMode:'append_only',
      canonicalOverlaySource:entry.sourcePath||'',
      canonicalOverlayProfileScope:entry.profileScope||''
    };
  }

  async function prepareAndCache(){
    const index=await prepare();
    if(window.TCCFranceCanonicalOverlay)window.TCCFranceCanonicalOverlay._index=index;
    return index;
  }

  function setEnabled(value){
    try{
      if(value)localStorage.setItem(STORAGE_KEY,'enabled');
      else localStorage.removeItem(STORAGE_KEY);
    }catch(_){}
    payloadPromise=null;indexedPromise=null;
    if(window.TCCFranceCanonicalOverlay)window.TCCFranceCanonicalOverlay._index=null;
    return enabled();
  }

  window.TCCFranceCanonicalOverlay={
    enabled,
    prepare:prepareAndCache,
    apply,
    setEnabled,
    get storageKey(){return STORAGE_KEY},
    get _index(){return this.__index||null},
    set _index(v){this.__index=v}
  };
  console.info(`[TCC] Overlay canonique France ${enabled()?'activé en mode pilote':'désactivé (défaut)'}.`);
})();
