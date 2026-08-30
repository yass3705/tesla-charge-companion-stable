const assert=require('node:assert/strict');
const Charge=require('../assets/v9/charge-model-engine.js');

const dc={id:'dc',evses:[{connectors:[{powerKw:250}]}]};
const ac={id:'ac',evses:[{connectors:[{powerKw:11}]}]};
const close=(actual,expected,tolerance=1e-6,message='')=>assert.ok(Math.abs(actual-expected)<=tolerance,message||`${actual} ≈ ${expected}`);

const low=Charge.estimate(dc,{batteryCapacityKwh:75,startSoc:20,targetSoc:80,vehicleMaxChargeKw:250,chargeEfficiency:1});
const high=Charge.estimate(dc,{batteryCapacityKwh:75,startSoc:80,targetSoc:100,vehicleMaxChargeKw:250,chargeEfficiency:1});
assert.equal(low.profile,'generic-dc-conservative');
assert.equal(high.profile,'generic-dc-conservative');
assert.ok(low.minutes>0);
assert.ok(high.minutes>0);
const lowMinutesPerKwh=low.minutes/low.energyKwh,highMinutesPerKwh=high.minutes/high.energyKwh;
assert.ok(highMinutesPerKwh>lowMinutesPerKwh*2,'80-100 must be materially slower per kWh than 20-80');

const capped=Charge.estimate(dc,{batteryCapacityKwh:75,startSoc:20,targetSoc:50,vehicleMaxChargeKw:100,chargeEfficiency:1});
assert.ok(capped.availablePowerKw===100);

const flat=Charge.estimate(ac,{batteryCapacityKwh:75,startSoc:80,targetSoc:100,vehicleMaxChargeKw:250,chargeEfficiency:1});
assert.equal(flat.profile,'flat');
close(flat.minutes,75*0.2/11*60,1e-6,'AC flat duration may be rounded to engine precision');

const custom=Charge.estimate(dc,{batteryCapacityKwh:60,startSoc:0,targetSoc:50,vehicleMaxChargeKw:200,chargeEfficiency:1,chargeCurve:[{soc:0,powerKw:100},{soc:100,powerKw:100}]});
assert.equal(custom.profile,'custom');
close(custom.minutes,18);

const legacy=Charge.estimate(dc,{energyKwh:30,vehicleMaxChargeKw:250,chargeEfficiency:1,disableSocCurve:true});
assert.equal(legacy.profile,'flat');
close(legacy.minutes,7.2);

console.log(JSON.stringify({ok:true,module:'tcc-v9-charge-model-engine',lowMinutes:low.minutes,highMinutes:high.minutes,lowMinutesPerKwh,highMinutesPerKwh},null,2));
