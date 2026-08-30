'use strict';
const assert = require('node:assert/strict');
const { adaptTotalEnergiesMorocco } = require('../scripts/v9/morocco-totalenergies-host-adapter.cjs');

const official = {
  rows: [
    {site_name:'AL WAHA',charger_count:1,power_kw:22,current_class:'AC'},
    {site_name:'TAMESNA',charger_count:1,power_kw:22,current_class:'AC'},
    {site_name:'TAMESNA',charger_count:1,power_kw:22,current_class:'AC'}
  ]
};
const alWaha = {station:{canonical_name:'TotalEnergies AL WAHA',operator_cpo:'Kilowatt',latitude:33.4887755,longitude:-7.5100194,kilowatt_station_id:'62e29ef59ad98566676cf824',official_power_kw:22}};
const out = adaptTotalEnergiesMorocco(official, alWaha);
assert.equal(out.summary.uniqueHostSites, 2);
assert.equal(out.production.length, 1);
assert.equal(out.production[0].physicalOperator, 'Kilowatt');
assert.equal(out.production[0].access.siteBrand, 'TotalEnergies');
assert.equal(out.production[0].access.accessNetwork, 'Kilowatt');
assert.equal(out.production[0].offers.length, 0);
assert.equal(out.production[0].status.statusSource, 'Kilowatt public web map');
assert.ok(out.diagnostics.every(x => x.physicalOperator === null));
assert.ok(out.diagnostics.every(x => x.productionEligible === false));
console.log('ok');
