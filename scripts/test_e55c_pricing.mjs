import fs from 'node:fs';
import vm from 'node:vm';

function assert(condition,message){if(!condition)throw new Error(message);}
const source=fs.readFileSync('assets/app.js','utf8');
const start=source.indexOf('function minuteOfSession');
const end=source.indexOf('function daySchedule',start);
assert(start>=0&&end>start,'Moteur priceWithRules introuvable');
const sandbox={
  console,
  mins:value=>{const [h,m]=String(value||'00:00').split(':').map(Number);return h*60+m;},
  fxToEur:value=>Number(value),
  powerAtElapsed:()=>0,
  powerBandAt:()=>null
};
vm.createContext(sandbox);
vm.runInContext(source.slice(start,end),sandbox);
assert(typeof sandbox.priceWithRules==='function','Moteur tarifaire TCC absent');

const pricing={type:'rules',rules:[
  {scope:'timeWindow',start:'07:00',end:'23:00',billing:'minute',currency:'EUR',chargePerMinute:.084,idlePerMinute:.084,connectionFee:.6,e55cDirect:true,e55cParkingPhase:'parked_not_charging'},
  {scope:'timeWindow',start:'23:00',end:'07:00',billing:'minute',currency:'EUR',chargePerMinute:.0624,idlePerMinute:.0624,connectionFee:.6,e55cDirect:true,e55cParkingPhase:'parked_not_charging'}
]};

const sainteJulitte=sandbox.priceWithRules(pricing,2*60+23,273,45.1,'','02:23');
const expectedChargeOnly=.6+273*.0624;
assert(Math.abs(sainteJulitte.chargeCost-273*.0624)<1e-9,`Recharge Sainte-Julitte incorrecte : ${sainteJulitte.chargeCost}`);
assert(sainteJulitte.idleCost===0,`Stationnement facturé pendant la recharge : ${sainteJulitte.idleCost}`);
assert(Math.abs(sainteJulitte.total-expectedChargeOnly)<1e-9,`Total sans attente incorrect : ${sainteJulitte.total}`);

const noWait=sandbox.priceWithRules(pricing,22*60+30,30,8,'','22:30');
assert(noWait.idleCost===0,'Double comptage E55C détecté sans attente');
assert(Math.abs(noWait.total-(.6+30*.084))<1e-9,`Total recharge seule incorrect : ${noWait.total}`);

const thirtyMinutesParked=sandbox.priceWithRules(pricing,22*60+30,30,8,'23:30','22:30');
assert(Math.abs(thirtyMinutesParked.idleCost-30*.0624)<1e-9,`Stationnement après charge incorrect : ${thirtyMinutesParked.idleCost}`);
assert(Math.abs(thirtyMinutesParked.total-(noWait.total+30*.0624))<1e-9,`Total avec attente incorrect : ${thirtyMinutesParked.total}`);

console.log(JSON.stringify({sainteJulitteChargeOnly:sainteJulitte.total,noWait:noWait.total,parked30Minutes:thirtyMinutesParked.total,parkingAfterCharge:thirtyMinutesParked.idleCost},null,2));
