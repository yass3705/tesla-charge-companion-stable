/* Tesla Charge Companion — V8 RC1 test fixes (build 8002)
 * 1) infer a country for legacy/custom stations without countryCode, in memory only
 * 2) rebuild the result map by physical station, with robust GPS parsing
 */
(function(){
  'use strict';

  const COUNTRY_NAMES={
    MA:['maroc','morocco'],FR:['france'],ES:['espagne','spain'],PT:['portugal'],
    BE:['belgique','belgium'],NL:['pays-bas','netherlands'],LU:['luxembourg'],
    CH:['suisse','switzerland'],DE:['allemagne','germany'],IT:['italie','italy'],GB:['royaume-uni','united kingdom','uk']
  };

  function plain(v){
    return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  }
  function validCoord(lat,lon){
    return Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=-90&&lat<=90&&lon>=-180&&lon<=180;
  }
  function stationCoords(st){
    if(!st)return null;
    const lat=Number(st.latitude??st.lat??st.location?.lat??st.gps?.lat);
    const lon=Number(st.longitude??st.lon??st.lng??st.location?.lon??st.location?.lng??st.gps?.lon??st.gps?.lng);
    if(validCoord(lat,lon))return{lat,lon,source:'fields'};

    if(Array.isArray(st.coordinates)&&st.coordinates.length>=2){
      const a=Number(st.coordinates[0]),b=Number(st.coordinates[1]);
      if(validCoord(a,b))return{lat:a,lon:b,source:'coordinates'};
      if(validCoord(b,a))return{lat:b,lon:a,source:'coordinates'};
    }

    const raw=[st.address,st.gps,st.coordinatesText].filter(Boolean).join(' ');
    const m=String(raw).match(/(-?\d{1,2}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)/);
    if(m){
      const a=Number(m[1]),b=Number(m[2]);
      if(validCoord(a,b))return{lat:a,lon:b,source:'address-gps'};
    }
    return null;
  }

  function currenciesOf(st){
    const out=new Set();
    function visit(v){
      if(!v)return;
      if(Array.isArray(v)){v.forEach(visit);return;}
      if(typeof v!=='object')return;
      if(typeof v.currency==='string'&&v.currency.trim())out.add(v.currency.trim().toUpperCase());
      Object.values(v).forEach(visit);
    }
    visit(st?.pricing);
    visit(st?.chargingConfigurations);
    return out;
  }

  function countryFromCoords(lat,lon){
    // Morocco is intentionally checked first: many legacy Moroccan custom stations
    // use only raw GPS coordinates as their address.
    if(lat>=27.0&&lat<=36.3&&lon>=-13.6&&lon<=-0.8)return'MA';
    if(lat>=36.8&&lat<=42.3&&lon>=-9.7&&lon<=-6.0)return'PT';
    if(lat>=35.7&&lat<=43.9&&lon>=-9.5&&lon<=4.4)return'ES';
    if(lat>=45.7&&lat<=47.9&&lon>=5.8&&lon<=10.6)return'CH';
    if(lat>=49.4&&lat<=50.2&&lon>=5.7&&lon<=6.6)return'LU';
    if(lat>=50.7&&lat<=53.7&&lon>=3.2&&lon<=7.3)return'NL';
    if(lat>=49.4&&lat<=51.6&&lon>=2.5&&lon<=6.4)return'BE';
    if(lat>=41.0&&lat<=51.2&&lon>=-5.5&&lon<=9.7)return'FR';
    if(lat>=47.2&&lat<=55.2&&lon>=5.5&&lon<=15.6)return'DE';
    if(lat>=35.4&&lat<=47.2&&lon>=6.5&&lon<=18.7)return'IT';
    return'';
  }

  function inferCountry(st){
    if(st?.countryCode)return String(st.countryCode).toUpperCase();
    const address=plain(st?.address);
    for(const [code,names] of Object.entries(COUNTRY_NAMES)){
      if(names.some(name=>address.includes(plain(name))))return code;
    }
    const currencies=currenciesOf(st);
    if(currencies.has('MAD'))return'MA';
    if(currencies.has('CHF'))return'CH';
    if(currencies.has('GBP'))return'GB';
    const c=stationCoords(st);
    return c?countryFromCoords(c.lat,c.lon):'';
  }

  function enrichCustomCountries(){
    if(!Array.isArray(window.stations)&&typeof stations==='undefined')return;
    const list=Array.isArray(window.stations)?window.stations:stations;
    list.forEach(st=>{
      if(st?.countryCode)return;
      const code=inferCountry(st);
      if(code)st.countryCode=code; // runtime-only: saveLocal/GitHub are not called here
    });
  }

  // The August renderer already understands countryCode. Enrich before every
  // Bornes render so legacy third-party stations participate in the country filter.
  if(typeof window.renderStations==='function'){
    const originalRenderStations=window.renderStations;
    window.renderStations=function(){
      enrichCustomCountries();
      return originalRenderStations.apply(this,arguments);
    };
    // Keep the global binding used by classic scripts aligned with window.
    try{renderStations=window.renderStations}catch(e){}
  }
  enrichCustomCountries();

  let leafletPromise=null;
  function loadLeaflet(){
    if(window.L&&window.L.map)return Promise.resolve(window.L);
    if(leafletPromise)return leafletPromise;
    leafletPromise=new Promise((resolve,reject)=>{
      if(!document.querySelector('link[data-rc2-leaflet]')){
        const css=document.createElement('link');
        css.rel='stylesheet';css.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';css.dataset.rc2Leaflet='1';
        document.head.appendChild(css);
      }
      const existing=[...document.scripts].find(s=>String(s.src).includes('leaflet@1.9.4/dist/leaflet.js'));
      if(existing){
        const wait=()=>window.L?.map?resolve(window.L):setTimeout(wait,30);
        wait();return;
      }
      const script=document.createElement('script');
      script.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload=()=>resolve(window.L);script.onerror=reject;document.head.appendChild(script);
    });
    return leafletPromise;
  }
  function esc(v){
    return String(v==null?'':v).replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]||ch));
  }
  function resultGroups(){
    const groups=new Map();
    document.querySelectorAll('#results .result-card[data-result-id]').forEach(card=>{
      const id=card.dataset.resultId;
      if(!id)return;
      if(!groups.has(id))groups.set(id,[]);
      groups.get(id).push(card);
    });
    return groups;
  }
  function baseStationById(id){
    const list=Array.isArray(window.stations)?window.stations:(typeof stations!=='undefined'?stations:[]);
    return list.find(st=>String(st.id)===String(id));
  }
  function mapsHref(st,c){
    if(typeof window.mapsUrl==='function')return window.mapsUrl(st);
    if(typeof mapsUrl==='function')return mapsUrl(st);
    if(c)return`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${c.lat},${c.lon}`)}`;
    return'#';
  }

  async function renderResultMapFixed(){
    const host=document.getElementById('augMapView');
    if(!host||host.classList.contains('hidden'))return;
    const groups=resultGroups();
    host.innerHTML='<div class="small">Chargement de la carte OpenStreetMap…</div>';
    try{
      const L=await loadLeaflet();
      if(!host||host.classList.contains('hidden'))return;
      host.innerHTML='<div id="augLeafletMapRc2" style="height:520px;border-radius:14px;overflow:hidden"></div>';
      const map=L.map('augLeafletMapRc2',{scrollWheelZoom:false});
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
      const bounds=[];
      let sites=0;

      for(const [id,cards] of groups){
        const st=baseStationById(id);if(!st)continue;
        const c=stationCoords(st);if(!c)continue;
        sites++;
        const configurations=cards.map(card=>{
          const title=card.querySelector('h3')?.textContent?.replace(/^\s*\d+\.\s*/,'').trim()||st.name||'Borne';
          const cost=card.querySelector('.cost')?.textContent?.trim()||'';
          return`<div style="margin-top:4px">${esc(title)}${cost?` · <b>${esc(cost)}</b>`:''}</div>`;
        }).join('');
        const marker=L.marker([c.lat,c.lon]).addTo(map);
        marker.bindPopup(`<b>${esc(st.name||'Borne')}</b>${cards.length>1?`<br><span>${cards.length} configurations dans les résultats</span>`:''}${configurations}<br><a href="${esc(mapsHref(st,c))}" target="_blank" rel="noopener">Itinéraire</a>`);
        if(cards.length>1)marker.bindTooltip(`${cards.length} configs`,{direction:'top',offset:[0,-28]});
        bounds.push([c.lat,c.lon]);
      }

      try{
        const originText=document.getElementById('simOrigin')?.value?.trim();
        if(originText&&typeof resolveOrigin==='function'){
          const origin=await resolveOrigin(originText);
          if(origin&&validCoord(Number(origin.lat),Number(origin.lon))){
            L.circleMarker([Number(origin.lat),Number(origin.lon)],{radius:7}).addTo(map).bindPopup('Départ');
            bounds.push([Number(origin.lat),Number(origin.lon)]);
          }
        }
      }catch(e){}

      if(bounds.length)map.fitBounds(bounds,{padding:[30,30],maxZoom:13});
      else map.setView([46.5,2.5],5);
      setTimeout(()=>map.invalidateSize(),120);

      const note=document.createElement('div');
      note.className='small';note.style.marginTop='8px';
      note.textContent=`${sites} site(s) physique(s) affiché(s). Plusieurs puissances d’un même site sont regroupées sur un seul marqueur.`;
      host.appendChild(note);
    }catch(err){
      host.innerHTML=`<div class="warn">Carte indisponible : ${esc(err?.message||err)}. La liste reste utilisable.</div>`;
    }
  }

  // Replace only the map path. The list path still uses the August RC renderer.
  if(typeof window.augSwitchResultView==='function'){
    const originalSwitch=window.augSwitchResultView;
    window.augSwitchResultView=function(mode){
      if(mode!=='map')return originalSwitch(mode);
      const list=document.getElementById('results'),map=document.getElementById('augMapView');
      const listBtn=document.getElementById('augListBtn'),mapBtn=document.getElementById('augMapBtn');
      if(!list||!map)return originalSwitch(mode);
      list.classList.add('hidden');map.classList.remove('hidden');
      listBtn?.classList.remove('active-view');mapBtn?.classList.add('active-view');
      renderResultMapFixed();
    };
  }

  // If the user is already on Bornes when this hotfix loads, refresh once.
  if(document.getElementById('stations')?.classList.contains('active')){
    try{window.renderStations?.()}catch(e){}
  }

  console.info('[TCC] RC build 8002 fixes loaded: custom country inference + grouped GPS map.');
})();
