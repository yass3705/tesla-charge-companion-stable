const assert=require('node:assert/strict');
const Profiles=require('../assets/v9/vehicle-profile-engine.js');
const Charge=require('../assets/v9/charge-model-engine.js');

const catalog=Profiles.createCatalog({profiles:[{
  id:'test-ev',label:'Test EV',battery:{usableKwh:80},consumption:{kwhPer100Km:16},charging:{acMaxKw:11,dcMaxKw:210,efficiency:0.94,curve:[{soc:0,powerKw:200},{soc:80,powerKw:100},{soc:100,powerKw:30}]}
}]});
assert.equal(catalog.size,1);
const profile=catalog.get('test-ev');
assert.equal(profile.battery.usableKwh,80);
const resolved=Profiles.resolve({catalog,profileId:'test-ev',session:{startSoc:20,targetSoc:80}});
assert.equal(resolved.session.batteryCapacityKwh,80);
assert.equal(resolved.session.consumptionKwhPer100Km,16);
assert.equal(resolved.session.vehicleMaxAcKw,11);
assert.equal(resolved.session.vehicleMaxDcKw,210);
assert.equal(resolved.session.chargeEfficiency,0.94);
assert.equal(resolved.session.chargeCurve.length,3);

const overridden=Profiles.applyToSession(profile,{consumptionKwhPer100Km:19,vehicleMaxDcKw:150});
assert.equal(overridden.consumptionKwhPer100Km,19);
assert.equal(overridden.vehicleMaxDcKw,150);

const acStation={evses:[{connectors:[{kind:'AC',powerKw:22}]}]};
const dcStation={evses:[{connectors:[{kind:'DC',powerKw:350}]}]};
const ac=Charge.estimate(acStation,{...resolved.session,energyKwh:10,startSoc:20,targetSoc:null,disableSocCurve:true});
const dc=Charge.estimate(dcStation,{...resolved.session,energyKwh:10,startSoc:20,targetSoc:null,disableSocCurve:true});
assert.equal(ac.chargingKind,'AC');
assert.equal(ac.availablePowerKw,11);
assert.equal(dc.chargingKind,'DC');
assert.equal(dc.availablePowerKw,210);

console.log(JSON.stringify({ok:true,module:'tcc-v9-vehicle-profile-engine',profile:resolved.profile.id,acLimit:ac.availablePowerKw,dcLimit:dc.availablePowerKw},null,2));
