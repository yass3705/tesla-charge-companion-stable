// DOT-NL/OCPI multi-interval access support for TCC.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.TCCOcpiAccessIntervals=api;
})(typeof self!=='undefined'?self:this,function(){
  function mins(v){
    if(v==='24:00')return 1440;
    const m=String(v||'00:00').match(/^(\d{1,2}):(\d{2})/);return m?Math.max(0,Math.min(1440,Number(m[1])*60+Number(m[2]))):0;
  }
  function fmt(m){m=Math.max(0,Math.min(1440,Math.round(m)));return m===1440?'24:00':`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;}
  function normalize(intervals){
    const xs=(intervals||[]).map(x=>[mins(x[0]),mins(x[1])]).filter(x=>x[1]>x[0]).sort((a,b)=>a[0]-b[0]);
    const out=[];for(const x of xs){const p=out[out.length-1];if(p&&x[0]<=p[1])p[1]=Math.max(p[1],x[1]);else out.push(x.slice());}return out;
  }
  function install(scope){
    if(scope.__tccOcpiAccessInstalled)return api;
    const original=scope.accessStatus;
    if(typeof original!=='function')throw new Error('accessStatus indisponible');
    scope.accessStatus=function(st,dateStr,timeStr){
      const ocpi=st?.access?.ocpiIntervals;
      if(!ocpi||ocpi.date!==dateStr||!Array.isArray(ocpi.intervals))return original(st,dateStr,timeStr);
      const intervals=normalize(ocpi.intervals);
      const label=intervals.length?`Accessible ${intervals.map(x=>`${fmt(x[0])}–${fmt(x[1])}`).join(' / ')}`:'Fermé ce jour';
      if(!intervals.length)return{canStart:false,remaining:0,label};
      const t=mins(timeStr);
      const active=intervals.find(x=>t>=x[0]&&t<x[1]);
      if(!active)return{canStart:false,remaining:0,label};
      return{canStart:true,remaining:active[1]-t,label,close:fmt(active[1])};
    };
    scope.__tccOcpiAccessInstalled=true;return api;
  }
  const api={install,normalize,mins,fmt};return api;
});
