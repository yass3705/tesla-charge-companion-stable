(function (root) {
  'use strict';

  const SOURCE_ID = 'morocco-shell-vivo-diagnostic';

  function unresolvedToNull(value) {
    if (!value) return null;
    const normalized = String(value).trim().toLowerCase();
    return normalized === 'unresolved' || normalized.startsWith('unresolved ') || normalized.startsWith('unresolved;')
      ? null
      : value;
  }

  function adaptShellVivoDiagnostic(report) {
    const candidate = report && (report.station_candidate || report.station) ? (report.station_candidate || report.station) : {};
    const modeling = report && report.modeling ? report.modeling : {};
    const assessment = report && report.assessment ? report.assessment : {};
    const recommendation = report && report.production_recommendation ? report.production_recommendation : {};
    const coordinates = candidate.shell_directory_coordinates || candidate.coordinates || {};
    const latitude = coordinates.lat != null ? coordinates.lat : (candidate.latitude_candidate != null ? candidate.latitude_candidate : candidate.latitude);
    const longitude = coordinates.lng != null ? coordinates.lng : (candidate.longitude_candidate != null ? candidate.longitude_candidate : candidate.longitude);
    const accessNetwork = unresolvedToNull(
      modeling.access_network || modeling.app_source_access_network || candidate.app_source_access_network
    );
    const networkBrand = unresolvedToNull(modeling.network_brand || candidate.network_brand);
    const siteBrand = modeling.site_brand || candidate.site_brand || 'Shell';
    const operatorValue = candidate.operator_cpo != null ? candidate.operator_cpo : modeling.operator_cpo;
    const tariffValue = candidate.tariff_channel != null ? candidate.tariff_channel : modeling.tariff_channel;
    const statusValue = candidate.status_source != null ? candidate.status_source : modeling.status_source;
    const powerCandidate = report && report.validated_or_candidate_shape
      ? report.validated_or_candidate_shape.connector_power_candidate || null
      : null;

    return {
      sourceId: SOURCE_ID,
      countryCode: 'MA',
      productionEligible: false,
      diagnosticOnly: true,
      name: candidate.name || candidate.canonical_name || null,
      latitude: latitude == null ? null : Number(latitude),
      longitude: longitude == null ? null : Number(longitude),
      physicalOperator: null,
      networkBrand,
      access: {
        siteBrand,
        appSource: unresolvedToNull(modeling.app_source),
        accessNetwork
      },
      offers: [],
      status: {
        value: 'unknown',
        statusSource: null
      },
      diagnostic: {
        cpoUnresolved: unresolvedToNull(operatorValue) == null,
        operatorCandidate: candidate.operator_cpo_candidate || null,
        tariffChannelUnresolved: unresolvedToNull(tariffValue) == null,
        statusSourceUnresolved: unresolvedToNull(statusValue) == null,
        connectorPowerCandidate: powerCandidate,
        secondaryFreeEvidence: Boolean(report && report.validated_or_candidate_shape && report.validated_or_candidate_shape.secondary_free_evidence),
        reason: assessment.reason || recommendation.reason || null
      }
    };
  }

  const api = { SOURCE_ID, adaptShellVivoDiagnostic };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TCCMoroccoShellVivoDiagnostic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
