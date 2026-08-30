const assert = require('node:assert/strict');
const { adaptShellVivoDiagnostic } = require('../assets/v9/adapters/morocco-shell-vivo-diagnostic.js');

const report = {
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

const out = adaptShellVivoDiagnostic(report);
assert.equal(out.productionEligible, false);
assert.equal(out.diagnosticOnly, true);
assert.equal(out.physicalOperator, null);
assert.equal(out.access.siteBrand, 'Shell');
assert.equal(out.access.accessNetwork, null);
assert.deepEqual(out.offers, []);
assert.equal(out.status.value, 'unknown');
assert.equal(out.status.statusSource, null);
assert.equal(out.diagnostic.cpoUnresolved, true);
console.log('Shell/Vivo Morocco diagnostic policy: OK');
