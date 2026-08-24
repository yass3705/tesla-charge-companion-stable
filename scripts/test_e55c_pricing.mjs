import fs from 'node:fs';
import vm from 'node:vm';

function assert(condition,message){if(!condition)throw new Error(message);}
const code=fs.readFileSync('assets/v8-e55c-pricing.js','utf8');
const sandbox={
  console,
  setInterval:()=>0,
  clearInterval:()=>{},
  fxToEur:value=>Number(value),
  priceWithRules:(pricing,startMinute,chargeMinutes)=>({
    total:.6+chargeMinutes*.084,
    connection:.6,
    chargeCost:chargeMinutes*.084,
    idleCost:0,
    durationSurcharge:0,
    occupiedMinutes:90,
    currencies:['EUR']
  }),
  window:null
};
sandbox.window=sandbox;
vm.createContext(sandbox);
vm.runInContext(code,sandbox);
const api=sandbox.TCCV8E55CPricing;
assert(api&&api.installPricing(),'Extension tarifaire E55C non installée');

const pricing={type:'rules',rules:[
  {scope:'timeWindow',start:'07:00',end:'23:00',currency:'EUR',e55cDirect:true,parkingPerMinute:.084},
  {scope:'timeWindow',start:'23:00',end:'07:00',currency:'EUR',e55cDirect:true,parkingPerMinute:.0624}
]};
const result=sandbox.priceWithRules(pricing,7*60,60,10,'08:30','07:00');
assert(Math.abs(result.parkingCost-7.56)<1e-9,`Stationnement 90 min incorrect : ${result.parkingCost}`);
assert(Math.abs(result.total-13.2)<1e-9,`Total E55C incorrect : ${result.total}`);
assert(result.e55cDirectPricing===true,'Marqueur tarif direct absent');

const crossing=api.parkingCost(pricing,22*60+30,60);
assert(Math.abs(crossing-(30*.084+30*.0624))<1e-9,`Passage jour/nuit incorrect : ${crossing}`);
const unrelated=api.parkingCost({rules:[{scope:'allDay',parkingPerMinute:1}]},0,60);
assert(unrelated===0,'Un tarif non-E55C a été modifié');
const current=sandbox.priceWithRules;
assert(api.installPricing()&&sandbox.priceWithRules===current,'Extension E55C installée deux fois');

console.log(JSON.stringify({parking90Minutes:result.parkingCost,total:result.total,crossingDayNight:crossing,unrelated},null,2));
