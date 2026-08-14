// Tesla Charge Companion — runtime migration for legacy Tesla station identities.
//
// Older locally saved or GitHub-synchronised stations can use a different ID
// from a newly published canonical Tesla station. The V7.3 merge is ID-based,
// so both records would otherwise be displayed. This migration only removes a
// legacy record when it can be matched conservatively to a published Tesla
// station by Tesla URL or by Tesla identity + geographic/name/technical evidence.
(function(){
  const COUNTRY_WORDS={
    FR:['france'],DE:['germany','deutschland','allemagne'],GB:['uk','united kingdom','great britain','royaume uni'],
    ES:['spain','espana','espagne'],IT:['italy','italia','italie'],CH:['switzerland','schweiz','suisse','svizzera'],
    BE:['belgium','belgique','belgie'],NL:['netherlands','nederland','pays bas'],LU:['luxembourg'],
    PT:['portugal'],MA:['morocco','maroc']
  };

  function plain(value){
    return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  }
  function compact(value){
    return plain(value).replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
  }
  function tokens(value){
    return compact(value).split(' ').filter(Boolean);
  }
  function siteName(st){
    let value=` ${compact(st?.name)} `
      .replace(/\btesla\b/g,' ')
      .replace(/\bsuperchargers?\b/g,' ');
    let code=String(st?.countryCode||'').toUpperCase();
    for(let word of COUNTRY_WORDS[code]||[]){
      let token=compact(word);
      if(token)value=value.replace(new RegExp(`\\b${token.replace(/ /g,'\\\\s+')}\\b`,'g'),' ');
    }
    return value.trim().replace(/\s+/g,' ');
  }
  function teslaSlug(st){
    let url=String(st?.teslaUrl||st?.sourceUrl||'');
    let match=url.match(/\/supercharger\/([^/?#]+)/i);
    return match?decodeURIComponent(match[1]).toLowerCase():'';
  }
  function teslaLike(st){
    return st?.source==='teslaSupercharger'||plain(st?.operator)==='tesla'||/^\s*tesla\b/i.test(st?.name||'')||!!teslaSlug(st);
  }
  function distanceMeters(a,b){
    let aLat=Number(a?.latitude),aLon=Number(a?.longitude),bLat=Number(b?.latitude),bLon=Number(b?.longitude);
    if(![aLat,aLon,bLat,bLon].every(Number.isFinite))return Infinity;
    let rad=Math.PI/180,dLat=(bLat-aLat)*rad,dLon=(bLon-aLon)*rad;
    let x=Math.sin(dLat/2)**2+Math.cos(aLat*rad)*Math.cos(bLat*rad)*Math.sin(dLon/2)**2;
    return 6371000*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
  }
  function stationPower(st){
    let cfg=Array.isArray(st?.chargingConfigurations)&&st.chargingConfigurations.length?st.chargingConfigurations[0]:null;
    let value=Number(cfg?.powerKw??st?.powerKw);
    return Number.isFinite(value)&&value>0?value:null;
  }
  function stationStalls(st){
    let direct=Number(st?.stalls);
    if(Number.isFinite(direct)&&direct>0)return Math.round(direct);
    if(Array.isArray(st?.chargingConfigurations)){
      let total=st.chargingConfigurations.reduce((sum,c)=>sum+Math.max(0,Math.round(Number(c?.stalls||0))),0);
      if(total>0)return total;
    }
    return null;
  }
  function technicalEvidence(a,b){
    let evidence=0,conflict=false;
    let ap=stationPower(a),bp=stationPower(b);
    if(ap!=null&&bp!=null){
      if(Math.abs(ap-bp)<=1)evidence++;
      else conflict=true;
    }
    let as=stationStalls(a),bs=stationStalls(b);
    if(as!=null&&bs!=null){
      if(as===bs)evidence++;
      else conflict=true;
    }
    return {evidence,conflict};
  }
  function venueCorroborates(longName,shortName,legacy,official){
    let shortTokens=new Set(tokens(shortName));
    let extras=tokens(longName).filter(t=>t.length>=4&&!shortTokens.has(t));
    if(!extras.length)return false;
    let addresses=` ${compact(legacy?.address)} ${compact(official?.address)} `;
    return extras.some(t=>new RegExp(`\\b${t}\\b`,'i').test(addresses));
  }
  function samePublishedTesla(legacy,official){
    if(!legacy||!official||legacy.id===official.id||official.source!=='teslaSupercharger'||!teslaLike(legacy))return false;
    let lc=String(legacy.countryCode||'').toUpperCase(),oc=String(official.countryCode||'').toUpperCase();
    if(lc&&oc&&lc!==oc)return false;
    let oldSlug=teslaSlug(legacy),newSlug=teslaSlug(official);
    if(oldSlug&&newSlug&&oldSlug===newSlug)return true;

    let meters=distanceMeters(legacy,official);
    if(meters>500)return false;
    let oldName=siteName(legacy),newName=siteName(official);
    if(!oldName||!newName)return false;

    // Identical cleaned names remain a strong identity signal.
    if(oldName===newName)return meters<=250;

    let nested=oldName.includes(newName)||newName.includes(oldName);
    if(!nested)return false;
    // Tiny geographic differences are safe for historical naming variants.
    if(meters<=60)return true;

    let tech=technicalEvidence(legacy,official);
    if(tech.conflict)return false;
    let longName=oldName.length>=newName.length?oldName:newName;
    let shortName=oldName.length<newName.length?oldName:newName;
    let shortTokenCount=tokens(shortName).length;
    let venueMatch=venueCorroborates(longName,shortName,legacy,official);

    // For a meaningful multi-token site name, two matching technical facts
    // allow a modest coordinate drift between old/manual and official data.
    if(meters<=250&&shortTokenCount>=2&&tech.evidence>=2)return true;

    // A one-word/city alias (e.g. "Casablanca — Onomo" vs "Casablanca")
    // is intentionally stricter: the extra venue token must also appear in an
    // address and both power + stall count must agree. This avoids merging two
    // genuinely distinct Superchargers in the same city.
    if(meters<=350&&venueMatch&&tech.evidence>=2)return true;

    return false;
  }
  function publishedTesla(){
    return Array.isArray(defaultStations)?defaultStations.filter(st=>st?.source==='teslaSupercharger'):[];
  }
  function filterLegacyDuplicates(list){
    if(!Array.isArray(list))return list;
    let officials=publishedTesla();
    if(!officials.length)return list;
    return list.filter(st=>{
      // Same canonical ID is not a duplicate: normalisation still needs the
      // local record so existing user overrides continue to work as before.
      if(officials.some(o=>o.id===st?.id))return true;
      let match=officials.find(o=>samePublishedTesla(st,o));
      if(!match)return true;
      console.info('[TCC] Legacy Tesla duplicate ignored:',st?.id||st?.name,'→',match.id);
      return false;
    });
  }
  function persistCleanedLocal(original,filtered){
    if(!Array.isArray(original)||!Array.isArray(filtered)||filtered.length===original.length)return;
    localStorage.setItem('tccStationsV701',JSON.stringify(filtered));
  }
  function cleanCurrentStations(){
    if(!Array.isArray(stations)||!publishedTesla().length)return false;
    let before=stations,filtered=filterLegacyDuplicates(before);
    if(filtered.length===before.length)return true;
    stations=filtered;
    localStorage.setItem('tccStationsV701',JSON.stringify(stations));
    if(typeof renderStations==='function')renderStations();
    console.info('[TCC] Legacy Tesla station cache cleaned:',before.length-filtered.length,'duplicate(s) removed.');
    return true;
  }

  // Startup migration: defaultStations is populated immediately before these
  // functions are called by app.js, so matching uses the current canonical DB.
  const originalLocalStations=localStations;
  localStations=function(){
    let value=originalLocalStations();
    if(!Array.isArray(value))return value;
    let filtered=filterLegacyDuplicates(value);
    persistCleanedLocal(value,filtered);
    return filtered;
  };
  const originalOldLocalStations=oldLocalStations;
  oldLocalStations=function(){
    let value=originalOldLocalStations();
    return Array.isArray(value)?filterLegacyDuplicates(value):value;
  };

  // Every local save also goes through the guard so a stale identity cannot
  // be persisted again after another operation in the UI.
  const originalSaveLocal=saveLocal;
  saveLocal=function(){
    if(Array.isArray(stations))stations=filterLegacyDuplicates(stations);
    return originalSaveLocal();
  };

  // Do not send a legacy duplicate back to the multi-device sync file.
  const originalCustomStationsForSync=customStationsForSync;
  customStationsForSync=function(){
    return filterLegacyDuplicates(originalCustomStationsForSync());
  };

  // A remote device may still contain an old duplicate. Filter it on every
  // merge, while leaving the remote record untouched until all devices have
  // received this migration (non-destructive rollout).
  const originalApplyMergedCustomState=applyMergedCustomState;
  applyMergedCustomState=function(state){
    let cloud=parseCustomCloudData(state);
    if(Array.isArray(stations))stations=filterLegacyDuplicates(stations);
    return originalApplyMergedCustomState({...cloud,stations:filterLegacyDuplicates(cloud.stations)});
  };

  // Safety sweep for the unlikely case where the initial data fetch completes
  // before this deferred script has wrapped localStations(). It also makes the
  // fix effective immediately in the current session and persists the cleanup.
  let attempts=0;
  const sweepTimer=setInterval(()=>{
    attempts++;
    if(cleanCurrentStations()||attempts>=120)clearInterval(sweepTimer);
  },250);

  window.TCCStationDedup={samePublishedTesla,filterLegacyDuplicates,cleanCurrentStations};
})();
