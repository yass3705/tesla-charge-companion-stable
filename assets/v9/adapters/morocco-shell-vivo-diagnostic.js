(function (root) {
  'use strict';

  const SOURCE_ID = 'morocco-shell-vivo-diagnostic';

  function unresolvedToNull(value) {
    return !value || value === 'unresolved' ? null : value;
  }

  function adaptShellVivoDiagnostic(report) {
    const candidate = report && report.station_candidate ? report.station_candidate : {};
    const modeling = report && report.modeling ? report.modeling : {};
    const assessment = report && report.assessment ? report.assessment : {};
    const coordinates = candidate.shell_directory_coordinates || candidate.coordinates || {};
    const accessNetwork = unresolvedToNull(modeling.app_source_access_network || modeling.access_network);
    const networkBrand = unresolvedToNull(modeling.network_brand);

    return {
      sourceId: SOURCE_ID,
      countryCode: 'MA',
      productionEligible: false,
      diagnosticOnly: true,
      name: candidate.name || null,
      latitude: coordinates.lat,
      longitude: coordinates.lng,
      physicalOperator: null,
      networkBrand,
      access: {
        siteBrand: modeling.site_brand || 'Shell',
        appSource: unresolvedToNull(modeling.app_source),
        accessNetwork
      },
      offers: [],
      status: {
        value: 'unknown',
        statusSource: null
      },
      diagnostic: {
        cpoUnresolved: modeling.operator_cpo === 'unresolved' || !modeling.operator_cpo,
        tariffChannelUnresolved: modeling.tariff_channel === 'unresolved' || !modeling.tariff_channel,
        statusSourceUnresolved: modeling.status_source === 'unresolved' || !modeling.status_source,
        reason: assessment.reason || null
      }
    };
  }

  const api = { SOURCE_ID, adaptShellVivoDiagnostic };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TCCMoroccoShellVivoDiagnostic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
