const assert = require('node:assert/strict');
const { adaptShellVivoDiagnostic } = require('../assets/v9/adapters/morocco-shell-vivo-diagnostic.js');

const melloussa = {
  station_candidate: {
    name: 'Relais Melloussa / Shell Melloussa',
    shell_directory_coordinates: { lat: 35.67747, lng: -5.706855 }
  },
  modeling: {
    operator_cpo: 'unresolved',
    site_brand: 'Shell',
    app_source_access_network: 'unresolved',
    tariff_channel: 'unresolved',
    status_source: 'unresolved'
  },
  assessment: { reason: 'CPO, access network, tariff channel and live status source remain unresolved.' }
};

const melloussaOut = adaptShellVivoDiagnostic(melloussa);
assert.equal(melloussaOut.productionEligible, false);
assert.equal(melloussaOut.diagnosticOnly, true);
assert.equal(melloussaOut.physicalOperator, null);
assert.equal(melloussaOut.access.siteBrand, 'Shell');
assert.equal(melloussaOut.access.accessNetwork, null);
assert.deepEqual(melloussaOut.offers, []);
assert.equal(melloussaOut.status.value, 'unknown');
assert.equal(melloussaOut.status.statusSource, null);
assert.equal(melloussaOut.diagnostic.cpoUnresolved, true);

// Official Vivo Energy Maroc press release, 30 May 2025: Shell Al Jazira integrates
// the first fast-charging Shell Recharge infrastructure under the Shell brand in
// the Vivo Energy network in Africa. This resolves the infrastructure/network
// brand only; it does not, by itself, identify the physical CPO or live/tariff source.
const alJazira = {
  station_candidate: {
    name: 'Shell Al Jazira',
    coordinates: {}
  },
  modeling: {
    operator_cpo: 'unresolved',
    site_brand: 'Shell',
    network_brand: 'Shell Recharge',
    access_network: 'Shell Recharge',
    app_source: 'unresolved',
    tariff_channel: 'unresolved',
    status_source: 'unresolved'
  },
  assessment: {
    reason: 'Official Shell Recharge infrastructure is confirmed; physical CPO, tariff and live status source remain unresolved.'
  }
};

const alJaziraOut = adaptShellVivoDiagnostic(alJazira);
assert.equal(alJaziraOut.productionEligible, false);
assert.equal(alJaziraOut.physicalOperator, null);
assert.equal(alJaziraOut.access.siteBrand, 'Shell');
assert.equal(alJaziraOut.networkBrand, 'Shell Recharge');
assert.equal(alJaziraOut.access.accessNetwork, 'Shell Recharge');
assert.equal(alJaziraOut.access.appSource, null);
assert.deepEqual(alJaziraOut.offers, []);
assert.equal(alJaziraOut.status.statusSource, null);
assert.equal(alJaziraOut.diagnostic.cpoUnresolved, true);

console.log('Shell/Vivo Morocco diagnostic policy: OK');
