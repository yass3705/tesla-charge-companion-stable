const fs=require('fs');
const vm=require('vm');
const assert=require('assert');

(async()=>{
  const origin={lat:51.4416,lon:5.4697,label:'Eindhoven'};
  const tesla={
    id:'tesla-eindhoven-netherlands',
    name:'Tesla Eindhoven, Netherlands',
    source:'teslaSupercharger',
    operator:'Tesla',
    latitude:51.4700,
    longitude:5.4700,
    temporarilyUnavailable:false
  };
  const snapshots=[];
  const filterModes=[];
  const context={
    console,
    Intl,
    Date,
    Map,
    Set,
    Math,
    Number,
    String,
    Array,
    JSON,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    encodeURIComponent,
    stations:[tesla],
    routeResults:{},
    localStorage:{getItem(){return null;}},
    document:{
      getElementById(id){
        if(id==='simOrigin')return {value:'Eindhoven'};
        if(id==='simDate')return {value:'2026-08-29'};
        return null;
      },
      head:{appendChild(){throw new Error('Unexpected dynamic script load');}},
      createElement(){throw new Error('Unexpected dynamic script creation');}
    },
    resolveOrigin:async()=>origin,
    TCCOcpiDurationPricing:{install(){}},
    TCCOcpiAccessIntervals:{install(){}},
  };
  context.window=context;

  function distanceKm(st){
    const dy=(Number(st.latitude)-origin.lat)*110.574;
    const dx=(Number(st.longitude)-origin.lon)*69;
    return Math.sqrt(dx*dx+dy*dy);
  }
  context.candidateStations=async function(filterMode='all',maxDistanceKm=0){
    filterModes.push(filterMode);
    context.routeResults={};
    let list=context.stations.filter(st=>!st.temporarilyUnavailable&&(filterMode==='all'||st.source==='teslaSupercharger'||String(st.operator||'').toLowerCase()==='tesla'));
    list=list.map(st=>{st._airKm=distanceKm(st);return st;}).filter(st=>!(maxDistanceKm>0)||st._airKm<=maxDistanceKm).sort((a,b)=>a._airKm-b._airKm).slice(0,80);
    for(const st of list)context.routeResults[st.id]={distanceKm:st._airKm,durationMin:st._airKm};
    snapshots.push(list.map(st=>st.id));
    return {origin,stations:list,maxDistanceKm};
  };

  const regular=[2,[],[],'ON_STREET',[]];
  const rule=['allDay','00:00','24:00','kwh','EUR',0.30,0,0,0,0,0,[0,1,2,3,4,5,6],[]];
  const rows=[];
  for(let i=0;i<100;i++){
    const lat=origin.lat+0.00005*(i+1);
    const lon=origin.lon+0.00002*(i+1);
    rows.push([
      `NL:TEST:${String(i).padStart(4,'0')}`,
      `Local ${i}`,
      `Eindhoven ${i}`,
      lat,
      lon,
      `Local operator ${i%11}`,
      1,
      regular,
      [[`cfg-${i}`,'DOT-NL public · AC 11 kW','AC',11,1,[rule]]],
      '2026-08-29',
      'IN_SERVICE'
    ]);
  }
  const payload=new TextEncoder().encode(JSON.stringify(rows));
  const manifest={
    schemaVersion:3,
    stationCount:78572,
    generatedAt:'2026-08-29T10:00:00Z',
    allFile:'all.json.gz',
    scope:{countryCode:'NL',teslaExcluded:true,ocpiDurationBands:true,ocpiOpeningTimes:true,ocpiParkingRestrictions:true,europeanNetherlandsBounds:[50.5,53.8,3.0,7.6]},
    tiles:[{file:'t_test.json.gz',minLat:51,maxLat:52,minLon:5,maxLon:6}]
  };
  context.fetch=async function(url){
    const u=String(url);
    if(u.endsWith('manifest.json'))return {ok:true,status:200,json:async()=>manifest};
    if(u.includes('t_test.json.gz'))return {ok:true,status:200,arrayBuffer:async()=>payload.buffer};
    throw new Error(`Unexpected fetch ${u}`);
  };

  vm.createContext(context);
  const source=fs.readFileSync('assets/netherlands-catalog.js','utf8');
  vm.runInContext(source,context,{filename:'assets/netherlands-catalog.js'});

  const result=await context.candidateStations('all',50);
  assert.strictEqual(snapshots.length,2,'the NL wrapper must evaluate Tesla-only upstream and combined candidates');
  assert.deepStrictEqual(filterModes,['tesla','all'],'the first NL pass must be Tesla-only so dense public catalogs cannot crowd it out');
  assert(snapshots[0].includes(tesla.id),'Tesla must exist in upstream/global shortlist');
  assert(!snapshots[1].includes(tesla.id),'fixture must reproduce dense DOT-NL crowd-out before merge');
  assert(result.stations.some(st=>st.id===tesla.id),'Tesla must be restored in the merged candidate list');
  assert(result.stations.length>80,'merged result must preserve upstream candidates in addition to DOT-NL shortlist');
  assert(context.routeResults[tesla.id],'Tesla route metadata must survive the second candidate pass');
  const operators=new Set(result.stations.map(st=>st.source==='teslaSupercharger'?'Tesla':st.operator));
  assert(operators.has('Tesla'),'dynamic operator filter must be able to expose Tesla');
  assert.strictEqual(result.upstreamStationsPreserved,1,'upstream preservation metric should be exposed');

  console.log(JSON.stringify({
    ok:true,
    fixture:'dense Eindhoven DOT-NL crowd-out',
    filterModes,
    firstPass:snapshots[0].length,
    secondPass:snapshots[1].length,
    merged:result.stations.length,
    teslaPreserved:true,
    teslaRoutePreserved:true,
    operators:[...operators].sort()
  },null,2));
})().catch(err=>{console.error(err);process.exit(1);});
