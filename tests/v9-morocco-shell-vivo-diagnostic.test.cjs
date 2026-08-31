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

const alJazira = {
  station: {
    canonical_name: 'Shell Al Jazira',
    latitude_candidate: 33.779558,
    longitude_candidate: -7.232679,
    site_brand: 'Shell',
    network_brand: 'Shell Recharge',
    operator_cpo: null,
    operator_cpo_candidate: 'Vivo Energy Maroc',
    app_source_access_network: 'Shell Recharge',
    tariff_channel: null,
    status_source: null
  },
  validated_or_candidate_shape: {
    connector_power_candidate: {
      source_confidence: 'secondary',
      total_bays: 5,
      rapid_bays: 4,
      rapid_power_kw: 120,
      other_bays: 1,
      other_power_kw: 22
    },
    secondary_free_evidence: true
  },
  modeling: {
    cpo_operator: 'unresolved until a direct charging-operator source explicitly establishes Vivo Energy Maroc or another technical CPO',
    site_brand: 'Shell',
    app_source_access_network: 'Shell Recharge',
    tariff_channel: 'unresolved; do not convert secondary free reports into a direct Shell tariff',
    status_source: 'unresolved; no validated public live-status endpoint'
  },
  production_recommendation: {
    production_ready_as_cpo_station: false,
    reason: 'Exact EV charging CPO attribution, native tariff and live status endpoint are not yet directly validated.'
  }
};

const alJaziraOut = adaptShellVivoDiagnostic(alJazira);
assert.equal(alJaziraOut.productionEligible, false);
assert.equal(alJaziraOut.diagnosticOnly, true);
assert.equal(alJaziraOut.name, 'Shell Al Jazira');
assert.equal(alJaziraOut.latitude, 33.779558);
assert.equal(alJaziraOut.longitude, -7.232679);
assert.equal(alJaziraOut.physicalOperator, null);
assert.equal(alJaziraOut.networkBrand, 'Shell Recharge');
assert.equal(alJaziraOut.access.siteBrand, 'Shell');
assert.equal(alJaziraOut.access.accessNetwork, 'Shell Recharge');
assert.equal(alJaziraOut.access.appSource, null);
assert.deepEqual(alJaziraOut.offers, []);
assert.equal(alJaziraOut.status.statusSource, null);
assert.equal(alJaziraOut.diagnostic.cpoUnresolved, true);
assert.equal(alJaziraOut.diagnostic.operatorCandidate, 'Vivo Energy Maroc');
assert.equal(alJaziraOut.diagnostic.tariffChannelUnresolved, true);
assert.equal(alJaziraOut.diagnostic.statusSourceUnresolved, true);
assert.equal(alJaziraOut.diagnostic.connectorPowerCandidate.rapid_power_kw, 120);
assert.equal(alJaziraOut.diagnostic.secondaryFreeEvidence, true);

console.log('Shell/Vivo Morocco diagnostic policy: OK');
