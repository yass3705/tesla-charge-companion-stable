(function (root) {
  'use strict';

  const SOURCE_ID = 'morocco-shell-vivo-diagnostic';

  function adaptShellVivoDiagnostic(report) {
    const candidate = report && report.station_candidate ? report.station_candidate : {};
    const modeling = report && report.modeling ? report.modeling : {};
    const assessment = report && report.assessment ? report.assessment : {};

    return {
      sourceId: SOURCE_ID,
      countryCode: 'MA',
      productionEligible: false,
      diagnosticOnly: true,
      name: candidate.name || null,
      latitude: candidate.shell_directory_coordinates && candidate.shell_directory_coordinates.lat,
      longitude: candidate.shell_directory_coordinates && candidate.shell_directory_coordinates.lng,
      physicalOperator: null,
      networkBrand: null,
      access: {
        siteBrand: modeling.site_brand || 'Shell',
        appSource: null,
        accessNetwork: null
      },
      offers: [],
      status: {
        value: 'unknown',
        statusSource: null
      },
      diagnostic: {
        cpoUnresolved: modeling.operator_cpo === 'unresolved',
        tariffChannelUnresolved: modeling.tariff_channel === 'unresolved',
        statusSourceUnresolved: modeling.status_source === 'unresolved',
        reason: assessment.reason || null
      }
    };
  }

  const api = { SOURCE_ID, adaptShellVivoDiagnostic };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TCCMoroccoShellVivoDiagnostic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
